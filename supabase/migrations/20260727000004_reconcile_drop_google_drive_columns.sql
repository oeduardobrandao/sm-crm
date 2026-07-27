-- =============================================================
-- Schema drift reconciliation (4/4) — DROP files.google_drive_*
-- See docs/superpowers/specs/2026-07-27-schema-drift-audit.md
--
-- files.google_drive_file_id / _thumbnail_url / _view_url exist in production,
-- are created by no migration, and are read by no code. Held back from the
-- first drop migration because google_drive_file_id is not a free-standing
-- column: it participates in two CHECK constraints.
--
--   files_has_source               CHECK (r2_key IS NOT NULL
--                                      OR google_drive_file_id IS NOT NULL)
--   files_video_requires_thumbnail CHECK (kind <> 'video'
--                                      OR thumbnail_r2_key IS NOT NULL
--                                      OR google_drive_file_id IS NOT NULL)
--
-- Dropping the column makes Postgres drop BOTH constraints wholesale. Left
-- there, that silently deletes the "every file has a source" invariant. This
-- migration therefore drops them explicitly and recreates tightened versions.
--
-- DESTRUCTIVE, and gated. r2_key is nullable, so a row sourced only from Drive
-- is representable under the current constraint. If any exists, dropping the
-- column orphans it with no constraint left to catch it — so this migration
-- refuses to run rather than destroy the only source reference.
-- =============================================================

-- -------------------------------------------------------------
-- Guard: refuse if any row depends on Drive as its only source, or would
-- violate the tightened video constraint. Runs before anything is dropped.
-- -------------------------------------------------------------
DO $$
DECLARE
  drive_only bigint;
  video_bad  bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='files'
      AND column_name='google_drive_file_id'
  ) THEN
    RAISE NOTICE 'google_drive_file_id already absent — nothing to do';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.files WHERE r2_key IS NULL'
    INTO drive_only;
  IF drive_only > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop google_drive_file_id: % file row(s) have NULL r2_key '
      'and rely on Google Drive as their only source. Migrate them to R2 '
      'before applying this migration.', drive_only;
  END IF;

  SELECT count(*) INTO video_bad
    FROM public.files
   WHERE kind = 'video' AND thumbnail_r2_key IS NULL;
  IF video_bad > 0 THEN
    RAISE EXCEPTION
      'Refusing to tighten files_video_requires_thumbnail: % video row(s) '
      'have NULL thumbnail_r2_key and currently satisfy the constraint only '
      'via google_drive_file_id.', video_bad;
  END IF;

  RAISE NOTICE 'guard passed — 0 Drive-only rows, 0 thumbnail-less videos';
END $$;

-- -------------------------------------------------------------
-- Replace the constraints explicitly, so the tightening is deliberate and
-- reviewable rather than an implicit side effect of the column drop.
-- -------------------------------------------------------------
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_has_source;
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_video_requires_thumbnail;

ALTER TABLE public.files
  DROP COLUMN IF EXISTS google_drive_file_id,
  DROP COLUMN IF EXISTS google_drive_thumbnail_url,
  DROP COLUMN IF EXISTS google_drive_view_url;

ALTER TABLE public.files
  ADD CONSTRAINT files_has_source CHECK (r2_key IS NOT NULL);

ALTER TABLE public.files
  ADD CONSTRAINT files_video_requires_thumbnail
  CHECK ((kind <> 'video') OR (thumbnail_r2_key IS NOT NULL));

-- -------------------------------------------------------------
-- Post-condition: columns gone AND both invariants still enforced. The second
-- half matters most — the failure mode this migration exists to prevent is
-- ending up with the columns dropped and the constraints quietly missing.
-- -------------------------------------------------------------
DO $$
DECLARE
  leftover text;
  missing  text;
BEGIN
  SELECT string_agg(c.col, ', ') INTO leftover
  FROM (VALUES ('google_drive_file_id'),
               ('google_drive_thumbnail_url'),
               ('google_drive_view_url')) AS c(col)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns ic
    WHERE ic.table_schema='public' AND ic.table_name='files'
      AND ic.column_name = c.col
  );
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Drop incomplete — still present: %', leftover;
  END IF;

  SELECT string_agg(k.name, ', ') INTO missing
  FROM (VALUES ('files_has_source'),
               ('files_video_requires_thumbnail')) AS k(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint pc
    JOIN pg_class pcl ON pcl.oid = pc.conrelid
    JOIN pg_namespace pn ON pn.oid = pcl.relnamespace
    WHERE pn.nspname = 'public' AND pcl.relname = 'files'
      AND pc.conname = k.name AND pc.contype = 'c'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Invariant lost — constraint(s) not recreated: %', missing;
  END IF;
END $$;
