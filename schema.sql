-- Labrophone: profiles + shared messages, protected by row level security.

create table if not exists public.labro_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.labro_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.labro_profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists labro_messages_created_at_idx on public.labro_messages (created_at desc);
create index if not exists labro_messages_user_id_idx on public.labro_messages (user_id);

alter table public.labro_profiles enable row level security;
alter table public.labro_messages enable row level security;

create policy "profiles readable by everyone" on public.labro_profiles
  for select to anon, authenticated using (true);
create policy "users create their own profile" on public.labro_profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "users update their own profile" on public.labro_profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "messages readable by everyone" on public.labro_messages
  for select to anon, authenticated using (true);
create policy "users post as themselves" on public.labro_messages
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "users delete their own messages" on public.labro_messages
  for delete to authenticated using ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.labro_messages;
