// NoteTron — módulo principal.
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ESM, isConfigured } from './config.js';
import { applyIcons, icon } from './icons.js';
import { $, $$, esc, debounce, toast, busyToast, modal, confirmDialog, menu, initTheme, toggleTheme, plainFromHTML } from './ui.js';
import * as store from './store.js';
import * as cx from './crypto.js';
import * as ed from './editor.js';
import * as ob from './objects.js';
import { renderDrawer } from './drawer.js';
import { ACCEPT, filesToNotes, fileToHTML, isImportable, compressImage } from './importer.js';

let sb = null, user = null, mode = null;
let current = null;              // anotação aberta
const deks = new Map();          // chaves das anotações destrancadas nesta sessão
let noteStyle = {};
let scope = 'sel';
let unsaved = false;
const hist = { stack: [], idx: -1 };
const collapsed = new Set(JSON.parse(localStorage.getItem('nt_collapsed') || '[]'));

const appUrl = () => location.origin + location.pathname;
const emptyContent = () => ({ v: 1, html: '<p><br></p>', style: {}, objects: [] });

// =====================================================================
// INÍCIO
// =====================================================================
boot();

async function boot() {
  initTheme();
  applyIcons(document);
  registerSW();
  bindAuth();
  bindApp();

  if (isConfigured()) {
    try {
      const { createClient } = await import(SUPABASE_ESM);
      sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    } catch (e) { console.warn('Supabase indisponível', e); }
  }

  if (sb) {
    sb.auth.onAuthStateChange((ev, session) => {
      // não chamar o Supabase direto aqui dentro (recomendação da lib)
      setTimeout(() => {
        if (ev === 'PASSWORD_RECOVERY') accountPasswordReset();
        if (ev === 'SIGNED_OUT') { if (mode === 'cloud') showAuth(); return; }
        if (session && (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION')) {
          if (!user || user.id !== session.user.id || mode !== 'cloud') enterApp('cloud', session.user);
          else checkPendingRecovery();
        }
      }, 0);
    });
    const { data: { session } } = await sb.auth.getSession();
    if (session) return enterApp('cloud', session.user);
  } else if (isConfigured()) {
    // biblioteca não carregou (offline): abre com os dados salvos no aparelho
    const last = JSON.parse(localStorage.getItem('nt_last_user') || 'null');
    if (last) return enterApp('offline', last);
  }
  if (localStorage.getItem('nt_local_mode') === '1') return enterApp('local', { id: 'local', email: 'Somente neste aparelho' });
  showAuth();
  // erro devolvido pelo Google/Supabase na volta do login social
  const params = new URLSearchParams(location.search + '&' + location.hash.slice(1));
  const oauthErr = params.get('error_description') || params.get('error');
  if (oauthErr) {
    authMsg(/access_denied/i.test(oauthErr) ? 'Login com Google cancelado.' : 'Não foi possível entrar com o Google: ' + oauthErr.replace(/\+/g, ' '), 'err');
    history.replaceState(null, '', appUrl());
  }
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
}

// =====================================================================
// LOGIN
// =====================================================================
let authTab = 'login';
function bindAuth() {
  $$('[data-auth-tab]').forEach(b => b.onclick = () => {
    authTab = b.dataset.authTab;
    $$('[data-auth-tab]').forEach(x => x.classList.toggle('active', x === b));
    $('#auth-submit').textContent = authTab === 'login' ? 'Entrar' : 'Criar conta';
    $('#auth-form [name=password]').autocomplete = authTab === 'login' ? 'current-password' : 'new-password';
    authMsg('');
  });

  $('#auth-form').onsubmit = async e => {
    e.preventDefault();
    if (!sb) return authMsg('O app ainda não está ligado ao servidor.', 'err');
    const { email, password } = Object.fromEntries(new FormData(e.target));
    const btn = $('#auth-submit');
    btn.disabled = true;
    authMsg('');
    try {
      if (authTab === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          // conta criada mas e-mail ainda não confirmado: oferece a confirmação por código
          if (/email not confirmed/i.test(error.message)) { btn.disabled = false; return confirmSignupDialog(email, { resendNow: true }); }
          throw error;
        }
      } else {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
        if (error) throw error;
        // o Supabase não revela se o e-mail já existe; uma conta sem identidades indica isso
        if (data.user && !data.user.identities?.length) throw new Error('User already registered');
        if (!data.session) { btn.disabled = false; return confirmSignupDialog(email); }
      }
    } catch (err) {
      authMsg(translateAuth(err.message), 'err');
    } finally { btn.disabled = false; }
  };

  $('#forgot-account').onclick = async () => {
    if (!sb) return;
    const r = await modal({
      title: 'Redefinir senha da conta',
      body: `<p class="muted">Enviaremos um link para você criar uma nova senha de acesso.</p><label>E-mail<input type="email" name="email" required value="${esc($('#auth-form [name=email]').value)}"></label>`,
      buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Enviar link', value: 'ok', primary: true }],
      validate: async (v, d) => {
        if (!/^\S+@\S+\.\S+$/.test(d.email)) return 'Informe um e-mail válido.';
        const { error } = await sb.auth.resetPasswordForEmail(d.email, { redirectTo: appUrl() });
        if (error) return translateAuth(error.message);
      },
    });
    if (r) authMsg('Se existir uma conta com esse e-mail, o link foi enviado.', 'ok');
  };

  // Login com Google (OAuth pelo Supabase): sai para a página do Google e volta logado
  $('#google-login').onclick = async () => {
    if (!sb) return authMsg('O app ainda não está ligado ao servidor.', 'err');
    const btn = $('#google-login');
    btn.disabled = true;
    authMsg('');
    try {
      // confere antes se o Google foi ativado no Supabase (senão o Google mostraria uma página de erro)
      const s = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } }).then(r => r.json());
      if (!s.external?.google) throw new Error('O login com Google ainda não foi ativado no servidor.');
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: appUrl(), queryParams: { prompt: 'select_account' } },
      });
      if (error) throw error;
    } catch (err) {
      authMsg(translateAuth(err.message), 'err');
      btn.disabled = false;
    }
  };

  $('#local-mode').onclick = () => {
    localStorage.setItem('nt_local_mode', '1');
    enterApp('local', { id: 'local', email: 'Somente neste aparelho' });
  };
}

// Confirmação do e-mail na criação da conta: código digitado ou link do e-mail.
// Sem essa confirmação a conta não consegue entrar no app.
async function confirmSignupDialog(email, { resendNow = false } = {}) {
  const resend = async () => {
    const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: appUrl() } });
    if (error) toast(translateAuth(error.message), 'err', 5000);
    else toast('Enviamos um novo código para o seu e-mail.');
  };
  if (resendNow) await resend();
  const r = await modal({
    title: 'Confirme seu e-mail',
    body: `<p>Enviamos um código de confirmação para <b>${esc(email)}</b>.</p>
      <p class="muted">Digite o código abaixo ou clique no link do e-mail (pode ser em outro aparelho). Sem confirmar, a conta não pode ser usada.</p>
      <label>Código<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10"></label>
      <button type="button" class="link" data-resend style="justify-self:start">Não recebeu? Reenviar código</button>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Confirmar', value: 'ok', primary: true }],
    init: dlg => { dlg.querySelector('[data-resend]').onclick = resend; },
    validate: async (v, d) => {
      const token = d.code.replace(/\s/g, '');
      if (!token) return 'Digite o código que chegou no seu e-mail.';
      let { error } = await sb.auth.verifyOtp({ email, token, type: 'signup' });
      if (error) ({ error } = await sb.auth.verifyOtp({ email, token, type: 'email' }));
      if (error) return 'Código inválido ou expirado. Confira ou peça um novo.';
    },
  });
  if (r) { authMsg(''); toast('E-mail confirmado! Bem-vindo ao NoteTron.'); }
  else authMsg('Sua conta só pode ser usada depois de confirmar o e-mail. Ao entrar, enviaremos um novo código.', 'warn');
}

function authMsg(text, type = '') {
  const m = $('#auth-msg');
  m.hidden = !text;
  m.className = 'msg ' + type;
  m.textContent = text;
}

function translateAuth(msg = '') {
  const map = [
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/email not confirmed/i, 'Confirme seu e-mail (veja a caixa de entrada) antes de entrar.'],
    [/already registered|already been registered/i, 'Este e-mail já tem conta. Use “Entrar”.'],
    [/password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
    [/rate limit|too many/i, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'],
    [/signups not allowed/i, 'Novos cadastros estão desativados.'],
    [/failed to fetch|network/i, 'Sem conexão com o servidor.'],
  ];
  for (const [re, t] of map) if (re.test(msg)) return t;
  return msg || 'Algo deu errado.';
}

function showAuth() {
  user = null; mode = null; current = null; deks.clear(); folderKeys.clear();
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#config-warning').hidden = isConfigured();
  $('#auth-box').hidden = !sb;
}

async function accountPasswordReset() {
  const r = await modal({
    title: 'Nova senha da conta',
    body: `<label>Nova senha<input type="password" name="pw" autocomplete="new-password"></label><label>Confirmar<input type="password" name="pw2" autocomplete="new-password"></label>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Salvar', value: 'ok', primary: true }],
    validate: async (v, d) => {
      if (d.pw.length < 6) return 'Use pelo menos 6 caracteres.';
      if (d.pw !== d.pw2) return 'As senhas não conferem.';
      const { error } = await sb.auth.updateUser({ password: d.pw });
      if (error) return translateAuth(error.message);
    },
  });
  if (r) toast('Senha da conta alterada.');
}

