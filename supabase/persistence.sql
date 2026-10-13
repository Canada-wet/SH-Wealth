-- Run after schema.sql (or independently for the document-based application).
create extension if not exists "pgcrypto";
create table if not exists public.households (id uuid primary key default gen_random_uuid(), name text not null default '我们的家庭', created_at timestamptz not null default now());
create table if not exists public.household_members (household_id uuid references public.households(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, display_name text not null, role text not null check (role in ('owner','member')), primary key (household_id,user_id));
create table if not exists public.household_documents (household_id uuid primary key references public.households(id) on delete cascade, revision bigint not null default 0, document jsonb, updated_at timestamptz not null default now());
create table if not exists public.household_document_history (household_id uuid references public.households(id) on delete cascade, revision bigint not null, document jsonb not null, created_at timestamptz not null default now(), primary key(household_id,revision));
create table if not exists public.household_invites (household_id uuid primary key references public.households(id) on delete cascade, token text unique not null default encode(gen_random_bytes(24),'hex'));
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_documents enable row level security;
alter table public.household_document_history enable row level security;
alter table public.household_invites enable row level security;
create or replace function public.is_wealth_member(target_household uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.household_members where household_id=target_household and user_id=auth.uid()); $$;
drop policy if exists "wealth own memberships" on public.household_members;
create policy "wealth own memberships" on public.household_members for select to authenticated using(user_id=auth.uid());
drop policy if exists "wealth household read" on public.households;
create policy "wealth household read" on public.households for select to authenticated using(public.is_wealth_member(id));
drop policy if exists "wealth document read" on public.household_documents;
create policy "wealth document read" on public.household_documents for select to authenticated using(public.is_wealth_member(household_id));
drop policy if exists "wealth history read" on public.household_document_history;
create policy "wealth history read" on public.household_document_history for select to authenticated using(public.is_wealth_member(household_id));
create or replace function public.create_wealth_household(display_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare household uuid;
begin
  if auth.uid() is null or length(trim(display_name))=0 then raise exception 'Authentication and display name required'; end if;
  insert into public.households(name) values('我们的家庭') returning id into household;
  insert into public.household_members values(household,auth.uid(),trim(display_name),'owner');
  insert into public.household_documents(household_id) values(household);
  insert into public.household_invites(household_id) values(household);
  return household;
end; $$;
create or replace function public.join_wealth_household(invite_token text,display_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare household uuid;
begin
  if auth.uid() is null or length(trim(display_name))=0 then raise exception 'Authentication and display name required'; end if;
  select household_id into household from public.household_invites where token=invite_token;
  if household is null then raise exception 'Invalid invite token'; end if;
  insert into public.household_members values(household,auth.uid(),trim(display_name),'member') on conflict do nothing;
  return household;
end; $$;
create or replace function public.household_invite_token(target_household uuid) returns text language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.household_members where household_id=target_household and user_id=auth.uid() and role='owner') then raise exception 'Only household owner can share invitations'; end if;
  return(select token from public.household_invites where household_id=target_household);
end; $$;
create or replace function public.save_household_document(target_household uuid,expected_revision bigint,next_document jsonb) returns bigint language plpgsql security definer set search_path=public as $$
declare new_revision bigint;
begin
  if not public.is_wealth_member(target_household) then raise exception 'Unauthorized'; end if;
  if next_document->>'version' <> '3' or jsonb_typeof(next_document->'assets') <> 'array' or jsonb_typeof(next_document->'contributions') <> 'array' then raise exception 'Invalid document'; end if;
  update public.household_documents set document=next_document,revision=revision+1,updated_at=now() where household_id=target_household and revision=expected_revision returning revision into new_revision;
  if new_revision is null then raise exception 'revision conflict'; end if;
  insert into public.household_document_history(household_id,revision,document) values(target_household,new_revision,next_document);
  return new_revision;
end; $$;
revoke all on function public.is_wealth_member(uuid), public.create_wealth_household(text), public.join_wealth_household(text,text), public.household_invite_token(uuid), public.save_household_document(uuid,bigint,jsonb) from public;
grant execute on function public.is_wealth_member(uuid), public.create_wealth_household(text), public.join_wealth_household(text,text), public.household_invite_token(uuid), public.save_household_document(uuid,bigint,jsonb) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='household_documents') then
    alter publication supabase_realtime add table public.household_documents;
  end if;
end; $$;
