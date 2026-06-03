-- ============================================================
-- Backfill published_at for posts manually marked "postado"
-- ============================================================
-- Context
--   published_at is written only by the Instagram publishing pipeline
--   (supabase/functions/instagram-publish/handler.ts and
--   instagram-publish-cron/index.ts), which set status='postado' and
--   published_at together. A post can ALSO reach status='postado' through
--   manual paths -- the drawer Status dropdown and the calendar
--   "Marcar como postado" button -- both of which call updateWorkflowPost
--   with only { status } and never write published_at. Such posts end up
--   "posted" with no recorded publish date, which the post list surfaces
--   as the "A definir" empty state next to a "Postado" chip.
--
-- Fix
--   Give every already-posted row a publish date:
--     * if the post was scheduled, use scheduled_at -- its planned publish
--       time, and the value the list already displays, so nothing visibly
--       changes (the tooltip just becomes "Publicado em" instead of
--       "Agendado para");
--     * otherwise fall back to updated_at, the closest proxy we have for
--       when it was marked posted.
--   COALESCE(scheduled_at, updated_at) is never NULL for a real row
--   (updated_at defaults to now() and is non-null), so no targeted row is
--   left without a date.
--
-- Safety
--   * Idempotent: only rows where published_at IS NULL are touched, so the
--     statement is safe to re-run.
--   * Only 'postado' is targeted. 'falha_publicacao' was NOT published and
--     must not receive a publish date.
--   * The auto_reject_pending_suggestion trigger is a no-op here: it reacts
--     only to changes in conteudo / ig_caption / status, none of which this
--     statement modifies.
--   * The set_workflow_posts_updated_at trigger will set updated_at = now()
--     on the affected rows. published_at is computed from the pre-update row
--     values, so it captures the original updated_at, not now().
-- ============================================================

UPDATE workflow_posts
SET published_at = COALESCE(scheduled_at, updated_at)
WHERE status = 'postado'
  AND published_at IS NULL;
