-- No quota changes or real-history reads/writes. One synthetic row, fully rolled back.
begin;
do $$
declare u uuid; r uuid:=gen_random_uuid(); d jsonb; p jsonb; x jsonb;
begin
  select id into u from auth.users where email='henrywhy233@gmail.com';
  if u is null then raise exception 'Test owner unavailable'; end if;
  p:=jsonb_build_object('id',r,'question','SYNTHETIC ATTACHMENT TEST ONLY',
    'participants',jsonb_build_array('openai-light','anthropic-opus'),'judge',null,
    'models',jsonb_build_array(jsonb_build_object('key','anthropic-opus','model','claude-opus-5-5')),
    'attachments',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','synthetic.txt','kind','text','mime','text/plain','content','SYNTHETIC SOURCE ONLY','note','Temporary test')),
    'status','complete','created_at',now(),'steps','[]'::jsonb);
  insert into public.wealth_council_runs(id,user_id,question,status,document) values(r,u,p->>'question','complete',p);
  d:=public.wealth_council_command('create',u,r,p);
  if d<>p then raise exception 'attachment persistence/idempotency failed'; end if;
  begin
    perform public.wealth_council_command('create',u,r,jsonb_set(p,'{attachments,0,content}','"CHANGED"'));
    raise exception 'changed attachment accepted';
  exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  begin
    perform public.wealth_council_command('create',u,r,jsonb_set(p,'{models,0,model}','"CHANGED"'));
    raise exception 'changed model accepted';
  exception when others then if sqlerrm not like '%council_conflict%' then raise; end if; end;
  perform set_config('council.attachment_test_id',r::text,true);
  perform set_config('council.attachment_test_owner',u::text,true);
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('council.attachment_test_owner'),'role','authenticated')::text,true) is not null as configured;
set local role authenticated;
do $$ begin
  if (select document->'attachments'->0->>'content' from public.wealth_council_runs where id=current_setting('council.attachment_test_id')::uuid) is distinct from 'SYNTHETIC SOURCE ONLY' then raise exception 'owner cannot read source'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='sallyxie0378@gmail.com'),'role','authenticated')::text,true) is not null as configured;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.wealth_council_runs where id=current_setting('council.attachment_test_id')::uuid) then raise exception 'partner can read private source'; end if;
end $$;
reset role;
do $$ begin
  perform public.wealth_council_command('delete',current_setting('council.attachment_test_owner')::uuid,current_setting('council.attachment_test_id')::uuid);
  if exists(select 1 from public.wealth_council_runs where id=current_setting('council.attachment_test_id')::uuid) then raise exception 'attachment not deleted with run'; end if;
end $$;
rollback;
