// Painel de votação em tempo real. Reaproveitável: só precisa do socket e de um container.
//
// initPoll(socket, container, { isLive, toast, onSkipPassed })
//   isLive()        → true se esta pessoa está transmitindo (recebe o aviso do "pula essa cena")
//   toast(text)     → mostra um aviso curto
//   onSkipPassed()  → chamado no transmissor quando a sala vota para pular a cena

const TITLE_MAX = 60;
const OPTION_MAX = 40;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function initPoll(socket, container, { isLive = () => false, toast = () => {}, onSkipPassed = () => {} } = {}) {
  let poll = null;      // estado atual vindo do servidor
  let myVote = null;    // índice do meu voto na votação atual
  let endsAt = 0;       // relógio local (evita diferença de relógio com o servidor)
  let tick = null;
  let lastResult = null;
  let resultTimer = null;

  container.innerHTML = `
    <div class="flex items-center justify-between">
      <p class="label">Votação · 投票</p>
      <span class="poll-timer font-display text-sm text-fuchsia-300 tabular-nums"></span>
    </div>
    <div class="poll-body space-y-3"></div>`;
  const body = container.querySelector('.poll-body');
  const timerEl = container.querySelector('.poll-timer');

  // ---------- telas ----------

  function renderIdle(error = '') {
    stopTick();
    timerEl.textContent = '';
    delete body.dataset.pollId;
    body.replaceChildren();

    if (lastResult) body.append(resultView(lastResult));

    const skip = el('button', 'btn btn-danger w-full', '⏭ PULA ESSA CENA');
    skip.type = 'button';
    skip.addEventListener('click', () => create({ preset: 'skip' }));

    const toggle = el('button', 'btn btn-ghost btn-sm w-full', '＋ Nova votação');
    toggle.type = 'button';

    const form = buildForm();
    form.classList.add('hidden');
    toggle.addEventListener('click', () => {
      form.classList.toggle('hidden');
      if (!form.classList.contains('hidden')) form.querySelector('input').focus();
    });

    const err = el('p', 'text-sm text-rose-400 empty:hidden', error);
    body.append(skip, toggle, form, err);
  }

  function buildForm() {
    const form = el('form', 'space-y-2');
    const title = el('input', 'input-neon poll-input w-full px-3 py-2');
    title.maxLength = TITLE_MAX;
    title.placeholder = 'Pergunta (ex.: Qual anime agora?)';
    title.required = true;
    form.append(title);

    const opts = [];
    for (let i = 0; i < 4; i++) {
      const o = el('input', 'input-neon poll-input w-full px-3 py-1.5');
      o.maxLength = OPTION_MAX;
      o.placeholder = i < 2 ? `Opção ${i + 1}` : `Opção ${i + 1} (opcional)`;
      o.required = i < 2;
      opts.push(o);
      form.append(o);
    }

    const submit = el('button', 'btn btn-primary btn-sm w-full', 'Abrir votação');
    form.append(submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const options = opts.map((o) => o.value.trim()).filter(Boolean);
      if (options.length < 2) return toast('Nani?! Coloque pelo menos 2 opções.');
      create({ title: title.value.trim(), options });
    });
    return form;
  }

  // Monta a votação uma vez e depois só atualiza (assim as barras animam)
  function renderActive() {
    if (body.dataset.pollId !== String(poll.id)) {
      body.replaceChildren();
      body.dataset.pollId = poll.id;
      const head = el('div', 'space-y-1');
      head.append(
        el('p', 'font-display font-bold leading-snug break-words', poll.title),
        el('p', 'poll-meta text-xs text-violet-300/70'),
      );
      const bar = el('div', 'poll-countdown');
      bar.append(el('span'));
      body.append(head, bar);
      poll.options.forEach((text, i) => {
        const b = el('button', 'poll-option');
        b.type = 'button';
        b.append(el('span', 'poll-fill'), el('span', 'poll-label', text), el('span', 'poll-count'));
        b.addEventListener('click', () => vote(i));
        body.append(b);
      });
      startTick();
    }

    body.querySelector('.poll-meta').textContent =
      `por ${poll.by} · ${poll.total}/${poll.voters} votaram · dá pra trocar o voto`;
    body.querySelectorAll('.poll-option').forEach((b, i) => {
      const pct = poll.total ? Math.round((poll.counts[i] / poll.total) * 100) : 0;
      b.style.setProperty('--pct', pct + '%');
      b.classList.toggle('mine', myVote === i);
      b.querySelector('.poll-count').textContent = `${poll.counts[i]} · ${pct}%`;
    });
  }

  function resultView(r) {
    const box = el('div', 'poll-result space-y-2');
    const max = Math.max(...r.counts);
    let headline;
    if (r.kind === 'skip') headline = r.skipPassed ? '⏭ A sala votou: PULA ESSA CENA!' : '✋ A cena fica!';
    else if (!r.total) headline = 'Ninguém votou… yare yare.';
    else headline = 'Resultado';
    box.append(
      el('p', 'label text-fuchsia-300', headline),
      el('p', 'font-display font-bold text-sm break-words', r.title),
    );
    r.options.forEach((text, i) => {
      const pct = r.total ? Math.round((r.counts[i] / r.total) * 100) : 0;
      const row = el('div', `poll-option is-static${r.total && r.counts[i] === max ? ' winner' : ''}`);
      row.style.setProperty('--pct', pct + '%');
      row.append(el('span', 'poll-fill'), el('span', 'poll-label', text), el('span', 'poll-count', `${r.counts[i]} · ${pct}%`));
      box.append(row);
    });
    box.append(el('p', 'text-xs text-violet-300/60',
      r.reason === 'all-voted' ? 'Todo mundo votou.' : 'Tempo esgotado.'));
    return box;
  }

  // ---------- contagem regressiva ----------

  function startTick() {
    stopTick();
    const update = () => {
      const left = Math.max(0, endsAt - Date.now());
      timerEl.textContent = `${Math.ceil(left / 1000)}s`;
      const bar = body.querySelector('.poll-countdown > span');
      if (bar) bar.style.width = `${(left / 60000) * 100}%`;
    };
    update();
    tick = setInterval(update, 250);
  }
  function stopTick() { clearInterval(tick); tick = null; }

  // ---------- ações ----------

  function create(payload) {
    socket.emit('poll-create', payload, (res) => {
      if (!res || !res.ok) renderIdle(res ? res.error : 'Sem conexão.');
    });
  }

  function vote(option) {
    if (!poll) return;
    myVote = option; // otimista; o servidor confirma pelo poll-update
    renderActive();
    socket.emit('poll-vote', { id: poll.id, option }, (res) => {
      if (res && !res.ok) toast(res.error);
    });
  }

  // ---------- eventos do servidor ----------

  socket.on('poll-update', (state) => {
    const isNew = !poll || poll.id !== state.id;
    if (isNew) {
      myVote = null;
      clearTimeout(resultTimer);
      lastResult = null;
      toast(state.kind === 'skip' ? `⏭ ${state.by} pediu: PULA ESSA CENA?` : `🗳 ${state.by} abriu uma votação`);
    }
    poll = state;
    endsAt = Date.now() + state.remainingMs;
    renderActive();
  });

  socket.on('poll-closed', (result) => {
    poll = null;
    myVote = null;
    lastResult = result;
    renderIdle();
    // o resultado fica visível por 20s
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => { lastResult = null; if (!poll) renderIdle(); }, 20000);

    if (result.kind === 'skip' && result.skipPassed) {
      toast('⏭ A sala votou: PULA ESSA CENA!');
      if (isLive()) onSkipPassed(result);
    }
  });

  // Ao reconectar o servidor reenvia a votação ativa (se existir)
  socket.on('disconnect', () => {
    poll = null;
    myVote = null;
    renderIdle();
  });

  renderIdle();
}
