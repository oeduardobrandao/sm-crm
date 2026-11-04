-- Acesso por cliente, Migração C1 (posts e fluxos): workflows, workflow_posts e
-- tudo que pende deles respeitam o escopo do membro.
--
-- Raízes de item (workflow_posts, workflow_etapas; post_process_steps só por RPC):
--   leitura  = <qual atual> AND ((SELECT my_client_scope_all()) OR can_access_cliente(cliente) OR <é dele>)
--   UPDATE   = USING e WITH CHECK com a regra de leitura: o membro restrito
--              conclui a própria etapa e edita o próprio post num cliente oculto.
--              O trigger guard_client_scope_move barra mover o item
--              (cliente_id/workflow_id) sem acesso à origem e ao destino, e pôr a
--              si mesmo como responsável sem acesso ao cliente.
--   INSERT e DELETE = estritos, sem o "é dele" (senão um restrito criaria um
--              item num cliente oculto e passaria a lê-lo, ou apagaria o item).
--   workflow_posts usa o próprio cliente_id (NOT NULL, também no post avulso).
-- workflows: sem "é dele" por user_id (decisão). Legível quando o membro tem um
--   post ou etapa dele no workflow (contexto), nunca gravável por isso.
-- Filhas do post: leitura, INSERT e UPDATE pelo post visível (EXISTS no pai, que
--   roda com a RLS dele), mais as colunas de autor na leitura. DELETE num post de
--   cliente que ele não acessa: só a linha que ele mesmo escreveu.
-- Filhas do workflow (tokens do portal, eventos): estritas pelo cliente do
--   workflow. Opções de select: legíveis no workflow de contexto, escrita estrita.
-- Onde a policy atual é FOR ALL, a parte estrita (INSERT/DELETE) entra como
-- policy RESTRICTIVE nova: a permissiva fica igual e o membro irrestrito não muda
-- (o primeiro termo de cada restritiva é (SELECT my_client_scope_all())).
-- O termo (SELECT my_client_scope_all()) vem primeiro: é um initplan, então o
-- membro irrestrito não paga can_access_cliente nem o EXISTS por linha.
-- Já herdam o pai sem mudança na leitura (o qual consulta o pai pela FK):
-- post_approvals, post_property_values, post_comments, post_approval_media_notes,
-- portal_approvals.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

-- -------------------------------------------------------------
-- 0. Helpers
-- -------------------------------------------------------------
-- Workspace do workflow sem passar pela RLS de workflows (o "é dele" da etapa
-- não tem conta_id próprio; my_membro_ids() limita o membro, não a etapa).
CREATE OR REPLACE FUNCTION public.workflow_in_active_conta(p_workflow_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workflows w
     WHERE w.id = p_workflow_id AND w.conta_id = public.get_my_conta_id()
  );
