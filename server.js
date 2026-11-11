const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const store = require('./store');
const { createEconomy } = require('./economy');
const { createAuthRouter, userIdFromCookieHeader, NAME_MAX } = require('./auth');

const PORT = process.env.PORT || 3000;
const EMPTY_ROOM_TTL = 30_000; // sala vazia sobrevive 30s (ex.: alguém deu F5)
const SFX_COOLDOWN = 700;
const SFX_IDS = new Set([
  'airhorn', 'vineboom', 'sadtrombone', 'badumtss', 'crickets', 'kirakira',
  'nani', 'omae', 'sugoi', 'yamete', 'kawaii', 'dattebayo', 'sixseven', 'meow', 'nya',
]);

// K.O. de brincadeira entre nakamas ({f} = quem bateu, {t} = alvo)
const KO_COOLDOWN = 15_000;
const KO_GHOST_MS = 30_000;
const KO_LINES = [
  { text: 'Caminhão-kun mandou {t} para outro mundo 🚚✨', sfx: 'vineboom' },
  { text: '{f}: "Omae wa mou shindeiru." — {t}: "NANI?!"', sfx: 'omae' },
  { text: '{f} acertou um Rasengan em {t} 🌀', sfx: 'vineboom' },
  { text: '{f} usou UM soco sério em {t} 👊', sfx: 'vineboom' },
  { text: '{f} escreveu {t} no Death Note 📓', sfx: 'sadtrombone' },
  { text: '{t} tropeçou no cabo do amplificador e saiu do palco 🎸', sfx: 'badumtss' },
];
const KO_KIKURI = { text: '{t} ficou sem saquê e apagou no meio do show 🍶💤', sfx: 'sadtrombone' };

const POLL_DURATION = 60_000;
const POLL_COOLDOWN = 3_000;
const POLL_TITLE_MAX = 60;
const POLL_OPTION_MAX = 40;
const SKIP_POLL = { title: 'PULA ESSA CENA?', options: ['Sim, pula!', 'Não, fica'] };

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const economy = createEconomy(io);

