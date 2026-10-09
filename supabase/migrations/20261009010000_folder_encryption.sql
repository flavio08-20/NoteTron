-- Pastas com senha passam a criptografar as anotações de dentro.
-- Agora uma anotação pode estar cifrada sem ter senha própria (cifrada pela chave da pasta):
--   locked = true  → tem senha própria (enc obrigatório)
--   enc not null   → conteúdo cifrado (content nulo)
alter table public.notes drop constraint if exists notes_lock_consistency;
alter table public.notes add constraint notes_lock_consistency check (
  (enc is not null and content is null) or (enc is null and not locked)
);

-- Cópia de recuperação da chave da pasta (cifrada com RECOVERY_SECRET pela função note-key).
create table if not exists public.folder_recovery (
  folder_id   uuid primary key references public.folders (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  iv          text not null,
  ct          text not null,
  created_at  timestamptz not null default now()
);
alter table public.folder_recovery enable row level security;
revoke all on public.folder_recovery from anon, authenticated;
