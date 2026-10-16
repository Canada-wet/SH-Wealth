-- Per-household, per-trading-day, per-session claim. Never reclaim an uncertain submission.
begin;
create table if not exists public.wealth_research_runs (
  household_id uuid not null references public.households(id) on delete cascade,
  day date not null,
  phase text not null check(phase in ('open','close')),
  token uuid not null,
  started_at timestamptz not null default now(),
  source_url text check(source_url ~ '^https://funda[.]ai/agent-chat[?]c=[A-Za-z0-9_-]+$'),
  report_id uuid references public.wealth_research_archive(id),
  primary key(household_id,day,phase)
);
alter table public.wealth_research_runs enable row level security;
revoke all on public.wealth_research_runs from anon,authenticated;
grant select on public.wealth_research_runs to authenticated;
grant all on public.wealth_research_runs to service_role;
drop policy if exists "members read research run status" on public.wealth_research_runs;
create policy "members read research run status" on public.wealth_research_runs for select to authenticated
using(public.is_allowed_wealth_user() and public.is_wealth_member(household_id));
comment on table public.wealth_research_archive is 'Private AI research, not independently verified market observations. Browser scheduling is local and separately authorized.';
commit;
