-- Permissões granulares, Migração B (religação): rewires the RLS points that
-- already had SOME per-role enforcement onto has_permission()/has_permission_for
-- (Migração A, 20260903000002). No new access surface is created — every
-- object here already existed and already had a capability check; only the
-- check itself changes, from role/flag literals to the papéis model. A member
-- with no role_id keeps resolving through has_permission_for's legacy
-- fallback, which is byte-for-byte the old behaviour for every case,
-- including automações (item (6) remaps post_status_automations onto
-- 'configuracoes' and instagram_comment_automations onto 'automacoes' with
-- the agent preset set to 'editar' specifically so neither table's legacy
-- access changes) and the contratos/financeiro legacy-admin coupling (item
-- (2), a spec-consistency fix — see its own comment). Neither is a "delta":
-- both are engineered to be unobservable to any existing user.
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
  acl       text;
  auth_priv text;
BEGIN
  SELECT array_to_string(c.relacl, ',') INTO acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'workspace_roles';

  IF acl IS NULL THEN
    RAISE EXCEPTION 'workspace_roles: no ACL at all (expected an explicit authenticated=r entry) — acl=%', acl;
  END IF;

  -- Extract authenticated's exact privilege-letter run (between "=" and the
  -- next "/", e.g. "r" in "authenticated=r/postgres") and require it equal
  -- EXACTLY 'r'. A character-class regex enumerating "bad" letters
  -- (a/w/d/...) is fragile — it silently misses any privilege code it forgot
  -- to list (D=TRUNCATE, x=REFERENCES, t=TRIGGER, or a trailing '*' for
  -- WITH GRANT OPTION on 'r' itself). Exact-match on the extracted substring
  -- cannot miss any of those: anything other than the single letter 'r'
  -- fails the check, full stop.
  auth_priv := substring(acl from 'authenticated=([^/]*)/');
  IF auth_priv IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'workspace_roles: authenticated must hold EXACTLY SELECT (r) — got %, full acl=%',
      COALESCE(auth_priv, '<none>'), acl;
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
-- Nenhuma policy financeira de LEITURA em transacoes muda: só o corpo da
-- função. Views membros_v/clientes_v e seus grants ficam intactos (elas
-- chamam can_see_financials(), não algo que este arquivo toca).
-- =================================================================
CREATE OR REPLACE FUNCTION public.can_see_financials()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.has_permission('financeiro', 'ver') $$;

