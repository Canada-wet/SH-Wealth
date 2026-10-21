-- ISOLATED DATABASE ONLY. Synthetic identities; never run against a user's production data.
-- All rows and quota changes roll back. No model, search or external request is made.
begin;
do $$
declare u uuid; r uuid:=gen_random_uuid(); c uuid; d jsonb; old jsonb; p jsonb; w jsonb; q jsonb; additions jsonb; n integer;
begin
  select id into u from auth.users where email='henrywhy233@gmail.com';
  if u is null or exists(select 1 from public.wealth_council_runs) then raise exception 'Isolated empty fixture database required'; end if;
  w:='{"version":1,"stages":[
    {"id":"start","type":"opening","title":"独立建模","instructions":"","participants":["openai-light","deepseek-light"]},
    {"id":"specialist","type":"custom","title":"极端情景","instructions":"比较三种风险情景","participants":["deepseek-light"]},
    {"id":"challenge-a","type":"critique","title":"首次质询","instructions":"","participants":["openai-light","deepseek-light"]},
    {"id":"challenge-b","type":"critique","title":"再次质询","instructions":"","participants":["openai-light"]},
    {"id":"end","type":"revision","title":"最终选择","instructions":"","participants":["openai-light","deepseek-light"]}
  ]}'::jsonb;
  p:=jsonb_build_object('question','SYNTHETIC CUSTOM WORKFLOW','participants','["openai-light","deepseek-light"]'::jsonb,'judge',null,'models','[{"key":"openai-light"},{"key":"deepseek-light"}]'::jsonb,'workflow',w,'steps','[{"stage":"judge","status":"succeeded","answer":"Injected fake result"}]'::jsonb);
  d:=public.wealth_council_command('create',u,r,p);
  if jsonb_array_length(d->'steps')<>8 or d->'steps'->2->>'phase_id'<>'specialist' or d->'steps'->2->>'stage'<>'custom' or d->'steps'->5->>'phase_id'<>'challenge-b' or d->'steps'->0->>'answer'<>'' then raise exception 'Canonical plan mismatch or client-supplied steps trusted'; end if;
  if public.wealth_council_command('create',u,r,p)<>d then raise exception 'Create not idempotent'; end if;
  begin perform public.wealth_council_command('create',u,r,p-'workflow'); raise exception 'Dropped workflow accepted on retry'; exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  begin perform public.wealth_council_command('create',u,r,jsonb_set(p,'{workflow,stages,1,instructions}','"Different private task"')); raise exception 'Workflow mutation accepted'; exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  for n in 0..7 loop
    c:=gen_random_uuid(); d:=public.wealth_council_command('claim',u,r,jsonb_build_object('claim',c));
    if (d->'steps'->n->>'seq')::integer<>n then raise exception 'Wrong sequence'; end if;
    if public.wealth_council_command('claim',u,r,jsonb_build_object('claim',gen_random_uuid()))<>d then raise exception 'Duplicate claim started work'; end if;
    d:=public.wealth_council_command('finish',u,r,jsonb_build_object('seq',n,'claim',c,'answer','Synthetic visible answer','usage','{}'::jsonb));
  end loop;
  if d->>'status'<>'complete' or d->'workflow'<>w then raise exception 'Workflow not frozen'; end if;
  old:=d;
  q:=jsonb_build_object('turnId',gen_random_uuid(),'question','SYNTHETIC CUSTOM FOLLOWUP','participants',p->'participants','judge','openai-light','mode','debate','baseRound',0,'workflow',w);
  d:=public.wealth_council_command('followup',u,r,q);
  if jsonb_array_length(d->'steps')<>17 or d->'turns'->0->'workflow'<>w or d->'steps'->10->>'phase_id'<>'specialist' or d->'steps'->16->>'stage'<>'judge' or (d->'steps'->16->>'round')::integer<>1 or d->'steps'->0<>old->'steps'->0 then raise exception 'Followup plan or earlier transcript changed'; end if;
  if public.wealth_council_command('followup',u,r,q)<>d then raise exception 'Followup not idempotent'; end if;
  begin perform public.wealth_council_command('followup',u,r,q-'workflow'); raise exception 'Removed workflow accepted on followup retry'; exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  begin perform public.wealth_council_command('followup',u,r,jsonb_set(q,'{workflow,stages,1,title}','"Changed title"')); raise exception 'Changed workflow accepted'; exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  perform public.wealth_council_command('cancel',u,r);
  begin perform public.wealth_council_command('followup',u,r,jsonb_set(jsonb_set(q,'{turnId}',to_jsonb(gen_random_uuid())),'{baseRound}','0')); raise exception 'Stale round accepted'; exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  begin perform public.wealth_council_command('followup',u,r,jsonb_set(q,'{mode}','"direct"')); raise exception 'Direct custom workflow accepted'; exception when others then if sqlerrm not like '%council_invalid%' then raise; end if; end;
  begin perform public.wealth_council_workflow_plan(jsonb_set(w,'{stages,1,participants}','["glm-flagship"]'),p->'participants',null); raise exception 'Unknown participant accepted'; exception when others then if sqlerrm not like '%council_invalid%' then raise; end if; end;
  begin perform public.wealth_council_workflow_plan(jsonb_set(w,'{stages,1,id}','"start"'),p->'participants',null); raise exception 'Duplicate phase ID accepted'; exception when others then if sqlerrm not like '%council_invalid%' then raise; end if; end;
  begin perform public.wealth_council_workflow_plan(jsonb_set(w,'{stages,0,participants}','["openai-light"]'),p->'participants',null); raise exception 'Incomplete opening accepted'; exception when others then if sqlerrm not like '%council_invalid%' then raise; end if; end;
  begin perform public.wealth_council_workflow_plan(jsonb_set(w,'{stages,1,type}','"judge"'),p->'participants',null); raise exception 'Injected judge accepted'; exception when others then if sqlerrm not like '%council_invalid%' then raise; end if; end;
  -- Minimal two-boundary flow is four calls, not the legacy minimum of six.
  additions:=jsonb_build_object('version',1,'stages',jsonb_build_array(w->'stages'->0,w->'stages'->4));
  if jsonb_array_length(public.wealth_council_workflow_plan(additions,p->'participants',null))<>4 then raise exception 'Minimal flow rejected'; end if;
  if has_function_privilege('authenticated','public.wealth_council_command(text,uuid,uuid,jsonb)','execute') or has_function_privilege('service_role','public.wealth_council_legacy_command_v12(text,uuid,uuid,jsonb)','execute') or has_function_privilege('authenticated','public.wealth_council_workflow_plan(jsonb,jsonb,text,integer,integer)','execute') then raise exception 'Internal functions exposed'; end if;
  if public.wealth_council_workflow_version()<>1 then raise exception 'Capability version missing'; end if;
end $$;
rollback;
