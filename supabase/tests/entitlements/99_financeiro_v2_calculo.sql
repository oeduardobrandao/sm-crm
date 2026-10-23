\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Financeiro v2 calculation (20261025000003_financeiro_v2_calculo.sql).
-- Section 1: period helpers (financeiro_periodo_fim / _inicio_de / _rotulo / _fator).
-- Later sections (allocation core) are appended below by the following tasks.

begin;

do $$
begin
  assert public.financeiro_periodo_fim('2026-10-01', 1) = date '2026-11-01', 'fim: day 1 full month';
  assert public.financeiro_periodo_fim('2026-10-15', 15) = date '2026-11-15', 'fim: day 15 full month';
  assert public.financeiro_periodo_fim('2026-02-28', 28) = date '2026-03-28', 'fim: feb 28';
  assert public.financeiro_periodo_fim('2026-11-01', 15) = date '2026-11-15', 'fim: transition';
  assert public.financeiro_periodo_fim('2026-12-20', 15) = date '2027-01-15', 'fim: year rollover';
  raise notice 'PASS periodo_fim';
end $$;

do $$
begin
  assert public.financeiro_periodo_inicio_de('2026-10-10', 15) = date '2026-09-15', 'inicio_de: before day';
  assert public.financeiro_periodo_inicio_de('2026-10-15', 15) = date '2026-10-15', 'inicio_de: on day';
  assert public.financeiro_periodo_inicio_de('2026-10-20', 15) = date '2026-10-15', 'inicio_de: after day';
  assert public.financeiro_periodo_inicio_de('2026-01-10', 15) = date '2025-12-15', 'inicio_de: year rollback';
  assert public.financeiro_periodo_inicio_de('2026-10-17', 1) = date '2026-10-01', 'inicio_de: day 1';
  raise notice 'PASS periodo_inicio_de';
end $$;

do $$
begin
  assert public.financeiro_periodo_rotulo('2026-10-01', '2026-11-01') = 'out 2026', 'rotulo: full calendar month';
  assert public.financeiro_periodo_rotulo('2026-10-15', '2026-11-15') = '15 out a 14 nov', 'rotulo: mid-month period';
  assert public.financeiro_periodo_rotulo('2026-11-01', '2026-11-15') = '1 nov a 14 nov', 'rotulo: transition period';
  assert public.financeiro_periodo_rotulo('2026-12-15', '2027-01-15') = '15 dez 2026 a 14 jan 2027', 'rotulo: across years';
  assert public.financeiro_periodo_rotulo('2026-01-01', '2026-02-01') = 'jan 2026', 'rotulo: jan';
  assert public.financeiro_periodo_rotulo('2026-03-01', '2026-04-01') = 'mar 2026', 'rotulo: mar';
  assert public.financeiro_periodo_rotulo('2026-12-01', '2027-01-01') = 'dez 2026', 'rotulo: dez';
  raise notice 'PASS periodo_rotulo';
end $$;

do $$
begin
  assert public.financeiro_periodo_fator('2026-10-01', '2026-11-01') = 1, 'fator: full period is 1';
  assert public.financeiro_periodo_fator('2026-10-15', '2026-11-15') = 1, 'fator: full mid-month period is 1';
  assert round(public.financeiro_periodo_fator('2026-11-01', '2026-11-15'), 4) = round(14 / 30.0, 4), 'fator: transition pro-rata';
  assert round(public.financeiro_periodo_fator('2026-02-01', '2026-02-15'), 4) = round(14 / 28.0, 4), 'fator: february';
  raise notice 'PASS periodo_fator';
end $$;

do $$
begin
  assert not has_function_privilege('anon', 'public.financeiro_periodo_fim(date,int)', 'execute'), 'anon cannot execute fim';
  assert not has_function_privilege('public', 'public.financeiro_periodo_fim(date,int)', 'execute'), 'PUBLIC cannot execute fim';
  assert has_function_privilege('authenticated', 'public.financeiro_periodo_fim(date,int)', 'execute'), 'authenticated executes fim';
  assert has_function_privilege('service_role', 'public.financeiro_periodo_rotulo(date,date)', 'execute'), 'service_role executes rotulo';
  raise notice 'PASS periodo_grants';
end $$;

rollback;
