-- Acesso por cliente, Migração A (schema e predicados): o dono pode restringir
-- um membro aos clientes atribuídos a ele. Nenhuma mudança de comportamento:
-- todo membro nasce com client_scope = 'todos', nenhuma policy chama os
-- predicados ainda (Tasks 3 e 4) e a flag de plano nasce false.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md

-- -------------------------------------------------------------
-- 1. Escopo no membership
-- -------------------------------------------------------------
-- Flag explícita, nunca inferida das linhas: restrito com zero linhas vê zero
-- clientes. client_scope_rev é incrementado a cada mudança de escopo ou de
-- lista para o realtime do CRM (canal wm:, que só escuta workspace_members)
-- disparar a revogação ao vivo também quando só a lista muda.
ALTER TABLE public.workspace_members
  ADD COLUMN client_scope text NOT NULL DEFAULT 'todos'
    CONSTRAINT workspace_members_client_scope_check
    CHECK (client_scope IN ('todos', 'atribuidos')),
  ADD COLUMN client_scope_rev bigint NOT NULL DEFAULT 0;

-- -------------------------------------------------------------
-- 2. Atribuições
-- -------------------------------------------------------------
CREATE TABLE public.workspace_member_clientes (
  workspace_id uuid   NOT NULL,
  user_id      uuid   NOT NULL,
  cliente_id   bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  PRIMARY KEY (workspace_id, user_id, cliente_id),
  -- Remover o membro apaga as atribuições dele.
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspace_members (workspace_id, user_id) ON DELETE CASCADE,
  -- Tenant-safe: o cliente tem que ser do mesmo workspace. Excluir o cliente
  -- apaga as atribuições dele.
  FOREIGN KEY (cliente_id, workspace_id)
    REFERENCES public.clientes (id, conta_id) ON DELETE CASCADE
);
-- Lookup reverso (excluir cliente, listar quem vê um cliente).
CREATE INDEX idx_workspace_member_clientes_cliente
  ON public.workspace_member_clientes (cliente_id);

ALTER TABLE public.workspace_member_clientes ENABLE ROW LEVEL SECURITY;
-- Membro lê as próprias linhas; dono lê todas as do workspace. Escrita só pela
-- RPC set_member_client_scope (service_role), então sem policy de escrita.
CREATE POLICY wmc_select_own_or_owner ON public.workspace_member_clientes
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members wm
       WHERE wm.workspace_id = workspace_member_clientes.workspace_id
         AND wm.user_id = auth.uid()
         AND wm.role = 'owner'
    )
  );

-- O default ACL do Supabase hospedado dá ALL a anon/authenticated em tabela
-- nova do public: revogar nomeando os papéis, depois conceder só o SELECT.
REVOKE ALL ON TABLE public.workspace_member_clientes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workspace_member_clientes TO authenticated;
GRANT ALL ON TABLE public.workspace_member_clientes TO service_role;

-- -------------------------------------------------------------
-- 3. Flag de plano e cliente da notificação
-- -------------------------------------------------------------
ALTER TABLE public.plans
  ADD COLUMN feature_acesso_por_cliente boolean NOT NULL DEFAULT false;

-- Sem FK: excluir o cliente deixa o id, inofensivo (nenhum cliente o terá).
ALTER TABLE public.notifications ADD COLUMN cliente_id bigint NULL;
CREATE INDEX idx_notifications_workspace_cliente
  ON public.notifications (workspace_id, cliente_id);

-- Backfill único a partir do metadata (as triggers de notificação gravam
-- post_id e workflow_id). Ids não numéricos ficam de fora em vez de derrubar a
-- migração; o join confere o workspace. Função para o teste exercitar o mesmo
-- código; EXECUTE só do dono da função.
CREATE OR REPLACE FUNCTION public._notifications_backfill_cliente_id()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_post bigint;
  v_wf   bigint;
