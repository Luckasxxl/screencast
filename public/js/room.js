import { createPeer, ROOM_RE } from './rtc.js';
import { SOUNDS, play, setVolume, unlock } from './sfx.js';
import { initPoll } from './poll.js';
import { initGames } from './games.js';
import { toggleMiniplayer, closeMiniplayerFor } from './pip.js';
import {
  getMe, getCatalog, petIcon, logout, openAuthModal, renderUserBar, bumpCoins, openProfile, achievementToast,
} from './account.js';

const $ = (id) => document.getElementById(id);
const ui = {
  dot: $('dot'), status: $('status'), room: $('room'), copy: $('copy'),
  share: $('share'), stop: $('stop'), myLive: $('my-live'), myViewers: $('my-viewers'),
  shareError: $('share-error'), grid: $('grid'), empty: $('empty'),
  name: $('name'), members: $('members'), memberCount: $('member-count'),
  sfx: $('sfx'), sfxMute: $('sfx-mute'), sfxVolume: $('sfx-volume'), toasts: $('toasts'),
  joinPanel: $('join-panel'), joinError: $('join-error'), code: $('code'), roomUi: $('room-ui'),
};

// ---------- estado ----------

const socket = io({ autoConnect: false });
let roomCode = null;
let targetCode = new URLSearchParams(location.search).get('room');
let localStream = null;
let localTile = null;
const outgoing = new Map(); // viewerId -> peer (eu transmito para ele)
const incoming = new Map(); // broadcasterId -> { peer, tile } (eu assisto)
const members = new Map();  // id -> { name, live }

// localStorage pode falhar (aba anônima etc.)
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const NICKS = ['Senpai', 'Piloto', 'Shinobi', 'Shinigami', 'Kouhai', 'Ronin', 'Mecha', 'Esper'];
let myName = store.get('sc-name', `${NICKS[Math.floor(Math.random() * NICKS.length)]}-${Math.floor(Math.random() * 90 + 10)}`);
let sfxMuted = store.get('sc-sfx-muted', '0') === '1';

// ---------- helpers de UI ----------

function setStatus(text, state = 'live') {
  ui.status.textContent = text;
  ui.dot.className = `dot ${state}`;
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  ui.toasts.append(t);
  setTimeout(() => t.remove(), 3200);
  while (ui.toasts.children.length > 4) ui.toasts.firstChild.remove();
}

const nameOf = (id) => (members.get(id) || {}).name || 'Alguém';

function renderMembers() {
  ui.members.replaceChildren(...[...members].map(([id, m]) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-2';
    const dot = document.createElement('span');
    dot.className = `dot ${m.live ? 'live' : 'idle'}`;
    const name = document.createElement('span');
    name.className = 'truncate';
    name.textContent = m.name + (id === socket.id ? ' (você)' : '');
    const pet = document.createElement('span');
    pet.className = 'pet-icon';
    const ghost = (m.ghostUntil || 0) > Date.now();
    pet.textContent = ghost ? '👻' : petIcon(catalog, m.pet);
    pet.title = ghost ? 'Nocauteado' : m.pet ? '' : 'Convidado';
    if (ghost) name.classList.add('ghost-name');
    li.append(dot, pet, name);
    if (id !== socket.id && !ghost) {
      const ko = document.createElement('button');
      ko.type = 'button';
      ko.className = 'ko-btn';
      ko.textContent = '💀';
      ko.title = `Dar K.O. em ${m.name}`;
      ko.setAttribute('aria-label', `Dar K.O. em ${m.name}`);
      ko.addEventListener('click', () => {
        unlock();
        socket.emit('ko', id, (r) => r && !r.ok && toast(r.error));
      });
      li.append(ko);
    }
    if (m.live) {
      const tag = document.createElement('span');
      tag.className = 'ml-auto label text-rose-300';
      tag.textContent = 'ao vivo';
      const ko = li.querySelector('.ko-btn');
      if (ko) ko.style.marginLeft = '0';
      li.insertBefore(tag, ko); // "ao vivo" antes do 💀
    }
    return li;
  }));
  ui.memberCount.textContent = members.size;
}

