-- Admin Métricas, sub-projeto B (spec docs/superpowers/specs/2026-09-25-admin-metricas-historico-design.md).
--
-- workspace_subscription_snapshots: one row per workspace per São Paulo day while it has a
-- subscription (any status). metrics_snapshot_runs: completion marker; readers only trust dates
-- that have one, so a run that died halfway never reads as churn.
--
-- Deploy metrics-snapshot-cron BEFORE applying this migration: the schedule at the bottom starts
-- firing at the next 02:44 UTC.

create table public.workspace_subscription_snapshots (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  snapshot_date date not null,
  provider text not null check (provider in ('stripe', 'pagarme')),
  plan_id text,
  plan_name text,
  status text not null,
  billing_interval text,
  monthly_cents integer not null default 0 check (monthly_cents >= 0),
  amount_source text not null
    check (amount_source in ('stripe', 'pagarme', 'catalog', 'backfill', 'unpriced')),
  provider_switch boolean not null default false,
  source text not null check (source in ('cron', 'backfill')),
  created_at timestamptz not null default now(),
  unique (workspace_id, snapshot_date)
);

create index workspace_subscription_snapshots_date_idx
  on public.workspace_subscription_snapshots (snapshot_date);

alter table public.workspace_subscription_snapshots enable row level security;
revoke all on table public.workspace_subscription_snapshots from anon, authenticated;
grant all on table public.workspace_subscription_snapshots to service_role;

create table public.metrics_snapshot_runs (
  snapshot_date date primary key,
  source text not null check (source in ('cron', 'backfill')),
  row_count integer not null,
  completed_at timestamptz not null default now()
);

alter table public.metrics_snapshot_runs enable row level security;
revoke all on table public.metrics_snapshot_runs from anon, authenticated;
grant all on table public.metrics_snapshot_runs to service_role;

-- Writes one whole day atomically: rows + marker, or nothing.
--   cron:     replaces every row of the date (a rerun drops workspaces that lost their sub).
--   backfill: skips a date the cron already owns; otherwise replaces the date.
create or replace function public.admin_metrics_write_snapshot(
  p_date date,
  p_source text,
  p_rows jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_written integer;
begin
  if p_source is null or p_source not in ('cron', 'backfill') then
    raise exception 'invalid source %', p_source using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array' using errcode = '22023';
  end if;

  -- Serialize concurrent writers of the same day (cron tick vs a manual trigger).
  perform pg_advisory_xact_lock(hashtext('metrics_snapshot:' || p_date::text));

  if p_source = 'backfill' and exists (
    select 1 from metrics_snapshot_runs where snapshot_date = p_date and source = 'cron'
  ) then
    return jsonb_build_object('written', 0, 'skipped', true);
  end if;

  delete from workspace_subscription_snapshots where snapshot_date = p_date;

  insert into workspace_subscription_snapshots (
    workspace_id, snapshot_date, provider, plan_id, plan_name, status, billing_interval,
    monthly_cents, amount_source, provider_switch, source
  )
  select r.workspace_id, p_date, r.provider, r.plan_id, r.plan_name, r.status, r.billing_interval,
         coalesce(r.monthly_cents, 0), r.amount_source, coalesce(r.provider_switch, false), p_source
  from jsonb_to_recordset(p_rows) as r(
    workspace_id uuid, provider text, plan_id text, plan_name text, status text,
    billing_interval text, monthly_cents integer, amount_source text, provider_switch boolean
  );
  get diagnostics v_written = row_count;

  insert into metrics_snapshot_runs (snapshot_date, source, row_count, completed_at)
  values (p_date, p_source, v_written, now())
  on conflict (snapshot_date) do update
    set source = excluded.source, row_count = excluded.row_count, completed_at = excluded.completed_at;

  return jsonb_build_object('written', v_written, 'skipped', false);
end;
$$;

-- Hosted Supabase grants EXECUTE to anon/authenticated/service_role explicitly at creation, so
-- the roles must be named here too; this only covers calling the RPC, not the tables it touches.
-- The RPC is SECURITY INVOKER, so its body runs as whatever role calls it: the two GRANT ALL
-- ... TO service_role above (on workspace_subscription_snapshots and metrics_snapshot_runs) are
-- what let a service_role caller (Task 3's cron/backfill client) actually DELETE+INSERT and
-- INSERT+UPDATE those tables on hosted Supabase, which has no default ACL for objects created by
-- a migration (same shape as 20260925000030_tarefa_series.sql and 20260925000016_cliente_links.sql).
revoke all on function public.admin_metrics_write_snapshot(date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_metrics_write_snapshot(date, text, jsonb)
  to service_role;

-- Daily close at 23:44 São Paulo (02:44 UTC). Minute 44 of hour 2 only has the three
-- every-minute jobs in prod (cron.job, 2026-09-25; see
-- 20260925110001_stagger_cron_schedules.sql). Idempotent.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'metrics-snapshot-cron') then
    perform cron.unschedule('metrics-snapshot-cron');
  end if;
end $$;

select cron.schedule(
  'metrics-snapshot-cron',
  '44 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/metrics-snapshot-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
