-- Schedule tiktok-publish-cron every minute (docs/superpowers/specs/2026-07-17-tiktok-integration-design.md,
-- "pg_cron schedules" / task B5).
--
-- Mirrors instagram-publish-cron's cadence: init/status/retry phases via
-- claim_posts_for_tiktok_publishing (migration 20260719000001), each phase self-contained and
-- claim-locked (tiktok_publish_processing_at, 10-minute stale reclaim inside the RPC).
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...) (that
-- function form does not exist on this instance — see 20260617120000's note, cloned here from
-- 20260718000003_tiktok_cron_refresh.sql's identical block).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tiktok-publish-cron') THEN
    PERFORM cron.unschedule('tiktok-publish-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'tiktok-publish-cron',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/tiktok-publish-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
