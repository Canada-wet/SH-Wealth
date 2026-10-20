-- Personal organization, separate from model generation/CAS and household data.
-- Additive; run after council.sql and access.sql. No existing transcript rewrite.
begin;
create table if not exists public.wealth_council_library (
  run_id uuid primary key references public.wealth_council_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check(length(title)<=120 and title=btrim(title)),
  tags text[] not null default '{}' check(cardinality(tags)<=6),
  pinned boolean not null default false,
  archived boolean not null default false,
  note text not null default '' check(length(note)<=2400 and note=btrim(note)),
  review_on date check(review_on between date '2000-01-01' and date '2100-12-31'),
  version bigint not null default 1 check(version between 1 and 9007199254740991),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.wealth_council_library enable row level security;
drop policy if exists "own council organization" on public.wealth_council_library;
create policy "own council organization" on public.wealth_council_library for select to authenticated
using(user_id=auth.uid() and public.is_allowed_wealth_user() and exists(select 1 from public.wealth_council_runs r where r.id=run_id and r.user_id=auth.uid()));
revoke all on public.wealth_council_library from public,anon,authenticated,service_role;
grant select on public.wealth_council_library to authenticated;

create or replace function public.save_wealth_council_memo(target_run uuid, expected_version bigint, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.wealth_council_library; t text; review date; owner_id uuid; run_status text;
begin
  if auth.uid() is null or not public.is_allowed_wealth_user() then raise exception 'library_forbidden'; end if;
  -- Same per-user lock as generation/deletion, without updating generation document.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,723));
  select user_id,status into owner_id,run_status from public.wealth_council_runs where id=target_run;
  if owner_id is distinct from auth.uid() then raise exception 'library_not_found'; end if;
  if expected_version is null or expected_version<0 or expected_version>=9007199254740991 or jsonb_typeof(content) is distinct from 'object' or
    (select count(*) from jsonb_object_keys(content))<>6 or exists(select 1 from jsonb_object_keys(content) k where k not in ('title','tags','pinned','archived','note','reviewOn')) or
    jsonb_typeof(content->'title') is distinct from 'string' or jsonb_typeof(content->'note') is distinct from 'string' or
    jsonb_typeof(content->'pinned') is distinct from 'boolean' or jsonb_typeof(content->'archived') is distinct from 'boolean' or
    jsonb_typeof(content->'reviewOn') is distinct from 'string' or jsonb_typeof(content->'tags') is distinct from 'array' then raise exception 'library_invalid'; end if;
  if length(content->>'title')>120 or length(content->>'note')>2400 or content->>'title'<>btrim(content->>'title') or content->>'note'<>btrim(content->>'note') or
    ((content->>'title')||(content->>'note')) ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' or jsonb_array_length(content->'tags')>6 or
    exists(select 1 from jsonb_array_elements(content->'tags') x where jsonb_typeof(x)<>'string') then raise exception 'library_invalid'; end if;
  for t in select jsonb_array_elements_text(content->'tags') loop
    if length(t) not between 1 and 24 or t<>btrim(t) or t ~ E'[,，\\x01-\\x1F\\x7F]' then raise exception 'library_invalid'; end if;
  end loop;
  if (select count(distinct lower(value)) from jsonb_array_elements_text(content->'tags'))<>jsonb_array_length(content->'tags') then raise exception 'library_invalid'; end if;
  if content->>'reviewOn'<>'' then
    if content->>'reviewOn' !~ '^(20[0-9]{2}|2100)-[0-9]{2}-[0-9]{2}$' then raise exception 'library_invalid'; end if;
    begin review:=(content->>'reviewOn')::date; exception when others then raise exception 'library_invalid'; end;
    if review::text<>content->>'reviewOn' or review not between date '2000-01-01' and date '2100-12-31' then raise exception 'library_invalid'; end if;
  end if;
  if (content->>'archived')::boolean and run_status in ('active','paused') then raise exception 'library_active'; end if;
  select * into r from public.wealth_council_library where run_id=target_run for update;
  if coalesce(r.version,0)<>expected_version then raise exception 'library_conflict'; end if;
  insert into public.wealth_council_library as m(run_id,user_id,title,tags,pinned,archived,note,review_on,version)
  values(target_run,auth.uid(),content->>'title',array(select jsonb_array_elements_text(content->'tags')),(content->>'pinned')::boolean,(content->>'archived')::boolean,content->>'note',review,expected_version+1)
  on conflict(run_id) do update set title=excluded.title,tags=excluded.tags,pinned=excluded.pinned,archived=excluded.archived,note=excluded.note,review_on=excluded.review_on,version=excluded.version,updated_at=clock_timestamp()
  returning * into r;
  return jsonb_build_object('title',r.title,'tags',r.tags,'pinned',r.pinned,'archived',r.archived,'note',r.note,'reviewOn',coalesce(r.review_on::text,''),'version',r.version);
