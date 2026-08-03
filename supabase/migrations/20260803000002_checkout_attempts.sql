-- One row per Stripe Checkout session actually created.
--
-- workspace_subscriptions.created_at cannot serve this purpose: it is set once
-- at first customer creation, billing-checkout writes the customer row BEFORE
-- stripe.checkout.sessions.create can fail, and the on-conflict upsert never
-- refreshes the timestamp. Using it would email people who never reached a
-- checkout page and could never detect a second abandonment.
create table if not exists checkout_attempts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  stripe_session_id text not null unique,
  plan_id           text null references plans(id),
  created_at        timestamptz not null default now()
);

create index if not exists checkout_attempts_workspace_created
  on checkout_attempts (workspace_id, created_at desc);

alter table checkout_attempts enable row level security;

create policy "checkout_attempts_service_role" on checkout_attempts
  for all to service_role using (true) with check (true);
