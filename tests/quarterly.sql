-- Real PostgreSQL verification; synthetic households only, no sends, always rollback.
begin;
do $$ declare first_user uuid; second_user uuid; home uuid:=gen_random_uuid(); connection uuid:=gen_random_uuid(); alert uuid:=gen_random_uuid(); next_alert uuid:=gen_random_uuid();
begin
  select id into first_user from auth.users where lower(email)='henrywhy233@gmail.com';
  select id into second_user from auth.users where lower(email)='sallyxie0378@gmail.com';
  if first_user is null or second_user is null then raise exception 'Missing approved fixture identities'; end if;
  insert into public.households(id,name) values(home,'Quarterly rollback fixture');
  insert into public.household_members(household_id,user_id,display_name,role) values(home,first_user,'Synthetic A','owner'),(home,second_user,'Synthetic B','member');
  insert into public.household_documents(household_id) values(home);
  insert into public.advisor_alerts(id,household_id,title,body,kind) values(alert,home,'Synthetic Q3','No financial details','quarterly_review'),(next_alert,home,'Synthetic Q4','No financial details','quarterly_review');
  insert into public.wealth_notification_channels(id,household_id,user_id,channel,destination_cipher,destination_hash,destination_label,enabled) values(connection,home,first_user,'telegram','synthetic-not-real-cipher',connection::text,'Synthetic only',true);
  if not public.claim_wealth_channel_delivery(connection,alert) then raise exception 'First quarterly claim failed'; end if;
  if public.claim_wealth_channel_delivery(connection,alert) then raise exception 'Duplicate quarterly claim allowed'; end if;
  update public.wealth_channel_deliveries set status='uncertain',attempted_at=now()-interval '1 day' where channel_id=connection and alert_id=alert;
  if public.claim_wealth_channel_delivery(connection,alert) then raise exception 'Ambiguous delivery retried'; end if;
  update public.wealth_notification_channels set enabled=false where id=connection;
  if public.claim_wealth_channel_delivery(connection,next_alert) then raise exception 'Disabled channel claimed'; end if;
  update public.wealth_notification_channels set enabled=true where id=connection;
  if not public.claim_wealth_channel_delivery(connection,next_alert) then raise exception 'Next quarter cannot claim'; end if;
  perform set_config('test.quarter_home',home::text,true);
  perform set_config('test.quarter_first',first_user::text,true);
  perform set_config('test.quarter_second',second_user::text,true);
  if has_function_privilege('authenticated','public.claim_wealth_channel_delivery(uuid,uuid)','EXECUTE') then raise exception 'Unsafe delivery privilege'; end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.quarter_first'),true) is not null as first_identity_set;
set local role authenticated;
do $$ declare document jsonb := '{"version":3,"assets":[],"contributions":[],"preferences":{"quarterlyReviews":{"reminders":true,"external":false,"records":{"2026-Q3":{"notes":"Synthetic shared quarterly note","checks":{},"actions":[]}}}}}';
begin
  if public.save_household_document(current_setting('test.quarter_home')::uuid,0,document)<>1 then raise exception 'Quarterly preference save failed'; end if;
  begin
    perform public.save_household_document(current_setting('test.quarter_home')::uuid,0,document);
    raise exception 'Stale quarterly document overwrote partner data';
  exception when others then if sqlerrm <> 'revision conflict' then raise; end if; end;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.quarter_second'),true) is not null as partner_identity_set;
do $$ declare document jsonb;
begin
  select d.document into document from public.household_documents d where household_id=current_setting('test.quarter_home')::uuid;
  if document #>> '{preferences,quarterlyReviews,records,2026-Q3,notes}' <> 'Synthetic shared quarterly note' then raise exception 'Partner cannot read quarterly review'; end if;
  if (select count(*) from public.advisor_alerts where household_id=current_setting('test.quarter_home')::uuid) <> 2 then raise exception 'Partner cannot read quarterly reminders'; end if;
  document=jsonb_set(document,'{preferences,quarterlyReviews,records,2026-Q3,notes}','"Partner updated synthetic note"'::jsonb);
  if public.save_household_document(current_setting('test.quarter_home')::uuid,1,document)<>2 then raise exception 'Partner cannot save quarterly note'; end if;
end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true) is not null as outsider_identity_set;
do $$ begin
  if exists(select 1 from public.household_documents where household_id=current_setting('test.quarter_home')::uuid) or exists(select 1 from public.advisor_alerts where household_id=current_setting('test.quarter_home')::uuid) then raise exception 'Quarterly data leaked to outsider'; end if;
  begin
    perform public.save_household_document(current_setting('test.quarter_home')::uuid,2,'{"version":3,"assets":[],"contributions":[]}'::jsonb);
    raise exception 'Unauthorized quarterly write allowed';
  exception when others then if sqlerrm <> 'Unauthorized' then raise; end if; end;
end; $$;
reset role;
select 'quarterly-persistence-partner-rls-cas-delivery-dedup-passed' as result;
rollback;
