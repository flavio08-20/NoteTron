// Editor de texto rico (contenteditable) + blocos de código com destaque de sintaxe.
import { esc, plainFromHTML } from './ui.js';
import { suggest } from './autocomplete.js';

export const LANGS = [
  ['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'],
  ['csharp', 'C#'], ['html', 'HTML'], ['css', 'CSS'], ['text', 'Texto simples'],
];
const HL = { python: 'python', javascript: 'javascript', typescript: 'typescript', csharp: 'csharp', html: 'xml', css: 'css', text: 'plaintext' };
const ALIASES = {
  py: 'python', python: 'python', js: 'javascript', javascript: 'javascript', jsx: 'javascript', node: 'javascript', json: 'javascript',
  ts: 'typescript', tsx: 'typescript', typescript: 'typescript', cs: 'csharp', csharp: 'csharp', 'c#': 'csharp',
  html: 'html', htm: 'html', xml: 'html', css: 'css', text: 'text', txt: 'text', plaintext: 'text', plain: 'text',
};
export const normLang = l => ALIASES[(l || '').toLowerCase().trim()] || 'text';

let el, page, savedRange = null;
const cb = { onChange() {}, onFormat() {}, onSelection() {} };

export function init(editorEl, pageEl, callbacks) {
  el = editorEl; page = pageEl;
  Object.assign(cb, callbacks);
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}

  el.addEventListener('input', e => {
    if (e.target.classList?.contains('cb-ta')) updateSuggest(e.target);
    updateEmpty();
    cb.onChange();
  });
  el.addEventListener('focusout', e => { if (e.target.classList?.contains('cb-ta')) closeSuggest(e.target.closest('.codeblock')); });
  el.addEventListener('mousedown', e => {
    // clicar numa opção da lista não pode tirar o foco do código
    const opt = e.target.closest('.cb-ac li');
    if (opt) { e.preventDefault(); acceptSuggest(opt.closest('.codeblock'), +opt.dataset.i); return; }
    if (e.target.classList?.contains('cb-ta')) closeSuggest(e.target.closest('.codeblock'));
  });
  el.addEventListener('change', e => {
    if (!e.target.classList.contains('cb-lang')) return;
    const block = e.target.closest('.codeblock');
    block.dataset.lang = e.target.value;
    highlight(block);
    cb.onFormat();
  });
  el.addEventListener('click', e => {
    const copy = e.target.closest('.cb-copy');
    if (copy) {
      const ta = copy.closest('.codeblock').querySelector('textarea');
      navigator.clipboard?.writeText(ta.value).then(() => {
        copy.textContent = 'Copiado!';
        setTimeout(() => (copy.textContent = 'Copiar'), 1200);
      });
    }
    const del = e.target.closest('.cb-del');
    if (del) { del.closest('.codeblock').remove(); ensureNotEmpty(); cb.onFormat(); }
  });
  el.addEventListener('keydown', e => {
    const ta = e.target.classList?.contains('cb-ta') ? e.target : null;
    if (!ta) return;
    const block = ta.closest('.codeblock');
    const st = acState.get(block);
    if (st) {
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); acceptSuggest(block, st.index); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        st.index = (st.index + (e.key === 'ArrowDown' ? 1 : -1) + st.items.length) % st.items.length;
        renderSuggest(block);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSuggest(block); return; }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'PageUp', 'PageDown'].includes(e.key)) closeSuggest(block);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
      highlight(block);
      cb.onChange();
    }
  });
  document.addEventListener('selectionchange', () => {
    const s = getSelection();
    const node = s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentElement;
    if (s.rangeCount && el.contains(s.anchorNode) && !node?.closest('.codeblock')) {
      savedRange = s.getRangeAt(0).cloneRange();
      cb.onSelection();
    }
  });
}

// ---------- sanitização ----------
export function sanitize(html) {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS: ['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'mark',
      'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'hr',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'font'],
    ALLOWED_ATTR: ['style', 'href', 'data-lang', 'class', 'color', 'face', 'size', 'colspan', 'rowspan'],
  });
}

