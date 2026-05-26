-- Fix instagram-sync-cron schedule: use x-cron-secret header instead of
-- Authorization Bearer token. The edge function validates via x-cron-secret
-- (handler.ts), not JWT — the old schedule was sending the wrong header,
-- causing 401s since the function is deployed with --no-verify-jwt.

-- Store cron_secret in Vault if not already present.
-- After running this migration, ensure the vault secret matches the
-- CRON_SECRET env var on the edge function:
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'cron_secret'),
--     '<your-CRON_SECRET-value>'
--   );
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret('REPLACE_ME', 'cron_secret');
  END IF;
END;
$$;

SELECT cron.unschedule('instagram-sync-cron-daily');

SELECT cron.schedule(
  'instagram-sync-cron-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/instagram-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);
