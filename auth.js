// Contas opcionais: email + senha (bcryptjs), sessão em cookie httpOnly assinado com HMAC.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('./store');
const { PETS, ACHIEVEMENTS, DEFAULT_PET } = require('./economy');

const COOKIE = 'sc_session';
const SESSION_DAYS = 30;
const NAME_MAX = 16;
const EMAIL_MAX = 254;
const PASS_MIN = 6;
const PASS_MAX = 72; // limite do bcrypt
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RATE_LIMIT = 10;
const RATE_WINDOW = 10 * 60 * 1000;

// ---------- segredo da sessão ----------

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(__dirname, '.secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch {}
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, s + '\n', { mode: 0o600 });
  console.log('auth: segredo de sessão gerado em .secret');
  return s;
}
const SECRET = loadSecret();

// ---------- cookie assinado ----------

const hmac = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');

// "v" é a versão da sessão da conta (user.sv): trocar/redefinir a senha invalida os cookies antigos
function signSession(userId) {
  const user = store.getUser(userId);
  const payload = Buffer.from(JSON.stringify({ u: userId, v: (user && user.sv) || 0, e: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

function verifySession(token) {
  if (typeof token !== 'string' || token.length > 500) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(hmac(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const { u, v, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const user = store.getUser(u);
    return e > Date.now() && user && (v || 0) === (user.sv || 0) ? u : null;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {}
    }
  }
  return out;
}

const userIdFromCookieHeader = (header) => verifySession(parseCookies(header)[COOKIE]);

// Cookie "secure" quando a requisição chegou por HTTPS (inclusive via túnel do Cloudflare)
const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

function setSessionCookie(req, res, userId) {
  res.cookie(COOKIE, signSession(userId), {
    httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/', maxAge: SESSION_DAYS * 864e5,
  });
}

// ---------- validação ----------

const cleanName = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

function validName(name) {
  return name.length >= 1 && name.length <= NAME_MAX;
}

function normEmail(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

// ---------- rate limit em memória ----------

const attempts = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  list.push(now);
  attempts.set(ip, list);
  return list.length > RATE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of attempts) if (!list.some((t) => now - t < RATE_WINDOW)) attempts.delete(ip);
}, RATE_WINDOW).unref();

// Hash fixo para gastar o mesmo tempo quando o email não existe
const DUMMY_HASH = bcrypt.hashSync('nao-e-uma-senha-real', 10);

// ---------- rotas ----------

function createAuthRouter({ economy, onUserChanged }) {
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));

  const fail = (res, status, error) => res.status(status).json({ ok: false, error });
  const requireJson = (req, res, next) =>
    req.is('application/json') ? next() : fail(res, 415, 'Envie JSON.');

  router.get('/catalog', (_req, res) => res.json({ pets: PETS, achievements: ACHIEVEMENTS }));

  router.post('/register', requireJson, async (req, res) => {
    if (rateLimited(req.ip)) return fail(res, 429, 'Muitas tentativas. Espere uns minutos e tente de novo.');
    const email = normEmail(req.body.email);
    const password = req.body.password;
    const name = cleanName(req.body.name) || `Piloto-${Math.floor(Math.random() * 90 + 10)}`;
    if (!EMAIL_RE.test(email) || email.length > EMAIL_MAX) return fail(res, 400, 'Email inválido.');
    if (typeof password !== 'string' || password.length < PASS_MIN) return fail(res, 400, `A senha precisa de pelo menos ${PASS_MIN} caracteres.`);
    if (Buffer.byteLength(password) > PASS_MAX) return fail(res, 400, 'Senha longa demais.');
    if (!validName(name)) return fail(res, 400, `O nome de piloto pode ter até ${NAME_MAX} caracteres.`);
    if (store.getUserByEmail(email)) return fail(res, 409, 'Esse email já tem conta. Tente entrar.');

    const passHash = await bcrypt.hash(password, 10);
    if (store.getUserByEmail(email)) return fail(res, 409, 'Esse email já tem conta. Tente entrar.'); // corrida
    const user = store.createUser({ email, passHash, name, pet: DEFAULT_PET });
    setSessionCookie(req, res, user.id);
    console.log(`auth: conta criada (${user.id})`);
    res.status(201).json({ ok: true, user: economy.profile(user) });
  });

  router.post('/login', requireJson, async (req, res) => {
    if (rateLimited(req.ip)) return fail(res, 429, 'Muitas tentativas. Espere uns minutos e tente de novo.');
    const email = normEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
    const user = store.getUserByEmail(email);
    const ok = await bcrypt.compare(password, user ? user.passHash : DUMMY_HASH);
    if (!user || !ok) return fail(res, 401, 'Email ou senha incorretos.');
    setSessionCookie(req, res, user.id);
    res.json({ ok: true, user: economy.profile(user) });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: isHttps(req), path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const user = store.getUser(userIdFromCookieHeader(req.headers.cookie));
    if (!user) return fail(res, 401, 'Não logado.');
    res.json({ ok: true, user: economy.profile(user) });
  });

  router.patch('/me', requireJson, (req, res) => {
    const user = store.getUser(userIdFromCookieHeader(req.headers.cookie));
    if (!user) return fail(res, 401, 'Não logado.');
    const { name, pet } = req.body;
    if (name !== undefined) {
      const n = cleanName(name);
      if (!validName(n)) return fail(res, 400, `O nome de piloto pode ter de 1 a ${NAME_MAX} caracteres.`);
      user.name = n;
    }
    if (pet !== undefined) {
      if (typeof pet !== 'string' || !user.pets.includes(pet)) return fail(res, 400, 'Você ainda não tem esse pet.');
      user.pet = pet;
    }
    store.save();
    onUserChanged(user.id);
    res.json({ ok: true, user: economy.profile(user) });
  });

  router.post('/password', requireJson, async (req, res) => {
    const user = store.getUser(userIdFromCookieHeader(req.headers.cookie));
    if (!user) return fail(res, 401, 'Não logado.');
    if (rateLimited(req.ip)) return fail(res, 429, 'Muitas tentativas. Espere uns minutos e tente de novo.');
    const current = typeof req.body.current === 'string' ? req.body.current.slice(0, 200) : '';
    const next = req.body.next;
    if (typeof next !== 'string' || next.length < PASS_MIN) return fail(res, 400, `A senha nova precisa de pelo menos ${PASS_MIN} caracteres.`);
    if (Buffer.byteLength(next) > PASS_MAX) return fail(res, 400, 'Senha longa demais.');
    if (!(await bcrypt.compare(current, user.passHash))) return fail(res, 401, 'Senha atual incorreta.');
    if (next === current) return fail(res, 400, 'A senha nova precisa ser diferente da atual.');

    user.passHash = await bcrypt.hash(next, 10);
    user.sv = (user.sv || 0) + 1; // desloga os outros aparelhos
    store.save();
    setSessionCookie(req, res, user.id); // mantém este aparelho logado
    console.log(`auth: senha trocada (${user.id})`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAuthRouter, userIdFromCookieHeader, NAME_MAX };
