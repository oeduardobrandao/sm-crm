-- Acesso por cliente, ajustes da revisão final (Task 15).
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
--
-- 1. Notificações por ITEM, não pelo contexto do cliente (substitui o ramo de
--    contexto da 4e e da Task 14). Um restrito com um item dele num cliente
--    oculto lia (e recebia por e-mail) as menções e discussões de OUTROS itens
--    daquele cliente, porque o contexto abre o cliente inteiro. Agora a
--    notificação com cliente_id de cliente oculto só aparece se o item de que
--    ela trata é legível por ele.
--    O item é a chave mais específica do metadata, nesta ordem: post_id,
--    task_id, idea_id, linha_id, etapa_id, workflow_id (os emissores gravam
--    post_id junto com workflow_id; julgar pelo fluxo reabriria o vazamento,
--    porque o fluxo é legível por quem tem um item nele). Sem chave de item
--    (client_message, briefing_answered, falha de automação): só o escopo.
--    Ids não numéricos (ou uuid inválido) não derrubam a leitura: viram falso.
--    - notification_item_visible(metadata): SECURITY INVOKER, roda sob a RLS
--      de quem lê, então "dele" é exatamente o que ele abre. Usada pelas
--      policies notifications_select / notifications_update (USING e WITH
--      CHECK), no ramo do workspace ativo. O ramo de outro workspace (dono,
--      'todos' ou atribuído) não muda.
--    - notification_item_visible_for(user, conta, cliente, metadata):
--      espelho para um usuário qualquer (service_role só), com o "é dele" de
--      cada tabela: post = responsável; tarefa = responsável ou criador;
--      ideia = autor; etapa = responsável; fluxo = post ou etapa dele no
--      fluxo; linha editorial = só o escopo. Usada pelo claim do e-mail e pela
--      discussão do post.
--    - claim_notification_emails troca can_see_cliente_context_for por ela.
--      can_see_cliente_context_for sai (sem outro uso).
--    - trg_post_comments_discussao_insert não grava a prévia para quem segue
--      a discussão de um post que não abre.

