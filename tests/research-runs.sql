-- Synthetic fixtures only. Test claiming, fencing and finishing in a rolled-back transaction.
begin;
do $$ declare person uuid; home uuid:=gen_random_uuid(); run_token uuid:=gen_random_uuid(); changed integer;
begin
  select id into person from auth.users where lower(email)='henrywhy233@gmail.com';
  insert into public.households(id,name) values(home,'Recurring research fixture');
  insert into public.household_members(household_id,user_id,display_name,role) values(home,person,'Fixture','owner');
  perform set_config('test.recurring_home',home::text,true);
  perform set_config('test.recurring_user',person::text,true);
  insert into public.wealth_research_runs(household_id,day,phase,token) values(home,current_date,'open',run_token);
  insert into public.wealth_research_runs(household_id,day,phase,token) values(home,current_date,'open',gen_random_uuid()) on conflict do nothing;
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Duplicate session claimed'; end if;
  update public.wealth_research_runs set source_url='https://funda.ai/agent-chat?c=fixture' where household_id=home and token=gen_random_uuid();
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Wrong fencing token allowed'; end if;
  insert into public.wealth_research_runs(household_id,day,phase,token) values(home,current_date,'close',gen_random_uuid());
  if (select count(*) from public.wealth_research_runs where household_id=home)<>2 then raise exception 'Session independence failed'; end if;
  if has_table_privilege('authenticated','public.wealth_research_runs','INSERT') or has_table_privilege('authenticated','public.wealth_research_runs','UPDATE') or has_table_privilege('anon','public.wealth_research_runs','SELECT') then raise exception 'Unsafe privileges'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.recurring_user'),true) is not null as member_identity;
set local role authenticated;
do $$ begin if (select count(*) from public.wealth_research_runs where household_id=current_setting('test.recurring_home')::uuid)<>2 then raise exception 'Member cannot read status'; end if; end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true) is not null as outsider_identity;
do $$ begin if exists(select 1 from public.wealth_research_runs) then raise exception 'Outsider status leaked'; end if; end; $$;
reset role;
select 'research-runs-dedup-fencing-private-passed' as result;
rollback;