function updateLayout() {
  const n = ui.grid.children.length;
  ui.empty.classList.toggle('hidden', n > 0);
  ui.grid.classList.toggle('md:grid-cols-2', n > 1);
  ui.grid.classList.toggle('grid-cols-1', n <= 1);
  ui.myViewers.textContent = outgoing.size;
}

// ---------- tiles de vídeo ----------

function createTile(label, { local = false } = {}) {
  const tile = document.createElement('div');
  tile.className = 'tile panel p-2 bg-black';
  tile.innerHTML = `
    <div class="hud-frame">
      <span class="hud-corner tl"></span><span class="hud-corner tr"></span>
      <span class="hud-corner bl"></span><span class="hud-corner br"></span>
      <video autoplay muted playsinline></video>
      <div class="tile-overlay"><div class="sync-ring"></div><p class="font-display tracking-widest text-violet-200 text-sm"></p></div>
      <span class="tile-name"></span>
      <div class="tile-tools">
        ${local ? '' : '<button class="tile-btn" data-act="sound" title="Ativar som">🔇</button>'}
        <button class="tile-btn" data-act="pip" title="Miniplayer (janela sempre por cima)">⧉</button>
        <button class="tile-btn" data-act="fs" title="Tela cheia">⛶</button>
      </div>
    </div>`;
  const video = tile.querySelector('video');
  tile.querySelector('.tile-name').textContent = label;

  tile.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'sound') {
      video.muted = !video.muted;
      if (!video.muted) video.play().catch(() => {});
      e.target.textContent = video.muted ? '🔇' : '🔊';
      e.target.title = video.muted ? 'Ativar som' : 'Silenciar';
    } else if (act === 'fs') {
      if (document.fullscreenElement) document.exitFullscreen();
      else (tile.requestFullscreen?.() ?? video.webkitEnterFullscreen?.());
    } else if (act === 'pip') {
      toggleMiniplayer({ tileEl: tile, video, label: tile.querySelector('.tile-name').textContent, toast });
    }
  });

  const soundBtn = tile.querySelector('[data-act="sound"]');
  const syncSoundBtn = () => {
    if (!soundBtn) return;
    soundBtn.textContent = video.muted ? '🔇' : '🔊';
    soundBtn.title = video.muted ? 'Ativar som' : 'Silenciar';
  };
  video.addEventListener('volumechange', syncSoundBtn); // som mudado pelo miniplayer

  // Tenta tocar com som; se o navegador bloquear (autoplay), volta para mudo
  async function tryUnmute() {
    video.muted = false;
    try { await video.play(); } catch { video.muted = true; video.play().catch(() => {}); }
    syncSoundBtn();
  }

  ui.grid.append(tile);
  updateLayout();
  return { el: tile, video, tryUnmute, setLabel: (t) => (tile.querySelector('.tile-name').textContent = t) };
}

function setOverlay(tile, text, spinner = true) {
  const ov = tile.el.querySelector('.tile-overlay');
  ov.classList.toggle('hidden', !text);
  ov.querySelector('.sync-ring').classList.toggle('hidden', !spinner);
  if (text) ov.querySelector('p').textContent = text;
}

function removeTile(tile) {
  if (!tile) return;
  closeMiniplayerFor(tile.el); // transmissão acabou: fecha o miniplayer dela
  tile.el.remove();
  updateLayout();
}

// ---------- conexões ----------

function closeOutgoing(viewerId) {
  outgoing.get(viewerId)?.close();
  outgoing.delete(viewerId);
  updateLayout();
}

function closeIncoming(id, { keepTile = false } = {}) {
  const entry = incoming.get(id);
  if (!entry) return;
  entry.peer?.close();
  entry.peer = null;
  if (!keepTile) {
    removeTile(entry.tile);
    incoming.delete(id);
  }
}

function resetConnections() {
  for (const id of [...outgoing.keys()]) closeOutgoing(id);
  for (const id of [...incoming.keys()]) closeIncoming(id);
}

// ---------- transmitir ----------

function friendlyCaptureError(err) {
  switch (err && err.name) {
    case 'NotAllowedError': return 'Permissão negada! Clique de novo em "Transmitir minha tela" e autorize.';
    case 'NotFoundError': return 'Nenhuma fonte de captura encontrada.';
    case 'NotReadableError': return 'Não foi possível ler a tela (outro app pode estar bloqueando).';
    case 'NotSupportedError':
    case 'TypeError': return 'Seu navegador não suporta captura de tela. Use Chrome, Edge ou Firefox no computador.';
    default: return `Nani?! Erro ao capturar a tela: ${err && err.message ? err.message : err}`;
  }
}

