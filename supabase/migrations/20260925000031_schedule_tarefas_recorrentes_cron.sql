-- Hourly generation of calendario occurrences (spec: "Schedule"). Hourly, not
-- daily: idempotent, partial-index scan, bounds the wait after a failed run
-- to 1h, and today's occurrence appears on the first run after midnight in
-- Sao Paulo (00:07). Pattern of 20260831000001_schedule_rate_limit_cleanup.
-- No cron-health registration exists or is needed: a failed run shows up in
-- cron.job_run_details and recent_cron_failures() alerts on it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tarefas-recorrentes-generate') THEN
    PERFORM cron.unschedule('tarefas-recorrentes-generate');
  END IF;
END $$;

SELECT cron.schedule('tarefas-recorrentes-generate', '7 * * * *', $$SELECT public.generate_recurring_tarefas()$$);

-- Rollback (run by hand, in this order, so the job never calls a dropped object):
--   SELECT cron.unschedule('tarefas-recorrentes-generate');
--   DROP TRIGGER tarefas_serie_ao_concluir ON tarefas; DROP TRIGGER tarefas_serie_ao_excluir ON tarefas;
--   DROP TRIGGER tarefas_serie_id_guard ON tarefas;
--   DROP TRIGGER tarefa_series_guard ON tarefa_series; DROP TRIGGER tarefa_series_apos_retomar ON tarefa_series;
--   DROP TRIGGER set_tarefa_series_updated_at ON tarefa_series;
--   DROP FUNCTION tarefa_serie_criar(jsonb, jsonb, bigint[], text[], bigint), tarefa_serie_aplicar_edicao(bigint, jsonb, bigint[], jsonb, boolean),
--     tarefa_serie_definir_estado(bigint, text), tarefa_serie_excluir(bigint), generate_recurring_tarefas(),
--     tarefa_serie_garantir_aberta(bigint, date), tarefa_serie_materializar(bigint, date), tarefa_serie_validar_refs(uuid, bigint, bigint),
--     tarefas_serie_ao_concluir_fn(), tarefas_serie_ao_excluir_fn(), tarefa_series_apos_retomar_fn(), tarefas_serie_id_guard(),
--     tarefa_series_guard(), set_tarefa_series_updated_at(), tarefa_serie_subtarefas_validas(jsonb), tarefa_serie_dias_semana_validos(int[]),
--     tarefa_serie_jsonb_int_array(jsonb), tarefa_next_date(text, int, int[], int, int, date, date),
--     tarefa_prev_date(text, int, int[], int, int, date, date), tarefa_month_landing(int, int), tarefa_hoje_sp();
--   ALTER TABLE tarefas DROP CONSTRAINT tarefas_serie_data_uq, DROP CONSTRAINT tarefas_serie_exige_prazo, DROP COLUMN serie_id;
--   (recreate tarefas_tenant_all without the serie_id EXISTS: copy the policy text from 20260730000005_tarefas.sql)
--   DROP TABLE tarefa_series;
--   Then revert the frontend merge.
