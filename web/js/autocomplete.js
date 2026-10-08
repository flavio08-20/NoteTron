// Assistente de código dos blocos (estilo VS Code):
// sugestões (palavras-chave, snippets, nomes do próprio bloco), fechamento automático
// de pares e tags, indentação automática e expansão de snippets.

const W = s => s.trim().split(/\s+/);
const IND = '    ';

// ---------- vocabulário ----------
const JS_WORDS = W(`
  const let var function return if else for while do switch case default break continue
  try catch finally throw new class extends super this import export from async await
  typeof instanceof null undefined true false
  console.log console.error console.warn console.table
  document.querySelector document.querySelectorAll document.getElementById document.createElement
  addEventListener removeEventListener preventDefault stopPropagation
  JSON.stringify JSON.parse Object.keys Object.values Object.entries Object.assign
  Array.from Array.isArray Promise Promise.all Promise.resolve
  setTimeout setInterval clearTimeout clearInterval fetch localStorage sessionStorage
  Math.floor Math.ceil Math.round Math.random Math.max Math.min parseInt parseFloat Number String Boolean
  length push pop shift unshift slice splice map filter reduce forEach find findIndex includes indexOf join split
  toString toUpperCase toLowerCase trim replace startsWith endsWith then
  innerHTML textContent classList appendChild getAttribute setAttribute
`);
const JS_SNIPPETS = {
  log: 'console.log(${});',
  function: 'function ${nome}() {\n\t$0\n}',
  arrow: 'const ${nome} = () => {\n\t$0\n};',
  if: 'if (${condicao}) {\n\t$0\n}',
  else: 'else {\n\t$0\n}',
  for: 'for (let i = 0; i < ${tamanho}; i++) {\n\t$0\n}',
  forof: 'for (const ${item} of lista) {\n\t$0\n}',
  foreach: '${lista}.forEach(item => {\n\t$0\n});',
  while: 'while (${condicao}) {\n\t$0\n}',
  try: 'try {\n\t$0\n} catch (erro) {\n\tconsole.error(erro);\n}',
  switch: 'switch (${valor}) {\n\tcase 1:\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}',
  class: 'class ${Nome} {\n\tconstructor() {\n\t\t$0\n\t}\n}',
  async: 'async function ${nome}() {\n\t$0\n}',
  fetch: 'const resposta = await fetch(${url});\nconst dados = await resposta.json();',
  import: "import { ${} } from '';",
};
const TS_SNIPPETS = {
  ...JS_SNIPPETS,
  interface: 'interface ${Nome} {\n\t$0\n}',
  type: 'type ${Nome} = {\n\t$0\n};',
  enum: 'enum ${Nome} {\n\t$0\n}',
  function: 'function ${nome}(): void {\n\t$0\n}',
};

const PY_WORDS = W(`
  False None True and as assert async await break class continue def del elif else except finally
  for from global if import in is lambda nonlocal not or pass raise return try while with yield
  print input len range enumerate zip map filter sorted reversed sum min max abs round
  list dict set tuple str int float bool type isinstance issubclass open super self
  __init__ __name__ __main__ __str__ __repr__
  append extend insert remove pop clear index count sort reverse keys values items get update
  split join strip lower upper replace startswith endswith format
  Exception ValueError TypeError KeyError IndexError os sys math json random datetime
`);
const PY_SNIPPETS = {
  def: 'def ${nome}():\n\t$0',
  class: 'class ${Nome}:\n\tdef __init__(self):\n\t\t$0',
  if: 'if ${condicao}:\n\t$0',
  elif: 'elif ${condicao}:\n\t$0',
  else: 'else:\n\t$0',
  for: 'for ${item} in lista:\n\t$0',
  forr: 'for i in range(${n}):\n\t$0',
  while: 'while ${condicao}:\n\t$0',
  try: 'try:\n\t$0\nexcept Exception as erro:\n\tprint(erro)',
  with: "with open(${arquivo}, 'r') as f:\n\t$0",
  main: "if __name__ == '__main__':\n\t${main()}",
  print: 'print(${})',
  lambda: 'lambda ${x}: $0',
};

