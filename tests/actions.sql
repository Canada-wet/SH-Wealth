-- Synthetic identities, household and actions only. Entire test transaction rolls back.
-- The whitelist predicate override is uncommitted and restored by ROLLBACK.
begin;
insert into auth.users(id,email,email_confirmed_at,aud,role)
values('a1000000-0000-4000-8000-000000000001','action-fixture-a@example.invalid',now(),'authenticated','authenticated'),
      ('a1000000-0000-4000-8000-000000000002','action-fixture-b@example.invalid',now(),'authenticated','authenticated'),
      ('a1000000-0000-4000-8000-000000000003','action-fixture-outsider@example.invalid',now(),'authenticated','authenticated');
create or replace function public.is_allowed_wealth_user() returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() in ('a1000000-0000-4000-8000-000000000001'::uuid,'a1000000-0000-4000-8000-000000000002'::uuid,'a1000000-0000-4000-8000-000000000003'::uuid); $$;
insert into public.households(id,name) values('a2000000-0000-4000-8000-000000000001','Synthetic action household');
insert into public.household_members(household_id,user_id,display_name,role)
values('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Fixture A','owner'),
      ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','Fixture B','member');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true) is not null as fixture_a;
do $$ declare row jsonb; bad jsonb; begin
  if public.list_wealth_actions('a2000000-0000-4000-8000-000000000001')<>'[]' then raise exception 'GET caused writes'; end if;
  row:=public.mutate_wealth_action('create','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',null,'{"title":"Synthetic private council action","owner":"second","sourceFeature":"council","sourceRef":"a4000000-0000-4000-8000-000000000001"}');
  if row->>'visibility'<>'private' or row->>'version'<>'1' or row ? 'createdBy' then raise exception 'Default privacy or identity leak'; end if;
  if public.mutate_wealth_action('create','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',null,'{"title":"Synthetic private council action","owner":"second","sourceFeature":"council","sourceRef":"a4000000-0000-4000-8000-000000000001"}')<>row then raise exception 'Create retry not idempotent'; end if;
  perform public.mutate_wealth_action('create','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002',null,'{"title":"Explicit shared action","visibility":"household","sourceFeature":"assets","sourceRef":"a4000000-0000-4000-8000-000000000002"}');
  begin
    perform public.mutate_wealth_action('create','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003',null,'{"title":"Unsafe council share","visibility":"household","sourceFeature":"council","sourceRef":"a4000000-0000-4000-8000-000000000001"}');
    raise exception 'Private council ref was shared';
  exception when raise_exception then if SQLERRM<>'action_invalid' then raise; end if; end;
  begin
    perform public.mutate_wealth_action('update','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'{"visibility":"household"}');
    raise exception 'Private action was converted';
  exception when raise_exception then if SQLERRM<>'action_invalid' then raise; end if; end;
  begin
    perform public.mutate_wealth_action('update','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'{"sourceRef":"a4000000-0000-4000-8000-000000000002"}');
    raise exception 'Source was rewritten';
  exception when raise_exception then if SQLERRM<>'action_invalid' then raise; end if; end;
  begin
    perform source_ref from public.wealth_action_items;
    raise exception 'Raw source references were selectable';
  exception when insufficient_privilege then null; end;
  begin
    update public.wealth_action_items set title='bypass';
    raise exception 'Direct write accepted';
  exception when insufficient_privilege then null; end;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('title',''),jsonb_build_object('title',repeat('x',161)),
    jsonb_build_object('title','control'||chr(1)),jsonb_build_object('title','valid','note',repeat('x',2001)),
    jsonb_build_object('title','valid','due','2026-02-30'),jsonb_build_object('title','valid','due','2101-01-01'),
    jsonb_build_object('title','valid','sourceFeature','https://evil.test'),
    jsonb_build_object('title','valid','sourceFeature','council','sourceRef','https://evil.test/private'),
    jsonb_build_object('title','valid','owner','unknown'),jsonb_build_object('title','valid','status','unknown'),
    jsonb_build_object('title','valid','createdBy','partner'))) loop
    begin
      perform public.mutate_wealth_action('create','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000009',null,bad);
      raise exception 'Invalid database input accepted';
    exception when raise_exception then if SQLERRM<>'action_invalid' then raise; end if; end;
  end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true) is not null as fixture_b;
do $$ declare rows jsonb; row jsonb; begin
  rows:=public.list_wealth_actions('a2000000-0000-4000-8000-000000000001');
  if jsonb_array_length(rows)<>1 or rows->0->>'sourceRef'<>'' or rows->0->>'title'<>'Explicit shared action' then raise exception 'Partner sees private metadata or opaque ref'; end if;
  if (select count(*) from public.wealth_action_items)<>1 then raise exception 'Direct RLS exposes private rows'; end if;
  begin
    perform public.mutate_wealth_action('update','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'{"status":"done"}');
    raise exception 'Partner edited private action';
  exception when raise_exception then if SQLERRM<>'action_not_found' then raise; end if; end;
  row:=public.mutate_wealth_action('update','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002',1,'{"status":"doing","due":"2026-10-20"}');
  if row->>'version'<>'2' or row->>'sourceRef'<>'' or row->>'status'<>'doing' then raise exception 'Partner shared CAS update failed'; end if;
  begin
    perform public.mutate_wealth_action('delete','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002',1,'{}');
    raise exception 'Stale delete succeeded';
  exception when raise_exception then if SQLERRM<>'action_conflict' then raise; end if; end;
  perform public.mutate_wealth_action('delete','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002',2,'{}');
end $$;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}',true) is not null as fixture_outsider;
do $$ begin
  begin perform public.list_wealth_actions('a2000000-0000-4000-8000-000000000001'); raise exception 'Outsider read accepted';
  exception when raise_exception then if SQLERRM<>'action_forbidden' then raise; end if; end;
  begin perform public.mutate_wealth_action('create','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000004',null,'{"title":"Outsider"}'); raise exception 'Outsider write accepted';
  exception when raise_exception then if SQLERRM<>'action_forbidden' then raise; end if; end;
end $$;
reset role;
-- Fill only this transaction's synthetic private bucket, not real action rows.
insert into public.wealth_action_items(id,household_id,created_by,title)
select gen_random_uuid(),'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Synthetic capacity '||i from generate_series(1,499) i;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true) is not null as capacity_identity;
do $$ begin
  begin perform public.mutate_wealth_action('create','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000005',null,'{"title":"Beyond capacity"}'); raise exception 'Capacity bypass accepted';
  exception when raise_exception then if SQLERRM<>'action_capacity' then raise; end if; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.list_wealth_actions('a2000000-0000-4000-8000-000000000001'); raise exception 'Anonymous read accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  begin perform public.mutate_wealth_action('delete','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'{}'); raise exception 'Service-role bypass accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.household_documents where household_id='a2000000-0000-4000-8000-000000000001') then raise exception 'Action center wrote family ledger'; end if;
end $$;
rollback;
