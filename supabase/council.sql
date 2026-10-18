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
create or replace function public.wealth_council_command(action text, target_user uuid, run_id uuid, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  d jsonb; s jsonb; idx integer; t jsonb; existing_turn jsonb; round_no integer; additions jsonb; k text; current_day date := (now() at time zone 'America/Toronto')::date;
begin
  if not exists(select 1 from auth.users where id=target_user and email_confirmed_at is not null and lower(email) in ('henrywhy233@gmail.com','sallyxie0378@gmail.com')) then raise exception 'council_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_user::text,723));
  select document into d from public.wealth_council_runs where id=run_id and user_id=target_user for update;
  if action='create' then
    if d is not null then
      if d->>'question'<>payload->>'question' or d->'participants'<>payload->'participants' or d->'judge'<>payload->'judge'
        or coalesce(d->'attachments','[]'::jsonb) is distinct from coalesce(payload->'attachments','[]'::jsonb)
        or d->'models' is distinct from payload->'models' then raise exception 'council_conflict'; end if;
      return d;
    end if;
    if exists(select 1 from public.wealth_council_runs where id=run_id) then raise exception 'council_forbidden'; end if;
    if (select count(*) from public.wealth_council_runs where user_id=target_user and status in ('active','paused'))>=1 then raise exception 'council_active'; end if;
    if (select count(*) from public.wealth_council_runs where user_id=target_user)>=100 then raise exception 'council_capacity'; end if;
    insert into public.wealth_council_quota(user_id,day) values(target_user,current_day) on conflict do nothing;
    if (select runs from public.wealth_council_quota where user_id=target_user and day=current_day)>=3 then raise exception 'council_quota'; end if;
    if jsonb_array_length(payload->'participants') not between 2 and 6 or jsonb_array_length(payload->'steps') not between 6 and 19 then raise exception 'council_invalid'; end if;
    d:=payload||jsonb_build_object('id',run_id,'status','active','created_at',now());
    insert into public.wealth_council_runs(id,user_id,question,status,document) values(run_id,target_user,d->>'question','active',d);
    update public.wealth_council_quota set runs=runs+1 where user_id=target_user and day=current_day;
    return d;
  end if;
  if d is null then raise exception 'council_not_found'; end if;
  if action='followup' then
    select value into existing_turn from jsonb_array_elements(coalesce(d->'turns','[]'::jsonb)) where value->>'id'=payload->>'turnId';
    if existing_turn is not null then
      if existing_turn->>'question' is distinct from payload->>'question' or existing_turn->'participants' is distinct from payload->'participants' or existing_turn->'judge' is distinct from payload->'judge' then raise exception 'council_conflict'; end if;
      return d;
    end if;
    round_no:=jsonb_array_length(coalesce(d->'turns','[]'::jsonb))+1;
    if round_no>8 then raise exception 'council_followup_limit'; end if;
    if round_no-1<>(payload->>'baseRound')::integer then raise exception 'council_conflict'; end if;
    if d->>'status' not in ('complete','cancelled') or exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status'='running') or not exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status'='succeeded') then raise exception 'council_followup_state'; end if;
    if exists(select 1 from public.wealth_council_runs where user_id=target_user and id<>run_id and status in ('active','paused')) then raise exception 'council_active'; end if;
    if length(payload->>'question') not between 2 and 4000 or jsonb_array_length(payload->'participants') not between 1 and 6 then raise exception 'council_invalid'; end if;
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
    for k in select value from jsonb_array_elements_text(payload->'participants') loop
      additions:=additions||jsonb_build_array(jsonb_build_object('seq',idx,'round',round_no,'model_key',k,'stage','followup','status','pending','answer','','error','','usage',jsonb_build_object('input',null,'output',null),'started_at',null,'finished_at',null)); idx:=idx+1;
    end loop;
    if payload->>'judge' is not null then
      additions:=additions||jsonb_build_array(jsonb_build_object('seq',idx,'round',round_no,'model_key',payload->>'judge','stage','judge','status','pending','answer','','error','','usage',jsonb_build_object('input',null,'output',null),'started_at',null,'finished_at',null));
    end if;
    t:=jsonb_build_object('id',payload->>'turnId','question',payload->>'question','participants',payload->'participants','judge',payload->'judge','created_at',now());
    d:=d||jsonb_build_object('turns',coalesce(d->'turns','[]'::jsonb)||jsonb_build_array(t),'steps',(d->'steps')||additions,'status','active');
    -- Reserve the maximum serialized answer size before any paid call.
    if octet_length(d::text)+jsonb_array_length(additions)*60500>3900000 then raise exception 'council_document_full'; end if;
    update public.wealth_council_quota set followups=followups+1 where user_id=target_user and day=current_day;
    update public.wealth_council_runs set document=d,status='active' where id=run_id and user_id=target_user;
    return d;
  end if;
  if action='delete' then
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
      s:=(s-'claim')||jsonb_build_object('status',case when length(payload->>'answer')>0 then 'succeeded' else 'failed' end,'answer',left(coalesce(payload->>'answer',''),16000),'error',left(coalesce(payload->>'error',''),300),'error_kind',case when payload->>'error_kind'='access' then 'access' else null end,'usage',payload->'usage','finished_at',now());
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