app.set('trust proxy', 1); // atrás do túnel do Cloudflare: req.ip / https corretos
app.use('/api', createAuthRouter({ economy, onUserChanged }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

/**
 * code -> { members: Map<socketId, { name, live, pet }>, timer, poll }
 * Qualquer membro pode transmitir. Cada par (transmissor -> espectador)
 * tem sua própria RTCPeerConnection; o servidor só roteia a sinalização.
 */
const rooms = new Map();

// Sem 0/O/1/I para evitar confusão ao digitar o código
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const normalize = (code) => String(code || '').trim().toUpperCase();
const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Nakama';

const memberInfo = (id, m) => ({ id, name: m.name, live: m.live, pet: m.pet || null });

function memberList(room) {
  return [...room.members].map(([id, m]) => memberInfo(id, m));
}

// Logado usa o nome e o pet da conta; convidado usa o nome digitado e não tem pet
function identity(socket, typedName) {
  const user = store.getUser(socket.data.userId);
  return user ? { name: user.name, pet: user.pet } : { name: cleanName(typedName), pet: null };
}

function enterRoom(socket, code, typedName) {
  const room = rooms.get(code);
  clearTimeout(room.timer);
  const { name, pet } = identity(socket, typedName);
  const member = { name, live: false, pet };
  room.members.set(socket.id, member);
  socket.data.room = code;
  socket.join(code);
  socket.to(code).emit('member-joined', memberInfo(socket.id, member));
  economy.onEnterRoom(socket);

  if (room.poll) broadcastPoll(code); // novo membro vê a votação; os outros veem o novo total

  // Quem já está transmitindo precisa mandar uma offer para o recém-chegado
  for (const [id, m] of room.members) {
    if (m.live && id !== socket.id) io.to(id).emit('viewer-joined', { viewerId: socket.id });
  }
  console.log(`[${code}] ${name} entrou (${room.members.size} na sala)`);
}

function stopBroadcast(socket) {
  const room = rooms.get(socket.data.room);
  const me = room && room.members.get(socket.id);
  if (!me || !me.live) return;
  me.live = false;
  socket.to(socket.data.room).emit('host-left', { id: socket.id });
  console.log(`[${socket.data.room}] ${me.name} parou de transmitir`);
}

function leaveRoom(socket) {
  const code = socket.data.room;
  const room = rooms.get(code);
  if (!room || !room.members.has(socket.id)) return;
  stopBroadcast(socket);
  const { name } = room.members.get(socket.id);
  room.members.delete(socket.id);
  socket.leave(code);
  socket.data.room = null;
  socket.to(code).emit('viewer-left', { viewerId: socket.id });
  socket.to(code).emit('member-left', { id: socket.id, name });
  console.log(`[${code}] ${name} saiu (${room.members.size} na sala)`);

  if (room.poll) {
    room.poll.votes.delete(socket.id);
    if (room.members.size === 0) {
      clearTimeout(room.poll.timer); // sala vazia: a votação some junto
      room.poll = null;
    } else {
      broadcastPoll(code);
      checkAllVoted(code); // quem faltava votar pode ter sido quem saiu
    }
  }

  if (room.members.size === 0) {
    room.timer = setTimeout(() => {
      if (rooms.get(code) === room && room.members.size === 0) {
        rooms.delete(code);
        console.log(`[${code}] sala encerrada`);
      }
    }, EMPTY_ROOM_TTL);
  }
}

// ---------- votação (estado só em memória, uma por sala) ----------

let pollSeq = 0;

function pollState(room) {
  const p = room.poll;
  const counts = p.options.map(() => 0);
  for (const idx of p.votes.values()) counts[idx]++;
  return {
    id: p.id, kind: p.kind, title: p.title, options: p.options, counts,
    total: p.votes.size, voters: room.members.size, by: p.by,
    remainingMs: Math.max(0, p.endsAt - Date.now()),
  };
}

function broadcastPoll(code) {
  const room = rooms.get(code);
  if (room && room.poll) io.to(code).emit('poll-update', pollState(room));
}

function closePoll(code, reason) {
  const room = rooms.get(code);
  if (!room || !room.poll) return;
  clearTimeout(room.poll.timer);
  const result = { ...pollState(room), remainingMs: 0, reason };
  // "Pula essa cena" passa com mais de 50% dos votos em "sim"
  if (result.kind === 'skip') result.skipPassed = result.total > 0 && result.counts[0] / result.total > 0.5;
  room.poll = null;
  io.to(code).emit('poll-closed', result);
  console.log(`[${code}] votação encerrada (${reason}): ${result.title} → ${result.counts.join('/')}`);
}

function checkAllVoted(code) {
  const room = rooms.get(code);
  if (room && room.poll && room.members.size > 0 && room.poll.votes.size >= room.members.size) {
    closePoll(code, 'all-voted');
  }
}

function cleanText(s) {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

// Nome/pet da conta mudaram: atualiza em todas as salas onde ela está e no perfil
function onUserChanged(userId) {
  const user = store.getUser(userId);
  if (!user) return;
  for (const s of io.sockets.sockets.values()) {
    if (s.data.userId !== userId) continue;
    const room = rooms.get(s.data.room);
    const m = room && room.members.get(s.id);
    if (m) {
      m.name = user.name;
      m.pet = user.pet;
      io.to(s.data.room).emit('member-updated', memberInfo(s.id, m));
    }
  }
  io.to('user:' + userId).emit('profile', economy.profile(user));
}

function sameRoom(a, b) {
  const room = rooms.get(io.sockets.sockets.get(a)?.data.room);
  return !!room && room.members.has(a) && room.members.has(b);
}

// Sessão: lê o cookie assinado do handshake (convidado = sem userId)
io.use((socket, next) => {
  socket.data.userId = userIdFromCookieHeader(socket.handshake.headers.cookie);
  next();
});

io.on('connection', (socket) => {
  const reply = (ack) => (typeof ack === 'function' ? ack : () => {});
  const user = economy.attach(socket);
  if (user) socket.emit('profile', economy.profile(user));

  socket.on('create-room', (payload, ack) => {
    leaveRoom(socket);
    const code = generateCode();
    rooms.set(code, { members: new Map(), timer: null });
    enterRoom(socket, code, cleanName(payload && payload.name));
    console.log(`[${code}] sala criada`);
    reply(ack)({ ok: true, room: code, members: memberList(rooms.get(code)) });
  });

  socket.on('join-room', (payload, ack) => {
    const code = normalize(payload && payload.room);
    if (!rooms.has(code)) {
      return reply(ack)({ ok: false, error: `Sala "${code || '?'}" não existe ou já foi encerrada.` });
    }
    if (socket.data.room !== code) {
      leaveRoom(socket);
      enterRoom(socket, code, cleanName(payload && payload.name));
    }
    reply(ack)({ ok: true, room: code, members: memberList(rooms.get(code)) });
  });

  socket.on('set-name', (name) => {
    const room = rooms.get(socket.data.room);
    const me = room && room.members.get(socket.id);
    if (!me) return;
    const account = store.getUser(socket.data.userId);
    if (account) {
      // Logado: o nome é salvo na conta (vale para todas as abas)
      if (typeof name !== 'string' || !name.trim()) return;
      account.name = cleanName(name);
      store.save();
      return onUserChanged(account.id);
    }
    me.name = cleanName(name);
    io.to(socket.data.room).emit('member-updated', memberInfo(socket.id, me));
  });

  // ---------- loja ----------

  socket.on('shop-buy', (petId, ack) => {
    const res = economy.buy(socket.data.userId, petId);
    if (res.ok) onUserChanged(socket.data.userId);
    reply(ack)(res);
  });

  socket.on('shop-equip', (petId, ack) => {
    const res = economy.equip(socket.data.userId, petId);
    if (res.ok) onUserChanged(socket.data.userId);
    reply(ack)(res);
  });

  socket.on('start-broadcast', () => {
    const room = rooms.get(socket.data.room);
    const me = room && room.members.get(socket.id);
    if (!me || me.live) return;
    me.live = true;
    socket.to(socket.data.room).emit('member-updated', memberInfo(socket.id, me));
    // Pede ao transmissor uma offer para cada outro membro
    for (const id of room.members.keys()) {
      if (id !== socket.id) socket.emit('viewer-joined', { viewerId: id });
    }
    console.log(`[${socket.data.room}] ${me.name} começou a transmitir`);
  });

  socket.on('host-left', () => stopBroadcast(socket));

  // Roteamento ponto a ponto da sinalização
  for (const event of ['offer', 'answer', 'ice-candidate']) {
    socket.on(event, (msg) => {
      if (!msg || typeof msg.to !== 'string' || !sameRoom(socket.id, msg.to)) return;
      const { to, ...data } = msg;
      io.to(to).emit(event, { ...data, from: socket.id });
    });
  }

  // Mesa de sons: toca para todo mundo da sala
  socket.on('sfx', (id) => {
    const room = rooms.get(socket.data.room);
    const me = room && room.members.get(socket.id);
    const now = Date.now();
    if (!me || !SFX_IDS.has(id) || now - (socket.data.lastSfx || 0) < SFX_COOLDOWN) return;
    socket.data.lastSfx = now;
    io.to(socket.data.room).emit('sfx', { id, from: socket.id, name: me.name });
  });

  // ---------- K.O. (humor) ----------

  socket.on('ko', (targetId, ack) => {
    const done = reply(ack);
    const code = socket.data.room;
    const room = rooms.get(code);
    const me = room && room.members.get(socket.id);
    const target = room && typeof targetId === 'string' && room.members.get(targetId);
    const now = Date.now();
    if (!me || !target) return done({ ok: false, error: 'Essa pessoa não está na sala.' });
    if (targetId === socket.id) return done({ ok: false, error: 'Nada de autossabotagem, piloto.' });
    if (now - (socket.data.lastKo || 0) < KO_COOLDOWN) {
      return done({ ok: false, error: `Recarregando o golpe… ${Math.ceil((KO_COOLDOWN - (now - socket.data.lastKo)) / 1000)}s` });
    }
    if ((target.ghostUntil || 0) > now) return done({ ok: false, error: `${target.name} já é um fantasma 👻` });

    socket.data.lastKo = now;
    target.ghostUntil = now + KO_GHOST_MS;
    const line = /kikuri|hiroi/i.test(target.name)
      ? KO_KIKURI
      : KO_LINES[Math.floor(Math.random() * KO_LINES.length)];
    done({ ok: true });
    io.to(code).emit('ko', {
      from: socket.id, target: targetId, ghostMs: KO_GHOST_MS, sfx: line.sfx,
      text: line.text.replaceAll('{f}', me.name).replaceAll('{t}', target.name),
    });
    console.log(`[${code}] ${me.name} deu K.O. em ${target.name}`);
  });

  // ---------- votação ----------

  socket.on('poll-create', (payload, ack) => {
    const done = reply(ack);
    const code = socket.data.room;
    const room = rooms.get(code);
    const me = room && room.members.get(socket.id);
    if (!me) return done({ ok: false, error: 'Você não está numa sala.' });
    if (room.poll) return done({ ok: false, error: 'Já tem uma votação aberta. Espere ela acabar.' });
    const now = Date.now();
    if (now - (socket.data.lastPoll || 0) < POLL_COOLDOWN) return done({ ok: false, error: 'Calma! Espere uns segundos.' });

    let kind = 'custom';
    let title;
    let options;
    if (payload && payload.preset === 'skip') {
      kind = 'skip';
      ({ title, options } = SKIP_POLL);
    } else {
      title = cleanText(payload && payload.title);
      const raw = Array.isArray(payload && payload.options) ? payload.options : [];
      options = raw.map((o) => cleanText(o)).filter(Boolean);
      if (!title || title.length > POLL_TITLE_MAX) return done({ ok: false, error: `O título precisa ter de 1 a ${POLL_TITLE_MAX} caracteres.` });
      if (raw.length > 4 || options.length < 2 || options.length > 4) return done({ ok: false, error: 'A votação precisa de 2 a 4 opções.' });
      if (options.some((o) => o.length > POLL_OPTION_MAX)) return done({ ok: false, error: `Cada opção pode ter até ${POLL_OPTION_MAX} caracteres.` });
      if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return done({ ok: false, error: 'As opções precisam ser diferentes.' });
    }

    socket.data.lastPoll = now;
    room.poll = {
      id: ++pollSeq, kind, title, options, by: me.name,
      votes: new Map(), // socketId -> índice da opção (1 voto por pessoa, pode trocar)
      paidVoters: new Set(), // contas que já ganharam moedas nesta votação
      endsAt: now + POLL_DURATION,
      timer: setTimeout(() => closePoll(code, 'timeout'), POLL_DURATION),
    };
    console.log(`[${code}] ${me.name} abriu votação: ${title}`);
    economy.onPollOpen(socket);
    done({ ok: true, id: room.poll.id });
    broadcastPoll(code);
  });

  socket.on('poll-vote', (payload, ack) => {
    const done = reply(ack);
    const code = socket.data.room;
    const room = rooms.get(code);
    const poll = room && room.poll;
    if (!poll || !room.members.has(socket.id)) return done({ ok: false, error: 'Nenhuma votação aberta.' });
    const option = payload && payload.option;
    if (!payload || payload.id !== poll.id) return done({ ok: false, error: 'Essa votação já acabou.' });
    if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) return done({ ok: false, error: 'Opção inválida.' });
    poll.votes.set(socket.id, option);
    economy.onVote(socket, poll);
    done({ ok: true, option });
    broadcastPoll(code);
    checkAllVoted(code);
  });

  socket.on('leave-room', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

economy.startPresence((s) => {
  const room = rooms.get(s.data.room);
  return !!room && room.members.has(s.id);
});

// Salva data.json antes de sair (Ctrl+C, stop.sh, kill)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { store.flush(); process.exit(0); });
}

server.listen(PORT, () => {
  console.log(`screencast rodando em http://localhost:${PORT}`);
});
