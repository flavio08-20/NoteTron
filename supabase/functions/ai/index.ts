// Edge Function "ai": organiza/formata anotações e a Gaveta usando a API da OpenAI.
// Por enquanto liberada só para o dono (OWNER_EMAIL).
//
// Secrets necessários: OPENAI_API_KEY
// Opcionais: OWNER_EMAIL (padrão abaixo), OPENAI_MODEL (padrão gpt-4o-mini)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const OWNER = (Deno.env.get("OWNER_EMAIL") ?? "flaviobertolotticorp@gmail.com").toLowerCase();
const MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const NOTE_SYSTEM = `Você é o assistente do NoteTron, um app de anotações e estudo.
Você recebe o HTML de uma anotação e um pedido do usuário. Responda SOMENTE com JSON:
{"html": "<novo HTML da anotação>", "summary": "uma frase curta dizendo o que você fez"}
Regras para o HTML:
- Use apenas: p, h1, h2, h3, strong, em, u, s, ul, ol, li, blockquote, br, hr, a, table, thead, tbody, tr, th, td, mark, span.
- Em span, o atributo style só pode ter color, background-color, font-family ou font-size.
- Blocos de código ficam como <pre data-lang="LINGUAGEM"><code>código com &lt; &gt; &amp; escapados</code></pre>.
  Linguagens: python, javascript, typescript, csharp, html, css, text. Não altere o código, a menos que o pedido peça.
- Não invente fatos. Não remova informação, a menos que o pedido peça. Mantenha o idioma original.
- Nada de <html>, <body>, <script>, <style>, imagens ou markdown.`;

const DRAWER_SYSTEM = `Você organiza a "Gaveta" (lista de anotações) do app NoteTron.
Você recebe as anotações (id, título, pasta atual, se tem senha e um trecho do texto) e as pastas existentes.
Responda SOMENTE com JSON:
{"notes": [{"id": "...", "folder": "nome da pasta ou null", "title": "título"}], "summary": "uma frase curta"}
Regras:
- Inclua TODAS as anotações recebidas, exatamente uma vez, com o mesmo id.
- Agrupe por assunto em poucas pastas (no máximo 8) com nomes curtos em português (até 40 caracteres).
- Reaproveite pastas existentes quando fizer sentido. Use null só se a anotação não se encaixar em nada.
- Sugira um título melhor apenas quando o atual for vago (ex.: "Nova anotação", "sem título", "asdf"); caso contrário repita o título atual.
- Para anotações com senha, use só o título para decidir.
- Siga as preferências do usuário, se houver.`;

async function chat(system: string, user: string) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY não configurada no servidor");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? `OpenAI respondeu ${r.status}`);
  return JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "Não autenticado" }, 401);
    if ((user.email ?? "").toLowerCase() !== OWNER || !user.email_confirmed_at) {
      return json({ error: "A IA ainda não está disponível para esta conta." }, 403);
    }

    const body = await req.json();

    if (body.mode === "note") {
      const html = String(body.html ?? "").slice(0, 120_000);
      const instruction = String(body.instruction ?? "").slice(0, 2000);
      if (!instruction) return json({ error: "Pedido vazio" }, 400);
      const out = await chat(NOTE_SYSTEM,
        `Pedido: ${instruction}\n\nTítulo da anotação: ${String(body.title ?? "").slice(0, 120)}\n\nHTML da anotação:\n${html}`);
      return json({ html: String(out.html ?? ""), summary: String(out.summary ?? "") });
    }

    if (body.mode === "drawer") {
      const notes = (Array.isArray(body.notes) ? body.notes : []).slice(0, 500).map((n: Record<string, unknown>) => ({
        id: String(n.id), title: String(n.title ?? "").slice(0, 120), folder: n.folder ? String(n.folder).slice(0, 60) : null,
        locked: !!n.locked, snippet: n.locked ? "" : String(n.snippet ?? "").slice(0, 400),
      }));
      const folders = (Array.isArray(body.folders) ? body.folders : []).slice(0, 200).map(String);
      const out = await chat(DRAWER_SYSTEM, JSON.stringify({
        preferencias: String(body.instruction ?? "").slice(0, 1000), pastas_existentes: folders, anotacoes: notes,
      }));
      const ids = new Set(notes.map((n: { id: string }) => n.id));
      const seen = new Set<string>();
      const result = (Array.isArray(out.notes) ? out.notes : [])
        .filter((x: { id: string }) => ids.has(x?.id) && !seen.has(x.id) && seen.add(x.id))
        .map((x: { id: string; folder: unknown; title: unknown }) => ({
          id: x.id,
          folder: x.folder ? String(x.folder).slice(0, 60) : null,
          title: String(x.title ?? "").slice(0, 120),
        }));
      return json({ notes: result, summary: String(out.summary ?? "") });
    }

    return json({ error: "Modo desconhecido" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message ?? "Erro interno" }, 500);
  }
});