-- -------------------------------------------------------------
-- 1. Notificações por item
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_item_visible(p_metadata jsonb)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = public
AS $function$
  -- Cada EXISTS roda sob a RLS de quem chama. O CASE interno só converte um id
  -- válido (CASE garante a ordem; um AND não garantiria).
  SELECT CASE
    WHEN p_metadata ->> 'post_id' IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.workflow_posts wp
       WHERE wp.id = CASE WHEN p_metadata ->> 'post_id' ~ '^[0-9]{1,18}$'
                          THEN (p_metadata ->> 'post_id')::bigint END)
    WHEN p_metadata ->> 'task_id' IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = CASE WHEN p_metadata ->> 'task_id' ~ '^[0-9]{1,18}$'
                         THEN (p_metadata ->> 'task_id')::bigint END)
    WHEN p_metadata ->> 'idea_id' IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.ideias i
       WHERE i.id = CASE WHEN p_metadata ->> 'idea_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         THEN (p_metadata ->> 'idea_id')::uuid END)
    WHEN p_metadata ->> 'linha_id' IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.linhas_editoriais l
       WHERE l.id = CASE WHEN p_metadata ->> 'linha_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         THEN (p_metadata ->> 'linha_id')::uuid END)
    WHEN p_metadata ->> 'etapa_id' IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.workflow_etapas e
       WHERE e.id = CASE WHEN p_metadata ->> 'etapa_id' ~ '^[0-9]{1,18}$'
                         THEN (p_metadata ->> 'etapa_id')::bigint END)
    WHEN p_metadata ->> 'workflow_id' IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.workflows w
       WHERE w.id = CASE WHEN p_metadata ->> 'workflow_id' ~ '^[0-9]{1,18}$'
                         THEN (p_metadata ->> 'workflow_id')::bigint END)
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.notification_item_visible(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_item_visible(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notification_item_visible_for(
  p_user uuid, p_conta uuid, p_cliente_id bigint, p_metadata jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ids  bigint[];
  v_txt  text;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF p_user IS NULL OR p_conta IS NULL THEN RETURN false; END IF;
  -- dono, 'todos' ou cliente atribuído
  IF public.can_access_cliente(p_user, p_conta, p_cliente_id) THEN RETURN true; END IF;

  SELECT COALESCE(array_agg(m.id), '{}'::bigint[]) INTO v_ids
    FROM public.membros m
   WHERE m.crm_user_id = p_user AND m.conta_id = p_conta;

  v_txt := p_metadata ->> 'post_id';
  IF v_txt IS NOT NULL THEN
    IF v_txt !~ '^[0-9]{1,18}$' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.workflow_posts wp
       WHERE wp.id = v_txt::bigint AND wp.conta_id = p_conta
         AND (wp.responsavel_id = ANY (v_ids)
              OR public.can_access_cliente(p_user, p_conta, wp.cliente_id)));
  END IF;

  v_txt := p_metadata ->> 'task_id';
  IF v_txt IS NOT NULL THEN
    IF v_txt !~ '^[0-9]{1,18}$' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.id = v_txt::bigint AND t.conta_id = p_conta
         AND (t.responsavel_id = ANY (v_ids) OR t.user_id = p_user
              OR public.can_access_cliente(p_user, p_conta, t.cliente_id)));
  END IF;

  v_txt := p_metadata ->> 'idea_id';
  IF v_txt IS NOT NULL THEN
    IF v_txt !~* v_uuid THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.ideias i
       WHERE i.id = v_txt::uuid AND i.workspace_id = p_conta
         AND (i.autor_membro_id = ANY (v_ids)
              OR public.can_access_cliente(p_user, p_conta, i.cliente_id::bigint)));
  END IF;

  v_txt := p_metadata ->> 'linha_id';
  IF v_txt IS NOT NULL THEN
    IF v_txt !~* v_uuid THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.linhas_editoriais l
       WHERE l.id = v_txt::uuid AND l.conta_id = p_conta
         AND public.can_access_cliente(p_user, p_conta, l.cliente_id));
  END IF;

  v_txt := p_metadata ->> 'etapa_id';
  IF v_txt IS NOT NULL THEN
    IF v_txt !~ '^[0-9]{1,18}$' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.workflow_etapas e
        JOIN public.workflows w ON w.id = e.workflow_id
       WHERE e.id = v_txt::bigint AND w.conta_id = p_conta
         AND (e.responsavel_id = ANY (v_ids)
              OR public.can_access_cliente(p_user, p_conta, w.cliente_id)));
  END IF;

  v_txt := p_metadata ->> 'workflow_id';
  IF v_txt IS NOT NULL THEN
    IF v_txt !~ '^[0-9]{1,18}$' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.workflows w
       WHERE w.id = v_txt::bigint AND w.conta_id = p_conta
         AND (public.can_access_cliente(p_user, p_conta, w.cliente_id)
              OR EXISTS (SELECT 1 FROM public.workflow_posts wp
                          WHERE wp.workflow_id = w.id AND wp.conta_id = p_conta
                            AND wp.responsavel_id = ANY (v_ids))
              OR EXISTS (SELECT 1 FROM public.workflow_etapas e
                          WHERE e.workflow_id = w.id AND e.responsavel_id = ANY (v_ids))));
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.notification_item_visible_for(uuid, uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_item_visible_for(uuid, uuid, bigint, jsonb) TO service_role;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT
  USING (
    (user_id = auth.uid())
    AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = notifications.workspace_id AND wm.user_id = auth.uid()))
    AND (
      cliente_id IS NULL
      OR (workspace_id = (SELECT public.get_my_conta_id())
          AND ((SELECT public.my_client_scope_all())
               OR public.can_access_cliente(cliente_id)
               OR public.notification_item_visible(metadata)))
      OR (workspace_id IS DISTINCT FROM (SELECT public.get_my_conta_id())
          AND EXISTS (SELECT 1 FROM public.workspace_members wm2
                       WHERE wm2.workspace_id = notifications.workspace_id
                         AND wm2.user_id = auth.uid()
                         AND (wm2.role = 'owner' OR wm2.client_scope = 'todos'
                              OR EXISTS (SELECT 1 FROM public.workspace_member_clientes wmc
                                          WHERE wmc.workspace_id = notifications.workspace_id
                                            AND wmc.user_id = auth.uid()
                                            AND wmc.cliente_id = notifications.cliente_id))))
    )
  );

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE
  USING (
    (user_id = auth.uid())
    AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = notifications.workspace_id AND wm.user_id = auth.uid()))
    AND (
      cliente_id IS NULL
      OR (workspace_id = (SELECT public.get_my_conta_id())
          AND ((SELECT public.my_client_scope_all())
               OR public.can_access_cliente(cliente_id)
               OR public.notification_item_visible(metadata)))
      OR (workspace_id IS DISTINCT FROM (SELECT public.get_my_conta_id())
          AND EXISTS (SELECT 1 FROM public.workspace_members wm2
                       WHERE wm2.workspace_id = notifications.workspace_id
                         AND wm2.user_id = auth.uid()
                         AND (wm2.role = 'owner' OR wm2.client_scope = 'todos'
                              OR EXISTS (SELECT 1 FROM public.workspace_member_clientes wmc
                                          WHERE wmc.workspace_id = notifications.workspace_id
                                            AND wmc.user_id = auth.uid()
                                            AND wmc.cliente_id = notifications.cliente_id))))
    )
  )
  WITH CHECK (
    (user_id = auth.uid())
    AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = notifications.workspace_id AND wm.user_id = auth.uid()))
    AND (
      cliente_id IS NULL
      OR (workspace_id = (SELECT public.get_my_conta_id())
          AND ((SELECT public.my_client_scope_all())
               OR public.can_access_cliente(cliente_id)
               OR public.notification_item_visible(metadata)))
      OR (workspace_id IS DISTINCT FROM (SELECT public.get_my_conta_id())
          AND EXISTS (SELECT 1 FROM public.workspace_members wm2
                       WHERE wm2.workspace_id = notifications.workspace_id
                         AND wm2.user_id = auth.uid()
                         AND (wm2.role = 'owner' OR wm2.client_scope = 'todos'
                              OR EXISTS (SELECT 1 FROM public.workspace_member_clientes wmc
                                          WHERE wmc.workspace_id = notifications.workspace_id
                                            AND wmc.user_id = auth.uid()
                                            AND wmc.cliente_id = notifications.cliente_id))))
    )
  );

