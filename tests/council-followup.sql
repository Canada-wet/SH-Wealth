-- Synthetic personal conversation only, all quota/history changes rolled back.
begin;
do $$
declare u uuid; r uuid:=gen_random_uuid(); tid uuid:=gen_random_uuid(); d jsonb; p jsonb; c uuid:=gen_random_uuid(); before_count integer; n integer;
begin
  select a.id into u from auth.users a where lower(a.email) in ('henrywhy233@gmail.com','sallyxie0378@gmail.com')
    and not exists(select 1 from public.wealth_council_runs x where x.user_id=a.id and x.status in ('active','paused'))
    and coalesce((select followups from public.wealth_council_quota q where q.user_id=a.id and q.day=(now() at time zone 'America/Toronto')::date),0)<8 limit 1;
  if u is null then raise exception 'No idle allowed test owner; no user jobs will be changed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,723));
  d:=jsonb_build_object('id',r,'question','SYNTHETIC FOLLOWUP TEST','participants',jsonb_build_array('openai-light','deepseek-light'),'judge',null,'models',jsonb_build_array(jsonb_build_object('key','openai-light','model','gpt-6-luna'),jsonb_build_object('key','deepseek-light','model','deepseek-flash')),'status','complete','created_at',now(),'steps',jsonb_build_array(jsonb_build_object('seq',0,'model_key','openai-light','stage','revision','status','succeeded','answer','Synthetic prior conclusion','error','','usage','{}'::jsonb)));
  insert into public.wealth_council_runs(id,user_id,question,status,document) values(r,u,d->>'question','complete',d);
  p:=jsonb_build_object('turnId',tid,'question','SYNTHETIC NEW CONDITIONS','participants',jsonb_build_array('openai-light'),'judge','openai-light','baseRound',0);
  d:=public.wealth_council_command('followup',u,r,p);
  if jsonb_array_length(d->'turns')<>1 or jsonb_array_length(d->'steps')<>3 or d->>'status'<>'active' then raise exception 'followup append failed'; end if;
  if d->'steps'->1->>'stage'<>'followup' or d->'steps'->1->>'round'<>'1' then raise exception 'round metadata missing'; end if;
  if public.wealth_council_command('followup',u,r,p)<>d then raise exception 'followup idempotency failed'; end if;
  begin perform public.wealth_council_command('followup',u,r,jsonb_set(p,'{question}','"changed question"')); raise exception 'duplicate ID accepted changed question';
  exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  begin perform public.wealth_council_command('followup',u,r,jsonb_set(p,'{turnId}',to_jsonb(gen_random_uuid()))); raise exception 'stale round accepted';
  exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  d:=public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c));
  if d->'steps'->1->>'claim'<>c::text then raise exception 'claim resumed wrong round'; end if;
  d:=public.wealth_council_command('finish',u,r,jsonb_build_object('seq',1,'claim',c,'answer','SYNTHETIC NEW ANSWER','usage','{}'::jsonb));
  c:=gen_random_uuid(); perform public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c));
  d:=public.wealth_council_command('finish',u,r,jsonb_build_object('seq',2,'claim',c,'answer','SYNTHETIC JUDGE','usage','{}'::jsonb));
  if d->>'status'<>'complete' or d->'steps'->0->>'answer'<>'Synthetic prior conclusion' then raise exception 'prior conclusions changed'; end if;
  p:=p||jsonb_build_object('turnId',gen_random_uuid(),'baseRound',1,'participants',jsonb_build_array('unknown-provider'));
  begin perform public.wealth_council_command('followup',u,r,p); raise exception 'unconsented model accepted';
  exception when others then if sqlerrm not like '%council_invalid%' then raise; end if; end;
  p:=p||jsonb_build_object('participants',jsonb_build_array('openai-light'),'mode','debate');
  begin perform public.wealth_council_command('followup',u,r,p); raise exception 'single speaker debate accepted';
  exception when others then if sqlerrm not like '%council_invalid%' then raise; end if; end;
  p:=p||jsonb_build_object('participants',jsonb_build_array('openai-light','deepseek-light'));
  d:=public.wealth_council_command('followup',u,r,p);
  if jsonb_array_length(d->'steps')<>10 or d->'turns'->1->>'mode'<>'debate' then raise exception 'debate plan not appended'; end if;
  if (select jsonb_agg(x->>'stage' order by ordinality) from jsonb_array_elements(d->'steps') with ordinality as a(x,ordinality) where ordinality>3)<>'["opening","opening","critique","critique","revision","revision","judge"]'::jsonb then raise exception 'debate phase order wrong'; end if;
  if d->'steps'->3->>'seq'<>'3' or d->'steps'->9->>'round'<>'2' then raise exception 'debate sequence wrong'; end if;
  if public.wealth_council_command('followup',u,r,p)<>d then raise exception 'debate idempotency failed'; end if;
  begin perform public.wealth_council_command('followup',u,r,jsonb_set(p,'{mode}','"direct"')); raise exception 'same turn changed billing mode';
  exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  for n in 3..9 loop
    c:=gen_random_uuid(); d:=public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c));
    if d->'steps'->n->>'claim'<>c::text then raise exception 'wrong debate claim'; end if;
    d:=public.wealth_council_command('finish',u,r,jsonb_build_object('seq',n,'claim',c,'answer','SYNTHETIC DEBATE ANSWER','usage','{}'::jsonb));
  end loop;
  if d->>'status'<>'complete' or d->'steps'->0->>'answer'<>'Synthetic prior conclusion' or d->'turns'->0->>'mode'<>'direct' then raise exception 'mixed old/new history changed'; end if;
  select followups into before_count from public.wealth_council_quota where user_id=u and day=(now() at time zone 'America/Toronto')::date;
  if before_count<2 then raise exception 'followup quota not reserved'; end if;
  -- Reserve all seven new answer budgets before a paid call; failure changes neither quota nor history.
  d:=d||jsonb_build_object('synthetic_padding',repeat('x',3500000));
  update public.wealth_council_runs set document=d where id=r;
  p:=p||jsonb_build_object('turnId',gen_random_uuid(),'baseRound',2);
  begin perform public.wealth_council_command('followup',u,r,p); raise exception 'oversize debate reservation accepted';
  exception when others then if sqlerrm not like '%council_document_full%' then raise; end if; end;
  if (select followups from public.wealth_council_quota where user_id=u and day=(now() at time zone 'America/Toronto')::date)<>before_count or (select jsonb_array_length(document->'turns') from public.wealth_council_runs where id=r)<>2 then raise exception 'rejected debate changed data'; end if;
  perform public.wealth_council_command('delete',u,r);
  if (select followups from public.wealth_council_quota where user_id=u and day=(now() at time zone 'America/Toronto')::date)<>before_count then raise exception 'delete reset quota'; end if;
end $$;
rollback;
