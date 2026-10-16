-- Only synthetic household rows, rolled back. Never changes household documents.
begin;
do $$ declare person uuid; partner uuid; home uuid:=gen_random_uuid();
begin
  select id into person from auth.users where lower(email)='henrywhy233@gmail.com';
  select id into partner from auth.users where lower(email)='sallyxie0378@gmail.com';
  if person is null or partner is null then raise exception 'Missing allowed users'; end if;
  insert into public.households(id,name) values(home,'Research archive synthetic fixture');
  insert into public.household_members(household_id,user_id,display_name,role) values(home,person,'Fixture first','owner'),(home,partner,'Fixture second','member');
  perform set_config('test.archive_home',home::text,true);
  perform set_config('test.archive_first',person::text,true);
  perform set_config('test.archive_second',partner::text,true);
  insert into public.wealth_research_archive(household_id,source,source_url,captured_at,prompt,response,status,content_hash)
  values(home,'funda','https://funda.ai/agent-chat?c=synthetic-test',now(),'Synthetic query','Synthetic answer','complete',repeat('a',64));
  begin
    insert into public.wealth_research_archive(household_id,source,source_url,captured_at,prompt,response,status,content_hash)
    values(home,'funda','https://funda.ai/agent-chat?c=synthetic-test',now(),'Synthetic query','Synthetic answer','complete',repeat('a',64));
    raise exception 'Duplicate import allowed';
  exception when unique_violation then null; end;
  if has_table_privilege('anon','public.wealth_research_archive','SELECT') or has_table_privilege('authenticated','public.wealth_research_archive','INSERT') or has_table_privilege('authenticated','public.wealth_research_archive','UPDATE') or has_table_privilege('authenticated','public.wealth_research_archive','DELETE') then raise exception 'Unsafe archive privileges'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.archive_first'),true) is not null as first_identity;
set local role authenticated;
do $$ begin if (select count(*) from public.wealth_research_archive where household_id=current_setting('test.archive_home')::uuid)<>1 then raise exception 'First member cannot read'; end if; end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.archive_second'),true) is not null as second_identity;
do $$ begin if (select count(*) from public.wealth_research_archive where household_id=current_setting('test.archive_home')::uuid)<>1 then raise exception 'Partner cannot read'; end if; end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true) is not null as outsider_identity;
do $$ begin if exists(select 1 from public.wealth_research_archive) then raise exception 'Outsider data leak'; end if; end; $$;
reset role;
select 'archive-member-isolation-readonly-dedup-passed' as result;
rollback;
