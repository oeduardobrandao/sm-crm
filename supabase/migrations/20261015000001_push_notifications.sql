-- 20261015000001_push_notifications.sql
-- Push notifications for the iOS app (apps/mobile, plan step B2). Push is a second
-- delivery channel on the existing `notifications` rows, sent by
-- notification-push-cron every minute. Mirrors the email digest design
-- (20260813000004 prefs, 20260813000005 claim).
--
--   (1) push_devices: one row per installed app (APNs/FCM token). Written only
--       through register_push_device / unregister_push_device.
--   (2) notification_push_prefs: per-user, per-type opt-out, a THIRD table on
--       purpose (same reason as notification_inapp_prefs in 20260903000001: old
--       CRM bundles read and upsert the email prefs by (user_id, type) with no
--       channel column, so channels must not share a table).
--   (3) notifications.pushed_at + claim_notification_pushes(): atomic claim, the
--       send/no-send decision made in the same statement that stamps the row.
--   (4) push_badge_counts(): unread count per user for the APNs badge.
--
-- Push-eligible types: what a client or teammate did that needs this user's
-- attention. Same set as the email digest plus event_reminder (the best push
-- use case), post_edit_suggestion, post_client_reference, idea_submitted and
-- briefing_answered. Left out on purpose: workflow step churn, membership and
-- role changes, automation and storage reports.
--
-- Safe to apply before the function is deployed: nothing reads these objects
-- until notification-push-cron is scheduled (20261015000002).

-- ============ (1) push_devices ============
create table if not exists push_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android')),
  environment  text not null check (environment in ('sandbox', 'production')),
  app_version  text check (app_version is null or length(app_version) <= 32),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at  timestamptz,
  constraint push_devices_token_length check (length(token) between 1 and 512)
);

create index if not exists idx_push_devices_user_active
  on push_devices (user_id) where disabled_at is null;

alter table push_devices enable row level security;

-- Users may see that their own devices exist (the CRM shows the "No celular"
-- prefs column only when there is one) but never read tokens, and never write:
-- the RPCs below are the only writers besides the service role.
drop policy if exists push_devices_select on push_devices;
create policy push_devices_select on push_devices
  for select using (user_id = auth.uid());

revoke all on push_devices from public, anon, authenticated;
grant select (id, platform, environment, app_version, created_at, last_seen_at, disabled_at)
  on push_devices to authenticated;
grant all on push_devices to service_role;

-- Upsert keyed by token: a phone that changes hands (logout, another user logs in)
-- moves to the new user. Tokens are 256-bit device secrets, so claiming one you
-- did not receive from APNs is not a practical attack; the worst case is sending
-- your own notifications to someone else's phone until they next open the app,
-- which re-registers it.
create or replace function register_push_device(
  p_token       text,
  p_platform    text,
  p_environment text,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) not between 1 and 512 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'invalid environment' using errcode = '22023';
  end if;

  insert into push_devices (user_id, token, platform, environment, app_version)
  values (v_user, p_token, p_platform, p_environment, left(p_app_version, 32))
  on conflict (token) do update
     set user_id      = excluded.user_id,
         platform     = excluded.platform,
         environment  = excluded.environment,
         app_version  = excluded.app_version,
         last_seen_at = now(),
         disabled_at  = null;
end;
$$;

-- Called on logout. Only the caller's own row; a token that moved to another
-- user in the meantime is left alone.
create or replace function unregister_push_device(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from push_devices where token = p_token and user_id = auth.uid();
$$;

-- REVOKE FROM PUBLIC also drops service_role on this instance; name every role.
revoke all on function register_push_device(text, text, text, text) from public, anon, authenticated;
revoke all on function unregister_push_device(text) from public, anon, authenticated;
grant execute on function register_push_device(text, text, text, text) to authenticated, service_role;
grant execute on function unregister_push_device(text) to authenticated, service_role;

-- ============ (2) notification_push_prefs ============
-- Stores only overrides: NO row = default ON; enabled=false opts out of that
-- type; type='__all__' with enabled=false pauses every push.
create table if not exists notification_push_prefs (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  type       text    not null,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type),
  constraint notification_push_prefs_type_check check (type in (
    'post_approved','post_publish_failed','post_correction','post_message',
    'client_message','deadline_approaching','task_assigned','post_assigned',
    'mention','post_edit_suggestion','post_client_reference',
    'idea_submitted','briefing_answered',
    'event_invited','event_updated','event_cancelled','event_reminder',
    'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
    '__all__'
  ))
);

