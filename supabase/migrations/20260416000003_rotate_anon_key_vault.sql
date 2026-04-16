-- Reschedule instagram-sync cron to read credentials from Vault.
-- The old migration (20260324) hardcoded plaintext credentials; this replaces it.
-- Prerequisite: vault secrets 'project_url' and 'anon_key' must exist
-- (created by the original migration). After rotating the anon key, update
-- the vault secret by running:
--   SELECT vault.update_secret('anon_key', '<new-rotated-key>');
-- in the Supabase SQL editor.

select cron.unschedule('instagram-sync-cron-daily');

select cron.schedule(
  'instagram-sync-cron-daily',
  '0 6 * * *',
  $$
  select
    net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/instagram-sync-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
      ),
      body := concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);