// =====================================================================
// ENTRADA NO APP
// =====================================================================
async function enterApp(m, u) {
  if (user && user.id === u.id && mode === m) return;
  mode = m; user = u;
  if (m === 'cloud') localStorage.setItem('nt_last_user', JSON.stringify({ id: u.id, email: u.email }));
  // botões de IA: só para contas liberadas no servidor (tabela app_admins)
  $('.owner-only').forEach(el => el.classList.add('hidden'));
  if (m === 'cloud') {
    callFn('ai', { mode: 'access' })
      .then(r => { if (user?.id === u.id) $('.owner-only').forEach(el => el.classList.toggle('hidden', !r?.allowed)); })
      .catch(() => {});
  }
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-email').textContent = u.email || '';
  current = null;
  showEmpty();
  await store.init(u.id, m === 'cloud' ? sb : null, { offline: m === 'offline' });
  refreshDrawer();
  const last = localStorage.getItem('nt_last_note_' + u.id);
  const n = last && store.notes.get(last);
  if (n && !n.locked && !(n.folder_id && isFolderLocked(n.folder_id))) openNote(last);
  checkPendingRecovery();
}

async function logout() {
  await flushSave();
  if (mode === 'local') localStorage.removeItem('nt_local_mode');
  if (sb && mode === 'cloud') await sb.auth.signOut();
  showAuth();
}

// =====================================================================
// GAVETA
// =====================================================================
function refreshDrawer() {
  renderDrawer($('#note-list'), {
    notes: [...store.notes.values()],
    folders: [...store.folders.values()],
    activeId: current?.id,
    query: $('#search').value,
    collapsed,
    isLocked: isFolderLocked,
  }, {
    open: id => openNote(id),
    noteMenu: (id, anchor) => noteMenu(id, anchor),
    folderMenu: (id, anchor) => folderMenu(id, anchor),
    unlockFolder: id => unlockFolder(id),
    toggleFolder: id => {
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      localStorage.setItem('nt_collapsed', JSON.stringify([...collapsed]));
      refreshDrawer();
    },
    dropNote: (id, folderId) => moveNote(id, folderId),
  });
}