$$;
REVOKE ALL ON FUNCTION public.workflow_in_active_conta(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_in_active_conta(bigint) TO authenticated, service_role;

-- O usuário atual tem um post ou etapa "dele" neste workflow (workspace ativo).
-- DEFINER: a policy de workflows chamá-la como invoker recursaria em
-- workflow_etapas, cuja policy consulta workflows.
CREATE OR REPLACE FUNCTION public.workflow_has_own_item(p_workflow_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.workflow_posts wp
       WHERE wp.workflow_id = p_workflow_id
         AND wp.conta_id = public.get_my_conta_id()
         AND wp.responsavel_id = ANY (public.my_membro_ids())
    ) OR EXISTS (
      SELECT 1 FROM public.workflow_etapas e
        JOIN public.workflows w ON w.id = e.workflow_id
       WHERE e.workflow_id = p_workflow_id
         AND w.conta_id = public.get_my_conta_id()
         AND e.responsavel_id = ANY (public.my_membro_ids())
    );
$$;
REVOKE ALL ON FUNCTION public.workflow_has_own_item(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_has_own_item(bigint) TO authenticated, service_role;

-- Guarda das raízes de item (workflow_posts, workflow_etapas) para membro
-- restrito. O WITH CHECK do UPDATE tem o "é dele", então quem barra a
-- realocação e a autoatribuição é este trigger:
--   * mover (cliente_id ou workflow_id, inclusive para NULL) exige acesso ao
--     cliente de ORIGEM e ao de DESTINO: o item dele num cliente oculto pode
--     ser editado, nunca tirado de lá (e depois apagado);
--   * pôr a si mesmo como responsável exige acesso ao cliente do item (vale
--     também nos caminhos SECURITY DEFINER, que não passam pela RLS).
-- conta_id fica com o WITH CHECK (tenant). Sem lista de colunas e com o prefixo
-- zz, o trigger roda depois dos outros BEFORE UPDATE (post_a0_sync_cliente
-- deriva cliente_id; as automações de status mexem em responsavel_id) e vê o
-- NEW final. Restrito = linha em workspace_members da conta do item com
-- client_scope 'atribuidos' e papel diferente de owner. auth.uid() NULL
-- (service role, cron) e membros irrestritos saem no primeiro EXISTS, antes de
-- qualquer leitura de workflows. Vale dentro das RPCs de mover (detach/attach),
-- que rodam com o auth.uid() de quem chamou.
CREATE OR REPLACE FUNCTION public.guard_client_scope_move()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_conta   uuid;
  v_old_cli bigint;
  v_new_cli bigint;
  v_moved   boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  -- Saída barata: quem não é restrito em nenhum workspace não paga nada mais.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = v_uid AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  -- IFs aninhados: plpgsql resolve NEW.cliente_id mesmo com o AND falso, e
  -- workflow_etapas não tem a coluna.
  IF TG_TABLE_NAME = 'workflow_posts' THEN
    v_conta   := NEW.conta_id;
    v_old_cli := OLD.cliente_id;
    v_new_cli := NEW.cliente_id;
    v_moved   := NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
                 OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id;
  ELSE
    v_moved := NEW.workflow_id IS DISTINCT FROM OLD.workflow_id;
    IF NOT v_moved AND NEW.responsavel_id IS NOT DISTINCT FROM OLD.responsavel_id THEN
      RETURN NEW;
    END IF;
    SELECT w.conta_id, w.cliente_id INTO v_conta, v_new_cli
      FROM public.workflows w WHERE w.id = NEW.workflow_id;
    SELECT w.cliente_id INTO v_old_cli FROM public.workflows w WHERE w.id = OLD.workflow_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = v_conta AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  IF v_moved THEN
    IF NOT public.can_access_cliente(v_uid, v_conta, v_old_cli)
       OR NOT public.can_access_cliente(v_uid, v_conta, v_new_cli) THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
    END IF;
    IF TG_TABLE_NAME = 'workflow_posts' THEN
      IF NEW.workflow_id IS NOT NULL
         AND NOT public.can_access_cliente(v_uid, v_conta,
               (SELECT w.cliente_id FROM public.workflows w WHERE w.id = NEW.workflow_id)) THEN
        RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  IF NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
     AND EXISTS (SELECT 1 FROM public.membros m
                  WHERE m.id = NEW.responsavel_id AND m.crm_user_id = v_uid AND m.conta_id = v_conta)
     AND NOT public.can_access_cliente(v_uid, v_conta, v_new_cli) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_client_scope_move() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_client_scope_move() TO service_role;

CREATE TRIGGER workflow_posts_zz_client_scope_guard
  BEFORE UPDATE ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_scope_move();
CREATE TRIGGER workflow_etapas_zz_client_scope_guard
  BEFORE UPDATE ON public.workflow_etapas
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_scope_move();

-- Guarda das filhas com DELETE estrito (post_media, threads, comentários,
-- sugestões, alvos, valores de propriedade, aprovações do portal):
--   * a coluna de autor que libera o DELETE (uploaded_by, created_by,
--     author_id) é imutável para qualquer usuário logado: sem isto um restrito
--     reescreveria o autor da linha visível e então a apagaria. Nenhum trigger
--     ou grant por coluna fixava essas colunas (post_media_notes.author_user_id
--     já é fixado pelo GRANT UPDATE (status) da tabela);
--   * trocar o pai (post_id, thread_id, workflow_etapa_id) exige, para o
--     restrito, acesso ao cliente do pai de ORIGEM: senão ele moveria a filha do
--     item dele num cliente oculto para um pai acessível e a apagaria lá.
-- auth.uid() NULL (service role, cron) passa.
CREATE OR REPLACE FUNCTION public.guard_post_child_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_moved boolean := false;
  v_conta uuid;
  v_cli   bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'post_media' THEN
    IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
      RAISE EXCEPTION 'author_immutable' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'post_comment_threads' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'author_immutable' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'post_comments' THEN
    IF NEW.author_id IS DISTINCT FROM OLD.author_id THEN
      RAISE EXCEPTION 'author_immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'post_comments' THEN
    v_moved := NEW.thread_id IS DISTINCT FROM OLD.thread_id;
  ELSIF TG_TABLE_NAME = 'portal_approvals' THEN
    v_moved := NEW.workflow_etapa_id IS DISTINCT FROM OLD.workflow_etapa_id;
  ELSE
    v_moved := NEW.post_id IS DISTINCT FROM OLD.post_id;
  END IF;
  IF NOT v_moved THEN RETURN NEW; END IF;
  -- Saída barata para quem não é restrito em nenhum workspace.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = v_uid AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'post_comments' THEN
    SELECT wp.conta_id, wp.cliente_id INTO v_conta, v_cli
      FROM public.post_comment_threads t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
     WHERE t.id = OLD.thread_id;
  ELSIF TG_TABLE_NAME = 'portal_approvals' THEN
    SELECT w.conta_id, w.cliente_id INTO v_conta, v_cli
      FROM public.workflow_etapas e
      JOIN public.workflows w ON w.id = e.workflow_id
     WHERE e.id = OLD.workflow_etapa_id;
  ELSE
    SELECT wp.conta_id, wp.cliente_id INTO v_conta, v_cli
      FROM public.workflow_posts wp WHERE wp.id = OLD.post_id;
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = v_conta AND wm.user_id = v_uid
          AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos')
     AND NOT public.can_access_cliente(v_uid, v_conta, v_cli) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_post_child_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_post_child_update() TO service_role;

CREATE TRIGGER post_media_scope_guard
  BEFORE UPDATE OF uploaded_by, post_id ON public.post_media
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_child_update();
CREATE TRIGGER post_comment_threads_scope_guard
  BEFORE UPDATE OF created_by, post_id ON public.post_comment_threads
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_child_update();
CREATE TRIGGER post_comments_scope_guard
  BEFORE UPDATE OF author_id, thread_id ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_child_update();
CREATE TRIGGER post_edit_suggestions_scope_guard
  BEFORE UPDATE OF post_id ON public.post_edit_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_child_update();
CREATE TRIGGER post_targets_scope_guard
  BEFORE UPDATE OF post_id ON public.post_targets
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_child_update();
CREATE TRIGGER post_property_values_scope_guard
  BEFORE UPDATE OF post_id ON public.post_property_values
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_child_update();
CREATE TRIGGER portal_approvals_scope_guard
  BEFORE UPDATE OF workflow_etapa_id ON public.portal_approvals
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_child_update();

-- Etapa de processo atribuída a si mesmo: torna a etapa "dele" (pps_select_member)
-- e dá contexto do cliente. authenticated não escreve post_process_steps direto
-- (só SELECT no grant, policies de escrita false): quem escreve são as RPCs
-- SECURITY DEFINER (Task 5). Defesa em profundidade para esse caminho: o
-- restrito só põe a si mesmo como responsável se acessa o cliente do post do
-- processo.
CREATE OR REPLACE FUNCTION public.guard_post_process_step_assign()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cli bigint;
BEGIN
  IF v_uid IS NULL OR NEW.responsavel_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.responsavel_id IS NOT DISTINCT FROM OLD.responsavel_id THEN RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.membros m
                  WHERE m.id = NEW.responsavel_id AND m.crm_user_id = v_uid
                    AND m.conta_id = NEW.conta_id) THEN
    RETURN NEW;
  END IF;
  SELECT wp.cliente_id INTO v_cli
    FROM public.post_processes pp
    JOIN public.workflow_posts wp ON wp.id = pp.post_id AND wp.conta_id = pp.conta_id
   WHERE pp.id = NEW.process_id AND pp.conta_id = NEW.conta_id;
  IF NOT public.can_access_cliente(v_uid, NEW.conta_id, v_cli) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_post_process_step_assign() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_post_process_step_assign() TO service_role;

CREATE TRIGGER post_process_steps_scope_guard
  BEFORE INSERT OR UPDATE OF responsavel_id ON public.post_process_steps
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_process_step_assign();

-- -------------------------------------------------------------
-- 1. workflow_posts
-- -------------------------------------------------------------
-- FOR ALL sem WITH CHECK até aqui. USING e WITH CHECK levam o "é dele" (leitura
-- e UPDATE); INSERT e DELETE estritos pelas RESTRICTIVE abaixo. Mover e
-- autoatribuir: trigger workflow_posts_zz_client_scope_guard.
ALTER POLICY workspace_posts_all ON public.workflow_posts
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[]))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[]))
  );
