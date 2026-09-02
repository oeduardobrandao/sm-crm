-- Permissões granulares, Migração B (religação): rewires the RLS points that
-- already had SOME per-role enforcement onto has_permission()/has_permission_for
-- (Migração A, 20260903000002). No new access surface is created — every
-- object here already existed and already had a capability check; only the
-- check itself changes, from role/flag literals to the papéis model. A member
-- with no role_id keeps resolving through has_permission_for's legacy
-- fallback, which is byte-for-byte the old behaviour (except the automações
-- delta below, which is deliberate and documented).
-- Spec: docs/superpowers/specs/2026-09-02-permissoes-granulares-papeis-design.md

-- =================================================================
-- 0. workspace_roles: explicit SELECT grant (incident follow-up).
--
-- Migration A created the table but never touched its table-level ACL, so
-- `authenticated`'s ability to SELECT it (needed for the workspace_roles(...)
-- embed in getMyMembership()) depended entirely on Supabase's hosted default
-- privileges. That worked in production, but it is implicit exactly where the
-- house standard (20260728000001) is to be explicit — and the 2026-09-02
-- incident (frontend deployed ahead of this migration, briefly reading a
-- schema without it) is the concrete cost of leaving a security-relevant grant
-- implicit. Enumerated REVOKE, then an explicit re-GRANT, same shape as
-- 20260728000001's `can_see_financials()`-adjacent tables.
--
-- service_role is deliberately NOT in the REVOKE list: edge functions
-- (invite flows, role management) read workspace_roles directly with the
-- service key, and this migration must not touch that access.
-- =================================================================
REVOKE ALL ON public.workspace_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_roles TO authenticated;

DO $$
DECLARE
  acl text;
BEGIN
  SELECT array_to_string(c.relacl, ',') INTO acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'workspace_roles';

  IF acl IS NULL OR acl NOT LIKE '%authenticated=r/%' THEN
    RAISE EXCEPTION 'workspace_roles: authenticated lacks SELECT — acl=%', acl;
  END IF;
  -- 'a'=INSERT, 'w'=UPDATE, 'd'=DELETE alongside authenticated would be the
  -- exact default-privilege escape this grant exists to close. RLS
  -- (wr_no_client_insert/update/delete, Migration A) already blocks those,
  -- but the table grant is defense in depth, same rationale as
  -- 20260728000001's masking views.
  IF acl ~ 'authenticated=[rwad]*[awd]' THEN
    RAISE EXCEPTION 'workspace_roles: authenticated retains a write privilege — acl=%', acl;
  END IF;
  IF acl LIKE '%anon=%' THEN
    RAISE EXCEPTION 'workspace_roles: anon retains privilege — acl=%', acl;
  END IF;
  -- A PUBLIC grant renders as a grantee-less aclitem (=X/postgres), not
  -- anon=X — same distinction 20260728000001's post-condition draws.
  IF acl LIKE '=%' OR acl LIKE '%,=%' THEN
    RAISE EXCEPTION 'workspace_roles: PUBLIC retains privilege — acl=%', acl;
  END IF;
  -- service_role is intentionally NOT asserted here: this migration does not
  -- touch its grant, and the local CLI image's default ACL (no auto-grant to
  -- service_role, unlike hosted Supabase — see _helpers.sql) means asserting
  -- a specific state for it would be environment-dependent, not a property of
  -- this migration.
END $$;

-- =================================================================
-- (1) Núcleo financeiro passa a consultar o modelo de papéis.
--
-- Nenhuma policy financeira de LEITURA muda: só o corpo da função. Views
-- membros_v/clientes_v e seus grants ficam intactos (elas chamam
-- can_see_financials(), não algo que este arquivo toca).
-- =================================================================
CREATE OR REPLACE FUNCTION public.can_see_financials()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.has_permission('financeiro', 'ver') $$;

-- =================================================================
-- (2) Trigger de escrita financeira exige EDITAR, não só VER.
--
-- Apontado no review externo do PR A: religar só a leitura teria feito um
-- papel {"financeiro":"ver"} mudar valores por PostgREST direto, já que a
-- guarda escrevia contra can_see_financials() — que agora É 'ver'. Corpo
-- copiado INTEGRALMENTE de 20260728000002:224-258 (comentários inclusos);
-- a ÚNICA mudança é a condição marcada abaixo. Fallback legado preserva
-- comportamento byte a byte: admin sem papel customizado tem
-- financeiro/editar == financeiro/ver == can_see_financials flag (ver
-- has_permission_for, ramo 'admin').
-- =================================================================