// ---------- fonte de áudio ----------
// 'app'    = só o áudio da aba/janela escolhida (nunca o sistema inteiro → sem eco do Discord)
// 'system' = todo o som do PC
// 'none'   = sem áudio
// 'dev:ID' = microfone ou cabo virtual (ex.: VB-Cable com o áudio de um app específico)

const audioSrc = $('audio-src');

async function fillAudioSources(selectValue) {
  let inputs = [];
  try {
    inputs = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId && !['default', 'communications'].includes(d.deviceId));
  } catch {}
  const opts = [
    ['app', '🪟 Só a aba / janela'],
    ['system', '🔊 Sistema inteiro (eco!)'],
    ['none', '🔇 Sem áudio'],
    ...inputs.map((d, i) => [`dev:${d.deviceId}`, `🎤 ${d.label || `Entrada de áudio ${i + 1}`}`]),
  ];
  // Sem permissão de microfone o navegador esconde os dispositivos
  if (!inputs.some((d) => d.label)) opts.push(['ask', '🎤 Listar microfones / cabos…']);

  audioSrc.replaceChildren(...opts.map(([value, text]) => new Option(text, value)));
  const want = selectValue || store.get('sc-audio-src', 'app');
  audioSrc.value = opts.some(([v]) => v === want) ? want : 'app';
}

audioSrc.addEventListener('change', async () => {
  if (audioSrc.value === 'ask') {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      await fillAudioSources();
      const firstDev = [...audioSrc.options].find((o) => o.value.startsWith('dev:'));
      audioSrc.value = firstDev ? firstDev.value : 'app';
    } catch {
      ui.shareError.textContent = 'Sem permissão para ver os dispositivos de áudio.';
      audioSrc.value = 'app';
    }
  }
  store.set('sc-audio-src', audioSrc.value);
});
navigator.mediaDevices?.addEventListener?.('devicechange', () => fillAudioSources(audioSrc.value));
$('audio-help-btn').addEventListener('click', () => $('audio-help').classList.toggle('hidden'));
fillAudioSources();

function displayMediaOptions(mode) {
  const opts = { video: { frameRate: { ideal: 30 } } };
  if (mode !== 'app' && mode !== 'system') return { ...opts, audio: false };
  return {
    ...opts,
    // restrictOwnAudio: não captura os sons desta própria página (mesa de sons, telas dos amigos)
    audio: { suppressLocalAudioPlayback: false, restrictOwnAudio: true },
    systemAudio: mode === 'system' ? 'include' : 'exclude',
    windowAudio: mode === 'system' ? 'system' : 'window', // Chrome recente: áudio só da janela escolhida
  };
}

async function captureDeviceAudio(deviceId) {
  const s = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      // Desliga o processamento de voz para música/jogo soarem naturais
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2,
    },
  });
  return s.getAudioTracks()[0];
}

async function startShare() {
  ui.shareError.textContent = '';
  if (!navigator.mediaDevices?.getDisplayMedia) {
    ui.shareError.textContent = 'Captura de tela indisponível aqui. Use HTTPS num navegador de computador (celular só assiste).';
    return;
  }
  const mode = audioSrc.value;
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions(mode));
  } catch (err) {
    ui.shareError.textContent = friendlyCaptureError(err);
    return;
  }

  if (mode.startsWith('dev:')) {
    try {
      localStream.addTrack(await captureDeviceAudio(mode.slice(4)));
    } catch (err) {
      ui.shareError.textContent = `Não consegui abrir o dispositivo de áudio (${err.name}). Transmitindo sem áudio.`;
    }
  } else if (mode === 'app' && !localStream.getAudioTracks().length) {
    ui.shareError.textContent =
      'Transmitindo sem áudio: para levar som, escolha uma aba do Chrome (marcando "compartilhar áudio da aba") ou use um dispositivo de entrada (veja o "?").';
  }

  // Usuário clicou em "Parar compartilhamento" na barra do navegador
  localStream.getVideoTracks()[0].onended = stopShare;

  const audioTrack = localStream.getAudioTracks()[0];
  const audioLabel = !audioTrack ? 'sem áudio'
    : mode === 'system' ? 'áudio do sistema'
    : mode.startsWith('dev:') ? `áudio: ${audioTrack.label || 'entrada'}`
    : 'áudio da aba/janela';
  localTile = createTile(`Você · ${audioLabel}`, { local: true });
  localTile.video.srcObject = localStream;
  setOverlay(localTile, null);
  ui.grid.prepend(localTile.el);

  ui.share.classList.add('hidden');
  $('audio-pick').classList.add('hidden');
  ui.stop.classList.remove('hidden');
  ui.myLive.classList.remove('hidden');
  socket.emit('start-broadcast');
}

