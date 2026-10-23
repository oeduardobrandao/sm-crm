SET LOCAL lock_timeout = '5s';

-- Financeiro v2: calculation layer.
-- Section 1 (this block): period helpers. Pure IMMUTABLE date functions, no auth
-- and no table access, so they are not SECURITY DEFINER. p_dia is always 1..28
-- (the config CHECK guarantees it), so there is no missing day 29..31 to handle.
-- Section 2 (allocation core) is appended by a later task.

-- ===========================================================================
-- Section 1: period helpers
-- ===========================================================================

-- End (exclusive) of the period starting at p_inicio: one month later when the
-- start already sits on p_dia, otherwise the first date after p_inicio on p_dia
-- (the transition period when periodo_dia changes).
CREATE OR REPLACE FUNCTION public.financeiro_periodo_fim(p_inicio date, p_dia int)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN extract(day FROM p_inicio)::int = p_dia
      THEN (p_inicio + interval '1 month')::date
    WHEN make_date(extract(year FROM p_inicio)::int, extract(month FROM p_inicio)::int, p_dia) > p_inicio
      THEN make_date(extract(year FROM p_inicio)::int, extract(month FROM p_inicio)::int, p_dia)
    ELSE (make_date(extract(year FROM p_inicio)::int, extract(month FROM p_inicio)::int, p_dia)
          + interval '1 month')::date
  END;
$$;

-- Start of the period containing p_data: the latest date <= p_data on p_dia.
CREATE OR REPLACE FUNCTION public.financeiro_periodo_inicio_de(p_data date, p_dia int)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN make_date(extract(year FROM p_data)::int, extract(month FROM p_data)::int, p_dia) <= p_data
      THEN make_date(extract(year FROM p_data)::int, extract(month FROM p_data)::int, p_dia)
    ELSE (make_date(extract(year FROM p_data)::int, extract(month FROM p_data)::int, p_dia)
          - interval '1 month')::date
  END;
$$;

-- Label: 'out 2026' for a full calendar month, else '15 out a 14 nov'; the year
-- goes on both sides only when the first and last day fall in different years.
-- Explicit month array on purpose: to_char(..., 'TMmon') depends on the server locale.
CREATE OR REPLACE FUNCTION public.financeiro_periodo_rotulo(p_inicio date, p_fim date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH m AS (
    SELECT ARRAY['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'] AS nomes
  ), u AS (
    SELECT p_fim - 1 AS ultimo
  )
  SELECT CASE
    WHEN extract(day FROM p_inicio)::int = 1 AND p_fim = (p_inicio + interval '1 month')::date
      THEN m.nomes[extract(month FROM p_inicio)::int] || ' ' || extract(year FROM p_inicio)::int
    WHEN extract(year FROM p_inicio) <> extract(year FROM u.ultimo)
      THEN extract(day FROM p_inicio)::int || ' ' || m.nomes[extract(month FROM p_inicio)::int]
           || ' ' || extract(year FROM p_inicio)::int
           || ' a ' ||
           extract(day FROM u.ultimo)::int || ' ' || m.nomes[extract(month FROM u.ultimo)::int]
           || ' ' || extract(year FROM u.ultimo)::int
    ELSE extract(day FROM p_inicio)::int || ' ' || m.nomes[extract(month FROM p_inicio)::int]
         || ' a ' ||
         extract(day FROM u.ultimo)::int || ' ' || m.nomes[extract(month FROM u.ultimo)::int]
  END
  FROM m, u;
$$;

-- Pro-rata factor: days in the period / days in the month starting at p_inicio.
-- 1 for a full period.
CREATE OR REPLACE FUNCTION public.financeiro_periodo_fator(p_inicio date, p_fim date)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT (p_fim - p_inicio)::numeric
       / ((p_inicio + interval '1 month')::date - p_inicio)::numeric;
$$;

REVOKE ALL ON FUNCTION public.financeiro_periodo_fim(date, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodo_inicio_de(date, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodo_rotulo(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_periodo_fator(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_fim(date, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_inicio_de(date, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_rotulo(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.financeiro_periodo_fator(date, date) TO authenticated, service_role;
