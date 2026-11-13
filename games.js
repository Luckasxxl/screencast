// Arcade da sala: roleta, roleta diária, mini games (reflexo e jokenpô) e reações.
// Estado só em memória (room.game), um jogo por sala de cada vez.

const ROULETTE_COOLDOWN = 8_000;
const ROULETTE_SPIN_MS = 5_000;
const ROULETTE_MIN = 2;
const ROULETTE_MAX = 10;
const ROULETTE_OPTION_MAX = 24;

const GAME_COOLDOWN = 4_000;
const REFLEX_WAIT_MIN = 2_000;
const REFLEX_WAIT_MAX = 6_000;
const REFLEX_GO_TIMEOUT = 5_000;
const RPS_PICK_MS = 10_000;
const RPS_BEATS = { r: 's', p: 'r', s: 'p' }; // pedra > tesoura, papel > pedra, tesoura > papel

const REACTIONS = new Set(['😂', '🔥', '💜', '😱', '👏', '💀', '🍿', '😭']);
const REACTION_COOLDOWN = 250;

let gameSeq = 0;

function cleanText(s) {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

function createGames({ io, rooms, economy }) {
  function endGame(code, result) {
    const room = rooms.get(code);
    const game = room && room.game;
    if (!game) return;
    clearTimeout(game.timer);
    room.game = null;
    const winners = (result.winners || []).filter((id) => room.members.has(id));
    io.to(code).emit('game-over', {
      id: game.id, kind: game.kind, text: result.text, picks: result.picks || null,
      winners: winners.map((id) => ({ id, name: room.members.get(id).name })),
    });
    // Moedas só quando houve disputa de verdade (2+ pessoas na sala)
    if (room.members.size >= 2) {
      for (const id of winners) economy.onGameWin(io.sockets.sockets.get(id));
    }
    console.log(`[${code}] ${game.kind} acabou: ${result.text}`);
  }

  function reflexGo(code, id) {
    const room = rooms.get(code);
    const game = room && room.game;
    if (!game || game.id !== id) return;
    game.phase = 'go';
    game.goAt = Date.now();
    io.to(code).emit('game', { id, kind: 'reflex', phase: 'go' });
    game.timer = setTimeout(() => endGame(code, { text: 'Ninguém reagiu a tempo… todo mundo dormindo 💤' }), REFLEX_GO_TIMEOUT);
  }

  function rpsResolve(code) {
    const room = rooms.get(code);
    const game = room && room.game;
    if (!game || game.kind !== 'rps') return;
    const picks = [...game.picks].filter(([id]) => room.members.has(id));
    const shown = picks.map(([id, pick]) => ({ id, name: room.members.get(id).name, pick }));
    if (picks.length < 2) return endGame(code, { text: 'Faltou gente para o jokenpô (precisa de 2).', picks: shown });
    const kinds = new Set(picks.map(([, p]) => p));
    if (kinds.size !== 2) return endGame(code, { text: 'Empate! Ninguém leva.', picks: shown });
    const [a, b] = [...kinds];
    const win = RPS_BEATS[a] === b ? a : b;
    const winners = picks.filter(([, p]) => p === win).map(([id]) => id);
    const names = winners.map((id) => room.members.get(id).name).join(', ');
    endGame(code, { text: `${names} venceu${winners.length > 1 ? 'ram' : ''} o jokenpô!`, picks: shown, winners });
  }

  function rpsProgress(code) {
    const room = rooms.get(code);
    const game = room && room.game;
    if (!game || game.kind !== 'rps') return;
    if (room.members.size >= 2 && game.picks.size >= room.members.size) return rpsResolve(code);
    io.to(code).emit('game', {
      id: game.id, kind: 'rps', phase: 'pick', by: game.by,
      picked: game.picks.size, players: room.members.size, remainingMs: Math.max(0, game.endsAt - Date.now()),
    });
  }

  function register(socket) {
    const reply = (ack) => (typeof ack === 'function' ? ack : () => {});
    const ctx = () => {
      const code = socket.data.room;
      const room = rooms.get(code);
      const me = room && room.members.get(socket.id);
      return me ? { code, room, me } : null;
    };

    // ---------- roleta da sala ----------
    socket.on('roulette-spin', (payload, ack) => {
      const done = reply(ack);
      const c = ctx();
      if (!c) return done({ ok: false, error: 'Você não está numa sala.' });
      const now = Date.now();
      if (now - (c.room.lastRoulette || 0) < ROULETTE_COOLDOWN) return done({ ok: false, error: 'A roleta ainda está girando. Espere um pouco.' });

      let options;
      let title;
      if (payload && payload.preset === 'members') {
        title = 'Quem é o escolhido?';
        options = [...c.room.members.values()].map((m) => m.name).slice(0, ROULETTE_MAX);
        if (options.length < ROULETTE_MIN) return done({ ok: false, error: 'Precisa de pelo menos 2 nakamas na sala.' });
      } else {
        title = cleanText(payload && payload.title).slice(0, 40) || 'Roleta';
        const raw = Array.isArray(payload && payload.options) ? payload.options.slice(0, ROULETTE_MAX + 1) : [];
        options = raw.map(cleanText).filter(Boolean);
        if (options.length < ROULETTE_MIN || options.length > ROULETTE_MAX) return done({ ok: false, error: `A roleta precisa de ${ROULETTE_MIN} a ${ROULETTE_MAX} opções.` });
        if (options.some((o) => o.length > ROULETTE_OPTION_MAX)) return done({ ok: false, error: `Cada opção pode ter até ${ROULETTE_OPTION_MAX} caracteres.` });
      }

      c.room.lastRoulette = now;
      const winner = Math.floor(Math.random() * options.length);
      done({ ok: true });
      io.to(c.code).emit('roulette', { title, options, winner, by: c.me.name, spinMs: ROULETTE_SPIN_MS });
      console.log(`[${c.code}] ${c.me.name} girou a roleta: ${title} → ${options[winner]}`);
    });

    // ---------- roleta diária (só com conta) ----------
    socket.on('daily-spin', (ack) => {
      const res = economy.dailySpin(socket.data.userId, ROULETTE_SPIN_MS);
      reply(ack)(res);
    });

    // ---------- mini games ----------
    socket.on('game-start', (kind, ack) => {
      const done = reply(ack);
      const c = ctx();
      if (!c) return done({ ok: false, error: 'Você não está numa sala.' });
      if (c.room.game) return done({ ok: false, error: 'Já tem um jogo rolando. Espere acabar.' });
      const now = Date.now();
      if (now - (c.room.lastGame || 0) < GAME_COOLDOWN) return done({ ok: false, error: 'Calma! Espere uns segundos.' });
      if (kind !== 'reflex' && kind !== 'rps') return done({ ok: false, error: 'Jogo desconhecido.' });

      c.room.lastGame = now;
      const id = ++gameSeq;
      const { code } = c;
      if (kind === 'reflex') {
        const wait = REFLEX_WAIT_MIN + Math.random() * (REFLEX_WAIT_MAX - REFLEX_WAIT_MIN);
        c.room.game = { id, kind, phase: 'wait', by: c.me.name, out: new Set(), timer: setTimeout(() => reflexGo(code, id), wait) };
        io.to(code).emit('game', { id, kind, phase: 'wait', by: c.me.name });
      } else {
        c.room.game = {
          id, kind, phase: 'pick', by: c.me.name, picks: new Map(), endsAt: now + RPS_PICK_MS,
          timer: setTimeout(() => rpsResolve(code), RPS_PICK_MS),
        };
        rpsProgress(code);
      }
      console.log(`[${code}] ${c.me.name} começou ${kind}`);
      done({ ok: true, id });
    });

    socket.on('game-act', (payload, ack) => {
      const done = reply(ack);
      const c = ctx();
      const game = c && c.room.game;
      if (!game || !payload || payload.id !== game.id) return done({ ok: false, error: 'Esse jogo já acabou.' });

      if (game.kind === 'reflex') {
        if (game.out.has(socket.id)) return done({ ok: false, error: 'Você queimou a largada.' });
        if (game.phase === 'wait') {
          game.out.add(socket.id);
          done({ ok: true, early: true });
          if ([...c.room.members.keys()].every((id) => game.out.has(id))) {
            endGame(c.code, { text: 'Todo mundo queimou a largada 🤦' });
          }
          return;
        }
        const ms = Date.now() - game.goAt;
        done({ ok: true });
        return endGame(c.code, { text: `${c.me.name} foi mais rápido: ${ms} ms ⚡`, winners: [socket.id] });
      }

      if (!Object.hasOwn(RPS_BEATS, payload.pick)) return done({ ok: false, error: 'Jogada inválida.' });
      if (game.picks.has(socket.id)) return done({ ok: false, error: 'Você já escolheu.' });
      game.picks.set(socket.id, payload.pick);
      done({ ok: true });
      rpsProgress(c.code);
    });

    // ---------- reações ----------
    socket.on('react', (emoji) => {
      const c = ctx();
      const now = Date.now();
      if (!c || !REACTIONS.has(emoji) || now - (socket.data.lastReact || 0) < REACTION_COOLDOWN) return;
      socket.data.lastReact = now;
      io.to(c.code).emit('react', { emoji, name: c.me.name });
    });
  }

  // Chamado pelo server.js depois que alguém sai da sala
  function onLeave(code, socketId) {
    const room = rooms.get(code);
    const game = room && room.game;
    if (!game) return;
    if (room.members.size === 0) {
      clearTimeout(game.timer);
      room.game = null;
      return;
    }
    if (game.kind === 'rps') {
      game.picks.delete(socketId);
      rpsProgress(code);
    } else if (game.phase === 'wait' && [...room.members.keys()].every((id) => game.out.has(id))) {
      endGame(code, { text: 'Todo mundo queimou a largada 🤦' });
    }
  }

  return { register, onLeave };
}

module.exports = { createGames };
