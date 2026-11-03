-- Acesso por cliente, Migração C1 (posts e fluxos): workflows, workflow_posts e
-- tudo que pende deles respeitam o escopo do membro.
--
-- Raízes (cliente_id próprio):
--   leitura  = <qual atual> AND ((SELECT my_client_scope_all()) OR can_access_cliente(cliente_id) OR <é dele>)
--   escrita  = WITH CHECK explícito <check atual> AND ((SELECT my_client_scope_all()) OR can_access_cliente(cliente_id)),
--              sem o "é dele" (senão um restrito criaria/moveria um post para um
--              cliente oculto e passaria a lê-lo como responsável).
--   workflow_posts usa o próprio cliente_id (NOT NULL, também no post avulso).
--   workflows não tem "é dele" (user_id é o criador técnico, não autoria; decisão).
-- Filhas: leitura e escrita pelo pai visível (EXISTS no pai, que roda com a RLS
-- dele), mais as colunas de autor que o inventário lista, só na leitura.
-- O termo (SELECT my_client_scope_all()) vem primeiro: é um initplan, então o
-- membro irrestrito não paga can_access_cliente nem o EXISTS por linha.
-- Já herdam o pai sem mudança (o qual consulta o pai pela FK): post_approvals,
-- post_property_values, post_comments, post_approval_media_notes, portal_approvals.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

-- -------------------------------------------------------------
-- 1. Raízes
-- -------------------------------------------------------------
-- FOR ALL sem WITH CHECK até aqui: o Postgres usava o USING (que agora traz o
-- "é dele") na escrita. O WITH CHECK explícito tira o "é dele" da escrita.
ALTER POLICY workspace_posts_all ON public.workflow_posts
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[]))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

ALTER POLICY workflows_select ON public.workflows
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
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
-- 2. workflow_etapas (sem conta_id; o tenant vem do workflow)
-- -------------------------------------------------------------
-- A subconsulta em workflows já roda com a RLS de workflows, então o qual
-- atual passa a ser "workflow visível". O "é dele" (responsavel_id) não pode
-- ficar em AND com ele (o workflow de cliente oculto não aparece na
-- subconsulta), e sozinho não confere o tenant: my_membro_ids() limita o
-- membro ao workspace ativo, não a etapa. workflow_in_active_conta confere o
-- workspace do workflow sem passar pela RLS de workflows.
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

ALTER POLICY workflow_etapas_select ON public.workflow_etapas
  USING (
    workflow_id IN (SELECT workflows.id FROM public.workflows
                     WHERE workflows.conta_id IN (SELECT public.get_my_conta_id()))
    OR (responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
        AND public.workflow_in_active_conta(workflow_id))
  );
ALTER POLICY workflow_etapas_update ON public.workflow_etapas
  USING (
    workflow_id IN (SELECT workflows.id FROM public.workflows
                     WHERE workflows.conta_id IN (SELECT public.get_my_conta_id()))
    OR (responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
        AND public.workflow_in_active_conta(workflow_id))
  );
  -- WITH CHECK fica como está: workflow visível (sem "é dele").
ALTER POLICY workflow_etapas_delete ON public.workflow_etapas
  USING (
    workflow_id IN (SELECT workflows.id FROM public.workflows
                     WHERE workflows.conta_id IN (SELECT public.get_my_conta_id()))
    OR (responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
        AND public.workflow_in_active_conta(workflow_id))
  );
-- workflow_etapas_insert: inalterada, o check em workflows já é "workflow visível".

-- -------------------------------------------------------------
-- 3. Filhas do workflow
-- -------------------------------------------------------------
ALTER POLICY workspace_wso_all ON public.workflow_select_options
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_select_options.workflow_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_select_options.workflow_id))
  );

ALTER POLICY portal_tokens_workspace_all ON public.portal_tokens
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = portal_tokens.workflow_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = portal_tokens.workflow_id))
  );

ALTER POLICY workflow_events_select ON public.workflow_events
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_events.workflow_id))
  );

-- -------------------------------------------------------------
-- 4. Filhas do post
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
ALTER POLICY post_comment_threads_delete ON public.post_comment_threads
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
-- 5. Contexto do item dele em cliente oculto: + post_process_steps
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
