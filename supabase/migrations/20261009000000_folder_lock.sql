-- Senha de pasta: guarda só um verificador (PBKDF2 + sal), nunca a senha.
alter table public.folders add column if not exists lock jsonb;
