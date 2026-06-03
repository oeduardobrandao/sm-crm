-- ============================================================
-- Keep published_at in sync when a post becomes "postado"
-- ============================================================
-- Companion to 20260601000000_backfill_postado_published_at.sql.
--
-- The backfill repairs existing rows, but status='postado' can still be set
-- through manual paths that never write published_at:
--   * the drawer Status dropdown (handleFieldChange / handleConfirmStatusChange)
--   * the calendar "Marcar como postado" button (handlePostStatusUpdate)
-- Without this guard, every newly hand-marked post would again be "posted"
-- with no publish date ("A definir" in the post list).
--
-- This BEFORE INSERT OR UPDATE trigger enforces the invariant at the data
-- layer, so it covers all current and future code paths in one place:
--   when a row is "postado" and has no published_at, stamp it with now().
--
-- It only fills a NULL value, so it never overwrites the real timestamp
-- written by the Instagram publishing pipeline (instagram-publish handler /
-- cron set status + published_at together -> this trigger is a no-op there),
-- nor the values set by the backfill. It is therefore idempotent and safe.
-- ============================================================

CREATE OR REPLACE FUNCTION set_workflow_posts_published_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'postado' AND NEW.published_at IS NULL THEN
    NEW.published_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workflow_posts_set_published_at ON workflow_posts;
CREATE TRIGGER workflow_posts_set_published_at
  BEFORE INSERT OR UPDATE ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION set_workflow_posts_published_at();
