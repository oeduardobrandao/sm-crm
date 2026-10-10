-- Repasse mensal do programa de afiliados por Stripe Connect (affiliate-payout-cron):
-- transfere o saldo disponível de cada afiliado com conta Express apta, acima do mínimo
-- (AFFILIATE_MIN_PAYOUT_CENTS, padrão R$ 50). Dia 5 às 11:47 UTC = 08:47 em São Paulo.
-- NOTE: aplicar só DEPOIS do deploy de affiliate-payout-cron (o agendamento chama o endpoint).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'affiliate-payout-cron') THEN
    PERFORM cron.unschedule('affiliate-payout-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'affiliate-payout-cron',
  '47 11 5 * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/affiliate-payout-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