-- =================================================================
-- (2) has_permission_for(): acopla contratos ao flag legado de financeiro
-- no fallback de admin (spec-consistency fix, review da Task 10).
--
-- FATO DE PRODUÇÃO (confirmado, não é suposição): hoje um admin restrito
-- (can_see_financials=false) já NÃO vê contratos — nav-data.ts esconde
-- 'financeiro' E 'contratos' juntos para admin restrito
-- (`i.id !== 'financeiro' && i.id !== 'contratos'`), e a RLS antiga de
-- contratos_select (20260728000002) usava can_see_financials() diretamente,
-- igual a transacoes. Contratos SEMPRE esteve acoplado ao flag financeiro
-- para o admin legado; só nunca tinha um módulo de permissão próprio antes
-- de Migração A introduzir o catálogo (que já lista 'contratos' separado de
-- 'financeiro' — um papel customizado sempre pôde diferenciá-los).
--
-- Sem este ajuste, o item (2b) abaixo (contratos migrando para
-- has_permission('contratos', ...)) romperia essa paridade: um admin
-- restrito passaria a VER contratos de novo, uma regressão de segurança
-- disfarçada de refactor. A correção fica AQUI, no fallback legado — o
-- ramo de papel customizado (linhas 113-116, INTOCADO) já trata financeiro
-- e contratos como módulos independentes, que é o comportamento correto
-- para um papel novo.
--
-- Corpo copiado INTEGRALMENTE de 20260903000002_workspace_roles_a_additive.sql
-- (Migração A — já aplicada em produção, portanto NÃO editada; este
-- CREATE OR REPLACE aqui em Migração B é o mecanismo correto para mudar o
-- corpo de uma função já em produção). Migração A permanece a fonte
-- canônica da ASSINATURA e de todo o resto do corpo; a ÚNICA mudança é a
-- condição marcada abaixo.
-- =================================================================
CREATE OR REPLACE FUNCTION public.has_permission_for(
  p_user uuid, p_workspace uuid, p_module text, p_action text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role    text;
  v_can_fin boolean;
  v_perms   jsonb;
  v_level   text;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('ver','editar') THEN RETURN false; END IF;
  IF p_user IS NULL OR p_workspace IS NULL OR p_module IS NULL THEN RETURN false; END IF;

  SELECT wm.role, wm.can_see_financials, wr.permissions
    INTO v_role, v_can_fin, v_perms
    FROM public.workspace_members wm
    LEFT JOIN public.workspace_roles wr ON wr.id = wm.role_id
   WHERE wm.user_id = p_user AND wm.workspace_id = p_workspace;

  IF v_role IS NULL THEN RETURN false; END IF;      -- sem membership: nega
  IF v_role = 'owner' THEN RETURN true; END IF;     -- dono: tudo

  -- Papel customizado: lookup no jsonb; ausente => none (falha fechada).
  IF v_perms IS NOT NULL THEN
    v_level := COALESCE(v_perms ->> p_module, 'none');
    RETURN v_level = 'editar' OR (v_level = 'ver' AND p_action = 'ver');
  END IF;

  -- Fallback legado: comportamento pré-papéis, byte a byte. O acoplamento
  -- contratos/financeiro logo abaixo (ramo admin) é a ÚNICA exceção textual
  -- deste bloco, e mesmo essa é paridade com o app hoje, não uma mudança
  -- observável (ver o comentário do CREATE acima). O preset de automacoes do
  -- agente, mais abaixo, também preserva comportamento byte a byte -- não é
  -- mais tratado como delta (decisão de produto revertida a versão anterior
  -- desta migração que tinha um; ver o comentário no CASE do agente).
  IF v_role = 'admin' THEN
    -- Migração B: contratos entra na mesma exceção de financeiro (era só
    -- `p_module = 'financeiro'`). Ver o comentário do CREATE acima.
    IF p_module IN ('financeiro', 'contratos') THEN RETURN COALESCE(v_can_fin, false); END IF;
    RETURN true;
  END IF;

  -- agent: preset hardcoded (espelho de AGENT_PRESET nos dois arquivos TS).
  -- Migração B: 'automacoes' vira 'editar' (era 'ver'). automacoes agora só
  -- governa instagram_comment_automations (item (6) abaixo) — a mesma tabela
  -- que 20260829000002 já deixava com escrita totalmente livre a qualquer
  -- membro, agente incluso. 'editar' aqui é o que preserva esse
  -- comportamento byte a byte: 'ver' teria REVOGADO a escrita que o agente
  -- já tinha. post_status_automations deixou de usar 'automacoes' — segue
  -- 'configuracoes' agora (também item (6)), que já era 'none' para o
  -- agente, preservando o owner/admin-only que ela sempre teve.
  RETURN CASE p_module
    WHEN 'clientes'   THEN true
    WHEN 'entregas'   THEN true
    WHEN 'calendario' THEN true
    WHEN 'aprovacoes' THEN true
    WHEN 'arquivos'   THEN true
    WHEN 'ideias'     THEN true
    WHEN 'tarefas'    THEN true
    WHEN 'analytics'  THEN p_action = 'ver'
    WHEN 'automacoes' THEN true
    ELSE false
  END;
END;
$$;
-- Grants de Migração A (REVOKE ALL ... GRANT EXECUTE TO service_role)
-- sobrevivem ao CREATE OR REPLACE — não precisam ser reemitidos.

-- =================================================================
-- (3) Trigger de escrita financeira exige EDITAR, não só VER.
--
-- Apontado no review externo do PR A: religar só a leitura teria feito um
-- papel {"financeiro":"ver"} mudar valores por PostgREST direto, já que a
-- guarda escrevia contra can_see_financials() — que agora É 'ver'. Corpo
-- copiado INTEGRALMENTE de 20260728000002:224-258 (comentários inclusos);
-- a ÚNICA mudança é a condição marcada abaixo. Fallback legado preserva
-- comportamento byte a byte: admin sem papel customizado tem
-- financeiro/editar == financeiro/ver == can_see_financials flag (ver
-- has_permission_for, ramo 'admin', item (2) acima).
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
-- recriá-los. Existência + apontamento verificados no post-condition (9).

-- =================================================================
-- (4) Escrita financeira nas policies de TRANSACOES (INSERT/UPDATE/DELETE).
-- Fica em financeiro, sem mudança de módulo (contratos migra para seu
-- próprio módulo no item (4b) abaixo).
--
-- Conjunto ADICIONAL (não substituição): a spec (tabela "Enforcement
-- backend") documenta has_permission('financeiro','editar') como conjunto
-- adicional à policy de escrita existente, não uma troca. can_see_financials()
-- permanece no predicado — sozinho ele agora só prova 'ver', então SEM o
-- conjunto novo um papel {"financeiro":"ver"} escreveria via PostgREST direto,
-- o mesmo furo que o item (3) acima fecha para membros/clientes. Nomes e
-- estrutura copiados de 20260728000002:162-198; a _select fica INTOCADA
-- (can_see_financials() já resolve 'ver').
-- =================================================================
DROP POLICY IF EXISTS transacoes_insert ON public.transacoes;
CREATE POLICY transacoes_insert ON public.transacoes FOR INSERT WITH CHECK (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
  AND (SELECT public.has_permission('financeiro', 'editar'))
);

DROP POLICY IF EXISTS transacoes_update ON public.transacoes;
CREATE POLICY transacoes_update ON public.transacoes FOR UPDATE USING (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
  AND (SELECT public.has_permission('financeiro', 'editar'))
) WITH CHECK (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
  AND (SELECT public.has_permission('financeiro', 'editar'))
);

DROP POLICY IF EXISTS transacoes_delete ON public.transacoes;
CREATE POLICY transacoes_delete ON public.transacoes FOR DELETE USING (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.can_see_financials())
  AND (SELECT public.has_permission('financeiro', 'editar'))
);

-- =================================================================
-- (4b) Contratos vira módulo PRÓPRIO — troca completa (não soma), diferente
-- de transacoes acima. O catálogo (Migração A) já lista 'contratos' separado
-- de 'financeiro'; um papel customizado sempre pôde diferenciá-los, mas até
-- agora a RLS de contratos ainda lia can_see_financials() diretamente
-- (mesma função de transacoes), então um papel {"contratos":"editar",
-- "financeiro":"none"} seria bloqueado por um módulo que nem está tentando
-- usar. Isso rompe. Daqui pra frente contratos_* só conhece
-- has_permission('contratos', ...) — sem referência a can_see_financials()
-- no texto da policy. O acoplamento com o flag legado de admin não some:
-- ele migrou para DENTRO de has_permission_for, item (2) acima
-- (`p_module IN ('financeiro','contratos')`), que é o lugar certo para uma
-- regra específica do fallback legado, não do modelo de papéis novo.
--
-- Consequência para 54_financial_policy_ownership.sql: suas asserções sobre
-- transacoes continuam batendo (can_see_financials no texto, intocado); as
-- de contratos foram atualizadas para checar has_permission em vez disso —
-- ver o commit desta rodada.
-- =================================================================
DROP POLICY IF EXISTS contratos_select ON public.contratos;
CREATE POLICY contratos_select ON public.contratos FOR SELECT USING (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.has_permission('contratos', 'ver'))
);

