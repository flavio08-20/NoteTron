// Camada de objetos sobre a página: imagens, formas, linhas, setas e desenho livre.
// Cada objeto fica "na frente" ou "atrás" do texto e tem uma ordem de camada (z).
import { esc } from './ui.js';

const uid = () => Math.random().toString(36).slice(2, 10);

let page, under, over, surface, selBox;
let objects = [], selected = null, tool = 'pen', mode = 'text';
export const style = { stroke: '#e5484d', fillOn: false, fill: '#ffd166', sw: 3, shape: 'rect' };
const cb = { onCommit() {}, onSelect() {} };

export function init(els, callbacks) {
  ({ page, under, over, surface, selBox } = els);
  Object.assign(cb, callbacks);
  surface.addEventListener('pointerdown', onSurfaceDown);
  over.addEventListener('pointerdown', e => {
    if (mode !== 'text' || e.button > 0) return;
    const t = e.target.closest('.obj');
    if (!t) return;
    e.preventDefault();
    select(t.dataset.id);
    startMove(e);
  });
  selBox.querySelectorAll('.h').forEach(h => h.addEventListener('pointerdown', e => startHandle(e, h.dataset.h)));
  new ResizeObserver(() => updateHeight()).observe(page.parentElement);
}

// ---------- geometria das formas ----------
const POLY = {
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  star: (() => {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.2 : 0.5, a = -Math.PI / 2 + (i * Math.PI) / 5;
      p.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
    }
    const ys = p.map(q => q[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return p.map(([x, y]) => [x, (y - y0) / (y1 - y0)]);
  })(),
};
const cornerR = (w, h) => Math.min(w, h) * 0.15;

function shapeSVG(shape, w, h, inset, attrs) {
  const W = Math.max(1, w - 2 * inset), H = Math.max(1, h - 2 * inset);
  switch (shape) {
    case 'rect': return `<rect x="${inset}" y="${inset}" width="${W}" height="${H}" ${attrs}/>`;
    case 'rounded': return `<rect x="${inset}" y="${inset}" width="${W}" height="${H}" rx="${cornerR(W, H)}" ${attrs}/>`;
    case 'ellipse': return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${W / 2}" ry="${H / 2}" ${attrs}/>`;
    default: {
      const pts = (POLY[shape] || POLY.triangle).map(([px, py]) => `${inset + px * W},${inset + py * H}`).join(' ');
      return `<polygon points="${pts}" stroke-linejoin="round" ${attrs}/>`;
    }
  }
}
function clipCSS(shape, w, h) {
  switch (shape) {
    case 'rect': return 'none';
    case 'rounded': return `inset(0 round ${cornerR(w, h)}px)`;
    case 'ellipse': return 'ellipse(50% 50% at 50% 50%)';
    default: return `polygon(${(POLY[shape] || POLY.triangle).map(([x, y]) => `${x * 100}% ${y * 100}%`).join(',')})`;
  }
}

function bbox(o) {
  if (o.points) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of o.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = (o.sw || 2) / 2 + (o.type === 'arrow' ? headLen(o) : 2);
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
const headLen = o => Math.max(12, (o.sw || 2) * 3.5);

function smoothPath(pts) {
  if (pts.length < 3) return 'M' + pts.map(p => p.join(',')).join(' L');
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]},${pts[i][1]} ${mx},${my}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0]},${l[1]}`;
}

function inner(o, b) {
  const stroke = esc(o.stroke || '#000'), sw = o.sw || 2;
  if (o.type === 'image') {
    const src = String(o.src || '').startsWith('data:image/') ? o.src : '';
    let s = `<img src="${esc(src)}" alt="" draggable="false" style="clip-path:${o.clip ? clipCSS(o.shape || 'rect', b.w, b.h) : 'none'}">`;
    if (o.frame) {
      const fw = +o.frameWidth || 4;
      s += `<svg width="${b.w}" height="${b.h}">${shapeSVG(o.shape || 'rect', b.w, b.h, fw / 2, `fill="none" stroke="${esc(o.frameColor || '#5b5bd6')}" stroke-width="${fw}"`)}</svg>`;
    }
    return s;
  }
  if (o.type === 'shape') {
    const fill = o.fillOn ? esc(o.fill) : 'none';
    return `<svg width="${b.w}" height="${b.h}">${shapeSVG(o.shape, b.w, b.h, sw / 2, `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`)}</svg>`;
  }
  const pts = o.points.map(([x, y]) => [x - b.x, y - b.y]);
  if (o.type === 'path') {
    return `<svg width="${b.w}" height="${b.h}"><path d="${smoothPath(pts)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  // linha / seta
  const [[x0, y0], [x1, y1]] = pts;
  let s = `<svg width="${b.w}" height="${b.h}"><line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
  if (o.type === 'arrow') {
    const a = Math.atan2(y1 - y0, x1 - x0), L = headLen(o), sp = 0.45;
    const p1 = [x1 - L * Math.cos(a - sp), y1 - L * Math.sin(a - sp)], p2 = [x1 - L * Math.cos(a + sp), y1 - L * Math.sin(a + sp)];
    s += `<polygon points="${x1},${y1} ${p1.join(',')} ${p2.join(',')}" fill="${stroke}" stroke="${stroke}" stroke-width="${Math.min(sw, 3)}" stroke-linejoin="round"/>`;
  }
  return s + '</svg>';
}

function makeEl(o) {
  const b = bbox(o);
  const d = document.createElement('div');
  d.className = 'obj';
  d.dataset.id = o.id;
  Object.assign(d.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
  d.innerHTML = inner(o, b);
  return d;
}

const elOf = o => page.querySelector(`.obj[data-id="${o.id}"]`);

function refresh(o) {
  const old = elOf(o);
  if (old && o.type === 'image') {
    // evita redecodificar a imagem a cada movimento
    const b = bbox(o);
    Object.assign(old.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
    const img = old.querySelector('img');
    img.style.clipPath = o.clip ? clipCSS(o.shape || 'rect', b.w, b.h) : 'none';
    old.querySelector('svg')?.remove();
    if (o.frame) old.insertAdjacentHTML('beforeend', inner({ ...o, src: '' }, b).replace(/^<img[^>]*>/, ''));
  } else {
    const n = makeEl(o);
    if (old) old.replaceWith(n); else (o.behind ? under : over).append(n);
  }
  positionSel();
}

export function render() {
  under.innerHTML = '';
  over.innerHTML = '';
  for (const o of [...objects].sort((a, b) => a.z - b.z)) (o.behind ? under : over).append(makeEl(o));
  positionSel();
  updateHeight();
}

/** Desenha uma lista de objetos em outras camadas (usado na geração de PDF). Retorna a borda inferior. */
export function renderInto(list, underEl, overEl) {
  let bottom = 0;
  for (const o of [...list].sort((a, b) => a.z - b.z)) {
    (o.behind ? underEl : overEl).append(makeEl(o));
    const b = bbox(o);
    bottom = Math.max(bottom, b.y + b.h);
  }
  underEl.parentElement.style.minHeight = bottom + 40 + 'px';
  return bottom;
}

export function updateHeight() {
  if (!page) return;
  let bottom = 0;
  for (const o of objects) { const b = bbox(o); bottom = Math.max(bottom, b.y + b.h); }
  page.style.minHeight = Math.max(bottom + 200, page.parentElement.clientHeight - 48) + 'px';
}

// ---------- estado ----------
export function setObjects(arr) {
  objects = arr || [];
  selected = null;
  render();
  cb.onSelect(null);
}
export const getObjects = () => objects;
export const cloneObj = o => ({ ...o, points: o.points?.map(p => [...p]) });
const maxZ = () => objects.reduce((m, o) => Math.max(m, o.z || 0), 0);
const minZ = () => objects.reduce((m, o) => Math.min(m, o.z || 0), 0);

export function setMode(m) {
  mode = m;
  page.classList.toggle('mode-draw', m === 'draw');
}
export function setTool(t) {
  tool = t;
  page.dataset.tool = t;
}

function commit() {
  updateHeight();
  positionSel();
  cb.onCommit();
}

export function select(id) {
  selected = id ? objects.find(o => o.id === id) || null : null;
  if (selected && document.activeElement?.id === 'editor') document.activeElement.blur();
  positionSel();
  cb.onSelect(selected);
}
export const selectedObj = () => selected;

function positionSel() {
  if (!selected || !objects.includes(selected)) { selBox.className = 'hidden'; return; }
  const b = bbox(selected);
  selBox.className = selected.type === 'line' || selected.type === 'arrow' ? 'line' : selected.type === 'path' ? 'path' : 'box';
  Object.assign(selBox.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
  if (selected.points?.length === 2 && selected.type !== 'path') {
    selected.points.forEach(([x, y], i) => {
      const h = selBox.querySelector(`[data-h=p${i}]`);
      h.style.left = x - b.x + 'px';
      h.style.top = y - b.y + 'px';
    });
  }
}

// ---------- ações sobre o selecionado ----------
export function updateSelected(patch) {
  if (!selected) return;
  const moveLayer = 'behind' in patch && !!patch.behind !== !!selected.behind;
  Object.assign(selected, patch);
  if (moveLayer) render(); else refresh(selected);
  commit();
}

export function zorder(dir) {
  const o = selected;
  if (!o) return;
  const same = objects.filter(x => !!x.behind === !!o.behind).sort((a, b) => a.z - b.z);
  const i = same.indexOf(o);
  if (dir === 'front') o.z = maxZ() + 1;
  else if (dir === 'back') o.z = minZ() - 1;
  else if (dir === 'up' && i < same.length - 1) { const n = same[i + 1]; [o.z, n.z] = [n.z, o.z === n.z ? o.z - 1 : o.z]; }
  else if (dir === 'down' && i > 0) { const n = same[i - 1]; [o.z, n.z] = [n.z, o.z === n.z ? o.z + 1 : o.z]; }
  else return;
  render();
  commit();
}

export function removeSelected() {
  if (!selected) return;
  objects.splice(objects.indexOf(selected), 1);
  elOf(selected)?.remove();
  select(null);
  commit();
}

export function duplicateSelected() {
  if (!selected) return;
  const c = cloneObj(selected);
  c.id = uid();
  c.z = maxZ() + 1;
  if (c.points) c.points = c.points.map(([x, y]) => [x + 20, y + 20]);
  else { c.x += 20; c.y += 20; }
  objects.push(c);
  render();
  select(c.id);
  commit();
}

export function nudge(dx, dy) {
  if (!selected) return;
  translate(selected, snapshot(selected), dx, dy);
  refresh(selected);
  commit();
}

/** No modo texto: seleciona e começa a mover um objeto "atrás do texto" no ponto clicado. */
export function pickBehind(e) {
  if (mode !== 'text') return false;
  const hit = hitTest(pt(e), 0, o => o.behind);
  if (!hit) return false;
  select(hit.id);
  startMove(e);
  return true;
}

export function addImage(src, natW, natH, at) {
  const pw = page.clientWidth;
  const w = Math.min(natW, 420, pw * 0.7), h = (natH * w) / natW;
  const o = {
    id: uid(), type: 'image', src, x: Math.max(8, Math.min(pw - w - 8, at.x - w / 2)), y: Math.max(8, at.y - h / 2), w, h,
    z: maxZ() + 1, behind: false, shape: 'rounded', clip: false, frame: false, frameColor: '#5b5bd6', frameWidth: 4, lockRatio: true,
  };
  objects.push(o);
  render();
  select(o.id);
  commit();
  return o;
}

// ---------- interação ----------
function pt(e) {
  const r = page.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function drag(e, onMove, onUp) {
  const id = e.pointerId;
  const mv = ev => { if (ev.pointerId === id) { ev.preventDefault(); onMove(ev); } };
  const up = ev => {
    if (ev.pointerId !== id) return;
    removeEventListener('pointermove', mv);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    onUp?.(ev);
  };
  addEventListener('pointermove', mv, { passive: false });
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

const snapshot = o => (o.points ? { points: o.points.map(p => [...p]) } : { x: o.x, y: o.y });
function translate(o, orig, dx, dy) {
  if (o.points) o.points = orig.points.map(([x, y]) => [x + dx, y + dy]);
  else { o.x = Math.max(-o.w / 2, orig.x + dx); o.y = Math.max(0, orig.y + dy); }
}

function startMove(e) {
  const o = selected;
  if (!o) return;
  const p0 = pt(e), orig = snapshot(o);
  let moved = false;
  drag(e, ev => {
    const p = pt(ev), dx = p.x - p0.x, dy = p.y - p0.y;
    if (!moved && Math.hypot(dx, dy) < 3) return;
    moved = true;
    translate(o, orig, dx, dy);
    refresh(o);
  }, () => { if (moved) commit(); });
}

function startHandle(e, h) {
  const o = selected;
  if (!o) return;
  e.preventDefault();
  e.stopPropagation();
  if (h === 'p0' || h === 'p1') {
    const i = +h[1];
    drag(e, ev => { const p = pt(ev); o.points[i] = snapAngle(o.points[1 - i], [p.x, p.y], ev.shiftKey); refresh(o); }, () => commit());
    return;
  }
  const p0 = pt(e), O = { x: o.x, y: o.y, w: o.w, h: o.h }, ratio = O.w / O.h;
  drag(e, ev => {
    const p = pt(ev), dx = p.x - p0.x, dy = p.y - p0.y;
    let w = O.w, hh = O.h;
    if (h.includes('e')) w = O.w + dx;
    if (h.includes('w')) w = O.w - dx;
    if (h.includes('s')) hh = O.h + dy;
    if (h.includes('n')) hh = O.h - dy;
    w = Math.max(16, w); hh = Math.max(16, hh);
    const keep = (o.type === 'image' && o.lockRatio !== false) !== ev.shiftKey;
    if (keep) { if (w / hh > ratio) hh = w / ratio; else w = hh * ratio; }
    o.w = w; o.h = hh;
    o.x = h.includes('w') ? O.x + O.w - w : O.x;
    o.y = h.includes('n') ? O.y + O.h - hh : O.y;
    refresh(o);
    cb.onSelect(o);
  }, () => commit());
}

function snapAngle(from, to, on) {
  if (!on) return to;
  const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [from[0] + len * Math.cos(a), from[1] + len * Math.sin(a)];
}

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
}

function hitTest(p, tol = 4, filter = () => true) {
  const order = [...objects].sort((a, b) => (!!a.behind - !!b.behind) || a.z - b.z).reverse();
  for (const o of order) {
    if (!filter(o)) continue;
    if (o.points) {
      const r = (o.sw || 2) / 2 + tol + 3;
      if (o.points.length === 1 && distSeg(p, o.points[0], o.points[0]) <= r) return o;
      for (let i = 0; i < o.points.length - 1; i++) if (distSeg(p, o.points[i], o.points[i + 1]) <= r) return o;
    } else if (p.x >= o.x - tol && p.x <= o.x + o.w + tol && p.y >= o.y - tol && p.y <= o.y + o.h + tol) return o;
  }
  return null;
}

function newObj(props) {
  const o = { id: uid(), z: maxZ() + 1, behind: false, stroke: style.stroke, sw: style.sw, ...props };
  objects.push(o);
  over.append(makeEl(o));
  return o;
}
function discard(o) {
  objects.splice(objects.indexOf(o), 1);
  elOf(o)?.remove();
}

function onSurfaceDown(e) {
  if (e.button > 0) return;
  e.preventDefault();
  const p = pt(e);
  switch (tool) {
    case 'select': {
      const hit = hitTest(p);
      if (hit) { select(hit.id); startMove(e); } else select(null);
      break;
    }
    case 'pen': {
      select(null);
      const o = newObj({ type: 'path', points: [[p.x, p.y]] });
      drag(e, ev => {
        const q = pt(ev), last = o.points[o.points.length - 1];
        if (Math.hypot(q.x - last[0], q.y - last[1]) < 1.5) return;
        o.points.push([q.x, q.y]);
        refresh(o);
      }, () => {
        if (o.points.length < 2) { o.points.push([p.x + 0.5, p.y + 0.5]); refresh(o); }
        commit();
      });
      break;
    }
    case 'line':
    case 'arrow': {
      const o = newObj({ type: tool, points: [[p.x, p.y], [p.x, p.y]] });
      drag(e, ev => { const q = pt(ev); o.points[1] = snapAngle(o.points[0], [q.x, q.y], ev.shiftKey); refresh(o); }, () => {
        const [[a, b], [c, d]] = o.points;
        if (Math.hypot(c - a, d - b) < 4) o.points[1] = [a + 120, b];
        refresh(o);
        select(o.id);
        commit();
      });
      break;
    }
    case 'shape': {
      const o = newObj({ type: 'shape', shape: style.shape, x: p.x, y: p.y, w: 1, h: 1, fillOn: style.fillOn, fill: style.fill });
      drag(e, ev => {
        const q = pt(ev);
        let w = q.x - p.x, h = q.y - p.y;
        if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        Object.assign(o, { x: Math.min(p.x, p.x + w), y: Math.min(p.y, p.y + h), w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) });
        refresh(o);
      }, () => {
        if (o.w < 6 && o.h < 6) Object.assign(o, { x: p.x - 70, y: Math.max(0, p.y - 50), w: 140, h: 100 });
        refresh(o);
        select(o.id);
        commit();
      });
      break;
    }
    case 'eraser': {
      let erased = false;
      const erase = q => {
        const hit = hitTest(q, 8, o => o.type !== 'image');
        if (hit) { if (hit === selected) select(null); discard(hit); erased = true; }
      };
      erase(p);
      drag(e, ev => erase(pt(ev)), () => { if (erased) commit(); });
      break;
    }
  }
}
