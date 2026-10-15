-- Public-market content, private application access. No household data is stored.
begin;
create table if not exists public.market_daily_briefings (
  day date primary key,
  status text not null check(status in ('processing','ready')),
  claim_token uuid not null,
  started_at timestamptz not null default now(),
  attempts integer not null default 1 check(attempts between 1 and 3),
  report jsonb,
  check((status='processing' and report is null) or (status='ready' and report is not null and jsonb_typeof(report)='object'))
);
alter table public.market_daily_briefings enable row level security;
revoke all on public.market_daily_briefings from anon, authenticated;
grant select on public.market_daily_briefings to authenticated;
grant all on public.market_daily_briefings to service_role;
drop policy if exists "approved members read market briefs" on public.market_daily_briefings;
create policy "approved members read market briefs" on public.market_daily_briefings for select to authenticated using (public.is_allowed_wealth_user());
create or replace function public.claim_market_briefing(target_day date, token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  insert into public.market_daily_briefings(day,status,claim_token) values(target_day,'processing',token)
  on conflict(day) do update set claim_token=excluded.claim_token,started_at=now(),attempts=public.market_daily_briefings.attempts+1
  where public.market_daily_briefings.status='processing' and public.market_daily_briefings.started_at < now()-interval '5 minutes' and public.market_daily_briefings.attempts<3;
  get diagnostics changed = row_count;
  return changed=1;
end; $$;
revoke all on function public.claim_market_briefing(date,uuid) from public, anon, authenticated;
grant execute on function public.claim_market_briefing(date,uuid) to service_role;
commit;
