\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Migration B owns the COMPLETE policy set on transacoes/contratos.
--
-- WHY THIS SUITE EXISTS. Migration B first failed against production on
-- 2026-07-28, in its own post-condition: it expected 8 policies and found 6.
-- Production had never actually run `20260315_rls_security_audit.sql` despite
-- that version being recorded in schema_migrations, so transacoes/contratos
-- were still governed by four hand-created FOR ALL policies that exist in no
-- migration:
--
--   "Users can CRUD own transacoes" / "Users can CRUD own contratos"
--   "Usuários podem gerenciar transações da sua conta" / "...contratos..."
--
-- Permissive policies are OR'd. Left in place, they would have granted a
-- restricted admin full read and write on every financial row, while
-- can_see_financials() sat alongside them evaluating correctly and changing
-- nothing. The feature would have looked deployed and enforced nothing.
--
-- Nothing in the previous suites could catch that: they all run against a
-- migrations-built database, which never has the legacy policies. This suite
-- covers both directions -- the invariant on the built schema, and the sweep's
-- behaviour against a reproduction of production's real starting state.

-- =============================================================
-- 1. Invariant on the built schema: exactly the eight owned policies, and
--    every one carries BOTH conjuncts.
--
--    qual and with_check are checked SEPARATELY, never via coalesce(). An
--    UPDATE policy has both; coalesce() reads only qual, so a WITH CHECK that
--    lost the tenant conjunct -- the cross-tenant WRITE hole -- passes a
--    coalesce()-based check unnoticed. Verified: the coalesce form misses
--    exactly that case.
-- =============================================================
do $$
declare
  v_stray text;
  v_n     int;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename in ('transacoes', 'contratos');
  if coalesce(v_n, -1) <> 8 then
    raise exception 'expected 8 policies on transacoes/contratos, found %',
      coalesce(v_n::text, 'NULL');
  end if;

  select string_agg(format('%s.%s', tablename, policyname), ', ' order by policyname)
    into v_stray
    from pg_policies
   where schemaname = 'public' and tablename in ('transacoes', 'contratos')
     and policyname not in (
           'transacoes_select', 'transacoes_insert',
           'transacoes_update', 'transacoes_delete',
           'contratos_select',  'contratos_insert',
           'contratos_update',  'contratos_delete');
  if v_stray is not null then
    raise exception 'unowned policy on transacoes/contratos: %', v_stray;
  end if;

  select string_agg(format('%s.%s', tablename, policyname), ', ' order by policyname)
    into v_stray
    from pg_policies
   where schemaname = 'public' and tablename in ('transacoes', 'contratos')
     and (   (qual       is not null and qual       not like '%get_my_conta_id%')
          or (with_check is not null and with_check not like '%get_my_conta_id%'));
  if v_stray is not null then
    raise exception 'policy lost its get_my_conta_id tenant conjunct: %', v_stray;
  end if;

  select string_agg(format('%s.%s', tablename, policyname), ', ' order by policyname)
    into v_stray
    from pg_policies
   where schemaname = 'public' and tablename in ('transacoes', 'contratos')
     and (   (qual       is not null and qual       not like '%can_see_financials%')
          or (with_check is not null and with_check not like '%can_see_financials%'));
  if v_stray is not null then
    raise exception 'policy lost its can_see_financials capability conjunct: %', v_stray;
  end if;
end $$;

-- =============================================================
-- 2. The sweep converges production's real starting state.
--
--    Reproduces production: the four legacy FOR ALL policies plus the two
--    _select policies from 20260404, and NO _insert/_update/_delete at all.
--    Then re-runs the actual migration file -- not a copy of its logic -- and
--    asserts it lands on the owned eight.
--
--    The legacy policy BODIES are simplified here on purpose. Production's use
--    public.get_user_conta_id(), a function that exists in production but in no
--    migration and no application code, so it is absent locally. The sweep
--    selects on ownership of the NAME, never on the body, so the body is
--    irrelevant to what is being tested. The names are reproduced exactly,
--    accents included -- name-independence is precisely the property under
--    test, since dropping by hand-transcribed literal is what this avoids.
-- =============================================================
begin;

drop policy transacoes_select on public.transacoes;
drop policy transacoes_insert on public.transacoes;
drop policy transacoes_update on public.transacoes;
drop policy transacoes_delete on public.transacoes;
drop policy contratos_select  on public.contratos;
drop policy contratos_insert  on public.contratos;
drop policy contratos_update  on public.contratos;
drop policy contratos_delete  on public.contratos;

create policy "Users can CRUD own transacoes" on public.transacoes
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can CRUD own contratos" on public.contratos
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Usuários podem gerenciar transações da sua conta" on public.transacoes
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Usuários podem gerenciar contratos da sua conta" on public.contratos
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transacoes_select" on public.transacoes for select
  using (conta_id in (select public.get_my_conta_id()));
create policy "contratos_select" on public.contratos for select
  using (conta_id in (select public.get_my_conta_id()));

-- Guard the reproduction itself. If this count is ever not 4, the block below
-- would "pass" while sweeping nothing, and the suite would assert nothing.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename in ('transacoes', 'contratos')
     and policyname not in (
           'transacoes_select', 'transacoes_insert',
           'transacoes_update', 'transacoes_delete',
           'contratos_select',  'contratos_insert',
           'contratos_update',  'contratos_delete');
  if coalesce(v_n, -1) <> 4 then
    raise exception 'reproduction is wrong: expected 4 unowned policies, found %',
      coalesce(v_n::text, 'NULL');
  end if;
end $$;

\i supabase/migrations/20260728000002_financial_visibility_b_enforcement.sql

-- The migration's own post-conditions have already run by this point and would
-- have aborted the suite on failure. Re-asserting the count here would be
-- redundant; what is NOT redundant is that the four legacy policies are gone,
-- which is the property the production failure was about.
do $$
declare v_stray text;
begin
  select string_agg(format('%s.%s', tablename, policyname), ', ' order by policyname)
    into v_stray
    from pg_policies
   where schemaname = 'public' and tablename in ('transacoes', 'contratos')
     and policyname not in (
           'transacoes_select', 'transacoes_insert',
           'transacoes_update', 'transacoes_delete',
           'contratos_select',  'contratos_insert',
           'contratos_update',  'contratos_delete');
  if v_stray is not null then
    raise exception 'sweep left an unowned policy behind: %', v_stray;
  end if;
end $$;

rollback;
