-- 20261121000002_push_devices_session.sql
-- A push device belongs to the Supabase session that registered it. When that
-- session ends on the server (sign-out, password reset, revoked or expired
-- refresh token, MCP/OAuth revocation), the device stops receiving pushes.
--
-- Why: the app unregisters its token before signing out (unregister_push_device
-- needs the session), but that call can fail or time out, and sessions also end
-- without the app's logout button. Without this, the phone kept receiving the
-- previous user's notifications until someone logged in on it again.
--
-- How: register_push_device stores the JWT's session_id; a trigger on
-- auth.sessions disables that session's devices when its row is deleted. The
-- claim (claim_notification_pushes) and notification-push-cron already skip
-- disabled devices, so neither changes. A NULL session_id (a device registered
-- before this migration, or a token without the claim) keeps today's behaviour.
--
-- Not covered: a logout made fully offline never reaches the server, so the
-- server session (and its device) stay valid until the next login on that phone
-- moves the token (syncNativePush), or until the session itself expires.
--
-- Safe before any app code: additive column, same RPC signature.

alter table public.push_devices add column if not exists session_id uuid;

create index if not exists idx_push_devices_session_active
  on public.push_devices (session_id) where disabled_at is null;

create or replace function public.register_push_device(
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
  v_user    uuid := auth.uid();
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
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

  insert into push_devices (user_id, token, platform, environment, app_version, session_id)
  values (v_user, p_token, p_platform, p_environment, left(p_app_version, 32), v_session)
  on conflict (token) do update
     set user_id      = excluded.user_id,
         platform     = excluded.platform,
         environment  = excluded.environment,
         app_version  = excluded.app_version,
         session_id   = excluded.session_id,
         last_seen_at = now(),
         disabled_at  = null;
end;
$$;

-- REVOKE FROM PUBLIC also drops service_role on this instance; name every role.
revoke all on function public.register_push_device(text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_push_device(text, text, text, text) to authenticated, service_role;

create or replace function public.push_devices_session_ended()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.push_devices
     set disabled_at = now()
   where session_id = old.id
     and disabled_at is null;
  return old;
end;
$$;

revoke all on function public.push_devices_session_ended() from public, anon, authenticated;

drop trigger if exists trg_push_devices_session_ended on auth.sessions;
create trigger trg_push_devices_session_ended
  after delete on auth.sessions
  for each row execute function public.push_devices_session_ended();
