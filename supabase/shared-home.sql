-- One automatically discovered private home for the two approved accounts.
begin;
create table if not exists public.wealth_shared_home (
  key text primary key check(key='default'),
  household_id uuid not null references public.households(id) on delete cascade
);
alter table public.wealth_shared_home enable row level security;
-- No direct client access; only the verified security-definer function.
create or replace function public.ensure_shared_wealth_household() returns uuid
language plpgsql security definer set search_path = '' as $$
declare household uuid; member_record record; existing_count integer;
begin
  if not public.is_allowed_wealth_user() then raise exception 'Unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended('together-private-shared-home',0));
  select household_id into household from public.wealth_shared_home where key='default';
  if household is null then
    select count(*) into existing_count from public.household_members where user_id=auth.uid();
    if existing_count > 1 then raise exception 'Multiple existing households require an explicit migration choice'; end if;
    select household_id into household from public.household_members where user_id=auth.uid();
    if household is null then
      insert into public.households(name) values('我们的共同家庭') returning id into household;
      insert into public.household_documents(household_id) values(household);
      insert into public.household_invites(household_id) values(household);
    end if;
    insert into public.wealth_shared_home(key,household_id) values('default',household);
  end if;
  for member_record in select id,email from auth.users where email_confirmed_at is not null
    and lower(email) in ('henrywhy233@gmail.com','sallyxie0378@gmail.com') loop
    insert into public.household_members(household_id,user_id,display_name,role)
    values(household,member_record.id,case when lower(member_record.email)='henrywhy233@gmail.com' then 'HW' else 'SX' end,
      case when member_record.id=auth.uid() then 'owner' else 'member' end)
    on conflict(household_id,user_id) do nothing;
  end loop;
  return household;
end; $$;
revoke all on function public.ensure_shared_wealth_household() from public;
grant execute on function public.ensure_shared_wealth_household() to authenticated;
commit;
