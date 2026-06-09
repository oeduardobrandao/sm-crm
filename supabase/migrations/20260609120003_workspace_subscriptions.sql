-- (D) Stripe subscription mirror — one row per workspace.
create table workspace_subscriptions (
  workspace_id           uuid primary key references workspaces(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text,
  plan_id                text references plans(id),
  billing_interval       text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  failed_payment_count   int not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table workspace_subscriptions enable row level security;

create policy "workspace_subscriptions_service_role" on workspace_subscriptions
  for all to service_role using (true) with check (true);

-- Owner of the workspace may read its subscription row (read-only status display).
create policy "workspace_subscriptions_owner_read" on workspace_subscriptions
  for select to authenticated
  using (
    workspace_id = (select conta_id from profiles where id = auth.uid())
    and (select role from profiles where id = auth.uid()) = 'owner'
  );

-- (E) Webhook idempotency ledger — written only after successful handling.
create table stripe_webhook_events (
  event_id     text primary key,
  type         text,
  processed_at timestamptz not null default now()
);

alter table stripe_webhook_events enable row level security;

create policy "stripe_webhook_events_service_role" on stripe_webhook_events
  for all to service_role using (true) with check (true);