const folderOptions = sel => `<option value="">Sem pasta</option>` +
  [...store.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map(f => `<option value="${f.id}"${f.id === sel ? ' selected' : ''}>${esc(f.name)}</option>`).join('');

function noteMenu(id, anchor) {
  const n = store.notes.get(id);
  if (!n) return;
  menu(anchor, [
    { label: 'Abrir', icon: 'file', onClick: () => openNote(id) },
    { label: 'Renomear', icon: 'edit', onClick: () => renameNote(id) },
    { label: 'Mover para pasta', icon: 'move', onClick: () => moveNoteDialog(id) },
    n.locked
      ? { label: 'Alterar ou remover senha', icon: 'key', onClick: () => startRecovery(id) }
      : { label: 'Proteger com senha', icon: 'lock', onClick: () => setPasswordDialog(id) },
    '-',
    { label: 'Excluir', icon: 'trash', danger: true, onClick: () => deleteNote(id) },
  ]);
}

function folderMenu(id, anchor) {
  const f = store.folders.get(id);
  if (!f) return;
  if (isFolderLocked(id)) {
    return menu(anchor, [
      { label: 'Abrir pasta', icon: 'unlock', onClick: () => unlockFolder(id) },
      { label: 'Esqueci a senha da pasta', icon: 'key', onClick: () => startEmailCheck({ kind: 'folder', id }) },
      '-',
      { label: 'Excluir pasta', icon: 'trash', danger: true, onClick: () => deleteFolder(id) },
    ]);
  }
  menu(anchor, [
    { label: 'Nova anotação aqui', icon: 'plus', onClick: () => newNoteDialog({ folder_id: id }) },
    { label: 'Renomear pasta', icon: 'edit', onClick: () => renameFolder(id) },
    { label: 'Baixar como ZIP (PDFs)', icon: 'download', onClick: () => downloadFolderZip(id) },
    '-',
    f.lock
      ? { label: 'Trancar agora', icon: 'lock', onClick: () => lockFolderNow(id) }
      : { label: 'Proteger pasta com senha', icon: 'lock', onClick: () => setFolderPassword(id) },
    f.lock ? { label: 'Alterar ou remover senha', icon: 'key', onClick: () => changeFolderPassword(id) } : null,
    '-',
    { label: 'Excluir pasta', icon: 'trash', danger: true, onClick: () => deleteFolder(id) },
  ]);
}

// ---------- senha de pasta (criptografia) ----------
// Cada pasta com senha tem uma chave aleatória (AES-256) cifrada pela senha (folder.lock).
// As anotações de dentro são cifradas no aparelho: a chave de cada anotação fica cifrada
// pela chave da pasta (note.enc.fkey). Anotações com senha própria continuam com a delas.
const folderKeys = new Map(); // pastas destrancadas nesta sessão → chave da pasta
function isFolderLocked(id) {
  const f = store.folders.get(id);
  return !!(f?.lock && !folderKeys.has(id));
}
const isFolderEncrypted = n => !!n.enc?.fkey;
const notesIn = id => [...store.notes.values()].filter(n => n.folder_id === id);
const onlineForCrypto = () => !(mode === 'offline' || (mode === 'cloud' && !navigator.onLine));

async function escrowKey(kind, id, key) {
  if (mode !== 'cloud') return;
  try {
    await store.push();
    await callFn('note-key', { action: 'escrow', [kind === 'folder' ? 'folder_id' : 'note_id']: id, dek: cx.toB64(key) });
  } catch (e) {
    toast('Atenção: a recuperação por e-mail não ficou ativa (' + e.message + ').', 'err', 7000);
  }
}

// cifra uma anotação (sem senha própria) com a chave da pasta
async function encryptForFolder(n, fk, fid) {
  if (!n.hasContent) await store.loadContent(n.id);
  if (n.enc) return; // já cifrada (senha própria ou outra pasta)
  const content = n.content || emptyContent();
  const dek = cx.newDEK();
  n.enc = { folder: fid, fkey: await cx.wrapWithKey(fk, dek), ...await cx.encryptContent(dek, content) };
  n.content = null;
  n.search_text = '';
  n.hasContent = true;
  deks.set(n.id, dek);
}

// volta uma anotação cifrada pela pasta para texto aberto
async function decryptFromFolder(n, fk) {
  if (!n.hasContent) await store.loadContent(n.id);
  if (!isFolderEncrypted(n)) return;
  const dek = await cx.unwrapWithKey(fk, n.enc.fkey);
  const content = await cx.decryptContent(dek, n.enc);
  Object.assign(n, { enc: null, content, search_text: plainFromHTML(content.html).slice(0, 4000), hasContent: true });
  deks.delete(n.id);
}

async function folderKeyFor(fid) {
  if (!fid) return null;
  if (folderKeys.has(fid)) return folderKeys.get(fid);
  return (await unlockFolder(fid)) ? folderKeys.get(fid) : null;
}

/** Chave da anotação (pela pasta, pela senha própria ou do cache da sessão). */
async function getNoteDEK(n) {
  if (deks.has(n.id)) return deks.get(n.id);
  if (isFolderEncrypted(n)) {
    const fk = await folderKeyFor(n.enc.folder || n.folder_id);
    if (!fk) return null;
    const dek = await cx.unwrapWithKey(fk, n.enc.fkey);
    deks.set(n.id, dek);
    return dek;
  }
  if (n.locked) {
    const dek = await askNotePassword(n);
    if (dek) deks.set(n.id, dek);
    return dek;
  }
  return null;
}

/** Move a anotação entre pastas, cifrando/decifrando conforme a pasta de destino. */
async function relocateNote(n, toId) {
  toId = toId || null;
  if ((n.folder_id || null) === toId) return true;
  if (current?.id === n.id) await flushSave();
  try { await store.loadContent(n.id); } catch (e) { toast(e.message, 'err'); return false; }
  const dest = toId && store.folders.get(toId);
  if (!n.locked) { // anotações com senha própria não mudam
    if (isFolderEncrypted(n)) {
      const fk = await folderKeyFor(n.enc.folder || n.folder_id);
      if (!fk) return false;
      if (dest?.lock) {
        const fk2 = await folderKeyFor(toId);
        if (!fk2) return false;
        const dek = await cx.unwrapWithKey(fk, n.enc.fkey);
        n.enc = { ...n.enc, folder: toId, fkey: await cx.wrapWithKey(fk2, dek) };
      } else await decryptFromFolder(n, fk);
    } else if (dest?.lock) {
      const fk2 = await folderKeyFor(toId);
      if (!fk2) return false;
      await encryptForFolder(n, fk2, toId);
    }
  }
  n.folder_id = toId;
  await store.saveNote(n, { touch: false });
  return true;
}

async function unlockFolder(id) {
  const f = store.folders.get(id);
  if (!f || !isFolderLocked(id)) return true;
  let fk = null, legacyPw = null;
  const r = await modal({
    title: f.name,
    body: `<p class="muted">${icon('lock')} Esta pasta é protegida por senha.</p>
      <label>Senha da pasta<input type="password" name="pw" autocomplete="off"></label>
      <button type="button" class="link" data-forgot style="justify-self:start">Esqueci a senha</button>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Abrir', value: 'ok', primary: true }],
    init: (dlg, finish) => { dlg.querySelector('[data-forgot]').onclick = () => finish({ value: 'forgot' }); },
    validate: async (v, d) => {
      if (!d.pw) return 'Digite a senha.';
      if (f.lock.hash) { // pasta protegida pela versão antiga (só trava): converte na abertura
        if (!await cx.checkVerifier(f.lock, d.pw)) return 'Senha incorreta.';
        legacyPw = d.pw;
        return;
      }
      try { fk = await cx.unwrapDEK(f.lock, d.pw); } catch { return 'Senha incorreta.'; }
    },
  });
  if (r?.value === 'forgot') { startEmailCheck({ kind: 'folder', id }); return false; }
  if (!r) return false;
  if (legacyPw) {
    const t = busyToast('Criptografando as anotações da pasta…');
    try { fk = await encryptFolder(id, legacyPw); } catch (e) { toast('Não foi possível criptografar: ' + e.message, 'err', 6000); return false; }
    finally { t.close(); }
  }
  folderKeys.set(id, fk);
  collapsed.delete(id);
  refreshDrawer();
  return true;
}

// cria a chave da pasta, cifra as anotações de dentro e salva a senha
async function encryptFolder(id, pw) {
  const f = store.folders.get(id);
  const list = notesIn(id);
  for (const n of list) await store.loadContent(n.id); // garante tudo baixado antes de mudar algo
  if (list.some(n => current?.id === n.id)) await flushSave();
  const fk = cx.newDEK();
  for (const n of list) {
    if (n.locked) continue;
    await encryptForFolder(n, fk, id);
    await store.saveNote(n, { touch: false });
  }
  f.lock = await cx.wrapDEK(fk, pw);
  await store.saveFolder(f);
  await escrowKey('folder', id, fk);
  return fk;
}

// decifra as anotações de dentro e tira a senha da pasta
async function decryptFolder(id, fk) {
  const f = store.folders.get(id);
  if (notesIn(id).some(n => current?.id === n.id)) await flushSave();
  for (const n of notesIn(id)) {
    if (!isFolderEncrypted(n)) continue;
    await decryptFromFolder(n, fk);
    await store.saveNote(n, { touch: false });
  }
  f.lock = null;
  folderKeys.delete(id);
  await store.saveFolder(f);
  if (mode === 'cloud') callFn('note-key', { action: 'forget', folder_id: id }).catch(() => {});
}

function lockFolderNow(id) {
  folderKeys.delete(id);
  for (const n of notesIn(id)) if (isFolderEncrypted(n)) deks.delete(n.id);
  closeIfInFolder(id);
  refreshDrawer();
}

function closeIfInFolder(id) {
  if (current?.folder_id === id) { flushSave().then(() => { current = null; showEmpty(); }); }
}

const folderPwFields = `<label>Senha<input type="password" name="pw" autocomplete="new-password"></label>
  <label>Confirmar senha<input type="password" name="pw2" autocomplete="new-password"></label>`;
const checkPw = d => {
  if (d.pw.length < 4) return 'A senha precisa ter pelo menos 4 caracteres.';
  if (d.pw !== d.pw2) return 'As senhas não conferem.';
};

async function setFolderPassword(id) {
  if (!onlineForCrypto()) return toast('Conecte-se à internet para proteger uma pasta.', 'err');
  const f = store.folders.get(id);
  const r = await modal({
    title: 'Proteger pasta com senha',
    body: `<p class="muted">As anotações de “${esc(f.name)}” serão <b>criptografadas</b> no seu aparelho (texto, imagens e desenhos). Anotações que entrarem depois também serão.</p>
      ${folderPwFields}
      <p class="hint">${mode === 'cloud' ? 'Esqueceu? Dá para redefinir por um código enviado ao seu e-mail.' : '<b>Sem conta, não há como recuperar a senha.</b>'} O nome da pasta e os títulos das anotações continuam sem criptografia.</p>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Proteger', value: 'ok', primary: true }],
    validate: (v, d) => checkPw(d),
  });
  if (!r) return;
  const t = busyToast('Criptografando as anotações da pasta…');
  try {
    await encryptFolder(id, r.data.pw);
    lockFolderNow(id);
    toast('Pasta protegida e criptografada.');
  } catch (e) {
    toast('Não foi possível proteger a pasta: ' + e.message, 'err', 6000);
  } finally { t.close(); }
}

async function changeFolderPassword(id) {
  const f = store.folders.get(id);
  let fk = null;
  const r = await modal({
    title: `Senha da pasta “${f.name}”`,
    body: `<label>Senha atual<input type="password" name="cur" autocomplete="current-password"></label>
      <label>Nova senha (deixe em branco para remover a proteção)<input type="password" name="pw" autocomplete="new-password"></label>
      <label>Confirmar nova senha<input type="password" name="pw2" autocomplete="new-password"></label>
      <button type="button" class="link" data-forgot style="justify-self:start">Esqueci a senha atual</button>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Salvar', value: 'ok', primary: true }],
    init: (dlg, finish) => { dlg.querySelector('[data-forgot]').onclick = () => finish({ value: 'forgot' }); },
    validate: async (v, d) => {
      try { fk = await cx.unwrapDEK(f.lock, d.cur); } catch { return 'Senha atual incorreta.'; }
      if (d.pw || d.pw2) return checkPw(d);
    },
  });
  if (r?.value === 'forgot') return startEmailCheck({ kind: 'folder', id });
  if (!r) return;
  await applyFolderPassword(id, fk, r.data.pw || null);
}

// nova senha → recifra só a chave da pasta; sem senha → decifra as anotações
async function applyFolderPassword(id, fk, newPw) {
  const f = store.folders.get(id);
  const t = busyToast(newPw ? 'Salvando a nova senha…' : 'Removendo a criptografia da pasta…');
  try {
    if (newPw) {
      f.lock = await cx.wrapDEK(fk, newPw);
      folderKeys.set(id, fk);
      await store.saveFolder(f);
      toast('Senha da pasta alterada.');
    } else {
      await decryptFolder(id, fk);
      toast('Proteção da pasta removida.');
    }
  } catch (e) {
    toast('Não foi possível concluir: ' + e.message, 'err', 6000);
  } finally { t.close(); refreshDrawer(); }
}

async function finishFolderRecovery(id) {
  localStorage.removeItem('nt_recover');
  const f = store.folders.get(id);
  if (!f) return toast('Pasta não encontrada.', 'err');
  let fk = null;
  if (!f.lock?.hash) { // versão antiga não tinha chave guardada
    try { fk = cx.fromB64((await callFn('note-key', { action: 'recover', folder_id: id })).dek); }
    catch (e) { return toast('Não foi possível recuperar: ' + e.message, 'err', 6000); }
  }
  const r = await modal({
    title: 'E-mail confirmado',
    body: `<p>Defina uma nova senha para a pasta “${esc(f.name)}” ou remova a proteção.</p>${folderPwFields}`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Remover senha', value: 'remove', danger: true, left: true }, { label: 'Salvar nova senha', value: 'save', primary: true }],
    validate: (v, d) => (v === 'save' ? checkPw(d) : undefined),
  });
  if (!r) return;
  if (!fk) { // pasta da versão antiga: as anotações ainda não estavam cifradas
    if (r.value === 'save') {
      const k = await encryptFolder(id, r.data.pw);
      folderKeys.set(id, k);
      toast('Senha da pasta alterada e anotações criptografadas.');
    } else {
      f.lock = null;
      await store.saveFolder(f);
      toast('Proteção da pasta removida.');
    }
    return refreshDrawer();
  }
  await applyFolderPassword(id, fk, r.value === 'save' ? r.data.pw : null);
}

// ---------- baixar pasta como ZIP de PDFs ----------
const loadScript = src => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = () => rej(new Error('Não foi possível carregar ' + src));
  document.head.append(s);
});
async function loadPdfLibs() {
  await Promise.all([
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),
  ]);
}

const safeName = s => (s || 'Sem título').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sem título';

async function noteContentFor(n) {
  await store.loadContent(n.id);
  if (!n.enc) return n.content || emptyContent();
  const dek = await getNoteDEK(n);
  return dek ? cx.decryptContent(dek, n.enc) : null;
}

async function downloadFolderZip(id) {
  const wasLocked = isFolderLocked(id);
  if (!await unlockFolder(id)) return;
  try { await buildFolderZip(id); }
  finally {
    // senhas digitadas só para exportar não ficam guardadas
    for (const n of notesIn(id)) if (n.locked && n.id !== current?.id) deks.delete(n.id);
    if (wasLocked && current?.folder_id !== id) { forgetFolderKey(id); refreshDrawer(); }
  }
}

async function buildFolderZip(id) {
  await flushSave();
  const f = store.folders.get(id);
  const notes = [...store.notes.values()].filter(n => n.folder_id === id).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  if (!notes.length) return toast('Esta pasta está vazia.');
  const t = busyToast('Preparando o ZIP…');
  try {
    await loadPdfLibs();
    const zip = new JSZip();
    const used = new Set();
    const skipped = [];
    for (const [i, n] of notes.entries()) {
      t.querySelector('span:last-child').textContent = `Gerando PDF ${i + 1} de ${notes.length}: ${n.title}`;
      let content;
      try { content = await noteContentFor(n); } catch { content = null; }
      if (!content) { skipped.push(n.title); continue; }
      let name = safeName(n.title), k = 2;
      while (used.has(name.toLowerCase())) name = `${safeName(n.title)} (${k++})`;
      used.add(name.toLowerCase());
      zip.file(name + '.pdf', await notePdf(n.title, content));
    }
    if (!used.size) return toast('Nenhuma anotação foi incluída.', 'err');
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName(f.name) + '.zip';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(skipped.length ? `ZIP baixado. Ficaram de fora (senha não informada): ${skipped.join(', ')}` : 'ZIP baixado.', 'info', 6000);
  } catch (e) {
    toast('Não foi possível gerar o ZIP: ' + e.message, 'err', 6000);
  } finally { t.close(); }
}

// Renderiza a anotação (texto, código, imagens e desenhos) fora da tela e converte em PDF A4.
async function notePdf(title, c) {
  const W = 880;
  const box = document.createElement('div');
  box.className = 'pdf-render';
  const style = c.style || {};
  box.style.cssText = `position:fixed;left:-10000px;top:0;width:${W}px;background:${style.bg || '#ffffff'};color:${style.color || '#1d2433'};`;
  box.innerHTML = `<h1 class="pdf-title">${esc(title)}</h1><div class="pdf-page"><div class="layer pdf-under"></div><div class="doc"></div><div class="layer pdf-over"></div></div>`;
  const doc = box.querySelector('.doc');
  doc.innerHTML = ed.sanitize(c.html || '');
  if (style.font) doc.style.fontFamily = style.font;
  if (style.size) doc.style.fontSize = style.size + 'px';
  doc.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code') || pre;
    const lang = ed.normLang(pre.dataset.lang);
    const map = { html: 'xml', text: 'plaintext' };
    try { code.innerHTML = hljs.highlight(code.textContent, { language: map[lang] || lang, ignoreIllegals: true }).value; } catch {}
    pre.className = 'pdf-code hljs';
  });
  ob.renderInto(c.objects || [], box.querySelector('.pdf-under'), box.querySelector('.pdf-over'));
  document.body.append(box);
  try {
    await Promise.all([...box.querySelectorAll('img')].map(img => img.complete ? 0 : new Promise(r => { img.onload = img.onerror = r; })));
    const canvas = await html2canvas(box, { scale: 2, backgroundColor: style.bg || '#ffffff', useCORS: true, logging: false });
    const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = 210, pageH = 297, margin = 10;
    const imgW = pageW - margin * 2;
    const pxPerMm = canvas.width / imgW;
    const sliceH = Math.floor((pageH - margin * 2) * pxPerMm);
    for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
      const h = Math.min(sliceH, canvas.height - y);
      const part = document.createElement('canvas');
      part.width = canvas.width; part.height = h;
      const ctx = part.getContext('2d');
      ctx.fillStyle = style.bg || '#ffffff';
      ctx.fillRect(0, 0, part.width, h);
      ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (page) pdf.addPage();
      if (style.bg) { pdf.setFillColor(style.bg); pdf.rect(0, 0, pageW, pageH, 'F'); }
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, h / pxPerMm);
    }
    return pdf.output('arraybuffer');
  } finally { box.remove(); }
}

async function newFolderDialog() {
  const r = await modal({
    title: 'Nova pasta',
    body: `<label>Nome<input name="name" maxlength="60" placeholder="Ex.: Matemática"></label>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Criar', value: 'ok', primary: true }],
    validate: (v, d) => { if (!d.name.trim()) return 'Dê um nome para a pasta.'; },
  });
  if (r) await store.createFolder(r.data.name.trim());
}

async function renameFolder(id) {
  const f = store.folders.get(id);
  const r = await modal({
    title: 'Renomear pasta',
    body: `<label>Nome<input name="name" maxlength="60" value="${esc(f.name)}"></label>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Salvar', value: 'ok', primary: true }],
    validate: (v, d) => { if (!d.name.trim()) return 'Dê um nome para a pasta.'; },
  });
  if (r) { f.name = r.data.name.trim(); await store.saveFolder(f); }
}

async function deleteFolder(id) {
  if (!await unlockFolder(id)) return;
  const f = store.folders.get(id);
  if (!await confirmDialog('Excluir pasta', `Excluir a pasta “${f.name}”? As anotações dela não são apagadas, vão para “Sem pasta”${f.lock ? ' (e deixam de ser criptografadas pela pasta)' : ''}.`, 'Excluir', true)) return;
  // sem a pasta não haveria como decifrar: as anotações voltam a ser texto aberto antes
  if (f.lock) {
    const t = busyToast('Removendo a criptografia das anotações…');
    try { await decryptFolder(id, folderKeys.get(id)); }
    catch (e) { return toast('Não foi possível excluir: ' + e.message, 'err', 6000); }
    finally { t.close(); }
  }
  await store.deleteFolder(id);
}

async function renameNote(id) {
  const n = store.notes.get(id);
  const r = await modal({
    title: 'Renomear anotação',
    body: `<label>Título<input name="title" maxlength="120" value="${esc(n.title)}"></label>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Salvar', value: 'ok', primary: true }],
    validate: (v, d) => { if (!d.title.trim()) return 'O título não pode ficar vazio.'; },
  });
  if (!r) return;
  n.title = r.data.title.trim();
  if (current?.id === id) $('#title').value = n.title;
  await store.saveNote(n);
}

async function moveNote(id, folderId) {
  const n = store.notes.get(id);
  if (!n || (n.folder_id || null) === (folderId || null)) return;
  if (await relocateNote(n, folderId) && store.folders.get(folderId)?.lock && !n.locked) toast('Anotação criptografada pela pasta.');
}

async function moveNoteDialog(id) {
  const n = store.notes.get(id);
  const r = await modal({
    title: 'Mover para pasta',
    body: `<label>Pasta<select name="folder">${folderOptions(n.folder_id)}</select></label>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Mover', value: 'ok', primary: true }],
  });
  if (r) await moveNote(id, r.data.folder || null);
}

async function deleteNote(id) {
  const n = store.notes.get(id);
  if (!await confirmDialog('Excluir anotação', `Excluir “${n.title}” para sempre? Isso não pode ser desfeito.`, 'Excluir', true)) return;
  if (current?.id === id) { unsaved = false; saveSoon.cancel(); current = null; showEmpty(); }
  deks.delete(id);
  await store.deleteNote(id);
  toast('Anotação excluída.');
}

// =====================================================================
// CRIAR / ABRIR / SALVAR
// =====================================================================
async function newNoteDialog(preset = {}) {
  const cloud = mode === 'cloud';
  const r = await modal({
    title: 'Nova anotação',
    body: `<label>Título<input name="title" maxlength="120" value="${esc(preset.title || '')}" placeholder="Ex.: Revisão de Biologia"></label>
      <label>Pasta<select name="folder">${folderOptions(preset.folder_id)}</select></label>
      <details class="pw-box"><summary>${icon('lock')} Proteger com senha (opcional)</summary>
        <label>Senha<input type="password" name="pw" autocomplete="new-password"></label>
        <label>Confirmar senha<input type="password" name="pw2" autocomplete="new-password"></label>
        <p class="hint">${cloud
          ? 'O conteúdo é criptografado no seu aparelho. Para trocar ou recuperar a senha, enviaremos um link ao seu e-mail de login.'
          : 'O conteúdo é criptografado no seu aparelho. <b>Sem conta, não há como recuperar a senha.</b>'}</p>
      </details>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Criar', value: 'ok', primary: true }],
    validate: (v, d) => {
      if (!d.title.trim()) return 'Dê um título para a anotação.';
      if (d.pw || d.pw2) {
        if (d.pw.length < 4) return 'A senha precisa ter pelo menos 4 caracteres.';
        if (d.pw !== d.pw2) return 'As senhas não conferem.';
        if (mode === 'offline' || (cloud && !navigator.onLine)) return 'Para criar uma anotação com senha é preciso estar conectado.';
      }
    },
  });
  if (!r) return;
  await createNote({ title: r.data.title.trim(), folder_id: r.data.folder || null, password: r.data.pw || null, content: preset.content });
}

async function createNote({ title, folder_id = null, password = null, content = null, open = true }) {
  await flushSave();
  content ||= emptyContent();
  const n = { id: crypto.randomUUID(), title, folder_id, locked: !!password, content: null, enc: null, search_text: '', hasContent: true };
  if (password) {
    const dek = cx.newDEK();
    n.enc = { ...await cx.wrapDEK(dek, password), ...await cx.encryptContent(dek, content) };
    deks.set(n.id, dek);
    await store.saveNote(n);
    await escrow(n.id, dek);
  } else {
    n.content = content;
    n.search_text = plainFromHTML(content.html).slice(0, 4000);
    // criada dentro de pasta com senha: já nasce criptografada pela pasta
    const dest = folder_id && store.folders.get(folder_id);
    if (dest?.lock) {
      const fk = await folderKeyFor(folder_id);
      if (fk) await encryptForFolder(n, fk, folder_id);
      else n.folder_id = null;
    }
    await store.saveNote(n);
  }
  if (open) { await openNote(n.id); ed.focus(); }
  return n;
}

async function openNote(id) {
  closeDrawerMobile();
  if (current?.id === id) return;
  await flushSave();
  const n = store.notes.get(id);
  if (!n) return;
  if (n.folder_id && isFolderLocked(n.folder_id) && !await unlockFolder(n.folder_id)) return;
  try { await store.loadContent(id); } catch (e) { return toast(e.message, 'err', 5000); }
  let content;
  if (n.enc) {
    const dek = await getNoteDEK(n);
    if (!dek) return;
    try { content = await cx.decryptContent(dek, n.enc); }
    catch { deks.delete(id); return toast('Não foi possível abrir: senha ou dados inválidos.', 'err'); }
  } else content = n.content || emptyContent();
  const prev = current;
  current = n;
  forgetKeysOnLeave(prev, n);
  loadIntoEditor(content);
  localStorage.setItem('nt_last_note_' + user.id, id);
  refreshDrawer();
}

// Ao sair de uma anotação protegida, esquece a chave dela: para voltar, pede a senha de novo.
// Ao sair de uma pasta com senha (abrindo algo de fora), a pasta se tranca.
function forgetKeysOnLeave(prev, next) {
  if (!prev || prev.id === next?.id) return;
  if (prev.locked) deks.delete(prev.id);
  const fid = prev.folder_id;
  if (fid && store.folders.get(fid)?.lock && next?.folder_id !== fid) forgetFolderKey(fid);
}

function forgetFolderKey(fid) {
  folderKeys.delete(fid);
  for (const n of notesIn(fid)) if (isFolderEncrypted(n) && n.id !== current?.id) deks.delete(n.id);
}

// Tranca tudo (chaves fora da memória) e fecha a anotação protegida que estiver aberta.
async function lockEverything() {
  if (!current && !deks.size && !folderKeys.size) return;
  await flushSave();
  const wasProtected = current?.enc;
  deks.clear();
  folderKeys.clear();
  if (wasProtected) { current = null; showEmpty(); } else refreshDrawer();
}

function loadIntoEditor(c) {
  noteStyle = { ...(c.style || {}) };
  $('#page').classList.remove('hidden');
  $('#empty-state').classList.add('hidden');
  ed.setHTML(c.html || '');
  ed.applyNoteStyle(noteStyle);
  ob.setObjects(c.objects || []);
  $('#title').value = current.title;
  $('#title').disabled = false;
  $('#note-menu').disabled = false;
  $('#lock-badge').classList.toggle('hidden', !current.locked);
  hist.stack = []; hist.idx = -1;
  pushHistory();
  unsaved = false;
  $('#workspace').scrollTop = 0;
}

function showEmpty() {
  $('#page').classList.add('hidden');
  $('#empty-state').classList.remove('hidden');
  $('#title').value = '';
  $('#title').disabled = true;
  $('#note-menu').disabled = true;
  $('#lock-badge').classList.add('hidden');
  ob.setObjects([]);
  refreshDrawer();
}

const saveSoon = debounce(() => saveCurrent(), 700);
function markDirty() { if (!current) return; unsaved = true; saveSoon(); }
async function flushSave() { if (unsaved) await saveCurrent(); }

async function saveCurrent() {
  saveSoon.cancel();
  if (!current) return;
  unsaved = false;
  const n = current;
  const content = { v: 1, html: ed.getHTML(), style: noteStyle, objects: ob.getObjects() };
  n.title = $('#title').value.trim() || 'Sem título';
  if (n.enc) {
    const dek = deks.get(n.id);
    if (!dek) return;
    Object.assign(n.enc, await cx.encryptContent(dek, content));
    n.content = null;
    n.search_text = '';
  } else {
    n.content = content;
    n.enc = null;
    n.search_text = plainFromHTML(content.html).slice(0, 4000);
  }
  n.hasContent = true;
  await store.saveNote(n);
}

// alterações vindas de outro aparelho
store.on('remote', async ids => {
  if (!current || !ids.includes(current.id) || unsaved) return;
  const fresh = store.notes.get(current.id);
  if (!fresh) { toast('Esta anotação foi excluída em outro aparelho.'); current = null; return showEmpty(); }
  try {
    await store.loadContent(fresh.id);
    const content = fresh.enc ? await cx.decryptContent(deks.get(fresh.id), fresh.enc) : fresh.content;
    const top = $('#workspace').scrollTop;
    current = fresh;
    loadIntoEditor(content || emptyContent());
    $('#workspace').scrollTop = top;
  } catch { /* mantém o que está na tela */ }
});
store.on('change', () => refreshDrawer());
store.on('status', ({ status }) => {
  const map = {
    syncing: ['cloud', 'Sincronizando…', ''], synced: ['cloud-check', 'Sincronizado', 'ok'], pending: ['cloud', 'Salvando…', ''],
    offline: ['cloud-off', 'Offline — salvo no aparelho', ''], error: ['cloud-off', 'Erro ao sincronizar', 'err'],
    local: ['device', 'Salvo neste aparelho', ''], idle: ['cloud', '', ''],
  };
  const [ic, label, cls] = map[status] || map.idle;
  const el = $('#sync-status');
  el.className = 'sync ' + cls;
  el.innerHTML = icon(ic) + `<span>${label}</span>`;
  el.title = status === 'error' ? 'Tentaremos de novo automaticamente.' : '';
});

// =====================================================================
// SENHAS DAS ANOTAÇÕES
// =====================================================================
async function askNotePassword(n) {
  let dek = null;
  const r = await modal({
    title: n.title,
    body: `<p class="muted">${icon('lock')} Esta anotação é protegida por senha.</p>
      <label>Senha<input type="password" name="pw" autocomplete="off"></label>
      <button type="button" class="link" data-forgot style="justify-self:start">Esqueci a senha</button>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Abrir', value: 'ok', primary: true }],
    init: (dlg, finish) => { dlg.querySelector('[data-forgot]').onclick = () => finish({ value: 'forgot' }); },
    validate: async (v, d) => {
      if (!d.pw) return 'Digite a senha.';
      try { dek = await cx.unwrapDEK(n.enc, d.pw); } catch { return 'Senha incorreta.'; }
    },
  });
  if (r?.value === 'forgot') { startRecovery(n.id); return null; }
  return r ? dek : null;
}

async function setPasswordDialog(id) {
  if (mode === 'offline' || (mode === 'cloud' && !navigator.onLine)) return toast('Conecte-se à internet para definir uma senha.', 'err');
  if (current?.id === id) await flushSave();
  const n = store.notes.get(id);
  const r = await modal({
    title: 'Proteger com senha',
    body: `<p class="muted">“${esc(n.title)}” será criptografada no seu aparelho. O título continua visível na Gaveta.</p>
      <label>Senha<input type="password" name="pw" autocomplete="new-password"></label>
      <label>Confirmar senha<input type="password" name="pw2" autocomplete="new-password"></label>
      <p class="hint">${mode === 'cloud' ? 'Para trocar ou recuperar, enviaremos um link ao seu e-mail de login.' : 'Sem conta, não há como recuperar a senha.'}</p>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Proteger', value: 'ok', primary: true }],
    validate: (v, d) => {
      if (d.pw.length < 4) return 'A senha precisa ter pelo menos 4 caracteres.';
      if (d.pw !== d.pw2) return 'As senhas não conferem.';
    },
  });
  if (!r) return;
  try { await store.loadContent(id); } catch (e) { return toast(e.message, 'err'); }
  // se estava cifrada pela pasta, decifra antes de passar a usar a senha própria
  let content = n.content || emptyContent();
  if (n.enc) {
    const old = await getNoteDEK(n);
    if (!old) return;
    content = await cx.decryptContent(old, n.enc);
  }
  const dek = cx.newDEK();
  n.enc = { ...await cx.wrapDEK(dek, r.data.pw), ...await cx.encryptContent(dek, content) };
  n.locked = true;
  n.content = null;
  n.search_text = '';
  deks.set(id, dek);
  await store.saveNote(n);
  if (current?.id === id) $('#lock-badge').classList.remove('hidden');
  await escrow(id, dek);
  toast('Anotação protegida.');
}

function lockNow() {
  if (!current) return;
  const id = current.id;
  flushSave().then(() => {
    deks.delete(id);
    current = null;
    showEmpty();
    toast('Anotação trancada.');
  });
}

// Guarda no servidor uma cópia da chave cifrada com um segredo do servidor,
// para permitir a recuperação por e-mail (ver supabase/functions/note-key).
async function escrow(noteId, dek) {
  if (mode !== 'cloud') return;
  try {
    await store.push();
    await callFn('note-key', { action: 'escrow', note_id: noteId, dek: cx.toB64(dek) });
  } catch (e) {
    toast('Atenção: a recuperação por e-mail não ficou ativa para esta anotação (' + e.message + ').', 'err', 7000);
  }
}

async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// --- recuperar / alterar senha via e-mail ---
const startRecovery = noteId => startEmailCheck({ kind: 'note', id: noteId });

// Confirma a identidade por e-mail (link ou código) antes de trocar/recuperar uma senha.
// target: { kind: 'note' | 'folder', id }
async function startEmailCheck(target) {
  if (mode !== 'cloud' || !sb) return toast('Alterar ou recuperar senha exige estar conectado à sua conta.', 'err');
  const email = user.email;
  const name = target.kind === 'folder'
    ? `a pasta “${store.folders.get(target.id)?.name || ''}”`
    : `“${store.notes.get(target.id)?.title || ''}”`;
  localStorage.setItem('nt_recover', JSON.stringify({ ...target, uid: user.id, ts: Date.now() }));
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: appUrl() } });
  if (error) return toast(translateAuth(error.message), 'err', 6000);
  const r = await modal({
    title: 'Confirme pelo seu e-mail',
    body: `<p>Para alterar ou recuperar a senha de ${esc(name)}, enviamos um e-mail para <b>${esc(email)}</b>.</p>
      <p class="muted">Abra o link do e-mail <b>neste aparelho</b>. Se o e-mail trouxer um código, você pode digitá-lo aqui.</p>
      <label>Código (opcional)<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10"></label>`,
    buttons: [{ label: 'Fechar', cancel: true }, { label: 'Verificar código', value: 'ok', primary: true }],
    validate: async (v, d) => {
      if (!d.code.trim()) return 'Digite o código ou clique no link do e-mail.';
      const { error } = await sb.auth.verifyOtp({ email, token: d.code.trim(), type: 'email' });
      if (error) return 'Código inválido ou expirado.';
    },
  });
  if (r) finishTarget(target);
}

