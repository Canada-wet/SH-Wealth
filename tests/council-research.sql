-- Synthetic private run; no model/search requests, every write and quota reservation rolls back.
begin;
do $$
declare u uuid; r uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d jsonb; original jsonb; p jsonb; settings jsonb; n integer;
begin
  select a.id into u from auth.users a where lower(a.email) in ('henrywhy233@gmail.com','sallyxie0378@gmail.com') and not exists(select 1 from public.wealth_council_runs x where x.user_id=a.id and x.status in ('active','paused')) and coalesce((select followups from public.wealth_council_quota q where q.user_id=a.id and q.day=(now() at time zone 'America/Toronto')::date),0)<10 limit 1;
  if u is null then raise exception 'No idle test owner; no real runs will be changed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,723));
  settings:='{"depth":"deep","tools":true,"publicQueries":["Bank of Canada official decision"],"webConsent":true}'::jsonb;
  if not public.wealth_council_research_valid(settings) then raise exception 'valid research rejected'; end if;
  if public.wealth_council_research_valid(jsonb_set(settings,'{webConsent}','false')) or public.wealth_council_research_valid(jsonb_set(settings,'{publicQueries}','["person@example.com"]')) or public.wealth_council_research_valid(jsonb_set(settings,'{publicQueries}','[123]')) then raise exception 'invalid research accepted'; end if;
  select jsonb_agg(jsonb_build_object('seq',i,'model_key',case when i%2=0 then 'openai-light' else 'deepseek-light' end,'stage',case i/2 when 0 then 'opening' when 1 then 'critique' when 2 then 'investigation' when 3 then 'rebuttal' else 'revision' end,'status',case when i<4 then 'succeeded' else 'pending' end,'answer',case when i<4 then 'Synthetic claim' else '' end,'error','','usage','{}'::jsonb) order by i) into original from generate_series(0,9) i;
  d:=jsonb_build_object('id',r,'question','SYNTHETIC DEEP RESEARCH','participants','["openai-light","deepseek-light"]'::jsonb,'judge',null,'models','[{"key":"openai-light"},{"key":"deepseek-light"}]'::jsonb,'research',settings,'status','active','created_at',now(),'steps',original);
  insert into public.wealth_council_runs(id,user_id,question,status,document) values(r,u,d->>'question','active',d);
  d:=public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c));
  if d->'steps'->4->>'stage'<>'investigation' then raise exception 'wrong investigation claim'; end if;
  p:=jsonb_build_object('seq',4,'claim',c,'receiptId','T5.1','queryId',0,'query','UNTRUSTED ARBITRARY QUERY');
  perform public.wealth_council_command('pause',u,r);
  d:=public.wealth_council_command('tool-start',u,r,p);
  if d->'steps'->4 ? 'tool_receipts' then raise exception 'paused run reserved external call'; end if;
  perform public.wealth_council_command('resume',u,r);
  d:=public.wealth_council_command('tool-start',u,r,p);
  if d->'steps'->4->'tool_receipts'->0->>'input'<>'Bank of Canada official decision' or d->'steps'->4->'tool_receipts'->0->>'status'<>'running' then raise exception 'intent not derived from approved words'; end if;
  if public.wealth_council_command('tool-start',u,r,p)<>d then raise exception 'intent duplicate changed run'; end if;
  begin perform public.wealth_council_command('tool-start',u,r,jsonb_set(p,'{claim}',to_jsonb(gen_random_uuid()))); raise exception 'wrong lease accepted'; exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  begin perform public.wealth_council_command('tool-start',u,r,jsonb_set(p,'{queryId}','1')); raise exception 'unapproved query accepted'; exception when others then if sqlerrm not like '%council_invalid%' then raise; end if; end;
  -- Explicitly abandon an uncertain paid request, keeping its durable intent for deduplication.
  d:=jsonb_set(d,'{steps,4,started_at}',to_jsonb(now()-interval '7 minutes'));
  update public.wealth_council_runs set document=d where id=r;
  perform public.wealth_council_command('abandon',u,r,jsonb_build_object('seq',4));
  c:=gen_random_uuid(); d:=public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c));
  p:=jsonb_build_object('seq',5,'claim',c,'receiptId','T6.1','queryId',0);
  d:=public.wealth_council_command('tool-start',u,r,p);
  if d->'steps'->5 ? 'tool_receipts' then raise exception 'uncertain query was automatically re-reserved'; end if;
  d:=public.wealth_council_command('finish',u,r,jsonb_build_object('seq',5,'claim',c,'answer','Synthetic uncertainty acknowledgment','usage','{}'::jsonb,'tool_receipts','[{"id":"T6.1","tool":"search_public","status":"unknown","input":"Bank of Canada official decision","queryId":0,"reusedFrom":"T5.1","checkedAt":"2026-10-18","output":"Unknown; no automatic retry"}]'::jsonb));
  for n in 6..9 loop c:=gen_random_uuid(); perform public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c)); d:=public.wealth_council_command('finish',u,r,jsonb_build_object('seq',n,'claim',c,'answer','Synthetic rebuttal or revision','usage','{}'::jsonb)); end loop;
  if d->>'status'<>'complete' or d->'steps'->5->'tool_receipts'->0->>'status'<>'unknown' then raise exception 'receipts not retained'; end if;
  p:=jsonb_build_object('turnId',gen_random_uuid(),'question','SYNTHETIC DEEP FOLLOWUP','participants','["openai-light","deepseek-light"]'::jsonb,'judge',null,'mode','debate','baseRound',0,'research',settings);
  d:=public.wealth_council_command('followup',u,r,p);
  if jsonb_array_length(d->'steps')<>20 or d->'steps'->14->>'stage'<>'investigation' or d->'steps'->16->>'stage'<>'rebuttal' or d->'turns'->0->'research'<>settings then raise exception 'deep followup not frozen'; end if;
  if public.wealth_council_command('followup',u,r,p)<>d then raise exception 'deep followup not idempotent'; end if;
  begin perform public.wealth_council_command('followup',u,r,jsonb_set(p,'{research,publicQueries}','["different public words"]')); raise exception 'changed tool authorization reused turn ID'; exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  if has_function_privilege('authenticated','public.wealth_council_command(text,uuid,uuid,jsonb)','execute') or has_function_privilege('anon','public.wealth_council_command(text,uuid,uuid,jsonb)','execute') then raise exception 'client can invoke internal tool command'; end if;
end $$;
rollback;
