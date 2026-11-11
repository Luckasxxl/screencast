const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const EMPTY_ROOM_TTL = 30_000; // sala vazia sobrevive 30s (ex.: alguém deu F5)
const SFX_COOLDOWN = 700;
const SFX_IDS = new Set([
  'airhorn', 'vineboom', 'sadtrombone', 'badumtss', 'crickets', 'kirakira',
  'nani', 'omae', 'sugoi', 'yamete', 'kawaii', 'dattebayo', 'sixseven', 'meow', 'nya',
]);

const POLL_DURATION = 60_000;
const POLL_COOLDOWN = 3_000;
const POLL_TITLE_MAX = 60;
const POLL_OPTION_MAX = 40;
const SKIP_POLL = { title: 'PULA ESSA CENA?', options: ['Sim, pula!', 'Não, fica'] };

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

/**
 * code -> { members: Map<socketId, { name, live }>, timer }
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
const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Nakama';

function memberList(room) {
  return [...room.members].map(([id, m]) => ({ id, name: m.name, live: m.live }));
}

function enterRoom(socket, code, name) {
  const room = rooms.get(code);
  clearTimeout(room.timer);
  room.members.set(socket.id, { name, live: false });
  socket.data.room = code;
  socket.join(code);
  socket.to(code).emit('member-joined', { id: socket.id, name, live: false });

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

function sameRoom(a, b) {
  const room = rooms.get(io.sockets.sockets.get(a)?.data.room);
  return !!room && room.members.has(a) && room.members.has(b);
}

io.on('connection', (socket) => {
  const reply = (ack) => (typeof ack === 'function' ? ack : () => {});

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
    me.name = cleanName(name);
    io.to(socket.data.room).emit('member-updated', { id: socket.id, name: me.name, live: me.live });
  });

  socket.on('start-broadcast', () => {
    const room = rooms.get(socket.data.room);
    const me = room && room.members.get(socket.id);
    if (!me || me.live) return;
    me.live = true;
    socket.to(socket.data.room).emit('member-updated', { id: socket.id, name: me.name, live: true });
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
      endsAt: now + POLL_DURATION,
      timer: setTimeout(() => closePoll(code, 'timeout'), POLL_DURATION),
    };
    console.log(`[${code}] ${me.name} abriu votação: ${title}`);
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
    done({ ok: true, option });
    broadcastPoll(code);
    checkAllVoted(code);
  });

  socket.on('leave-room', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => {
  console.log(`screencast rodando em http://localhost:${PORT}`);
});
