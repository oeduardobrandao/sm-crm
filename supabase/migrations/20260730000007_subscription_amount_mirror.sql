-- Persist what the customer actually pays (net of coupons) in the Stripe mirror,
-- so admin pages read local columns instead of calling Stripe live on every load.
-- Written by stripe-webhook on every subscription event; platform-admin backfills
-- lazily (live fetch + write-back) for rows created before this migration.
-- All nullable: NULL amount_cents = "not priced yet", callers fall back to the
-- plan's catalog price or a live fetch.
ALTER TABLE workspace_subscriptions
  ADD COLUMN IF NOT EXISTS amount_cents        int,
  ADD COLUMN IF NOT EXISTS gross_cents         int,
  ADD COLUMN IF NOT EXISTS currency            text,
  ADD COLUMN IF NOT EXISTS amount_interval     text,
  ADD COLUMN IF NOT EXISTS discount_label      text,
  ADD COLUMN IF NOT EXISTS amount_refreshed_at timestamptz;

COMMENT ON COLUMN workspace_subscriptions.amount_cents IS
  'Net amount the customer pays per billing interval, from live Stripe (coupon applied). NULL = not priced yet.';
COMMENT ON COLUMN workspace_subscriptions.amount_interval IS
  'Recurring interval of the Stripe price object; may differ from billing_interval (plan resolution).';
