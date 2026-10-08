// Utilidades de interface: seletores, modais, menus, toasts, tema.
import { icon, applyIcons } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function plainFromHTML(html) {
  const d = new DOMParser().parseFromString(html || '', 'text/html');
  return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
}

export function debounce(fn, ms) {
  let t = null, args = [];
  const d = (...a) => { args = a; clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = () => { if (t) { clearTimeout(t); t = null; return fn(...args); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

export function toast(msg, type = 'info', ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').append(t);
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  if (ms) setTimeout(close, ms);
  t.close = close;
  return t;
}

export function busyToast(msg) {
  const t = toast('', 'info', 0);
  t.innerHTML = `<span class="spinner"></span><span>${esc(msg)}</span>`;
  return t;
}

/**
 * Modal genérico.
 * buttons: [{label, value, primary, danger, cancel, left}]
 * validate(value, data, dlg) → string de erro (mantém aberto) ou nada.
 * init(dlg, finish) → para ligar eventos extras.
 * Resolve com {value, data, el} ou null (cancelado).
 */
export function modal({ title, body = '', buttons = [{ label: 'OK', value: 'ok', primary: true }], init, validate, wide }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal' + (wide ? ' wide' : '');
    dlg.innerHTML = `<form novalidate><header><h3>${esc(title)}</h3><button type="button" class="icon-btn m-close" aria-label="Fechar">${icon('x')}</button></header>
      <div class="m-body"></div><div class="m-err" hidden></div><footer></footer></form>`;
    const form = $('form', dlg), bodyEl = $('.m-body', dlg), err = $('.m-err', dlg), footer = $('footer', dlg);
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
    let primaryBtn = null, done = false;

    const finish = r => {
      if (done) return; done = true;
      dlg.close(); dlg.remove(); resolve(r);
    };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = b.cancel ? 'button' : 'submit';
      btn.value = b.value ?? '';
      btn.textContent = b.label;
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '') + (b.left ? ' left' : '');
      if (b.cancel) btn.onclick = () => finish(null);
      if (b.primary) primaryBtn = btn;
      footer.append(btn);
    }
    $('.m-close', dlg).onclick = () => finish(null);
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    form.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && primaryBtn) { e.preventDefault(); form.requestSubmit(primaryBtn); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const value = e.submitter?.value ?? primaryBtn?.value;
      const data = Object.fromEntries(new FormData(form));
      if (validate) {
        dlg.classList.add('busy'); err.hidden = true;
        let msg;
        try { msg = await validate(value, data, dlg); } catch (ex) { msg = ex.message || String(ex); }
        dlg.classList.remove('busy');
        if (msg) { err.textContent = msg; err.hidden = false; return; }
      }
      finish({ value, data, el: dlg });
    });
    document.body.append(dlg);
    applyIcons(dlg);
    dlg.showModal();
    init?.(dlg, finish);
    const first = $('input:not([type=hidden]):not([type=checkbox]), textarea, select', bodyEl);
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export const confirmDialog = (title, text, okLabel = 'Confirmar', danger = false) =>
  modal({ title, body: `<p>${esc(text)}</p>`, buttons: [{ label: 'Cancelar', cancel: true }, { label: okLabel, value: 'ok', primary: !danger, danger }] })
    .then(r => !!r);

let openMenu = null;
export function closeMenus() { openMenu?.remove(); openMenu = null; }
/** Menu suspenso. items: [{label, icon, onClick, danger} | '-'] */
export function menu(anchor, items) {
  closeMenus();
  const m = document.createElement('div');
  m.className = 'popmenu';
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    if (it.danger) b.className = 'danger';
    b.innerHTML = (it.icon ? icon(it.icon) : '') + `<span>${esc(it.label)}</span>`;
    b.onclick = () => { closeMenus(); it.onClick(); };
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8));
  let top = r.bottom + 4;
  if (top + m.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 4);
  Object.assign(m.style, { left: left + 'px', top: top + 'px' });
  openMenu = m;
  setTimeout(() => {
    const outside = e => {
      if (!m.contains(e.target)) { closeMenus(); document.removeEventListener('pointerdown', outside, true); }
    };
    document.addEventListener('pointerdown', outside, true);
  });
}

// ---------- tema ----------
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const light = $('#hl-light'), dark = $('#hl-dark');
  if (light && dark) { light.disabled = t === 'dark'; dark.disabled = t !== 'dark'; }
  const btn = $('#theme-toggle');
  if (btn) { btn.dataset.icon = t === 'dark' ? 'sun' : 'moon'; applyIcons(btn.parentElement); }
}
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('nt_theme'); } catch {}
  applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
export function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('nt_theme', t); } catch {}
  applyTheme(t);
}
