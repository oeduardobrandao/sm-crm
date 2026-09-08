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
CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_user_id uuid)
RETURNS TABLE (
  invite_id uuid,
  conta_id uuid,
  role text,
  email text,
  already_accepted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_conta_id uuid;
  v_invite public.invites%ROWTYPE;
BEGIN
  SELECT lower(u.email)
  INTO v_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.conta_id
  INTO v_conta_id
  FROM profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT i.*
  INTO v_invite
  FROM invites i
  WHERE lower(i.email) = v_email
    AND i.conta_id = v_conta_id
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT i.*
    INTO v_invite
    FROM invites i
    WHERE lower(i.email) = v_email
      AND i.conta_id = v_conta_id
      AND i.status = 'accepted'
      AND EXISTS (
        SELECT 1
        FROM workspace_members wm
        WHERE wm.user_id = p_user_id
          AND wm.workspace_id = i.conta_id
      )
    ORDER BY i.accepted_at DESC NULLS LAST, i.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
    END IF;

    invite_id := v_invite.id;
    conta_id := v_invite.conta_id;
    role := v_invite.role;
    email := v_email;
    already_accepted := true;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO workspace_members (user_id, workspace_id, role, role_id)
  VALUES (p_user_id, v_invite.conta_id,
          CASE WHEN v_invite.role_id IS NOT NULL THEN 'agent' ELSE v_invite.role END,
          v_invite.role_id)
  ON CONFLICT (user_id, workspace_id) DO UPDATE
  SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;

  UPDATE profiles
  SET conta_id = v_invite.conta_id,
      active_workspace_id = v_invite.conta_id,
      role = CASE WHEN v_invite.role_id IS NOT NULL
                THEN 'agent'::user_role ELSE v_invite.role::user_role END,
      onboarding_complete = true
  WHERE id = p_user_id;

  UPDATE invites
  SET status = 'accepted',
      accepted_at = now()
  WHERE id = v_invite.id;

  -- Link the membro this invite was sent for. Guarded by crm_user_id IS NULL
  -- so a manual link made in the meantime wins; conta_id guard keeps the
  -- update inside the invite's workspace.
  IF v_invite.membro_id IS NOT NULL THEN
    UPDATE membros m
    SET crm_user_id = p_user_id
    WHERE m.id = v_invite.membro_id
      AND m.conta_id = v_invite.conta_id
      AND m.crm_user_id IS NULL;
  END IF;

  invite_id := v_invite.id;
  conta_id := v_invite.conta_id;
  role := v_invite.role;
  email := v_email;
  already_accepted := false;
  RETURN NEXT;
END;
$$;

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
