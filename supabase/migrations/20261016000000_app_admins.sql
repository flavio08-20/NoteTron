-- Contas com acesso à IA (sem e-mails no código-fonte).
-- Para liberar uma conta, rode no SQL Editor:
--   insert into public.app_admins (user_id)
--   select id from auth.users where email = 'seu-email@exemplo.com';
create table if not exists public.app_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.app_admins enable row level security;
-- sem políticas: só a Edge Function (service_role) lê esta tabela
revoke all on public.app_admins from anon, authenticated;