DROP POLICY IF EXISTS contratos_insert ON public.contratos;
CREATE POLICY contratos_insert ON public.contratos FOR INSERT WITH CHECK (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.has_permission('contratos', 'editar'))
);

DROP POLICY IF EXISTS contratos_update ON public.contratos;
CREATE POLICY contratos_update ON public.contratos FOR UPDATE USING (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.has_permission('contratos', 'editar'))
) WITH CHECK (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.has_permission('contratos', 'editar'))
);

DROP POLICY IF EXISTS contratos_delete ON public.contratos;
CREATE POLICY contratos_delete ON public.contratos FOR DELETE USING (
  conta_id IN (SELECT public.get_my_conta_id())
  AND (SELECT public.has_permission('contratos', 'editar'))
);

-- =================================================================
-- (5) Leads: RLS enable (idempotente, defesa para ambientes onde
-- 20260315_rls_security_audit.sql nunca rodou de verdade — precedente
-- 20260729000002:105, que descobriu profiles nesse estado em produção) +
-- sweep de policies legadas + as quatro políticas na permissão.
--
-- CONFIRMADO por quem revisou esta migração: em produção
-- relrowsecurity=true em leads/workspaces/transacoes/contratos hoje — este
-- ENABLE é defesa para um ambiente fresco (novo dev local, staging
-- reconstruído do zero) que aplicasse as migrations fora de ordem ou
-- pulasse 20260315, não uma correção de um buraco ativo em produção.
--
-- Produção nunca rodou 20260315_rls_security_audit.sql (mesma constatação de
-- 20260728000002 sobre transacoes/contratos) e pode carregar um par FOR ALL
-- permissivo hand-created no baseline. Sweep name-independente restrito a
-- 'leads', mesmo padrão de 20260728000002:135-160.
-- =================================================================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

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
-- (6) Automações: decisão de produto final (preserva o comportamento de
-- HOJE byte a byte para todo membro legado -- owner, admin, agent -- sem
-- nenhum delta observável). Duas rodadas anteriores desta migração
-- tentaram harmonizar post_status_automations e instagram_comment_
-- automations sob o MESMO módulo 'automacoes'; isso teria produzido dois
-- deltas reais (agente ganhando leitura de psa que nunca teve; agente
-- perdendo a escrita livre de ica que já tinha desde 20260829000002). A
-- versão final remapeia em vez de harmonizar:
--
--   instagram_comment_automations (ica_*) -- fica em 'automacoes'. SELECT
--     exige has_permission('automacoes','ver'); escrita exige
--     has_permission('automacoes','editar'). O preset do agente para
--     'automacoes' vira 'editar' (era 'ver' numa rodada anterior desta
--     migração -- ver o CASE de has_permission_for, ramo agent, acima):
--     'editar' é o que preserva a escrita irrestrita que 20260829000002 já
--     dava a QUALQUER membro do workspace, agente incluso -- 'ver' teria
--     revogado exatamente essa escrita.
--
--   post_status_automations (psa_*) -- sai de 'automacoes' e entra em
--     'configuracoes'. Rationale: regras de automação de status são
--     configuradas na área de Configurações > Status, não em Automações; e
--     'configuracoes' já era 'none' no preset do agente (owner/admin-only
--     preservado sem tocar em nada) -- diferente de 'automacoes', que
--     precisaria de uma exceção especial só para psa se ficasse ali.
--     SELECT exige has_permission('configuracoes','ver'); escrita exige
--     has_permission('configuracoes','editar'). Resultado: NENHUM delta —
--     agente não ganha leitura de psa (ao contrário do que uma rodada
--     anterior desta migração fazia), continua exatamente owner/admin-only,
--     igual a 20260805000002.
-- =================================================================

