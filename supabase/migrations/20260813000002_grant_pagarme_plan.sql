-- Atomic, state-guarded plan grant for the Pagar.me webhook.
--
-- pagarme-webhook reconciles workspace_subscriptions.status with a compare-and-set, then writes
-- workspaces.plan_id in a SEPARATE statement. Those two writes are not atomic: Pagar.me
-- deliveries are unordered, so an out-of-order event (a concurrent cancellation, or a
-- cross-provider Stripe reclaim of a just-canceled row) can change the subscription row between a
-- delayed in-force handler's CAS and its plan write. The stale handler would then restore a paid
-- plan for a subscription it no longer owns. A canceled subscription receives no further events,
-- so nothing self-heals that wrong grant.
--
-- This function folds the guard into a single statement: the plan is written only while the
-- subscription row is STILL owned by the same pagarme subscription in the expected status. If a
-- concurrent transition changed the status, flipped the provider to stripe, or rebound the
-- subscription id, the EXISTS fails and nothing is written. Comps (plan_source = 'manual') are
-- never overridden. Returns the number of workspaces rows written (0 = a concurrent transition
-- took ownership: a legitimate no-op, not an error).
create or replace function public.grant_pagarme_plan(
  p_workspace uuid,
  p_plan text,
  p_sub text,
  p_status text
) returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.workspaces w
       set plan_id = p_plan,
           plan_source = 'pagarme'
     where w.id = p_workspace
       -- is distinct from: a NULL plan_source is still writable; only an explicit 'manual' comp
       -- is preserved.
       and w.plan_source is distinct from 'manual'
       and exists (
         select 1
           from public.workspace_subscriptions s
          where s.workspace_id = p_workspace
            and s.provider = 'pagarme'
            and s.pagarme_subscription_id = p_sub
            and s.status = p_status
       )
    returning 1
  )
  select coalesce(count(*), 0)::int from updated;
$$;

-- service_role only (the webhook uses the service key); never exposed to anon/authenticated.
revoke all on function public.grant_pagarme_plan(uuid, text, text, text) from public;
grant execute on function public.grant_pagarme_plan(uuid, text, text, text) to service_role;
