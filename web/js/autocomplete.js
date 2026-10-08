// Sugestões de autocompletar para os blocos de código (estilo IntelliSense).
// Fontes: palavras-chave/APIs comuns de cada linguagem + nomes já usados no próprio bloco.

const W = s => s.trim().split(/\s+/);

const JS_COMMON = W(`
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
  toString toUpperCase toLowerCase trim replace startsWith endsWith then catch
  innerHTML textContent classList appendChild querySelector getAttribute setAttribute
`);

const VOCAB = {
  python: W(`
    False None True and as assert async await break class continue def del elif else except finally
    for from global if import in is lambda nonlocal not or pass raise return try while with yield
    print input len range enumerate zip map filter sorted reversed sum min max abs round
    list dict set tuple str int float bool type isinstance issubclass open super self
    __init__ __name__ __main__ __str__ __repr__
    append extend insert remove pop clear index count sort reverse keys values items get update
    split join strip lower upper replace startswith endswith format
    Exception ValueError TypeError KeyError IndexError
    os sys math json random datetime
  `),
  javascript: JS_COMMON,
  typescript: [...JS_COMMON, ...W(`
    interface type enum implements readonly private public protected abstract declare namespace
    string number boolean unknown never void any object
    Record Partial Required Readonly Pick Omit Array Map Set
  `)],
  csharp: W(`
    using namespace class struct interface enum public private protected internal static readonly const
    void int string bool double float decimal long char var object dynamic
    new return if else for foreach while do switch case default break continue try catch finally throw
    async await Task null true false this base override virtual abstract sealed get set value
    Console.WriteLine Console.ReadLine Console.Write
    List Dictionary IEnumerable Math.Max Math.Min Math.Round
    ToString Length Count Add Remove Contains Where Select OrderBy FirstOrDefault ToList
    string.IsNullOrEmpty int.Parse
  `),
  html: W(`
    html head body title meta link script style div span section header footer main nav article aside
    h1 h2 h3 h4 h5 h6 p a img ul ol li table thead tbody tr th td form label input button select option textarea
    strong em br hr iframe video audio canvas svg
    class id href src alt type name value placeholder required disabled checked style onclick
    charset viewport content rel stylesheet
  `),
  css: W(`
    display flex grid block inline-block none position relative absolute fixed sticky
    top right bottom left width height max-width min-width max-height min-height
    margin margin-top margin-bottom padding padding-top padding-bottom
    color background background-color border border-radius box-shadow outline
    font-family font-size font-weight line-height text-align text-decoration letter-spacing
    justify-content align-items align-content flex-direction flex-wrap gap grid-template-columns
    overflow overflow-x overflow-y z-index opacity cursor transition transform animation
    center space-between space-around column row wrap pointer bold auto inherit
    hover focus active important
  `),
  text: [],
};

// Caracteres que fazem parte de uma "palavra" em cada linguagem.
const WORD = {
  css: /[A-Za-z0-9_-]/,
  html: /[A-Za-z0-9_-]/,
  default: /[A-Za-z0-9_$.]/,
};
const wordRe = lang => WORD[lang] || WORD.default;

function docWords(text, lang) {
  const re = lang === 'css' || lang === 'html' ? /[A-Za-z_][A-Za-z0-9_-]{2,}/g : /[A-Za-z_$][A-Za-z0-9_$]{2,}(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g;
  return new Set(text.match(re) || []);
}

/**
 * Calcula sugestões para a posição do cursor.
 * Retorna { start, prefix, items } ou null.
 */
export function suggest(lang, text, caret) {
  const re = wordRe(lang);
  if (caret < text.length && re.test(text[caret])) return null; // cursor no meio de uma palavra
  let start = caret;
  while (start > 0 && re.test(text[start - 1])) start--;
  const prefix = text.slice(start, caret);
  if (prefix.length < 2 || /^\d/.test(prefix)) return null;

  const own = docWords(text.slice(0, start) + text.slice(caret), lang);
  const pool = new Set([...(VOCAB[lang] || []), ...own]);
  const lower = prefix.toLowerCase();
  const items = [];
  for (const w of pool) {
    if (w === prefix || w.length <= prefix.length) continue;
    if (w.startsWith(prefix)) items.push({ w, rank: 0 });
    else if (w.toLowerCase().startsWith(lower)) items.push({ w, rank: 1 });
  }
  if (!items.length) return null;
  items.sort((a, b) => a.rank - b.rank || a.w.length - b.w.length || a.w.localeCompare(b.w));
  return { start, prefix, items: items.slice(0, 8).map(i => i.w) };
}