-- auth.uid() IS NULL is NOT a proxy for service role — it also covers anonymous
-- requests. Only named trusted roles bypass.
--
-- DEVIATION FROM THE ORIGINAL DRAFT: this function must be SECURITY INVOKER,
-- NOT SECURITY DEFINER. SECURITY DEFINER changes current_user to the function
-- OWNER (postgres, since migrations run as postgres) for the entire duration of
-- the call — verified empirically against this local DB. If this trigger were
-- itself SECURITY DEFINER, `current_user IN ('postgres','supabase_admin')`
-- would be true on every single invocation regardless of who issued the write,
-- permanently disabling the guard for everyone. Kept SECURITY INVOKER,
-- current_user correctly reflects the real caller ('authenticated', 'anon',
-- etc.), UNLESS this statement is itself nested inside another SECURITY
-- DEFINER function's body (e.g. set_membro_crm_user, owned by postgres) — that
-- narrower, intentional bypass is what the note below describes.
--
-- NOTE: the current_user branch also exempts every SECURITY DEFINER function
-- owned by postgres, not just superuser sessions. Acceptable today (the only
-- such path writing these tables is set_membro_crm_user, which touches
-- crm_user_id alone). Any NEW SECURITY DEFINER path that can write a financial
-- column must call has_permission('financeiro','editar') itself.
CREATE OR REPLACE FUNCTION public.guard_financial_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  col     text := TG_ARGV[0];
  old_val numeric;
  new_val numeric;
BEGIN
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT ($1).%I', col) INTO new_val USING NEW;
  IF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT ($1).%I', col) INTO old_val USING OLD;
  END IF;

  -- Only a CHANGE to the financial value is guarded. An INSERT carrying NULL,
  -- or an UPDATE that leaves the column alone, passes untouched — otherwise a
  -- restricted admin could not change a phone number.
  IF (TG_OP = 'INSERT' AND new_val IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND new_val IS DISTINCT FROM old_val) THEN
    -- Migração B: exige EDITAR (era can_see_financials(), i.e. VER).
    IF public.has_permission('financeiro', 'editar') IS NOT TRUE THEN
      RAISE EXCEPTION 'financial_access_denied'
        USING HINT = format('column %s requires financial access', col);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Triggers já apontam para esta função por nome (trg_guard_membros_custo,
-- trg_guard_clientes_valor, 20260728000002) — CREATE OR REPLACE não exige
-- recriá-los.

-- =================================================================
-- (3) Escrita financeira nas policies de transacoes/contratos.
--
-- Conjunto ADICIONAL (não substituição): a spec (tabela "Enforcement
-- backend") documenta has_permission('financeiro','editar') como conjunto
-- adicional à policy de escrita existente, não uma troca. can_see_financials()
-- permanece no predicado — sozinho ele agora só prova 'ver', então SEM o
-- conjunto novo um papel {"financeiro":"ver"} escreveria via PostgREST direto,
-- o mesmo furo que o item (2) acima fecha para membros/clientes. Nomes e
-- estrutura (DO $$ FOREACH) copiados de 20260728000002:162-198; as duas
-- _select ficam INTOCADAS (can_see_financials() já resolve 'ver').
-- =================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transacoes', 'contratos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
        AND (SELECT public.has_permission('financeiro', 'editar'))
      )$f$, t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
        AND (SELECT public.has_permission('financeiro', 'editar'))
      ) WITH CHECK (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
        AND (SELECT public.has_permission('financeiro', 'editar'))
      )$f$, t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE USING (
        conta_id IN (SELECT public.get_my_conta_id())
        AND (SELECT public.can_see_financials())
        AND (SELECT public.has_permission('financeiro', 'editar'))
      )$f$, t || '_delete', t);
  END LOOP;
END $$;

-- =================================================================
-- (4) Leads: sweep de policies legadas + as quatro políticas na permissão.
--
-- Produção nunca rodou 20260315_rls_security_audit.sql (mesma constatação de
-- 20260728000002 sobre transacoes/contratos) e pode carregar um par FOR ALL
-- permissivo hand-created no baseline. Sweep name-independente restrito a
-- 'leads', mesmo padrão de 20260728000002:135-160.
-- =================================================================
DO $$
DECLARE
  p record;
  n int := 0;
BEGIN
  FOR p IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'leads'
       AND permissive = 'PERMISSIVE'
       AND policyname NOT IN ('leads_select', 'leads_insert', 'leads_update', 'leads_delete')
     ORDER BY policyname
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    RAISE NOTICE 'dropped unowned policy %.% — permissive policies are OR''d, '
                 'so it would have defeated the capability check',
                 p.tablename, p.policyname;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'legacy policy sweep on leads: % dropped', n;
END $$;

DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('leads', 'ver'))
  );

DROP POLICY IF EXISTS leads_insert ON public.leads;
CREATE POLICY leads_insert ON public.leads
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('leads', 'editar'))
  );

DROP POLICY IF EXISTS leads_update ON public.leads;
CREATE POLICY leads_update ON public.leads
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('leads', 'editar'))
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
  );

DROP POLICY IF EXISTS leads_delete ON public.leads;
CREATE POLICY leads_delete ON public.leads
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('leads', 'editar'))
  );

