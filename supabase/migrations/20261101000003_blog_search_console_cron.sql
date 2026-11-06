-- Agenda o blog-search-console-cron (spec 2026-10-27-blog-metrics-design.md, secao 4).
--
-- DEPLOY A FUNCTION ANTES DE APLICAR ESTA MIGRATION:
--   npx supabase functions deploy blog-search-console-cron --no-verify-jwt
-- Agendado antes do deploy, o pg_cron bate numa funcao inexistente todo dia. Sem
-- GSC_SERVICE_ACCOUNT_JSON a funcao so registra e responde 200, entao o agendamento e seguro
-- mesmo antes da chave ser configurada.
--
-- Todo dia as 07:38 UTC (04:38 em Sao Paulo). Minuto 38 da hora 7 nao tem nenhum outro job em
-- cron.schedule nas migrations (conferido contra 20260925110001_stagger_cron_schedules.sql e as
-- posteriores). O Search Console fecha o dia anterior (fuso do Pacifico) de madrugada em UTC, entao
-- a esta hora "ontem" ja esta fechado. Idempotente.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'blog-search-console-cron') then
    perform cron.unschedule('blog-search-console-cron');
  end if;
end $$;

select cron.schedule(
  'blog-search-console-cron',
  '38 7 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/blog-search-console-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
