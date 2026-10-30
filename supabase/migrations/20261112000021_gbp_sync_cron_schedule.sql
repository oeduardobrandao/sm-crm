-- Schedule gbp-sync-cron hourly at minute 40 (plan ruling P1; spec
-- docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md §5.2).
--
-- DEPLOY gbp-sync-cron (with --no-verify-jwt) BEFORE APPLYING THIS MIGRATION: scheduled first,
-- pg_cron would call a function that does not exist every hour.
--
-- Minute 40 sits outside the stagger list (20260925110001; minutes ≡ 1, 2 mod 5 are taken every
-- 5 minutes) and five minutes after youtube-sync-cron's 35.
--
-- Each run syncs up to GOOGLE_SYNC_BATCH_LIMIT active Google Meu Negócio locations not synced in
-- the last 20 h (workspace needs feature_google_business AND feature_auto_sync_cron), then runs
-- the privacy deletion duties whatever the flags: google_expire_units(), the google_revocations
-- retry and the orphan-sub release.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...) (that function
-- form does not exist on this instance; same block as 20260720000007_tiktok_sync_cron_schedule.sql).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gbp-sync-cron') THEN
    PERFORM cron.unschedule('gbp-sync-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'gbp-sync-cron',
  '40 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/gbp-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
