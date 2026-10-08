// Configuração do NoteTron.
// A chave "anon"/"publishable" do Supabase é pública por natureza (fica no navegador);
// a segurança dos dados vem das políticas RLS do banco. NUNCA coloque aqui a chave
// service_role nem a chave da OpenAI — elas ficam só nos "secrets" das Edge Functions.

export const SUPABASE_URL = 'https://urzqfpktczpfeyupdasm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyenFmcGt0Y3pwZmV5dXBkYXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0ODAxNTMsImV4cCI6MjEwNzA1NjE1M30.6Dr4qBuwlRdvYf4YuetSKgz0YsgtHqP1_SFcAxQNeZc';

// Dono do app: único login com acesso à IA (a verificação real é feita no servidor).
export const OWNER_EMAIL = 'flaviobertolotticorp@gmail.com';

export const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
