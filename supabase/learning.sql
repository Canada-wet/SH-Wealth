-- Run after access.sql. Personal collections are NOT stored in the shared household document.
begin;
create table if not exists public.wealth_learning_preferences (
  household_id uuid not null,
  user_id uuid not null,
  version integer not null default 1 check(version>0),
  daily boolean not null default false,
  favorites text[] not null default '{}' check(cardinality(favorites)<=100),
  updated_at timestamptz not null default now(),
  primary key(household_id,user_id),
  foreign key(household_id,user_id) references public.household_members(household_id,user_id) on delete cascade
);
alter table public.wealth_learning_preferences enable row level security;
drop policy if exists "own learning preferences" on public.wealth_learning_preferences;
create policy "own learning preferences" on public.wealth_learning_preferences for all to authenticated
using(user_id=auth.uid() and public.is_wealth_member(household_id))
with check(user_id=auth.uid() and public.is_wealth_member(household_id));
grant select,insert,update,delete on public.wealth_learning_preferences to authenticated;
create table if not exists public.wealth_learning_deliveries (
  household_id uuid not null,
  user_id uuid not null,
  day date not null,
  transport text not null check(transport in ('push','email','telegram')),
  destination_hash text not null,
  status text not null check(status in ('sending','accepted','failed','uncertain')),
  created_at timestamptz not null default now(),
  primary key(household_id,user_id,day,transport,destination_hash),
  foreign key(household_id,user_id) references public.household_members(household_id,user_id) on delete cascade
);
alter table public.wealth_learning_deliveries enable row level security;
drop policy if exists "own learning delivery status" on public.wealth_learning_deliveries;
create policy "own learning delivery status" on public.wealth_learning_deliveries for select to authenticated
using(user_id=auth.uid() and public.is_wealth_member(household_id));
grant select on public.wealth_learning_deliveries to authenticated;
revoke insert,update,delete on public.wealth_learning_deliveries from anon,authenticated;
grant all on public.wealth_learning_preferences,public.wealth_learning_deliveries to service_role;
create or replace function public.claim_wealth_learning_delivery(target_household uuid,target_user uuid,target_day date,target_transport text,target_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if target_day<>(now() at time zone 'America/Toronto')::date or target_transport not in ('push','email','telegram') or target_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  if not exists(select 1 from public.wealth_learning_preferences where household_id=target_household and user_id=target_user and daily=true) then return false; end if;
  insert into public.wealth_learning_deliveries(household_id,user_id,day,transport,destination_hash,status)
  values(target_household,target_user,target_day,target_transport,target_hash,'sending') on conflict do nothing;
  return found;
end; $$;
revoke all on function public.claim_wealth_learning_delivery(uuid,uuid,date,text,text) from public,anon,authenticated;
grant execute on function public.claim_wealth_learning_delivery(uuid,uuid,date,text,text) to service_role;
commit;
