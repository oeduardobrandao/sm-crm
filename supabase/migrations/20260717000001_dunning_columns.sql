-- Dunning episode state on the Stripe mirror.
--
-- past_due_since:       first failure of the current episode. Written coalesced against its own
--                       prior value so a redelivered webhook never restarts the clock. Cleared
--                       when Stripe reports the subscription healthy again.
-- next_payment_attempt: Stripe's next retry, mirrored for display only.
--
-- Both are display/diagnostic state. The authoritative dunning timeline lives in Stripe
-- (Smart Retries + cancel-after-final-failure). The app never decides when access ends: that
-- still happens through customer.subscription.deleted -> statusToPlanId -> default plan.

ALTER TABLE workspace_subscriptions
  ADD COLUMN IF NOT EXISTS past_due_since       timestamptz,
  ADD COLUMN IF NOT EXISTS next_payment_attempt timestamptz;