function finishTarget(t) {
  if (t.kind === 'folder') finishFolderRecovery(t.id);
  else finishRecovery(t.id ?? t.noteId);
}

function jwtClaims(t) {
  try {
    const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p.padEnd(Math.ceil(p.length / 4) * 4, '=')));
  } catch { return {}; }
}

async function checkPendingRecovery() {
  if (mode !== 'cloud' || !sb) return;
  const p = JSON.parse(localStorage.getItem('nt_recover') || 'null');
  if (!p || p.uid !== user.id) return;
  if (Date.now() - p.ts > 60 * 60 * 1000) return localStorage.removeItem('nt_recover');
  const { data: { session } } = await sb.auth.getSession();
  const amr = jwtClaims(session?.access_token || '').amr || [];
  const recent = amr.some(a => ['otp', 'magiclink'].includes(a.method) && Date.now() / 1000 - a.timestamp < 15 * 60);
  if (recent) finishTarget(p);
}

let recovering = false;
async function finishRecovery(noteId) {
  if (recovering) return;
  recovering = true;
  localStorage.removeItem('nt_recover');
  try {
    if (current?.id === noteId) await flushSave();
    const n = store.notes.get(noteId);
    if (!n) throw new Error('anotação não encontrada');
    await store.loadContent(noteId);
    const { dek: dekB64 } = await callFn('note-key', { action: 'recover', note_id: noteId });
    const dek = cx.fromB64(dekB64);
    const content = await cx.decryptContent(dek, n.enc);
    const r = await modal({
      title: 'E-mail confirmado',
      body: `<p>Defina uma nova senha para “${esc(n.title)}” ou remova a proteção.</p>
        <label>Nova senha<input type="password" name="pw" autocomplete="new-password"></label>
        <label>Confirmar nova senha<input type="password" name="pw2" autocomplete="new-password"></label>`,
      buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Remover senha', value: 'remove', danger: true, left: true }, { label: 'Salvar nova senha', value: 'save', primary: true }],
      validate: (v, d) => {
        if (v !== 'save') return;
        if (d.pw.length < 4) return 'A senha precisa ter pelo menos 4 caracteres.';
        if (d.pw !== d.pw2) return 'As senhas não conferem.';
      },
    });
    if (!r) return;
    if (r.value === 'remove') {
      // dentro de pasta com senha, ela volta a ser cifrada pela pasta (e não texto aberto)
      const inLocked = n.folder_id && store.folders.get(n.folder_id)?.lock;
      const fk = inLocked ? await folderKeyFor(n.folder_id) : null;
      if (inLocked && !fk) return;
      Object.assign(n, { locked: false, enc: null, content, search_text: plainFromHTML(content.html).slice(0, 4000) });
      deks.delete(noteId);
      if (fk) await encryptForFolder(n, fk, n.folder_id);
      await store.saveNote(n);
      await store.push();
      callFn('note-key', { action: 'forget', note_id: noteId }).catch(() => {});
      toast('Senha removida.');
    } else {
      // a chave do conteúdo continua a mesma: só recifra a chave com a nova senha
      n.enc = { ...n.enc, ...await cx.wrapDEK(dek, r.data.pw) };
      deks.set(noteId, dek);
      await store.saveNote(n);
      toast('Senha alterada.');
    }
    if (current?.id === noteId) current = null;
    await openNote(noteId);
  } catch (e) {
    toast('Não foi possível concluir: ' + e.message, 'err', 6000);
  } finally { recovering = false; }
}

