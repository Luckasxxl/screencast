// Mesa de sons: tudo sintetizado na hora (Web Audio + voz do navegador), sem arquivos.

export const SOUNDS = [
  { id: 'airhorn',     emoji: '📯', label: 'Air horn' },
  { id: 'vineboom',    emoji: '💥', label: 'Vine boom' },
  { id: 'sadtrombone', emoji: '🎺', label: 'Trombone triste' },
  { id: 'badumtss',    emoji: '🥁', label: 'Ba dum tss' },
  { id: 'crickets',    emoji: '🦗', label: 'Grilos' },
  { id: 'kirakira',    emoji: '✨', label: 'Kira kira' },
  { id: 'nani',        emoji: '😱', label: 'NANI?!' },
  { id: 'omae',        emoji: '👉', label: 'Omae wa…' },
  { id: 'sugoi',       emoji: '🤩', label: 'Sugoi!' },
  { id: 'yamete',      emoji: '🙅', label: 'Yamete!' },
  { id: 'kawaii',      emoji: '🌸', label: 'Kawaii' },
  { id: 'dattebayo',   emoji: '🍥', label: 'Dattebayo' },
  { id: 'sixseven',    emoji: '🤲', label: '6 7' },
  { id: 'meow',        emoji: '🐱', label: 'Miau' },
  { id: 'nya',         emoji: '😺', label: 'Nya~' },
];

let ctx = null;
let master = null;
let volume = 0.7;

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

// Chamar num clique para destravar o áudio (política de autoplay)
export function unlock() { audio(); }

// ---------- blocos básicos ----------

function osc(type, freq, start, dur, { gain = 0.3, to = null, attack = 0.01, dest = master } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (to) o.frequency.exponentialRampToValueAtTime(to, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(dest);
  o.start(start);
  o.stop(start + dur + 0.05);
  return o;
}

function noise(start, dur, { gain = 0.3, type = 'highpass', freq = 6000 } = {}) {
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(master);
  src.start(start);
}

// ---------- efeitos ----------

const synth = {
  airhorn(t) {
    const blasts = [[0, 0.16], [0.2, 0.16], [0.4, 0.75]];
    for (const [off, dur] of blasts) {
      for (const f of [466, 470, 587, 698]) osc('sawtooth', f, t + off, dur, { gain: 0.09, attack: 0.02 });
    }
  },
  vineboom(t) {
    osc('sine', 150, t, 1.4, { gain: 0.9, to: 38, attack: 0.005 });
    osc('triangle', 90, t, 0.9, { gain: 0.4, to: 30, attack: 0.005 });
    noise(t, 0.15, { gain: 0.4, type: 'lowpass', freq: 400 });
  },
  sadtrombone(t) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(master);
    const notes = [[392, 0, 0.45], [370, 0.5, 0.45], [349, 1.0, 0.45], [330, 1.5, 1.3]];
    notes.forEach(([f, off, dur], i) => {
      const o = osc('sawtooth', f, t + off, dur, { gain: 0.22, attack: 0.05, dest: lp });
      if (i === 3) { // vibrato no "waaah" final
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 6;
        depth.gain.value = 9;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t + off);
        lfo.stop(t + off + dur);
      }
    });
  },
  badumtss(t) {
    osc('sine', 220, t, 0.18, { gain: 0.7, to: 110, attack: 0.003 });
    osc('sine', 170, t + 0.2, 0.22, { gain: 0.7, to: 80, attack: 0.003 });
    noise(t + 0.45, 1.1, { gain: 0.35, freq: 7000 });
  },
  crickets(t) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) osc('sine', 4600, t + i * 0.32 + j * 0.045, 0.035, { gain: 0.08, attack: 0.004 });
    }
  },
  meow(t) {
    // "mi-AU": sobe e desce o tom, com um leve filtro nasal
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.2;
    bp.connect(master);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(480, t + 0.55);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.06);
    g.gain.setValueAtTime(0.35, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(bp);
    o.start(t);
    o.stop(t + 0.65);
  },
  kirakira(t) {
    [1319, 1568, 2093, 2637, 3136, 4186].forEach((f, i) =>
      osc('sine', f, t + i * 0.06, 0.5, { gain: 0.15, attack: 0.005 }));
    osc('triangle', 5274, t + 0.4, 0.6, { gain: 0.06 });
  },
};

// ---------- vozes ----------

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === lang) || voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}

function say(text, { lang = 'ja-JP', rate = 1, pitch = 1 } = {}) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  u.pitch = pitch;
  u.volume = Math.min(1, volume);
  const v = voiceFor(lang);
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

const voice = {
  nani() { synth.vineboom(ctx.currentTime); say('なに！？', { pitch: 1.6, rate: 1.1 }); },
  omae() {
    say('お前はもう死んでいる', { pitch: 0.6, rate: 0.85 });
    say('なに！？', { pitch: 1.9, rate: 1.2 });
  },
  sugoi() { synth.kirakira(ctx.currentTime); say('すごーい！', { pitch: 1.5 }); },
  yamete() { say('やめてください！', { pitch: 1.7, rate: 1.1 }); },
  kawaii() { synth.kirakira(ctx.currentTime); say('かわいい〜', { pitch: 1.9, rate: 0.9 }); },
  dattebayo() { say('だってばよ！', { pitch: 1.3, rate: 1.1 }); },
  nya() { synth.meow(ctx.currentTime); say('にゃ〜', { pitch: 2, rate: 0.9 }); },
  sixseven() {
    osc('square', 600, ctx.currentTime, 0.12, { gain: 0.08 });
    osc('square', 700, ctx.currentTime + 0.25, 0.12, { gain: 0.08 });
    say('six... seven!', { lang: 'en-US', pitch: 1.2, rate: 0.9 });
  },
};

export function play(id) {
  audio();
  if (synth[id]) synth[id](ctx.currentTime + 0.02);
  else if (voice[id]) voice[id]();
  window.dispatchEvent(new CustomEvent('sfx-played', { detail: { id } }));
}

// Carrega a lista de vozes cedo (Chrome popula de forma assíncrona)
if ('speechSynthesis' in window) speechSynthesis.getVoices();
