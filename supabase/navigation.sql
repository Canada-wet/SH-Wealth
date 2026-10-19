-- Personal, cross-device navigation; never embedded in the shared wealth document.
begin;
create table if not exists public.wealth_navigation_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_id text not null check(feature_id in ('space','overview','assets','cashflow','growth','contributions','framework','quarterly-review','markets','watchlist-pulse','market-intelligence','market-wealth','investment-desk','macro-research','rates-research','fx-research','securities','research-archive','council','learn','learning-favorites','lifestyle','library','sets','practice','rekordbox','advisor','history','settings','members','alerts','updates')),
  pinned boolean not null default false,
  last_used_at timestamptz,
  pinned_at timestamptz,
  primary key(user_id,feature_id)
);
-- Upgrade the existing allowlist in place; keep every member's pins and usage.
alter table public.wealth_navigation_preferences drop constraint if exists wealth_navigation_preferences_feature_id_check;
alter table public.wealth_navigation_preferences add constraint wealth_navigation_preferences_feature_id_check
check(feature_id in ('space','overview','assets','cashflow','growth','contributions','framework','quarterly-review','markets','watchlist-pulse','market-intelligence','market-wealth','investment-desk','macro-research','rates-research','fx-research','securities','research-archive','council','learn','learning-favorites','lifestyle','library','sets','practice','rekordbox','advisor','history','settings','members','alerts','updates'));
alter table public.wealth_navigation_preferences enable row level security;
drop policy if exists "own navigation" on public.wealth_navigation_preferences;
create policy "own navigation" on public.wealth_navigation_preferences for select to authenticated
using(user_id=auth.uid() and public.is_allowed_wealth_user());
revoke all on public.wealth_navigation_preferences from public,anon,authenticated;
grant select on public.wealth_navigation_preferences to authenticated;
grant all on public.wealth_navigation_preferences to service_role;
create or replace function public.update_wealth_navigation(target_feature text, operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_allowed_wealth_user() then raise exception 'Unauthorized'; end if;
  if operation is null or operation not in ('visit','pin','unpin') then raise exception 'Invalid navigation operation'; end if;
  insert into public.wealth_navigation_preferences as p(user_id,feature_id,pinned,last_used_at,pinned_at)
  values(auth.uid(),target_feature,operation='pin',case when operation='visit' then clock_timestamp() end,case when operation='pin' then clock_timestamp() end)
  on conflict(user_id,feature_id) do update set
    pinned=case when operation='visit' then p.pinned else operation='pin' end,
    last_used_at=case when operation='visit' then clock_timestamp() else p.last_used_at end,
    pinned_at=case when operation='pin' then coalesce(case when p.pinned then p.pinned_at end,clock_timestamp()) when operation='unpin' then null else p.pinned_at end;
  select coalesce(jsonb_agg(jsonb_build_object('feature_id',feature_id,'pinned',pinned,'last_used_at',last_used_at,'pinned_at',pinned_at) order by feature_id),'[]'::jsonb)
  into result from public.wealth_navigation_preferences where user_id=auth.uid();
  return result;
end; $$;
revoke all on function public.update_wealth_navigation(text,text) from public,anon;
grant execute on function public.update_wealth_navigation(text,text) to authenticated;
commit;
