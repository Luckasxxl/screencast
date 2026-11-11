// Gatinhos pixel-art que atravessam a tela de vez em quando. Clique para fazer carinho.
(function () {
  const COATS = [
    { fur: '#f59e0b', dark: '#b45309' }, // laranja
    { fur: '#9ca3af', dark: '#4b5563' }, // cinza
    { fur: '#1f1b2e', dark: '#000000' }, // pretinho
    { fur: '#f5f0ff', dark: '#c4b5fd' }, // branco
    { fur: '#c084fc', dark: '#7e22ce' }, // roxo, claro
  ];

  const svg = (c) => `
    <svg viewBox="0 0 18 13" shape-rendering="crispEdges" aria-hidden="true">
      <rect class="k-tail" x="0" y="2" width="1.5" height="5" fill="${c.dark}"/>
      <rect x="1.5" y="5" width="10" height="5" fill="${c.fur}"/>
      <rect x="3" y="5" width="1.5" height="2" fill="${c.dark}"/>
      <rect x="6" y="5" width="1.5" height="2" fill="${c.dark}"/>
      <rect x="10" y="2" width="7" height="6" fill="${c.fur}"/>
      <rect x="10" y="0" width="2" height="2" fill="${c.fur}"/>
      <rect x="15" y="0" width="2" height="2" fill="${c.fur}"/>
      <rect x="10.6" y="0.7" width="0.8" height="1.3" fill="#f9a8d4"/>
      <rect x="15.6" y="0.7" width="0.8" height="1.3" fill="#f9a8d4"/>
      <rect x="12" y="4" width="1" height="1.4" fill="#a3e635"/>
      <rect x="15" y="4" width="1" height="1.4" fill="#a3e635"/>
      <rect x="13.6" y="5.8" width="0.8" height="0.6" fill="#f472b6"/>
      <rect class="k-leg k-a" x="2" y="10" width="1.3" height="2.5" fill="${c.dark}"/>
      <rect class="k-leg k-b" x="4.5" y="10" width="1.3" height="2.5" fill="${c.dark}"/>
      <rect class="k-leg k-b" x="8" y="10" width="1.3" height="2.5" fill="${c.dark}"/>
      <rect class="k-leg k-a" x="10.3" y="10" width="1.3" height="2.5" fill="${c.dark}"/>
    </svg>`;

  function spawn() {
    if (document.hidden || document.querySelectorAll('.kitten').length >= 3) return;
    const coat = COATS[Math.floor(Math.random() * COATS.length)];
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'kitten';
    k.title = 'Nya~';
    k.setAttribute('aria-label', 'Gatinho');
    k.innerHTML = `<span class="kitten-flip">${svg(coat)}</span>`;
    const size = 46 + Math.random() * 26;
    k.style.width = size + 'px';
    k.style.bottom = 4 + Math.random() * 40 + 'px';
    k.style.animationDuration = 12 + Math.random() * 10 + 's';
    if (Math.random() < 0.5) k.classList.add('rtl');

    k.addEventListener('click', () => {
      k.classList.add('petted');
      const heart = document.createElement('span');
      heart.className = 'kitten-heart';
      heart.textContent = '♥';
      k.append(heart);
      setTimeout(() => heart.remove(), 900);
      import('/js/sfx.js').then((m) => m.play('meow'));
    });
    k.addEventListener('animationend', (e) => {
      if (e.animationName.startsWith('kitten-walk')) k.remove();
    });
    document.body.append(k);
  }

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setTimeout(spawn, 2500);
  setInterval(() => Math.random() < 0.6 && spawn(), 9000);
  // Alguém tocou "Miau" ou "Nya~": aparece um gatinho
  window.addEventListener('sfx-played', (e) => {
    if (e.detail.id === 'meow' || e.detail.id === 'nya') spawn();
  });
})();
