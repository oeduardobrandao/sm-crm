-- Roda o report-worker-tick a cada minuto (era */5).
--
-- O worker reclama exatamente UM relatório por invocação e não se re-encadeia,
-- então a cadência do tick É o teto de vazão da fila: */5 dá 288 relatórios por
-- dia. O pico é o dia 1º de cada mês, quando o analytics-report-cron enfileira
-- um relatório por cliente elegível de uma vez; a 288/dia esse pico começa a
-- passar de um dia por volta de ~300 clientes, e relatórios pedidos à mão no
-- app entram na fila atrás dele.
--
-- A cadência de 1 minuto leva o teto para 1440/dia (5x) sem mexer no worker. A
-- concorrência que isso cria é limitada sozinha e pequena: um novo worker sobe
-- a cada minuto e cada um segura o seu por (duração de uma geração), então há
-- no máximo ~(minutos por geração) workers em voo. Cada um reclama uma linha
-- diferente — o claim otimista (UPDATE ... .eq("status", candidate.status))
-- já garante isso, é o mesmo mecanismo que protege o re-claim por lock vencido.
--
-- Tick ocioso continua barato: um SELECT indexado que volta vazio e retorna.
-- Mesmo precedente do instagram-publish-cron em 20260617120000.
--
-- Idempotente: unschedule antes de reagendar. Usa a forma de subselect de
-- vault.decrypted_secrets (NÃO a função vault.decrypted_secret(), que não
-- existe nesta instância) — ver nota em 20260617120000.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'report-worker-tick') THEN
    PERFORM cron.unschedule('report-worker-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'report-worker-tick',
  '* * * * *',
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
