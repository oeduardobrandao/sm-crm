-- =====================================================================
-- 20261205000002_usd_billing_rpcs.sql
--
-- Cobrança em USD (lançamento nos EUA, parte 2). Spec:
-- docs/superpowers/specs/2026-11-25-usd-billing-design.md
--
-- (1) admin_metrics_write_snapshot passa a gravar a moeda de cada linha em
--     workspace_subscription_snapshots.currency (coluna da 20261205000001).
--     Linha sem a chave `currency` (cron/backfill antigos durante o deploy)
--     grava 'brl', o comportamento de antes. O histórico de métricas nunca
--     soma centavos de USD com centavos de BRL: get-metrics-history devolve
--     uma série por moeda.
--     Corpo copiado da definição de 20260925130001_metrics_snapshots.sql
--     (nenhuma migration posterior a redefiniu); mesma assinatura, mesmo
--     SECURITY INVOKER, mesmos grants (service_role só).
-- =====================================================================

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
    monthly_cents, amount_source, provider_switch, source, currency
  )
  select r.workspace_id, p_date, r.provider, r.plan_id, r.plan_name, r.status, r.billing_interval,
         coalesce(r.monthly_cents, 0), r.amount_source, coalesce(r.provider_switch, false), p_source,
         coalesce(r.currency, 'brl')
  from jsonb_to_recordset(p_rows) as r(
    workspace_id uuid, provider text, plan_id text, plan_name text, status text,
    billing_interval text, monthly_cents integer, amount_source text, provider_switch boolean,
    currency text
  );
  get diagnostics v_written = row_count;

  insert into metrics_snapshot_runs (snapshot_date, source, row_count, completed_at)
  values (p_date, p_source, v_written, now())
  on conflict (snapshot_date) do update
    set source = excluded.source, row_count = excluded.row_count, completed_at = excluded.completed_at;

  return jsonb_build_object('written', v_written, 'skipped', false);
end;
$$;

-- CREATE OR REPLACE keeps the existing ACL; restated so this file alone is the source of truth.
revoke all on function public.admin_metrics_write_snapshot(date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_metrics_write_snapshot(date, text, jsonb)
  to service_role;
