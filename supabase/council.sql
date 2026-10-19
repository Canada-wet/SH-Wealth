-- Independent, personal research histories. Never touches household_documents.
begin;
create table if not exists public.wealth_council_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null check(length(question) between 5 and 6000),
  status text not null check(status in ('active','paused','complete','cancelled')),
  document jsonb not null check(octet_length(document::text)<=4000000),
  created_at timestamptz not null default now()
);
alter table public.wealth_council_runs drop constraint if exists wealth_council_runs_document_check;
alter table public.wealth_council_runs add constraint wealth_council_runs_document_check check(octet_length(document::text)<=4000000);
create index if not exists wealth_council_owner on public.wealth_council_runs(user_id,created_at desc);
alter table public.wealth_council_runs enable row level security;
drop policy if exists "own council histories" on public.wealth_council_runs;
create policy "own council histories" on public.wealth_council_runs for select to authenticated
using(user_id=auth.uid() and public.is_allowed_wealth_user());
revoke all on public.wealth_council_runs from anon,authenticated;
grant select on public.wealth_council_runs to authenticated;
grant all on public.wealth_council_runs to service_role;
-- Retained separately: deleting a history must not reset the daily spending limit.
create table if not exists public.wealth_council_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  runs integer not null default 0,
  primary key(user_id,day)
);
alter table public.wealth_council_quota enable row level security;
alter table public.wealth_council_quota add column if not exists followups integer not null default 0;
revoke all on public.wealth_council_quota from public,anon,authenticated;
grant all on public.wealth_council_quota to service_role;
create or replace function public.wealth_council_research_valid(r jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare q text;
begin
  if r is null or jsonb_typeof(r)<>'object' or coalesce(r->>'depth','') not in ('standard','deep') or jsonb_typeof(r->'tools') is distinct from 'boolean' or jsonb_typeof(r->'webConsent') is distinct from 'boolean' or jsonb_typeof(r->'publicQueries') is distinct from 'array' then return false; end if;
  if jsonb_array_length(r->'publicQueries')>2 or ((r->>'tools')::boolean and r->>'depth'<>'deep') or (jsonb_array_length(r->'publicQueries')>0 and (not (r->>'tools')::boolean or not (r->>'webConsent')::boolean)) then return false; end if;
  if exists(select 1 from jsonb_array_elements(r->'publicQueries') x where jsonb_typeof(x)<>'string') then return false; end if;
  if (select count(distinct value) from jsonb_array_elements(r->'publicQueries'))<>jsonb_array_length(r->'publicQueries') then return false; end if;
  for q in select value from jsonb_array_elements_text(r->'publicQueries') loop
    if length(trim(q)) not between 3 and 200 or q ~ E'[\\r\\n]' or q ~* '(\S+@\S+|sk-|Bearer |password|api[_ -]?key)' then return false; end if;
  end loop;
  return true;
end; $$;
revoke all on function public.wealth_council_research_valid(jsonb) from public,anon,authenticated;
create or replace function public.wealth_council_command(action text, target_user uuid, run_id uuid, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  d jsonb; s jsonb; idx integer; t jsonb; existing_turn jsonb; round_no integer; additions jsonb; k text; followup_mode text; stage_name text; research jsonb; query_no integer; current_day date := (now() at time zone 'America/Toronto')::date;
begin
  if not exists(select 1 from auth.users where id=target_user and email_confirmed_at is not null and lower(email) in ('henrywhy233@gmail.com','sallyxie0378@gmail.com')) then raise exception 'council_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_user::text,723));
  select document into d from public.wealth_council_runs where id=run_id and user_id=target_user for update;
  if action='create' then
    if payload ? 'research' and not public.wealth_council_research_valid(payload->'research') then raise exception 'council_invalid'; end if;
    if d is not null then
      if d->>'question'<>payload->>'question' or d->'participants'<>payload->'participants' or d->'judge'<>payload->'judge'
        or coalesce(d->'attachments','[]'::jsonb) is distinct from coalesce(payload->'attachments','[]'::jsonb)
        or d->'models' is distinct from payload->'models' or d->'research' is distinct from payload->'research' then raise exception 'council_conflict'; end if;
      return d;
    end if;
    if exists(select 1 from public.wealth_council_runs where id=run_id) then raise exception 'council_forbidden'; end if;
    if (select count(*) from public.wealth_council_runs where user_id=target_user and status in ('active','paused'))>=1 then raise exception 'council_active'; end if;
    if (select count(*) from public.wealth_council_runs where user_id=target_user)>=100 then raise exception 'council_capacity'; end if;
    insert into public.wealth_council_quota(user_id,day) values(target_user,current_day) on conflict do nothing;
    if (select runs from public.wealth_council_quota where user_id=target_user and day=current_day)>=3 then raise exception 'council_quota'; end if;
    if jsonb_array_length(payload->'participants') not between 2 and 6 or jsonb_array_length(payload->'steps') not between 6 and 31 then raise exception 'council_invalid'; end if;
    d:=payload||jsonb_build_object('id',run_id,'status','active','created_at',now());
    insert into public.wealth_council_runs(id,user_id,question,status,document) values(run_id,target_user,d->>'question','active',d);
    update public.wealth_council_quota set runs=runs+1 where user_id=target_user and day=current_day;
    return d;
  end if;
  if d is null then raise exception 'council_not_found'; end if;
  if action='followup' then
    if payload ? 'research' and not public.wealth_council_research_valid(payload->'research') then raise exception 'council_invalid'; end if;
    -- Missing mode is the legacy direct-response contract, not consent to 3x calls.
    followup_mode:=coalesce(payload->>'mode','direct');
    if followup_mode not in ('debate','direct') or (payload ? 'mode' and jsonb_typeof(payload->'mode')<>'string') then raise exception 'council_invalid'; end if;
    if followup_mode='direct' and coalesce((payload->'research'->>'tools')::boolean,false) then raise exception 'council_invalid'; end if;
    select value into existing_turn from jsonb_array_elements(coalesce(d->'turns','[]'::jsonb)) where value->>'id'=payload->>'turnId';
    if existing_turn is not null then
      if existing_turn->>'question' is distinct from payload->>'question' or existing_turn->'participants' is distinct from payload->'participants' or existing_turn->'judge' is distinct from payload->'judge' or coalesce(existing_turn->>'mode','direct')<>followup_mode or existing_turn->'research' is distinct from payload->'research' then raise exception 'council_conflict'; end if;
      return d;
    end if;
    round_no:=jsonb_array_length(coalesce(d->'turns','[]'::jsonb))+1;
    if round_no>8 then raise exception 'council_followup_limit'; end if;
    if round_no-1<>(payload->>'baseRound')::integer then raise exception 'council_conflict'; end if;
    if d->>'status' not in ('complete','cancelled') or exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status'='running') or not exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status'='succeeded') then raise exception 'council_followup_state'; end if;
    if exists(select 1 from public.wealth_council_runs where user_id=target_user and id<>run_id and status in ('active','paused')) then raise exception 'council_active'; end if;
    if coalesce(jsonb_typeof(payload->'participants'),'null')<>'array' then raise exception 'council_invalid'; end if;
    if length(payload->>'question') not between 2 and 4000 or jsonb_array_length(payload->'participants') not between (case followup_mode when 'debate' then 2 else 1 end) and 6 then raise exception 'council_invalid'; end if;
    if (select count(distinct value) from jsonb_array_elements_text(payload->'participants'))<>jsonb_array_length(payload->'participants') then raise exception 'council_invalid'; end if;
    for k in select value from jsonb_array_elements_text(payload->'participants') union select payload->>'judge' where payload->>'judge' is not null loop
      if not exists(select 1 from jsonb_array_elements(d->'models') m where m->>'key'=k) then raise exception 'council_invalid'; end if;
    end loop;
    insert into public.wealth_council_quota(user_id,day) values(target_user,current_day) on conflict do nothing;
    if (select followups from public.wealth_council_quota where user_id=target_user and day=current_day)>=10 then raise exception 'council_followup_limit'; end if;
    -- An explicitly ended round's unsubmitted steps must never run after a new question.
    select jsonb_agg(case when value->>'status'='pending' then value||jsonb_build_object('status','failed','error','用户结束原轮次后另开追问；此步骤未调用。','finished_at',now()) else value end order by ordinality) into s from jsonb_array_elements(d->'steps') with ordinality;
    d:=jsonb_set(d,'{steps}',s);
    additions:='[]'::jsonb; idx:=jsonb_array_length(d->'steps');
    foreach stage_name in array (case when followup_mode='direct' then array['followup'] when payload->'research'->>'depth'='deep' then array['opening','critique','investigation','rebuttal','revision'] else array['opening','critique','revision'] end) loop
      for k in select value from jsonb_array_elements_text(payload->'participants') loop
        additions:=additions||jsonb_build_array(jsonb_build_object('seq',idx,'round',round_no,'model_key',k,'stage',stage_name,'status','pending','answer','','error','','usage',jsonb_build_object('input',null,'output',null),'started_at',null,'finished_at',null)); idx:=idx+1;
      end loop;
    end loop;
    if payload->>'judge' is not null then
      additions:=additions||jsonb_build_array(jsonb_build_object('seq',idx,'round',round_no,'model_key',payload->>'judge','stage','judge','status','pending','answer','','error','','usage',jsonb_build_object('input',null,'output',null),'started_at',null,'finished_at',null));
    end if;
    t:=jsonb_build_object('id',payload->>'turnId','question',payload->>'question','participants',payload->'participants','judge',payload->'judge','mode',followup_mode,'created_at',now());
    if payload ? 'research' then t:=t||jsonb_build_object('research',payload->'research'); end if;
    d:=d||jsonb_build_object('turns',coalesce(d->'turns','[]'::jsonb)||jsonb_build_array(t),'steps',(d->'steps')||additions,'status','active');
    -- Reserve the maximum serialized answer size before any paid call.
    if jsonb_array_length(d->'steps')>279 or octet_length(d::text)+(select coalesce(sum(case when x->>'stage'='investigation' then 85000 else 60500 end),0) from jsonb_array_elements(additions) x)>3900000 then raise exception 'council_document_full'; end if;
    update public.wealth_council_quota set followups=followups+1 where user_id=target_user and day=current_day;
    update public.wealth_council_runs set document=d,status='active' where id=run_id and user_id=target_user;
    return d;
  end if;
  if action='tool-start' then
    idx:=(payload->>'seq')::integer; s:=d->'steps'->idx;
    if s is null or s->>'status'<>'running' or s->>'stage'<>'investigation' or s->>'claim' is distinct from payload->>'claim' then raise exception 'council_conflict'; end if;
    round_no:=coalesce((s->>'round')::integer,0);
    research:=case when round_no=0 then d->'research' else d->'turns'->(round_no-1)->'research' end;
    query_no:=(payload->>'queryId')::integer;
    if not public.wealth_council_research_valid(research) or research->>'tools'<>'true' or research->>'webConsent'<>'true' or query_no is null or query_no<0 or query_no>=jsonb_array_length(research->'publicQueries') or coalesce(payload->>'receiptId','') !~ '^T[1-9][0-9]{0,2}\.[12]$' then raise exception 'council_invalid'; end if;
    -- Any prior attempt (even unknown/failed) consumes this round's approved query. Never automatically repeat paid searches.
    if d->>'status'<>'active' or exists(select 1 from jsonb_array_elements(d->'steps') x cross join lateral jsonb_array_elements(coalesce(x->'tool_receipts','[]'::jsonb)) r where coalesce((x->>'round')::integer,0)=round_no and r->>'tool'='search_public' and (r->>'queryId')::integer=query_no) then return d; end if;
    if jsonb_array_length(coalesce(s->'tool_receipts','[]'::jsonb))>=2 then raise exception 'council_invalid'; end if;
    t:=jsonb_build_object('id',payload->>'receiptId','tool','search_public','queryId',query_no,'input',research->'publicQueries'->>query_no,'status','running','output','','checkedAt',now());
    s:=s||jsonb_build_object('tool_receipts',coalesce(s->'tool_receipts','[]'::jsonb)||jsonb_build_array(t));
    d:=jsonb_set(d,array['steps',idx::text],s);
    update public.wealth_council_runs set document=d where id=run_id and user_id=target_user;
    return d;
  elsif action='delete' then
    if exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status'='running') then raise exception 'council_running'; end if;
    delete from public.wealth_council_runs where id=run_id and user_id=target_user;
    return '{}';
  elsif action in ('pause','resume','cancel') then
    if d->>'status' in ('complete','cancelled') then return d; end if;
    d:=jsonb_set(d,'{status}',to_jsonb(case action when 'pause' then 'paused' when 'resume' then 'active' else 'cancelled' end));
  elsif action='claim' then
    if d->>'status'<>'active' or exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status'='running') then return d; end if;
    select (ordinality-1)::integer into idx from jsonb_array_elements(d->'steps') with ordinality where value->>'status'='pending' order by ordinality limit 1;
    if idx is null then return d; end if;
    s:=d->'steps'->idx;
    s:=s||jsonb_build_object('status','running','started_at',now(),'claim',payload->>'claim');
    d:=jsonb_set(d,array['steps',idx::text],s);
  elsif action in ('finish','abandon') then
    idx:=(payload->>'seq')::integer;
    s:=d->'steps'->idx;
    if s is null then raise exception 'council_invalid'; end if;
    if s->>'status'<>'running' then return d; end if;
    if action='finish' then
      if s->>'claim' is distinct from payload->>'claim' then raise exception 'council_conflict'; end if;
      if payload ? 'tool_receipts' and (jsonb_typeof(payload->'tool_receipts')<>'array' or jsonb_array_length(payload->'tool_receipts')>2 or octet_length((payload->'tool_receipts')::text)>24000) then raise exception 'council_invalid'; end if;
      s:=(s-'claim')||jsonb_build_object('status',case when length(payload->>'answer')>0 then 'succeeded' else 'failed' end,'answer',left(coalesce(payload->>'answer',''),16000),'error',left(coalesce(payload->>'error',''),300),'error_kind',case when payload->>'error_kind'='access' then 'access' else null end,'usage',payload->'usage','finished_at',now());
      if payload ? 'tool_receipts' then s:=s||jsonb_build_object('tool_receipts',payload->'tool_receipts'); end if;
    else
      if (s->>'started_at')::timestamptz>now()-interval '6 minutes' then raise exception 'council_running'; end if;
      s:=(s-'claim')||jsonb_build_object('status','failed','error','提交结果不确定；用户选择跳过，未重新调用。','finished_at',now());
    end if;
    d:=jsonb_set(d,array['steps',idx::text],s);
    if d->>'status' <> 'cancelled' and not exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status' in ('pending','running')) then d:=jsonb_set(d,'{status}','"complete"'); end if;
  else raise exception 'council_invalid';
  end if;
  update public.wealth_council_runs set document=d,status=d->>'status' where id=run_id and user_id=target_user;
  return d;
end; $$;
revoke all on function public.wealth_council_command(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wealth_council_command(text,uuid,uuid,jsonb) to service_role;
commit;
