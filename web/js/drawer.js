// Renderiza a Gaveta: pastas (recolhíveis) e anotações, com busca e arrastar-para-pasta.
import { esc, norm } from './ui.js';
import { icon } from './icons.js';

const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso), today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
};

export function renderDrawer(el, { notes, folders, activeId, query, collapsed }, h) {
  const q = norm(query);
  const match = n => !q || norm(n.title).includes(q) || norm(n.search_text).includes(q);
  const list = notes.filter(match).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const fids = new Set(folders.map(f => f.id));
  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  el.innerHTML = '';
  if (!notes.length && !folders.length) {
    el.innerHTML = `<div class="list-empty">Sua Gaveta está vazia.<br>Crie uma anotação ou importe arquivos.</div>`;
    return;
  }

  const noteRow = n => {
    const row = document.createElement('div');
    row.className = 'note-row' + (n.id === activeId ? ' active' : '');
    row.innerHTML = `<button class="note-item" draggable="true" data-id="${n.id}" title="${esc(n.title)}">
        ${n.locked ? icon('lock', 'lock') : icon('file')}<span class="t">${esc(n.title)}</span><span class="d">${fmtDate(n.updated_at)}</span>
      </button><button class="icon-btn" title="Opções">${icon('more')}</button>`;
    const [item, more] = row.children;
    item.onclick = () => h.open(n.id);
    item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-note', n.id); e.dataTransfer.effectAllowed = 'move'; });
    more.onclick = e => { e.stopPropagation(); h.noteMenu(n.id, more); };
    return row;
  };

  const section = (folder, items) => {
    const sec = document.createElement('div');
    const isCollapsed = !q && folder && collapsed.has(folder.id);
    sec.className = 'folder' + (isCollapsed ? ' collapsed' : '');
    const head = document.createElement('div');
    head.className = 'folder-head';
    head.innerHTML = `<button class="folder-toggle">${icon('chev', 'chev')}${icon(folder ? 'folder' : 'file')}<span class="n">${esc(folder ? folder.name : 'Sem pasta')}</span><span class="count">${items.length}</span></button>`
      + (folder ? `<button class="icon-btn" title="Opções da pasta">${icon('more')}</button>` : '');
    head.querySelector('.folder-toggle').onclick = () => folder && h.toggleFolder(folder.id);
    if (folder) head.querySelector('.icon-btn').onclick = e => h.folderMenu(folder.id, e.currentTarget);
    // soltar anotação na pasta
    head.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-note')) { e.preventDefault(); head.classList.add('drop'); } });
    head.addEventListener('dragleave', () => head.classList.remove('drop'));
    head.addEventListener('drop', e => {
      e.preventDefault(); head.classList.remove('drop');
      const id = e.dataTransfer.getData('text/x-note');
      if (id) h.dropNote(id, folder ? folder.id : null);
    });
    const box = document.createElement('div');
    box.className = 'folder-items';
    items.forEach(n => box.append(noteRow(n)));
    if (!items.length) box.innerHTML = `<div class="list-empty" style="padding:6px 8px;text-align:left">Vazia</div>`;
    sec.append(head, box);
    return sec;
  };

  for (const f of sortedFolders) {
    const items = list.filter(n => n.folder_id === f.id);
    if (q && !items.length) continue;
    el.append(section(f, items));
  }
  const loose = list.filter(n => !n.folder_id || !fids.has(n.folder_id));
  if (folders.length) { if (loose.length || !q) el.append(section(null, loose)); }
  else loose.forEach(n => el.append(noteRow(n)));

  if (q && !list.length) el.insertAdjacentHTML('beforeend', `<div class="list-empty">Nada encontrado para “${esc(query)}”.</div>`);
}
