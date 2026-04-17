-- ⚠️  SUPERSEDED: The anon_key stored below is the ORIGINAL key seeded into Vault.
-- After rotating the anon key, run:
--   SELECT vault.update_secret('anon_key', '<new-rotated-key>');
-- The cron schedule created here was replaced by migration
-- 20260416000003_rotate_anon_key_vault.sql which reads credentials from Vault
-- at execution time instead of embedding them in the SQL string.
-- This migration is kept only for the extension setup and initial Vault seeding.

-- Enable required extensions
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Store project URL and anon key in Vault (safe credential storage)
-- These are used by pg_net to call edge functions securely.
select vault.create_secret(
  'https://skjzpekeqefvlojenfsw.supabase.co',
  'project_url'
);

select vault.create_secret(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNranpwZWtlcWVmdmxvamVuZnN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjU3MDcsImV4cCI6MjA4ODE0MTcwN30.qveRy0wCYSM_bFHP11cRnewm0j4I01QsYMLRprhMcbo',
  'anon_key'
);

-- Schedule daily Instagram sync at 06:00 UTC (03:00 BRT)
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
