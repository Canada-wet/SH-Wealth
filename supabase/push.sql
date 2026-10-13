create table if not exists public.wealth_push_subscriptions (household_id uuid not null references public.households(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,endpoint text not null,subscription jsonb not null,created_at timestamptz not null default now(),primary key(user_id,endpoint));
alter table public.wealth_push_subscriptions enable row level security;
drop policy if exists "members manage own push subscriptions" on public.wealth_push_subscriptions;
create policy "members manage own push subscriptions" on public.wealth_push_subscriptions for all to authenticated using(user_id=auth.uid() and public.is_wealth_member(household_id)) with check(user_id=auth.uid() and public.is_wealth_member(household_id));
alter table public.wealth_push_subscriptions add column if not exists last_alert_id uuid;
