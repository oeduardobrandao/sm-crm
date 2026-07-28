-- =============================================================
-- Schema drift reconciliation (3/4) — ADOPT contas columns
-- See docs/superpowers/specs/2026-07-27-schema-drift-audit.md
--
-- contas.brand_color and contas.hub_enabled exist in production but no
-- migration creates them. They were missed in the first audit pass: a migration
-- (20260505100002_workspaces_hub_columns.sql) adds columns of the same names,
-- but to `workspaces`, not `contas`.
--
-- Decision: keep them. This captures production's existing shape so migrations
-- and production agree. No-op in production; adds the columns everywhere else.
--
-- Note: nothing currently reads either column *from contas* — the app reads
-- brand_color/hub_enabled from `workspaces`, and reads only slug/nome from
-- contas. They are retained rather than dropped by explicit decision.
-- =============================================================

ALTER TABLE public.contas
  ADD COLUMN IF NOT EXISTS brand_color text,
  ADD COLUMN IF NOT EXISTS hub_enabled boolean NOT NULL DEFAULT true;

-- Post-condition: CREATE/ALTER ... IF NOT EXISTS can silently no-op, which is
-- how this schema drifted in the first place. Assert the result.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.col, ', ') INTO missing
  FROM (VALUES ('brand_color'), ('hub_enabled')) AS c(col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns ic
    WHERE ic.table_schema = 'public'
      AND ic.table_name   = 'contas'
      AND ic.column_name  = c.col
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'contas adoption incomplete — missing: %', missing;
  END IF;
END $$;