-- post_status_automations: nomes/estrutura de 20260805000002 (única
-- definição). WITH CHECK do update mantém o tenant como hoje (sem conjunto
-- de permissão) — comportamento pré-existente, não tocado. Módulo:
-- 'configuracoes' (não 'automacoes' -- ver o comentário do item (6) acima).
DROP POLICY IF EXISTS psa_select ON public.post_status_automations;
CREATE POLICY psa_select ON public.post_status_automations
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'ver'))
  );

DROP POLICY IF EXISTS psa_insert ON public.post_status_automations;
CREATE POLICY psa_insert ON public.post_status_automations
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'editar'))
  );

DROP POLICY IF EXISTS psa_update ON public.post_status_automations;
CREATE POLICY psa_update ON public.post_status_automations
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'editar'))
  ) WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS psa_delete ON public.post_status_automations;
CREATE POLICY psa_delete ON public.post_status_automations
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'editar'))
  );
-- service_role_bypass_psa: intocada.

-- instagram_comment_automations: módulo 'automacoes' (preset do agente
-- 'editar' -- byte-exato com a escrita livre que 20260829000002 já dava a
-- qualquer membro; ver o comentário do item (6) acima).
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
-- (7) post_status_definitions: só as três policies de escrita
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
-- (8) workspaces: ws_update_owner_admin (última definição:
-- 20260322_workspace_logo_storage.sql:33, nunca redefinida depois). Sem
-- WITH CHECK explícito na origem — preservado assim (Postgres usa a própria
-- USING como WITH CHECK implícito de UPDATE quando nenhum é dado).
--
-- Fonte do tenant TROCA deliberadamente. A origem resolvia via
-- `id IN (SELECT workspace_id FROM workspace_members WHERE user_id =
-- auth.uid() AND role IN ('owner','admin'))` — QUALQUER workspace onde o
-- usuário seja owner/admin, mesmo que não seja o workspace ATIVO da sessão.
-- A nova usa `id IN (SELECT public.get_my_conta_id())`, escopada ao
-- workspace ativo — mesmo padrão de toda outra policy religada aqui, e
-- alinhada ao escopo de has_permission(), que sempre resolve contra
-- get_my_conta_id() e nunca aceita um workspace explícito do cliente. É um
-- ESTREITAMENTO deliberado, não um efeito colateral: um owner/admin de DOIS
-- workspaces deixa de editar o workspace B só por ter uma sessão ativa no
-- A — precisa trocar o workspace ativo primeiro. Configuração rara
-- (max_workspaces_per_user > 1), sem regressão de caso de uso coberto por
-- teste hoje.
-- =================================================================
DROP POLICY IF EXISTS ws_update_owner_admin ON public.workspaces;
CREATE POLICY ws_update_owner_admin ON public.workspaces
  FOR UPDATE USING (
    id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('configuracoes', 'editar'))
  );

