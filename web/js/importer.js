// Importação de arquivos (.md, .txt e código) e redução de imagens.
import { esc } from './ui.js';

const CODE_EXT = {
  py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', json: 'javascript',
  ts: 'typescript', tsx: 'typescript', cs: 'csharp', html: 'html', htm: 'html', css: 'css',
};
export const ACCEPT = ['.md', '.markdown', '.txt', ...Object.keys(CODE_EXT).map(e => '.' + e)].join(',');
const MAX = 3 * 1024 * 1024;

const ext = name => (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
function kind(f) {
  const e = ext(f.name);
  if (e === 'md' || e === 'markdown') return 'md';
  if (e === 'txt') return 'txt';
  if (CODE_EXT[e]) return 'code';
  if (f.type === 'text/plain' || f.type === 'text/markdown') return 'txt';
  return null;
}
export const isImportable = f => !!kind(f);

export async function fileToHTML(file) {
  if (file.size > MAX) throw new Error(`${file.name}: arquivo grande demais (máx. 3 MB)`);
  const text = await file.text();
  switch (kind(file)) {
    case 'md': return marked.parse(text, { gfm: true });
    case 'txt': return text.split(/\r?\n\s*\r?\n/).map(p => `<p>${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('') || '<p><br></p>';
    case 'code': return `<pre data-lang="${CODE_EXT[ext(file.name)]}"><code>${esc(text.replace(/\s+$/, ''))}</code></pre><p><br></p>`;
    default: throw new Error(`${file.name}: tipo de arquivo não suportado`);
  }
}

export async function filesToNotes(files) {
  const notes = [], errors = [];
  for (const f of files) {
    if (!kind(f)) { errors.push(`${f.name}: tipo não suportado`); continue; }
    try { notes.push({ title: f.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Importada', html: await fileToHTML(f) }); }
    catch (e) { errors.push(e.message); }
  }
  return { notes, errors };
}

// ---------- imagens ----------
const readAsDataURL = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(file);
});
const loadImg = src => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('Imagem inválida'));
  i.src = src;
});

/** Reduz a imagem (máx. 1600px) para manter as anotações leves. */
export async function compressImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const w = img.naturalWidth || 300, h = img.naturalHeight || 200;
    const s = Math.min(1, max / Math.max(w, h));
    if (file.type === 'image/gif' || (s === 1 && file.size < 350_000)) return { src: await readAsDataURL(file), w, h };
    const c = document.createElement('canvas');
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let src = c.toDataURL('image/webp', 0.85);
    if (!src.startsWith('data:image/webp')) src = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
    return { src, w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