-- Reafirma 20260430000001: authenticated só grava read_at e dismissed_at.
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE (read_at, dismissed_at) ON public.notifications TO authenticated;

-- -------------------------------------------------------------
-- 1b. Discussão do post e claim do e-mail
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_post_comments_discussao_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_via_rpc     boolean := COALESCE(current_setting('app.discussao_via_rpc', true), '') = '1';
  v_thread      post_comment_threads;
  wp            workflow_posts;
  v_mencionados uuid[];
  v_author_name text;
  v_link        text;
  v_meta        jsonb;
BEGIN
  BEGIN
    IF v_uid IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT * INTO v_thread FROM post_comment_threads WHERE id = NEW.thread_id;
    SELECT * INTO wp FROM workflow_posts WHERE id = v_thread.post_id;
    IF wp.id IS NULL OR v_thread.conta_id IS DISTINCT FROM wp.conta_id THEN
      RETURN NEW;
    END IF;

    -- Mentioned users still in the workspace.
    SELECT COALESCE(array_agg(DISTINCT mb.crm_user_id), '{}'::uuid[])
      INTO v_mencionados
      FROM membros mb
     WHERE mb.id = ANY (post_discussao_membro_ids(NEW.content, wp.conta_id))
       AND mb.crm_user_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = wp.conta_id AND wm.user_id = mb.crm_user_id
       );

    INSERT INTO post_discussao_participantes AS pp (post_id, conta_id, user_id, last_seen_comment_id)
    VALUES (wp.id, wp.conta_id, NEW.author_id, NEW.id)
    ON CONFLICT (post_id, user_id) DO UPDATE
      SET last_seen_comment_id = GREATEST(pp.last_seen_comment_id, EXCLUDED.last_seen_comment_id),
          updated_at = now();

    INSERT INTO post_discussao_participantes (post_id, conta_id, user_id)
    SELECT wp.id, wp.conta_id, u
      FROM unnest(v_mencionados) AS u
     WHERE u <> NEW.author_id
    ON CONFLICT (post_id, user_id) DO NOTHING;

    SELECT COALESCE(mb.nome, p.nome, 'Equipe') INTO v_author_name
      FROM auth.users u
      LEFT JOIN membros mb ON mb.crm_user_id = NEW.author_id AND mb.conta_id = wp.conta_id
      LEFT JOIN profiles p ON p.id = NEW.author_id
     WHERE u.id = NEW.author_id
     LIMIT 1;
    v_author_name := COALESCE(v_author_name, 'Equipe');

    v_link := CASE WHEN wp.workflow_id IS NULL
      THEN '/entregas?post=' || wp.id || '&discussao=1'
      ELSE '/entregas?drawer=' || wp.workflow_id || '&post=' || wp.id || '&discussao=1'
    END;

    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'post_id',      wp.id::text,
      'workflow_id',  wp.workflow_id,
      'post_titulo',  wp.titulo,
      'thread_field', v_thread.field,
      'quoted_text',  CASE WHEN v_thread.field = 'geral' THEN NULL ELSE v_thread.quoted_text END,
      'author_name',  v_author_name,
      'authors',      jsonb_build_array(v_author_name),
      'count',        1,
      -- Same token replacement as trg_notify_team_message (20261021103000 part b).
      'preview',      left(
        regexp_replace(
          NEW.content,
          '@\[([^\]]+)\]\((membro|post|cliente|tarefa):[0-9:]+\)',
          '@\1',
          'g'
        ),
        280
      )
    ));

    -- cliente_id do post: o sino e o e-mail aplicam a regra do item
    INSERT INTO notifications (workspace_id, user_id, type, metadata, link, cliente_id)
    SELECT wp.conta_id, d.user_id, 'post_discussion', v_meta, v_link, wp.cliente_id
      FROM (
        SELECT pp.user_id
          FROM post_discussao_participantes pp
         WHERE pp.post_id = wp.id AND pp.seguindo
        UNION
        SELECT mb.crm_user_id
          FROM membros mb
         WHERE mb.id = wp.responsavel_id
           AND mb.conta_id = wp.conta_id
           AND mb.crm_user_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM post_discussao_participantes pp2
              WHERE pp2.post_id = wp.id AND pp2.user_id = mb.crm_user_id
           )
      ) d
     WHERE d.user_id <> NEW.author_id
       AND NOT (v_via_rpc AND d.user_id = ANY (v_mencionados))
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = wp.conta_id AND wm.user_id = d.user_id
       )
       -- Restrito só recebe a prévia de post que ele abre (cliente dele ou post
       -- dele), a regra do sino e do e-mail: seguir a discussão não basta.
       AND (wp.cliente_id IS NULL
            OR notification_item_visible_for(d.user_id, wp.conta_id, wp.cliente_id,
                                             jsonb_build_object('post_id', wp.id::text)))
    ON CONFLICT (user_id, ((metadata->>'post_id')))
      WHERE type = 'post_discussion' AND read_at IS NULL AND dismissed_at IS NULL
      DO UPDATE SET
        metadata = EXCLUDED.metadata || jsonb_build_object(
          'count', COALESCE((notifications.metadata->>'count')::int, 1) + 1,
          -- Latest author first, then earlier distinct authors, at most 3.
          'authors', (
            SELECT COALESCE(jsonb_agg(a.nome ORDER BY a.ord), '[]'::jsonb)
              FROM (
                SELECT x.nome, x.ord
                  FROM (
                    SELECT v_author_name AS nome, 0::bigint AS ord
                    UNION ALL
                    SELECT e.nome, e.ord
                      FROM jsonb_array_elements_text(
                             COALESCE(notifications.metadata->'authors', '[]'::jsonb)
                           ) WITH ORDINALITY AS e(nome, ord)
                     WHERE e.nome <> v_author_name
                  ) x
                 ORDER BY x.ord
                 LIMIT 3
              ) a
          )
        ),
        cliente_id = EXCLUDED.cliente_id,
        created_at = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_post_comments_discussao_insert failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_notification_emails(p_settle_before timestamp with time zone, p_after timestamp with time zone, p_limit integer)
 RETURNS TABLE(id uuid, user_id uuid, type text, metadata jsonb, link text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with claimed as (
    update notifications n
       set emailed_at = now()
     where n.id in (
       select n2.id from notifications n2
       where n2.type = any (array[
         'post_approved','post_publish_failed','post_correction','post_message',
         'client_message','deadline_approaching','task_assigned','post_assigned',
         'mention',
         'event_invited','event_updated','event_cancelled',
         'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
         'linha_editorial_aprovada','linha_editorial_ajustes'
       ])
         and n2.read_at is null and n2.dismissed_at is null and n2.emailed_at is null
         and n2.created_at <= p_settle_before and n2.created_at >= p_after
         and exists (
           select 1 from workspace_members wm
           where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
         )
         and not exists (
           select 1 from notification_email_prefs p
           where p.user_id = n2.user_id and p.enabled = false
             and (p.type = n2.type or p.type = '__all__')
         )
       order by n2.created_at asc
       limit p_limit
       for update skip locked
     )
    returning n.id, n.workspace_id, n.user_id, n.type, n.metadata, n.link, n.created_at, n.cliente_id
  )
  -- Regra do sino, no workspace da notificação: escopo, ou o item da
  -- notificação é dele (notification_item_visible_for). A linha que não passa
  -- já recebeu emailed_at acima: não sai e não volta para a fila.
  select c.id, c.user_id, c.type, c.metadata, c.link, c.created_at
    from claimed c
   where c.cliente_id is null
      or exists (
        select 1 from workspace_members wm
         where wm.workspace_id = c.workspace_id and wm.user_id = c.user_id
           and case
                 when wm.role = 'owner' or wm.client_scope = 'todos' then true
                 when exists (select 1 from workspace_member_clientes wmc
                               where wmc.workspace_id = c.workspace_id
                                 and wmc.user_id = c.user_id
                                 and wmc.cliente_id = c.cliente_id) then true
                 else public.notification_item_visible_for(c.user_id, c.workspace_id, c.cliente_id, c.metadata)
               end);
$function$;

DROP FUNCTION IF EXISTS public.can_see_cliente_context_for(uuid, uuid, bigint);

-- -------------------------------------------------------------
-- Pós-condição
-- -------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  IF to_regprocedure('public.can_see_cliente_context_for(uuid, uuid, bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'acesso_por_cliente_h: can_see_cliente_context_for ainda existe';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'public.notification_item_visible_for(uuid, uuid, bigint, jsonb)',
    'public.claim_notification_emails(timestamptz, timestamptz, integer)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'acesso_por_cliente_h: ACL inesperada em %', f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.notification_item_visible(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.notification_item_visible(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'acesso_por_cliente_h: ACL inesperada em notification_item_visible';
  END IF;
  IF has_column_privilege('authenticated', 'public.notifications', 'cliente_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'metadata', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'user_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'workspace_id', 'UPDATE') THEN
    RAISE EXCEPTION 'acesso_por_cliente_h: authenticated pode reescopar uma notificação';
  END IF;
END $$;
