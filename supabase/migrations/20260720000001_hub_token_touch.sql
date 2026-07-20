-- Sliding-window renewal for Hub links.
--
-- Called once per client visit from hub-bootstrap. Both guards live in the WHERE
-- clause so there is no read-then-write race and no branching in the edge function:
--   expires_at > now()                       -> never resurrect a dead link
--   expires_at < now() + interval '350 days' -> throttle to ~1 write / 15 days
--
-- Context: migration 20260417000002 capped every legacy token with a single UPDATE,
-- so one now() evaluation gave them all the same expiry and they died together on
-- 2026-07-16. A sliding window makes that class of outage structurally impossible.

create or replace function public.hub_token_touch(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update client_hub_tokens
     set expires_at = now() + interval '365 days'
   where token = p_token
     and expires_at > now()
     and expires_at < now() + interval '350 days';
$$;

revoke all on function public.hub_token_touch(uuid) from public, anon, authenticated;
grant execute on function public.hub_token_touch(uuid) to service_role;
