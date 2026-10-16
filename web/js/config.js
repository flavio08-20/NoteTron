// Configuração do NoteTron.
//
// Estes dois valores são PÚBLICOS por natureza: qualquer visitante do site os recebe.
// A chave "anon"/"publishable" só permite o que as regras de acesso (RLS) do banco
// autorizam — cada usuário enxerga apenas os próprios dados.
// NUNCA coloque aqui a chave service_role, a chave da OpenAI ou o RECOVERY_SECRET:
// eles ficam só nos "secrets" das Edge Functions, no painel do Supabase.
//
// Para usar o seu próprio projeto, troque pela URL e chave anon dele
// (Supabase → Project Settings → API).

export const SUPABASE_URL = 'https://urzqfpktczpfeyupdasm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyenFmcGt0Y3pwZmV5dXBkYXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0ODAxNTMsImV4cCI6MjEwNzA1NjE1M30.6Dr4qBuwlRdvYf4YuetSKgz0YsgtHqP1_SFcAxQNeZc';

export const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
