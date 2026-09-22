\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Closed-form date math for tarefa_series. Cases 1 to 20 mirror the table in
-- docs/superpowers/specs/2026-09-21-tarefas-recorrentes-design.md; 21 to 25 are
-- long-history rules (case 21 also carries a coarse timing guard against a
-- regression to a stepping search); 26 to 28 cover tarefa_prev_date; 29 to 33
-- pin floor division and landing-day edge cases. Also asserts the pure date
-- functions stay executable by anon/authenticated (they are IMMUTABLE helpers
-- called inside CHECKs / RLS-time paths, not tenant-data readers).

begin;

do $$
declare
  v_raised boolean;
  v_t0 timestamptz;
  v_ms numeric;
  v_hoje date;
  v_fn text;
begin
  -- tarefa_hoje_sp: honours the transaction-local override, else Sao Paulo today.
  perform set_config('app.tarefa_hoje', '2026-01-27', true);
  assert public.tarefa_hoje_sp() = date '2026-01-27', 'hoje_sp: override ignored';
  perform set_config('app.tarefa_hoje', '', true);
  v_hoje := public.tarefa_hoje_sp();
  assert v_hoje = (now() at time zone 'America/Sao_Paulo')::date, 'hoje_sp: default is not Sao Paulo today';

  -- daily
  assert public.tarefa_next_date('daily', 1, null, null, null, '2026-01-01', '2026-01-01') = '2026-01-02', 'case 1';
  assert public.tarefa_next_date('daily', 3, null, null, null, '2026-01-01', '2026-01-02') = '2026-01-04', 'case 2';
  assert public.tarefa_next_date('daily', 3, null, null, null, '2026-01-01', '2026-01-04') = '2026-01-07', 'case 3';
  -- weekly (0 = Sunday ... 6 = Saturday)
  assert public.tarefa_next_date('weekly', 1, '{1}', null, null, '2026-01-05', '2026-01-05') = '2026-01-12', 'case 4';
  assert public.tarefa_next_date('weekly', 1, '{1,3}', null, null, '2026-01-05', '2026-01-05') = '2026-01-07', 'case 5';
  assert public.tarefa_next_date('weekly', 2, '{1,3}', null, null, '2026-01-05', '2026-01-07') = '2026-01-19', 'case 6';
  assert public.tarefa_next_date('weekly', 1, '{0}', null, null, '2026-01-05', '2026-01-05') = '2026-01-11', 'case 7';
  assert public.tarefa_next_date('weekly', 2, '{1}', null, null, '2026-01-07', '2026-01-07') = '2026-01-19', 'case 8';
  -- monthly
  assert public.tarefa_next_date('monthly', 1, null, 31, null, '2026-01-31', '2026-01-31') = '2026-02-28', 'case 9';
  assert public.tarefa_next_date('monthly', 1, null, 31, null, '2026-01-31', '2026-02-28') = '2026-03-31', 'case 10';
  assert public.tarefa_next_date('monthly', 3, null, 15, null, '2026-01-15', '2026-02-01') = '2026-04-15', 'case 11';
  assert public.tarefa_next_date('monthly', 1, null, 30, null, '2028-01-30', '2028-01-30') = '2028-02-29', 'case 12';
  -- yearly (mes, dia_mes)
  assert public.tarefa_next_date('yearly', 1, null, 29, 2, '2024-02-29', '2024-02-29') = '2025-02-28', 'case 13';
  assert public.tarefa_next_date('yearly', 1, null, 29, 2, '2024-02-29', '2027-02-28') = '2028-02-29', 'case 14';
  assert public.tarefa_next_date('yearly', 2, null, 10, 3, '2026-03-10', '2026-03-10') = '2028-03-10', 'case 15';
  -- after before inicio
  assert public.tarefa_next_date('daily', 1, null, null, null, '2026-01-10', '2026-01-01') = '2026-01-10', 'case 16';
  assert public.tarefa_next_date('weekly', 1, '{1}', null, null, '2026-01-07', '2026-01-01') = '2026-01-12', 'case 17';
  -- invalid freq raises
  v_raised := false;
  begin
    perform public.tarefa_next_date('hourly', 1, null, null, null, '2026-01-01', '2026-01-01');
  exception when others then v_raised := true; end;
  assert v_raised, 'case 18: freq hourly did not raise';
  -- re-anchoring on a clamped date keeps the landing day
  assert public.tarefa_next_date('monthly', 1, null, 31, null, '2026-02-28', '2026-02-28') = '2026-03-31', 'case 19';
  assert public.tarefa_next_date('yearly', 1, null, 29, 2, '2027-02-28', '2027-02-28') = '2028-02-29', 'case 20';
  -- old series: closed form, no stepping
  -- inicio 1900 = ~46k days behind: a stepping search takes far longer than the
  -- generous ceiling, the closed form is microseconds; the ceiling is loose on
  -- purpose (a loaded CI runner must not flake this).
  v_t0 := clock_timestamp();
  assert public.tarefa_next_date('daily', 1, null, null, null, '1900-01-01', '2026-09-21') = '2026-09-22', 'case 21';
  v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
  assert v_ms < 100, format('case 21: took %s ms (stepping search?)', v_ms);
  assert public.tarefa_next_date('daily', 3, null, null, null, '2015-01-01', '2026-09-21') = '2026-09-24', 'case 22';
  assert public.tarefa_next_date('weekly', 2, '{1}', null, null, '2021-09-20', '2026-09-21') = '2026-09-28', 'case 23';
  assert public.tarefa_next_date('monthly', 1, null, 31, null, '2018-01-31', '2026-09-21') = '2026-09-30', 'case 24';
  assert public.tarefa_next_date('yearly', 1, null, 29, 2, '2000-02-29', '2026-09-21') = '2027-02-28', 'case 25';
  -- prev_date sibling
  assert public.tarefa_prev_date('daily', 3, null, null, null, '2015-01-01', '2026-09-22') = '2026-09-21', 'case 26';
  assert public.tarefa_prev_date('weekly', 1, '{1,3}', null, null, '2026-01-05', '2026-01-06') = '2026-01-05', 'case 27';
  assert public.tarefa_prev_date('monthly', 1, null, 31, null, '2026-01-31', '2026-01-30') is null, 'case 28';
  -- prev_date extras the generator relies on
  assert public.tarefa_prev_date('weekly', 2, '{1}', null, null, '2026-01-05', '2026-01-25') = '2026-01-19', 'prev weekly interval';
  assert public.tarefa_prev_date('yearly', 1, null, 29, 2, '2024-02-29', '2026-09-21') = '2026-02-28', 'prev yearly clamp';
  assert public.tarefa_prev_date('daily', 1, null, null, null, '2026-01-10', '2026-01-09') is null, 'prev before inicio';
  -- floor division (SQL integer division truncates toward zero: (-1)/3 = 0 would return inicio + 3)
  assert public.tarefa_next_date('daily', 3, null, null, null, '2026-01-10', '2026-01-01') = '2026-01-10', 'case 29';
  assert public.tarefa_next_date('daily', 3, null, null, null, '2026-01-10', '2026-01-09') = '2026-01-10', 'case 30';
  assert public.tarefa_prev_date('daily', 3, null, null, null, '2026-01-10', '2026-01-12') = '2026-01-10', 'case 31';
  -- landing day before the anchor day in the first period: candidate 2
  assert public.tarefa_next_date('monthly', 1, null, 15, null, '2026-01-20', '2026-01-01') = '2026-02-15', 'case 32';
  assert public.tarefa_next_date('yearly', 1, null, 10, 3, '2026-06-20', '2026-01-01') = '2027-03-10', 'case 33';

  -- the pure date functions keep the default PUBLIC EXECUTE (never revoked)
  foreach v_fn in array array[
    'public.tarefa_hoje_sp()',
    'public.tarefa_month_landing(int, int)',
    'public.tarefa_next_date(text, int, int[], int, int, date, date)',
    'public.tarefa_prev_date(text, int, int[], int, int, date, date)'
  ] loop
    assert has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon lost EXECUTE on %s', v_fn);
    assert has_function_privilege('authenticated', v_fn, 'EXECUTE'), format('authenticated lost EXECUTE on %s', v_fn);
  end loop;

  raise notice 'PASS 99_tarefa_next_date (33 cases + prev extras)';
end $$;

rollback;
