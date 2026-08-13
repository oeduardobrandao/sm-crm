-- Atomic, lock-serialized plan grant for the Pagar.me webhook.
--
-- pagarme-webhook reconciles workspace_subscriptions.status with a compare-and-set, then writes
-- workspaces.plan_id in a SEPARATE statement. Those two writes are not atomic: Pagar.me
-- deliveries are unordered, so an out-of-order event (a concurrent cancellation, or a
-- cross-provider Stripe reclaim of a just-canceled row) can change the subscription row between a
-- delayed in-force handler's CAS and its plan write. The stale handler would then restore a paid
-- plan for a subscription it no longer owns. A canceled subscription receives no further events,
-- so nothing self-heals that wrong grant.
--
-- The guard LOCKS the subscription row (select ... for update) before writing the plan. Under
-- READ COMMITTED an EXISTS in the UPDATE's WHERE reads from the statement snapshot and is NOT
-- guaranteed to observe a concurrent transition (EvalPlanQual re-checks the target workspaces row,
-- not the subquery), so a plain EXISTS would not serialize this. for update does: if a concurrent
-- cancel/reclaim is mid-flight, this blocks until it commits, then re-evaluates the predicate
-- against the latest row version; a changed status, a flipped provider, or a rebound subscription
-- id then excludes the row (FOUND is false) and no plan is written. Comps (plan_source = 'manual')
-- are never overridden. Returns the number of workspaces rows written (0 = a concurrent transition
-- or a manual comp blocked the write: a legitimate no-op, not an error).
create or replace function public.grant_pagarme_plan(
  p_workspace uuid,
  p_plan text,
  p_sub text,
  p_status text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written integer;
begin
  perform 1
    from public.workspace_subscriptions s
   where s.workspace_id = p_workspace
     and s.provider = 'pagarme'
     and s.pagarme_subscription_id = p_sub
     and s.status = p_status
   for update;
  if not found then
    return 0;
  end if;

  update public.workspaces w
     set plan_id = p_plan,
         plan_source = 'pagarme'
   -- only an explicit 'manual' comp is preserved, matching writeWorkspacePlan's old guard.
   -- plan_source is NOT NULL today, so `is distinct from` equals `<> 'manual'` here; the
   -- distinct form is the defensive one (a hypothetical NULL would stay writable).
   where w.id = p_workspace
     and w.plan_source is distinct from 'manual';
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- service_role only (the webhook uses the service key). REVOKE FROM PUBLIC does NOT strip the
-- default EXECUTE grants Supabase hands anon/authenticated on new public functions, so name them
-- explicitly: this function has no in-body caller check, so the grant is its whole boundary.
revoke all on function public.grant_pagarme_plan(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_pagarme_plan(uuid, text, text, text) to service_role;