CREATE POLICY workflow_posts_scope_insert ON public.workflow_posts
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id));
CREATE POLICY workflow_posts_scope_delete ON public.workflow_posts
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id));

-- -------------------------------------------------------------
-- 2. workflows
-- -------------------------------------------------------------
ALTER POLICY workflows_select ON public.workflows
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR public.workflow_has_own_item(id))
  );
ALTER POLICY workflows_delete ON public.workflows
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workflows_insert ON public.workflows
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY workflows_update ON public.workflows
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

-- -------------------------------------------------------------
-- 3. workflow_etapas (sem conta_id; tenant e cliente vêm do workflow)
-- -------------------------------------------------------------
-- O workflow pode estar legível só por contexto (item dele), então a
-- subconsulta exige também o acesso ao cliente do workflow: as outras etapas de
-- um workflow de cliente oculto continuam ocultas. O "é dele" fica num OR
-- próprio, com o tenant conferido por workflow_in_active_conta.
ALTER POLICY workflow_etapas_select ON public.workflow_etapas
  USING (
    workflow_id IN (SELECT workflows.id FROM public.workflows
                     WHERE workflows.conta_id IN (SELECT public.get_my_conta_id())
                       AND ((SELECT public.my_client_scope_all())
                            OR public.can_access_cliente(workflows.cliente_id)))
    OR (responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
        AND public.workflow_in_active_conta(workflow_id))
  );
