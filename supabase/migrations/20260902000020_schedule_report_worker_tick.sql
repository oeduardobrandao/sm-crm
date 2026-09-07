-- supabase/migrations/20260902000020_schedule_report_worker_tick.sql
-- O report-worker processa exatamente UM relatório por invocação (claim com
-- lock otimista) e nunca se re-encadeia. O analytics-report-cron mensal o
-- dispara uma única vez, então N relatórios na fila rendiam 1 gerado por mês.
-- Este tick drena a fila: a cada 5 min o worker reclama 1 relatório
-- pending / failed(retry<3) / generating com lock vencido (>10 min).
-- Sem pendências a invocação é um no-op barato (1 SELECT).
-- Must be applied AFTER the report-worker function is deployed (--no-verify-jwt).
-- vault.decrypted_secrets é VIEW (subselect form) -- ver nota em 20260617120000.
-- Idempotente: seguro aplicar duas vezes.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'report-worker-tick') THEN
    PERFORM cron.unschedule('report-worker-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'report-worker-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/report-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Re-agenda o job mensal com a forma correta do vault. A migration original
-- (20260416000001) usa vault.decrypted_secret(), função que não existe --
-- o job em prod só funciona por ajuste manual; isto realinha o estado
-- declarado com o padrão que funciona.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analytics-report-cron-monthly') THEN
    PERFORM cron.unschedule('analytics-report-cron-monthly');
  END IF;
END $$;

SELECT cron.schedule(
  'analytics-report-cron-monthly',
  '0 6 1 * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/analytics-report-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
