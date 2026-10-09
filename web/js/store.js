// Armazenamento: primeiro no aparelho (IndexedDB), depois sincroniza com o Supabase.
// Funciona offline: alterações ficam marcadas como "dirty" e sobem quando a conexão volta.
import * as db from './db.js';

const bus = new EventTarget();
export const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const notes = new Map();
export const folders = new Map();
export let status = 'idle';

let sb = null, listenersOn = false, pushP = null, pushTimer = null;
const now = () => new Date().toISOString();
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const NOTE_COLS = ['id', 'title', 'folder_id', 'locked', 'search_text', 'created_at', 'updated_at'];
const FOLDER_COLS = ['id', 'name', 'lock', 'created_at', 'updated_at'];

function setStatus(s, err) {
  status = s;
  if (err) console.warn('[sync]', err);
  emit('status', { status: s, error: err });
}

export async function init(userId, client, { offline = false } = {}) {
  sb = client;
  db.use('notetron_' + userId);
  notes.clear(); folders.clear();
  for (const n of await db.all('notes')) notes.set(n.id, n);
  for (const f of await db.all('folders')) folders.set(f.id, f);
  emit('change');
  if (!sb) { setStatus(offline ? 'offline' : 'local'); return; }
  if (!listenersOn) {
    listenersOn = true;
    addEventListener('online', () => pull());
    addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
    setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 60000);
  }
  await pull();
}

export const hasCloud = () => !!sb;

// ---------- baixar do servidor ----------
export async function pull() {
  if (!sb) return;
  if (!navigator.onLine) return setStatus('offline');
  try {
    setStatus('syncing');
    const [fr, nr] = await Promise.all([
      sb.from('folders').select(FOLDER_COLS.join(',')),
      sb.from('notes').select(NOTE_COLS.join(',')),
    ]);
    if (fr.error) throw fr.error;
    if (nr.error) throw nr.error;
    await merge(folders, 'folders', fr.data, false);
    const changed = await merge(notes, 'notes', nr.data, true);
    emit('change');
    if (changed.length) emit('remote', changed);
    await push();
    prefetch();
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline', e);
  }
}

async function merge(map, storeName, rows, isNote) {
  const changed = [];
  const remoteIds = new Set(rows.map(r => r.id));
  for (const r of rows) {
    const l = map.get(r.id);
    if (!l) {
      const rec = { ...r, synced: true, dirty: false, hasContent: !isNote };
      map.set(r.id, rec);
      await db.put(storeName, rec);
      continue;
    }
    if (l.dirty) continue;
    if (new Date(r.updated_at) > new Date(l.updated_at)) {
      const rec = { ...l, ...r, synced: true, dirty: false };
      if (isNote) { rec.hasContent = false; rec.content = null; rec.enc = null; }
      map.set(r.id, rec);
      await db.put(storeName, rec);
      changed.push(r.id);
    } else if (!l.synced) {
      l.synced = true;
      await db.put(storeName, l);
    }
  }
  // apagados em outro aparelho
  for (const [id, l] of [...map]) {
    if (!remoteIds.has(id) && l.synced && !l.dirty) {
      map.delete(id);
      await db.del(storeName, id);
      changed.push(id);
    }
  }
  return changed;
}

// baixa em segundo plano o conteúdo que falta (para funcionar offline depois)
let prefetching = false;
async function prefetch() {
  if (prefetching || !sb) return;
  prefetching = true;
  try {
    for (const n of [...notes.values()]) {
      if (!n.hasContent && navigator.onLine) await loadContent(n.id).catch(() => {});
    }
  } finally { prefetching = false; }
}

export async function loadContent(id) {
  const n = notes.get(id);
  if (!n) throw new Error('Anotação não encontrada');
  if (n.hasContent) return n;
  if (!sb || !navigator.onLine) throw new Error('Conteúdo ainda não baixado — conecte-se à internet.');
  const { data, error } = await sb.from('notes').select('content,enc,locked,updated_at').eq('id', id).single();
  if (error) throw error;
  const cur = notes.get(id);
  if (!cur || cur.dirty) return cur;
  Object.assign(cur, { content: data.content, enc: data.enc, locked: data.locked, hasContent: true });
  await db.put('notes', cur);
  return cur;
}