// =====================================================================
// HISTÓRICO (desfazer/refazer)
// =====================================================================
function snap() { return { html: ed.getHTML(), style: { ...noteStyle }, objects: ob.getObjects().map(ob.cloneObj) }; }
const sig = s => s.html + JSON.stringify(s.style) + JSON.stringify(s.objects, (k, v) => k === 'src' ? v.length + v.slice(-32) : v);

function pushHistory() {
  if (!current) return;
  const s = snap();
  s.sig = sig(s);
  if (hist.stack[hist.idx]?.sig === s.sig) return;
  hist.stack.length = hist.idx + 1;
  hist.stack.push(s);
  if (hist.stack.length > 60) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
  updateUndo();
}
const textHistory = debounce(pushHistory, 600);

function restore(s) {
  noteStyle = { ...s.style };
  ed.setHTML(s.html);
  ed.applyNoteStyle(noteStyle);
  ob.setObjects(s.objects.map(ob.cloneObj));
  markDirty();
  updateUndo();
}
function undo() { textHistory.flush(); if (hist.idx > 0) restore(hist.stack[--hist.idx]); }
function redo() { if (hist.idx < hist.stack.length - 1) restore(hist.stack[++hist.idx]); }
function updateUndo() {
  $('#undo').disabled = hist.idx <= 0;
  $('#redo').disabled = hist.idx >= hist.stack.length - 1;
}

