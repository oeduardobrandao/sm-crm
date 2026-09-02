# Permissões Granulares (Papéis Customizados) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Papéis nomeados reutilizáveis com permissões por módulo (Sem acesso/Ver/Editar) que o dono do workspace cria e atribui, mantendo Admin/Agente como presets e comportamento legado intacto para membros sem papel.

**Architecture:** Camada única de papéis (`workspace_roles` + `workspace_members.role_id`), chassi falha-fechada (`role='agent'` para membros com papel custom), resolução central em SQL (`has_permission_for` núcleo + `has_permission` wrapper) espelhada uma vez em TS (`derivePermission`/`can()` no frontend). Rollout em DOIS PRs: **PR A** aditivo (schema, RPCs, edge functions, `can()`, aba Papéis) sem mudança observável de comportamento; **PR B** religa RLS, triggers, edge functions e guards de frontend ao modelo novo.

**Tech Stack:** Postgres/Supabase (RLS, SECURITY DEFINER, realtime), Deno edge functions, React 19 + TanStack Query, Vitest, deno test, suíte psql de entitlements.

**Spec:** `docs/superpowers/specs/2026-09-02-permissoes-granulares-papeis-design.md` — em conflito, a spec ganha.

## Global Constraints

- Catálogo de 14 módulos, slugs exatos: `clientes`, `entregas`, `calendario`, `aprovacoes`, `arquivos`, `ideias`, `tarefas`, `leads`, `financeiro`, `contratos`, `equipe`, `analytics`, `automacoes`, `configuracoes`. Valores: `none | ver | editar`; `editar` implica `ver`; chave ausente ⇒ `none`.
- Preset Agente (mesma tabela em SQL e TS, paridade testada): `editar` = clientes, entregas, calendario, aprovacoes, arquivos, ideias, tarefas; `ver` = analytics, automacoes; `none` = leads, financeiro, contratos, equipe, configuracoes.
- Dono: sempre `true` para tudo; nunca recebe `role_id`. Cobrança, Armazenamento e a aba Papéis: exclusivos do dono, nenhum papel concede.
- Membro com papel custom: `workspace_members.role = 'agent'` SEMPRE (chassi falha-fechada); espelho `profiles.role = 'agent'`.
- `workspace_members`/`workspace_roles`/`invites`: escrita de cliente bloqueada; toda mutação via edge function + RPC `SECURITY DEFINER` + `audit_log` (padrão `set_financial_access`, migração `20260728000003`).
- Copy PT-BR, sem em-dashes em texto de UI (usar ponto/`:`/`·`).
- Migrations: prefixo único; ANTES de cada `gh pr create` rodar `git ls-tree origin/main:supabase/migrations | awk '{print $4}' | tail` e renumerar acima do tail se houver colisão.
- Antes de cada push: `npm run lint`, `npm run format:check`, os 4 `tsc` (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run test:functions` (depois `git checkout deno.lock` se só o lock sujou; rodar `npm ci` se `ls node_modules/.deno` mostrar poluição deno).
- Testes de entitlements: cada arquivo é psql autônomo com `begin; do $$ ... $$; rollback;` e `\i supabase/tests/entitlements/_helpers.sql`. Rodar local exige Docker/colima (`npx supabase start` + `bash scripts/test-entitlements.sh`); sem Docker, o CI (`entitlement-tests`) cobre. NUNCA declarar sucesso de teste SQL sem tê-lo rodado ou sem apontar explicitamente que ficou para o CI.
- Nova rota autenticada no CRM exige entrada no mapa de rotas do ProtectedRoute E no padrão nomeado do `vercel.json` (a aba `/configuracao/papeis` NÃO é rota nova de topo, já coberta por `/configuracao`).

---

## PR A — Fundação aditiva (zero mudança observável)

### Task 1: Branch + Migração A (schema, funções, RPCs)

**Files:**
- Create: `supabase/migrations/20260903000001_workspace_roles_a_additive.sql`

**Interfaces:**
- Produces (SQL, usados por TODAS as tasks seguintes):
  - tabela `public.workspace_roles(id uuid, conta_id uuid, nome text, permissions jsonb, created_at timestamptz)` com `UNIQUE (conta_id, nome)` e `UNIQUE (id, conta_id)`
  - colunas `workspace_members.role_id uuid NULL`, `invites.role_id uuid NULL`
  - `public.has_permission_for(p_user uuid, p_workspace uuid, p_module text, p_action text) RETURNS boolean` (EXECUTE: service_role)
  - `public.has_permission(p_module text, p_action text) RETURNS boolean` (EXECUTE: authenticated)
  - `public.validate_role_permissions(p jsonb) RETURNS boolean`
  - RPCs `public.create_workspace_role(p_actor, p_workspace, p_nome, p_permissions) RETURNS uuid`, `public.update_workspace_role(p_actor, p_workspace, p_role, p_nome, p_permissions) RETURNS text`, `public.delete_workspace_role(p_actor, p_workspace, p_role) RETURNS text` (EXECUTE: service_role; erros: `not_owner`, `invalid_name`, `invalid_permissions`, `duplicate_name`, `role_not_found`, `role_in_use`)
  - `accept_workspace_invite` atualizado (copia `role_id`, força `role='agent'` quando presente)

- [ ] **Step 1: Criar branch a partir de main atualizado**

```bash
git fetch origin main && git checkout -b ebs/permissoes-papeis-a origin/main
```

- [ ] **Step 2: Escrever a migração**

Criar `supabase/migrations/20260903000001_workspace_roles_a_additive.sql` com o conteúdo integral abaixo. O corpo de `accept_workspace_invite` deve ser copiado da versão ATUAL em `supabase/migrations/20260731000002_invite_membro_link.sql` (linhas 14–125) com APENAS as alterações marcadas — não reescrever do zero.

```sql
-- Permissões granulares, Migração A (aditiva): papéis customizados por workspace.
-- Nenhuma mudança de comportamento: membro sem role_id resolve pelo fallback
-- legado (role + can_see_financials), idêntico ao de antes desta migração.
-- Spec: docs/superpowers/specs/2026-09-02-permissoes-granulares-papeis-design.md

-- -------------------------------------------------------------
-- 1. Tabela de papéis
-- -------------------------------------------------------------
CREATE TABLE public.workspace_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, nome),
  -- Alvo das FKs compostas abaixo (tenant-pointer): garante NO BANCO que um
  -- role_id apontado pertence ao mesmo workspace, mesmo em caminhos
  -- service-role futuros que esqueçam a validação applicativa.
  UNIQUE (id, conta_id)
);
CREATE INDEX idx_workspace_roles_conta ON public.workspace_roles (conta_id);

ALTER TABLE public.workspace_roles ENABLE ROW LEVEL SECURITY;
-- Membros leem os papéis de qualquer workspace a que pertençam (precisam
-- renderizar o próprio papel). user_workspace_ids() é a função anti-recursão
-- de 20260612120000.
CREATE POLICY wr_select_member ON public.workspace_roles
  FOR SELECT USING (conta_id IN (SELECT public.user_workspace_ids()));
-- Escrita de cliente bloqueada: toda mutação via RPC service-role (padrão
-- workspace_members, 20260317).
CREATE POLICY wr_no_client_insert ON public.workspace_roles FOR INSERT WITH CHECK (false);
CREATE POLICY wr_no_client_update ON public.workspace_roles FOR UPDATE USING (false);
CREATE POLICY wr_no_client_delete ON public.workspace_roles FOR DELETE USING (false);

-- -------------------------------------------------------------
-- 2. Ponteiros de papel (FKs compostas, tenant-safe)
-- -------------------------------------------------------------
-- RESTRICT: excluir papel com membros falha; o dono reatribui antes.
ALTER TABLE public.workspace_members
  ADD COLUMN role_id uuid NULL,
  ADD CONSTRAINT wm_role_same_workspace
    FOREIGN KEY (role_id, workspace_id)
    REFERENCES public.workspace_roles (id, conta_id) ON DELETE RESTRICT;
CREATE INDEX idx_workspace_members_role_id
  ON public.workspace_members (role_id) WHERE role_id IS NOT NULL;

-- SET NULL (role_id): PG15+. Sem a lista de colunas, um SET NULL de FK
-- composta anularia TAMBÉM invites.conta_id.
ALTER TABLE public.invites
  ADD COLUMN role_id uuid NULL,
  ADD CONSTRAINT invites_role_same_workspace
    FOREIGN KEY (role_id, conta_id)
    REFERENCES public.workspace_roles (id, conta_id) ON DELETE SET NULL (role_id);