const CS_WORDS = W(`
  using namespace class struct interface enum public private protected internal static readonly const
  void int string bool double float decimal long char var object dynamic
  new return if else for foreach while do switch case default break continue try catch finally throw
  async await Task null true false this base override virtual abstract sealed get set value
  Console.WriteLine Console.ReadLine Console.Write
  List Dictionary IEnumerable Math.Max Math.Min Math.Round
  ToString Length Count Add Remove Contains Where Select OrderBy FirstOrDefault ToList
  string.IsNullOrEmpty int.Parse
`);
const CS_SNIPPETS = {
  cw: 'Console.WriteLine(${});',
  class: 'public class ${Nome}\n{\n\t$0\n}',
  method: 'public void ${Nome}()\n{\n\t$0\n}',
  prop: 'public ${string} Nome { get; set; }',
  if: 'if (${condicao})\n{\n\t$0\n}',
  else: 'else\n{\n\t$0\n}',
  for: 'for (int i = 0; i < ${tamanho}; i++)\n{\n\t$0\n}',
  foreach: 'foreach (var ${item} in lista)\n{\n\t$0\n}',
  while: 'while (${condicao})\n{\n\t$0\n}',
  try: 'try\n{\n\t$0\n}\ncatch (Exception ex)\n{\n\tConsole.WriteLine(ex.Message);\n}',
  main: 'static void Main(string[] args)\n{\n\t$0\n}',
  switch: 'switch (${valor})\n{\n\tcase 1:\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}',
};

const HTML_TAGS = W(`
  html head body title meta link script style div span section header footer main nav article aside
  h1 h2 h3 h4 h5 h6 p a img ul ol li table thead tbody tr th td form label input button select option
  textarea strong em br hr iframe video audio canvas svg small code pre
`);
const HTML_VOID = new Set(W('area base br col embed hr img input link meta source track wbr'));
const HTML_ATTRS = W('class id href src alt type name value placeholder required disabled checked style onclick charset content rel for target width height');
const HTML_SNIPPETS = {
  html5: '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>${Documento}</title>\n</head>\n<body>\n\t$0\n</body>\n</html>',
  a: '<a href="${#}"></a>',
  img: '<img src="${}" alt="">',
  ul: '<ul>\n\t<li>$0</li>\n</ul>',
  ol: '<ol>\n\t<li>$0</li>\n</ol>',
  input: '<input type="${text}" name="">',
  link: '<link rel="stylesheet" href="${style.css}">',
  script: '<script src="${script.js}"></script>',
  table: '<table>\n\t<tr>\n\t\t<th>${}</th>\n\t</tr>\n\t<tr>\n\t\t<td></td>\n\t</tr>\n</table>',
  form: '<form action="${}">\n\t$0\n</form>',
  button: '<button type="button">${}</button>',
};

const CSS_PROPS = W(`
  display position top right bottom left width height max-width min-width max-height min-height
  margin margin-top margin-bottom margin-left margin-right padding padding-top padding-bottom padding-left padding-right
  color background background-color border border-radius box-shadow outline
  font-family font-size font-weight line-height text-align text-decoration letter-spacing
  justify-content align-items align-content flex-direction flex-wrap flex gap grid-template-columns
  overflow overflow-x overflow-y z-index opacity cursor transition transform animation
`);
const CSS_VALUES = W(`
  flex grid block inline-block inline none relative absolute fixed sticky center space-between space-around
  column row wrap pointer bold normal auto inherit transparent solid dashed hidden visible
`);

const SNIPPETS = { python: PY_SNIPPETS, javascript: JS_SNIPPETS, typescript: TS_SNIPPETS, csharp: CS_SNIPPETS, html: HTML_SNIPPETS };
const WORDS = {
  python: PY_WORDS, javascript: JS_WORDS,
  typescript: [...JS_WORDS, ...W('interface type enum implements readonly private public protected abstract string number boolean unknown never void any Record Partial Pick Omit')],
  csharp: CS_WORDS, html: HTML_ATTRS, css: CSS_VALUES, text: [],
};

const WORD = { css: /[A-Za-z0-9_-]/, html: /[A-Za-z0-9_-]/, default: /[A-Za-z0-9_$.]/ };
const wordRe = lang => WORD[lang] || WORD.default;

function docWords(text, lang) {
  const re = lang === 'css' || lang === 'html'
    ? /[A-Za-z_][A-Za-z0-9_-]{2,}/g
    : /[A-Za-z_$][A-Za-z0-9_$]{2,}(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g;
  return new Set(text.match(re) || []);
}

/**
 * Sugestões para a posição do cursor → { start, prefix, items: [{label, kind, snippet?}] } ou null.
 * kind: 'snippet' | 'keyword' | 'var'
 */
export function suggest(lang, text, caret) {
  const re = wordRe(lang);
  if (caret < text.length && re.test(text[caret])) return null;
  let start = caret;
  while (start > 0 && re.test(text[start - 1])) start--;
  const prefix = text.slice(start, caret);
  if (prefix.length < 2 || /^\d/.test(prefix)) return null;
  const lower = prefix.toLowerCase();
  const out = new Map();
  const add = (label, kind, snippet) => {
    if (out.has(label + kind)) return;
    let rank;
    if (label.startsWith(prefix)) rank = 0; else if (label.toLowerCase().startsWith(lower)) rank = 1; else return;
    if (!snippet && label.length <= prefix.length) return;
    out.set(label + kind, { label, kind, snippet, rank });
  };

  if (lang === 'html') {
    const afterLt = text[start - 1] === '<';
    for (const t of HTML_TAGS) {
      const body = HTML_SNIPPETS[t] || (HTML_VOID.has(t) ? `<${t}>` : `<${t}>$0</${t}>`);
      add(t, 'snippet', afterLt ? body.replace(/^</, '') : body);
    }
    add('html5', 'snippet', HTML_SNIPPETS.html5);
  } else if (lang === 'css') {
    for (const p of CSS_PROPS) add(p, 'snippet', `${p}: $0;`);
  } else {
    for (const [k, body] of Object.entries(SNIPPETS[lang] || {})) add(k, 'snippet', body);
  }
  for (const w of WORDS[lang] || []) add(w, 'keyword');
  for (const w of docWords(text.slice(0, start) + text.slice(caret), lang)) add(w, 'var');

  const items = [...out.values()];
  if (!items.length) return null;
  const kindOrder = { snippet: 0, var: 1, keyword: 2 };
  items.sort((a, b) =>
    (b.label === prefix) - (a.label === prefix) || a.rank - b.rank ||
    a.label.length - b.label.length || kindOrder[a.kind] - kindOrder[b.kind] || a.label.localeCompare(b.label));
  return { start, prefix, items: items.slice(0, 8) };
}

// ---------- edição ----------
/** Insere texto mantendo o desfazer nativo (Ctrl+Z) do campo. */
export function insertText(ta, text, start = ta.selectionStart, end = ta.selectionEnd) {
  ta.setSelectionRange(start, end);
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch {}
  if (!ok) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
}

const lineStart = (v, pos) => v.lastIndexOf('\n', pos - 1) + 1;
const indentOf = (v, pos) => v.slice(lineStart(v, pos)).match(/^[ \t]*/)[0];

/** Expande um snippet substituindo [start, end). */
export function expandSnippet(ta, start, end, body) {
  const indent = indentOf(ta.value, start);
  let text = body.replace(/\t/g, IND).replace(/\n/g, '\n' + indent);
  let selA = -1, selB = -1;
  const ph = text.match(/\$\{([^}]*)\}/);
  if (ph) {
    selA = ph.index;
    selB = selA + ph[1].length;
    text = text.replace(ph[0], ph[1]);
  }
  text = text.replace(/\$\{([^}]*)\}/g, '$1');
  const zero = text.indexOf('$0');
  if (zero >= 0) {
    text = text.replace('$0', '');
    if (selA < 0) selA = selB = zero; else if (zero < selA) { selA -= 2; selB -= 2; }
  }
  if (selA < 0) selA = selB = text.length;
  insertText(ta, text, start, end);
  ta.setSelectionRange(start + selA, start + selB);
}

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);