// =====================================================================
// IMAGENS, COLAR, ARRASTAR
// =====================================================================
function visibleSpot() {
  const page = $('#page').getBoundingClientRect(), ws = $('#workspace').getBoundingClientRect();
  return { x: page.width / 2, y: Math.max(40, ws.top - page.top + ws.height / 3) };
}

async function addImages(files, at) {
  if (!current) return toast('Abra ou crie uma anotação primeiro.', 'err');
  let i = 0;
  for (const f of files) {
    try {
      const { src, w, h } = await compressImage(f);
      const spot = at || visibleSpot();
      ob.addImage(src, w, h, { x: spot.x + i * 24, y: spot.y + i * 24 });
      i++;
    } catch { toast(`Não foi possível ler ${f.name}.`, 'err'); }
  }
}

async function importFiles(files, { intoCurrent = false } = {}) {
  if (intoCurrent && current) {
    for (const f of files) {
      try { ed.appendHTML(await fileToHTML(f)); } catch (e) { toast(e.message, 'err'); }
    }
    return;
  }
  const { notes, errors } = await filesToNotes(files);
  errors.forEach(e => toast(e, 'err', 5000));
  let last = null;
  for (const n of notes) {
    last = await createNote({ title: n.title, content: { ...emptyContent(), html: n.html }, open: false });
  }
  if (last) {
    toast(notes.length === 1 ? 'Arquivo importado.' : `${notes.length} arquivos importados.`);
    await openNote(last.id);
  }
}

// =====================================================================
// IA
// =====================================================================
const AI_ACTIONS = [
  ['Organizar', 'Organize esta anotação em seções lógicas com títulos e tópicos, agrupando ideias relacionadas, sem perder nenhuma informação.'],
  ['Formatar', 'Melhore a formatação: títulos e subtítulos, listas, negrito nos termos-chave e parágrafos curtos. Não mude o sentido do texto.'],
  ['Resumir', 'Adicione no início um resumo em tópicos com os pontos principais e mantenha o conteúdo original abaixo dele.'],
  ['Corrigir texto', 'Corrija ortografia, acentuação, pontuação e gramática, sem mudar o estilo nem o conteúdo.'],
  ['Perguntas de estudo', 'Adicione ao final uma seção “Perguntas para revisão” com 5 a 10 perguntas e respostas curtas baseadas no conteúdo.'],
];