-- =================================================================
-- (5) Automações: harmonização (delta documentado na spec, seção "Delta
-- deliberado do preset Agente").
--
-- post_status_automations restringia até o SELECT a owner/admin
-- (20260805000002); instagram_comment_automations liberava SELECT a
-- qualquer membro e, depois, TODA a escrita a qualquer membro
-- (20260829000002). A v1 harmoniza as duas: SELECT exige
-- has_permission('automacoes','ver'); escrita exige
-- has_permission('automacoes','editar'). Com o preset Agente (ver=true,
-- editar=false para automações), agentes GANHAM leitura de
-- post_status_automations que não tinham, e PERDEM a escrita irrestrita de
-- instagram_comment_automations que o 20260829000002 tinha dado.
-- =================================================================

-- post_status_automations: nomes/estrutura de 20260805000002 (única
-- definição). WITH CHECK do update mantém o tenant como hoje (sem conjunto
-- de permissão) — comportamento pré-existente, não tocado.
DROP POLICY IF EXISTS psa_select ON public.post_status_automations;
CREATE POLICY psa_select ON public.post_status_automations
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
  );

DROP POLICY IF EXISTS psa_insert ON public.post_status_automations;
CREATE POLICY psa_insert ON public.post_status_automations
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
  );

DROP POLICY IF EXISTS psa_update ON public.post_status_automations;
CREATE POLICY psa_update ON public.post_status_automations
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
  ) WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS psa_delete ON public.post_status_automations;
CREATE POLICY psa_delete ON public.post_status_automations
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
  );
-- service_role_bypass_psa: intocada.

-- instagram_comment_automations: a última definição das quatro é
-- 20260829000002 (write totalmente aberta, sem checagem de papel — reverteu
-- o owner/admin de 20260815000002). A harmonização acima substitui essa
-- abertura pelo gate de automações; ica_select recebe o conjunto novo sobre
-- a mesma base tenant-only de 20260815000002 (nunca redefinida depois).
DROP POLICY IF EXISTS ica_select ON public.instagram_comment_automations;
CREATE POLICY ica_select ON public.instagram_comment_automations
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
  );

DROP POLICY IF EXISTS ica_insert ON public.instagram_comment_automations;
CREATE POLICY ica_insert ON public.instagram_comment_automations
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
  );

DROP POLICY IF EXISTS ica_update ON public.instagram_comment_automations;
CREATE POLICY ica_update ON public.instagram_comment_automations
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
  );

DROP POLICY IF EXISTS ica_delete ON public.instagram_comment_automations;
CREATE POLICY ica_delete ON public.instagram_comment_automations
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
  );
-- service_role_bypass_ica: intocada.

-- =================================================================
-- (6) post_status_definitions: só as três policies de escrita
-- (20260805000001:128-145). A de SELECT (psd_select) NÃO muda — qualquer
-- membro, agente incluso, continua lendo (kanban/labels precisam). WITH
-- CHECK do update mantém o tenant como hoje, mesmo padrão de psa_update.
-- =================================================================
DROP POLICY IF EXISTS psd_insert ON public.post_status_definitions;
CREATE POLICY psd_insert ON public.post_status_definitions
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'editar'))
  );

DROP POLICY IF EXISTS psd_update ON public.post_status_definitions;
CREATE POLICY psd_update ON public.post_status_definitions
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'editar'))
  ) WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS psd_delete ON public.post_status_definitions;
CREATE POLICY psd_delete ON public.post_status_definitions
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'editar'))
  );

-- =================================================================
-- (7) workspaces: ws_update_owner_admin (última definição:
-- 20260322_workspace_logo_storage.sql:33, nunca redefinida depois). Sem
-- WITH CHECK explícito na origem — preservado assim (Postgres usa a própria
-- USING como WITH CHECK implícito de UPDATE quando nenhum é dado).
-- =================================================================
DROP POLICY IF EXISTS ws_update_owner_admin ON public.workspaces;
CREATE POLICY ws_update_owner_admin ON public.workspaces
  FOR UPDATE USING (
    id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'editar'))
  );

-- =================================================================
-- (8) Post-conditions.
-- =================================================================
DO $$
DECLARE
  n     int;
  stray text;
  fn    text;
  def   text;
BEGIN
  -- Contagem exata de policies por tabela: guarda contra uma policy
  -- legada/espúria sobrevivendo ao DROP+CREATE acima.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'leads';
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 policies on leads, found %', n;
  END IF;

  SELECT string_agg(format('%s.%s', tablename, policyname), ', ' ORDER BY policyname)
    INTO stray
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'leads'
     AND policyname NOT IN ('leads_select', 'leads_insert', 'leads_update', 'leads_delete');
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'unowned policy survives on leads: %', stray;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'post_status_automations';
  IF n <> 5 THEN
    RAISE EXCEPTION 'expected 5 policies on post_status_automations, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'instagram_comment_automations';
  IF n <> 5 THEN
    RAISE EXCEPTION 'expected 5 policies on instagram_comment_automations, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'transacoes';
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 policies on transacoes, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'contratos';
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 policies on contratos, found %', n;
  END IF;

  -- As funções redefinidas por este arquivo apontam para has_permission no
  -- corpo (não sobraram como can_see_financials()-apenas ou get_my_role()).
  FOREACH fn IN ARRAY ARRAY['can_see_financials', 'guard_financial_write'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
     WHERE n2.nspname = 'public' AND p.proname = fn;
    IF def IS NULL OR def NOT LIKE '%has_permission%' THEN
      RAISE EXCEPTION '%: body does not reference has_permission', fn;
    END IF;
  END LOOP;
END $$;
