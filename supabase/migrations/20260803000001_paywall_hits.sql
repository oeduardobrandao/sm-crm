-- Paywall denials, recorded so free workspaces that reached for a gated feature
-- can be emailed about it.
-- Spec: docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md
--
-- NOT written by enforce_plan_feature: that function RAISEs, and the raise
-- aborts the transaction, rolling any INSERT back with it. Writes come from the
-- paywall-report edge function (service role) instead.
create table if not exists paywall_hits (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid null references auth.users(id) on delete set null,
  feature         text not null,
  clicked_upgrade boolean not null default false,
  hit_at          timestamptz not null default now()
);

create index if not exists paywall_hits_workspace_hit_at
  on paywall_hits (workspace_id, hit_at desc);

alter table paywall_hits enable row level security;

create policy "paywall_hits_service_role" on paywall_hits
  for all to service_role using (true) with check (true);
-- No authenticated policy: the CRM never writes here directly, only via
-- paywall-report, which authorises against workspace_members first.
