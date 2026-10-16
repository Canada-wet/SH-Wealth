-- Private, append-only research archive. No browser credentials or household balances.
-- A single authorized import is not a scheduled browser collector.
begin;
create table if not exists public.wealth_research_archive (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source text not null check(source='funda'),
  source_url text not null check(source_url ~ '^https://funda[.]ai/agent-chat[?]c=[A-Za-z0-9_-]+$'),
  captured_at timestamptz not null,
  prompt text not null check(length(prompt) between 1 and 5000),
  response text not null check(length(response) between 1 and 50000),
  citations jsonb not null default '[]'::jsonb check(jsonb_typeof(citations)='array' and jsonb_array_length(citations)<=40),
  status text not null check(status in ('complete','partial')),
  verification text not null default 'ai-unverified' check(verification='ai-unverified'),
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(household_id,source_url,content_hash)
);
create index if not exists wealth_research_archive_recent on public.wealth_research_archive(household_id,captured_at desc,id desc);
alter table public.wealth_research_archive enable row level security;
revoke all on public.wealth_research_archive from anon,authenticated;
grant select on public.wealth_research_archive to authenticated;
grant all on public.wealth_research_archive to service_role;
drop policy if exists "members read private research" on public.wealth_research_archive;
create policy "members read private research" on public.wealth_research_archive for select to authenticated
using(public.is_allowed_wealth_user() and public.is_wealth_member(household_id));
comment on table public.wealth_research_archive is 'Private AI research, not independently verified market observations. No automated Funda collection enabled.';
commit;
