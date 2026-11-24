-- OS Group udbudsplatform (udbud.osgroup.dk)
-- Ligger i samme Supabase-projekt som tid.osgroup.dk, men med egne tabeller,
-- egen medlemsliste og egen storage-bucket. Påvirker ikke tidsregistreringen.

-- ---------- medlemmer ----------
create table if not exists public.udbud_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

create or replace function public.udbud_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.udbud_members where user_id = auth.uid())
$$;

create or replace function public.udbud_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.udbud_members where user_id = auth.uid() and role = 'admin')
$$;

-- ---------- dokumenter (samme model som den gamle portal: samling + id + data) ----------
create table if not exists public.udbud_docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);
alter table public.udbud_docs replica identity full;

create or replace function public.udbud_touch() returns trigger
language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists trg_udbud_touch on public.udbud_docs;
create trigger trg_udbud_touch before insert or update on public.udbud_docs
  for each row execute function public.udbud_touch();

-- Fletter felter ind i et dokument (som "update" i den gamle portal)
create or replace function public.udbud_merge(p_collection text, p_id text, p_patch jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.udbud_docs set data = data || p_patch
   where collection = p_collection and id = p_id;
  if not found then
    insert into public.udbud_docs(collection, id, data) values (p_collection, p_id, p_patch);
  end if;
end $$;

-- ---------- adgang ----------
alter table public.udbud_members enable row level security;
alter table public.udbud_docs enable row level security;

drop policy if exists um_select on public.udbud_members;
create policy um_select on public.udbud_members for select to authenticated
  using (user_id = auth.uid() or public.udbud_is_admin());
drop policy if exists um_admin on public.udbud_members;
create policy um_admin on public.udbud_members for all to authenticated
  using (public.udbud_is_admin()) with check (public.udbud_is_admin());

drop policy if exists ud_rw on public.udbud_docs;
create policy ud_rw on public.udbud_docs for all to authenticated
  using (public.udbud_is_member()) with check (public.udbud_is_member());

revoke all on public.udbud_members, public.udbud_docs from anon;
grant select, insert, update, delete on public.udbud_members, public.udbud_docs to authenticated;
grant execute on function public.udbud_merge(text, text, jsonb) to authenticated;
grant execute on function public.udbud_is_member() to authenticated;
grant execute on function public.udbud_is_admin() to authenticated;

-- ---------- live-opdatering ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'udbud_docs') then
    alter publication supabase_realtime add table public.udbud_docs;
  end if;
end $$;

-- ---------- filer (privat bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('udbud', 'udbud', false, 52428800)
on conflict (id) do nothing;

drop policy if exists udbud_files_select on storage.objects;
create policy udbud_files_select on storage.objects for select to authenticated
  using (bucket_id = 'udbud' and public.udbud_is_member());
drop policy if exists udbud_files_insert on storage.objects;
create policy udbud_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'udbud' and public.udbud_is_member());
drop policy if exists udbud_files_update on storage.objects;
create policy udbud_files_update on storage.objects for update to authenticated
  using (bucket_id = 'udbud' and public.udbud_is_member());
drop policy if exists udbud_files_delete on storage.objects;
create policy udbud_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'udbud' and public.udbud_is_admin());

-- ---------- første administrator ----------
insert into public.udbud_members (user_id, email, name, role)
select id, lower(email), coalesce(raw_user_meta_data->>'name', ''), 'admin'
from auth.users where lower(email) = 'jacob@osgroup.dk'
on conflict (user_id) do update set role = 'admin';