/** Teclas inteligentes. Retorna true se tratou a tecla. */
export function handleKey(e, ta, lang) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd, next = v[s], prev = v[s - 1];

  // Tab / Shift+Tab com várias linhas, ou Shift+Tab na linha atual
  if (e.key === 'Tab') {
    const a = lineStart(v, s);
    const multi = v.slice(s, en).includes('\n');
    if (!multi && !e.shiftKey) { insertText(ta, IND); return true; }
    const b = en > s && v[en - 1] === '\n' ? en - 1 : en;
    const block = v.slice(a, b);
    const lines = block.split('\n');
    const changed = e.shiftKey ? lines.map(l => l.replace(/^( {1,4}|\t)/, '')) : lines.map(l => IND + l);
    const out = changed.join('\n');
    insertText(ta, out, a, b);
    if (multi) ta.setSelectionRange(a, a + out.length);
    else ta.setSelectionRange(Math.max(a, s - (block.length - out.length)), Math.max(a, s - (block.length - out.length)));
    return true;
  }

  // Enter: mantém a indentação e indenta depois de ":" / "{" / "[" / "(" / tag aberta
  if (e.key === 'Enter' && !e.shiftKey) {
    const indent = indentOf(v, s);
    const before = v.slice(lineStart(v, s), s).trimEnd();
    const opens = lang === 'python' ? /:$/.test(before)
      : lang === 'html' ? /<([a-zA-Z][\w-]*)(?:\s[^<>]*)?>$/.test(before) && !/<\/[^>]*>$/.test(before)
      : /[{[(]$/.test(before);
    const between = (lang !== 'python' && PAIRS[prev] && next === PAIRS[prev]) || (lang === 'html' && prev === '>' && v.slice(s, s + 2) === '</');
    if (between) {
      insertText(ta, '\n' + indent + IND + '\n' + indent);
      const pos = s + 1 + indent.length + IND.length;
      ta.setSelectionRange(pos, pos);
    } else insertText(ta, '\n' + indent + (opens ? IND : ''));
    return true;
  }

  // Backspace entre um par vazio apaga os dois
  if (e.key === 'Backspace' && s === en && PAIRS[prev] && next === PAIRS[prev]) {
    insertText(ta, '', s - 1, s + 1);
    return true;
  }

  // pular o fechamento já existente
  if (CLOSERS.has(e.key) && s === en && next === e.key) {
    ta.setSelectionRange(s + 1, s + 1);
    return true;
  }

  // fechar a tag HTML automaticamente: <div> → <div>|</div>
  if (lang === 'html' && e.key === '>' && s === en) {
    const m = v.slice(0, s).match(/<([a-zA-Z][\w-]*)(?:\s[^<>]*)?$/);
    if (m && !m[0].endsWith('/') && !HTML_VOID.has(m[1].toLowerCase())) {
      insertText(ta, `></${m[1]}>`);
      ta.setSelectionRange(s + 1, s + 1);
      return true;
    }
    return false;
  }

  // abrir pares: ( [ { " ' `
  if (PAIRS[e.key]) {
    const isQuote = e.key === '"' || e.key === "'" || e.key === '`';
    if (s !== en) { // envolve a seleção
      insertText(ta, e.key + v.slice(s, en) + PAIRS[e.key], s, en);
      ta.setSelectionRange(s + 1, en + 1);
      return true;
    }
    if (isQuote && /[\w]/.test(prev || '')) return false; // apóstrofo no meio de palavra
    if (next && /[\w]/.test(next)) return false;           // antes de uma palavra: não fecha
    insertText(ta, e.key + PAIRS[e.key]);
    ta.setSelectionRange(s + 1, s + 1);
    return true;
  }

  // "}" numa linha só com espaços: desindenta antes de fechar
  if ((e.key === '}' || e.key === ']' || e.key === ')') && s === en) {
    const a = lineStart(v, s);
    const head = v.slice(a, s);
    if (head.length >= IND.length && /^\s+$/.test(head)) {
      insertText(ta, head.slice(IND.length) + e.key, a, s);
      return true;
    }
  }
  return false;
}
