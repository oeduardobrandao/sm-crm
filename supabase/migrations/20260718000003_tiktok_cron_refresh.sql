-- Schedule tiktok-refresh-cron every 6 hours, offset 15 minutes past the hour
-- (docs/superpowers/specs/2026-07-17-tiktok-integration-design.md, "pg_cron schedules").
--
-- Selects `active` tiktok_accounts with access_token_expires_at <= now()+12h and runs
-- getFreshTikTokToken (the only refresh path, _shared/tiktok.ts) per account — same shape as
-- instagram-refresh-cron's 6h cadence (20260525100001), giving a failing run 3 more chances
-- before the 24h TikTok access token actually expires.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...) (that
-- function form does not exist on this instance — see 20260617120000's note).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tiktok-refresh-cron') THEN
    PERFORM cron.unschedule('tiktok-refresh-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'tiktok-refresh-cron',
  '15 */6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/tiktok-refresh-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