function stopShare() {
  if (!localStream) return;
  socket.emit('host-left');
  for (const id of [...outgoing.keys()]) closeOutgoing(id);
  localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  removeTile(localTile);
  localTile = null;
  ui.share.classList.remove('hidden');
  $('audio-pick').classList.remove('hidden');
  ui.stop.classList.add('hidden');
  ui.myLive.classList.add('hidden');
}

// ---------- sinalização ----------

socket.on('connect', () => {
  const code = roomCode || targetCode;
  const ack = (res) => onJoined(res);
  if (code) socket.emit('join-room', { room: code, name: myName }, ack);
  else socket.emit('create-room', { name: myName }, ack);
});

function onJoined(res) {
  if (!res.ok) {
    socket.disconnect();
    roomCode = null;
    if (localStream) stopShare();
    return showJoin(res.error);
  }
  roomCode = res.room;
  history.replaceState(null, '', `?room=${roomCode}`);
  document.title = `${roomCode} · screencast`;
  ui.room.textContent = roomCode;
  ui.joinPanel.classList.add('hidden');
  ui.roomUi.classList.remove('hidden');
  members.clear();
  res.members.forEach((m) => members.set(m.id, { name: m.name, live: m.live, pet: m.pet }));
  renderMembers();
  setStatus('Na sala', 'live');
  if (localStream) socket.emit('start-broadcast'); // voltou após queda de conexão
}

socket.on('disconnect', (reason) => {
  resetConnections();
  if (reason === 'io client disconnect') return;
  setStatus('Reconectando…', 'connecting');
});

socket.on('connect_error', () => setStatus('Sem conexão com o servidor', 'failed'));

// Alguém (novo ou antigo) precisa receber minha tela
socket.on('viewer-joined', async ({ viewerId }) => {
  if (!localStream) return;
  closeOutgoing(viewerId);
  const peer = createPeer(socket, viewerId, 'out');
  outgoing.set(viewerId, peer);
  updateLayout();
  localStream.getTracks().forEach((track) => peer.pc.addTrack(track, localStream));
  peer.pc.onconnectionstatechange = () => {
    if (peer.pc.connectionState === 'failed') closeOutgoing(viewerId);
  };
  try {
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    socket.emit('offer', { to: viewerId, sdp: peer.pc.localDescription });
  } catch (err) {
    console.error('Falha ao criar offer', err);
    closeOutgoing(viewerId);
  }
});

// Alguém está me mandando a tela dele
socket.on('offer', async ({ from, sdp }) => {
  closeIncoming(from, { keepTile: true });
  let entry = incoming.get(from);
  if (!entry) {
    entry = { peer: null, tile: createTile(nameOf(from)) };
    incoming.set(from, entry);
  }
  const { tile } = entry;
  setOverlay(tile, 'Sincronizando… taxa de sincronia subindo');

  const peer = createPeer(socket, from, 'in');
  entry.peer = peer;
  peer.pc.ontrack = ({ streams }) => {
    if (tile.video.srcObject !== streams[0]) tile.video.srcObject = streams[0];
    if (streams[0].getAudioTracks().length) tile.tryUnmute();
  };
  peer.pc.onconnectionstatechange = () => {
    const s = peer.pc.connectionState;
    if (s === 'connected') setOverlay(tile, null);
    else if (s === 'disconnected') setOverlay(tile, 'Reconectando… não desista, piloto!');
    else if (s === 'failed') setOverlay(tile, 'Nani?! Não foi possível conectar (a rede pode exigir um servidor TURN).', false);
  };

  try {
    await peer.setRemote(sdp);
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    socket.emit('answer', { to: from, sdp: peer.pc.localDescription });
  } catch (err) {
    console.error('Falha ao responder offer', err);
    setOverlay(tile, 'Erro ao negociar a conexão.', false);
  }
});