ALTER POLICY workflow_etapas_update ON public.workflow_etapas
  USING (
    workflow_id IN (SELECT workflows.id FROM public.workflows
                     WHERE workflows.conta_id IN (SELECT public.get_my_conta_id())
                       AND ((SELECT public.my_client_scope_all())
                            OR public.can_access_cliente(workflows.cliente_id)))
    OR (responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
        AND public.workflow_in_active_conta(workflow_id))
  )
  WITH CHECK (
    workflow_id IN (SELECT workflows.id FROM public.workflows
                     WHERE workflows.conta_id IN (SELECT public.get_my_conta_id())
                       AND ((SELECT public.my_client_scope_all())
                            OR public.can_access_cliente(workflows.cliente_id)))
    OR (responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
        AND public.workflow_in_active_conta(workflow_id))
  );
ALTER POLICY workflow_etapas_insert ON public.workflow_etapas
  WITH CHECK (
    workflow_id IN (SELECT workflows.id FROM public.workflows
                     WHERE workflows.conta_id IN (SELECT public.get_my_conta_id())
                       AND ((SELECT public.my_client_scope_all())
                            OR public.can_access_cliente(workflows.cliente_id)))
  );
ALTER POLICY workflow_etapas_delete ON public.workflow_etapas
  USING (
    workflow_id IN (SELECT workflows.id FROM public.workflows
                     WHERE workflows.conta_id IN (SELECT public.get_my_conta_id())
                       AND ((SELECT public.my_client_scope_all())
                            OR public.can_access_cliente(workflows.cliente_id)))
  );

