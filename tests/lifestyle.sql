-- Synthetic household only. No actual household reads/writes. Entire fixture rolls back.
begin;
do $$ declare first_user uuid; second_user uuid; home uuid:=gen_random_uuid();
begin
  select id into first_user from auth.users where lower(email)='henrywhy233@gmail.com';
  select id into second_user from auth.users where lower(email)='sallyxie0378@gmail.com';
  if first_user is null or second_user is null then raise exception 'Missing approved fixture identities'; end if;
  insert into public.households(id,name) values(home,'Lifestyle rollback fixture');
  insert into public.household_members(household_id,user_id,display_name,role) values(home,first_user,'Synthetic A','owner'),(home,second_user,'Synthetic B','member');
  insert into public.household_documents(household_id) values(home);
  perform set_config('test.hobby_home',home::text,true);
  perform set_config('test.hobby_first',first_user::text,true);
  perform set_config('test.hobby_second',second_user::text,true);
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.hobby_first'),true) is not null as first_identity_set;
set local role authenticated;
do $$ declare document jsonb := '{"version":3,"assets":[{"id":"fixture-cash","value":1000,"name":"Synthetic cash","category":"现金","owner":"joint","annualReturn":null}],"history":[],"contributions":[],"preferences":{"quarterlyReviews":{"reminders":true,"external":false,"records":{}},"lifestyle":{"version":1,"tracks":[{"id":"fixture-track","title":"Synthetic track","artist":"Synthetic artist","bpm":122,"key":"8A","genre":"House","energy":4,"duration":330,"cueNotes":"Synthetic intro","rating":4,"cues":[]}],"sets":[],"practices":[],"settings":{"weights":{"bpm":30,"key":30,"energy":25,"preference":15},"energyDelta":1,"genres":[],"halfDouble":false,"keyLock":true}}}}';
begin
  if public.save_household_document(current_setting('test.hobby_home')::uuid,0,document)<>1 then raise exception 'Lifestyle save failed'; end if;
  begin
    perform public.save_household_document(current_setting('test.hobby_home')::uuid,0,document);
    raise exception 'Stale lifestyle save allowed';
  exception when others then if sqlerrm <> 'revision conflict' then raise; end if; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.hobby_second'),true) is not null as partner_identity_set;
do $$ declare document jsonb;
begin
  select d.document into document from public.household_documents d where household_id=current_setting('test.hobby_home')::uuid;
  if document #>> '{preferences,lifestyle,tracks,0,cueNotes}' <> 'Synthetic intro' then raise exception 'Partner cannot read hobby'; end if;
  document=jsonb_set(document,'{preferences,lifestyle,tracks,0,rating}','5'::jsonb);
  if public.save_household_document(current_setting('test.hobby_home')::uuid,1,document)<>2 then raise exception 'Partner hobby edit failed'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.hobby_first'),true) is not null as first_identity_restored;
do $$ declare document jsonb;
begin
  select d.document into document from public.household_documents d where household_id=current_setting('test.hobby_home')::uuid;
  if document #>> '{preferences,lifestyle,tracks,0,rating}' <> '5' then raise exception 'Partner rating not persistent'; end if;
  if document #>> '{assets,0,value}' <> '1000' or jsonb_array_length(document->'history') <> 0 or document #>> '{preferences,quarterlyReviews,reminders}' <> 'true' then raise exception 'Unrelated wealth or review changed'; end if;
end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true) is not null as outsider_identity_set;
do $$ begin
  if exists(select 1 from public.household_documents where household_id=current_setting('test.hobby_home')::uuid) then raise exception 'Hobby leaked to outsider'; end if;
  begin
    perform public.save_household_document(current_setting('test.hobby_home')::uuid,2,'{"version":3,"assets":[],"contributions":[]}'::jsonb);
    raise exception 'Unauthorized hobby write allowed';
  exception when others then if sqlerrm <> 'Unauthorized' then raise; end if; end;
end; $$;
reset role;
select 'lifestyle-persistence-partner-rls-cas-wealth-isolation-passed' as result;
rollback;