-- =================================================================
-- (9) Post-conditions.
-- =================================================================
DO $$
DECLARE
  n     int;
  trg_n int;
  stray text;
  fn    text;
  def   text;
  trg_ok boolean;
BEGIN
  -- ---- leads ----
  IF NOT (
    SELECT relrowsecurity FROM pg_class WHERE oid = 'public.leads'::regclass
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on leads — leads_select/insert/update/delete would be inert. '
                    'Same class of drift as profiles in 20260729000002.';
  END IF;

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

  -- ---- workspaces ----
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'workspaces';
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 policies on workspaces, found %', n;
  END IF;

  SELECT string_agg(format('%s.%s', tablename, policyname), ', ' ORDER BY policyname)
    INTO stray
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'workspaces'
     AND policyname NOT IN ('ws_select_member', 'ws_no_client_insert',
                             'ws_update_owner_admin', 'ws_no_client_delete');
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'unowned policy survives on workspaces: %', stray;
  END IF;

  -- ---- post_status_automations / instagram_comment_automations ----
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

  -- ---- post_status_definitions ----
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'post_status_definitions';
  IF n <> 5 THEN
    RAISE EXCEPTION 'expected 5 policies on post_status_definitions, found %', n;
  END IF;

  -- ---- transacoes / contratos ----
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

  -- ---- write-guard triggers still wired to guard_financial_write() ----
  SELECT count(*),
         bool_and(t.tgfoid = 'public.guard_financial_write()'::regprocedure)
    INTO trg_n, trg_ok
    FROM pg_trigger t
   WHERE t.tgname IN ('trg_guard_membros_custo', 'trg_guard_clientes_valor')
     AND NOT t.tgisinternal;
  IF trg_n <> 2 OR trg_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'trg_guard_membros_custo/trg_guard_clientes_valor missing or not '
                    'pointing at guard_financial_write() (found %, all-correct=%)', trg_n, trg_ok;
  END IF;

  -- As funções redefinidas por este arquivo apontam para has_permission no
  -- corpo (não sobraram como can_see_financials()-apenas ou get_my_role()).
  -- has_permission_for NÃO entra neste loop: seu próprio nome contém
  -- "has_permission" como substring, tornando o LIKE abaixo vacuamente
  -- verdadeiro para ela independente do corpo — a checagem que importa para
  -- has_permission_for é a específica logo abaixo (acoplamento contratos).
  FOREACH fn IN ARRAY ARRAY['can_see_financials', 'guard_financial_write'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
     WHERE n2.nspname = 'public' AND p.proname = fn;
    IF def IS NULL OR def NOT LIKE '%has_permission%' THEN
      RAISE EXCEPTION '%: body does not reference has_permission', fn;
    END IF;
  END LOOP;

  -- has_permission_for's admin branch specifically must couple contratos to
  -- financeiro (item (2)) — a targeted text check, not just "mentions
  -- has_permission" (which the FOREACH above already covers via its own
  -- recursive self-reference in has_permission_for's name).
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname = 'public' AND p.proname = 'has_permission_for';
  -- Literal source text is `IN ('financeiro', 'contratos')`; each single
  -- quote doubles when embedded in this LIKE pattern's own string literal.
  IF def NOT LIKE '%''financeiro'', ''contratos''%' THEN
    RAISE EXCEPTION 'has_permission_for: admin branch does not couple contratos to financeiro';
  END IF;
END $$;