// ---------- blocos de código ----------
function makeCodeBlock(lang, text) {
  lang = normLang(lang);
  const w = document.createElement('div');
  w.className = 'codeblock';
  w.contentEditable = 'false';
  w.dataset.lang = lang;
  w.innerHTML = `<div class="cb-head">
      <select class="cb-lang" title="Linguagem">${LANGS.map(([v, l]) => `<option value="${v}"${v === lang ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <span class="sp"></span>
      <button type="button" class="cb-copy">Copiar</button>
      <button type="button" class="cb-del" title="Remover bloco">✕</button>
    </div>
    <div class="cb-body"><pre aria-hidden="true"><code class="hljs"></code></pre><textarea class="cb-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" placeholder="Digite seu código…"></textarea></div>`;
  w.querySelector('textarea').value = text || '';
  highlight(w);
  return w;
}

function hl(text, lang) {
  try {
    return window.hljs ? hljs.highlight(text, { language: HL[lang] || 'plaintext', ignoreIllegals: true }).value : esc(text);
  } catch { return esc(text); }
}

// ghost: { pos, text } → mostra o texto sugerido em cinza na posição do cursor
function highlight(block, ghost = null) {
  if (!block) return;
  const text = block.querySelector('textarea').value;
  const code = block.querySelector('code');
  code.innerHTML = ghost
    ? hl(text.slice(0, ghost.pos), block.dataset.lang) + `<span class="cb-ghost">${esc(ghost.text)}</span>` + hl(text.slice(ghost.pos), block.dataset.lang)
    : hl(text, block.dataset.lang);
  code.insertAdjacentText('beforeend', '\n');
}

// ---------- autocompletar ----------
const acState = new WeakMap(); // bloco → { start, prefix, items, index }

function updateSuggest(ta) {
  const block = ta.closest('.codeblock');
  const caret = ta.selectionStart;
  const s = ta.selectionStart === ta.selectionEnd ? suggest(block.dataset.lang, ta.value, caret) : null;
  if (!s) { closeSuggest(block); highlight(block); return; }
  acState.set(block, { ...s, index: 0 });
  renderSuggest(block);
}

function renderSuggest(block) {
  const st = acState.get(block);
  if (!st) return;
  const ta = block.querySelector('textarea');
  const pick = st.items[st.index];
  const rest = pick.toLowerCase().startsWith(st.prefix.toLowerCase()) ? pick.slice(st.prefix.length) : '';
  highlight(block, { pos: ta.selectionStart, text: rest });
  let list = block.querySelector('.cb-ac');
  if (!list) {
    list = document.createElement('ul');
    list.className = 'cb-ac';
    block.querySelector('.cb-body').append(list);
  }
  list.innerHTML = st.items.map((w, i) => `<li data-i="${i}" class="${i === st.index ? 'on' : ''}">${esc(w)}${i === st.index ? '<kbd>Tab</kbd>' : ''}</li>`).join('');
  const mark = block.querySelector('.cb-ghost');
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  list.style.left = Math.max(0, Math.min(mark.offsetLeft, block.clientWidth - 220)) + 'px';
  list.style.top = mark.offsetTop + lh + 2 + 'px';
}

function acceptSuggest(block, index) {
  const st = acState.get(block);
  if (!st) return;
  const ta = block.querySelector('textarea');
  ta.setRangeText(st.items[index], st.start, ta.selectionStart, 'end');
  closeSuggest(block);
  ta.focus();
  cb.onChange();
}

function closeSuggest(block) {
  if (!block) return;
  const had = acState.delete(block);
  block.querySelector('.cb-ac')?.remove();
  if (had) highlight(block);
}

// transforma <pre> soltos (vindos de colagem, importação ou IA) em blocos de código
function upgrade() {
  el.querySelectorAll('pre').forEach(pre => {
    if (pre.closest('.codeblock')) return;
    const codeEl = pre.querySelector('code');
    const cls = (codeEl?.className || '') + ' ' + pre.className;
    const lang = pre.dataset.lang || codeEl?.dataset?.lang || (cls.match(/language-([\w#+-]+)/) || [])[1];
    pre.replaceWith(makeCodeBlock(normLang(lang), (codeEl || pre).textContent.replace(/\n$/, '')));
  });
  updateEmpty();
}

export function insertCodeBlock(lang, text = '') {
  const block = makeCodeBlock(lang, text);
  const after = document.createElement('p');
  after.innerHTML = '<br>';
  let top = null;
  if (savedRange && el.contains(savedRange.startContainer)) {
    top = savedRange.startContainer;
    if (top === el) top = el.childNodes[savedRange.startOffset] || el.lastChild;
    while (top && top.parentNode !== el) top = top.parentNode;
  }
  if (top) {
    const empty = top.nodeType === 1 && !top.textContent.trim() && !top.querySelector?.('.codeblock');
    if (empty) top.replaceWith(block); else top.after(block);
  } else el.append(block);
  if (!block.nextElementSibling || block.nextElementSibling.classList.contains('codeblock')) block.after(after);
  updateEmpty();
  block.querySelector('textarea').focus();
  cb.onFormat();
}

// ---------- conteúdo ----------
export function setHTML(html) {
  el.innerHTML = sanitize(html);
  upgrade();
  ensureNotEmpty();
  savedRange = null;
}

export function getHTML() {
  const clone = el.cloneNode(true);
  const live = el.querySelectorAll('.codeblock');
  clone.querySelectorAll('.codeblock').forEach((c, i) => {
    const pre = document.createElement('pre');
    pre.dataset.lang = live[i].dataset.lang;
    const code = document.createElement('code');
    code.textContent = live[i].querySelector('textarea').value;
    pre.append(code);
    c.replaceWith(pre);
  });
  return clone.innerHTML;
}

export const plainText = () => plainFromHTML(getHTML());

export function appendHTML(html) {
  el.insertAdjacentHTML('beforeend', sanitize(html));
  upgrade();
  cb.onFormat();
}

export function insertHTML(html) {
  restore();
  document.execCommand('insertHTML', false, sanitize(html));
  upgrade();
  cb.onFormat();
}

function ensureNotEmpty() {
  if (!el.firstChild) el.innerHTML = '<p><br></p>';
  updateEmpty();
}
function updateEmpty() {
  el.classList.toggle('is-empty', !el.textContent.trim() && !el.querySelector('.codeblock,hr,li,table'));
}

// ---------- formatação ----------
function restore() {
  el.focus({ preventScroll: true });
  if (savedRange && el.contains(savedRange.startContainer)) {
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(savedRange);
  }
}

export function format(cmd, value = null) {
  restore();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, value);
  cb.onFormat();
}

export function formatBlock(tag) {
  restore();
  document.execCommand('formatBlock', false, `<${tag}>`);
  cb.onFormat();
}

export function setSelectionFontSize(px) {
  restore();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontSize', false, '7');
  el.querySelectorAll('font[size="7"]').forEach(f => {
    const s = document.createElement('span');
    s.style.fontSize = px + 'px';
    s.append(...f.childNodes);
    f.replaceWith(s);
  });
  el.querySelectorAll('[style*="xxx-large"]').forEach(n => (n.style.fontSize = px + 'px'));
  cb.onFormat();
}

/** Estilo da nota inteira (fonte, cor, tamanho, fundo da página). */
export function applyNoteStyle(style = {}) {
  el.style.fontFamily = style.font || '';
  el.style.color = style.color || '';
  el.style.fontSize = style.size ? style.size + 'px' : '';
  page.style.backgroundColor = style.bg || '';
}

/** Remove a formatação local de uma propriedade (para "aplicar à nota toda"). */
export function clearInline(prop) {
  const attr = { fontFamily: 'face', color: 'color', fontSize: 'size' }[prop];
  el.querySelectorAll('[style]').forEach(n => {
    if (n.closest('.codeblock')) return;
    n.style[prop] = '';
    if (!n.getAttribute('style')) n.removeAttribute('style');
  });
  if (attr) el.querySelectorAll('font').forEach(f => f.removeAttribute(attr));
}

export function queryState() {
  const q = c => { try { return document.queryCommandState(c); } catch { return false; } };
  return { bold: q('bold'), italic: q('italic'), underline: q('underline'), insertUnorderedList: q('insertUnorderedList'), insertOrderedList: q('insertOrderedList') };
}

export const focus = () => el.focus({ preventScroll: true });