-- -------------------------------------------------------------
-- 3. Validação do jsonb de permissões
-- -------------------------------------------------------------
-- O catálogo de módulos vive aqui e em has_permission_for (preset agente).
-- Espelhos TS: apps/crm/src/lib/permissions.ts e
-- supabase/functions/_shared/permissions.ts. Paridade coberta por teste.
CREATE OR REPLACE FUNCTION public.validate_role_permissions(p jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  k text;
  v text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  FOR k, v IN SELECT key, value #>> '{}' FROM jsonb_each(p) LOOP
    IF k NOT IN ('clientes','entregas','calendario','aprovacoes','arquivos',
                 'ideias','tarefas','leads','financeiro','contratos','equipe',
                 'analytics','automacoes','configuracoes') THEN
      RETURN false;
    END IF;
    IF v IS NULL OR v NOT IN ('none','ver','editar') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- -------------------------------------------------------------
-- 4. Resolução central de permissão
-- -------------------------------------------------------------
-- Núcleo: usuário e workspace EXPLÍCITOS. Única fonte de verdade backend;
-- edge functions consomem via RPC (ex.: mcp-oauth-consent autoriza contra o
-- workspace do payload, não o ativo).
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

  -- Fallback legado: comportamento pré-papéis, byte a byte (exceto o delta
  -- documentado de automações no PR B).
  IF v_role = 'admin' THEN
    IF p_module = 'financeiro' THEN RETURN COALESCE(v_can_fin, false); END IF;
    RETURN true;
  END IF;

  -- agent: preset hardcoded (espelho de AGENT_PRESET nos dois arquivos TS).
  RETURN CASE p_module
    WHEN 'clientes'   THEN true
    WHEN 'entregas'   THEN true
    WHEN 'calendario' THEN true
    WHEN 'aprovacoes' THEN true
    WHEN 'arquivos'   THEN true
    WHEN 'ideias'     THEN true
    WHEN 'tarefas'    THEN true
    WHEN 'analytics'  THEN p_action = 'ver'
    WHEN 'automacoes' THEN p_action = 'ver'
    ELSE false
  END;
END;
$$;

-- Wrapper para RLS e clientes autenticados: usuário atual + workspace ativo.
CREATE OR REPLACE FUNCTION public.has_permission(p_module text, p_action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_permission_for(auth.uid(), public.get_my_conta_id(),
                                   p_module, p_action);
$$;

-- Grants (padrão can_see_financials, 20260728000001): enumerar os roles,
-- REVOKE FROM PUBLIC sozinho não basta.
REVOKE ALL ON FUNCTION public.has_permission_for(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission_for(uuid, uuid, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.has_permission(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(text, text) TO authenticated;

-- -------------------------------------------------------------
-- 5. RPCs de gestão de papéis (padrão set_financial_access)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_workspace_role(
  p_actor uuid, p_workspace uuid, p_nome text, p_permissions jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role text;
  v_id uuid;
BEGIN
  SELECT role INTO v_actor_role FROM public.workspace_members
   WHERE user_id = p_actor AND workspace_id = p_workspace;
  IF v_actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'not_owner'; END IF;

  IF p_nome IS NULL OR btrim(p_nome) = '' OR length(p_nome) > 60 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF NOT public.validate_role_permissions(p_permissions) THEN
    RAISE EXCEPTION 'invalid_permissions';
  END IF;

  BEGIN
    INSERT INTO public.workspace_roles (conta_id, nome, permissions)
    VALUES (p_workspace, btrim(p_nome), p_permissions)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_name';
  END;

  INSERT INTO public.audit_log
    (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (p_workspace, p_actor, 'role_created', 'workspace_role', v_id::text,
          jsonb_build_object('nome', btrim(p_nome), 'permissions', p_permissions));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_workspace_role(
  p_actor uuid, p_workspace uuid, p_role uuid, p_nome text, p_permissions jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role text;
  v_old public.workspace_roles%ROWTYPE;
BEGIN
  SELECT role INTO v_actor_role FROM public.workspace_members
   WHERE user_id = p_actor AND workspace_id = p_workspace;
  IF v_actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'not_owner'; END IF;

  SELECT * INTO v_old FROM public.workspace_roles
   WHERE id = p_role AND conta_id = p_workspace;
  IF NOT FOUND THEN RAISE EXCEPTION 'role_not_found'; END IF;

  IF p_nome IS NULL OR btrim(p_nome) = '' OR length(p_nome) > 60 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF NOT public.validate_role_permissions(p_permissions) THEN
    RAISE EXCEPTION 'invalid_permissions';
  END IF;

  -- No-op não escreve audit (mesma regra de set_financial_access).
  IF v_old.nome = btrim(p_nome) AND v_old.permissions = p_permissions THEN
    RETURN 'noop';
  END IF;

  BEGIN
    UPDATE public.workspace_roles
       SET nome = btrim(p_nome), permissions = p_permissions
     WHERE id = p_role AND conta_id = p_workspace;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_name';
  END;

  INSERT INTO public.audit_log
    (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (p_workspace, p_actor, 'role_updated', 'workspace_role', p_role::text,
          jsonb_build_object('old_nome', v_old.nome, 'nome', btrim(p_nome),
                             'old_permissions', v_old.permissions,
                             'permissions', p_permissions));
  RETURN 'updated';
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_workspace_role(
  p_actor uuid, p_workspace uuid, p_role uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role text;
  v_nome text;
  v_members int;
BEGIN
  SELECT role INTO v_actor_role FROM public.workspace_members
   WHERE user_id = p_actor AND workspace_id = p_workspace;
  IF v_actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'not_owner'; END IF;

  SELECT nome INTO v_nome FROM public.workspace_roles
   WHERE id = p_role AND conta_id = p_workspace;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'role_not_found'; END IF;

  -- Erro applicativo ANTES do RESTRICT da FK: mensagem estável para a UI.
  SELECT count(*) INTO v_members FROM public.workspace_members
   WHERE role_id = p_role;
  IF v_members > 0 THEN RAISE EXCEPTION 'role_in_use'; END IF;

  DELETE FROM public.workspace_roles WHERE id = p_role AND conta_id = p_workspace;

  INSERT INTO public.audit_log
    (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (p_workspace, p_actor, 'role_deleted', 'workspace_role', p_role::text,
          jsonb_build_object('nome', v_nome));
  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace_role(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_role(uuid, uuid, text, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.update_workspace_role(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_workspace_role(uuid, uuid, uuid, text, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.delete_workspace_role(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workspace_role(uuid, uuid, uuid)
  TO service_role;

-- -------------------------------------------------------------
-- 6. accept_workspace_invite: copia role_id, chassi 'agent'
-- -------------------------------------------------------------
-- CREATE OR REPLACE do corpo ATUAL (20260731000002_invite_membro_link.sql)
-- com exatamente três alterações:
--   (a) INSERT em workspace_members:
--         INSERT INTO workspace_members (user_id, workspace_id, role, role_id)
--         VALUES (p_user_id, v_invite.conta_id,
--                 CASE WHEN v_invite.role_id IS NOT NULL THEN 'agent' ELSE v_invite.role END,
--                 v_invite.role_id)
--         ON CONFLICT (user_id, workspace_id) DO UPDATE
--         SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;
--   (b) UPDATE profiles: role = CASE WHEN v_invite.role_id IS NOT NULL
--         THEN 'agent'::user_role ELSE v_invite.role::user_role END
--   (c) nada mais muda (membro-link e retorno ficam idênticos).
-- [COLAR AQUI o CREATE OR REPLACE FUNCTION completo com (a) e (b) aplicados]

-- -------------------------------------------------------------
-- 7. Realtime: sem entrar na publicação a subscription falha em silêncio
-- (precedente exato: workspace_members em 20260728000001).
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'workspace_roles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_roles;
    RAISE NOTICE 'added workspace_roles to supabase_realtime';
  ELSE
    RAISE NOTICE 'workspace_roles already in supabase_realtime';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 8. Post-conditions (padrão 20260728000003): grants das funções
-- -------------------------------------------------------------
DO $$
DECLARE
  fn text;
  acl text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['has_permission_for','create_workspace_role',
                            'update_workspace_role','delete_workspace_role'] LOOP
    SELECT array_to_string(p.proacl, ',') INTO acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = fn;
    IF acl IS NULL OR acl NOT LIKE '%service_role=X%' THEN
      RAISE EXCEPTION '%: service_role lacks EXECUTE — acl=%', fn, acl;
    END IF;
    IF acl LIKE '%authenticated=X%' OR acl LIKE '%anon=X%'
       OR acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
      RAISE EXCEPTION '%: authenticated/anon/PUBLIC retains EXECUTE — acl=%', fn, acl;
    END IF;
  END LOOP;

  SELECT array_to_string(p.proacl, ',') INTO acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_permission';
  IF acl IS NULL OR acl NOT LIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'has_permission: authenticated lacks EXECUTE — acl=%', acl;
  END IF;
  IF acl LIKE '%anon=X%' OR acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
    RAISE EXCEPTION 'has_permission: anon/PUBLIC retains EXECUTE — acl=%', acl;
  END IF;
END $$;
```

Ao colar o bloco (6), abrir `supabase/migrations/20260731000002_invite_membro_link.sql`, copiar o `CREATE OR REPLACE FUNCTION public.accept_workspace_invite` inteiro e aplicar as alterações (a) e (b) indicadas.

- [ ] **Step 3: Aplicar localmente e verificar post-conditions**

Com Docker/colima disponível:

```bash
npx supabase start && npx supabase db reset
```

Expected: reset aplica todas as migrations sem erro (as post-conditions do passo 8 abortariam num grant errado). Sem Docker: registrar no PR que a validação local ficou para o CI (`entitlement-tests` roda `supabase start` + as suítes).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260903000001_workspace_roles_a_additive.sql
git commit -m "feat(equipe): migração A de papéis customizados (workspace_roles, has_permission, RPCs)"
```

---

### Task 2: Suítes psql do modelo (PR A)

**Files:**
- Create: `supabase/tests/entitlements/72_workspace_roles_permissions.sql`
- Create: `supabase/tests/entitlements/73_workspace_role_rpcs.sql`
- Create: `supabase/tests/entitlements/74_invite_role_id.sql`

**Interfaces:**
- Consumes: tudo da Task 1.
- Produces: tabela-verdade com IDs de caso `TT-01..TT-20` — os MESMOS ids usados no Vitest da Task 7 (paridade por inspeção + contagem).

- [ ] **Step 1: Escrever `72_workspace_roles_permissions.sql`**

Seguir o formato exato de `supabase/tests/entitlements/50_can_see_financials.sql` (ON_ERROR_STOP, `\i _helpers.sql`, blocos `begin; do $$ ... $$; rollback;`, `et_make_workspace('max')`, insert em `auth.users` + `workspace_members`, anular `active_workspace_id` de não-participantes, `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated` para o wrapper). Casos, com o id no `raise notice`:

```
-- Tabela-verdade has_permission_for (via service path: chamar direto como
-- postgres no DO block; o wrapper has_permission é testado à parte):
-- TT-01 owner, qualquer módulo/ação => true (financeiro/editar incluso)
-- TT-02 admin legado can_see=true: financeiro/ver=true, financeiro/editar=true
-- TT-03 admin legado can_see=false: financeiro/ver=false, financeiro/editar=false
-- TT-04 admin legado: leads/editar=true, configuracoes/editar=true
-- TT-05 agent legado: clientes/editar=true, tarefas/editar=true
-- TT-06 agent legado: analytics/ver=true, analytics/editar=false
-- TT-07 agent legado: automacoes/ver=true, automacoes/editar=false
-- TT-08 agent legado: leads/ver=false, financeiro/ver=false, equipe/ver=false,
--        contratos/ver=false, configuracoes/ver=false
-- TT-09 papel custom {"leads":"editar"}: leads/ver=true, leads/editar=true
-- TT-10 papel custom {"leads":"ver"}: leads/ver=true, leads/editar=false
-- TT-11 papel custom {"leads":"none"}: leads/ver=false
-- TT-12 papel custom, módulo ausente do jsonb: clientes/ver=false (falha fechada)
-- TT-13 papel custom {}: tudo false
-- TT-14 sem membership: false
-- TT-15 ação inválida ('excluir'): false; módulo inexistente ('xyz'): false
-- TT-16 papel custom em membro com role='agent' e can_see_financials=true:
--        financeiro/ver segue o PAPEL (false se ausente), o flag legado é ignorado
-- Wrapper has_permission (com jwt.claims + SET LOCAL ROLE authenticated):
-- TT-17 owner ativo => true; agent ativo leads/ver => false
-- TT-18 anon não executa has_permission (insufficient_privilege)
-- TT-19 authenticated NÃO executa has_permission_for (insufficient_privilege)
-- Estrutura:
-- TT-20 workspace_roles presente em pg_publication_tables (supabase_realtime);
--        FK composta: INSERT workspace_members com role_id de OUTRO workspace
--        falha com foreign_key_violation; DELETE de papel com membro falha
--        (foreign_key_violation via RESTRICT, testado com DELETE direto);
--        invites: DELETE de papel anula role_id e PRESERVA conta_id.
```

Cada caso é um `if ... then raise exception` com mensagem contendo o id; sucesso emite `raise notice '72: TT-xx ok'`.

- [ ] **Step 2: Escrever `73_workspace_role_rpcs.sql`**

Casos (mesmo formato):

```
-- RPC-01 create por owner: retorna uuid; linha em workspace_roles; audit_log
--        tem action='role_created' com resource_id = uuid
-- RPC-02 create por admin => raise not_owner; por agent => not_owner
-- RPC-03 create nome vazio => invalid_name; nome duplicado (mesmo conta) =>
--        duplicate_name; mesmo nome em OUTRO workspace => ok
-- RPC-04 create permissions inválidas ({"foo":"ver"} e {"leads":"talvez"})
--        => invalid_permissions
-- RPC-05 update por owner muda nome+permissions => 'updated' + audit
--        role_updated; update idêntico => 'noop' e NENHUM audit novo
-- RPC-06 update de papel de outro workspace => role_not_found
-- RPC-07 delete sem membros => 'deleted' + audit role_deleted
-- RPC-08 delete com membro apontando => role_in_use (e a linha sobrevive)
-- RPC-09 authenticated não executa nenhuma das três RPCs (insufficient_privilege)
```

- [ ] **Step 3: Escrever `74_invite_role_id.sql`**

```
-- INV-01 invite com role_id: accept_workspace_invite cria membership com
--        role='agent' E role_id copiado; profiles.role='agent'
-- INV-02 invite sem role_id: comportamento atual intacto (role copiado,
--        role_id NULL) — regressão do fluxo legado
-- INV-03 membro-link continua: invite com membro_id + role_id linka
--        membros.crm_user_id
```

Montar o cenário como os testes existentes: inserir manualmente em `auth.users`, `profiles` (com `conta_id` apontado para o workspace do convite, que é o pré-requisito do RPC), `invites` (status pending, `expires_at > now()`), depois `PERFORM accept_workspace_invite(v_user)` e assertar as linhas.

- [ ] **Step 4: Rodar as suítes**

```bash
bash scripts/test-entitlements.sh
```

Expected: PASS nos três arquivos novos e em TODOS os pré-existentes (a Migração A não pode quebrá-los). Sem Docker: registrar que fica para o CI.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/entitlements/7[234]_*.sql
git commit -m "test(equipe): suítes psql do modelo de papéis (truth table, RPCs, convites)"
```

---

### Task 3: `_shared/permissions.ts` (catálogo Deno + wrapper RPC)

**Files:**
- Create: `supabase/functions/_shared/permissions.ts`
- Create: `supabase/functions/__tests__/permissions-shared_test.ts`

**Interfaces:**
- Produces (consumido pelas Tasks 4, 5, 6 e PR B):
  - `PERMISSION_MODULES: readonly string[]` (os 14 slugs)
  - `validateRolePermissions(input: unknown): string | null` (null = ok; senão código do erro: `'invalid_shape' | 'invalid_module' | 'invalid_level'`)
  - `hasPermissionFor(svc: SupabaseClient-like, userId: string, workspaceId: string, module: string, action: 'ver' | 'editar'): Promise<boolean>` — chama `svc.rpc('has_permission_for', { p_user, p_workspace, p_module, p_action })`; QUALQUER erro ⇒ `false` (falha fechada) com `console.error`.

- [ ] **Step 1: Escrever o teste (falha por módulo ausente)**

```ts
// supabase/functions/__tests__/permissions-shared_test.ts
import { assertEquals } from "./assert.ts";
import {
  PERMISSION_MODULES,
  validateRolePermissions,
  hasPermissionFor,
} from "../_shared/permissions.ts";

Deno.test("catálogo tem exatamente os 14 módulos da spec", () => {
  assertEquals([...PERMISSION_MODULES].sort(), [
    "analytics", "aprovacoes", "arquivos", "automacoes", "calendario",
    "clientes", "configuracoes", "contratos", "entregas", "equipe",
    "financeiro", "ideias", "leads", "tarefas",
  ]);
});

Deno.test("validateRolePermissions aceita payload válido e rejeita inválidos", () => {
  assertEquals(validateRolePermissions({ clientes: "editar", leads: "none" }), null);
  assertEquals(validateRolePermissions({}), null);
  assertEquals(validateRolePermissions(null), "invalid_shape");
  assertEquals(validateRolePermissions([]), "invalid_shape");
  assertEquals(validateRolePermissions({ foo: "ver" }), "invalid_module");
  assertEquals(validateRolePermissions({ leads: "talvez" }), "invalid_level");
});

Deno.test("hasPermissionFor devolve o boolean do RPC e falha fechado em erro", async () => {
  const okClient = { rpc: () => Promise.resolve({ data: true, error: null }) };
  assertEquals(await hasPermissionFor(okClient as never, "u", "w", "leads", "ver"), true);
  const errClient = { rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  assertEquals(await hasPermissionFor(errClient as never, "u", "w", "leads", "ver"), false);
  const throwClient = { rpc: () => Promise.reject(new Error("net")) };
  assertEquals(await hasPermissionFor(throwClient as never, "u", "w", "leads", "ver"), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
deno test supabase/functions/__tests__/permissions-shared_test.ts
```

Expected: FAIL (módulo `../_shared/permissions.ts` não existe).

- [ ] **Step 3: Implementar `_shared/permissions.ts`**

```ts
// Catálogo de permissões e wrapper do RPC has_permission_for.
// Espelhos: public.validate_role_permissions / has_permission_for (SQL) e
// apps/crm/src/lib/permissions.ts (frontend). Paridade coberta por teste.
export const PERMISSION_MODULES = [
  "clientes", "entregas", "calendario", "aprovacoes", "arquivos", "ideias",
  "tarefas", "leads", "financeiro", "contratos", "equipe", "analytics",
  "automacoes", "configuracoes",
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export type PermissionLevel = "none" | "ver" | "editar";
export type PermissionAction = "ver" | "editar";

const LEVELS: ReadonlySet<string> = new Set(["none", "ver", "editar"]);
const MODULES: ReadonlySet<string> = new Set(PERMISSION_MODULES);

export function validateRolePermissions(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return "invalid_shape";
  }
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!MODULES.has(k)) return "invalid_module";
    if (typeof v !== "string" || !LEVELS.has(v)) return "invalid_level";
  }
  return null;
}

/**
 * Permissão de um usuário num workspace EXPLÍCITO, resolvida pelo núcleo SQL
 * (única fonte de verdade backend). Falha FECHADA: qualquer erro nega.
 */
export async function hasPermissionFor(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  workspaceId: string,
  module: PermissionModule | string,
  action: PermissionAction,
): Promise<boolean> {
  try {
    const { data, error } = await svc.rpc("has_permission_for", {
      p_user: userId, p_workspace: workspaceId,
      p_module: module, p_action: action,
    });
    if (error) {
      console.error("[permissions:hasPermissionFor]", error);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("[permissions:hasPermissionFor]", e);
    return false;
  }
}
```

- [ ] **Step 4: Rodar e ver passar; commit**

```bash
deno test supabase/functions/__tests__/permissions-shared_test.ts
git add supabase/functions/_shared/permissions.ts supabase/functions/__tests__/permissions-shared_test.ts
git commit -m "feat(equipe): catálogo compartilhado de permissões e wrapper has_permission_for (Deno)"
```

---

### Task 4: Edge function `manage-workspace-roles`

**Files:**
- Create: `supabase/functions/manage-workspace-roles/index.ts`
- Create: `supabase/functions/__tests__/manage-workspace-roles_test.ts`

**Interfaces:**
- Consumes: RPCs da Task 1; `validateRolePermissions` da Task 3; `buildCorsHeaders` de `_shared/cors.ts`.
- Produces: POST com body `{ action: 'create' | 'update' | 'delete', roleId?: string, nome?: string, permissions?: Record<string,string> }` → `200 {role_id}` / `200 {message}`; erros `401`, `403 {error:'not_owner'}`, `400 {error:'invalid_name'|'invalid_permissions'}`, `409 {error:'duplicate_name'|'role_in_use'}`, `404 {error:'role_not_found'}`. Consumido por `store/roles.ts` (Task 8).

- [ ] **Step 1: Escrever o teste primeiro**

Testar a lógica pura extraída (mesmo padrão dos testes deno existentes que não sobem servidor): extrair um `handleRoleAction(deps, { userId, workspaceId, body })` exportado de um `handler.ts`, onde `deps.svc` é injetado. Casos:

```ts
// supabase/functions/__tests__/manage-workspace-roles_test.ts
// - create feliz: chama rpc('create_workspace_role') com p_actor/p_workspace/
//   p_nome/p_permissions e devolve { status: 200, body: { role_id } }
// - validação local ANTES do RPC: nome vazio => 400 invalid_name sem chamar rpc;
//   permissions {"foo":"ver"} => 400 invalid_permissions sem chamar rpc
// - mapeamento de erros do RPC (error.message contém o código):
--   not_owner=>403, duplicate_name=>409, role_in_use=>409, role_not_found=>404,
--   invalid_permissions=>400, qualquer outro => 500 {error:'Internal server error'}
// - update exige roleId uuid; delete exige roleId uuid => 400 quando ausente
// - action desconhecida => 400
```

(Escrever as asserções concretas com um stub `svc = { rpc: spy }`.)

- [ ] **Step 2: Rodar e ver falhar**

```bash
deno test supabase/functions/__tests__/manage-workspace-roles_test.ts
```

- [ ] **Step 3: Implementar**

`manage-workspace-roles/index.ts` segue `manage-workspace-user/index.ts` na resolução do chamador (linhas 22–156 de lá): CORS via `buildCorsHeaders`, `Authorization` obrigatório, `anonClient.auth.getUser()`, `serviceClient`, workspace = `profiles.active_workspace_id`. NÃO exigir owner no index (a RPC já nega com `not_owner`; o index apenas repassa) — evita duplicar a checagem em dois lugares que podem divergir. Delegar para `handleRoleAction` (em `manage-workspace-roles/handler.ts`) que valida payload com `validateRolePermissions`, chama a RPC correspondente e mapeia os erros conforme o teste. Nunca vazar `error.message` cru que não seja um dos códigos conhecidos: erro desconhecido vira `{ error: "Internal server error" }` + `console.error` interno (regra de segurança do CLAUDE.md).

- [ ] **Step 4: Rodar testes; typecheck deno; commit**

```bash
deno test supabase/functions/__tests__/manage-workspace-roles_test.ts && deno check supabase/functions/manage-workspace-roles/index.ts
git add supabase/functions/manage-workspace-roles supabase/functions/__tests__/manage-workspace-roles_test.ts
git commit -m "feat(equipe): edge function manage-workspace-roles (CRUD de papéis, só dono via RPC)"
```

---

### Task 5: `manage-workspace-user` aceita `role_id`

**Files:**
- Modify: `supabase/functions/manage-workspace-user/index.ts:216-252`
- Create/Modify: `supabase/functions/__tests__/manage-workspace-user-role_test.ts` (criar se não existir teste do update-role; senão estender o existente)

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `update-role` aceita body `{ role: 'owner'|'admin'|'agent' }` OU `{ roleId: uuid }` (mutuamente exclusivos). Com `roleId`: membership vira `{ role: 'agent', role_id: roleId }`, profiles espelha `'agent'`, audit metadata ganha `{ new_role: 'agent', role_id, role_nome }`. Consumido por `updateWorkspaceUserRole` (Task 13).

- [ ] **Step 1: Teste primeiro** — extrair a decisão pura para função exportada `resolveRoleUpdate({ role, roleId, callerRole, targetRoleRow })` num novo `manage-workspace-user/roleUpdate.ts` e testar:

```ts
// casos:
// - role e roleId juntos => { error: 'role_and_role_id_exclusive', status: 400 }
// - nenhum dos dois => { error: 'role_required', status: 400 }
// - role inválida ('x') => 400; role 'owner' com caller admin => 403
// - roleId não-uuid => 400 { error: 'invalid_role_id' }
// - roleId com targetRoleRow null (não achado no workspace) => 404
//   { error: 'role_not_found' }
// - roleId ok => { update: { role: 'agent', role_id }, profileRole: 'agent',
//   audit: { new_role: 'agent', role_id, role_nome } }
// - role preset ok => { update: { role, role_id: null }, profileRole: role, ... }
```

- [ ] **Step 2: Rodar e ver falhar; implementar**

No `index.ts`, dentro do bloco `action === "update-role"`: ler `roleId` do body; quando presente, buscar `serviceClient.from('workspace_roles').select('id, nome').eq('id', roleId).eq('conta_id', workspaceId).maybeSingle()` e passar como `targetRoleRow`; aplicar o resultado de `resolveRoleUpdate` (o `.update({...})` de workspace_members passa a escrever `role` E `role_id`; o de profiles usa `profileRole`; o audit usa `audit`). Travas existentes (não modificar owner sem ser owner, não modificar a si mesmo, só owner atribui owner) permanecem intactas ANTES desse bloco — não tocar.

- [ ] **Step 3: Rodar; commit**

```bash
deno test supabase/functions/__tests__/manage-workspace-user-role_test.ts && deno check supabase/functions/manage-workspace-user/index.ts
git add supabase/functions/manage-workspace-user supabase/functions/__tests__/manage-workspace-user-role_test.ts
git commit -m "feat(equipe): update-role aceita role_id (papel custom vira chassi agent)"
```

---

### Task 6: `role_id` atravessa o fluxo de convites

**Files:**
- Modify: `supabase/functions/_shared/invite-actions.ts` (interface `InviteOrResendInput`, rotas `add-direct` ~linhas 311–342, `resend-link` ~345–362, `sendNewUserInvite` ~394–423)
- Modify: `supabase/functions/invite-user/index.ts` (~linhas 125–140 e a chamada a `inviteOrResend`)
- Modify: `supabase/functions/platform-admin/invite-handlers.ts` (~linhas 100–130)
- Modify/Create: testes deno correspondentes (procurar os existentes com `ls supabase/functions/__tests__/ | grep -i invite`; estender; se não houver, criar `invite-actions-role-id_test.ts`)

**Interfaces:**
- Consumes: coluna `invites.role_id` (Task 1).
- Produces: `InviteOrResendInput` ganha `roleId?: string | null`; TODOS os INSERTs de `invites` no arquivo levam `role_id: input.roleId ?? null`; o INSERT de `workspace_members` na rota `add-direct` vira `{ user_id, workspace_id: input.contaId, role: input.roleId ? 'agent' : input.role, role_id: input.roleId ?? null }` (e o INSERT de `profiles` logo abaixo usa o mesmo role calculado); `invite-user` aceita `role_id` no body; `platform-admin` resend seleciona e repassa `role_id`.

- [ ] **Step 1: Testes primeiro.** Nos testes de `inviteOrResend` (stub de adminClient), acrescentar: (i) rota nova com `roleId` insere `invites.role_id`; (ii) `add-direct` com `roleId` insere membership `role='agent'` + `role_id`; (iii) `resend-link` re-insere o convite preservando `role_id`; (iv) sem `roleId` os inserts levam `role_id: null` (regressão). Para `invite-user`: body com `role_id` inválido (não-uuid) => 400; `role_id` de outro workspace => 400 (validar com select em `workspace_roles` por `id` + `conta_id`); com `role_id` válido o `role` efetivo enviado ao `inviteOrResend` é o do body (mantido para exibição legada em `invites.role`) e `roleId` vai junto. Para `platform-admin`: o select do convite passa a incluir `role_id` e o repassa no input.

- [ ] **Step 2: Rodar e ver falhar; implementar as três pontas.**

Em `invite-user/index.ts`, após a validação atual de `role` (linhas 125–137), acrescentar:

```ts
const roleId: string | null = typeof body.role_id === "string" ? body.role_id : null;
if (roleId) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(roleId)) throw new Error("Papel inválido.");
  const { data: roleRow } = await adminClient
    .from("workspace_roles").select("id")
    .eq("id", roleId).eq("conta_id", caller.conta_id).maybeSingle();
  if (!roleRow) throw new Error("Papel inválido.");
}
```

e repassar `roleId` no input de `inviteOrResend`. (Ajustar `caller.conta_id` para o nome real da variável de workspace do arquivo.)

Em `platform-admin/invite-handlers.ts`, no select do convite trocar `"id, conta_id, email, role, status, invited_by"` por `"id, conta_id, email, role, role_id, status, invited_by"` e passar `roleId: invite.role_id ?? null` no input.

- [ ] **Step 3: Rodar TODA a suíte deno (mudança de contrato pode quebrar testes existentes de convite); commit**

```bash
npm run test:functions
git add supabase/functions/_shared/invite-actions.ts supabase/functions/invite-user supabase/functions/platform-admin supabase/functions/__tests__/
git checkout deno.lock 2>/dev/null || true
git commit -m "feat(equipe): role_id atravessa inviteOrResend, invite-user e resend do platform-admin"
```

---

### Task 7: Frontend: catálogo, `derivePermission`, membership e `can()`

**Files:**
- Create: `apps/crm/src/lib/permissions.ts`
- Create: `apps/crm/src/lib/__tests__/permissions.test.ts`
- Modify: `apps/crm/src/lib/financialAccess.ts:23-34`
- Modify: `apps/crm/src/store/workspace.ts:223-259`
- Modify: `apps/crm/src/context/AuthContext.tsx` (interface `AuthContextValue`, hidratação, `applyMembership`, value)

**Interfaces:**
- Consumes: `MyMembership` estendido; select com embed de `workspace_roles`.
- Produces (consumido por TODO o PR B):
  - `PERMISSION_MODULES`, `PermissionModule`, `PermissionAction = 'ver'|'editar'`, `PermissionLevel`, `PermissionCheck = boolean | 'unknown'`, `AGENT_PRESET: Record<PermissionModule, PermissionLevel>`
  - `derivePermission(membership: MyMembership | null, module: PermissionModule, action: PermissionAction): PermissionCheck`
  - `MyMembership = { role: 'owner'|'admin'|'agent'; can_see_financials: boolean; role_id: string | null; permissions: Record<string, string> | null }`
  - AuthContext expõe `can(module: PermissionModule, action?: PermissionAction) => PermissionCheck` (default `'ver'`) e mantém `canSeeFinancials` com o MESMO comportamento.

- [ ] **Step 1: Teste primeiro** — `permissions.test.ts` com a MESMA tabela-verdade da Task 2 (ids `TT-01..TT-16`; os TT-17..20 são de infraestrutura SQL e não têm espelho TS). Estrutura:

```ts
import { describe, expect, it } from 'vitest';
import { AGENT_PRESET, PERMISSION_MODULES, derivePermission } from '../permissions';
import type { MyMembership } from '@/store/workspace';

const legacy = (role: MyMembership['role'], canFin = true): MyMembership => ({
  role, can_see_financials: canFin, role_id: null, permissions: null,
});
const custom = (permissions: Record<string, string>): MyMembership => ({
  role: 'agent', can_see_financials: true, role_id: 'r-1', permissions,
});

// TT-01
it('owner: tudo true', () => {
  for (const m of PERMISSION_MODULES) {
    expect(derivePermission(legacy('owner', false), m, 'editar')).toBe(true);
  }
});
// TT-02/03/04 admin legado; TT-05..08 agent legado (iterar AGENT_PRESET e
// assertar derivePermission contra o nível declarado); TT-09..13 papel custom;
// TT-14 membership null => 'unknown' (equivalente TS do caso: no cliente,
// "sem membership resolvida" é 'unknown', não false — documentar no teste);
// TT-15 ação/módulo inválidos => false; TT-16 flag legado ignorado com papel.
// Paridade extra: deriveFinancialAccess(m) === derivePermission(m,'financeiro','ver')
// para as 6 formas de membership (owner, admin±flag, agent, custom com/sem financeiro).
// Snapshot congelando AGENT_PRESET (mudança acidental do preset falha o teste).
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run apps/crm/src/lib/__tests__/permissions.test.ts
```

- [ ] **Step 3: Implementar `lib/permissions.ts`**

```ts
import type { MyMembership } from '@/store/workspace';

export const PERMISSION_MODULES = [
  'clientes', 'entregas', 'calendario', 'aprovacoes', 'arquivos', 'ideias',
  'tarefas', 'leads', 'financeiro', 'contratos', 'equipe', 'analytics',
  'automacoes', 'configuracoes',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export type PermissionAction = 'ver' | 'editar';
export type PermissionLevel = 'none' | 'ver' | 'editar';
/** 'unknown' = membership não resolvida: rotas falham neutro, valores fecham. */
export type PermissionCheck = boolean | 'unknown';

/**
 * Espelho EXATO do preset agente hardcoded em public.has_permission_for e em
 * supabase/functions/_shared/permissions.ts. Mudou lá, muda aqui, e o teste
 * de paridade (TT-05..08) + o pgTAP 72 precisam mudar juntos.
 */
export const AGENT_PRESET: Record<PermissionModule, PermissionLevel> = {
  clientes: 'editar', entregas: 'editar', calendario: 'editar',
  aprovacoes: 'editar', arquivos: 'editar', ideias: 'editar', tarefas: 'editar',
  analytics: 'ver', automacoes: 'ver',
  leads: 'none', financeiro: 'none', contratos: 'none', equipe: 'none',
  configuracoes: 'none',
};

const LEVELS = new Set<string>(['none', 'ver', 'editar']);

function levelAllows(level: string | undefined, action: PermissionAction): boolean {
  if (!level || !LEVELS.has(level)) return false;
  return level === 'editar' || (level === 'ver' && action === 'ver');
}

/** Espelho TS de public.has_permission_for. Tabela-verdade única: TT-01..16. */
export function derivePermission(
  membership: MyMembership | null,
  module: PermissionModule,
  action: PermissionAction,
): PermissionCheck {
  if (!membership) return 'unknown';
  if (!(PERMISSION_MODULES as readonly string[]).includes(module)) return false;
  if (membership.role === 'owner') return true;
  if (membership.permissions !== null) {
    return levelAllows(membership.permissions[module] ?? 'none', action);
  }
  if (membership.role === 'admin') {
    if (module === 'financeiro') return membership.can_see_financials;
    return true;
  }
  return levelAllows(AGENT_PRESET[module], action);
}
```

Em `financialAccess.ts`, `deriveFinancialAccess` vira delegação (mantendo tipo e doc):

```ts
export function deriveFinancialAccess(membership: MyMembership | null): FinancialAccess {
  return derivePermission(membership, 'financeiro', 'ver');
}
```

(import de `derivePermission` no topo; NÃO mudar `formatFinancialBRL`/`stripFinancialFields`/`assertNoFinancialColumns`.)

Em `store/workspace.ts`, estender o tipo e o select:

```ts
export interface MyMembership {
  role: 'owner' | 'admin' | 'agent';
  can_see_financials: boolean;
  role_id: string | null;
  /** permissions do papel custom; null quando role_id é null (fallback legado). */
  permissions: Record<string, string> | null;
}
```

e em `getMyMembership()` o select vira
`'role, can_see_financials, role_id, workspace_roles(permissions)'`, com flatten:

```ts
if (error) throw error;
if (!data) return null;
const row = data as unknown as {
  role: MyMembership['role']; can_see_financials: boolean;
  role_id: string | null;
  workspace_roles: { permissions: Record<string, string> } | null;
};
return {
  role: row.role,
  can_see_financials: row.can_see_financials,
  role_id: row.role_id ?? null,
  permissions: row.workspace_roles?.permissions ?? null,
};
```

- [ ] **Step 4: AuthContext**

1. Novo estado `const [membership, setMembership] = useState<MyMembership | null>(null);` — passa a ser a fonte de `workspaceRole`/`canSeeFinancials` (setados juntos, como hoje). Nos QUATRO pontos que hoje resetam `workspaceRole`/`canSeeFinancials` (userChanged, sem userId, catch da hidratação, signOut), resetar `membership` para `null` também.
2. Na hidratação (linha ~235): `setMembership(membershipRow)` junto dos sets atuais.
3. Em `applyMembership` (linha ~405): o payload realtime NÃO traz `permissions` (é linha crua de `workspace_members`). Regra nova no handler do canal (linha ~526): se `row.role_id != null` OU `row.role_id !== (membershipRef.current?.role_id ?? null)`, disparar `void getMyMembership().then(applyMembership).catch(() => {})` em vez de aplicar o payload cru; senão aplicar `{ ...row, role_id: null, permissions: null }` como hoje. Manter um `membershipRef` sincronizado como o `canSeeFinancialsRef` existente. `applyMembership` passa a receber `MyMembership | null` e setar `membership` + derivar como hoje.
4. Interface e value:

```ts
can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck;
```

```ts
const can = useCallback(
  (module: PermissionModule, action: PermissionAction = 'ver') =>
    derivePermission(membership, module, action),
  [membership],
);
```

`canSeeFinancials` continua um valor no contexto (não recomputar nos consumidores): mantê-lo como estado derivado igual hoje (`deriveFinancialAccess(membership)` nos mesmos pontos). Comportamento observável idêntico: PR A não muda nenhum consumidor.

- [ ] **Step 5: Rodar testes, typecheck, suite inteira**

```bash
npx vitest run apps/crm/src/lib/__tests__/permissions.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run test
```

Expected: PASS. Se testes existentes mockam `getMyMembership`/`MyMembership` (grep: `grep -rln "getMyMembership\|MyMembership" apps/crm/src --include='*.test.*'`), atualizar os mocks com `role_id: null, permissions: null` (mudança de contrato: atualizar as DUAS suítes, regra da casa).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/lib apps/crm/src/store/workspace.ts apps/crm/src/context/AuthContext.tsx
git commit -m "feat(equipe): derivePermission + can() no AuthContext (fallback legado, sem mudança observável)"
```

---

### Task 8: Store de papéis + aba "Papéis" (só dono)

**Files:**
- Create: `apps/crm/src/store/roles.ts`
- Modify: `apps/crm/src/store/index.ts` (re-export)
- Create: `apps/crm/src/pages/configuracao/tabs/PapeisTab.tsx`
- Modify: `apps/crm/src/pages/configuracao/configTabs.ts` (nova aba)
- Modify: `apps/crm/src/App.tsx:209-220` (nova rota filha `papeis`)
- Create: `apps/crm/src/pages/configuracao/tabs/__tests__/PapeisTab.test.tsx`

**Interfaces:**
- Consumes: RLS de select de `workspace_roles` (Task 1), edge `manage-workspace-roles` (Task 4), `PERMISSION_MODULES`/`AGENT_PRESET` (Task 7), `getWorkspaceUsers` (para contagem de membros por papel — estendida na Task 13; AQUI usar select próprio, ver Step 3).
- Produces:
  - `WorkspaceRole = { id: string; nome: string; permissions: Record<string, string>; created_at: string }`
  - `getWorkspaceRoles(): Promise<WorkspaceRole[]>` (select direto, ordenado por nome)
  - `createWorkspaceRole(nome, permissions)`, `updateWorkspaceRole(roleId, nome, permissions)`, `deleteWorkspaceRole(roleId)` — POSTs ao edge function no padrão de `callManageWorkspaceUser` (workspace.ts:186-206), lançando `Error` com o código do backend (`role_in_use` etc.)

- [ ] **Step 1: Teste primeiro (`PapeisTab.test.tsx`)** — seguir o padrão dos testes de componente existentes em `apps/crm/src/pages/**/__tests__/` (render com providers mockados). Casos: (i) renderiza os presets "Administrador" e "Agente" com selo "Padrão do sistema" e sem botão Editar/Excluir; (ii) renderiza papéis customizados vindos do mock de `getWorkspaceRoles` com contagem de membros; (iii) grade de criação mostra os 14 módulos com 3 opções e "Criar papel" chama `createWorkspaceRole` com o jsonb montado; (iv) excluir papel com membros mostra o erro `role_in_use` como toast com a mensagem "Reatribua os membros antes de excluir este papel."; (v) para `workspaceRole !== 'owner'` nada renderiza (a aba nem deveria montar: guard é do layout, mas o componente retorna null defensivamente).

- [ ] **Step 2: Rodar e ver falhar; implementar o store**

`store/roles.ts`:

```ts
import { supabase } from './core';
import { getContaId } from './core';

export interface WorkspaceRole {
  id: string;
  nome: string;
  permissions: Record<string, string>;
  created_at: string;
}

export async function getWorkspaceRoles(): Promise<WorkspaceRole[]> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspace_roles')
    .select('id, nome, permissions, created_at')
    .eq('conta_id', contaId)
    .order('nome', { ascending: true });
  if (error) throw error;
  return (data ?? []) as WorkspaceRole[];
}

async function callManageWorkspaceRoles(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const session = (await supabase.auth.getSession()).data.session;
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-workspace-roles`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Erro HTTP ${response.status}`);
  return result;
}

export async function createWorkspaceRole(
  nome: string,
  permissions: Record<string, string>,
): Promise<void> {
  await callManageWorkspaceRoles({ action: 'create', nome, permissions });
}
export async function updateWorkspaceRole(
  roleId: string,
  nome: string,
  permissions: Record<string, string>,
): Promise<void> {
  await callManageWorkspaceRoles({ action: 'update', roleId, nome, permissions });
}
export async function deleteWorkspaceRole(roleId: string): Promise<void> {
  await callManageWorkspaceRoles({ action: 'delete', roleId });
}
```

Re-exportar em `store/index.ts` seguindo o padrão do barrel.

- [ ] **Step 3: Implementar `PapeisTab.tsx`**

Estrutura (shadcn + padrões de MembrosTab):
- Guard defensivo: `const { workspaceRole } = useAuth(); if (workspaceRole !== 'owner') return null;`
- `useQuery(['workspace-roles'], getWorkspaceRoles)` + `useQuery(['workspace-users'], getWorkspaceUsers)` para contagem por `role_id` (`wsUsers.filter(u => u.role_id === role.id).length` — o campo chega na Task 13; até lá a contagem cai em 0, aceitável dentro do PR A pois nenhum membro tem papel ainda; deixar `// role_id chega em getWorkspaceUsers no PR B` NO CÓDIGO é proibido: em vez disso, usar select local `supabase.from('workspace_members').select('user_id, role_id').eq('workspace_id', ...)` via query própria `['workspace-role-members']`).
- Lista: dois cards fixos "Administrador" e "Agente" com `Badge` "Padrão do sistema" e grade somente leitura (derivada de: admin = tudo `editar`; agente = `AGENT_PRESET`), depois os papéis customizados com contagem e botões Editar/Excluir.
- Dialog criar/editar: `Input` nome + seletor de preset de partida (Administrador/Agente/Em branco) que preenche o estado + grade de 14 linhas (label do módulo, `Select` com "Sem acesso"/"Pode ver"/"Pode editar"). Labels dos módulos: Clientes, Entregas, Calendário, Aprovações, Arquivos, Ideias, Tarefas, Leads, Financeiro, Contratos, Equipe, Analytics e Relatórios, Automações, Configurações do workspace.
- Nota de transparência (rodapé do dialog, `--text-muted`): "Financeiro, Contratos, Leads, Automações e Configurações são aplicados no servidor. Os demais módulos são aplicados na interface do CRM."
- Excluir: `AlertDialog`; erro `role_in_use` vira toast "Reatribua os membros antes de excluir este papel."
- Editar papel em uso: aviso no dialog "As mudanças valem na hora para os membros com este papel." (contagem > 0).
- Mutations com `useMutation` + invalidate `['workspace-roles']`.

Em `configTabs.ts`, adicionar após `membros` (mesmo grupo Workspace):

```ts
{ path: 'papeis', label: 'Papéis', roles: ['owner'], group: 'Workspace', icon: ShieldCheck },
```

(import `ShieldCheck` de lucide.) Em `App.tsx`, rota filha `<Route path="papeis" element={<PapeisTab />} />` com o mesmo lazy-import dos irmãos.

- [ ] **Step 4: Rodar teste, typecheck, verificar no browser**

```bash
npx vitest run apps/crm/src/pages/configuracao/tabs/__tests__/PapeisTab.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Verificação visual (dev server `npm run dev:staging` via preview): abrir `/configuracao/papeis` como dono; criar papel "Social Media" a partir do preset Agente; editar; excluir. Confirmar que NADA mudou para membros (aba invisível para admin/agente).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store apps/crm/src/pages/configuracao apps/crm/src/App.tsx
git commit -m "feat(equipe): aba Papéis (CRUD de papéis customizados, só dono)"
```

---

### Task 9: Gate do PR A

**Files:** nenhum novo (verificação + PR).

- [ ] **Step 1: Verificação completa**

```bash
npm run lint && npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
npm run test && npm run test:functions
git checkout deno.lock 2>/dev/null || true
```

Com Docker: `bash scripts/test-entitlements.sh`. Todos PASS antes de seguir; saída real colada no PR.

- [ ] **Step 2: Re-verificar colisão de versão de migration**

```bash
git fetch origin main && git ls-tree origin/main:supabase/migrations | awk '{print $4}' | tail -5
```

Se `20260903000001` colidir ou ficar abaixo do tail de main, renumerar o arquivo acima do tail (e refazer o commit).

- [ ] **Step 3: Abrir PR A**

```bash
git push -u origin ebs/permissoes-papeis-a
gh pr create --title "feat(equipe): fundação de papéis customizados (aditivo)" --body "$(cat <<'EOF'
Migração A do plano docs/superpowers/plans/2026-09-02-permissoes-granulares-papeis.md
(spec: docs/superpowers/specs/2026-09-02-permissoes-granulares-papeis-design.md).

Aditivo, sem mudança observável: workspace_roles + role_id + has_permission(_for) +
RPCs + manage-workspace-roles + role_id nos convites + can() no AuthContext (fallback
legado) + aba Papéis (só dono). A religação de RLS/guards vem no PR B.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Aguardar o review externo do Codex (regra da casa), verificar cada apontamento contra o código antes de aplicar.

---

## PR B — Religação (enforcement + UI ligada)

> Criar após o merge do PR A: `git fetch origin main && git checkout -b ebs/permissoes-papeis-b origin/main`. Se o PR A levou squash, NUNCA rebase da branch A: partir de main fresco.

### Task 10: Migração B (religação SQL) + suítes psql

**Files:**
- Create: `supabase/migrations/20260910000001_workspace_roles_b_enforcement.sql` (renumerar acima do tail de main na abertura do PR)
- Create: `supabase/tests/entitlements/75_permission_rls_rewire.sql`
- Create: `supabase/tests/entitlements/76_financial_editar_guard.sql`

**Interfaces:**
- Consumes: `has_permission` (Task 1).
- Produces: policies/trigger religados; corpo de `can_see_financials()` redefinido. NENHUMA assinatura muda.

- [ ] **Step 1: Testes primeiro (75 e 76)** — mesmos padrões da Task 2:

`75_permission_rls_rewire.sql`:
```
-- RW-01 leads: papel {"leads":"ver"} SELECT ok, INSERT negado; {"leads":"editar"}
--        INSERT/UPDATE/DELETE ok; {"leads":"none"} SELECT vazio; agent legado
--        SELECT vazio (regressão); admin legado tudo ok (regressão)
-- RW-02 post_status_automations: papel {"automacoes":"ver"} SELECT ok (o delta
--        documentado), INSERT negado; {"automacoes":"editar"} INSERT ok;
--        agent legado SELECT ok (novo), INSERT negado
-- RW-03 instagram_comment_automations: mesmas quatro asserções de RW-02
-- RW-04 post_status_definitions: escrita exige configuracoes/editar; SELECT
--        continua para qualquer membro (policy de select NÃO muda)
-- RW-05 workspaces UPDATE: papel {"configuracoes":"editar"} ok; sem => negado;
--        admin legado ok (regressão)
-- RW-06 transacoes/contratos: papel {"financeiro":"ver"} SELECT ok, INSERT
--        negado; {"financeiro":"editar"} INSERT ok; admin can_see=false SELECT
--        vazio (regressão do 52)
-- RW-07 can_see_financials(): admin legado ±flag e owner continuam a
--        tabela-verdade do 50; papel {"financeiro":"ver"} => true;
--        {"financeiro":"none"} => false
-- RW-08 leads: pg_policies contém EXATAMENTE leads_select/insert/update/delete
--        (o sweep removeu qualquer legada)
```

`76_financial_editar_guard.sql`:
```
-- FG-01 papel {"financeiro":"ver"}: UPDATE clientes.valor_mensal => exceção
--        financial_access_denied; UPDATE de campo não-financeiro passa
-- FG-02 papel {"financeiro":"editar"}: UPDATE valor_mensal ok; membros.custo_mensal ok
-- FG-03 admin legado can_see=true muda valor_mensal ok; can_see=false negado
--        (regressão do 52)
```

- [ ] **Step 2: Escrever a migração.** Conteúdo, nesta ordem:

```sql
-- (1) Núcleo financeiro passa a consultar o modelo de papéis. Nenhuma policy
-- financeira muda: só o corpo. Views membros_v/clientes_v e grants intactos.
CREATE OR REPLACE FUNCTION public.can_see_financials()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.has_permission('financeiro', 'ver') $$;

-- (2) Trigger de escrita financeira exige EDITAR (apontado no review externo:
-- com só a leitura religada, papel financeiro:ver mudaria valores por
-- PostgREST). Fallback legado preserva comportamento: admin com flag =>
-- editar true.
-- Reescrever guard_financial_write() copiando o corpo ATUAL de
-- 20260728000002 (linhas 224-258) trocando APENAS a condição:
--   IF public.can_see_financials() IS NOT TRUE THEN
-- por
--   IF public.has_permission('financeiro', 'editar') IS NOT TRUE THEN
-- [COLAR o CREATE OR REPLACE completo]

-- (3) Escrita financeira nas policies (INSERT/UPDATE/DELETE de transacoes e
-- contratos): DROP + CREATE das seis policies de escrita copiando os nomes de
-- 20260728000002:162-198, com o predicado
--   conta_id IN (SELECT public.get_my_conta_id())
--   AND (SELECT public.has_permission('financeiro','editar'))
-- (as duas _select ficam como estão: can_see_financials() já resolve 'ver').

-- (4) Leads: sweep de policies legadas (produção nunca rodou 20260315 e pode
-- carregar o par FOR ALL permissivo do baseline, que faria OR com as novas)
-- copiando o padrão guardado de 20260728000002:141-156 restrito a
-- tablename='leads' e policyname NOT IN
-- ('leads_select','leads_insert','leads_update','leads_delete');
-- depois DROP IF EXISTS + CREATE das quatro:
--   leads_select FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id())
--     AND (SELECT public.has_permission('leads','ver')));
--   leads_insert FOR INSERT WITH CHECK (conta_id IN (...) AND has_permission('leads','editar'));
--   leads_update FOR UPDATE USING (mesmo de insert) WITH CHECK (conta_id IN (...));
--   leads_delete FOR DELETE USING (mesmo de insert);

-- (5) Automações (harmonização, delta documentado na spec):
-- post_status_automations: DROP psa_select/psa_insert/psa_update/psa_delete e
-- recriar trocando "public.get_my_role() in ('owner','admin')" por
-- has_permission('automacoes','ver') no SELECT e ('automacoes','editar') nos
-- três de escrita (WITH CHECK do update mantém o tenant como hoje);
-- service_role_bypass_psa fica.
-- instagram_comment_automations: DROP ica_select/ica_insert/ica_update/
-- ica_delete e recriar: ica_select ganha AND has_permission('automacoes','ver');
-- escrita com ('automacoes','editar'); service_role_bypass_ica fica.

-- (6) post_status_definitions: DROP + CREATE só das policies de INSERT/UPDATE/
-- DELETE (nomes atuais em 20260805000001:131-144), trocando get_my_role() por
-- has_permission('configuracoes','editar'). A policy de SELECT NÃO muda.

-- (7) workspaces: DROP POLICY ws_update_owner_admin e recriar com
--   USING (id IN (SELECT public.get_my_conta_id())
--          AND (SELECT public.has_permission('configuracoes','editar')))
-- preservando o WITH CHECK atual de 20260322_workspace_logo_storage.sql:33.

-- (8) Post-conditions: contagem exata de policies por tabela (leads=4,
-- post_status_automations=5, instagram_comment_automations=5, transacoes=4,
-- contratos=4) no padrão de 20260728000002:314-...; e as três funções
-- redefinidas apontando has_permission (checar pg_get_functiondef LIKE
-- '%has_permission%').
```

Ao escrever, abrir cada migração citada e copiar predicados/nomes reais; nada de recriar de memória.

- [ ] **Step 3: Rodar**

```bash
npx supabase db reset && bash scripts/test-entitlements.sh
```

Expected: 75 e 76 PASS; 50–54 (financeiro legado) PASS SEM EDIÇÃO — prova de compatibilidade; 72–74 PASS. Sem Docker: CI.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_workspace_roles_b_enforcement.sql supabase/tests/entitlements/7[56]_*.sql
git commit -m "feat(equipe): migração B religa RLS, trigger financeiro e can_see_financials ao modelo de papéis"
```

---

### Task 11: Religação das edge functions

**Files:**
- Modify: `supabase/functions/invite-user/index.ts:98,132` (gate de ator)
- Modify: `supabase/functions/manage-workspace-user/index.ts:154-156` (gate de ator)
- Modify: `supabase/functions/automation-media/handler.ts:70-75`
- Modify: `supabase/functions/mcp-keys/index.ts:34-40`
- Modify: `supabase/functions/mcp-oauth-consent/index.ts:81-87,110-122,183-195`
- Modify: testes deno de cada uma (estender os existentes; criar onde faltar)

**Interfaces:**
- Consumes: `hasPermissionFor` (Task 3).
- Produces: gates por permissão; nenhum contrato HTTP muda (mesmos códigos/erros).

- [ ] **Step 1: Testes primeiro, por função:**
  - `invite-user`: ator com papel custom `{"equipe":"editar"}` (chassi role='agent') consegue convidar e cancelar; ator com papel sem equipe => 403; admin/owner legados seguem ok; admin continua proibido de convidar owner.
  - `manage-workspace-user`: mesmo padrão para update-role/remove/cancel-invite (o gate `callerRole !== 'owner' && callerRole !== 'admin'` vira permissão); travas "só owner atribui owner", "não modificar owner", "não modificar a si mesmo" continuam (asserções de regressão); `set-financial-access` NÃO muda (owner-only via RPC).
  - `automation-media`: rotas mutantes com papel `{"automacoes":"editar"}` ok; `{"automacoes":"ver"}` => 403; sign-view continua para qualquer membro.
  - `mcp-keys`: papel `{"configuracoes":"editar"}` ok; sem => 403; e o gate agora lê membership (workspace ativo), não `profiles.role`.
  - `mcp-oauth-consent`: `approve` com workspace do payload onde o usuário tem `configuracoes.editar` => ok; onde não tem => 403; `eligible-workspaces` lista exatamente os workspaces com essa permissão; `list-grants`/`revoke-grant` contra o workspace ATIVO com a mesma permissão.

- [ ] **Step 2: Implementar.** Padrão único (exemplo `invite-user`, gate de convite):

```ts
import { hasPermissionFor } from "../_shared/permissions.ts";
// no lugar de: if (caller.role === 'agent') throw ...
const canManageTeam = await hasPermissionFor(
  adminClient, caller.userId, caller.conta_id, "equipe", "editar",
);
if (!canManageTeam) throw new Error("Você não tem permissão para gerenciar convites.");
```

(Ajustar nomes reais das variáveis por arquivo.) Detalhes por função:
- `manage-workspace-user/index.ts:154-156`: substituir o check de `callerRole` por `hasPermissionFor(serviceClient, user.id, workspaceId, 'equipe', 'editar')`; MANTER `callerRole` carregado (as travas de owner abaixo o usam).
- `automation-media/handler.ts`: trocar `isWorkspaceEditor(member.role)` por `await hasPermissionFor(svc, user.id, contaId, 'automacoes', 'editar')` nas rotas mutantes. Remover o import de `isWorkspaceEditor` se ficar sem uso NESTE arquivo (outros usuários do helper ficam).
- `mcp-keys/index.ts`: substituir o bloco `profiles.role` por: resolver `active_workspace_id` do profile (como já faz) e `hasPermissionFor(svc, user.id, contaId, 'configuracoes', 'editar')`.
- `mcp-oauth-consent/index.ts`: em `eligible-workspaces`, trocar `.in("role", ["owner","admin"])` por listar TODAS as memberships e filtrar com `await hasPermissionFor(svc, user.id, m.workspace_id, 'configuracoes', 'editar')` (loop já existe para `feature_mcp`); em `approve`, trocar `isManager(membership.role)` por `hasPermissionFor(svc, user.id, conta_id, 'configuracoes', 'editar')`; em `list/revoke-grant`, trocar o check de `profiles.role` pela mesma permissão contra `profile.active_workspace_id` (o `conta_id` das queries vira o active também: hoje já usa `profile.conta_id`; manter o campo que o código atual usa para escopo e só religar o GATE).

- [ ] **Step 3: Rodar toda a suíte; commit**

```bash
npm run test:functions && git checkout deno.lock 2>/dev/null || true
git add supabase/functions
git commit -m "feat(equipe): edge functions consultam has_permission_for (equipe, automações, MCP)"
```

---

### Task 12: Guards de rota, navegação e abas por permissão

**Files:**
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx`
- Create: `apps/crm/src/components/layout/routePermissions.ts`
- Create: `apps/crm/src/components/layout/__tests__/routePermissions.test.ts`
- Modify: `apps/crm/src/components/layout/nav-data.ts:234-266` (+ assinatura)
- Modify: `apps/crm/src/components/layout/Sidebar.tsx`, `MobileNav.tsx` (call sites)
- Modify: `apps/crm/src/pages/configuracao/configTabs.ts` + `ConfiguracaoLayout.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/clienteTabs.model.ts` + call sites (`ClienteDetalhePage.tsx`)
- Modify: testes existentes que dependem das assinaturas antigas (grep no Step 6)

**Interfaces:**
- Consumes: `can()` do AuthContext (Task 7).
- Produces:
  - `routePermissions.ts`: `resolveRouteGate(pathname: string): { module: PermissionModule; action: PermissionAction } | 'open' | 'unmapped'` — tabela interna ordenada por prefixo mais longo primeiro.
  - `configTabs.ts`: `ConfigTab.permission: { module: PermissionModule; action: PermissionAction } | 'owner' | 'all'`; `visibleConfigTabs(can, workspaceRole)`, `canAccessConfigTab(path, can, workspaceRole)`.
  - `clienteTabs.model.ts`: `ClienteTab.permission: { module; action } | null` (null = coberto por clientes.ver da rota); `canAccessClienteTab(key, can)`, `visibleClienteTabs(can)`, `financeiroTabGuardOutcome` inalterada.

- [ ] **Step 1: Teste de `routePermissions` primeiro** — a tabela completa:

```ts
// resolveRouteGate:
// '/dashboard' e '/ajuda' e '/configuracao/...' e '/comecar' e
// '/workspace-setup' e '/oauth/consent' => 'open'
// '/clientes' => {clientes, ver}; '/clientes/42/financeiro' => {clientes, ver}
//   (a aba financeiro tem gate próprio no clienteTabs — o route gate é o do módulo pai)
// '/entregas' e '/post-express' => {entregas, ver}
// '/calendario' => {calendario, ver}; '/aprovacoes' => {aprovacoes, ver}
// '/arquivos' => {arquivos, ver}; '/ideias' => {ideias, ver}
// '/tarefas' => {tarefas, ver}; '/leads' => {leads, ver}
// '/financeiro' => {financeiro, ver}; '/contratos' => {contratos, ver}
// '/equipe' e '/equipe/7' => {equipe, ver}
// '/analytics', '/analytics/9', '/analytics-fluxos', '/relatorios/abc'
//   => {analytics, ver}
// '/mensagens' e '/mensagens/3' => {clientes, ver}
// '/automacoes' => {automacoes, ver}
// '/importar' => {clientes, editar}
// '/rota-inventada' => 'unmapped'
// matching: prefixo com fronteira de segmento ('/clientesx' => 'unmapped')
```

- [ ] **Step 2: Implementar `routePermissions.ts` e religar `ProtectedRoute.tsx`**

Em `ProtectedRoute`: apagar `AGENT_BLOCKED` e o bloco `role === 'agent'` (linhas 8 e 47-49); depois do check de feature-gate, inserir:

```tsx
const gate = resolveRouteGate(pathname);
if (gate === 'unmapped') {
  if (import.meta.env.DEV) {
    console.error(`[ProtectedRoute] rota sem entrada no mapa de permissões: ${pathname}`);
  }
  return <Navigate to="/dashboard" replace />;
}
if (gate !== 'open') {
  const allowed = can(gate.module, gate.action);
  // 'unknown' falha NEUTRO (render): igual ao guard financeiro do AppLayout.
  if (allowed === false) return <Navigate to="/dashboard" replace />;
}
```

(`can` vem de `useAuth()`; `role` continua usado pelo bloco `needsSetup`.) O guard financeiro do `AppLayout` (FINANCIAL_PATHS) fica como está: é a tela de restrição com copy própria; o novo gate redireciona antes na maioria dos casos, e o AppLayout continua o fallback para 'unknown'.

- [ ] **Step 3: `nav-data.ts`**

Assinatura: `getNavGroups(role, features, canSeeFinancials, workspaceRole, can)` ganha o quinto parâmetro `can: (m: PermissionModule, a?: PermissionAction) => PermissionCheck` (mesma ordem em `getMoreSheetGroups`). Substituir os DOIS blocos de filtragem por papel (o `role === 'agent'` de :249-266 e o financeiro de :283-291) por um único:

```ts
const NAV_MODULE: Partial<Record<string, [PermissionModule, PermissionAction]>> = {
  calendario: ['calendario', 'ver'], leads: ['leads', 'ver'],
  clientes: ['clientes', 'ver'], entregas: ['entregas', 'ver'],
  'post-express': ['entregas', 'ver'], tarefas: ['tarefas', 'ver'],
  aprovacoes: ['aprovacoes', 'ver'], arquivos: ['arquivos', 'ver'],
  ideias: ['ideias', 'ver'], mensagens: ['clientes', 'ver'],
  financeiro: ['financeiro', 'ver'], contratos: ['contratos', 'ver'],
  equipe: ['equipe', 'ver'], analytics: ['analytics', 'ver'],
  'analytics-fluxos': ['analytics', 'ver'], automacoes: ['automacoes', 'ver'],
  importar: ['clientes', 'editar'],
};

groups = groups
  .map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      const gate = NAV_MODULE[i.id];
      return !gate || can(gate[0], gate[1]) === true; // fecha em 'unknown' (anti-flash)
    }),
  }))
  .filter((g) => g.items.length > 0);
```

ANTES de escrever o `NAV_MODULE`, listar os ids reais (`grep -n "id: '" apps/crm/src/components/layout/nav-data.ts`) e cobrir todo id que corresponda a um módulo do catálogo; ids fora do catálogo (dashboard, ajuda, config, cobranca, privacidade etc.) ficam de fora do mapa. O bloco de `cobranca` passa a usar `workspaceRole !== 'owner'` (corrige o uso do `role` de profiles). Atualizar os call sites (`Sidebar.tsx`, `MobileNav.tsx`) para passar `can`.

- [ ] **Step 4: `configTabs.ts` + `ConfiguracaoLayout.tsx`**

```ts
export type ConfigPermission =
  | { module: PermissionModule; action: PermissionAction }
  | 'owner'
  | 'all';
export interface ConfigTab { path: string; label: string; permission: ConfigPermission; group: string; icon: LucideIcon; }
```

Tabela: `perfil`/`notificacoes` = `'all'`; `workspace`/`relatorios`/`status`/`hub`/`mcp` = `{ module: 'configuracoes', action: 'ver' }`; `membros` = `{ module: 'equipe', action: 'ver' }`; `armazenamento`/`cobranca`/`papeis` = `'owner'`.

```ts
export function canAccessConfigTab(
  path: string,
  can: (m: PermissionModule, a?: PermissionAction) => PermissionCheck,
  workspaceRole: string | null | undefined,
): boolean {
  const tab = CONFIG_TABS.find((t) => t.path === path);
  if (!tab) return false;
  if (tab.permission === 'all') return true;
  if (tab.permission === 'owner') return workspaceRole === 'owner';
  return can(tab.permission.module, tab.permission.action) === true;
}
export function visibleConfigTabs(can, workspaceRole) {
  return CONFIG_TABS.filter((t) => canAccessConfigTab(t.path, can, workspaceRole));
}
```

`ConfiguracaoLayout` passa `can` (de `useAuth()`) nos dois call sites. Nota de escopo v1 (documentada, não é código): um papel `configuracoes: ver` enxerga as abas staff e o salvar falha no servidor (RLS) com toast de erro — aceito na v1, endurecer UX é follow-up.

- [ ] **Step 5: `clienteTabs.model.ts`**

`ClienteTab.permission: { module: PermissionModule; action: PermissionAction } | null`; tabela: `visao-geral`/`entregas`/`redes-sociais`/`arquivos` = null; `relatorios` = `{analytics, ver}`; `hub` = `{configuracoes, editar}`; `financeiro` = `{financeiro, ver}` (substitui o caso especial: `canAccessClienteTab(key, can)` avalia `permission` com `can(...) === true`, e para null retorna true). `visibleClienteTabs(can)`. Manter `financeiroTabGuardOutcome(canSeeFinancials)` intacta (o 3-estados de rota). Atualizar `ClienteDetalhePage.tsx` e demais call sites (grep `canAccessClienteTab\|visibleClienteTabs\|canAccessClienteTabRole` — remover `canAccessClienteTabRole` se ficar sem uso, migrando os usos para a nova assinatura).

- [ ] **Step 6: Atualizar testes existentes das assinaturas antigas**

```bash
grep -rln "getNavGroups\|canAccessConfigTab\|visibleConfigTabs\|canAccessClienteTab\|visibleClienteTabs\|AGENT_BLOCKED" apps/crm/src --include='*.test.*'
```

Cada hit: atualizar para as novas assinaturas com um helper `makeCan(overrides)` que devolve `can` a partir de um membership fake (usar `derivePermission` real, não mock, para não recriar a tabela-verdade nos testes).

- [ ] **Step 7: Rodar, typecheck, commit**

```bash
npx vitest run apps/crm/src/components/layout/__tests__/routePermissions.test.ts
npm run test && npx tsc -p apps/crm/tsconfig.json --noEmit
git add apps/crm/src/components/layout apps/crm/src/pages/configuracao apps/crm/src/pages/cliente-detalhe
git commit -m "feat(equipe): rotas, navegação e abas gateadas por can() (mapa completo de rotas)"
```

---

### Task 13: Revogação ao vivo generalizada + atribuição de papéis na UI

**Files:**
- Modify: `apps/crm/src/context/AuthContext.tsx` (MODULE_QUERY_KEYS, subscription workspace_roles, purge por módulo)
- Modify: `apps/crm/src/store/workspace.ts:3-22,208-210` (`getWorkspaceUsers` + `updateWorkspaceUserRole`)
- Modify: `apps/crm/src/pages/configuracao/tabs/MembrosTab.tsx` (select de função + RoleBadge custom)
- Modify: `apps/crm/src/pages/equipe/InviteSection.tsx` + `apps/crm/src/pages/equipe/membroForm.ts` + `apps/crm/src/services/invite.ts` + o submit em `apps/crm/src/pages/equipe/EquipePage.tsx`
- Create: `apps/crm/src/lib/__tests__/permissionTransitions.test.ts`
- Modify: testes existentes de MembrosTab/InviteSection (grep)

**Interfaces:**
- Consumes: `can()`/`derivePermission`; `getWorkspaceRoles` (Task 8); `update-role` com roleId (Task 5); `invite-user` com role_id (Task 6).
- Produces:
  - `MODULE_QUERY_KEYS: Record<PermissionModule, string[]>` exportado do AuthContext (substitui o uso interno de `FINANCIAL_QUERY_KEYS`, que permanece exportado para compat)
  - `computePermissionTransitions(prev: MyMembership | null, next: MyMembership | null): { downgraded: PermissionModule[]; upgraded: PermissionModule[] }` em `lib/permissions.ts`
  - `getWorkspaceUsers()` passa a devolver também `role_id: string | null` e `papel_nome: string | null`
  - `updateWorkspaceUserRole(userId, value: { role: 'admin' | 'agent' } | { roleId: string })`
  - `inviteUser(email, role, membroId?, roleId?)` em services/invite.ts

- [ ] **Step 1: Teste de `computePermissionTransitions`** (Vitest): para cada módulo, comparar `derivePermission(prev, m, 'ver')` vs `next`: `true→(false|'unknown')` = downgraded; `(false|'unknown')→true` = upgraded; iguais = nada. Casos: admin→papel sem financeiro (downgraded inclui financeiro, contratos? não: módulo a módulo), papel ganha leads (upgraded=[leads]), null→resolvido etc.

- [ ] **Step 2: Implementar transições + purge por módulo no AuthContext**

`MODULE_QUERY_KEYS` (mapear chaves reais: conferir com `grep -rn "queryKey: \['" apps/crm/src/pages | cut -d"'" -f2 | sort -u` e ajustar):

```ts
export const MODULE_QUERY_KEYS: Record<PermissionModule, string[]> = {
  financeiro: ['transacoes', 'dashboardStats'],
  contratos: ['contratos'],
  clientes: ['cliente', 'clientes'],
  equipe: ['membros', 'workspace-users', 'invites'],
  leads: ['leads'],
  entregas: ['workflows', 'workflow', 'posts'],
  calendario: ['calendario'],
  aprovacoes: ['aprovacoes'],
  arquivos: ['arquivos', 'files'],
  ideias: ['ideias'],
  tarefas: ['tarefas'],
  analytics: ['analytics', 'portfolioSummary'],
  automacoes: ['automacoes', 'automations'],
  configuracoes: [],
};
```

Em `applyMembership`, além do bloco financeiro atual (mantido: FINANCIAL_QUERY_KEYS cobre o caso já testado), computar `computePermissionTransitions(membershipRef.current, next)` e, para cada módulo em `downgraded`, `removeQueries` das suas keys; para `upgraded`, `invalidateQueries`. Adicionar canal realtime:

```ts
const rolesChannel = supabase
  .channel(`wr:${userId}:${workspaceId}`)
  .on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'workspace_roles',
      filter: `conta_id=eq.${workspaceId}` },
    () => { void getMyMembership().then(applyMembership).catch(() => {}); })
  .subscribe();
```

(cleanup junto do canal existente). Edição de papel que NÃO é o do usuário provoca um refetch inofensivo (mesma membership ⇒ transições vazias). O poll de 60s já cobre o resto.

- [ ] **Step 3: `getWorkspaceUsers` + `updateWorkspaceUserRole`**

Select vira `'user_id, role, role_id, joined_at, can_see_financials, workspace_roles(nome), profiles!inner(id, nome, avatar_url, created_at)'`; flatten adiciona `role_id: m.role_id ?? null, papel_nome: m.workspace_roles?.nome ?? null`.

```ts
export async function updateWorkspaceUserRole(
  userId: string,
  value: { role: 'admin' | 'agent' } | { roleId: string },
): Promise<void> {
  await callManageWorkspaceUser('update-role', userId, value);
}
```

(`callManageWorkspaceUser` espalha `roleId` no body; o edge function da Task 5 já o lê.)

- [ ] **Step 4: MembrosTab: select expandido**

- `useQuery(['workspace-roles'], getWorkspaceRoles, { enabled: isOwnerOrAdmin })`.
- Encoding do valor do Select: `'admin' | 'agent' | 'custom:<uuid>'`. No modal de edição, `editRoleValue` inicial = `u.role_id ? 'custom:' + u.role_id : u.role`; opções: Admin, Agente, e um `SelectItem` por papel (`value={'custom:' + r.id}`, label `r.nome`). No save: `value.startsWith('custom:') ? updateWorkspaceUserRole(id, { roleId: value.slice(7) }) : updateWorkspaceUserRole(id, { role: value as 'admin' | 'agent' })`.
- Linha do membro: quando `u.papel_nome`, mostrar badge com o nome do papel no lugar do `RoleBadge` legado (reusar o estilo do RoleBadge; NÃO alterar `inviteHelpers` para casos legados).
- Switch "Ver financeiro" continua com a condição atual (`isOwner && u.role === 'admin'` — membro com papel custom tem role='agent' e naturalmente não mostra; comentário desnecessário).
- Invite modal: mesmas opções no select (`inviteRole` com o mesmo encoding); no submit, body `{ email, role: encoded.startsWith('custom:') ? 'agent' : encoded, role_id: encoded.startsWith('custom:') ? encoded.slice(7) : undefined }`.
- Ações Função/Remover/Convidar renderizam apenas quando `can('equipe','editar') === true` (substitui a suposição implícita de isOwnerOrAdmin; a query principal pode manter `enabled: can('equipe','ver') === true`).

- [ ] **Step 5: Equipe (InviteSection/membroForm/services)**

- `membroForm.ts`: `inviteRole: z.enum(['admin','agent'])` vira `inviteRole: z.string().min(1)` (o encoding `custom:<uuid>` é validado no servidor).
- `InviteSection.tsx`: buscar papéis (`useQuery(['workspace-roles'], getWorkspaceRoles, { enabled: canManageWorkspace })` — prop já existente no componente pai) e adicionar os `SelectItem` custom com o mesmo encoding.
- `services/invite.ts`: `inviteUser(email, role, membroId?, roleId?)` inclui `role_id: roleId` no body quando presente; o call site no `EquipePage.tsx` decodifica o encoding antes de chamar.

- [ ] **Step 6: Testes + verificação no browser**

```bash
npx vitest run apps/crm/src/lib/__tests__/permissionTransitions.test.ts
grep -rln "MembrosTab\|InviteSection" apps/crm/src --include='*.test.*'   # atualizar hits
npm run test && npx tsc -p apps/crm/tsconfig.json --noEmit
```

Browser (staging): atribuir papel custom a um membro de teste; verificar na sessão DO MEMBRO que nav/rotas mudam em <60s sem reload; editar o papel (tirar um módulo) e ver a revogação ao vivo; excluir papel em uso e ver o erro.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src
git commit -m "feat(equipe): atribuição de papéis na UI e revogação ao vivo por módulo"
```

---

### Task 14: Varredura das superfícies de mutação + greps de saída

**Files (todos Modify):** conforme a tabela abaixo.

**Interfaces:** Consumes: `can()` — nada novo produzido.

- [ ] **Step 1: Aplicar a tabela** (cada linha: localizar o check antigo, substituir; `can(...)` compara com `=== true` para fechar em 'unknown'):

| Arquivo | Check antigo | Novo |
|---|---|---|
| `pages/equipe/EquipePage.tsx:117,119` | `isAgent = role === 'agent'`; `canManageWorkspace = owner\|\|admin` | `canEditTeam = can('equipe','editar') === true`; usos de `!isAgent` viram `canEditTeam`; `canManageWorkspace` (convite/conta CRM) idem |
| `pages/membro-detalhe/MembroDetalhePage.tsx:55` | `isAgent` esconde edição | `can('equipe','editar') === true` |
| `pages/clientes/ClientesPage.tsx` (botões novo/editar/excluir/importar) | sem check de papel hoje | envolver com `can('clientes','editar') === true` |
| `pages/entregas/components/PostAutomationSection.tsx:81` | `canManage = currentUserRole owner\|\|admin` | prop substituída: passar `canManage = can('automacoes','editar') === true` dos pais (`WorkflowDrawer.tsx:922`, `StandalonePostDrawer.tsx:499`) |
| `pages/entregas/components/PostCommentPopover.tsx:93` | `isAuthor \|\| owner \|\| admin` | `isAuthor \|\| can('entregas','editar') === true` |
| `pages/cliente-detalhe/ClienteDetalhePage.tsx:157` | `canEditPhoto = owner\|\|admin` | `can('clientes','editar') === true` |
| `pages/cliente-detalhe/tabs/HubClienteTab.tsx:33,46` | notice para agent | notice quando `can('configuracoes','editar') !== true` |
| `pages/configuracao/tabs/WorkspaceTab.tsx:27,32`, `RelatoriosTab.tsx:47-66`, `HubTab.tsx:667`, `PerfilTab.tsx:19,203-205`, `mcp/IntegracoesClaudePage.tsx:202` | `role owner\|\|admin` | `can('configuracoes','ver') === true` (queries/subseções) |
| `pages/arquivos/ArquivosPage.tsx` (upload/excluir) | sem check | `can('arquivos','editar') === true` |
| `pages/ideias/IdeiasPage.tsx` (criar/excluir) | sem check | `can('ideias','editar') === true` |
| `pages/leads/LeadsPage.tsx` (criar/editar) | sem check (rota bloqueava) | `can('leads','editar') === true` |

Fora do escopo, NÃO mexer: `DashboardPage.tsx`/`useTodayAgenda.ts` (escopo mine/workspace por `workspaceRole === 'agent'` é UX de agenda: membro de papel custom tem chassi agent e cai em 'mine', default aceitável documentado na spec); `DunningBanner`/`TrialNudgeCard`/`WhatsAppSupportCard`/`UpgradeLockedScreen`/`useIsWorkspaceOwner` (owner-only permanece); `RoleBadge`.

- [ ] **Step 2: Greps de saída (checklist do PR B, colar resultado no PR):**

```bash
grep -rn "role === 'agent'\|role !== 'agent'" apps/crm/src --include='*.ts*' | grep -v __tests__
grep -rn "get_my_role()" supabase/migrations/2026091*.sql
grep -rn "profiles\.role\|profile.role" supabase/functions --include='*.ts' | grep -v _test
grep -rn "isWorkspaceEditor" supabase/functions --include='*.ts' | grep -v _test | grep -v workspace-role.ts
```

Cada hit restante: ou religado, ou listado no corpo do PR com justificativa (lista esperada: `useTodayAgenda` scope, derivações internas de `permissions.ts`/`AuthContext`, `ProtectedRoute` needsSetup usa `role==='owner'` — aceitável, `manage-workspace-user` travas de owner, `workspace-role.ts` em si, funções não religadas na v1 conforme spec).

- [ ] **Step 3: Rodar tudo; commit**

```bash
npm run test && npx tsc -p apps/crm/tsconfig.json --noEmit
git add apps/crm/src
git commit -m "feat(equipe): superfícies de mutação por módulo gateadas por can()"
```

---

### Task 15: Gate do PR B + runbook de deploy

- [ ] **Step 1: Verificação completa** (mesma da Task 9, incluindo entitlements com Docker se disponível).

- [ ] **Step 2: Renumerar migração B acima do tail de origin/main** (mesmo procedimento da Task 9 Step 2).

- [ ] **Step 3: Verificação E2E manual em staging** (contra `npm run dev:staging`): roteiro mínimo — (1) dono cria papel "Social Media" (entregas/calendario/aprovacoes editar, analytics ver, resto none); (2) atribui a um membro de teste; (3) sessão do membro: nav mostra só os módulos do papel, `/leads` redireciona, criar post funciona, RLS de leads devolve vazio via devtools (fetch direto ao PostgREST com o token da sessão); (4) dono edita papel adicionando leads: membro ganha acesso ao vivo; (5) convite novo com papel custom; aceitar e conferir membership `role='agent'` + `role_id`.

- [ ] **Step 4: Abrir PR B** (mesmo formato do PR A, título `feat(equipe): religação das permissões granulares (RLS, edge functions, guards)`, corpo com os greps de saída e o resultado do roteiro E2E). Aguardar Codex.

- [ ] **Step 5: Runbook de deploy (executar no rollout, na ordem):**

1. `npx supabase db push --linked` (conferir ANTES `cat supabase/.temp/project-ref` — prod é `skjzpekeqefvlojenfsw`; o link FLIPA).
2. Edge functions (com `--use-api`; `--no-verify-jwt` NÃO se aplica a nenhuma destas, todas verificam JWT próprio): PR A: `manage-workspace-roles`, `manage-workspace-user`, `invite-user`, `platform-admin`. PR B: os mesmos que mudaram + `automation-media`, `mcp-keys`, `mcp-oauth-consent`.
3. Frontend (Vercel deploya no merge).
4. Smoke em prod: `/configuracao/papeis` abre para dono; membro legado sem mudança; criar+atribuir papel num workspace de teste.

---

## Fora de escopo (Fase 2 e follow-ups registrados)

- Restrição por cliente (Fase 2, iniciativa própria).
- RLS real para clientes/entregas/calendario/aprovacoes/arquivos/ideias/tarefas/analytics (endurecimento por módulo).
- Policies de storage (logo/foto) continuam owner/admin.
- UX read-only real para `configuracoes: ver` (v1: salvar falha no servidor).
- Migrar `DunningBanner` e afins de `profiles.role` para `workspaceRole` (fora do catálogo, owner-only).