-- -------------------------------------------------------------
-- 4. Filhas do workflow: estritas pelo cliente do workflow
-- -------------------------------------------------------------
-- Opções de select: legíveis também no workflow de contexto (item dele), para
-- os rótulos das propriedades do post dele aparecerem. Escrita estrita: o WITH
-- CHECK não tem o item dele, e UPDATE/DELETE (que o USING do FOR ALL também
-- rege) ficam estritos pelas RESTRICTIVE abaixo.
ALTER POLICY workspace_wso_all ON public.workflow_select_options
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w
                     WHERE w.id = workflow_select_options.workflow_id
                       AND (public.can_access_cliente(w.cliente_id)
                            OR public.workflow_has_own_item(w.id))))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w
                     WHERE w.id = workflow_select_options.workflow_id
                       AND public.can_access_cliente(w.cliente_id)))
  );

CREATE POLICY workflow_select_options_scope_update ON public.workflow_select_options
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.workflows w
                WHERE w.id = workflow_select_options.workflow_id
                  AND public.can_access_cliente(w.cliente_id))
  );
CREATE POLICY workflow_select_options_scope_delete ON public.workflow_select_options
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.workflows w
                WHERE w.id = workflow_select_options.workflow_id
                  AND public.can_access_cliente(w.cliente_id))
  );

ALTER POLICY portal_tokens_workspace_all ON public.portal_tokens
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w
                     WHERE w.id = portal_tokens.workflow_id
                       AND public.can_access_cliente(w.cliente_id)))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w
                     WHERE w.id = portal_tokens.workflow_id
                       AND public.can_access_cliente(w.cliente_id)))
  );

ALTER POLICY workflow_events_select ON public.workflow_events
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w
                     WHERE w.id = workflow_events.workflow_id
                       AND public.can_access_cliente(w.cliente_id)))
  );

-- portal_approvals: leitura, INSERT e UPDATE seguem a etapa visível (qual atual,
-- inalterado); DELETE só com acesso ao cliente do workflow.
ALTER POLICY portal_approvals_delete ON public.portal_approvals
  USING (
    workflow_etapa_id IN (SELECT we.id
                            FROM public.workflow_etapas we
                            JOIN public.workflows w ON w.id = we.workflow_id
                           WHERE w.conta_id IN (SELECT public.get_my_conta_id()))
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_etapas we
                      JOIN public.workflows w ON w.id = we.workflow_id
                     WHERE we.id = portal_approvals.workflow_etapa_id
                       AND public.can_access_cliente(w.cliente_id)))
  );

-- -------------------------------------------------------------
-- 5. Filhas do post
-- -------------------------------------------------------------
ALTER POLICY post_media_tenant_all ON public.post_media
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_media.post_id)
         OR uploaded_by = auth.uid())
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_media.post_id))
  );

ALTER POLICY post_comment_threads_select ON public.post_comment_threads
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_comment_threads.post_id)
         OR created_by = auth.uid())
  );
ALTER POLICY post_comment_threads_insert ON public.post_comment_threads
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_comment_threads.post_id))
  );
ALTER POLICY post_comment_threads_update ON public.post_comment_threads
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_comment_threads.post_id)
         OR created_by = auth.uid())
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_comment_threads.post_id))
  );

ALTER POLICY post_content_versions_select ON public.post_content_versions
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_content_versions.post_id))
  );

-- A linha já é só do próprio usuário; ela segue o post (sem "é dele" por user_id).
ALTER POLICY post_discussao_participantes_own_select ON public.post_discussao_participantes
  USING (
    user_id = auth.uid()
    AND conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_discussao_participantes.post_id))
  );

ALTER POLICY workspace_edit_suggestions_all ON public.post_edit_suggestions
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_edit_suggestions.post_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_edit_suggestions.post_id))
  );

ALTER POLICY post_media_notes_tenant_select ON public.post_media_notes
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_media_notes.post_id)
         OR author_user_id = auth.uid())
  );
ALTER POLICY post_media_notes_team_insert ON public.post_media_notes
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_kind = 'team'
    AND visibility = 'internal'
    AND author_user_id = auth.uid()
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_media_notes.post_id))
  );
ALTER POLICY post_media_notes_tenant_update ON public.post_media_notes
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_media_notes.post_id)
         OR author_user_id = auth.uid())
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_media_notes.post_id))
  );

-- Resposta segue a nota (que segue o post).
ALTER POLICY post_media_note_replies_tenant_select ON public.post_media_note_replies
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.post_media_notes n WHERE n.id = post_media_note_replies.note_id)
         OR author_user_id = auth.uid())
  );
