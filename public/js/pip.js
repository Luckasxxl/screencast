// Miniplayer: janelinha sempre por cima com a transmissão (para quem tem um monitor só).
// Chrome/Edge: Document Picture-in-Picture (janela com botões, redimensionável).
// Outros: Picture-in-Picture comum do <video>.

let current = null; // { win, tileEl, restore }

const PIP_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; background: #07020f; color: #ede4ff; font-family: system-ui, sans-serif; overflow: hidden; }
  .wrap { position: relative; width: 100%; height: 100%; }
  video { width: 100%; height: 100%; object-fit: contain; background: #000; display: block; }
  .bar {
    position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 6px; padding: 6px;
    background: linear-gradient(transparent, rgba(7, 2, 15, .9)); opacity: 0; transition: opacity .2s;
  }
  .wrap:hover .bar, .bar:focus-within { opacity: 1; }
  .name { flex: 1; min-width: 0; font-size: 12px; font-weight: 700; letter-spacing: .08em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 0 8px #a855f7; }
  button {
    width: 32px; height: 32px; display: grid; place-items: center; cursor: pointer; font-size: 15px;
    color: #fff; background: rgba(88, 28, 135, .6); border: 1px solid rgba(168, 85, 247, .6);
  }
  button:hover { background: rgba(168, 85, 247, .7); }
  .frame { position: absolute; inset: 0; pointer-events: none; border: 1px solid rgba(232, 121, 249, .5); box-shadow: inset 0 0 18px rgba(168, 85, 247, .35); }
`;

const isOpenFor = (tileEl) => current && current.tileEl === tileEl;

export function isMiniplayerOpen(tileEl) {
  return isOpenFor(tileEl) || (document.pictureInPictureElement && tileEl.contains(document.pictureInPictureElement));
}

export async function closeMiniplayer() {
  if (current) current.win.close(); // dispara pagehide → devolve o vídeo
  if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {});
}

export function closeMiniplayerFor(tileEl) {
  if (isMiniplayerOpen(tileEl)) closeMiniplayer();
}

async function openDocumentPip({ tileEl, video, label }) {
  const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  const width = 480;
  const win = await window.documentPictureInPicture.requestWindow({ width, height: Math.round(width / ratio) });
  const d = win.document;
  d.title = `${label} · screencast`;
  const style = d.createElement('style');
  style.textContent = PIP_CSS;
  d.head.append(style);

  // No lugar do vídeo, a página mostra um aviso com botão para trazer de volta
  const placeholder = document.createElement('div');
  placeholder.className = 'pip-placeholder';
  placeholder.innerHTML = '<span>📺</span><p>No miniplayer</p><button type="button" class="btn btn-ghost btn-sm">Trazer de volta</button>';
  placeholder.querySelector('button').addEventListener('click', () => win.close());
  video.replaceWith(placeholder);

  const wrap = d.createElement('div');
  wrap.className = 'wrap';
  const bar = d.createElement('div');
  bar.className = 'bar';
  const name = d.createElement('span');
  name.className = 'name';
  name.textContent = label;
  const sound = d.createElement('button');
  const back = d.createElement('button');
  back.textContent = '⤢';
  back.title = 'Voltar para a página';
  back.addEventListener('click', () => win.close());
  const syncSound = () => {
    sound.textContent = video.muted ? '🔇' : '🔊';
    sound.title = video.muted ? 'Ativar som' : 'Silenciar';
  };
  sound.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted) video.play().catch(() => {});
  });
  video.addEventListener('volumechange', syncSound);
  syncSound();
  bar.append(name, sound, back);
  const frame = d.createElement('div');
  frame.className = 'frame';
  wrap.append(video, frame, bar);
  d.body.append(wrap);
  video.play().catch(() => {});

  const restore = () => {
    video.removeEventListener('volumechange', syncSound);
    if (placeholder.isConnected) {
      placeholder.replaceWith(video);
      video.play().catch(() => {});
    }
    if (current && current.win === win) current = null;
  };
  win.addEventListener('pagehide', restore);
  current = { win, tileEl };
}

/** Abre (ou fecha, se já estiver aberto) o miniplayer de um tile. */
export async function toggleMiniplayer({ tileEl, video, label, toast = () => {} }) {
  if (isMiniplayerOpen(tileEl)) return closeMiniplayer();
  if (!video.srcObject) return toast('Ainda não tem imagem para o miniplayer.');
  await closeMiniplayer(); // só um miniplayer por vez

  if ('documentPictureInPicture' in window) {
    try {
      return await openDocumentPip({ tileEl, video, label });
    } catch (err) {
      console.warn('Document PiP falhou, tentando PiP comum', err);
    }
  }
  if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
    try {
      return await video.requestPictureInPicture();
    } catch (err) {
      console.warn('PiP falhou', err);
    }
  }
  toast('Seu navegador não tem miniplayer. No Firefox, passe o mouse no vídeo e use o botão de PiP dele.');
}
