// Contas no frontend: modal de login/cadastro, barra do usuário e painel Perfil/Loja.

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

async function api(method, path, body) {
  try {
    const r = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, ...json };
  } catch {
    return { ok: false, error: 'Sem conexão com o servidor.' };
  }
}

export async function getMe() {
  const r = await api('GET', '/api/me');
  return r.ok ? r.user : null;
}

let catalogCache = null;
export async function getCatalog() {
  if (!catalogCache) {
    const r = await api('GET', '/api/catalog');
    catalogCache = { pets: r.pets || [], achievements: r.achievements || [] };
  }
  return catalogCache;
}

export const petIcon = (catalog, id) => (catalog && catalog.pets.find((p) => p.id === id) || {}).icon || '';

export async function logout() {
  await api('POST', '/api/logout');
}

// ---------- modal genérico ----------

function modal(titleText) {
  const back = el('div', 'modal-back');
  const box = el('div', 'panel modal-box p-6 sm:p-8 space-y-5');
  const head = el('div', 'flex items-start justify-between gap-4');
  head.append(el('h2', 'font-display text-xl font-bold', titleText));
  const x = el('button', 'tile-btn shrink-0', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', 'Fechar');
  head.append(x);
  box.append(head);
  back.append(box);
  document.body.append(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  x.addEventListener('click', close);
  back.addEventListener('click', (e) => e.target === back && close());
  return { box, close };
}

// ---------- Entrar / Criar conta / Convidado ----------

export function openAuthModal({ onAuth, onGuest, guestLabel = 'Continuar como convidado' } = {}) {
  const { box, close } = modal('Bem-vindo, piloto');
  box.append(el('p', 'text-violet-200/80 -mt-2',
    'Conta é opcional: serve para guardar moedas, pets e conquistas. Sem conta, você entra só com o código da sala.'));

  const tabs = el('div', 'grid grid-cols-2 gap-2');
  const tLogin = el('button', 'btn btn-ghost btn-sm tab-on', 'Entrar');
  const tReg = el('button', 'btn btn-ghost btn-sm', 'Criar conta');
  tabs.append(tLogin, tReg);

  const form = el('form', 'space-y-3');
  const name = el('input', 'input-neon poll-input w-full px-3 py-2 hidden');
  name.placeholder = 'Nome de piloto (até 16)';
  name.maxLength = 16;
  name.autocomplete = 'nickname';
  const email = el('input', 'input-neon poll-input w-full px-3 py-2');
  email.type = 'email';
  email.placeholder = 'Email';
  email.required = true;
  email.maxLength = 254;
  email.autocomplete = 'email';
  const pass = el('input', 'input-neon poll-input w-full px-3 py-2');
  pass.type = 'password';
  pass.placeholder = 'Senha (mín. 6)';
  pass.required = true;
  pass.minLength = 6;
  pass.maxLength = 72;
  pass.autocomplete = 'current-password';
  const submit = el('button', 'btn btn-primary w-full', 'Entrar');
  const err = el('p', 'text-sm text-rose-400 min-h-[1.25rem]');
  form.append(name, email, pass, submit, err);

  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    tLogin.classList.toggle('tab-on', m === 'login');
    tReg.classList.toggle('tab-on', m === 'register');
    name.classList.toggle('hidden', m === 'login');
    submit.textContent = m === 'login' ? 'Entrar' : 'Criar conta';
    pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    err.textContent = '';
  };
  tLogin.type = tReg.type = 'button';
  tLogin.addEventListener('click', () => setMode('login'));
  tReg.addEventListener('click', () => setMode('register'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    err.textContent = '';
    const body = { email: email.value, password: pass.value };
    if (mode === 'register' && name.value.trim()) body.name = name.value.trim();
    const r = await api('POST', mode === 'login' ? '/api/login' : '/api/register', body);
    submit.disabled = false;
    if (!r.ok) {
      err.textContent = r.error || 'Algo deu errado. Tente de novo.';
      return;
    }
    close();
    onAuth && onAuth(r.user);
  });

  const guest = el('button', 'btn btn-ghost btn-sm w-full', `👤 ${guestLabel}`);
  guest.type = 'button';
  guest.addEventListener('click', () => { close(); onGuest && onGuest(); });

  box.append(tabs, form, guest);
  email.focus();
  return close;
}

// ---------- barra do usuário ----------

export function renderUserBar(container, me, { onLogin, onLogout, onProfile, catalog } = {}) {
  container.replaceChildren();
  if (!me) {
    const b = el('button', 'btn btn-ghost btn-sm', 'Entrar / Criar conta');
    b.type = 'button';
    b.addEventListener('click', onLogin);
    container.append(el('span', 'label hidden sm:inline', 'Convidado'), b);
    return;
  }
  const who = el('span', 'flex items-center gap-1.5 font-semibold');
  who.append(el('span', 'text-lg', petIcon(catalog, me.pet)), el('span', 'truncate max-w-[9rem]', me.name));
  const coins = el('span', 'coin-chip', `🪙 ${me.coins}`);
  coins.dataset.coins = '';
  const out = el('button', 'btn btn-ghost btn-sm', 'Sair');
  out.type = 'button';
  out.addEventListener('click', onLogout);
  container.append(who, coins);
  if (onProfile) {
    const prof = el('button', 'btn btn-ghost btn-sm', 'Perfil / Loja');
    prof.type = 'button';
    prof.addEventListener('click', onProfile);
    container.append(prof);
  }
  container.append(out);
}

export function bumpCoins(container, coins) {
  const chip = container.querySelector('[data-coins]');
  if (!chip) return;
  chip.textContent = `🪙 ${coins}`;
  chip.classList.remove('bump');
  void chip.offsetWidth;
  chip.classList.add('bump');
}

// ---------- Perfil / Loja ----------

export function openProfile({ socket, me, catalog, onChange }) {
  const { box } = modal('Perfil · プロフィール');
  const body = el('div', 'space-y-6');
  box.append(body);

  const fmtTime = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min` : `${Math.floor(s / 60)} min`);

  function render() {
    body.replaceChildren();

    const head = el('div', 'flex flex-wrap items-center gap-4');
    head.append(el('span', 'text-5xl', petIcon(catalog, me.pet)));
    const info = el('div', 'flex-1 min-w-0');
    info.append(el('p', 'font-display text-lg font-bold truncate', me.name), el('p', 'text-sm text-violet-300/70 truncate', me.email));
    head.append(info, el('span', 'coin-chip text-lg', `🪙 ${me.coins}`));
    body.append(head);

    const stats = el('p', 'text-sm text-violet-200/80');
    stats.textContent = `${me.stats.votes} votos · ${me.stats.pollsOpened} votações abertas · ${fmtTime(me.stats.roomSeconds)} em sala · ${me.stats.days} dia(s)`;
    body.append(stats);

    // Loja
    body.append(el('p', 'label', 'Loja de pets · ペットショップ'));
    const shop = el('div', 'grid grid-cols-2 sm:grid-cols-5 gap-2');
    const err = el('p', 'text-sm text-rose-400 empty:hidden');
    for (const p of catalog.pets) {
      const owned = me.pets.includes(p.id);
      const equipped = me.pet === p.id;
      const card = el('div', `shop-card${equipped ? ' equipped' : ''}`);
      card.append(el('span', 'text-4xl', p.icon), el('span', 'font-semibold text-sm', p.name));
      const btn = el('button', `btn btn-sm w-full ${owned ? 'btn-ghost' : 'btn-primary'}`);
      btn.type = 'button';
      if (equipped) { btn.textContent = 'Equipado'; btn.disabled = true; }
      else if (owned) btn.textContent = 'Equipar';
      else { btn.textContent = p.price ? `🪙 ${p.price}` : 'Grátis'; btn.disabled = me.coins < p.price; }
      btn.addEventListener('click', () => {
        btn.disabled = true;
        socket.emit(owned ? 'shop-equip' : 'shop-buy', p.id, (r) => {
          if (!r || !r.ok) { err.textContent = (r && r.error) || 'Não deu certo.'; btn.disabled = false; return; }
          Object.assign(me, r.profile);
          onChange && onChange(me);
          render();
        });
      });
      card.append(btn);
      shop.append(card);
    }
    body.append(shop, err);

    // Conquistas
    body.append(el('p', 'label', 'Conquistas · 実績'));
    const list = el('div', 'grid sm:grid-cols-2 gap-2');
    for (const a of catalog.achievements) {
      const got = me.achievements[a.key];
      const row = el('div', `ach-row${got ? ' got' : ''}`);
      row.append(el('span', 'text-2xl', got ? a.icon : '🔒'));
      const t = el('div', 'min-w-0');
      t.append(el('p', 'font-semibold', a.name), el('p', 'text-xs text-violet-300/70', a.desc));
      row.append(t);
      list.append(row);
    }
    body.append(list);
    // Trocar senha
    const pwBox = el('details', 'space-y-3');
    const pwSum = el('summary', 'label cursor-pointer', 'Trocar senha · パスワード');
    const pwForm = el('form', 'space-y-2 mt-3');
    const mkPass = (ph, ac) => {
      const i = el('input', 'input-neon poll-input w-full px-3 py-2');
      i.type = 'password'; i.placeholder = ph; i.required = true; i.maxLength = 72; i.autocomplete = ac;
      return i;
    };
    const pwCur = mkPass('Senha atual', 'current-password');
    const pwNew = mkPass('Senha nova (mín. 6)', 'new-password');
    pwNew.minLength = 6;
    const pwBtn = el('button', 'btn btn-ghost btn-sm w-full', 'Trocar senha');
    const pwMsg = el('p', 'text-sm min-h-[1.25rem]');
    pwForm.append(pwCur, pwNew, pwBtn, pwMsg);
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      pwBtn.disabled = true;
      pwMsg.textContent = '';
      const r = await api('POST', '/api/password', { current: pwCur.value, next: pwNew.value });
      pwBtn.disabled = false;
      pwMsg.className = `text-sm min-h-[1.25rem] ${r.ok ? 'text-emerald-400' : 'text-rose-400'}`;
      pwMsg.textContent = r.ok ? 'Senha trocada! Os outros aparelhos foram deslogados.' : (r.error || 'Não deu certo.');
      if (r.ok) pwForm.reset();
    });
    pwBox.append(pwSum, pwForm);
    body.append(pwBox);

    body.append(el('p', 'text-xs text-violet-300/60',
      'Moedas (só logado, em sala): +1 a cada 5 min · +2 por votação em que você vota · +3 ao abrir votação (até 3 por hora).'));
  }

  render();
  return { refresh(next) { Object.assign(me, next); render(); } };
}

// Aviso discreto de conquista
export function achievementToast(a) {
  const t = el('div', 'ach-toast');
  t.append(el('span', 'text-2xl', a.icon));
  const txt = el('div');
  txt.append(el('p', 'label text-fuchsia-300', 'Conquista desbloqueada · 実績解除'), el('p', 'font-semibold', a.name));
  t.append(txt);
  document.body.append(t);
  setTimeout(() => t.remove(), 4500);
}