async function aiNoteDialog() {
  if (!current) return toast('Abra uma anotação primeiro.', 'err');
  if (!navigator.onLine) return toast('A IA precisa de internet.', 'err');
  const r = await modal({
    title: 'IA — esta anotação',
    wide: true,
    body: `<div class="chips">${AI_ACTIONS.map(([l, p]) => `<button type="button" class="chip" data-p="${esc(p)}">${l}</button>`).join('')}</div>
      <label>O que a IA deve fazer?<textarea name="instruction" rows="4" placeholder="Ex.: organize em tópicos e destaque as fórmulas importantes"></textarea></label>
      <p class="hint">Imagens e desenhos não são enviados nem alterados; só o texto e os blocos de código.</p>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Gerar', value: 'ok', primary: true }],
    init: dlg => dlg.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      dlg.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
      dlg.querySelector('textarea').value = c.dataset.p;
    }),
    validate: (v, d) => { if (!d.instruction.trim()) return 'Escolha uma ação ou escreva um pedido.'; },
  });
  if (!r) return;
  const noteId = current.id;
  const t = busyToast('A IA está trabalhando…');
  let res;
  try { res = await callFn('ai', { mode: 'note', instruction: r.data.instruction.trim(), title: current.title, html: ed.getHTML() }); }
  catch (e) { return toast('IA: ' + e.message, 'err', 6000); }
  finally { t.close(); }
  if (current?.id !== noteId) return;
  const html = ed.sanitize(res.html || '');
  const preview = await modal({
    title: 'Sugestão da IA',
    wide: true,
    body: `${res.summary ? `<p class="muted">${esc(res.summary)}</p>` : ''}<div class="ai-preview">${html}</div>`,
    buttons: [{ label: 'Descartar', cancel: true }, { label: 'Inserir no final', value: 'append' }, { label: 'Substituir texto', value: 'replace', primary: true }],
  });
  if (!preview) return;
  pushHistory();
  if (preview.value === 'replace') ed.setHTML(html); else ed.appendHTML('<hr>' + html);
  pushHistory();
  markDirty();
  toast('Pronto! Use Desfazer se não gostar.');
}

async function aiDrawerDialog() {
  if (!navigator.onLine) return toast('A IA precisa de internet.', 'err');
  // anotações de pastas trancadas ficam de fora da organização
  const all = [...store.notes.values()].filter(n => !(n.folder_id && isFolderLocked(n.folder_id)));
  if (!all.length) return toast('A Gaveta está vazia.');
  const r = await modal({
    title: 'IA — organizar a Gaveta',
    body: `<p class="muted">A IA vai sugerir pastas e títulos para suas ${all.length} anotações. Você confere antes de aplicar.</p>
      <label>Preferências (opcional)<textarea name="instruction" rows="3" placeholder="Ex.: separe por matéria da faculdade"></textarea></label>
      <p class="hint">Das anotações com senha, só o título é enviado.</p>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Sugerir organização', value: 'ok', primary: true }],
  });
  if (!r) return;
  await flushSave();
  const folderName = id => store.folders.get(id)?.name || null;
  const payload = all.map(n => ({ id: n.id, title: n.title, folder: folderName(n.folder_id), locked: !!n.locked, snippet: n.locked ? '' : (n.search_text || '').slice(0, 400) }));
  const t = busyToast('A IA está organizando…');
  let plan;
  try { plan = await callFn('ai', { mode: 'drawer', instruction: r.data.instruction.trim(), notes: payload, folders: [...store.folders.values()].map(f => f.name) }); }
  catch (e) { return toast('IA: ' + e.message, 'err', 6000); }
  finally { t.close(); }

  const items = (plan.notes || []).filter(x => store.notes.has(x.id));
  const groups = new Map();
  for (const x of items) {
    const k = x.folder || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const html = [...groups].sort(([a], [b]) => (a || '~').localeCompare(b || '~', 'pt-BR')).map(([f, list]) => `<div class="grp"><b>${icon(f ? 'folder' : 'file')}${esc(f || 'Sem pasta')}</b><ul>${list.map(x => {
    const old = store.notes.get(x.id).title, nt = (x.title || '').trim();
    return `<li>${nt && nt !== old ? `<span class="old">${esc(old)}</span>${esc(nt)}` : esc(old)}</li>`;
  }).join('')}</ul></div>`).join('');
  const ok = await modal({
    title: 'Organização sugerida',
    wide: true,
    body: `${plan.summary ? `<p class="muted">${esc(plan.summary)}</p>` : ''}<div class="ai-plan">${html || '<p>Nenhuma mudança sugerida.</p>'}</div>
      <label class="chk"><input type="checkbox" name="titles" checked> Aplicar os novos títulos</label>
      <label class="chk"><input type="checkbox" name="cleanup"> Excluir pastas que ficarem vazias</label>`,
    buttons: [{ label: 'Cancelar', cancel: true }, { label: 'Aplicar', value: 'ok', primary: true }],
  });
  if (!ok) return;
  const byName = new Map([...store.folders.values()].map(f => [f.name.trim().toLowerCase(), f]));
  for (const x of items) {
    const n = store.notes.get(x.id);
    let folderId = null;
    const name = (x.folder || '').trim().slice(0, 60);
    if (name) {
      let f = byName.get(name.toLowerCase());
      if (!f) { f = await store.createFolder(name); byName.set(name.toLowerCase(), f); }
      folderId = f.id;
    }
    const newTitle = ok.data.titles && x.title?.trim() ? x.title.trim().slice(0, 120) : n.title;
    if (n.title !== newTitle) {
      n.title = newTitle;
      if (current?.id === n.id) $('#title').value = newTitle;
      await store.saveNote(n, { touch: false });
    }
    // mover cifra/decifra se a pasta de origem ou destino tiver senha
    if ((n.folder_id || null) !== folderId) await relocateNote(n, folderId);
  }
  if (ok.data.cleanup) {
    for (const f of [...store.folders.values()]) {
      if (![...store.notes.values()].some(n => n.folder_id === f.id)) await store.deleteFolder(f.id);
    }
  }
  toast('Gaveta organizada.');
}

// =====================================================================
// PDF
// =====================================================================
async function exportPDF() {
  if (!current) return;
  await flushSave();
  ob.select(null);
  const w = $('#page').offsetWidth;
  document.documentElement.style.setProperty('--print-w', w + 'px');
  document.documentElement.style.setProperty('--print-zoom', Math.min(1, 700 / w));
  $('#print-title').textContent = current.title;
  const old = document.title;
  document.title = current.title;
  setTimeout(() => { window.print(); document.title = old; }, 50);
}

// =====================================================================
// LIGAÇÕES DA INTERFACE
// =====================================================================
function closeDrawerMobile() { $('#app').classList.remove('drawer-open'); }

function bindApp() {
  // ---- editor e objetos ----
  ed.init($('#editor'), $('#page'), {
    onChange: () => { markDirty(); textHistory(); },
    onFormat: () => { markDirty(); pushHistory(); },
    onSelection: updateFormatState,
  });
  ob.init({ page: $('#page'), under: $('#layer-under'), over: $('#layer-over'), surface: $('#draw-surface'), selBox: $('#selection') }, {
    onCommit: () => { pushHistory(); markDirty(); },
    onSelect: fillObjbar,
  });
  // Clique no texto: se não caiu sobre letras e há uma imagem/forma "atrás do texto"
  // nesse ponto, seleciona e arrasta o objeto em vez de posicionar o cursor.
  $('#page').addEventListener('pointerdown', e => {
    const t = e.target;
    const onTextArea = t.id === 'page' || t.closest('#editor');
    if (!onTextArea || t.closest('.codeblock')) return; // objetos da frente, alças e blocos de código têm seus próprios cliques
    if (e.button === 0 && (e.altKey || !isOverText(e.clientX, e.clientY)) && ob.pickBehind(e)) {
      e.preventDefault();
      return;
    }
    if (ob.selectedObj()) ob.select(null);
  }, true);

  // ---- gaveta ----
  $('#new-note').onclick = () => newNoteDialog();
  $('#empty-new').onclick = () => newNoteDialog();
  $('#new-folder').onclick = () => newFolderDialog();
  $('#import-input').accept = ACCEPT;
  $('#import-btn').onclick = () => $('#import-input').click();
  $('#import-input').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importFiles(f); };
  $('#search').oninput = () => refreshDrawer();
  $('#ai-drawer').onclick = () => aiDrawerDialog();
  $('#theme-toggle').onclick = () => toggleTheme();
  $('#logout').onclick = () => logout();
  $('#drawer-open').onclick = () => $('#app').classList.add('drawer-open');
  $('#drawer-close').onclick = closeDrawerMobile;
  $('#scrim').onclick = closeDrawerMobile;

  // ---- barra superior ----
  $('#title').addEventListener('input', () => markDirty());
  $('#title').addEventListener('change', () => saveCurrent());
  $('#title').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });
  $('#ai-note').onclick = () => aiNoteDialog();
  $('#note-menu').onclick = e => {
    if (!current) return;
    const id = current.id;
    menu(e.currentTarget, [
      { label: 'Exportar PDF', icon: 'printer', onClick: exportPDF },
      { label: 'Mover para pasta', icon: 'move', onClick: () => moveNoteDialog(id) },
      current.locked ? { label: 'Trancar agora', icon: 'lock', onClick: lockNow } : { label: 'Proteger com senha', icon: 'lock', onClick: () => setPasswordDialog(id) },
      current.locked ? { label: 'Alterar ou remover senha', icon: 'key', onClick: () => startRecovery(id) } : null,
      { label: 'Restaurar estilo padrão da nota', icon: 'palette', onClick: () => { noteStyle = {}; ed.applyNoteStyle(noteStyle); markDirty(); pushHistory(); } },
      '-',
      { label: 'Excluir anotação', icon: 'trash', danger: true, onClick: () => deleteNote(id) },
    ]);
  };

  // ---- barra de ferramentas ----
  $$('#toolbar button, #objbar button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
  $$('#mode-seg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $$('#scope-seg button').forEach(b => b.onclick = () => {
    scope = b.dataset.scope;
    $$('#scope-seg button').forEach(x => x.classList.toggle('active', x === b));
  });
  $$('[data-cmd]').forEach(b => b.onclick = () => { ed.format(b.dataset.cmd); updateFormatState(); });
  $$('[data-block]').forEach(b => b.onclick = () => ed.formatBlock(b.dataset.block));
  $('#insert-code').onclick = e => menu(e.currentTarget, ed.LANGS.map(([v, l]) => ({ label: l, icon: 'code', onClick: () => ed.insertCodeBlock(v) })));

  $('#font-family').onchange = e => {
    const v = e.target.value;
    if (scope === 'note') { noteStyle.font = v; ed.clearInline('fontFamily'); applyNote(); }
    else if (v) ed.format('fontName', v);
  };
  $('#font-size').onchange = e => {
    const v = +e.target.value;
    if (scope === 'note') { noteStyle.size = v || null; ed.clearInline('fontSize'); applyNote(); }
    else if (v) ed.setSelectionFontSize(v);
    e.target.value = '';
  };
  // Seletores de cor: o evento "change" só dispara se a cor mudar. Depois de aplicar,
  // ajustamos o valor em 1 tom imperceptível para que escolher a MESMA cor de novo funcione.
  const nudge = hex => '#' + (parseInt(hex.slice(1), 16) ^ 1).toString(16).padStart(6, '0');
  const colorPicker = (input, sw, apply) => {
    sw.style.background = input.value;
    input.addEventListener('input', () => { sw.style.background = input.value; });
    input.addEventListener('change', () => {
      const v = input.value;
      sw.style.background = v;
      apply(v);
      input.value = nudge(v);
    });
  };
  colorPicker($('#font-color'), $('#font-color-sw'), v => {
    if (scope === 'note') { noteStyle.color = v; ed.clearInline('color'); applyNote(); }
    else ed.format('foreColor', v);
  });
  colorPicker($('#bg-color'), $('#bg-color-sw'), v => {
    if (scope === 'note') { noteStyle.bg = v; applyNote(); }
    else ed.format('hiliteColor', v);
  });

  // ---- desenho ----
  $$('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#shape-kind').onchange = e => { ob.style.shape = e.target.value; setTool('shape'); };
  const sc = $('#stroke-color'), fcol = $('#fill-color');
  const syncDraw = () => {
    ob.style.stroke = sc.value; ob.style.fill = fcol.value; ob.style.fillOn = $('#fill-on').checked; ob.style.sw = +$('#stroke-width').value;
    $('#stroke-sw').style.background = sc.value;
    $('#fill-sw').style.background = ob.style.fillOn ? fcol.value : 'transparent';
  };
  [sc, fcol, $('#fill-on'), $('#stroke-width')].forEach(i => i.addEventListener('input', syncDraw));
  syncDraw();
  setTool('pen');

  $('#add-image').onclick = () => $('#image-input').click();
  $('#image-input').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addImages(f); };
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;

  // ---- barra do objeto selecionado ----
  $$('[data-z]').forEach(b => b.onclick = () => ob.zorder(b.dataset.z));
  $('#ob-behind').onchange = e => ob.updateSelected({ behind: e.target.checked });
  $('#ob-ratio').onchange = e => ob.updateSelected({ lockRatio: e.target.checked });
  $('#ob-w').onchange = e => resizeSel('w', +e.target.value);
  $('#ob-h').onchange = e => resizeSel('h', +e.target.value);
  $('#ob-stroke').oninput = e => { $('#ob-stroke-sw').style.background = e.target.value; };
  $('#ob-stroke').onchange = e => ob.updateSelected({ stroke: e.target.value });
  $('#ob-fill-on').onchange = e => ob.updateSelected({ fillOn: e.target.checked, fill: ob.selectedObj()?.fill || $('#ob-fill').value });
  $('#ob-fill').oninput = e => { $('#ob-fill-sw').style.background = e.target.value; };
  $('#ob-fill').onchange = e => ob.updateSelected({ fill: e.target.value, fillOn: true });
  $('#ob-sw').onchange = e => ob.updateSelected({ sw: +e.target.value });
  $('#ob-shape').onchange = e => ob.updateSelected({ shape: e.target.value });
  $('#ob-clip').onchange = e => ob.updateSelected({ clip: e.target.checked });
  $('#ob-frame').onchange = e => ob.updateSelected({ frame: e.target.checked });
  $('#ob-frame-color').oninput = e => { $('#ob-frame-sw').style.background = e.target.value; };
  $('#ob-frame-color').onchange = e => ob.updateSelected({ frameColor: e.target.value, frame: true });
  $('#ob-frame-width').onchange = e => ob.updateSelected({ frameWidth: +e.target.value, frame: true });
  $('#ob-dup').onclick = () => ob.duplicateSelected();
  $('#ob-del').onclick = () => ob.removeSelected();

  // ---- colar / arrastar arquivos ----
  document.addEventListener('paste', e => {
    if (!current || $('#app').classList.contains('hidden')) return;
    const t = e.target;
    if (t.closest?.('input, textarea, dialog')) return;
    const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); addImages(imgs); return; }
    if (t.closest?.('#editor')) {
      const html = e.clipboardData.getData('text/html');
      if (html) { e.preventDefault(); ed.insertHTML(html); }
    }
  });
  const ws = $('#workspace');
  ws.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  ws.addEventListener('drop', e => {
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    const imgs = files.filter(f => f.type.startsWith('image/'));
    const texts = files.filter(f => !f.type.startsWith('image/') && isImportable(f));
    if (imgs.length) {
      const r = $('#page').getBoundingClientRect();
      addImages(imgs, current ? { x: e.clientX - r.left, y: e.clientY - r.top } : null);
    }
    if (texts.length) importFiles(texts, { intoCurrent: !!current });
  });

  // ---- teclado ----
  document.addEventListener('keydown', e => {
    if ($('#app').classList.contains('hidden') || document.querySelector('dialog[open]')) return;
    const t = e.target, mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); saveCurrent().then(() => toast('Salvo.')); return; }
    if (t.closest?.('input, textarea, select')) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    const inEditor = !!t.closest?.('#editor');
    if (ob.selectedObj() && !inEditor) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ob.removeSelected(); return; }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) { e.preventDefault(); ob.nudge(...d); return; }
    }
    if (e.key === 'Escape') { ob.select(null); if ($('#page').classList.contains('mode-draw')) setMode('text'); }
  });

  // em segundo plano por mais de 1 minuto (outra aba, app minimizado, celular bloqueado): tranca tudo
  // (o horário também é conferido na volta, porque o celular pode congelar o timer)
  let autoLockTimer = null, hiddenAt = 0;
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSave();
      hiddenAt = Date.now();
      clearTimeout(autoLockTimer);
      autoLockTimer = setTimeout(lockEverything, 60 * 1000);
    } else {
      clearTimeout(autoLockTimer);
      if (hiddenAt && Date.now() - hiddenAt >= 60 * 1000) lockEverything();
      hiddenAt = 0;
    }
  });
  addEventListener('beforeunload', () => { if (unsaved) saveCurrent(); });
}

