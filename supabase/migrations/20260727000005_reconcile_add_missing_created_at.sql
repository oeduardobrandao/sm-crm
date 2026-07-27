-- =============================================================
-- Schema drift reconciliation (5/5) — ADD missing created_at columns
-- See docs/superpowers/specs/2026-07-27-schema-drift-audit.md (Finding C)
--
-- Four created_at columns are defined by migrations and present in staging, but
-- absent from production. Root cause: the defining migrations use
-- CREATE TABLE IF NOT EXISTS, and the tables had already been hand-created in
-- production, so the statements silently no-oped while recording as applied.
--
-- Decision: add them to production WITHOUT backfilling existing rows.
--
-- Two things make this trickier than it looks.
--
-- 1. In PostgreSQL 11+, `ADD COLUMN x timestamptz DEFAULT now()` populates every
--    existing row with the default. That would stamp thousands of historical
--    instagram_posts and instagram_follower_history rows with the migration
--    date — not a missing value but a wrong one, and unrecoverable. So the
--    column is added bare and the default attached separately, which applies it
--    only to future inserts.
--
-- 2. The four columns do NOT share a canonical definition. hub_brand and
--    hub_brand_files declare `created_at timestamptz NOT NULL DEFAULT now()`
--    (20260415000001); instagram_posts and instagram_follower_history declare it
--    nullable (20260301 baseline). Environments built from migrations therefore
--    already have the first two as NOT NULL — a correct state, not a defect.
--    An unconditional "must be nullable" assertion would fail there for no
--    reason, which is exactly what an earlier draft of this migration did.
--
-- So: add only where absent, and assert nullability only for columns THIS
-- migration actually added — where NOT NULL could only mean a backfill.
-- =============================================================

DO $$
DECLARE
  t     text;
  added text[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY['hub_brand', 'hub_brand_files',
                           'instagram_posts', 'instagram_follower_history'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at'
    ) THEN
      RAISE NOTICE 'skip %.created_at — already present', t;
    ELSE
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN created_at timestamptz', t);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_at SET DEFAULT now()', t);
      added := array_append(added, t);
      RAISE NOTICE 'added %.created_at — nullable, default now(); existing rows left NULL', t;
    END IF;
  END LOOP;

  -- Post-condition A: all four columns exist and carry a default.
  DECLARE
    problem text;
  BEGIN
    SELECT string_agg(v.tbl || ' (' ||
             CASE WHEN c.column_name IS NULL THEN 'column missing'
                  ELSE 'no default' END || ')', ', ')
      INTO problem
    FROM (VALUES ('hub_brand'), ('hub_brand_files'),
                 ('instagram_posts'), ('instagram_follower_history')) AS v(tbl)
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = v.tbl
     AND c.column_name = 'created_at'
    WHERE c.column_name IS NULL OR c.column_default IS NULL;

    IF problem IS NOT NULL THEN
      RAISE EXCEPTION 'created_at reconciliation failed — %', problem;
    END IF;
  END;

  -- Post-condition B: anything THIS migration added must be nullable. A column
  -- we just created cannot legitimately be NOT NULL — that could only mean the
  -- default was applied to pre-existing rows, i.e. the backfill we set out to
  -- avoid. Pre-existing columns are exempt: their nullability is whatever their
  -- defining migration chose.
  IF array_length(added, 1) IS NOT NULL THEN
    DECLARE
      backfilled text;
    BEGIN
      SELECT string_agg(c.table_name, ', ') INTO backfilled
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = ANY (added)
        AND c.column_name = 'created_at'
        AND c.is_nullable = 'NO';

      IF backfilled IS NOT NULL THEN
        RAISE EXCEPTION
          'created_at unexpectedly NOT NULL on newly added column(s): % — '
          'existing rows may have been backfilled', backfilled;
      END IF;
    END;
  END IF;
END $$;
