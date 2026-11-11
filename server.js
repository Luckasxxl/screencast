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

  if (room.members.size === 0) {
    room.timer = setTimeout(() => {
      if (rooms.get(code) === room && room.members.size === 0) {
        rooms.delete(code);
        console.log(`[${code}] sala encerrada`);
      }
    }, EMPTY_ROOM_TTL);
  }
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

  socket.on('leave-room', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => {
  console.log(`screencast rodando em http://localhost:${PORT}`);
});
