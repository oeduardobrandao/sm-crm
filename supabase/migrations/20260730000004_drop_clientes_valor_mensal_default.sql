-- =============================================================
-- Fix: drop a production-only drifted DEFAULT on clientes.valor_mensal.
--
-- 20260301_baseline_schema.sql declares valor_mensal numeric with no
-- default, and staging matches that. Production had drifted to
-- DEFAULT 0 outside of any migration.
--
-- That default broke client creation for every admin/agent without
-- financial visibility: the app correctly omits valor_mensal from the
-- insert payload for those users (stripFinancialFields), but Postgres
-- then filled the omitted column from the column default (0 on prod,
-- not NULL). guard_financial_write() (20260728000002) treats any
-- non-null valor_mensal on INSERT as "setting a financial value" and
-- raised financial_access_denied — even though the user never touched
-- the field. Reproduced directly against prod in a rolled-back
-- transaction before this fix.
-- =============================================================
ALTER TABLE public.clientes ALTER COLUMN valor_mensal DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes'
      AND column_name = 'valor_mensal' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'clientes.valor_mensal still has a default after DROP DEFAULT';
  END IF;
END $$;
