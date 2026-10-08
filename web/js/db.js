// IndexedDB mínimo: um banco por usuário, com as stores notes, folders e meta.
let name = 'notetron', dbp = null;

export function use(dbName) {
  if (dbName === name && dbp) return;
  name = dbName;
  dbp = null;
}

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const store = async (s, mode = 'readonly') => (await open()).transaction(s, mode).objectStore(s);

export const get = async (s, key) => wrap((await store(s)).get(key));
export const all = async s => wrap((await store(s)).getAll());
export const put = async (s, val) => wrap((await store(s, 'readwrite')).put(val));
export const del = async (s, key) => wrap((await store(s, 'readwrite')).delete(key));
