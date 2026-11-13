// Moedas, loja de pets e conquistas. Só contas logadas participam.

const store = require('./store');

const PETS = [
  { id: 'neko',    name: 'Neko-chan', icon: '🐱', price: 0 },
  { id: 'slime',   name: 'Slime',     icon: '💧', price: 10 },
  { id: 'kitsune', name: 'Kitsune',   icon: '🦊', price: 20 },
  { id: 'mecha',   name: 'Mini Mecha', icon: '🤖', price: 35 },
  { id: 'dragon',  name: 'Dragão',    icon: '🐉', price: 50 },
];
const DEFAULT_PET = PETS[0].id;

const ACHIEVEMENTS = [
  { key: 'first_room', name: 'Primeira missão', desc: 'Entrar numa sala pela primeira vez', icon: '🚀' },
  { key: 'votes_10',   name: 'Voz do povo',     desc: 'Votar 10 vezes',                     icon: '🗳' },
  { key: 'hour_1',     name: 'Maratonista',     desc: 'Acumular 1 hora em salas',           icon: '⏱' },
  { key: 'polls_5',    name: 'Democracia otaku', desc: 'Abrir 5 votações',                  icon: '📣' },
  { key: 'pet_buyer',  name: 'Domador',         desc: 'Comprar um pet',                     icon: '🐾' },
  { key: 'game_win',   name: 'Gamer',           desc: 'Vencer um mini game',                icon: '🎮' },
  { key: 'wins_10',    name: 'Imbatível',       desc: 'Vencer 10 mini games',               icon: '🏆' },
  { key: 'lucky',      name: 'Sortudo',         desc: 'Girar a roleta diária',              icon: '🎡' },
  { key: 'days_3',     name: 'Frequentador',    desc: 'Entrar em 3 dias diferentes',        icon: '📅' },
];

const COIN_EVERY_MS = Number(process.env.PRESENCE_COIN_MS) || 5 * 60 * 1000; // +1 a cada 5 min
const PRESENCE_TICK_MS = Math.min(15_000, COIN_EVERY_MS);
const VOTE_REWARD = 2;
const POLL_REWARD = 3;
const PAID_POLLS_PER_HOUR = 3;
const WIN_REWARD = 2;
const PAID_WINS_PER_HOUR = 6;
// Roleta diária: prêmio em moedas e peso (chance) de cada fatia
const DAILY_PRIZES = [
  { coins: 1, weight: 30 }, { coins: 5, weight: 15 }, { coins: 2, weight: 25 },
  { coins: 8, weight: 7 }, { coins: 3, weight: 20 }, { coins: 15, weight: 3 },
];

const today = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD no fuso do servidor