// O ponto (x, y) está em cima de alguma letra do texto?
function isOverText(x, y) {
  let node, offset;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return false;
    node = p.offsetNode; offset = p.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return false;
    node = r.startContainer; offset = r.startOffset;
  } else return true;
  if (!node || node.nodeType !== 3 || !$('#editor').contains(node)) return false;
  const r = document.createRange();
  for (const [a, b] of [[offset - 1, offset], [offset, offset + 1]]) {
    if (a < 0 || b > node.length) continue;
    r.setStart(node, a);
    r.setEnd(node, b);
    for (const box of r.getClientRects()) {
      if (x >= box.left - 3 && x <= box.right + 3 && y >= box.top - 2 && y <= box.bottom + 2) return true;
    }
  }
  return false;
}

function applyNote() {
  ed.applyNoteStyle(noteStyle);
  markDirty();
  pushHistory();
}

function setMode(m) {
  $$('#mode-seg button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('#tb-text').classList.toggle('hidden', m !== 'text');
  $('#tb-draw').classList.toggle('hidden', m !== 'draw');
  ob.setMode(m);
  if (m === 'draw') $('#editor').blur();
}

function setTool(t) {
  ob.setTool(t);
  $$('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
}

function updateFormatState() {
  const s = ed.queryState();
  $$('[data-cmd]').forEach(b => b.classList.toggle('active', !!s[b.dataset.cmd]));
}

function resizeSel(dim, v) {
  const o = ob.selectedObj();
  if (!o || !v || v < 10) return;
  const ratio = o.w / o.h;
  const patch = { [dim]: v };
  if (o.type === 'image' && o.lockRatio !== false) {
    if (dim === 'w') patch.h = v / ratio; else patch.w = v * ratio;
  }
  ob.updateSelected(patch);
  fillObjbar(o);
}

function fillObjbar(o) {
  const bar = $('#objbar');
  bar.classList.toggle('hidden', !o);
  if (!o) return;
  const isBox = o.type === 'image' || o.type === 'shape';
  $('#ob-type').textContent = { image: 'Imagem', shape: 'Forma', path: 'Desenho', line: 'Linha', arrow: 'Seta' }[o.type];
  $('#ob-behind').checked = !!o.behind;
  $('#ob-size').classList.toggle('hidden', !isBox);
  if (isBox) {
    $('#ob-w').value = Math.round(o.w);
    $('#ob-h').value = Math.round(o.h);
    $('#ob-ratio').checked = o.lockRatio !== false && o.type === 'image';
    $('#ob-ratio').parentElement.classList.toggle('hidden', o.type !== 'image');
  }
  $('#ob-style').classList.toggle('hidden', o.type === 'image');
  if (o.type !== 'image') {
    $('#ob-stroke').value = o.stroke || '#000000';
    $('#ob-stroke-sw').style.background = o.stroke;
    $('#ob-sw').value = String(o.sw || 3);
    const isShape = o.type === 'shape';
    $('#ob-fill-wrap').classList.toggle('hidden', !isShape);
    $('#ob-fill-btn').classList.toggle('hidden', !isShape);
    if (isShape) {
      $('#ob-fill-on').checked = !!o.fillOn;
      $('#ob-fill').value = o.fill || '#ffd166';
      $('#ob-fill-sw').style.background = o.fillOn ? o.fill : 'transparent';
    }
  }
  $('#ob-image').classList.toggle('hidden', o.type !== 'image');
  if (o.type === 'image') {
    $('#ob-shape').value = o.shape || 'rect';
    $('#ob-clip').checked = !!o.clip;
    $('#ob-frame').checked = !!o.frame;
    $('#ob-frame-color').value = o.frameColor || '#5b5bd6';
    $('#ob-frame-sw').style.background = o.frameColor || '#5b5bd6';
    $('#ob-frame-width').value = String(o.frameWidth || 4);
  }
}
