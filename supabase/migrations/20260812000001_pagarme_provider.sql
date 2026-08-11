-- Pagar.me provider foundation: add provider abstraction to billing schema.
-- Additive-only columns default to 'stripe'; no runtime code reads them yet.
-- Behavior unchanged; feature gates deployment.

-- (1) Add provider columns to workspace_subscriptions
alter table workspace_subscriptions
  add column provider text not null default 'stripe'
    constraint workspace_subscriptions_provider_check check (provider in ('stripe','pagarme')),
  add column pagarme_customer_id text,
  add column pagarme_subscription_id text unique,
  add column installments int,
  add column ever_subscribed_at timestamptz;

comment on column workspace_subscriptions.pagarme_customer_id is
  'Pagar.me customer ID. Deliberately NOT unique: same customer (by email) may own multiple workspaces under one account owner.';

-- (2) Backfill ever_subscribed_at from updated_at for existing Stripe subscriptions
update workspace_subscriptions
  set ever_subscribed_at = coalesce(ever_subscribed_at, updated_at)
  where stripe_subscription_id is not null;

-- (3) Recreate workspaces.plan_source CHECK to include 'pagarme'
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'workspaces'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%plan_source%'
  loop
    execute format('alter table workspaces drop constraint %I', c.conname);
  end loop;
end $$;
alter table workspaces add constraint workspaces_plan_source_check
  check (plan_source in ('system','stripe','manual','pagarme'));

-- (4) Add Pagar.me columns to plans
alter table plans
  add column pagarme_12x_enabled boolean not null default false,
  add column pagarme_plan_id_annual text;

-- (5) Atomic checkout-attempt reservation (one pending per workspace)
create table pagarme_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  state text not null default 'pending'
    check (state in ('pending','succeeded','failed','expired')),
  pagarme_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_pending_attempt_per_workspace
  on pagarme_checkout_attempts (workspace_id) where state = 'pending';

-- (6) Webhook dedup ledger
create table pagarme_webhook_events (
  event_id text primary key,
  type text,
  processed_at timestamptz not null default now()
);

-- (7) RLS: service_role only, matching workspace_subscriptions shape
alter table pagarme_checkout_attempts enable row level security;

create policy "pagarme_checkout_attempts_service_role" on pagarme_checkout_attempts
  for all to service_role using (true) with check (true);

alter table pagarme_webhook_events enable row level security;

create policy "pagarme_webhook_events_service_role" on pagarme_webhook_events
  for all to service_role using (true) with check (true);
