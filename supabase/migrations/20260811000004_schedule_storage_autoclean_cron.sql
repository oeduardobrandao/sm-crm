-- Schedule storage-autoclean-cron diariamente às 02:30 (auto-limpeza de mídia
-- de posts publicados; spec docs/superpowers/specs/2026-08-10-storage-autoclean-design.md).
--
-- 02:30 de propósito: 30 minutos antes do post-media-cleanup-cron das 03:00,
-- que drena a fila file_deletions -- os objetos R2 dos arquivos apagados aqui
-- saem na mesma madrugada.
--
-- Must be applied AFTER the storage-autoclean-cron function is deployed -- the
-- schedule fires on the next tick (same ordering rule as 20260803000007).
--
-- Rollback order is the REVERSE: unschedule this job first
-- (SELECT cron.unschedule('storage-autoclean-cron')), then undeploy the function.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...)
-- (that function form does not exist on this instance -- see 20260617120000's note).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage-autoclean-cron') THEN
    PERFORM cron.unschedule('storage-autoclean-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'storage-autoclean-cron',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/storage-autoclean-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
