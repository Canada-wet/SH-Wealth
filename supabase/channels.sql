-- Private, opt-in notification channels. Run after access.sql.
begin;
create table if not exists public.wealth_notification_channels (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check(channel in ('email','telegram','whatsapp')),
  destination_cipher text not null,
  destination_hash text not null,
  destination_label text not null,
  enabled boolean not null default true,
  advisor_enabled boolean not null default false,
  verified_at timestamptz not null default now(),
  last_test_at timestamptz,
  last_delivery_at timestamptz,
  last_status text check(last_status in ('accepted','failed','uncertain')),
  unique(household_id,user_id,channel)
);
create unique index if not exists wealth_channel_active_destination on public.wealth_notification_channels(channel,destination_hash) where enabled;
alter table public.wealth_notification_channels enable row level security;
drop policy if exists "own approved channels" on public.wealth_notification_channels;
create policy "own approved channels" on public.wealth_notification_channels for select to authenticated
  using(user_id=auth.uid() and public.is_allowed_wealth_user() and public.is_wealth_member(household_id));
-- No client write policies: only server-verified callbacks can bind recipients.
create table if not exists public.wealth_channel_links (
  token_hash text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check(channel in ('telegram','whatsapp')),
  expires_at timestamptz not null,
  used_at timestamptz,
  advisor_enabled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.wealth_channel_links enable row level security;
create table if not exists public.wealth_channel_events(channel text not null, event_id text not null, created_at timestamptz not null default now(), primary key(channel,event_id));
alter table public.wealth_channel_events enable row level security;
create table if not exists public.wealth_channel_requests(user_id uuid references auth.users(id) on delete cascade, requested_at timestamptz not null default now());
create index if not exists wealth_channel_request_window on public.wealth_channel_requests(user_id,requested_at);
alter table public.wealth_channel_requests enable row level security;
create table if not exists public.wealth_channel_deliveries (
  channel_id uuid references public.wealth_notification_channels(id) on delete cascade,
  alert_id uuid references public.advisor_alerts(id) on delete cascade,
  status text not null check(status in ('sending','accepted','failed','uncertain')),
  attempts integer not null default 1,
  attempted_at timestamptz not null default now(),
  primary key(channel_id,alert_id)
);
alter table public.wealth_channel_deliveries enable row level security;

create or replace function public.wealth_channel_owner_allowed(owner_id uuid,home_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join public.household_members m on m.user_id=u.id
    where u.id=owner_id and m.household_id=home_id and u.email_confirmed_at is not null
      and lower(u.email) in ('henrywhy233@gmail.com','sallyxie0378@gmail.com'));
$$;
create or replace function public.take_wealth_channel_slot() returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_allowed_wealth_user() then raise exception 'Unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended('channels-'||auth.uid()::text,0));
  delete from public.wealth_channel_requests where user_id=auth.uid() and requested_at < now()-interval '1 day';
  if (select count(*) from public.wealth_channel_requests where user_id=auth.uid() and requested_at>now()-interval '1 minute') >= 3
     or (select count(*) from public.wealth_channel_requests where user_id=auth.uid() and requested_at>now()-interval '1 hour') >= 10 then return false; end if;
  insert into public.wealth_channel_requests(user_id) values(auth.uid());
  return true;
end; $$;
create or replace function public.consume_wealth_channel_link(link_hash text,link_channel text,recipient_cipher text,recipient_hash text,recipient_label text,event_id text) returns uuid
language plpgsql security definer set search_path=public as $$
declare pending public.wealth_channel_links; result uuid; claimed text;
begin
  select * into pending from public.wealth_channel_links where token_hash=link_hash and channel=link_channel and used_at is null and expires_at>now() for update;
  if pending.token_hash is null or not public.wealth_channel_owner_allowed(pending.user_id,pending.household_id) then return null; end if;
  insert into public.wealth_channel_events(channel,event_id) values(link_channel,event_id) on conflict do nothing returning wealth_channel_events.event_id into claimed;
  if claimed is null then return null; end if;
  insert into public.wealth_notification_channels(household_id,user_id,channel,destination_cipher,destination_hash,destination_label,advisor_enabled)
    values(pending.household_id,pending.user_id,link_channel,recipient_cipher,recipient_hash,recipient_label,pending.advisor_enabled)
    on conflict(household_id,user_id,channel) do update set destination_cipher=excluded.destination_cipher,destination_hash=excluded.destination_hash,destination_label=excluded.destination_label,advisor_enabled=excluded.advisor_enabled,enabled=true,verified_at=now(),last_status=null
    returning id into result;
  update public.wealth_channel_links set used_at=now() where token_hash=link_hash;
  return result;
end; $$;
create or replace function public.append_wealth_channel_message(target_channel uuid,message_id text,message_role text,message_text text,source_event_id text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare connection public.wealth_notification_channels; current_doc jsonb; next_doc jsonb; archive jsonb; conversation jsonb; messages jsonb; thread_id text; old_revision bigint; claimed text;
begin
  select * into connection from public.wealth_notification_channels where id=target_channel;
  if connection.id is null or not connection.enabled or not connection.advisor_enabled or not public.wealth_channel_owner_allowed(connection.user_id,connection.household_id) then raise exception 'Unauthorized'; end if;
  if message_role not in ('user','assistant') or length(message_text) not between 1 and 12000 or length(message_id)>150 then raise exception 'Invalid message'; end if;
  if source_event_id is not null then
    insert into public.wealth_channel_events(channel,event_id) values(connection.channel,source_event_id) on conflict do nothing returning event_id into claimed;
    if claimed is null then return null; end if;
  end if;
  select document,revision into current_doc,old_revision from public.household_documents where household_id=connection.household_id for update;
  if current_doc is null or current_doc->>'version'<>'3' then raise exception 'Missing document'; end if;
  thread_id := 'channel-'||connection.id::text;
  select item into conversation from jsonb_array_elements(coalesce(current_doc->'chatArchives','[]'::jsonb)) item where item->>'id'=thread_id;
  if current_doc->'chatCurrent'->>'id'=thread_id then messages:=current_doc->'messages';
  else messages:=coalesce(conversation->'messages','[]'::jsonb); end if;
  if exists(select 1 from jsonb_array_elements(messages) item where item->>'id'=message_id) then return current_doc; end if;
  messages:=messages||jsonb_build_array(jsonb_build_object('id',message_id,'role',message_role,'text',message_text,'createdAt',now()));
  if current_doc->'chatCurrent'->>'id'=thread_id then next_doc:=jsonb_set(current_doc,'{messages}',messages);
  else
    conversation:=coalesce(conversation,jsonb_build_object('id',thread_id,'title',initcap(connection.channel)||' · 渠道对话','createdAt',now()))||jsonb_build_object('messages',messages,'updatedAt',now());
    select coalesce(jsonb_agg(item),'[]'::jsonb) into archive from jsonb_array_elements(coalesce(current_doc->'chatArchives','[]'::jsonb)) item where item->>'id'<>thread_id;
    next_doc:=jsonb_set(current_doc,'{chatArchives}',archive||jsonb_build_array(conversation));
  end if;
  next_doc:=next_doc||jsonb_build_object('revision',coalesce((current_doc->>'revision')::bigint,0)+1,'updatedAt',now());
  update public.household_documents set document=next_doc,revision=old_revision+1,updated_at=now() where household_id=connection.household_id;
  insert into public.household_document_history(household_id,revision,document) values(connection.household_id,old_revision+1,next_doc);
  return next_doc;
end; $$;
create or replace function public.take_wealth_channel_advisor_slot(target_user uuid,target_home uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if not public.wealth_channel_owner_allowed(target_user,target_home) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_user::text,0));
  delete from public.wealth_advisor_requests where user_id=target_user and requested_at<now()-interval '1 day';
  if (select count(*) from public.wealth_advisor_requests where user_id=target_user and requested_at>now()-interval '1 minute')>=6
     or (select count(*) from public.wealth_advisor_requests where user_id=target_user and requested_at>now()-interval '1 hour')>=40 then return false; end if;
  insert into public.wealth_advisor_requests(user_id) values(target_user);
  return true;
end; $$;
revoke all on function public.append_wealth_channel_message(uuid,text,text,text,text),public.take_wealth_channel_advisor_slot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.append_wealth_channel_message(uuid,text,text,text,text),public.take_wealth_channel_advisor_slot(uuid,uuid) to service_role;
create or replace function public.stop_wealth_channel(target_channel text,recipient_hash text,source_event_id text) returns boolean
language plpgsql security definer set search_path=public as $$
declare claimed text;
begin
  insert into public.wealth_channel_events(channel,event_id) values(target_channel,source_event_id) on conflict do nothing returning event_id into claimed;
  if claimed is null then return false; end if;
  update public.wealth_notification_channels set enabled=false where channel=target_channel and destination_hash=recipient_hash;
  return true;
end; $$;
create or replace function public.claim_wealth_channel_delivery(target_channel uuid,target_alert uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare connection public.wealth_notification_channels; delivery public.wealth_channel_deliveries; claimed uuid;
begin
  select * into connection from public.wealth_notification_channels where id=target_channel for update;
  if connection.id is null or not connection.enabled or not public.wealth_channel_owner_allowed(connection.user_id,connection.household_id)
     or not exists(select 1 from public.advisor_alerts where id=target_alert and household_id=connection.household_id) then return false; end if;
  insert into public.wealth_channel_deliveries(channel_id,alert_id,status) values(target_channel,target_alert,'sending') on conflict do nothing returning channel_id into claimed;
  if claimed is not null then return true; end if;
  select * into delivery from public.wealth_channel_deliveries where channel_id=target_channel and alert_id=target_alert for update;
  -- Explicit provider rejection can retry; ambiguous acceptance never retries automatically.
  if delivery.status='failed' and delivery.attempts<3 and delivery.attempted_at < now()-interval '10 minutes' then
    update public.wealth_channel_deliveries set status='sending',attempts=attempts+1,attempted_at=now() where channel_id=target_channel and alert_id=target_alert;
    return true;
  end if;
  return false;
end; $$;
revoke all on function public.wealth_channel_owner_allowed(uuid,uuid),public.consume_wealth_channel_link(text,text,text,text,text,text),public.stop_wealth_channel(text,text,text),public.claim_wealth_channel_delivery(uuid,uuid),public.take_wealth_channel_slot() from public,anon,authenticated;
grant execute on function public.take_wealth_channel_slot() to authenticated;
grant execute on function public.wealth_channel_owner_allowed(uuid,uuid),public.consume_wealth_channel_link(text,text,text,text,text,text),public.stop_wealth_channel(text,text,text),public.claim_wealth_channel_delivery(uuid,uuid) to service_role;
commit;