BEGIN
  UPDATE public.notifications n
     SET cliente_id = wp.cliente_id
    FROM public.workflow_posts wp
   WHERE n.cliente_id IS NULL
     AND n.metadata ->> 'post_id' ~ '^[0-9]{1,18}$'
     AND wp.id = (n.metadata ->> 'post_id')::bigint
     AND wp.conta_id = n.workspace_id;
  GET DIAGNOSTICS v_post = ROW_COUNT;

  UPDATE public.notifications n
     SET cliente_id = w.cliente_id
    FROM public.workflows w
   WHERE n.cliente_id IS NULL
     AND n.metadata ->> 'workflow_id' ~ '^[0-9]{1,18}$'
     AND w.id = (n.metadata ->> 'workflow_id')::bigint
     AND w.conta_id = n.workspace_id;
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  RETURN v_post + v_wf;
END;
$$;
REVOKE ALL ON FUNCTION public._notifications_backfill_cliente_id()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE v_n bigint;
BEGIN
  v_n := public._notifications_backfill_cliente_id();
  RAISE NOTICE 'notifications.cliente_id backfilled: % rows', v_n;
END $$;

-- -------------------------------------------------------------
-- 4. O predicado (fonte única)
-- -------------------------------------------------------------
-- Núcleo com usuário e workspace explícitos: edge functions e MCP (service_role).
-- Ordem: sem membership -> false; dono -> true; todos -> true;
-- cliente NULL -> false (o "é dele" é decidido pela policy); senão EXISTS.
-- Nunca lê a flag de plano (falha fechada não depende de plano).
CREATE OR REPLACE FUNCTION public.can_access_cliente(
  p_user uuid, p_conta uuid, p_cliente_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_scope text;
BEGIN
  IF p_user IS NULL OR p_conta IS NULL THEN RETURN false; END IF;

  SELECT wm.role, wm.client_scope INTO v_role, v_scope
    FROM public.workspace_members wm
   WHERE wm.user_id = p_user AND wm.workspace_id = p_conta;

  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;
  IF v_scope = 'todos' THEN RETURN true; END IF;
  IF p_cliente_id IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.workspace_member_clientes wmc
     WHERE wmc.workspace_id = p_conta
       AND wmc.user_id = p_user
       AND wmc.cliente_id = p_cliente_id
  );
END;
$$;

-- Wrapper para policies (authenticated): usuário atual + workspace ativo.
-- auth.uid() NULL (pg_cron, chamadas service-role) = irrestrito: esses
-- caminhos carregam o próprio filtro.
CREATE OR REPLACE FUNCTION public.can_access_cliente(p_cliente_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN true
    ELSE public.can_access_cliente(auth.uid(), public.get_my_conta_id(), p_cliente_id)
  END;
$$;

-- Curto-circuito barato para as policies (initplan): true para dono e para
-- 'todos' no workspace ativo; false para restrito e para quem não tem
-- membership no workspace ativo.
CREATE OR REPLACE FUNCTION public.my_client_scope_all()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NULL OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = auth.uid()
       AND wm.workspace_id = public.get_my_conta_id()
       AND (wm.role = 'owner' OR wm.client_scope = 'todos')
  );
$$;

-- membros.id do usuário atual no workspace ativo, para as colunas de
-- responsável (bigint). DEFINER: membros tem GRANT SELECT por coluna.
CREATE OR REPLACE FUNCTION public.my_membro_ids()
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}'::bigint[])
    FROM public.membros m
   WHERE m.crm_user_id = auth.uid()
     AND m.conta_id = public.get_my_conta_id();
$$;

