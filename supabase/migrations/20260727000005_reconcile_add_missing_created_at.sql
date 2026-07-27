-- =============================================================
-- Schema drift reconciliation (5/5) — ADD missing created_at columns
-- See docs/superpowers/specs/2026-07-27-schema-drift-audit.md (Finding C)
--
-- These four columns are defined by migrations and present in staging, but
-- absent from production. Root cause: the defining migrations use
-- CREATE TABLE IF NOT EXISTS, and the tables had already been hand-created in
-- production, so the statements silently no-oped while recording as applied.
--
-- Decision: add them to production, but WITHOUT backfilling existing rows.
--
-- IMPORTANT — why this is two statements per column, not one.
-- In PostgreSQL 11+, `ADD COLUMN x timestamptz DEFAULT now()` populates every
-- existing row with the default. That would stamp thousands of historical
-- instagram_posts and instagram_follower_history rows with the migration date —
-- not a missing value but a wrong one, and unrecoverable. Adding the column
-- bare leaves existing rows NULL (honestly "unknown"); attaching the default
-- afterwards applies it only to future inserts.
--
-- Consequence, accepted deliberately: these columns are NULLable here whereas
-- the original definitions are `timestamptz DEFAULT now()`. Prod and staging
-- will therefore still differ on the default's effect for pre-existing rows.
-- That residual difference is recorded in the audit rather than papered over.
-- =============================================================

ALTER TABLE public.hub_brand                  ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.hub_brand_files            ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.instagram_posts            ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.instagram_follower_history ADD COLUMN IF NOT EXISTS created_at timestamptz;

ALTER TABLE public.hub_brand                  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.hub_brand_files            ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.instagram_posts            ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.instagram_follower_history ALTER COLUMN created_at SET DEFAULT now();

-- -------------------------------------------------------------
-- Post-condition: the column exists, carries a default for new rows, and is
-- NOT NOT-NULL. The nullability check is the load-bearing one: if it were
-- NOT NULL, that could only mean existing rows had been backfilled.
-- -------------------------------------------------------------
DO $$
DECLARE
  problem text;
BEGIN
  SELECT string_agg(t.name || ': ' || t.issue, '; ') INTO problem
  FROM (
    SELECT tbl AS name,
           CASE
             WHEN c.column_name  IS NULL  THEN 'column missing'
             WHEN c.is_nullable  = 'NO'   THEN 'unexpectedly NOT NULL (rows may have been backfilled)'
             WHEN c.column_default IS NULL THEN 'default not set'
           END AS issue
    FROM (VALUES ('hub_brand'), ('hub_brand_files'),
                 ('instagram_posts'), ('instagram_follower_history')) AS v(tbl)
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name   = v.tbl
     AND c.column_name  = 'created_at'
  ) t
  WHERE t.issue IS NOT NULL;

  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'created_at reconciliation failed — %', problem;
  END IF;
END $$;
