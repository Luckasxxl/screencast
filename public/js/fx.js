// Efeitos visuais: cenário de fundo + partículas subindo
(function () {
  const scene = document.createElement('div');
  scene.className = 'bg-scene';
  scene.innerHTML = '<div class="bg-sun"></div><div class="bg-grid"></div>';
  document.body.prepend(scene);

  const scan = document.createElement('div');
  scan.className = 'scanlines';
  document.body.append(scan);

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function spawn() {
    const s = document.createElement('span');
    s.className = 'spark';
    const size = 2 + Math.random() * 4;
    s.style.left = Math.random() * 100 + 'vw';
    s.style.width = s.style.height = size + 'px';
    s.style.setProperty('--drift', (Math.random() * 120 - 60) + 'px');
    s.style.animationDuration = 6 + Math.random() * 8 + 's';
    if (Math.random() < 0.3) s.style.background = '#67e8f9';
    document.body.append(s);
    s.addEventListener('animationend', () => s.remove());
  }
  for (let i = 0; i < 12; i++) setTimeout(spawn, Math.random() * 3000);
  setInterval(spawn, 500);
})();
