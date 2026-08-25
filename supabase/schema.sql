-- Fontan Digest personal cloud state
-- Run once in the Supabase SQL editor.

create table if not exists public.fontan_digest_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.fontan_digest_user_state enable row level security;

create policy "Users can read own Fontan Digest state"
on public.fontan_digest_user_state
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own Fontan Digest state"
on public.fontan_digest_user_state
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own Fontan Digest state"
on public.fontan_digest_user_state
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.set_fontan_digest_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_fontan_digest_updated_at on public.fontan_digest_user_state;
create trigger set_fontan_digest_updated_at
before update on public.fontan_digest_user_state
for each row execute function public.set_fontan_digest_updated_at();
