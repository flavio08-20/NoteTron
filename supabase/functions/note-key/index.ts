// Edge Function "note-key": recuperação por e-mail da senha das anotações.
//
// escrow  → guarda a chave da anotação cifrada com RECOVERY_SECRET (segredo só do servidor)
// recover → devolve a chave, SOMENTE se o login atual foi confirmado por e-mail (OTP/link)
//           nos últimos 15 minutos
// forget  → apaga a cópia (quando a senha é removida)
//
// Secrets necessários: RECOVERY_SECRET (texto aleatório longo).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const te = new TextEncoder();
const toB64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function keyFor(noteId: string) {
  const secret = Deno.env.get("RECOVERY_SECRET");
  if (!secret || secret.length < 32) throw new Error("RECOVERY_SECRET não configurado no servidor");
  const base = await crypto.subtle.importKey("raw", te.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: te.encode("notetron-recovery-v1"), info: te.encode(noteId) },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

function claims(jwt: string) {
  const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(p.padEnd(Math.ceil(p.length / 4) * 4, "=")));
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

    const { action, note_id, dek } = await req.json();
    if (typeof note_id !== "string" || !UUID.test(note_id)) return json({ error: "note_id inválido" }, 400);

    const { data: note } = await admin.from("notes").select("id,user_id").eq("id", note_id).maybeSingle();
    if (!note || note.user_id !== user.id) return json({ error: "Anotação não encontrada" }, 404);

    if (action === "escrow") {
      const raw = fromB64(String(dek ?? ""));
      if (raw.length !== 32) return json({ error: "Chave inválida" }, 400);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(note_id), raw));
      const { error } = await admin.from("note_recovery")
        .upsert({ note_id, user_id: user.id, iv: toB64(iv), ct: toB64(ct) });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "recover") {
      // exige que a sessão atual tenha sido aberta por link/código enviado ao e-mail
      const amr: { method: string; timestamp: number }[] = claims(jwt).amr ?? [];
      const now = Date.now() / 1000;
      const viaEmail = amr.some((a) => ["otp", "magiclink"].includes(a.method) && now - a.timestamp < 15 * 60);
      if (!viaEmail) return json({ error: "Confirme pelo link enviado ao seu e-mail antes de continuar." }, 403);
      const { data: rec } = await admin.from("note_recovery").select("iv,ct")
        .eq("note_id", note_id).eq("user_id", user.id).maybeSingle();
      if (!rec) return json({ error: "Esta anotação não tem recuperação por e-mail ativa." }, 404);
      const raw = new Uint8Array(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(rec.iv) }, await keyFor(note_id), fromB64(rec.ct),
      ));
      return json({ dek: toB64(raw) });
    }

    if (action === "forget") {
      await admin.from("note_recovery").delete().eq("note_id", note_id).eq("user_id", user.id);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message ?? "Erro interno" }, 500);
  }
});
