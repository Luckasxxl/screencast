// Persistência simples em data.json: escrita atômica (tmp + rename) com debounce.
// Sem banco e sem dependências nativas, para rodar também no Termux.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data.json');
const TMP = FILE + '.tmp';
const SAVE_DELAY = 2000;

let data = { version: 1, users: {} };
const byEmail = new Map(); // email -> userId
let timer = null;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && typeof parsed.users === 'object') data = parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Arquivo corrompido: guarda uma cópia e começa do zero em vez de derrubar o servidor
      const backup = `${FILE}.corrompido-${Date.now()}`;
      try { fs.copyFileSync(FILE, backup); } catch {}
      console.error(`data.json ilegível (${err.message}); cópia salva em ${backup}`);
    }
  }
  byEmail.clear();
  for (const u of Object.values(data.users)) byEmail.set(u.email, u.id);
  console.log(`store: ${byEmail.size} conta(s) carregada(s)`);
}

function writeNow() {
  clearTimeout(timer);
  timer = null;
  fs.writeFileSync(TMP, JSON.stringify(data, null, 1));
  fs.renameSync(TMP, FILE);
}

function save() {
  if (!timer) {
    timer = setTimeout(() => {
      try { writeNow(); } catch (err) { console.error('Falha ao salvar data.json:', err.message); }
    }, SAVE_DELAY);
  }
}

// Garante que nada se perde ao desligar (Ctrl+C, stop.sh, kill)
function flush() {
  if (timer) {
    try { writeNow(); } catch (err) { console.error('Falha ao salvar data.json:', err.message); }
  }
}

const getUser = (id) => (id && data.users[id]) || null;
const getUserByEmail = (email) => getUser(byEmail.get(email));

function createUser({ email, passHash, name, pet }) {
  const id = crypto.randomBytes(9).toString('base64url');
  const user = {
    id, email, passHash, name,
    coins: 0,
    pet, pets: [pet],
    achievements: {},
    stats: { votes: 0, pollsOpened: 0, roomSeconds: 0, days: [] },
    paidPolls: [],
    createdAt: Date.now(),
  };
  data.users[id] = user;
  byEmail.set(email, id);
  save();
  return user;
}

load();

module.exports = { getUser, getUserByEmail, createUser, save, flush };
