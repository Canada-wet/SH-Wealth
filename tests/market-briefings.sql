-- Transactional integration check; never touches household tables or persists a fixture.
begin;
do $$ declare target date := '2099-12-30'; token uuid := gen_random_uuid(); replacement uuid := gen_random_uuid();
begin
  if exists(select 1 from public.market_daily_briefings where day=target) then raise exception 'Fixture date is occupied; refusing to modify'; end if;
  if not public.claim_market_briefing(target,token) then raise exception 'Initial claim failed'; end if;
  if public.claim_market_briefing(target,replacement) then raise exception 'Duplicate claim was allowed'; end if;
  update public.market_daily_briefings set started_at=now()-interval '6 minutes' where day=target;
  if not public.claim_market_briefing(target,replacement) then raise exception 'Expired lease was not reclaimed'; end if;
  update public.market_daily_briefings set status='ready',report='{"fixture":true}'::jsonb where day=target and claim_token=token;
  if exists(select 1 from public.market_daily_briefings where day=target and status='ready') then raise exception 'Stale fencing token overwrote new claim'; end if;
  update public.market_daily_briefings set status='ready',report='{"fixture":true}'::jsonb where day=target and claim_token=replacement;
  if public.claim_market_briefing(target,token) then raise exception 'Ready brief was regenerated'; end if;
  if has_table_privilege('anon','public.market_daily_briefings','SELECT') or has_table_privilege('authenticated','public.market_daily_briefings','UPDATE') or has_function_privilege('authenticated','public.claim_market_briefing(date,uuid)','EXECUTE') then raise exception 'Unsafe client grants'; end if;
end; $$;
set local role authenticated;
do $$ begin if exists(select 1 from public.market_daily_briefings) then raise exception 'Unapproved user bypassed RLS'; end if; end; $$;
rollback;