alter table notification_push_prefs enable row level security;

drop policy if exists npp_select on notification_push_prefs;
create policy npp_select on notification_push_prefs
  for select using (user_id = auth.uid());
drop policy if exists npp_insert on notification_push_prefs;
create policy npp_insert on notification_push_prefs
  for insert with check (user_id = auth.uid());
drop policy if exists npp_update on notification_push_prefs;
create policy npp_update on notification_push_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists npp_delete on notification_push_prefs;
create policy npp_delete on notification_push_prefs
  for delete using (user_id = auth.uid());

-- Same rationale as the two sibling tables: RLS is the gate and there is no
-- privilege-escalation column, so a full grant to authenticated is correct.
grant select, insert, update, delete on notification_push_prefs to authenticated;
grant all on notification_push_prefs to service_role;

-- ============ (3) pushed_at + claim ============
alter table notifications add column if not exists pushed_at timestamptz;

create index if not exists idx_notifications_push_pending
  on notifications (created_at)
  where read_at is null and dismissed_at is null and pushed_at is null;

-- One statement decides and stamps, like claim_notification_emails:
--   * membership EXISTS: a user removed from a workspace keeps their rows.
--   * pref NOT EXISTS: opt-out is checked atomically with the claim.
--   * active device EXISTS: rows for users without the app are never stamped,
--     so installing the app later doesn't replay old notifications (p_after
--     bounds that anyway).
--   * p_after: the cron passes now() - 15 minutes, so an outage never produces a
--     burst of stale pushes.
--   * FOR UPDATE SKIP LOCKED keeps overlapping cron runs disjoint.
create or replace function claim_notification_pushes(
  p_after timestamptz,
  p_limit int
)
returns table (id uuid, user_id uuid, workspace_id uuid, type text, metadata jsonb, link text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update notifications n
     set pushed_at = now()
   where n.id in (
     select n2.id from notifications n2
     where n2.type = any (array[
       'post_approved','post_publish_failed','post_correction','post_message',
       'client_message','deadline_approaching','task_assigned','post_assigned',
       'mention','post_edit_suggestion','post_client_reference',
       'idea_submitted','briefing_answered',
       'event_invited','event_updated','event_cancelled','event_reminder',
       'event_client_rsvp','event_reschedule_requested','event_guest_rsvp'
     ])
       and n2.read_at is null and n2.dismissed_at is null and n2.pushed_at is null
       and n2.created_at >= p_after
       and exists (
         select 1 from workspace_members wm
         where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
       )
       and not exists (
         select 1 from notification_push_prefs p
         where p.user_id = n2.user_id and p.enabled = false
           and (p.type = n2.type or p.type = '__all__')
       )
       and exists (
         select 1 from push_devices d
         where d.user_id = n2.user_id and d.disabled_at is null
       )
     order by n2.created_at asc
     limit p_limit
     for update skip locked
   )
  returning n.id, n.user_id, n.workspace_id, n.type, n.metadata, n.link, n.created_at;
$$;

revoke all on function claim_notification_pushes(timestamptz, int) from public, anon, authenticated;
grant execute on function claim_notification_pushes(timestamptz, int) to service_role;

-- ============ (4) badge counts ============
-- What the CRM bell counts (store/notifications.ts getUnreadNotificationCount):
-- unread, not dismissed, in a workspace the user still belongs to, minus types
-- the user hid from the in-app center.
create or replace function push_badge_counts(p_user_ids uuid[])
returns table (user_id uuid, unread int)
language sql
stable
security definer
set search_path = public
as $$
  select n.user_id, count(*)::int
    from notifications n
   where n.user_id = any (p_user_ids)
     and n.read_at is null and n.dismissed_at is null
     and exists (
       select 1 from workspace_members wm
       where wm.workspace_id = n.workspace_id and wm.user_id = n.user_id
     )
     and not exists (
       select 1 from notification_inapp_prefs p
       where p.user_id = n.user_id and p.enabled = false and p.type = n.type
     )
   group by n.user_id;
$$;

revoke all on function push_badge_counts(uuid[]) from public, anon, authenticated;
grant execute on function push_badge_counts(uuid[]) to service_role;