ALTER POLICY post_media_note_replies_team_insert ON public.post_media_note_replies
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_kind = 'team'
    AND author_user_id = auth.uid()
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.post_media_notes n WHERE n.id = post_media_note_replies.note_id))
  );

ALTER POLICY post_references_tenant_select ON public.post_references
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_references.post_id))
  );

ALTER POLICY post_status_events_select ON public.post_status_events
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_status_events.post_id))
  );

ALTER POLICY post_targets_workspace_all ON public.post_targets
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_targets.post_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_targets.post_id))
  );

-- Processos: escrita só pelas RPCs (as policies *_no_client_* são false).
ALTER POLICY pp_select_member ON public.post_processes
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_processes.post_id)
         OR created_by = auth.uid())
  );
-- Etapa do processo: segue o processo, ou é dele pelo responsável (raiz de
-- contexto, como workflow_etapas; can_see_cliente_context abaixo a inclui).
ALTER POLICY pps_select_member ON public.post_process_steps
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.post_processes pp WHERE pp.id = post_process_steps.process_id)
         OR responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[]))
  );
ALTER POLICY ppe_select_member ON public.post_process_events
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.post_processes pp WHERE pp.id = post_process_events.process_id))
  );

-- -------------------------------------------------------------
-- 6. DELETE de filha: num post de cliente que o membro não acessa (o post dele
--    num cliente oculto), só a linha que ele mesmo escreveu
-- -------------------------------------------------------------
-- Tabelas com policy permissiva FOR ALL ganham uma RESTRICTIVE FOR DELETE; a
-- permissiva fica como está.
CREATE POLICY post_media_scope_delete ON public.post_media
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.workflow_posts wp
                WHERE wp.id = post_media.post_id AND public.can_access_cliente(wp.cliente_id))
    OR uploaded_by = auth.uid()
  );
CREATE POLICY post_edit_suggestions_scope_delete ON public.post_edit_suggestions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.workflow_posts wp
                WHERE wp.id = post_edit_suggestions.post_id AND public.can_access_cliente(wp.cliente_id))
  );
CREATE POLICY post_targets_scope_delete ON public.post_targets
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.workflow_posts wp
                WHERE wp.id = post_targets.post_id AND public.can_access_cliente(wp.cliente_id))
  );
CREATE POLICY post_property_values_scope_delete ON public.post_property_values
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.workflow_posts wp
                WHERE wp.id = post_property_values.post_id AND public.can_access_cliente(wp.cliente_id))
  );

-- Policies de DELETE próprias: o qual ganha a mesma regra.
ALTER POLICY post_comment_threads_delete ON public.post_comment_threads
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp
                     WHERE wp.id = post_comment_threads.post_id
                       AND public.can_access_cliente(wp.cliente_id))
         OR created_by = auth.uid())
  );
ALTER POLICY post_comments_delete ON public.post_comments
  USING (
    thread_id IN (SELECT post_comment_threads.id FROM public.post_comment_threads
                   WHERE post_comment_threads.conta_id IN (SELECT public.get_my_conta_id()))
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.post_comment_threads t
                      JOIN public.workflow_posts wp ON wp.id = t.post_id
                     WHERE t.id = post_comments.thread_id
                       AND public.can_access_cliente(wp.cliente_id))
         OR author_id = auth.uid())
  );

-- -------------------------------------------------------------
-- 7. Contexto do item dele em cliente oculto: + post_process_steps
-- -------------------------------------------------------------
-- Corpo de 20261115000001 mais a etapa de processo atribuída (cliente via
-- post_processes -> workflow_posts). CREATE OR REPLACE mantém o ACL.
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
      SELECT 1 FROM public.post_process_steps s
        JOIN public.post_processes pp ON pp.id = s.process_id AND pp.conta_id = s.conta_id
        JOIN public.workflow_posts wp ON wp.id = pp.post_id AND wp.conta_id = pp.conta_id
       WHERE wp.cliente_id = p_cliente_id AND s.conta_id = v_conta
         AND s.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.cliente_id = p_cliente_id AND t.conta_id = v_conta
         AND (t.responsavel_id = ANY (v_ids) OR t.user_id = v_uid)
    );
END;
$$;
