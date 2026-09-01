-- 20260901100000_account_metrics_parity.sql
-- Spec: docs/superpowers/specs/2026-08-31-report-app-parity-design.md §4.2

-- 1) Valores POR-DIA (dias completos; null = indisponível naquele dia)
ALTER TABLE instagram_account_metrics_daily
  ADD COLUMN IF NOT EXISTS reach_day integer,
  ADD COLUMN IF NOT EXISTS views_day integer,
  ADD COLUMN IF NOT EXISTS saves_day integer,
  ADD COLUMN IF NOT EXISTS accounts_engaged_day integer,
  ADD COLUMN IF NOT EXISTS profile_views_day integer,
  ADD COLUMN IF NOT EXISTS website_clicks_day integer,
  ADD COLUMN IF NOT EXISTS follows_day integer,
  ADD COLUMN IF NOT EXISTS unfollows_day integer,
  -- correção do mapeamento: accounts_engaged ganha coluna própria (28d móvel)
  ADD COLUMN IF NOT EXISTS accounts_engaged_28d integer;

-- 2) Agregado FECHADO do mês (única forma paritária de histórico p/ métricas
--    de únicos além dos 90d da Meta)
CREATE TABLE IF NOT EXISTS instagram_account_metrics_monthly (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instagram_account_id uuid NOT NULL
    REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  month date NOT NULL,                    -- sempre dia 1 do mês
  reach_month integer,
  views_month integer,
  saves_month integer,
  accounts_engaged_month integer,
  profile_views_month integer,
  website_clicks_month integer,
  follows_month integer,
  unfollows_month integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, month)
);
ALTER TABLE instagram_account_metrics_monthly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON instagram_account_metrics_monthly
  FOR ALL USING (auth.role() = 'service_role');

-- 3) Estado do backfill (seletor + checkpoint; spec §4.2.3) + a coluna 28d
--    que a Task 6 também grava em instagram_accounts (o update da conta
--    escreve as *_28d nos DOIS lugares, como as quatro existentes — sem esta
--    coluna aqui, todo sync falharia com missing column; achado Codex P1)
ALTER TABLE instagram_accounts
  ADD COLUMN IF NOT EXISTS metrics_backfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS metrics_backfill_cursor date,
  ADD COLUMN IF NOT EXISTS accounts_engaged_28d integer;

-- 4) Upsert atômico que preserva valor: não-null novo vence (reconsulta da
--    janela móvel), null NUNCA apaga valor válido. supabase-js .upsert() não
--    expressa COALESCE; read-before-write teria corrida entre execuções.
CREATE OR REPLACE FUNCTION upsert_metrics_daily(p_rows jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO instagram_account_metrics_daily AS t (
    instagram_account_id, snapshot_date,
    reach_day, views_day, saves_day, accounts_engaged_day,
    profile_views_day, website_clicks_day, follows_day, unfollows_day
  )
  SELECT
    (r->>'instagram_account_id')::uuid,
    (r->>'snapshot_date')::date,
    (r->>'reach_day')::integer, (r->>'views_day')::integer,
    (r->>'saves_day')::integer, (r->>'accounts_engaged_day')::integer,
    (r->>'profile_views_day')::integer, (r->>'website_clicks_day')::integer,
    (r->>'follows_day')::integer, (r->>'unfollows_day')::integer
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (instagram_account_id, snapshot_date) DO UPDATE SET
    reach_day            = COALESCE(EXCLUDED.reach_day, t.reach_day),
    views_day            = COALESCE(EXCLUDED.views_day, t.views_day),
    saves_day            = COALESCE(EXCLUDED.saves_day, t.saves_day),
    accounts_engaged_day = COALESCE(EXCLUDED.accounts_engaged_day, t.accounts_engaged_day),
    profile_views_day    = COALESCE(EXCLUDED.profile_views_day, t.profile_views_day),
    website_clicks_day   = COALESCE(EXCLUDED.website_clicks_day, t.website_clicks_day),
    follows_day          = COALESCE(EXCLUDED.follows_day, t.follows_day),
    unfollows_day        = COALESCE(EXCLUDED.unfollows_day, t.unfollows_day);
$$;
-- REVOKE/GRANT: função é SECURITY DEFINER chamada só pelo service role.
REVOKE ALL ON FUNCTION upsert_metrics_daily(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) TO service_role;
-- Este projeto Supabase tem default ACL (ALTER DEFAULT PRIVILEGES, roles
-- postgres/supabase_admin) que concede EXECUTE a anon/authenticated em toda
-- function nova de public schema -- concessão direta ao role, não via
-- PUBLIC, então REVOKE ALL FROM PUBLIC acima não remove. Verificado ao vivo
-- em staging (2026-09-01): sem esta linha, upsert_metrics_daily ficava
-- chamável por anon sem autenticação, contradizendo o comentário acima.
REVOKE EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) FROM anon, authenticated;
