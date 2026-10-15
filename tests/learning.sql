-- Transactional RLS / deduplication test. Only new synthetic household rows; always rolled back.
begin;
do $$ declare first_user uuid; second_user uuid; fixture uuid:=gen_random_uuid();
begin
  select id into first_user from auth.users where lower(email)='henrywhy233@gmail.com';
  select id into second_user from auth.users where lower(email)='sallyxie0378@gmail.com';
  if first_user is null or second_user is null then raise exception 'Missing authorized test accounts'; end if;
  insert into public.households(id,name) values(fixture,'Learning transactional fixture');
  insert into public.household_members(household_id,user_id,display_name,role) values(fixture,first_user,'Fixture first','owner'),(fixture,second_user,'Fixture second','member');
  perform set_config('test.learning_home',fixture::text,true);
  perform set_config('test.learning_first',first_user::text,true);
  perform set_config('test.learning_second',second_user::text,true);
  if has_table_privilege('authenticated','public.wealth_learning_deliveries','INSERT') or has_function_privilege('authenticated','public.claim_wealth_learning_delivery(uuid,uuid,date,text,text)','EXECUTE') then raise exception 'Unsafe delivery grants'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.learning_first'),true) is not null as first_identity_set;
set local role authenticated;
insert into public.wealth_learning_preferences(household_id,user_id,daily,favorites) values(current_setting('test.learning_home')::uuid,auth.uid(),true,array['if-then-v1']);
select set_config('request.jwt.claim.sub',current_setting('test.learning_second'),true) is not null as second_identity_set;
do $$ begin
  if exists(select 1 from public.wealth_learning_preferences where household_id=current_setting('test.learning_home')::uuid) then raise exception 'Partner collection leaked'; end if;
  begin
    insert into public.wealth_learning_preferences(household_id,user_id) values(current_setting('test.learning_home')::uuid,current_setting('test.learning_first')::uuid);
    raise exception 'Partner preference write allowed';
  exception when insufficient_privilege then null;
  end;
end; $$;
insert into public.wealth_learning_preferences(household_id,user_id,daily,favorites) values(current_setting('test.learning_home')::uuid,auth.uid(),false,array['progress-v1']);
reset role;
do $$ declare home uuid:=current_setting('test.learning_home')::uuid; person uuid:=current_setting('test.learning_first')::uuid; day date:=(now() at time zone 'America/Toronto')::date;
begin
  if not public.claim_wealth_learning_delivery(home,person,day,'push',repeat('a',64)) then raise exception 'Initial delivery claim failed'; end if;
  if public.claim_wealth_learning_delivery(home,person,day,'push',repeat('a',64)) then raise exception 'Duplicate delivery claim allowed'; end if;
  if public.claim_wealth_learning_delivery(home,person,day-1,'push',repeat('b',64)) then raise exception 'Historical notification allowed'; end if;
  update public.wealth_learning_preferences set daily=false where household_id=home and user_id=person;
  if public.claim_wealth_learning_delivery(home,person,day,'push',repeat('c',64)) then raise exception 'Opt-out ignored'; end if;
end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true) is not null as unapproved_identity_set;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.wealth_learning_preferences) or exists(select 1 from public.wealth_learning_deliveries) then raise exception 'Unapproved user bypassed RLS'; end if;
end; $$;
reset role;
select 'personal-isolation-and-daily-dedup-passed' as result;
rollback;
