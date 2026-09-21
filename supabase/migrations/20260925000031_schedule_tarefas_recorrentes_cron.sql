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

-- Rollback (run by hand, in this order: the job never calls a dropped object,
-- and no object is dropped while another still depends on it):
--   1. SELECT cron.unschedule('tarefas-recorrentes-generate');
--   2. Triggers (before their functions):
--      DROP TRIGGER tarefas_serie_ao_concluir ON tarefas; DROP TRIGGER tarefas_serie_ao_excluir ON tarefas;
--      DROP TRIGGER tarefas_serie_id_guard ON tarefas;
--      DROP TRIGGER tarefa_series_guard ON tarefa_series; DROP TRIGGER tarefa_series_apos_retomar ON tarefa_series;
--      DROP TRIGGER set_tarefa_series_updated_at ON tarefa_series;
--   3. RPCs, generator, helpers and trigger functions (none is referenced by a table object):
--      DROP FUNCTION tarefa_serie_criar(jsonb, jsonb, bigint[], text[], bigint),
--        tarefa_serie_aplicar_edicao(bigint, jsonb, bigint[], jsonb, boolean),
--        tarefa_serie_definir_estado(bigint, text), tarefa_serie_excluir(bigint), generate_recurring_tarefas(),
--        tarefa_serie_garantir_aberta(bigint, date), tarefa_serie_materializar(bigint, date),
--        tarefa_serie_validar_refs(uuid, bigint, bigint), tarefa_serie_parse_dias_semana(jsonb),
--        tarefas_serie_ao_concluir_fn(), tarefas_serie_ao_excluir_fn(), tarefa_series_apos_retomar_fn(),
--        tarefas_serie_id_guard(), tarefa_series_guard(), set_tarefa_series_updated_at();
--   4. Recreate tarefas_tenant_all WITHOUT the serie_id EXISTS (it depends on tarefas.serie_id, so it
--      must go before the column): DROP POLICY tarefas_tenant_all ON tarefas; then CREATE POLICY with the
--      text of 20260730000005_tarefas.sql (no other migration redefines it).
--   5. ALTER TABLE tarefas DROP CONSTRAINT tarefas_serie_data_uq, DROP CONSTRAINT tarefas_serie_exige_prazo, DROP COLUMN serie_id;
--      (the column drop also removes the FK and tarefas_serie_idx)
--   6. DROP TABLE tarefa_series;   (its CHECK constraints reference the validators below, so it goes first)
--   7. Validators and pure date functions (the CHECKs are gone now):
--      DROP FUNCTION tarefa_serie_subtarefas_validas(jsonb), tarefa_serie_dias_semana_validos(int[]),
--        tarefa_serie_jsonb_int_array(jsonb), tarefa_next_date(text, int, int[], int, int, date, date),
--        tarefa_prev_date(text, int, int[], int, int, date, date), tarefa_month_landing(int, int), tarefa_hoje_sp();
--   8. Revert the frontend merge.
