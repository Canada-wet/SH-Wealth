-- Private two-member application. Run after persistence.sql and push.sql.
begin;
create or replace function public.is_allowed_wealth_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
    and lower(email) in ('henrywhy233@gmail.com','sallyxie0378@gmail.com'));
$$;
revoke all on function public.is_allowed_wealth_user() from public;
grant execute on function public.is_allowed_wealth_user() to authenticated, anon;

-- RESTRICTIVE policies constrain existing permissive policies, including legacy tables.
do $$ declare target text;
begin
  foreach target in array array['households','household_members','household_documents','household_document_history','household_invites','assets','asset_snapshots','goals','advisor_conversations','advisor_alerts','wealth_push_subscriptions'] loop
    if to_regclass('public.'||target) is not null then
      execute format('alter table public.%I enable row level security',target);
      execute format('drop policy if exists "wealth approved accounts only" on public.%I',target);
      execute format('create policy "wealth approved accounts only" on public.%I as restrictive for all to authenticated, anon using(public.is_allowed_wealth_user()) with check(public.is_allowed_wealth_user())',target);
    end if;
  end loop;
end; $$;
create or replace function public.is_wealth_member(target_household uuid) returns boolean
language sql stable security definer set search_path=public as $$
select public.is_allowed_wealth_user() and exists(select 1 from public.household_members where household_id=target_household and user_id=auth.uid()); $$;
create or replace function public.create_wealth_household(display_name text) returns uuid
language plpgsql security definer set search_path=public as $$
declare household uuid;
begin
  if not public.is_allowed_wealth_user() or length(trim(display_name))=0 then raise exception 'Unauthorized'; end if;
  insert into public.households(name) values('我们的家庭') returning id into household;
  insert into public.household_members values(household,auth.uid(),trim(display_name),'owner');
  insert into public.household_documents(household_id) values(household);
  insert into public.household_invites(household_id) values(household);
  return household;
end; $$;
create or replace function public.join_wealth_household(invite_token text,display_name text) returns uuid
language plpgsql security definer set search_path=public as $$
declare household uuid;
begin
  if not public.is_allowed_wealth_user() or length(trim(display_name))=0 then raise exception 'Unauthorized'; end if;
  select household_id into household from public.household_invites where token=invite_token;
  if household is null then raise exception 'Invalid invite token'; end if;
  insert into public.household_members values(household,auth.uid(),trim(display_name),'member') on conflict do nothing;
  return household;
end; $$;
create or replace function public.household_invite_token(target_household uuid) returns text
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_allowed_wealth_user() or not exists(select 1 from public.household_members where household_id=target_household and user_id=auth.uid() and role='owner') then raise exception 'Unauthorized'; end if;
  return(select token from public.household_invites where household_id=target_household);
end; $$;

create table if not exists public.wealth_advisor_requests(user_id uuid not null references auth.users(id) on delete cascade, requested_at timestamptz not null default now());
create index if not exists wealth_advisor_request_window on public.wealth_advisor_requests(user_id,requested_at);
alter table public.wealth_advisor_requests enable row level security;
-- No direct client policies; the authenticated function alone reserves slots.
create or replace function public.take_wealth_advisor_slot() returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_allowed_wealth_user() then raise exception 'Unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  delete from public.wealth_advisor_requests where user_id=auth.uid() and requested_at < now()-interval '1 day';
  if (select count(*) from public.wealth_advisor_requests where user_id=auth.uid() and requested_at > now()-interval '1 minute') >= 6
     or (select count(*) from public.wealth_advisor_requests where user_id=auth.uid() and requested_at > now()-interval '1 hour') >= 40 then return false; end if;
  insert into public.wealth_advisor_requests(user_id) values(auth.uid());
  return true;
end; $$;
revoke all on function public.take_wealth_advisor_slot() from public;
grant execute on function public.take_wealth_advisor_slot() to authenticated;
commit;
