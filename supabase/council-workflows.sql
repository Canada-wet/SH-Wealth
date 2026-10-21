-- v0.13 additive upgrade. Keep v0.12 behaviour for requests without an explicit workflow.
-- No existing run, quota, transcript, household or library row is rewritten.
begin;
create or replace function public.wealth_council_workflow_plan(w jsonb, participants jsonb, judge text, start_seq integer default 0, round_no integer default 0)
returns jsonb language plpgsql immutable set search_path='' as $$
declare p jsonb; k text; n integer; i integer:=0; idx integer:=start_seq; ids text[]:='{}'; kinds text[]:='{}'; result jsonb:='[]';
begin
  if jsonb_typeof(w) is distinct from 'object' or jsonb_typeof(participants) is distinct from 'array' then raise exception 'council_invalid'; end if;
  if w-'version'-'stages'<>'{}'::jsonb or w->'version' is distinct from '1'::jsonb or jsonb_typeof(w->'stages') is distinct from 'array' then raise exception 'council_invalid'; end if;
  n:=jsonb_array_length(w->'stages');
  if n not between 2 and 8 or jsonb_array_length(participants) not between 2 and 6 or start_seq<0 or round_no not between 0 and 8 then raise exception 'council_invalid'; end if;
  if exists(select 1 from jsonb_array_elements(participants) x where jsonb_typeof(x)<>'string') or (select count(distinct value) from jsonb_array_elements(participants))<>jsonb_array_length(participants) then raise exception 'council_invalid'; end if;
  for p in select value from jsonb_array_elements(w->'stages') loop
    if jsonb_typeof(p) is distinct from 'object' then raise exception 'council_invalid'; end if;
    if p-array['id','type','title','instructions','participants']<>'{}'::jsonb or
      jsonb_typeof(p->'id') is distinct from 'string' or coalesce(p->>'id','') !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,47}$' or p->>'id' in ('judge','followup') or (p->>'id')=any(ids) or
      coalesce(p->>'type','') not in ('opening','critique','investigation','rebuttal','revision','custom') or
      jsonb_typeof(p->'title') is distinct from 'string' or length(trim(p->>'title')) not between 1 and 60 or p->>'title'<>trim(p->>'title') or (p->>'title') ~ '[[:cntrl:]]' or
      jsonb_typeof(p->'instructions') is distinct from 'string' or length(p->>'instructions')>1200 or p->>'instructions'<>trim(p->>'instructions') or
      (p->>'instructions') ~ E'[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' or
      jsonb_typeof(p->'participants') is distinct from 'array' then raise exception 'council_invalid'; end if;
    if jsonb_array_length(p->'participants') not between 1 and 6 or exists(select 1 from jsonb_array_elements(p->'participants') x where jsonb_typeof(x)<>'string' or not participants @> jsonb_build_array(x)) or (select count(distinct value) from jsonb_array_elements(p->'participants'))<>jsonb_array_length(p->'participants') then raise exception 'council_invalid'; end if;
    if (i=0 and (p->>'type'<>'opening' or not ((p->'participants') @> participants and participants @> (p->'participants')))) or (i=n-1 and p->>'type'<>'revision') or (i>0 and i<n-1 and p->>'type' in ('opening','revision')) or (p->>'type'='custom' and length(trim(p->>'instructions'))<5) or (p->>'type'='investigation' and 'investigation'=any(kinds)) then raise exception 'council_invalid'; end if;
    ids:=array_append(ids,p->>'id'); kinds:=array_append(kinds,p->>'type');
    for k in select value from jsonb_array_elements_text(p->'participants') loop
      result:=result||jsonb_build_array(jsonb_build_object('seq',idx,'round',round_no,'model_key',k,'stage',p->>'type','phase_id',p->>'id','status','pending','answer','','error','','usage',jsonb_build_object('input',null,'output',null),'started_at',null,'finished_at',null)); idx:=idx+1;
    end loop;
    i:=i+1;
  end loop;
  if judge is not null then
    result:=result||jsonb_build_array(jsonb_build_object('seq',idx,'round',round_no,'model_key',judge,'stage','judge','phase_id','judge','status','pending','answer','','error','','usage',jsonb_build_object('input',null,'output',null),'started_at',null,'finished_at',null)); idx:=idx+1;
  end if;
  if idx-start_seq>31 then raise exception 'council_invalid'; end if;
  return result;
