// Criptografia das anotações com senha (Web Crypto, tudo no aparelho).
//
// Cada anotação protegida tem uma chave aleatória própria (DEK, AES-256-GCM).
// O conteúdo é cifrado com a DEK; a DEK é cifrada com uma chave derivada da
// senha (PBKDF2-SHA256). Trocar a senha só recifra a DEK.

const te = new TextEncoder(), td = new TextDecoder();
const ITER = 310000;

export function toB64(u8) {
  const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const newDEK = () => crypto.getRandomValues(new Uint8Array(32));

async function passwordKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Cifra a DEK com a senha. Retorna o cabeçalho a guardar em note.enc. */
export async function wrapDEK(dek, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await passwordKey(pw, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, dek);
  return { v: 1, salt: toB64(salt), iter: ITER, wiv: toB64(iv), wkey: toB64(new Uint8Array(ct)) };
}

/** Recupera a DEK com a senha. Lança erro se a senha estiver errada. */
export async function unwrapDEK(enc, pw) {
  const k = await passwordKey(pw, fromB64(enc.salt), enc.iter);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.wiv) }, k, fromB64(enc.wkey));
  return new Uint8Array(raw);
}

const dataKey = dek => crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function encryptContent(dek, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(dek), te.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function decryptContent(dek, enc) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) }, await dataKey(dek), fromB64(enc.ct));
  return JSON.parse(td.decode(pt));
}

// ---------- senha de pasta (só verificador, não cifra dados) ----------
async function pbkdf2Bits(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256));
}

export async function makeVerifier(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, salt: toB64(salt), iter: ITER, hash: toB64(await pbkdf2Bits(pw, salt, ITER)) };
}

export async function checkVerifier(lock, pw) {
  const h = toB64(await pbkdf2Bits(pw, fromB64(lock.salt), lock.iter));
  return h === lock.hash;
}

// ---------- chave cifrada por outra chave (DEK da anotação ← chave da pasta) ----------
export async function wrapWithKey(kek, raw) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(kek), raw);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
export async function unwrapWithKey(kek, w) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(w.iv) }, await dataKey(kek), fromB64(w.ct)));
}
