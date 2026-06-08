-- =====================================================================
-- 20260608000000_cron_triage.sql
-- Cron-failure auto-triage: durable failure log (cron_failures), atomic
-- cooldown ledger (cron_triage_state), and the race-free claim RPC
-- (claim_cron_triage). Service-role only; no client access.
-- =====================================================================

-- ---------- Failure log ----------------------------------------------
create table if not exists cron_failures (
  id              uuid primary key default gen_random_uuid(),
  cron_name       text not null,
  signature       text not null,
  signature_hash  text not null,
  error_message   text,
  error_detail    jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);

create index if not exists idx_cron_failures_hash_occurred
  on cron_failures (signature_hash, occurred_at desc);

-- ---------- Cooldown ledger (one row per signature) ------------------
create table if not exists cron_triage_state (
  signature_hash     text primary key,
  cron_name          text not null,
  last_dispatched_at timestamptz not null default now()
);

-- ---------- Atomic claim ---------------------------------------------
-- Returns true ONLY when the caller wins the cooldown claim (new
-- signature, or last dispatch older than the cooldown). Single statement
-- => race-free: two concurrent same-signature failures, exactly one wins.
create or replace function claim_cron_triage(
  p_hash text,
  p_cron_name text,
  p_cooldown_seconds integer
) returns boolean
language sql
security definer
set search_path = public
as $$
  insert into cron_triage_state (signature_hash, cron_name, last_dispatched_at)
  values (p_hash, p_cron_name, now())
  on conflict (signature_hash) do update
    set last_dispatched_at = now(),
        cron_name = excluded.cron_name
    where cron_triage_state.last_dispatched_at
          < now() - make_interval(secs => p_cooldown_seconds)
  returning true;
$$;

-- ---------- RLS: service-role only -----------------------------------
alter table cron_failures      enable row level security;
alter table cron_triage_state  enable row level security;

drop policy if exists service_role_bypass_cron_failures on cron_failures;
create policy service_role_bypass_cron_failures on cron_failures
  for all to service_role using (true) with check (true);

drop policy if exists service_role_bypass_cron_triage_state on cron_triage_state;
create policy service_role_bypass_cron_triage_state on cron_triage_state
  for all to service_role using (true) with check (true);

-- Claim RPC: service role only.
revoke all on function claim_cron_triage(text, text, integer) from public;
grant execute on function claim_cron_triage(text, text, integer) to service_role;
