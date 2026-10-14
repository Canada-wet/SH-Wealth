begin;
create table if not exists public.wealth_voice_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);
create index if not exists wealth_voice_request_window on public.wealth_voice_requests(user_id,requested_at);
alter table public.wealth_voice_requests enable row level security;
-- Separate audio quota: two audio calls must not consume an advisor turn.
create or replace function public.take_wealth_voice_slot() returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_allowed_wealth_user() then raise exception 'Unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
  delete from public.wealth_voice_requests where user_id=auth.uid() and requested_at < now()-interval '1 day';
  if (select count(*) from public.wealth_voice_requests where user_id=auth.uid() and requested_at > now()-interval '1 minute') >= 12
    or (select count(*) from public.wealth_voice_requests where user_id=auth.uid() and requested_at > now()-interval '1 hour') >= 80 then return false; end if;
  insert into public.wealth_voice_requests(user_id) values(auth.uid());
  return true;
end; $$;
revoke all on function public.take_wealth_voice_slot() from public;
grant execute on function public.take_wealth_voice_slot() to authenticated;
commit;
