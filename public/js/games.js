// Arcade da sala: roleta, roleta diária, mini games (reflexo e jokenpô) e reações.
//
// initGames(socket, container, { toast, sfx, isLogged, myId })
//   toast(text)  → aviso curto
//   sfx(id)      → toca um som da mesa (respeitando o mudo)
//   isLogged()   → true se a pessoa está numa conta (roleta diária)
//   myId()       → socket.id atual

const REACTIONS = ['😂', '🔥', '💜', '😱', '👏', '💀', '🍿', '😭'];
const WHEEL_COLORS = ['#7c3aed', '#d946ef', '#4c1d95', '#a855f7', '#be185d', '#6d28d9', '#c026d3', '#5b21b6', '#9333ea', '#86198f'];
const RPS = { r: { icon: '✊', name: 'Pedra' }, p: { icon: '✋', name: 'Papel' }, s: { icon: '✌️', name: 'Tesoura' } };
const OPTION_MAX = 24;
const OPTIONS_MAX = 10;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function initGames(socket, container, { toast = () => {}, sfx = () => {}, isLogged = () => false, myId = () => socket.id } = {}) {
  let overlay = null;     // { back, box, close, onKey }
  let closeTimer = null;
  let game = null;        // jogo em andamento: { id, kind, ... }

  // ---------- overlay ----------

  function openOverlay(title, { dismissable = true } = {}) {
    closeOverlay();
    const back = el('div', 'game-back');
    const box = el('div', 'panel game-box p-6 space-y-4 text-center');
    const x = el('button', 'tile-btn game-close', '✕');
    x.type = 'button';
    x.title = 'Fechar';
    box.append(x, el('p', 'font-display text-lg font-bold', title));
    back.append(box);
    document.body.append(back);
    const close = () => closeOverlay();
    x.addEventListener('click', close);
    if (dismissable) back.addEventListener('click', (e) => e.target === back && close());
    overlay = { back, box };
    return box;
  }

  function closeOverlay() {
    clearTimeout(closeTimer);
    if (!overlay) return;
    document.removeEventListener('keydown', overlay.onKey);
    overlay.back.remove();
    overlay = null;
  }

  const closeLater = (ms) => { clearTimeout(closeTimer); closeTimer = setTimeout(closeOverlay, ms); };

  // ---------- roleta ----------

  function drawWheel(canvas, options) {
    const size = canvas.width;
    const r = size / 2;
    const g = canvas.getContext('2d');
    const seg = (Math.PI * 2) / options.length;
    g.clearRect(0, 0, size, size);
    options.forEach((text, i) => {
      const a0 = -Math.PI / 2 + i * seg;
      g.beginPath();
      g.moveTo(r, r);
      g.arc(r, r, r - 4, a0, a0 + seg);
      g.closePath();
      g.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 2;
      g.stroke();
      // texto ao longo do raio
      g.save();
      g.translate(r, r);
      g.rotate(a0 + seg / 2);
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = `700 ${options.length > 6 ? 15 : 18}px Rajdhani, sans-serif`;
      const label = text.length > 16 ? `${text.slice(0, 15)}…` : text;
      g.fillText(label, r - 16, 0);
      g.restore();
    });
    g.beginPath();
    g.arc(r, r, 16, 0, Math.PI * 2);
    g.fillStyle = '#12051f';
    g.fill();
    g.strokeStyle = '#d946ef';
    g.lineWidth = 3;
    g.stroke();
  }

  function showWheel({ title, options, winner, spinMs, by, onDone }) {
    const box = openOverlay(title);
    if (by) box.append(el('p', 'label', `Girada por ${by}`));
    const wrap = el('div', 'wheel-wrap');
    const canvas = el('canvas', 'wheel');
    canvas.width = canvas.height = 360;
    drawWheel(canvas, options);
    wrap.append(canvas, el('div', 'wheel-pointer'));
    const result = el('p', 'wheel-result font-display font-black', '…');
    box.append(wrap, result);

    // A fatia vencedora para embaixo do ponteiro (topo), com um desvio para não parar sempre no meio
    const seg = 360 / options.length;
    const jitter = (Math.random() - 0.5) * seg * 0.7;
    const turns = 360 * 6 - (winner + 0.5) * seg + jitter;
    canvas.style.transition = `transform ${spinMs}ms cubic-bezier(.12,.72,.1,1)`;
    requestAnimationFrame(() => requestAnimationFrame(() => { canvas.style.transform = `rotate(${turns}deg)`; }));

    const mine = overlay;
    setTimeout(() => {
      if (overlay !== mine) return; // fechou ou abriu outra coisa
      result.textContent = options[winner];
      result.classList.add('show');
      sfx('kirakira');
      onDone && onDone();
      closeLater(6000);
    }, spinMs + 150);
  }

  socket.on('roulette', (r) => {
    showWheel({ ...r, onDone: () => toast(`🎡 ${r.title} → ${r.options[r.winner]}`) });
  });

  // ---------- reflexo ----------

  function act(payload, cb) {
    if (!game) return;
    socket.emit('game-act', { id: game.id, ...payload }, cb || (() => {}));
  }

  function showReflex(state) {
    if (state.phase === 'wait') {
      game = { id: state.id, kind: 'reflex', out: false };
      const box = openOverlay('⚡ Reflexo', { dismissable: false });
      box.append(el('p', 'label', `${state.by} desafiou a sala`));
      const pad = el('button', 'reflex-pad wait', 'ESPERE…');
      pad.type = 'button';
      const hint = el('p', 'text-sm text-violet-200/80', 'Quando ficar verde, clique (ou aperte espaço). Quem clicar antes, queima a largada.');
      box.append(pad, hint);
      const hit = () => {
        if (!game || game.id !== state.id || game.out) return;
        act({}, (r) => {
          if (r && r.early) {
            game.out = true;
            pad.className = 'reflex-pad out';
            pad.textContent = 'QUEIMOU! 🤦';
            sfx('sadtrombone');
          }
        });
      };
      pad.addEventListener('pointerdown', hit);
      overlay.onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); hit(); } };
      document.addEventListener('keydown', overlay.onKey);
      overlay.pad = pad;
    } else if (game && game.id === state.id && overlay && overlay.pad && !game.out) {
      overlay.pad.className = 'reflex-pad go';
      overlay.pad.textContent = 'AGORA!!';
    }
  }

  // ---------- jokenpô ----------

  function showRps(state) {
    if (!game || game.id !== state.id) {
      game = { id: state.id, kind: 'rps', pick: null };
      const box = openOverlay('✊ Jokenpô', { dismissable: false });
      box.append(el('p', 'label', `${state.by} desafiou a sala`));
      const row = el('div', 'grid grid-cols-3 gap-3');
      const status = el('p', 'text-sm text-violet-200/80');
      for (const [key, v] of Object.entries(RPS)) {
        const b = el('button', 'rps-btn');
        b.type = 'button';
        b.append(el('span', 'text-5xl', v.icon), el('span', 'label', v.name));
        b.addEventListener('click', () => {
          if (!game || game.pick) return;
          act({ pick: key }, (r) => {
            if (!r || !r.ok) return;
            game.pick = key;
            b.classList.add('mine');
            row.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          });
        });
        row.append(b);
      }
      box.append(row, status);
      overlay.status = status;
      const endsAt = Date.now() + state.remainingMs;
      const mine = overlay;
      const tick = setInterval(() => {
        if (overlay !== mine || !game || game.id !== state.id) return clearInterval(tick);
        mine.remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        renderRpsStatus();
      }, 250);
    }
    if (overlay) { overlay.picked = state.picked; overlay.players = state.players; renderRpsStatus(); }
  }

  function renderRpsStatus() {
    if (!overlay || !overlay.status) return;
    const left = overlay.remaining == null ? '' : ` · ${overlay.remaining}s`;
    overlay.status.textContent = `${overlay.picked ?? 0} de ${overlay.players ?? '?'} já escolheram${left}`;
  }

  // ---------- fim de jogo ----------

  socket.on('game', (state) => (state.kind === 'reflex' ? showReflex(state) : showRps(state)));

  socket.on('game-over', (res) => {
    game = null;
    const won = res.winners.some((w) => w.id === myId());
    const box = openOverlay(res.kind === 'reflex' ? '⚡ Reflexo' : '✊ Jokenpô');
    box.append(el('p', 'text-5xl', res.winners.length ? (won ? '🏆' : '😵') : '🤝'));
    box.append(el('p', 'font-display font-bold text-xl text-fuchsia-200', res.text));
    if (res.picks && res.picks.length) {
      const list = el('div', 'flex flex-wrap justify-center gap-2');
      for (const p of res.picks) {
        const chip = el('span', `rps-chip${res.winners.some((w) => w.id === p.id) ? ' win' : ''}`, `${RPS[p.pick].icon} ${p.name}`);
        list.append(chip);
      }
      box.append(list);
    }
    if (res.winners.length) sfx(won ? 'kirakira' : 'badumtss');
    toast(`🎮 ${res.text}`);
    closeLater(5500);
  });

  // ---------- reações ----------

  socket.on('react', ({ emoji, name }) => {
    const n = el('div', 'reaction');
    n.append(el('span', 'reaction-emoji', emoji), el('span', 'reaction-name', name));
    n.style.left = `${8 + Math.random() * 72}%`;
    n.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    document.body.append(n);
    n.addEventListener('animationend', () => n.remove());
  });

  // ---------- painel ----------

  container.innerHTML = '<p class="label">Arcade · ゲーム</p>';
  const err = el('p', 'text-sm text-rose-400 empty:hidden');
  const fail = (r) => { err.textContent = r && !r.ok ? r.error || 'Não deu certo.' : ''; };

  const reacts = el('div', 'grid grid-cols-8 gap-1');
  for (const emoji of REACTIONS) {
    const b = el('button', 'react-btn', emoji);
    b.type = 'button';
    b.title = 'Reagir';
    b.addEventListener('click', () => socket.emit('react', emoji));
    reacts.append(b);
  }

  const gamesRow = el('div', 'grid grid-cols-2 gap-2');
  const mkBtn = (label, cls, fn) => {
    const b = el('button', `btn btn-sm w-full ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', () => { err.textContent = ''; fn(); });
    return b;
  };
  gamesRow.append(
    mkBtn('⚡ Reflexo', 'btn-primary', () => socket.emit('game-start', 'reflex', fail)),
    mkBtn('✊ Jokenpô', 'btn-primary', () => socket.emit('game-start', 'rps', fail)),
  );

  // Roleta: opções livres (uma por linha) ou os nakamas da sala
  const form = el('form', 'space-y-2 hidden');
  const title = el('input', 'input-neon poll-input w-full px-3 py-2');
  title.placeholder = 'Pergunta (ex.: O que assistir?)';
  title.maxLength = 40;
  const opts = el('textarea', 'input-neon poll-input w-full px-3 py-2');
  opts.rows = 4;
  opts.placeholder = `Uma opção por linha (2 a ${OPTIONS_MAX})`;
  try { opts.value = localStorage.getItem('sc-roulette') || ''; } catch {}
  const spin = el('button', 'btn btn-primary btn-sm w-full', '🎡 Girar');
  form.append(title, opts, spin);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const options = opts.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (options.length < 2 || options.length > OPTIONS_MAX) return fail({ error: `A roleta precisa de 2 a ${OPTIONS_MAX} opções.` });
    if (options.some((o) => o.length > OPTION_MAX)) return fail({ error: `Cada opção pode ter até ${OPTION_MAX} caracteres.` });
    try { localStorage.setItem('sc-roulette', opts.value); } catch {}
    socket.emit('roulette-spin', { title: title.value, options }, fail);
  });

  const rouletteRow = el('div', 'grid grid-cols-2 gap-2');
  rouletteRow.append(
    mkBtn('🎡 Roleta', 'btn-ghost', () => { form.classList.toggle('hidden'); if (!form.classList.contains('hidden')) title.focus(); }),
    mkBtn('🎯 Sortear nakama', 'btn-ghost', () => socket.emit('roulette-spin', { preset: 'members' }, fail)),
  );

  const daily = mkBtn('🎁 Roleta diária (moedas)', 'btn-ghost', () => {
    if (!isLogged()) return fail({ error: 'Entre na sua conta para girar a roleta diária.' });
    socket.emit('daily-spin', (r) => {
      fail(r);
      if (r && r.ok) showWheel({ title: '🎁 Roleta diária', options: r.options, winner: r.winner, spinMs: r.spinMs });
    });
  });

  container.append(reacts, gamesRow, rouletteRow, form, daily, err,
    el('p', 'text-xs text-violet-300/60', 'Vencer mini game com 2+ na sala dá +2 🪙 (até 6 por hora).'));
}
