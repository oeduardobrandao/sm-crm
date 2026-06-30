-- Slice 1: EXTRA seats purchased beyond the tier-included base, mirrored from Stripe.
-- The stripe-webhook is the ONLY writer (status-aware: 0 unless active/trialing).
-- effective_plan_limit('max_team_members') adds this term, status-gated.
-- Inherits workspace_subscriptions' existing owner-read + service-role RLS (no new policy).
alter table workspace_subscriptions
  add column if not exists purchased_seats int not null default 0;
