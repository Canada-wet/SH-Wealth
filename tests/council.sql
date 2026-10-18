-- Synthetic council runs only; the entire test rolls back, including quota reservations.
begin;
do $$
declare
  u uuid; r uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); r3 uuid:=gen_random_uuid();
  d jsonb; c uuid:=gen_random_uuid(); p jsonb; x jsonb;
begin
  select id into u from auth.users where email='henrywhy233@gmail.com';
  if u is null then raise exception 'Test owner unavailable'; end if;
  p:=jsonb_build_object('question','SYNTHETIC COUNCIL TEST - no personal context','participants',jsonb_build_array('deepseek-light','openai-light'),'judge',null,'models','[]'::jsonb,'steps','[]'::jsonb);
  for i in 0..5 loop
    p:=jsonb_set(p,'{steps}',(p->'steps')||jsonb_build_array(jsonb_build_object('seq',i,'model_key',case when i%2=0 then 'deepseek-light' else 'openai-light' end,'stage',case when i<2 then 'opening' when i<4 then 'critique' else 'revision' end,'status','pending','answer','','error','','usage','{}'::jsonb)));
  end loop;
  d:=public.wealth_council_command('create',u,r,p);
  if d->>'status'<>'active' then raise exception 'create failed'; end if;
  x:=public.wealth_council_command('create',u,r,p);
  if x<>d then raise exception 'idempotent create failed'; end if;
  d:=public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c));
  if d->'steps'->0->>'claim'<>c::text then raise exception 'claim failed'; end if;
  x:=public.wealth_council_command('claim',u,r,jsonb_build_object('claim',gen_random_uuid()));
  if x<>d then raise exception 'duplicate claim'; end if;
  begin
    perform public.wealth_council_command('finish',u,r,jsonb_build_object('seq',0,'claim',gen_random_uuid(),'answer','wrong owner'));
    raise exception 'expected claim mismatch';
  exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  perform public.wealth_council_command('pause',u,r);
  d:=public.wealth_council_command('finish',u,r,jsonb_build_object('seq',0,'claim',c,'answer','Synthetic answer','usage',jsonb_build_object('input',1,'output',2)));
  if d->>'status'<>'paused' or d->'steps'->0->>'status'<>'succeeded' then raise exception 'pause must preserve in-flight completion'; end if;
  if (select count(*) from jsonb_array_elements(d->'steps') where value->>'status'='running')<>0 then raise exception 'finish failed'; end if;
  perform public.wealth_council_command('resume',u,r);
  for i in 1..5 loop
    c:=gen_random_uuid();perform public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c));
    d:=public.wealth_council_command('finish',u,r,jsonb_build_object('seq',i,'claim',c,'answer','Synthetic','usage','{}'::jsonb));
  end loop;
  if d->>'status'<>'complete' then raise exception 'completion failed'; end if;
  -- Keep the row ID available for RLS checks below, only inside this transaction.
  perform set_config('council.test_id',r::text,true);
  perform set_config('council.test_owner',u::text,true);
  perform public.wealth_council_command('create',u,r2,p);
  begin
    perform public.wealth_council_command('create',u,r3,p);raise exception 'expected one-active limit';
  exception when others then if sqlerrm not like '%council_active%' then raise; end if;end;
  c:=gen_random_uuid();perform public.wealth_council_command('claim',u,r2,jsonb_build_object('claim',c));
  begin
    perform public.wealth_council_command('abandon',u,r2,'{"seq":0}');raise exception 'expected wait period';
  exception when others then if sqlerrm not like '%council_running%' then raise; end if;end;
  perform public.wealth_council_command('cancel',u,r2);
  d:=public.wealth_council_command('claim',u,r2,jsonb_build_object('claim',gen_random_uuid()));
  if d->'steps'->1->>'status'<>'pending' then raise exception 'cancel started new work'; end if;
  perform public.wealth_council_command('finish',u,r2,jsonb_build_object('seq',0,'claim',c,'answer','Late synthetic reply','usage','{}'::jsonb));
  perform public.wealth_council_command('delete',u,r2);
  perform public.wealth_council_command('create',u,r3,p);
  perform public.wealth_council_command('cancel',u,r3);
  begin
    perform public.wealth_council_command('create',u,gen_random_uuid(),p);raise exception 'expected quota to survive delete';
  exception when others then if sqlerrm not like '%council_quota%' then raise; end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('council.test_owner'),'role','authenticated')::text,true) is not null as configured;
do $$ begin
  if (select count(*) from public.wealth_council_runs where id=current_setting('council.test_id')::uuid)<>1 then raise exception 'owner read failed'; end if;
  begin perform public.wealth_council_command('claim',auth.uid(),current_setting('council.test_id')::uuid,'{}');raise exception 'client unexpectedly has execution privilege';exception when insufficient_privilege then null;end;
  begin update public.wealth_council_runs set status='active' where id=current_setting('council.test_id')::uuid;raise exception 'client unexpectedly has write privilege';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='sallyxie0378@gmail.com'),'role','authenticated')::text,true) is not null as configured;
set local role authenticated;
do $$ begin
  if (select count(*) from public.wealth_council_runs where id=current_setting('council.test_id')::uuid)<>0 then raise exception 'partner can read private history'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform count(*) from public.wealth_council_runs;raise exception 'anonymous can read history';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