socket.on('answer', ({ from, sdp }) => {
  outgoing.get(from)?.setRemote(sdp).catch((err) => console.error('answer inválida', err));
});

// side = ponta de quem enviou: 'out' veio de um transmissor, 'in' de um espectador
socket.on('ice-candidate', ({ from, candidate, side }) => {
  if (side === 'out') incoming.get(from)?.peer?.addCandidate(candidate);
  else outgoing.get(from)?.addCandidate(candidate);
});

socket.on('host-left', ({ id }) => {
  if (incoming.has(id)) toast(`${nameOf(id)} parou de transmitir. Yare yare daze…`);
  closeIncoming(id);
  if (members.has(id)) members.get(id).live = false;
  renderMembers();
});

socket.on('viewer-left', ({ viewerId }) => closeOutgoing(viewerId));

socket.on('member-joined', ({ id, name, live, pet }) => {
  members.set(id, { name, live, pet });
  renderMembers();
  toast(`${name} entrou na sala ✦`);
});

socket.on('member-left', ({ id, name }) => {
  closeIncoming(id);
  closeOutgoing(id);
  members.delete(id);
  renderMembers();
  toast(`${name} saiu da sala`);
});

socket.on('member-updated', ({ id, name, live, pet }) => {
  const before = members.get(id);
  if (live && before && !before.live && id !== socket.id) toast(`🔴 ${name} começou a transmitir!`);
  members.set(id, { name, live, pet });
  incoming.get(id)?.tile.setLabel(name);
  renderMembers();
});

socket.on('sfx', ({ id, name }) => {
  const s = SOUNDS.find((x) => x.id === id);
  if (!s) return;
  if (!sfxMuted) play(id);
  toast(`${name}: ${s.emoji} ${s.label}`);
});

// ---------- K.O. (humor) ----------

socket.on('ko', ({ target, text, sfx, ghostMs }) => {
  const m = members.get(target);
  if (m) {
    m.ghostUntil = Date.now() + ghostMs;
    setTimeout(renderMembers, ghostMs + 50); // volta à vida (isekai reverso)
  }
  renderMembers();

  const isMe = target === socket.id;
  const box = document.createElement('div');
  box.className = 'ko-alert';
  box.innerHTML = '<div><b>K.O.</b><span></span><small></small></div>';
  box.querySelector('span').textContent = text;
  box.querySelector('small').textContent = isMe ? 'VOCÊ FOI DE BASE 💀 · volta em 30s' : '💀 · 30s de fantasma';
  document.body.append(box);
  box.addEventListener('animationend', (e) => e.target === box && box.remove());

  if (isMe) {
    document.body.classList.remove('ko-me');
    void document.body.offsetWidth;
    document.body.classList.add('ko-me');
    setTimeout(() => document.body.classList.remove('ko-me'), 3200);
  }
  if (!sfxMuted) play(sfx);
});

// ---------- mesa de sons ----------

function sendSfx(id) {
  unlock();
  if (socket.connected && roomCode) socket.emit('sfx', id);
  else play(id);
}
window.onMascotClick = () => sendSfx('sixseven');

for (const s of SOUNDS) {
  const b = document.createElement('button');
  b.className = 'sfx-btn';
  b.innerHTML = '<span></span><span></span>';
  b.children[0].textContent = s.emoji;
  b.children[1].textContent = s.label;
  b.addEventListener('click', () => sendSfx(s.id));
  ui.sfx.append(b);
}

const vol = Number(store.get('sc-sfx-vol', '0.7'));
ui.sfxVolume.value = vol;
setVolume(vol);
ui.sfxVolume.addEventListener('input', () => {
  setVolume(Number(ui.sfxVolume.value));
  store.set('sc-sfx-vol', ui.sfxVolume.value);
});

function renderMute() {
  ui.sfxMute.textContent = sfxMuted ? '🔇' : '🔊';
  ui.sfxMute.title = sfxMuted ? 'Ativar sons' : 'Silenciar sons';
}
ui.sfxMute.addEventListener('click', () => {
  sfxMuted = !sfxMuted;
  store.set('sc-sfx-muted', sfxMuted ? '1' : '0');
  renderMute();
});
renderMute();

