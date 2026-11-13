#!/usr/bin/env node
// Redefine a senha de uma conta direto no servidor, sem e-mail.
// Uso: node reset-senha.js EMAIL_DA_CONTA
// O servidor precisa estar PARADO (ele regrava o data.json e desfaria a mudança).

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const FILE = path.join(__dirname, 'data.json');
const TMP = FILE + '.tmp';
const BAK = FILE + '.bak';
const LOCK = path.join(__dirname, '.server.lock');
const PORT = Number(process.env.PORT) || 3000;
const COST = 10; // mesmo custo do registro (auth.js)
const TEMP_LEN = 10;
// Sem caracteres que se confundem (0/O, 1/l/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// PID vivo no arquivo de lock que o server.js cria ao subir
function lockedByLivePid() {
  let pid;
  try { pid = Number(fs.readFileSync(LOCK, 'utf8').trim()); } catch { return false; }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(1500);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

function tempPassword() {
  let out = '';
  for (let i = 0; i < TEMP_LEN; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('-')) die('Uso: node reset-senha.js EMAIL_DA_CONTA');
  const email = args[0].trim().toLowerCase();

  if (lockedByLivePid() || (await portInUse(PORT))) {
    die(`O servidor está rodando (porta ${PORT}). Pare antes (./stop.sh ou Ctrl+C) e rode de novo:\n` +
        'ele regrava o data.json e sobrescreveria a senha nova. Nada foi alterado.');
  }

  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (err) {
    die(err.code === 'ENOENT' ? 'Não existe data.json aqui (nenhuma conta criada neste servidor).' : `Não consegui ler data.json: ${err.message}`);
  }
  let data;
  try { data = JSON.parse(raw); } catch (err) { die(`data.json ilegível: ${err.message}. Nada foi alterado.`); }
  if (!data || typeof data.users !== 'object' || !data.users) die('data.json em formato inesperado. Nada foi alterado.');

  const user = Object.values(data.users).find((u) => u && u.email === email);
  if (!user) die(`Nenhuma conta com o email "${email}". Nada foi alterado.`);

  const password = tempPassword();
  user.passHash = bcrypt.hashSync(password, COST);
  user.sv = (user.sv || 0) + 1; // derruba as sessões antigas dessa conta

  fs.writeFileSync(BAK, raw, { mode: 0o600 });               // cópia do estado anterior
  fs.writeFileSync(TMP, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(TMP, FILE);                                   // troca atômica

  console.log(`Senha redefinida para ${email} (piloto: ${user.name}).`);
  console.log('');
  console.log(`  Senha temporária: ${password}`);
  console.log('');
  console.log('Ela não será mostrada de novo. Passe para a pessoa em privado e peça para trocar em');
  console.log('Perfil / Loja → Trocar senha. Cópia do arquivo anterior: data.json.bak');
  console.log('Agora pode ligar o servidor de novo.');
}

main().catch((err) => die(`Erro: ${err.message}. Confira se o data.json está intacto (cópia em data.json.bak, se foi criada).`));