function createEconomy(io) {
  const userRoom = (uid) => `user:${uid}`;

  function profile(user) {
    return {
      name: user.name, email: user.email, coins: user.coins,
      pet: user.pet, pets: user.pets,
      achievements: user.achievements,
      dailyReady: user.lastDaily !== today(),
      stats: { wins: user.stats.wins || 0, votes: user.stats.votes, pollsOpened: user.stats.pollsOpened, roomSeconds: Math.floor(user.stats.roomSeconds), days: user.stats.days.length },
    };
  }

  function unlock(user, key) {
    if (user.achievements[key]) return;
    const a = ACHIEVEMENTS.find((x) => x.key === key);
    if (!a) return;
    user.achievements[key] = Date.now();
    store.save();
    io.to(userRoom(user.id)).emit('achievement', a);
  }

  function checkAchievements(user) {
    const s = user.stats;
    if (s.votes >= 10) unlock(user, 'votes_10');
    if (s.roomSeconds >= 3600) unlock(user, 'hour_1');
    if (s.pollsOpened >= 5) unlock(user, 'polls_5');
    if (s.days.length >= 3) unlock(user, 'days_3');
    if (s.wins >= 1) unlock(user, 'game_win');
    if (s.wins >= 10) unlock(user, 'wins_10');
  }

  function addCoins(user, amount, reason) {
    if (!amount) return;
    user.coins += amount;
    store.save();
    io.to(userRoom(user.id)).emit('coins-update', { coins: user.coins, delta: amount, reason });
  }

  return {
    PETS, ACHIEVEMENTS,
    profile,

    // Na conexão: liga o socket ao "canal" da conta para receber saldo/conquistas
    attach(socket) {
      const user = store.getUser(socket.data.userId);
      if (!user) return null;
      socket.join(userRoom(user.id));
      return user;
    },

    onEnterRoom(socket) {
      const user = store.getUser(socket.data.userId);
      if (!user) return;
      const d = today();
      if (!user.stats.days.includes(d)) {
        user.stats.days.push(d);
        if (user.stats.days.length > 60) user.stats.days.shift();
        store.save();
      }
      unlock(user, 'first_room');
      checkAchievements(user);
    },

    // poll.paidVoters evita pagar duas vezes a mesma conta (troca de voto, 2 abas)
    onVote(socket, poll) {
      const user = store.getUser(socket.data.userId);
      if (!user || poll.paidVoters.has(user.id)) return;
      poll.paidVoters.add(user.id);
      user.stats.votes++;
      addCoins(user, VOTE_REWARD, 'votou');
      checkAchievements(user);
    },

    onPollOpen(socket) {
      const user = store.getUser(socket.data.userId);
      if (!user) return;
      user.stats.pollsOpened++;
      const hourAgo = Date.now() - 3600_000;
      user.paidPolls = user.paidPolls.filter((t) => t > hourAgo);
      if (user.paidPolls.length < PAID_POLLS_PER_HOUR) {
        user.paidPolls.push(Date.now());
        addCoins(user, POLL_REWARD, 'abriu votação');
      } else {
        store.save();
      }
      checkAchievements(user);
    },

    // Vitória em mini game: conta sempre; moedas até PAID_WINS_PER_HOUR por hora
    onGameWin(socket) {
      const user = store.getUser(socket && socket.data.userId);
      if (!user) return;
      user.stats.wins = (user.stats.wins || 0) + 1;
      const hourAgo = Date.now() - 3600_000;
      user.paidWins = (user.paidWins || []).filter((t) => t > hourAgo);
      if (user.paidWins.length < PAID_WINS_PER_HOUR) {
        user.paidWins.push(Date.now());
        addCoins(user, WIN_REWARD, 'venceu o mini game');
      } else {
        store.save();
      }
      checkAchievements(user);
      io.to(userRoom(user.id)).emit('profile', profile(user));
    },

    // Uma vez por dia (fuso do servidor). As moedas entram quando a roleta para de girar.
    dailySpin(userId, spinMs) {
      const user = store.getUser(userId);
      if (!user) return { ok: false, error: 'Entre na sua conta para girar a roleta diária.' };
      if (user.lastDaily === today()) return { ok: false, error: 'Você já girou hoje. Volte amanhã! 🌙' };
      user.lastDaily = today();
      let roll = Math.random() * DAILY_PRIZES.reduce((s, p) => s + p.weight, 0);
      let winner = DAILY_PRIZES.findIndex((p) => (roll -= p.weight) < 0);
      if (winner < 0) winner = 0;
      // O saldo já fica salvo; só o aviso espera a roleta parar (não estraga a surpresa)
      const prize = DAILY_PRIZES[winner].coins;
      user.coins += prize;
      store.save();
      setTimeout(() => {
        io.to(userRoom(user.id)).emit('coins-update', { coins: user.coins, delta: prize, reason: 'roleta diária' });
        unlock(user, 'lucky');
        io.to(userRoom(user.id)).emit('profile', profile(user));
      }, spinMs);
      return { ok: true, winner, options: DAILY_PRIZES.map((p) => `🪙 ${p.coins}`), spinMs };
    },

    buy(userId, petId) {
      const user = store.getUser(userId);
      const pet = PETS.find((p) => p.id === petId);
      if (!user) return { ok: false, error: 'Entre na sua conta para usar a loja.' };
      if (!pet) return { ok: false, error: 'Pet não existe.' };
      if (user.pets.includes(pet.id)) return { ok: false, error: 'Você já tem esse pet.' };
      if (user.coins < pet.price) return { ok: false, error: `Faltam ${pet.price - user.coins} moedas.` };
      user.pets.push(pet.id);
      user.pet = pet.id;
      addCoins(user, -pet.price, `comprou ${pet.name}`);
      unlock(user, 'pet_buyer');
      return { ok: true, profile: profile(user) };
    },

    equip(userId, petId) {
      const user = store.getUser(userId);
      if (!user) return { ok: false, error: 'Entre na sua conta.' };
      if (!user.pets.includes(petId)) return { ok: false, error: 'Você ainda não tem esse pet.' };
      user.pet = petId;
      store.save();
      return { ok: true, profile: profile(user) };
    },

    // +1 moeda a cada 5 min em sala. Conta por CONTA (não por socket): 2 abas = 1 presença.
    startPresence(isInRoom) {
      const acc = new Map(); // userId -> ms acumulados para a próxima moeda
      setInterval(() => {
        const present = new Set();
        for (const s of io.sockets.sockets.values()) {
          if (s.data.userId && isInRoom(s)) present.add(s.data.userId);
        }
        for (const uid of present) {
          const user = store.getUser(uid);
          if (!user) continue;
          user.stats.roomSeconds += PRESENCE_TICK_MS / 1000;
          const total = (acc.get(uid) || 0) + PRESENCE_TICK_MS;
          const coins = Math.floor(total / COIN_EVERY_MS);
          acc.set(uid, total - coins * COIN_EVERY_MS);
          if (coins) addCoins(user, coins, 'tempo na sala');
          else store.save();
          checkAchievements(user);
        }
        for (const uid of acc.keys()) if (!present.has(uid)) acc.delete(uid);
      }, PRESENCE_TICK_MS).unref();
    },
  };
}

module.exports = { createEconomy, PETS, ACHIEVEMENTS, DEFAULT_PET };
