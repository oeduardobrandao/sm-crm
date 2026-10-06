\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Agenda (20261005000001_agenda_eventos.sql §2): rule enumeration
-- (agenda_datas_regra), dtstart normalization, inicio/fim generation (DST),
-- materialization, regeneration after a rule change and the horizon generator.
-- Events are real rows inserted as service_role into a throwaway workspace;
-- "today" is pinned with app.agenda_hoje.

begin;

create or replace function pg_temp.datas(p_id bigint, p_de date, p_ate date) returns date[] language sql as $$
  select array_agg(d order by d) from public.agenda_datas_regra((select e from public.agenda_eventos e where e.id = p_id), p_de, p_ate) d;
$$;
create or replace function pg_temp.ev(p_id bigint) returns public.agenda_eventos language sql as $$
  select e from public.agenda_eventos e where e.id = p_id;
$$;
grant execute on all functions in schema pg_temp to service_role;

-- ============ block 1: date math (pure) ============
do $$
declare
  v_ws uuid;
  v_id bigint;
  v_ts timestamp;
  v_ini timestamptz; v_fim timestamptz;
  v_rejected boolean; v_msg text;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  v_ws := et_make_workspace('start');
  execute 'set local role service_role';

  -- agenda_hoje: GUC override, then the real clock in the given tz
  assert public.agenda_hoje('America/Sao_Paulo') = '2026-10-05', 'agenda_hoje ignored app.agenda_hoje';
  perform set_config('app.agenda_hoje', '', true);
  assert public.agenda_hoje('America/Sao_Paulo') = (now() at time zone 'America/Sao_Paulo')::date, 'agenda_hoje without override';
  perform set_config('app.agenda_hoje', '2026-10-05', true);

  -- 1. daily, intervalo 2
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, intervalo)
    values (v_ws, 'c1', '2026-10-05 09:00', 60, 'daily', 2) returning id into v_id;
  assert pg_temp.datas(v_id, '2026-10-05', '2026-10-12') = array['2026-10-05','2026-10-07','2026-10-09','2026-10-11']::date[],
    format('1 daily intervalo 2: %s', pg_temp.datas(v_id, '2026-10-05', '2026-10-12'));

  -- 2. weekly, intervalo 2, seg + qua, across the year boundary
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, intervalo, dias_semana)
    values (v_ws, 'c2', '2026-12-28 09:00', 60, 'weekly', 2, '{1,3}') returning id into v_id;
  assert pg_temp.datas(v_id, '2026-12-28', '2027-01-24') = array['2026-12-28','2026-12-30','2027-01-11','2027-01-13']::date[],
    format('2 weekly intervalo 2: %s', pg_temp.datas(v_id, '2026-12-28', '2027-01-24'));

  -- 3. monthly dia_mes on the 31st skips short months
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, mensal_modo)
    values (v_ws, 'c3', '2026-01-31 09:00', 60, 'monthly', 'dia_mes') returning id into v_id;
  assert pg_temp.datas(v_id, '2026-01-01', '2026-06-30') = array['2026-01-31','2026-03-31','2026-05-31']::date[],
    format('3 monthly dia 31: %s', pg_temp.datas(v_id, '2026-01-01', '2026-06-30'));

  -- 4. monthly, 2nd Tuesday
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, mensal_modo, mensal_ordinal)
    values (v_ws, 'c4', '2026-10-13 09:00', 60, 'monthly', 'dia_semana', 2) returning id into v_id;
  assert pg_temp.datas(v_id, '2026-10-01', '2026-12-31') = array['2026-10-13','2026-11-10','2026-12-08']::date[],
    format('4 monthly 2a terca: %s', pg_temp.datas(v_id, '2026-10-01', '2026-12-31'));

  -- 5. monthly, last Friday
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, mensal_modo, mensal_ordinal)
    values (v_ws, 'c5', '2026-10-30 09:00', 60, 'monthly', 'dia_semana', -1) returning id into v_id;
  assert pg_temp.datas(v_id, '2026-10-01', '2026-12-31') = array['2026-10-30','2026-11-27','2026-12-25']::date[],
    format('5 monthly ultima sexta: %s', pg_temp.datas(v_id, '2026-10-01', '2026-12-31'));

  -- 6. yearly on 29/02 only in leap years
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq)
    values (v_ws, 'c6', '2028-02-29 09:00', 60, 'yearly') returning id into v_id;
  assert pg_temp.datas(v_id, '2028-01-01', '2033-12-31') = array['2028-02-29','2032-02-29']::date[],
    format('6 yearly 29/02: %s', pg_temp.datas(v_id, '2028-01-01', '2033-12-31'));

  -- 7. ate is inclusive
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, ate)
    values (v_ws, 'c7', '2026-10-15 09:00', 60, 'daily', '2026-10-20') returning id into v_id;
  assert pg_temp.datas(v_id, '2026-10-15', '2026-10-31') =
    array['2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19','2026-10-20']::date[],
    format('7 ate: %s', pg_temp.datas(v_id, '2026-10-15', '2026-10-31'));

  -- 8. contagem counts from dtstart, not from p_de
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana, contagem)
    values (v_ws, 'c8', '2026-10-05 09:00', 60, 'weekly', '{1}', 3) returning id into v_id;
  assert pg_temp.datas(v_id, '2026-10-19', '2026-12-31') = array['2026-10-19']::date[],
    format('8 contagem: %s', pg_temp.datas(v_id, '2026-10-19', '2026-12-31'));

  -- 9. non-repeating
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min)
    values (v_ws, 'c9', '2026-10-05 09:00', 60) returning id into v_id;
  assert pg_temp.datas(v_id, '2026-10-01', '2026-10-31') = array['2026-10-05']::date[], '9 non-repeating in range';
  assert pg_temp.datas(v_id, '2026-11-01', '2026-11-30') is null, '9 non-repeating out of range';

  -- 10. agenda_normalizar_dtstart
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana)
    values (v_ws, 'c10', '2026-10-05 10:00', 60, 'weekly', '{2}') returning id into v_id;
  v_ts := public.agenda_normalizar_dtstart(pg_temp.ev(v_id));
  assert v_ts = '2026-10-06 10:00', format('10 normalizar: %s', v_ts);
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana, ate)
    values (v_ws, 'c10b', '2026-10-05 10:00', 60, 'weekly', '{2}', '2026-10-05') returning id into v_id;
  v_rejected := false; v_msg := null;
  begin
    v_ts := public.agenda_normalizar_dtstart(pg_temp.ev(v_id));
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, '10 normalizar accepted a rule that generates no date';
  assert v_msg = 'agenda: a repetição não gera nenhuma data', format('10 normalizar error: %s', v_msg);
  -- a rule whose contagem would cut before dtstart's own week still normalizes (contagem ignored)
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana, contagem)
    values (v_ws, 'c10c', '2026-10-05 10:00', 60, 'weekly', '{5}', 1) returning id into v_id;
  v_ts := public.agenda_normalizar_dtstart(pg_temp.ev(v_id));
  assert v_ts = '2026-10-09 10:00', format('10 normalizar with contagem: %s', v_ts);
  -- non-repeating: dtstart itself
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min)
    values (v_ws, 'c10d', '2026-10-05 10:30', 60) returning id into v_id;
  assert public.agenda_normalizar_dtstart(pg_temp.ev(v_id)) = '2026-10-05 10:30', '10 normalizar non-repeating';

  -- 11. agenda_inicio_fim timed
  insert into agenda_eventos (conta_id, titulo, tz, dtstart, duracao_min)
    values (v_ws, 'c11', 'America/Sao_Paulo', '2026-10-05 14:00', 120) returning id into v_id;
  select f.inicio, f.fim into v_ini, v_fim from public.agenda_inicio_fim(pg_temp.ev(v_id), '2026-10-05') f;
  assert v_ini = '2026-10-05 17:00+00', format('11 inicio: %s', v_ini);
  assert v_fim = '2026-10-05 19:00+00', format('11 fim: %s', v_fim);

  -- 12. all-day across the DST change keeps local midnights (25h day)
  insert into agenda_eventos (conta_id, titulo, tz, dia_inteiro, dtstart, duracao_dias)
    values (v_ws, 'c12', 'America/New_York', true, '2026-11-01 00:00', 1) returning id into v_id;
  select f.inicio, f.fim into v_ini, v_fim from public.agenda_inicio_fim(pg_temp.ev(v_id), '2026-11-01') f;
  assert v_fim - v_ini = interval '25 hours', format('12 all-day DST: %s', v_fim - v_ini);
  assert (v_ini at time zone 'America/New_York')::time = '00:00', '12 inicio not local midnight';
  assert (v_fim at time zone 'America/New_York')::time = '00:00', '12 fim not local midnight';

  execute 'reset role';
  raise notice 'PASS 99_agenda_datas_regra (date math)';