// ---------- enviar ao servidor ----------
export async function push() {
  if (!sb) return;
  while (pushP) await pushP;
  pushP = doPush();
  try { await pushP; } finally { pushP = null; }
}

async function doPush() {
  if (!navigator.onLine) return setStatus('offline');
  try {
    setStatus('syncing');
    for (const f of [...folders.values()].filter(f => f.dirty)) {
      const rev = f.rev;
      const { error } = await sb.from('folders').upsert(pick(f, FOLDER_COLS));
      if (error) throw error;
      if (f.rev === rev) f.dirty = false;
      f.synced = true;
      await db.put('folders', f);
    }
    for (const n of [...notes.values()].filter(n => n.dirty)) {
      const rev = n.rev;
      const row = pick(n, NOTE_COLS);
      if (n.hasContent) { row.content = n.enc ? null : n.content; row.enc = n.enc || null; }
      let { error } = await sb.from('notes').upsert(row);
      if (error && error.code === '23503' && row.folder_id) { // pasta apagada em outro aparelho
        n.folder_id = row.folder_id = null;
        ({ error } = await sb.from('notes').upsert(row));
      }
      if (error) throw error;
      if (n.rev === rev) n.dirty = false;
      n.synced = true;
      await db.put('notes', n);
    }
    const pend = (await db.get('meta', 'pendingDeletes'))?.value || { notes: [], folders: [] };
    for (const kind of ['notes', 'folders']) {
      for (const id of [...pend[kind]]) {
        const { error } = await sb.from(kind).delete().eq('id', id);
        if (error) throw error;
        pend[kind] = pend[kind].filter(x => x !== id);
        await db.put('meta', { key: 'pendingDeletes', value: pend });
      }
    }
    const left = [...notes.values(), ...folders.values()].some(x => x.dirty);
    setStatus(left ? 'pending' : 'synced');
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline', e);
  }
}

export function schedulePush(ms = 1200) {
  if (!sb) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, ms);
}

async function queueDelete(kind, id) {
  const pend = (await db.get('meta', 'pendingDeletes'))?.value || { notes: [], folders: [] };
  if (!pend[kind].includes(id)) pend[kind].push(id);
  await db.put('meta', { key: 'pendingDeletes', value: pend });
}

// ---------- anotações ----------
export async function saveNote(n, { touch = true } = {}) {
  if (touch) n.updated_at = now();
  n.created_at ||= n.updated_at || now();
  n.dirty = true;
  n.rev = (n.rev || 0) + 1;
  notes.set(n.id, n);
  await db.put('notes', n);
  emit('change');
  if (sb) setStatus('pending');
  schedulePush();
  return n;
}

export async function deleteNote(id) {
  const n = notes.get(id);
  if (!n) return;
  notes.delete(id);
  await db.del('notes', id);
  if (sb && n.synced) { await queueDelete('notes', id); schedulePush(100); }
  emit('change');
}

// ---------- pastas ----------
export async function saveFolder(f) {
  f.updated_at = now();
  f.created_at ||= f.updated_at;
  f.dirty = true;
  f.rev = (f.rev || 0) + 1;
  folders.set(f.id, f);
  await db.put('folders', f);
  emit('change');
  schedulePush(300);
  return f;
}

export const createFolder = name => saveFolder({ id: crypto.randomUUID(), name });

export async function deleteFolder(id) {
  const f = folders.get(id);
  if (!f) return;
  folders.delete(id);
  await db.del('folders', id);
  for (const n of notes.values()) {
    if (n.folder_id === id) { n.folder_id = null; await db.put('notes', n); }
  }
  if (sb && f.synced) { await queueDelete('folders', id); schedulePush(100); }
  emit('change');
}
