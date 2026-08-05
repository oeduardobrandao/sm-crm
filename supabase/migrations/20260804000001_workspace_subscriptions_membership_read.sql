-- workspace_subscriptions read policy: authorize against per-workspace
-- membership, not the profile-level role.
--
-- WHY. 20260609120003 wrote the policy as
--   workspace_id = (select conta_id from profiles where id = auth.uid())
--   and (select role from profiles where id = auth.uid()) = 'owner'
-- The second conjunct is a GLOBAL role. switch_workspace() moves conta_id and
-- active_workspace_id together in one UPDATE but never touches profiles.role,
-- so as soon as a user belongs to more than one workspace the role can describe
-- a workspace they are no longer in. The policy then authorizes against the
-- wrong workspace, and it fails in BOTH directions:
--
--   * profiles.role = 'owner', but the user is only an agent in the active
--     workspace B. The first conjunct matches B, the second still says owner,
--     so the policy PASSES and an agent reads B's billing row (its Stripe
--     customer/subscription ids, status and period end). This is the exposure
--     being closed.
--
--   * profiles.role = 'agent', but the user IS the owner of the active
--     workspace. The policy BLOCKS the read, getWorkspaceSubscription() returns
--     null, and hasEverSubscribed reads false. /comecar then offers the 30-day
--     trial while billing-checkout, on the service-role client that bypasses
--     RLS, sees the real stripe_subscription_id, resolves no trial and charges
--     the card immediately. The existing 409 guard does not catch it: it only
--     fires on 'active'/'trialing', not on 'canceled'.
--
-- The membership check below mirrors what billing-checkout already enforces
-- server side (supabase/functions/billing-checkout/index.ts): it reads
-- workspace_members for the workspace it is about to charge and rejects with
-- 403 when that row is not an owner. RLS, the server and the client gates now
-- all resolve ownership the same way.
--
-- The workspace_id = conta_id conjunct is KEPT on purpose. Dropping it would
-- let an owner of workspace A read A's billing row while active in B. The
-- client only ever queries the active workspace, so retaining it costs nothing
-- and keeps the policy at its tightest.
--
-- The workspace_subscriptions_service_role policy is deliberately untouched;
-- the webhook and the billing functions still need unrestricted access.

drop policy if exists "workspace_subscriptions_owner_read" on workspace_subscriptions;

create policy "workspace_subscriptions_owner_read" on workspace_subscriptions
  for select to authenticated
  using (
    workspace_id = (select conta_id from profiles where id = auth.uid())
    and exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_subscriptions.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );
