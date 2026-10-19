-- Independent household/private actions. Run after persistence.sql and access.sql.
-- No household_documents writes, service-role mutation path, or private council lookup.
begin;
create or replace function public.wealth_action_source_valid(feature text, ref text, scope text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(feature in ('','space','action-center','overview','assets','cashflow','growth','contributions','framework','quarterly-review','markets','watchlist-pulse','market-intelligence','market-wealth','investment-desk','macro-research','rates-research','fx-research','securities','research-archive','council','learn','learning-favorites','lifestyle','library','sets','practice','rekordbox','advisor','history','settings','members','alerts','updates')
    and scope in ('private','household') and
    (ref='' or (feature<>'' and not(feature='council' and scope='household') and
      case when feature='quarterly-review' then ref ~ '^(20[0-9]{2}|2100)-Q[1-4]$'
        else ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' end)),false);
$$;
revoke all on function public.wealth_action_source_valid(text,text,text) from public,anon,authenticated,service_role;

create table if not exists public.wealth_action_items (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(title) between 1 and 160 and length(btrim(title))>0 and title=btrim(title)),
  note text not null default '' check(length(note)<=2000 and note=btrim(note)),
  assigned_owner text not null default 'joint' check(assigned_owner in ('first','second','joint')),
  status text not null default 'planned' check(status in ('planned','doing','done')),
  due date check(due between date '2000-01-01' and date '2100-12-31'),
  visibility text not null default 'private' check(visibility in ('private','household')),
  source_feature text not null default '',
  source_ref text not null default '',
  version bigint not null default 1 check(version between 1 and 9007199254740991),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(public.wealth_action_source_valid(source_feature,source_ref,visibility)),
  check(title !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' and note !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]')
);
create index if not exists wealth_actions_home on public.wealth_action_items(household_id,visibility,created_by,updated_at desc);
alter table public.wealth_action_items enable row level security;
drop policy if exists "members read visible actions" on public.wealth_action_items;
create policy "members read visible actions" on public.wealth_action_items for select to authenticated
using(public.is_allowed_wealth_user() and public.is_wealth_member(household_id) and (visibility='household' or created_by=auth.uid()));
revoke all on public.wealth_action_items from public,anon,authenticated,service_role;
-- Even a direct REST query cannot reveal another member's opaque source reference.
grant select(id,household_id,title,note,assigned_owner,status,due,visibility,source_feature,version,created_at,updated_at) on public.wealth_action_items to authenticated;

create or replace function public.wealth_action_json(item public.wealth_action_items) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',item.id,'title',item.title,'note',item.note,'owner',item.assigned_owner,'status',item.status,
    'due',coalesce(item.due::text,''),'visibility',item.visibility,'sourceFeature',item.source_feature,
    'sourceRef',case when item.created_by=auth.uid() then item.source_ref else '' end,'version',item.version,
    'createdAt',to_char(item.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',to_char(item.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
revoke all on function public.wealth_action_json(public.wealth_action_items) from public,anon,authenticated,service_role;

create or replace function public.list_wealth_actions(target_household uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_allowed_wealth_user() or not public.is_wealth_member(target_household) then raise exception 'action_forbidden'; end if;
  select coalesce(jsonb_agg(public.wealth_action_json(item) order by item.updated_at desc,item.id),'[]'::jsonb) into result
    from public.wealth_action_items item where item.household_id=target_household and (item.visibility='household' or item.created_by=auth.uid());
  return result;
end; $$;

create or replace function public.mutate_wealth_action(operation text,target_household uuid,target_id uuid,expected_version bigint default null,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.wealth_action_items; normalized jsonb; k text; requested_due date;
begin
  if auth.uid() is null or not public.is_allowed_wealth_user() or not public.is_wealth_member(target_household) then raise exception 'action_forbidden'; end if;
  if target_id is null or target_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or operation is null or operation not in ('create','update','delete') or jsonb_typeof(payload) is distinct from 'object' then raise exception 'action_invalid'; end if;
  if operation='create' then
    if expected_version is not null or jsonb_typeof(payload->'title') is distinct from 'string' or exists(select 1 from jsonb_object_keys(payload) key where key not in ('title','note','owner','status','due','visibility','sourceFeature','sourceRef')) then raise exception 'action_invalid'; end if;
  elsif expected_version is null or expected_version<1 then raise exception 'action_invalid';
  elsif operation='update' then
    if payload='{}'::jsonb or exists(select 1 from jsonb_object_keys(payload) key where key not in ('title','note','owner','status','due')) then raise exception 'action_invalid'; end if;
  elsif payload<>'{}'::jsonb then raise exception 'action_invalid'; end if;
  for k in select jsonb_object_keys(payload) loop
    if jsonb_typeof(payload->k) is distinct from 'string' then raise exception 'action_invalid'; end if;
  end loop;
  if payload ? 'due' and payload->>'due'<>'' then
    if payload->>'due' !~ '^(20[0-9]{2}|2100)-[0-9]{2}-[0-9]{2}$' then raise exception 'action_invalid'; end if;
    begin requested_due:=(payload->>'due')::date;
    exception when others then raise exception 'action_invalid'; end;
    if requested_due::text<>payload->>'due' or requested_due not between date '2000-01-01' and date '2100-12-31' then raise exception 'action_invalid'; end if;
  end if;
  -- Serialize capacity checks and per-item mutations within this household.
  perform pg_advisory_xact_lock(hashtextextended('actions:'||target_household::text,0));
  select * into item from public.wealth_action_items where id=target_id for update;
  if operation='create' then
    normalized:=jsonb_build_object('title',btrim(payload->>'title'),'note',btrim(coalesce(payload->>'note','')),'owner',coalesce(payload->>'owner','joint'),
      'status',coalesce(payload->>'status','planned'),'due',coalesce(payload->>'due',''),'visibility',coalesce(payload->>'visibility','private'),
      'sourceFeature',coalesce(payload->>'sourceFeature',''),'sourceRef',coalesce(payload->>'sourceRef',''));
    if not public.wealth_action_source_valid(normalized->>'sourceFeature',normalized->>'sourceRef',normalized->>'visibility') then raise exception 'action_invalid'; end if;
    if item.id is not null then
      if item.household_id<>target_household or item.created_by<>auth.uid() then raise exception 'action_not_found'; end if;
      if normalized<>(public.wealth_action_json(item)-array['id','version','createdAt','updatedAt']) then raise exception 'action_conflict'; end if;
      return public.wealth_action_json(item);
    end if;
    if (select count(*) from public.wealth_action_items where household_id=target_household and visibility=normalized->>'visibility' and (visibility='household' or created_by=auth.uid()))>=500 then raise exception 'action_capacity'; end if;
    begin
      insert into public.wealth_action_items(id,household_id,created_by,title,note,assigned_owner,status,due,visibility,source_feature,source_ref)
      values(target_id,target_household,auth.uid(),normalized->>'title',normalized->>'note',normalized->>'owner',normalized->>'status',requested_due,normalized->>'visibility',normalized->>'sourceFeature',normalized->>'sourceRef') returning * into item;
    exception when check_violation or not_null_violation then raise exception 'action_invalid'; end;
    return public.wealth_action_json(item);
  end if;
  if item.id is null or item.household_id<>target_household or (item.visibility='private' and item.created_by<>auth.uid()) then raise exception 'action_not_found'; end if;
  if item.version<>expected_version then raise exception 'action_conflict'; end if;
  if operation='delete' then
    delete from public.wealth_action_items where id=target_id;
    return jsonb_build_object('deleted',true,'id',target_id);
  end if;
  begin
    update public.wealth_action_items set title=case when payload ? 'title' then btrim(payload->>'title') else title end,
      note=case when payload ? 'note' then btrim(payload->>'note') else note end,
      assigned_owner=coalesce(payload->>'owner',assigned_owner),status=coalesce(payload->>'status',status),
      due=case when payload ? 'due' then requested_due else due end,version=version+1,updated_at=clock_timestamp()
      where id=target_id returning * into item;
  exception when check_violation or not_null_violation then raise exception 'action_invalid'; end;
  return public.wealth_action_json(item);
end; $$;
revoke all on function public.list_wealth_actions(uuid),public.mutate_wealth_action(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_wealth_actions(uuid),public.mutate_wealth_action(text,uuid,uuid,bigint,jsonb) to authenticated;
commit;
