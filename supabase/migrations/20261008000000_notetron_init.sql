-- NoteTron: pastas, anotações e cópia de recuperação das chaves.

create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists folders_user_idx on public.folders (user_id);

create table if not exists public.notes (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id    uuid references public.folders (id) on delete set null,
  title        text not null default 'Sem título' check (char_length(title) <= 120),
  locked       boolean not null default false,
  content      jsonb,             -- conteúdo aberto (anotações sem senha)
  enc          jsonb,             -- conteúdo criptografado no aparelho (anotações com senha)
  search_text  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint notes_lock_consistency check (
    (locked and enc is not null and content is null) or (not locked and enc is null)
  )
);
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_folder_idx on public.notes (folder_id);

-- Cópia da chave de cada anotação com senha, cifrada com um segredo que só a
-- Edge Function "note-key" conhece. Nenhum usuário lê esta tabela diretamente.
create table if not exists public.note_recovery (
  note_id     uuid primary key references public.notes (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  iv          text not null,
  ct          text not null,
  created_at  timestamptz not null default now()
);

-- ---------- RLS: cada pessoa só enxerga o que é dela ----------
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_recovery enable row level security;

drop policy if exists "folders_own" on public.folders;
create policy "folders_own" on public.folders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "notes_own" on public.notes;
create policy "notes_own" on public.notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (folder_id is null or exists (
      select 1 from public.folders f where f.id = folder_id and f.user_id = (select auth.uid())
    ))
  );

-- note_recovery: sem políticas = sem acesso para anon/authenticated (só service_role).
revoke all on public.note_recovery from anon, authenticated;