-- Contexto do item dele em cliente oculto: libera só o que o item precisa
-- (nome, marca do cliente), nunca a lista do cliente. "É dele" por enquanto:
--   workflow_posts.responsavel_id, workflow_etapas.responsavel_id (cliente via
--   workflows), tarefas.responsavel_id e tarefas.user_id (autor).
-- O inventário (Task 2) e as Tasks 4a-4e ampliam esta lista; o caso de drift
-- context_fn_covers_own_tables confere. DEFINER: as policies dessas tabelas
-- vão chamar esta função, e como invoker ela recursaria nelas.
CREATE OR REPLACE FUNCTION public.can_see_cliente_context(p_cliente_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_conta uuid;
  v_ids   bigint[];
BEGIN
  IF public.can_access_cliente(p_cliente_id) THEN RETURN true; END IF;
  IF p_cliente_id IS NULL OR v_uid IS NULL THEN RETURN false; END IF;

  v_conta := public.get_my_conta_id();
  IF v_conta IS NULL THEN RETURN false; END IF;
  v_ids := public.my_membro_ids();

  RETURN EXISTS (
      SELECT 1 FROM public.workflow_posts wp
       WHERE wp.cliente_id = p_cliente_id AND wp.conta_id = v_conta
         AND wp.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.workflow_etapas e
        JOIN public.workflows w ON w.id = e.workflow_id
       WHERE w.cliente_id = p_cliente_id AND w.conta_id = v_conta
         AND e.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.cliente_id = p_cliente_id AND t.conta_id = v_conta
         AND (t.responsavel_id = ANY (v_ids) OR t.user_id = v_uid)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_cliente(uuid, uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_cliente(uuid, uuid, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.can_access_cliente(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_cliente(bigint) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_client_scope_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_client_scope_all() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_membro_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_membro_ids() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_see_cliente_context(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_cliente_context(bigint) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 5. RPC do dono (padrão set_financial_access)
-- -------------------------------------------------------------
-- Só o dono edita, para nenhum restrito (nem admin com equipe:editar) ampliar
-- o próprio escopo. Chamada pela ação set-client-scope do manage-workspace-user.
-- A flag de plano só barra ENTRAR em 'atribuidos'; sair (ou editar a lista de
-- quem já está restrito) nunca depende do plano.
CREATE OR REPLACE FUNCTION public.set_member_client_scope(
  p_actor uuid, p_workspace uuid, p_user uuid, p_scope text, p_cliente_ids bigint[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role  text;
  v_target_role text;
  v_cur_scope   text;
  v_ids         bigint[];
  v_cur_ids     bigint[];
BEGIN
  SELECT role INTO v_actor_role FROM public.workspace_members
   WHERE user_id = p_actor AND workspace_id = p_workspace;
  IF v_actor_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'not_owner'; END IF;

  -- FOR UPDATE: serializa chamadas concorrentes para o mesmo membro.
  SELECT role, client_scope INTO v_target_role, v_cur_scope
    FROM public.workspace_members
   WHERE user_id = p_user AND workspace_id = p_workspace
   FOR UPDATE;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'target_not_member'; END IF;
  IF v_target_role = 'owner' THEN RAISE EXCEPTION 'target_is_owner'; END IF;

  IF p_scope IS NULL OR p_scope NOT IN ('todos', 'atribuidos') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  IF p_scope = 'atribuidos' AND v_cur_scope <> 'atribuidos'
     AND NOT public.effective_plan_feature(p_workspace, 'feature_acesso_por_cliente') THEN
    RAISE EXCEPTION 'feature_disabled';
  END IF;

  -- 'todos' ignora a lista (zera as linhas).
  IF p_scope = 'todos' THEN
    v_ids := '{}'::bigint[];
  ELSE
    IF array_position(COALESCE(p_cliente_ids, '{}'::bigint[]), NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'cliente_not_in_workspace';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::bigint[]) INTO v_ids
      FROM unnest(COALESCE(p_cliente_ids, '{}'::bigint[])) AS x;
    IF EXISTS (
      SELECT 1 FROM unnest(v_ids) AS x
       WHERE NOT EXISTS (SELECT 1 FROM public.clientes c
                          WHERE c.id = x AND c.conta_id = p_workspace)
    ) THEN
      RAISE EXCEPTION 'cliente_not_in_workspace';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(cliente_id ORDER BY cliente_id), '{}'::bigint[]) INTO v_cur_ids
    FROM public.workspace_member_clientes
   WHERE workspace_id = p_workspace AND user_id = p_user;

  -- No-op não incrementa rev nem grava audit.
  IF v_cur_scope = p_scope AND v_cur_ids = v_ids THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  UPDATE public.workspace_members
     SET client_scope = p_scope,
         client_scope_rev = client_scope_rev + 1
   WHERE user_id = p_user AND workspace_id = p_workspace;

  DELETE FROM public.workspace_member_clientes
   WHERE workspace_id = p_workspace AND user_id = p_user
     AND NOT (cliente_id = ANY (v_ids));
  INSERT INTO public.workspace_member_clientes (workspace_id, user_id, cliente_id, created_by)
  SELECT p_workspace, p_user, x, p_actor FROM unnest(v_ids) AS x
  ON CONFLICT (workspace_id, user_id, cliente_id) DO NOTHING;

  -- Só escopo e contagem: nunca nomes de cliente no audit.
  INSERT INTO public.audit_log
    (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (p_workspace, p_actor, 'member_client_scope_set', 'workspace_member',
          p_user::text,
          jsonb_build_object('scope', p_scope, 'count', cardinality(v_ids)));

  RETURN jsonb_build_object('changed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_client_scope(uuid, uuid, uuid, text, bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_client_scope(uuid, uuid, uuid, text, bigint[])
  TO service_role;

-- -------------------------------------------------------------
-- 6. Promoção a dono zera o escopo
-- -------------------------------------------------------------
-- Todo owner é irrestrito (o predicado checa o papel primeiro); o trigger só
-- deixa o dado coerente para quando ele for rebaixado (volta como 'todos').
CREATE OR REPLACE FUNCTION public.trg_workspace_members_owner_clears_scope_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.client_scope := 'todos';
  NEW.client_scope_rev := OLD.client_scope_rev + 1;
  DELETE FROM public.workspace_member_clientes
   WHERE workspace_id = NEW.workspace_id AND user_id = NEW.user_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_workspace_members_owner_clears_scope_fn()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_workspace_members_owner_clears_scope
  BEFORE UPDATE OF role ON public.workspace_members
  FOR EACH ROW
  WHEN (NEW.role = 'owner' AND OLD.role IS DISTINCT FROM 'owner')
  EXECUTE FUNCTION public.trg_workspace_members_owner_clears_scope_fn();

-- -------------------------------------------------------------
-- 7. Post-conditions (padrão 20260903000002): ACLs por assinatura exata, já
-- que can_access_cliente tem duas sobrecargas.
-- -------------------------------------------------------------
DO $$
DECLARE
  fn  text;
  acl text;
BEGIN
  -- service_role apenas
  FOREACH fn IN ARRAY ARRAY['public.can_access_cliente(uuid,uuid,bigint)',
                            'public.set_member_client_scope(uuid,uuid,uuid,text,bigint[])'] LOOP
    SELECT array_to_string(proacl, ',') INTO acl FROM pg_proc WHERE oid = fn::regprocedure;
    IF acl IS NULL OR acl NOT LIKE '%service_role=X%' THEN
      RAISE EXCEPTION '%: service_role lacks EXECUTE — acl=%', fn, acl;
    END IF;
    IF acl LIKE '%authenticated=X%' OR acl LIKE '%anon=X%'
       OR acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
      RAISE EXCEPTION '%: authenticated/anon/PUBLIC retains EXECUTE — acl=%', fn, acl;
    END IF;
  END LOOP;

  -- authenticated (usáveis em policy), nunca anon/PUBLIC
  FOREACH fn IN ARRAY ARRAY['public.can_access_cliente(bigint)',
                            'public.my_client_scope_all()',
                            'public.my_membro_ids()',
                            'public.can_see_cliente_context(bigint)'] LOOP
    SELECT array_to_string(proacl, ',') INTO acl FROM pg_proc WHERE oid = fn::regprocedure;
    IF acl IS NULL OR acl NOT LIKE '%authenticated=X%' THEN
      RAISE EXCEPTION '%: authenticated lacks EXECUTE — acl=%', fn, acl;
    END IF;
    IF acl LIKE '%anon=X%' OR acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
      RAISE EXCEPTION '%: anon/PUBLIC retains EXECUTE — acl=%', fn, acl;
    END IF;
  END LOOP;

  -- ninguém além do dono da função
  FOREACH fn IN ARRAY ARRAY['public._notifications_backfill_cliente_id()',
                            'public.trg_workspace_members_owner_clears_scope_fn()'] LOOP
    SELECT array_to_string(proacl, ',') INTO acl FROM pg_proc WHERE oid = fn::regprocedure;
    IF acl IS NULL OR acl LIKE '%authenticated=X%' OR acl LIKE '%anon=X%'
       OR acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
      RAISE EXCEPTION '%: unexpected EXECUTE grant — acl=%', fn, acl;
    END IF;
  END LOOP;
  SELECT array_to_string(proacl, ',') INTO acl FROM pg_proc
   WHERE oid = 'public._notifications_backfill_cliente_id()'::regprocedure;
  IF acl LIKE '%service_role=X%' THEN
    RAISE EXCEPTION '_notifications_backfill_cliente_id: service_role retains EXECUTE — acl=%', acl;
  END IF;

  -- tabela: authenticated só lê
  IF NOT has_table_privilege('authenticated', 'public.workspace_member_clientes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.workspace_member_clientes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_member_clientes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_member_clientes', 'DELETE')
     OR has_table_privilege('anon', 'public.workspace_member_clientes', 'SELECT') THEN
    RAISE EXCEPTION 'workspace_member_clientes: unexpected table grants';
  END IF;
END $$;
