// Mascote: o bonequinho do Claude fazendo o "6 7" no canto da tela.
(function () {
  const el = document.createElement('button');
  el.className = 'mascot';
  el.type = 'button';
  el.title = 'Clique: SIX SEVEN!';
  el.setAttribute('aria-label', 'Mascote Claude fazendo 6 7');
  el.innerHTML = `
    <span class="mascot-bubble font-display">SIX SEVEN!</span>
    <svg viewBox="-4 -9 30 28" shape-rendering="crispEdges" aria-hidden="true">
      <g class="m-arm m-left">
        <text x="1.5" y="-2.5" class="m-num">6</text>
        <rect x="-1" y="2" width="5" height="1.6" class="m-hand"/>
        <rect x="1" y="3.6" width="2" height="3.4" class="m-skin"/>
      </g>
      <g class="m-arm m-right">
        <text x="20.5" y="-2.5" class="m-num">7</text>
        <rect x="18" y="2" width="5" height="1.6" class="m-hand"/>
        <rect x="19" y="3.6" width="2" height="3.4" class="m-skin"/>
      </g>
      <g class="m-body">
        <rect x="3" y="3" width="16" height="9" class="m-skin"/>
        <rect x="1" y="6" width="2" height="3" class="m-skin"/>
        <rect x="19" y="6" width="2" height="3" class="m-skin"/>
        <rect x="7" y="5.5" width="1.6" height="2.6" class="m-eye"/>
        <rect x="13.4" y="5.5" width="1.6" height="2.6" class="m-eye"/>
      </g>
      <g class="m-legs">
        <rect x="4.5" y="12" width="1.6" height="3" class="m-skin"/>
        <rect x="7.5" y="12" width="1.6" height="3" class="m-skin"/>
        <rect x="12.9" y="12" width="1.6" height="3" class="m-skin"/>
        <rect x="15.9" y="12" width="1.6" height="3" class="m-skin"/>
      </g>
    </svg>`;
  document.body.append(el);

  function hype() {
    el.classList.remove('hype');
    void el.offsetWidth; // reinicia a animação
    el.classList.add('hype');
  }
  el.addEventListener('animationend', (e) => {
    if (e.animationName === 'mascot-jump') el.classList.remove('hype');
  });

  // Na sala, room.js toca o som para todos; fora dela, toca só aqui.
  el.addEventListener('click', () => {
    if (typeof window.onMascotClick === 'function') return window.onMascotClick();
    import('/js/sfx.js').then((m) => m.play('sixseven'));
  });

  window.addEventListener('sfx-played', hype);
})();