end $$;

-- ============ block 2: materialization, regeneration, generator ============
do $$
declare
  v_ws uuid;
  v_user uuid := gen_random_uuid();
  v_id bigint; v_cnt_id bigint; v_full bigint; v_behind bigint; v_done bigint;
  v_oc_alt bigint; v_oc_canc bigint; v_oc_seg bigint;
  v_n bigint; v_ret int;
  v_h date; v_c boolean;
  v_ini timestamptz;
begin
  perform set_config('app.agenda_hoje', '2026-10-05', true);
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  execute 'set local role service_role';

  -- 13. materialize to the 24-month horizon (p_ate beyond it is clamped)
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana)
    values (v_ws, 'm1', '2026-10-05 10:00', 60, 'weekly', '{1}') returning id into v_id;
  perform public.agenda_materializar(v_id, '2099-01-01');
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_id;
  assert v_n = 105, format('13 weekly rows: %s', v_n);
  select horizonte_ate, materializacao_completa into v_h, v_c from agenda_eventos where id = v_id;
  assert v_h = '2028-10-05', format('13 horizonte_ate: %s', v_h);
  assert not v_c, '13 open series marked complete';
  select inicio into v_ini from agenda_ocorrencias where evento_id = v_id and data_original = '2026-10-05';
  assert v_ini = '2026-10-05 13:00+00', format('13 first inicio: %s', v_ini);
  perform 1 from agenda_ocorrencias where evento_id = v_id and conta_id <> v_ws;
  assert not found, '13 occurrence with a foreign conta_id';
  perform public.agenda_materializar(v_id, '2099-01-01');
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_id;
  assert v_n = 105, format('13 second run inserted rows: %s', v_n);

  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana, contagem)
    values (v_ws, 'm2', '2026-10-05 10:00', 60, 'weekly', '{1}', 3) returning id into v_cnt_id;
  perform public.agenda_materializar(v_cnt_id, '2099-01-01');
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_cnt_id;
  assert v_n = 3, format('13 contagem rows: %s', v_n);
  select materializacao_completa into v_c from agenda_eventos where id = v_cnt_id;
  assert v_c, '13 contagem series not complete';

  -- a non-repeating event is complete after one row
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min)
    values (v_ws, 'm3', '2026-10-07 10:00', 30) returning id into v_full;
  perform public.agenda_materializar(v_full, '2099-01-01');
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_full;
  select materializacao_completa into v_c from agenda_eventos where id = v_full;
  assert v_n = 1 and v_c, format('13 non-repeating: rows %s complete %s', v_n, v_c);

  -- 14. agenda_regenerar: {1,3} -> {3}
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, dias_semana)
    values (v_ws, 'r1', '2026-10-05 10:00', 60, 'weekly', '{1,3}') returning id into v_id;
  insert into agenda_participantes (evento_id, conta_id, user_id, resposta) values (v_id, v_ws, v_user, 'sim');
  perform public.agenda_materializar(v_id, '2099-01-01');
  update agenda_ocorrencias set inicio = '2026-10-07 18:00+00', fim = '2026-10-07 19:00+00', horario_alterado = true
    where evento_id = v_id and data_original = '2026-10-07' returning id into v_oc_alt;
  update agenda_ocorrencias set cancelada = true
    where evento_id = v_id and data_original = '2026-10-14' returning id into v_oc_canc;
  select id into v_oc_seg from agenda_ocorrencias where evento_id = v_id and data_original = '2026-10-12';
  insert into agenda_respostas (ocorrencia_id, conta_id, user_id, resposta) values (v_oc_seg, v_ws, v_user, 'nao');

  update agenda_eventos set dias_semana = '{3}', dtstart = '2026-10-05 11:00' where id = v_id;
  perform public.agenda_regenerar(v_id, false);
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_id and extract(dow from data_original) = 1;
  assert v_n = 0, format('14 Monday rows left: %s', v_n);
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_id;
  assert v_n = 105, format('14 Wednesday rows: %s', v_n);  -- Wednesdays 2026-10-07 .. 2028-10-04
  perform 1 from agenda_respostas where ocorrencia_id = v_oc_seg;
  assert not found, '14 RSVP of a removed occurrence survived';
  select inicio into v_ini from agenda_ocorrencias where id = v_oc_alt;
  assert v_ini = '2026-10-07 18:00+00', format('14 altered occurrence moved to %s', v_ini);
  perform 1 from agenda_ocorrencias where id = v_oc_canc and cancelada;
  assert found, '14 tombstone on a surviving date was lost';
  select inicio into v_ini from agenda_ocorrencias where evento_id = v_id and data_original = '2026-10-21';
  assert v_ini = '2026-10-21 14:00+00', format('14 unaltered occurrence not recalculated: %s', v_ini);
  select horizonte_ate into v_h from agenda_eventos where id = v_id;
  assert v_h = '2028-10-05', format('14 horizonte_ate: %s', v_h);

  perform public.agenda_regenerar(v_id, true);
  select inicio into v_ini from agenda_ocorrencias where id = v_oc_alt;
  assert v_ini = '2026-10-07 14:00+00', format('14 reset: altered occurrence not recalculated (%s)', v_ini);
  perform 1 from agenda_ocorrencias where id = v_oc_alt and not horario_alterado;
  assert found, '14 reset: horario_alterado not cleared';
  perform 1 from agenda_ocorrencias where id = v_oc_canc and cancelada;
  assert found, '14 reset: tombstone lost';

  -- a regenerated rule that now ends (contagem) trims and completes
  update agenda_eventos set contagem = 2 where id = v_id;
  perform public.agenda_regenerar(v_id, false);
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_id;
  select materializacao_completa into v_c from agenda_eventos where id = v_id;
  assert v_n = 2 and v_c, format('14 contagem 2: rows %s complete %s', v_n, v_c);

  -- 15. agenda_gerar_horizonte: flush first, then one series behind, one complete
  perform public.agenda_gerar_horizonte();
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq)
    values (v_ws, 'g1', '2026-10-05 08:00', 30, 'daily') returning id into v_behind;
  insert into agenda_eventos (conta_id, titulo, dtstart, duracao_min, freq, contagem)
    values (v_ws, 'g2', '2026-10-05 08:00', 30, 'daily', 2) returning id into v_done;
  perform public.agenda_materializar(v_behind, '2026-12-31');
  perform public.agenda_materializar(v_done, '2099-01-01');
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_behind;
  assert v_n = 88, format('15 partial materialization: %s', v_n);
  update agenda_eventos set horizonte_ate = '2026-10-06' where id = v_done;  -- behind, but complete

  v_ret := public.agenda_gerar_horizonte();
  assert v_ret = 1, format('15 generator touched %s series, expected 1', v_ret);
  select horizonte_ate into v_h from agenda_eventos where id = v_behind;
  assert v_h = '2028-10-05', format('15 horizonte_ate after generator: %s', v_h);
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_behind;
  assert v_n = 732, format('15 daily rows after generator: %s', v_n);
  select horizonte_ate into v_h from agenda_eventos where id = v_done;
  assert v_h = '2026-10-06', '15 generator touched a complete series';
  v_ret := public.agenda_gerar_horizonte();
  assert v_ret = 0, format('15 second run touched %s series', v_ret);

  -- the horizon moves with today
  perform set_config('app.agenda_hoje', '2026-10-12', true);
  v_ret := public.agenda_gerar_horizonte();
  assert v_ret >= 1, '15 generator did not extend after today advanced';
  select count(*) into v_n from agenda_ocorrencias where evento_id = v_behind;
  assert v_n = 739, format('15 daily rows after a week: %s', v_n);

  execute 'reset role';

  -- grants: internal DEFINER functions are service_role only
  assert has_function_privilege('authenticated', 'public.agenda_materializar(bigint, date)', 'EXECUTE') = false, 'authenticated executes agenda_materializar';
  assert has_function_privilege('authenticated', 'public.agenda_regenerar(bigint, boolean)', 'EXECUTE') = false, 'authenticated executes agenda_regenerar';
  assert has_function_privilege('authenticated', 'public.agenda_gerar_horizonte()', 'EXECUTE') = false, 'authenticated executes agenda_gerar_horizonte';
  perform 1 from cron.job where jobname = 'agenda-horizonte' and schedule = '23 4 * * *';
  assert found, 'cron agenda-horizonte not scheduled at 23 4 * * *';

  raise notice 'PASS 99_agenda_datas_regra (materialization)';
end $$;

rollback;