end; $$;

create or replace function public.read_wealth_council_library(search_text text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; terms text[];
begin
  if auth.uid() is null or not public.is_allowed_wealth_user() then raise exception 'library_forbidden'; end if;
  if search_text is null or length(search_text)>120 or search_text ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' then raise exception 'library_invalid'; end if;
  terms:=regexp_split_to_array(lower(btrim(search_text)),E'\\s+');
  if cardinality(terms)>8 then raise exception 'library_invalid'; end if;
  with own as (
    select r.*,m.title,m.tags,m.pinned,m.archived,m.note,m.review_on,m.version,
      coalesce(jsonb_array_length(r.document->'turns'),0) as rounds
    from public.wealth_council_runs r left join public.wealth_council_library m on m.run_id=r.id and m.user_id=auth.uid()
    where r.user_id=auth.uid()
  ), summary as (
    select o.*, greatest(o.created_at,
      (select max((x->>'finished_at')::timestamptz) from jsonb_array_elements(o.document->'steps') x),
      (select max((x->>'created_at')::timestamptz) from jsonb_array_elements(coalesce(o.document->'turns','[]')) x)) as activity,
      case when search_text='' then '' else concat_ws(E'\n',o.question,o.title,o.note,array_to_string(o.tags,' '),
        (select string_agg(x->>'question',E'\n') from jsonb_array_elements(coalesce(o.document->'turns','[]')) x),
        (select string_agg(x->>'answer',E'\n') from jsonb_array_elements(o.document->'steps') x)) end as searchable,
      (select x from jsonb_array_elements(o.document->'steps') x where coalesce((x->>'round')::integer,0)=o.rounds and x->>'stage' in ('judge','revision','followup') and x->>'status'='succeeded'
        and not coalesce((x->'usage'->>'interrupted')::boolean,false) and not coalesce((x->'usage'->>'truncated')::boolean,false)
        order by (x->>'stage'='judge') desc,(x->>'seq')::integer limit 1) as final,
      (select x from jsonb_array_elements(o.document->'steps') x where search_text<>'' and exists(select 1 from unnest(terms) term where term<>'' and strpos(lower(coalesce(x->>'answer','')),term)>0) order by (x->>'seq')::integer limit 1) as hit
    from own o
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'question',s.question,'status',s.status,'createdAt',s.created_at,'activityAt',s.activity,
    'rounds',s.rounds,'models',coalesce((select jsonb_agg(x->>'name') from jsonb_array_elements(s.document->'models') x),'[]'::jsonb),
    'excerpt',left(coalesce(s.final->>'answer',''),400),
    'matched',not exists(select 1 from unnest(terms) term where strpos(lower(s.searchable),term)=0),
    'matchExcerpt',case when s.hit is null then '' else substring(s.hit->>'answer' from greatest(1,(select min(nullif(strpos(lower(s.hit->>'answer'),term),0)) from unnest(terms) term where term<>'')-70) for 330) end,
    'matchRound',case when s.hit is null then null else coalesce((s.hit->>'round')::integer,0) end,
    'matchSeq',(s.hit->>'seq')::integer,
    'memo',jsonb_build_object('title',coalesce(s.title,''),'tags',coalesce(to_jsonb(s.tags),'[]'::jsonb),'pinned',coalesce(s.pinned,false),'archived',coalesce(s.archived,false),'note',coalesce(s.note,''),'reviewOn',coalesce(s.review_on::text,''),'version',coalesce(s.version,0))
  ) order by s.activity desc,s.id),'[]'::jsonb) into result from summary s;
  return result;
end; $$;
revoke all on function public.read_wealth_council_library(text),public.save_wealth_council_memo(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_wealth_council_library(text),public.save_wealth_council_memo(uuid,bigint,jsonb) to authenticated;
commit;
