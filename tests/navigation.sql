-- Synthetic navigation operations only. All writes and pins are rolled back.
begin;
do $$ declare a uuid; b uuid; begin
  select id into a from auth.users where email='henrywhy233@gmail.com';
  select id into b from auth.users where email='sallyxie0378@gmail.com';
  if a is null or b is null then raise exception 'Both approved members are required'; end if;
  perform set_config('test.navigation_one',a::text,true);
  perform set_config('test.navigation_two',b::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.navigation_one'),'role','authenticated')::text,true) is not null as identity_set;
do $$ declare data jsonb; used timestamptz; pin_time timestamptz; begin
  perform public.update_wealth_navigation('fx-research','unpin');
  perform public.update_wealth_navigation('fx-research','pin');
  select pinned_at into pin_time from public.wealth_navigation_preferences where feature_id='fx-research';
  perform public.update_wealth_navigation('fx-research','pin');
  if not exists(select 1 from public.wealth_navigation_preferences where feature_id='fx-research' and pinned_at=pin_time) then raise exception 'Repeated pin changed order'; end if;
  perform public.update_wealth_navigation('fx-research','visit');
  if not exists(select 1 from public.wealth_navigation_preferences where feature_id='fx-research' and pinned and pinned_at=pin_time and last_used_at is not null) then raise exception 'Visit overwrote pin'; end if;
  select last_used_at into used from public.wealth_navigation_preferences where feature_id='fx-research';
  perform public.update_wealth_navigation('fx-research','unpin');
  if not exists(select 1 from public.wealth_navigation_preferences where feature_id='fx-research' and not pinned and pinned_at is null and last_used_at=used) then raise exception 'Unpin overwrote usage'; end if;
  begin
    perform public.update_wealth_navigation('https://evil.test','pin');
    raise exception 'Unknown feature accepted';
  exception when check_violation then null; end;
  begin
    update public.wealth_navigation_preferences set pinned=true;
    raise exception 'Direct mutation accepted';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.wealth_navigation_preferences where user_id<>auth.uid()) then raise exception 'Other member exposed'; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.navigation_two'),'role','authenticated')::text,true) is not null as partner_identity_set;
do $$ begin
  if exists(select 1 from public.wealth_navigation_preferences where user_id<>auth.uid()) then raise exception 'Partner can read first member preferences'; end if;
  perform public.update_wealth_navigation('sets','pin');
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.update_wealth_navigation('markets','pin');
    raise exception 'Anonymous write accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
