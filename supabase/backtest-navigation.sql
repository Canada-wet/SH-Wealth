-- Incremental allowlist expansion only. Preserves existing pins, actions and RLS.
begin;
alter table public.wealth_navigation_preferences drop constraint if exists wealth_navigation_preferences_feature_id_check;
alter table public.wealth_navigation_preferences add constraint wealth_navigation_preferences_feature_id_check
check(feature_id in ('space','action-center','overview','assets','cashflow','growth','contributions','framework','quarterly-review','markets','backtest','watchlist-pulse','market-intelligence','market-wealth','investment-desk','macro-research','rates-research','fx-research','securities','research-archive','council','learn','learning-favorites','lifestyle','library','sets','practice','rekordbox','advisor','history','settings','members','alerts','updates'));
create or replace function public.wealth_action_source_valid(feature text, ref text, scope text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(feature in ('','space','action-center','overview','assets','cashflow','growth','contributions','framework','quarterly-review','markets','backtest','watchlist-pulse','market-intelligence','market-wealth','investment-desk','macro-research','rates-research','fx-research','securities','research-archive','council','learn','learning-favorites','lifestyle','library','sets','practice','rekordbox','advisor','history','settings','members','alerts','updates')
    and scope in ('private','household') and
    (ref='' or (feature<>'' and not(feature='council' and scope='household') and
      case when feature='quarterly-review' then ref ~ '^(20[0-9]{2}|2100)-Q[1-4]$'
        else ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' end)),false);
$$;
revoke all on function public.wealth_action_source_valid(text,text,text) from public,anon,authenticated,service_role;
commit;
