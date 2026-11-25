-- Agenda o reverse-trial-cron a cada 15 minutos (spec
-- docs/superpowers/specs/2026-11-24-reverse-trial-design.md, Part 5): encerra os testes
-- reversos vencidos via end_reverse_trial (migration 20261130000001).
--
-- Aplicar SO depois do deploy da function reverse-trial-cron (com --no-verify-jwt): agendada
-- antes, o pg_cron bate numa function inexistente a cada 15 minutos. Falhas de agendamento
-- aparecem no cron-health-cron, que varre cron.job_run_details de todos os jobs.
--
-- Usa a forma subselect de vault.decrypted_secrets (ver 20260720000007). Idempotente.
--
-- Rollback: antes de desagendar, encerre os testes em andamento com end_reverse_trial (sem a
-- varredura nenhum teste termina sozinho).

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reverse-trial-cron') THEN
    PERFORM cron.unschedule('reverse-trial-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'reverse-trial-cron',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/reverse-trial-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
