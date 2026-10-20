-- Isolated synthetic PostgreSQL only. Never execute this fixture on production.
-- Auth predicate override and every inserted record are rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at,aud,role) values
('b1000000-0000-4000-8000-000000000001','library-a@example.invalid',now(),'authenticated','authenticated'),
('b1000000-0000-4000-8000-000000000002','library-b@example.invalid',now(),'authenticated','authenticated');
create or replace function public.is_allowed_wealth_user() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null; $$;
insert into public.wealth_council_runs(id,user_id,question,status,document) values
('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Synthetic question for research','complete',
'{"models":[{"name":"Fixture A"},{"name":"Fixture B"}],"turns":[{"question":"追问问题：市场模型"}],"attachments":[{"text":"附件独有秘密，不参与检索"}],"steps":[{"seq":0,"stage":"revision","status":"succeeded","answer":"初始观点不是最新结论","finished_at":"2026-10-19T15:00:00Z"},{"seq":1,"round":1,"stage":"revision","status":"succeeded","answer":"先核实反例，再检验假设","finished_at":"2026-10-19T16:00:00Z"},{"seq":2,"round":1,"stage":"judge","status":"succeeded","answer":"中断裁判不是完整结论","usage":{"interrupted":true}}]}'),
('b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','Private partner question','complete','{"models":[],"steps":[]}'),
('b3000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001','Synthetic ongoing research','active','{"models":[],"steps":[]}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',true) is not null as synthetic_owner;
do $$ declare rows jsonb; item jsonb; memo jsonb; invalid jsonb; begin
  rows:=public.read_wealth_council_library('反例 假设');
  if jsonb_array_length(rows)<>2 or not exists(select 1 from jsonb_array_elements(rows) x where x->>'matched'='true' and x->>'matchRound'='1' and x->>'matchSeq'='1' and x->>'excerpt'='先核实反例，再检验假设') then raise exception 'Full answer search or latest final failed'; end if;
  if rows::text like '%附件独有秘密%' or rows::text like '%Private partner%' then raise exception 'Unrequested content leaked'; end if;
  if exists(select 1 from jsonb_array_elements(public.read_wealth_council_library('附件独有秘密')) x where x->>'matched'='true') then raise exception 'Attachment was searched'; end if;
  if not exists(select 1 from jsonb_array_elements(public.read_wealth_council_library('追问问题')) x where x->>'matched'='true') then raise exception 'Followup question missing from search'; end if;
  if exists(select 1 from jsonb_array_elements(public.read_wealth_council_library('%')) x where x->>'matched'='true') then raise exception 'SQL wildcard was expanded'; end if;
  memo:='{"title":"我的判断","tags":["职业","验证"],"pinned":true,"archived":true,"note":"先做访谈","reviewOn":"2026-10-20"}';
  item:=public.save_wealth_council_memo('b3000000-0000-4000-8000-000000000001',0,memo);
  if item->>'version'<>'1' or item->>'archived'<>'true' then raise exception 'Memo was not saved'; end if;
  if not exists(select 1 from jsonb_array_elements(public.read_wealth_council_library('访谈 职业')) x where x->>'matched'='true' and x->'memo'->>'title'='我的判断') then raise exception 'Memo/tag search failed'; end if;
  begin perform public.save_wealth_council_memo('b3000000-0000-4000-8000-000000000001',0,memo);raise exception 'Stale overwrite succeeded'; exception when raise_exception then if SQLERRM<>'library_conflict' then raise; end if; end;
  item:=public.save_wealth_council_memo('b3000000-0000-4000-8000-000000000001',1,memo||'{"archived":false}');
  if item->>'version'<>'2' or item->>'archived'<>'false' then raise exception 'Restore failed'; end if;
  begin perform public.save_wealth_council_memo('b3000000-0000-4000-8000-000000000002',0,memo);raise exception 'Partner modified'; exception when raise_exception then if SQLERRM<>'library_not_found' then raise; end if; end;
  begin perform public.save_wealth_council_memo('b3000000-0000-4000-8000-000000000003',0,memo);raise exception 'Running archived'; exception when raise_exception then if SQLERRM<>'library_active' then raise; end if; end;
  begin update public.wealth_council_library set pinned=false; raise exception 'Direct write allowed'; exception when insufficient_privilege then null; end;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    memo||'{"tags":["A","a"]}',memo||'{"reviewOn":"2026-02-30"}',memo||'{"reviewOn":"2101-01-01"}',memo||'{"pinned":"true"}',
    memo||'{"tags":[null]}',memo||'{"user_id":"partner"}',memo||jsonb_build_object('title',repeat('x',121)),memo||jsonb_build_object('note','bad'||chr(1))
  )) loop
    begin perform public.save_wealth_council_memo('b3000000-0000-4000-8000-000000000001',2,invalid);raise exception 'Invalid payload saved';exception when raise_exception then if SQLERRM<>'library_invalid' then raise; end if;end;
  end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',true) is not null as synthetic_partner;
do $$ begin
  if (select count(*) from public.wealth_council_library)<>0 or jsonb_array_length(public.read_wealth_council_library(''))<>1 then raise exception 'Private library RLS failed'; end if;
end $$;
reset role;
-- The original transcript is untouched; deleting it cascades only its organization.
do $$ begin if (select document->'steps'->1->>'answer' from public.wealth_council_runs where id='b3000000-0000-4000-8000-000000000001')<>'先核实反例，再检验假设' then raise exception 'Transcript changed'; end if; end $$;
delete from public.wealth_council_runs where id='b3000000-0000-4000-8000-000000000001';
do $$ begin if exists(select 1 from public.wealth_council_library where run_id='b3000000-0000-4000-8000-000000000001') then raise exception 'Orphan memo'; end if; end $$;
set local role anon;
do $$ begin begin perform public.read_wealth_council_library('');raise exception 'Anonymous read allowed'; exception when insufficient_privilege then null;end;end $$;
reset role;
set local role service_role;
do $$ begin begin perform public.save_wealth_council_memo(null,0,'{}');raise exception 'Service role mutation allowed'; exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