end; $$;
revoke all on function public.wealth_council_workflow_plan(jsonb,jsonb,text,integer,integer) from public,anon,authenticated,service_role;

-- Preserve the audited legacy implementation, inaccessible except through this wrapper.
do $$ begin
  if to_regprocedure('public.wealth_council_legacy_command_v12(text,uuid,uuid,jsonb)') is null then
    alter function public.wealth_council_command(text,uuid,uuid,jsonb) rename to wealth_council_legacy_command_v12;
  end if;
end $$;
revoke all on function public.wealth_council_legacy_command_v12(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.wealth_council_command(action text, target_user uuid, run_id uuid, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; t jsonb; existing_turn jsonb; additions jsonb; k text; round_no integer; current_day date := (now() at time zone 'America/Toronto')::date;
begin
  if not exists(select 1 from auth.users where id=target_user and email_confirmed_at is not null and lower(email) in ('henrywhy233@gmail.com','sallyxie0378@gmail.com')) then raise exception 'council_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_user::text,723));
  select document into d from public.wealth_council_runs where id=run_id and user_id=target_user for update;
  -- A caller cannot drop workflow from an idempotent retry and fall through to the old comparison.
  if action='create' and d is not null and d->'workflow' is distinct from payload->'workflow' then raise exception 'council_conflict'; end if;
  if action='followup' and d is not null then
    select value into existing_turn from jsonb_array_elements(coalesce(d->'turns','[]'::jsonb)) where value->>'id'=payload->>'turnId';
    if existing_turn is not null and existing_turn->'workflow' is distinct from payload->'workflow' then raise exception 'council_conflict'; end if;
  end if;
  if action not in ('create','followup') or not payload ? 'workflow' then
    return public.wealth_council_legacy_command_v12(action,target_user,run_id,payload);
  end if;
  if payload ? 'research' and not public.wealth_council_research_valid(payload->'research') then raise exception 'council_invalid'; end if;
  if jsonb_typeof(payload->'question') is distinct from 'string' or jsonb_typeof(payload->'participants') is distinct from 'array' or not payload ? 'judge' or (payload->'judge'<>'null'::jsonb and jsonb_typeof(payload->'judge')<>'string') then raise exception 'council_invalid'; end if;
  if action='create' then
    additions:=public.wealth_council_workflow_plan(payload->'workflow',payload->'participants',payload->>'judge');
    if length(payload->>'question') not between 5 and 6000 or jsonb_typeof(payload->'models') is distinct from 'array' then raise exception 'council_invalid'; end if;
    for k in select value from jsonb_array_elements_text(payload->'participants') union select payload->>'judge' where payload->>'judge' is not null loop
      if not exists(select 1 from jsonb_array_elements(payload->'models') m where m->>'key'=k) then raise exception 'council_invalid'; end if;
    end loop;
    if d is not null then
      if d->>'question' is distinct from payload->>'question' or d->'participants' is distinct from payload->'participants' or d->'judge' is distinct from payload->'judge' or coalesce(d->'attachments','[]'::jsonb) is distinct from coalesce(payload->'attachments','[]'::jsonb) or d->'models' is distinct from payload->'models' or d->'research' is distinct from payload->'research' then raise exception 'council_conflict'; end if;
      return d;
    end if;
    if exists(select 1 from public.wealth_council_runs where id=run_id) then raise exception 'council_forbidden'; end if;
    if exists(select 1 from public.wealth_council_runs where user_id=target_user and status in ('active','paused')) then raise exception 'council_active'; end if;
    if (select count(*) from public.wealth_council_runs where user_id=target_user)>=100 then raise exception 'council_capacity'; end if;
    insert into public.wealth_council_quota(user_id,day) values(target_user,current_day) on conflict do nothing;
    if (select runs from public.wealth_council_quota where user_id=target_user and day=current_day)>=3 then raise exception 'council_quota'; end if;
    d:=(payload-'steps')||jsonb_build_object('id',run_id,'status','active','created_at',now(),'steps',additions);
    if octet_length(d::text)+(select coalesce(sum(case when x->>'stage'='investigation' then 85000 else 60500 end),0) from jsonb_array_elements(additions) x)>3900000 then raise exception 'council_document_full'; end if;
    insert into public.wealth_council_runs(id,user_id,question,status,document) values(run_id,target_user,d->>'question','active',d);
    update public.wealth_council_quota set runs=runs+1 where user_id=target_user and day=current_day;
    return d;
  end if;
  if d is null then raise exception 'council_not_found'; end if;
  if payload->>'mode' is distinct from 'debate' or length(payload->>'question') not between 2 and 4000 or jsonb_typeof(payload->'baseRound') is distinct from 'number' or coalesce(payload->>'baseRound','') !~ '^[0-7]$' or coalesce(payload->>'turnId','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'council_invalid'; end if;
  additions:=public.wealth_council_workflow_plan(payload->'workflow',payload->'participants',payload->>'judge',jsonb_array_length(d->'steps'),(payload->>'baseRound')::integer+1);
  for k in select value from jsonb_array_elements_text(payload->'participants') union select payload->>'judge' where payload->>'judge' is not null loop
    if not exists(select 1 from jsonb_array_elements(d->'models') m where m->>'key'=k) then raise exception 'council_invalid'; end if;
  end loop;
  if existing_turn is not null then
    if existing_turn->>'question' is distinct from payload->>'question' or existing_turn->'participants' is distinct from payload->'participants' or existing_turn->'judge' is distinct from payload->'judge' or existing_turn->>'mode' is distinct from payload->>'mode' or existing_turn->'research' is distinct from payload->'research' then raise exception 'council_conflict'; end if;
    return d;
  end if;
  round_no:=jsonb_array_length(coalesce(d->'turns','[]'::jsonb))+1;
  if round_no>8 then raise exception 'council_followup_limit'; end if;
  if round_no-1<>(payload->>'baseRound')::integer then raise exception 'council_conflict'; end if;
  if d->>'status' not in ('complete','cancelled') or exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status'='running') or not exists(select 1 from jsonb_array_elements(d->'steps') x where x->>'status'='succeeded') then raise exception 'council_followup_state'; end if;
  if exists(select 1 from public.wealth_council_runs where user_id=target_user and id<>run_id and status in ('active','paused')) then raise exception 'council_active'; end if;
  insert into public.wealth_council_quota(user_id,day) values(target_user,current_day) on conflict do nothing;
  if (select followups from public.wealth_council_quota where user_id=target_user and day=current_day)>=10 then raise exception 'council_followup_limit'; end if;
  select jsonb_agg(case when value->>'status'='pending' then value||jsonb_build_object('status','failed','error','用户结束原轮次后另开追问；此步骤未调用。','finished_at',now()) else value end order by ordinality) into t from jsonb_array_elements(d->'steps') with ordinality;
  d:=jsonb_set(d,'{steps}',t);
  t:=jsonb_build_object('id',payload->>'turnId','question',payload->>'question','participants',payload->'participants','judge',payload->'judge','mode','debate','workflow',payload->'workflow','created_at',now());
  if payload ? 'research' then t:=t||jsonb_build_object('research',payload->'research'); end if;
  d:=d||jsonb_build_object('turns',coalesce(d->'turns','[]'::jsonb)||jsonb_build_array(t),'steps',(d->'steps')||additions,'status','active');
  if jsonb_array_length(d->'steps')>279 or octet_length(d::text)+(select coalesce(sum(case when x->>'stage'='investigation' then 85000 else 60500 end),0) from jsonb_array_elements(additions) x)>3900000 then raise exception 'council_document_full'; end if;
  update public.wealth_council_quota set followups=followups+1 where user_id=target_user and day=current_day;
  update public.wealth_council_runs set document=d,status='active' where id=run_id and user_id=target_user;
  return d;
end; $$;
revoke all on function public.wealth_council_command(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wealth_council_command(text,uuid,uuid,jsonb) to service_role;
create or replace function public.wealth_council_workflow_version() returns integer language sql immutable set search_path='' as $$ select 1; $$;
revoke all on function public.wealth_council_workflow_version() from public,anon,authenticated;
grant execute on function public.wealth_council_workflow_version() to service_role;
commit;