// ---------- votação ----------

function showSkipAlert(result) {
  const yes = result.counts[0];
  const box = document.createElement('div');
  box.className = 'skip-alert';
  box.innerHTML = '<div>⏭ PULA ESSA CENA!<small></small></div>';
  box.querySelector('small').textContent = `${yes} de ${result.total} votaram sim`;
  document.body.append(box);
  box.addEventListener('animationend', (e) => e.target === box && box.remove());
  play('airhorn');
}

initPoll(socket, $('poll'), {
  isLive: () => !!localStream,
  toast,
  onSkipPassed: showSkipAlert,
});

// ---------- arcade: roleta, mini games e reações ----------

initGames(socket, $('games'), {
  toast,
  sfx: (id) => { if (!sfxMuted) play(id); },
  isLogged: () => !!me,
  myId: () => socket.id,
});

// ---------- resto da UI ----------

ui.name.value = myName;
ui.name.addEventListener('change', () => {
  myName = ui.name.value.trim().slice(0, 16) || myName;
  ui.name.value = myName;
  if (!me) store.set('sc-name', myName); // logado: o servidor salva na conta
  socket.emit('set-name', myName);
});

// ---------- conta (opcional) ----------

let me = null;
let catalog = null;
let profilePanel = null;
const accountBar = $('account');

function renderAccount() {
  renderUserBar(accountBar, me, {
    catalog,
    onLogin: () => openAuthModal({ onAuth: () => location.reload(), guestLabel: 'Continuar como convidado' }),
    onLogout: async () => { await logout(); location.reload(); },
    onProfile: () => {
      profilePanel = openProfile({ socket, me, catalog, onChange: () => renderAccount() });
    },
  });
}

socket.on('profile', (p) => {
  me = { ...(me || {}), ...p };
  myName = me.name;
  ui.name.value = myName;
  renderAccount();
  if (profilePanel && document.body.contains(document.querySelector('.modal-back'))) profilePanel.refresh(me);
});

socket.on('coins-update', ({ coins, delta, reason }) => {
  if (!me) return;
  me.coins = coins;
  bumpCoins(accountBar, coins);
  if (delta > 0) toast(`+${delta} 🪙 ${reason}`);
  if (profilePanel && document.querySelector('.modal-back')) profilePanel.refresh(me);
});

socket.on('achievement', (a) => {
  achievementToast(a);
  if (me) me.achievements = { ...me.achievements, [a.key]: Date.now() };
});

ui.share.addEventListener('click', startShare);
ui.stop.addEventListener('click', stopShare);

ui.copy.addEventListener('click', async () => {
  if (!roomCode) return;
  const link = `${location.origin}/room.html?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
    ui.copy.textContent = 'Link copiado! ✦';
  } catch {
    prompt('Copie o link:', link);
  }
  setTimeout(() => (ui.copy.textContent = 'Copiar link'), 1500);
});

function showJoin(error = '') {
  ui.roomUi.classList.add('hidden');
  ui.joinPanel.classList.remove('hidden');
  ui.joinError.textContent = error;
  setStatus('Fora da sala', 'idle');
  ui.code.focus();
}

ui.code.addEventListener('input', () => (ui.code.value = ui.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
$('join').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = ui.code.value.trim().toUpperCase();
  if (!ROOM_RE.test(code)) return showJoin('Nani?! O código tem 4 caracteres.');
  targetCode = code;
  setStatus('Conectando…', 'connecting');
  socket.connect();
});

// Qualquer clique destrava o áudio (autoplay)
document.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('beforeunload', () => socket.emit('leave-room'));

// ---------- início ----------

(async () => {
  // Carrega conta e catálogo antes de conectar (o socket usa o cookie da sessão)
  [me, catalog] = await Promise.all([getMe(), getCatalog()]);
  if (me) {
    myName = me.name;
    ui.name.value = myName;
  }
  renderAccount();
  if (targetCode && !ROOM_RE.test(targetCode.toUpperCase())) showJoin('Nani?! Esse código de sala não é válido.');
  else socket.connect();
})();
