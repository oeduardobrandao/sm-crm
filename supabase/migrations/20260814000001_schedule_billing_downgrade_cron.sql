-- Daily billing downgrade for Pagar.me subscriptions: paid-through rows past their
-- current_period_end lose the paid plan; stale checkout attempts are expired (backstop of
-- the checkout's own self-heal); remote orphan subscriptions (created by our checkout but
-- never bound locally) are canceled at the gateway. 06:00 UTC = 03:00 BRT.
-- NOTE: apply only AFTER the billing-downgrade-cron function is deployed (the schedule
-- fires against the live endpoint).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-downgrade-cron') THEN
    PERFORM cron.unschedule('billing-downgrade-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'billing-downgrade-cron',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/billing-downgrade-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
