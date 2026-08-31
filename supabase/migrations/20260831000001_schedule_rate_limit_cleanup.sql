-- cleanup_rate_limit_log() existe desde 20260417000004 mas nunca foi agendada:
-- rate_limit_log crescia sem poda. Janela máxima de limite em uso é 1h, e a
-- função apaga só linhas com mais de 1h — a poda nunca interfere numa contagem.
-- Idempotente: safe to apply twice.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate-limit-cleanup') THEN
    PERFORM cron.unschedule('rate-limit-cleanup');
  END IF;
END $$;

SELECT cron.schedule('rate-limit-cleanup', '15 * * * *', $$SELECT cleanup_rate_limit_log()$$);
