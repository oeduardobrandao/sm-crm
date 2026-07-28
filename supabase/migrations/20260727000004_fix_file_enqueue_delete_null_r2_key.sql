-- =============================================================
-- Fix: file_enqueue_delete() cannot delete a file that has no R2 object
--
-- The AFTER/BEFORE DELETE trigger on `files` unconditionally enqueues a
-- reclamation row:
--
--   INSERT INTO file_deletions (r2_key, thumbnail_r2_key)
--   VALUES (OLD.r2_key, OLD.thumbnail_r2_key);
--
-- but `file_deletions.r2_key` is NOT NULL, while `files.r2_key` is nullable —
-- `files_has_source` explicitly permits a NULL r2_key as long as
-- google_drive_file_id is set. The trigger therefore contradicts the table's own
-- constraint, and deleting any Drive-sourced file has always failed with:
--
--   null value in column "r2_key" of relation "file_deletions"
--   violates not-null constraint
--
-- Enqueuing such a row would be meaningless anyway: there is no R2 object to
-- reclaim, and the cleanup worker would have nothing to act on.
--
-- SEQUENCING: numbered ...000004 (a vacant slot, verified present in neither
-- environment's migration history) so it sorts BEFORE
-- 20260727000008_reconcile_drop_google_drive_columns. That migration's guard
-- refuses while Drive-only rows exist, and clearing those rows requires deleting
-- them — which requires this fix. A later number would be unreachable behind the
-- very migration it unblocks.
--
-- Also adds `SET search_path` — absent from the original definition, which is a
-- search-path-injection risk in any SECURITY DEFINER function.
-- =============================================================

CREATE OR REPLACE FUNCTION public.file_enqueue_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No R2 object to reclaim: skip the queue rather than violating its NOT NULL.
  IF OLD.r2_key IS NULL THEN
    RETURN OLD;
  END IF;

  INSERT INTO file_deletions (r2_key, thumbnail_r2_key)
  VALUES (OLD.r2_key, OLD.thumbnail_r2_key);
  RETURN OLD;
END;
$$;

-- Post-condition: the guard is present and the function still carries its
-- security properties.
DO $$
DECLARE
  src text;
  sec boolean;
BEGIN
  SELECT p.prosrc, p.prosecdef INTO src, sec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'file_enqueue_delete';

  IF src IS NULL THEN
    RAISE EXCEPTION 'file_enqueue_delete() is missing';
  END IF;
  IF src NOT LIKE '%OLD.r2_key IS NULL%' THEN
    RAISE EXCEPTION 'file_enqueue_delete() is missing the NULL r2_key guard';
  END IF;
  IF NOT sec THEN
    RAISE EXCEPTION 'file_enqueue_delete() lost SECURITY DEFINER';
  END IF;
END $$;
