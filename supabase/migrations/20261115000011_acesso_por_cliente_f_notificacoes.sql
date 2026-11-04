-- Acesso por cliente, Task 14: quem recebe notificação e e-mail.
-- Nota: a regra de exibição e de claim descrita abaixo (escopo ou contexto)
-- foi substituída pela leitura por item em 20261115000012.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md
--
-- Duas regras, julgadas no workspace da notificação; a ordem é fixa (CASE):
-- dono e 'todos' nunca chamam função de escopo.
-- - Alvo por papel (owner/admin da notificação, membro escolhido na automação
--   de status): sem cliente, ou dono, 'todos' ou cliente atribuído. SEM o
--   contexto: o contexto serve para ler marca/briefing/identidade, não para
--   inscrever um admin restrito em todo evento do cliente.
-- - Exibição e e-mail (a da policy notifications_select da 4e): a regra acima
--   ou o contexto de um item dele ali (can_see_cliente_context_for). Assim o
--   aviso que ele recebeu como responsável sai e aparece.
--
-- 1. can_see_cliente_context_for(user, conta, cliente): espelho de
--    can_see_cliente_context para um usuário qualquer (service_role só), usado
--    pelo claim do e-mail, que roda sem auth.uid() do
--    destinatário.
-- 2. resolve_notification_targets ganha p_cliente_id (DEFAULT NULL). O
--    responsável segue sempre (o item é dele); os destinatários por papel
--    passam pela regra de alvo por papel. Sem cliente, nada muda.
-- 3. insert_notification_batch ganha p_cliente_id (DEFAULT NULL) e grava
--    notifications.cliente_id. Não filtra: agenda_notificar manda participantes
--    (que são "dele", decisão da 4d) por aqui.
--    As duas são DROP + CREATE (sem sobrecarga ambígua); os grants são
--    reaplicados e conferidos no bloco DO do fim. Um grant perdido não daria
--    erro visível: os emissores engolem a falha em EXCEPTION WHEN OTHERS.
-- 4. Os emissores passam o cliente do item: posts, fluxos/etapas, tarefas,
--    ideias, briefing, mensagens do cliente, linha editorial, menções,
--    comentário de tarefa e discussão do post. O alvo 'member' da automação de
--    status (membro escolhido na configuração, não "dele") passa pela regra de
--    alvo por papel.
--    Ficam sem cliente, de propósito: convite aceito, papel alterado, membro
--    removido, limpeza de armazenamento, chat da equipe e agenda (agenda_eventos
--    não abre contexto, decisão da 4d; com cliente_id gravado, o participante
--    restrito perderia o aviso de um evento que ele vê).
-- 5. claim_notification_emails aplica a regra de exibição por destinatário. A linha fora do
--    escopo recebe emailed_at como as demais, mas não é devolvida: não sai e não
--    volta para a fila (o releaseClaims do cron só toca os ids devolvidos).

-- -------------------------------------------------------------
-- 1. can_see_cliente_context_for
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_cliente_context_for(p_user uuid, p_conta uuid, p_cliente_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ids bigint[];
BEGIN
  IF public.can_access_cliente(p_user, p_conta, p_cliente_id) THEN RETURN true; END IF;
  IF p_cliente_id IS NULL OR p_user IS NULL OR p_conta IS NULL THEN RETURN false; END IF;
  SELECT COALESCE(array_agg(m.id), '{}'::bigint[]) INTO v_ids
    FROM public.membros m
   WHERE m.crm_user_id = p_user AND m.conta_id = p_conta;
  RETURN EXISTS (
      SELECT 1 FROM public.workflow_posts wp
       WHERE wp.cliente_id = p_cliente_id AND wp.conta_id = p_conta
         AND wp.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.workflow_etapas e
        JOIN public.workflows w ON w.id = e.workflow_id
       WHERE w.cliente_id = p_cliente_id AND w.conta_id = p_conta
         AND e.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.post_process_steps s
        JOIN public.post_processes pp ON pp.id = s.process_id AND pp.conta_id = s.conta_id
        JOIN public.workflow_posts wp ON wp.id = pp.post_id AND wp.conta_id = pp.conta_id
       WHERE wp.cliente_id = p_cliente_id AND s.conta_id = p_conta
         AND s.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.cliente_id = p_cliente_id AND t.conta_id = p_conta
         AND (t.responsavel_id = ANY (v_ids) OR t.user_id = p_user)
    ) OR EXISTS (
      SELECT 1 FROM public.tarefa_series ts
       WHERE ts.cliente_id = p_cliente_id AND ts.conta_id = p_conta
         AND (ts.responsavel_id = ANY (v_ids) OR ts.user_id = p_user)
    ) OR EXISTS (
      SELECT 1 FROM public.ideias i
       WHERE i.cliente_id = p_cliente_id AND i.workspace_id = p_conta
         AND i.autor_membro_id = ANY (v_ids)
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.can_see_cliente_context_for(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_cliente_context_for(uuid, uuid, bigint) TO service_role;

-- -------------------------------------------------------------
-- 2. resolve_notification_targets
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_notification_targets(uuid, bigint, text[]);
CREATE FUNCTION public.resolve_notification_targets(
  p_workspace_id   uuid,
  p_responsavel_id bigint,
  p_roles_filter   text[],
  p_cliente_id     bigint DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_targets uuid[] := '{}';
  v_responsavel_user uuid;
BEGIN
  -- O responsável é sempre destinatário: o item é dele (mesmo num cliente que
  -- ele não vê pelo escopo).
  IF p_responsavel_id IS NOT NULL THEN
    SELECT crm_user_id INTO v_responsavel_user
      FROM membros
      WHERE id = p_responsavel_id;
    IF v_responsavel_user IS NOT NULL THEN
      v_targets := array_append(v_targets, v_responsavel_user);
    END IF;
  END IF;

  IF p_roles_filter IS NOT NULL AND array_length(p_roles_filter, 1) > 0 THEN
    SELECT array_agg(DISTINCT user_id) INTO v_targets
      FROM (
        SELECT unnest(v_targets) AS user_id
        UNION
        SELECT wm.user_id
          FROM workspace_members wm
          WHERE wm.workspace_id = p_workspace_id
            AND wm.role = ANY (p_roles_filter)
            -- alvo por papel: sem o contexto (só dono, 'todos' ou atribuído)
            AND (p_cliente_id IS NULL
                 OR wm.role = 'owner' OR wm.client_scope = 'todos'
                 OR EXISTS (SELECT 1 FROM workspace_member_clientes wmc
                             WHERE wmc.workspace_id = p_workspace_id
                               AND wmc.user_id = wm.user_id
                               AND wmc.cliente_id = p_cliente_id))
      ) s
      WHERE user_id IS NOT NULL;
  END IF;

  RETURN COALESCE(v_targets, '{}');
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_notification_targets(uuid, bigint, text[], bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_notification_targets(uuid, bigint, text[], bigint) TO service_role;

-- -------------------------------------------------------------
-- 3. insert_notification_batch
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid);
CREATE FUNCTION public.insert_notification_batch(
  p_workspace_id  uuid,
  p_user_ids      uuid[],
  p_type          text,
  p_link          text,
  p_metadata      jsonb,
  p_exclude_actor uuid DEFAULT NULL,
  p_cliente_id    bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO notifications (workspace_id, user_id, type, metadata, link, cliente_id)
  SELECT p_workspace_id, u, p_type, COALESCE(p_metadata, '{}'::jsonb), p_link, p_cliente_id
    FROM unnest(p_user_ids) AS u
   WHERE u IS NOT NULL
     AND (p_exclude_actor IS NULL OR u <> p_exclude_actor);
END;
$function$;

REVOKE ALL ON FUNCTION public.insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid, bigint) TO service_role;

-- -------------------------------------------------------------
-- 4. Emissores: passam o cliente do item
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_edit_suggestion_notification(p_post_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_link           text;
  v_metadata       jsonb;
  v_count          integer := 0;
  v_updated        boolean;
BEGIN
  SELECT (s.updated_at > s.created_at)
    INTO v_updated
    FROM post_edit_suggestions s
   WHERE s.post_id = p_post_id
     AND s.status = 'pending'
     FOR SHARE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin'], v_cliente_id);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id,
    'updated',     COALESCE(v_updated, false)
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_edit_suggestion', v_link, v_metadata, NULL, v_cliente_id);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_linha_notification(p_linha_id uuid, p_acao text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type    text;
  v_l       public.linhas_editoriais;
  v_nome    text;
  v_targets uuid[];
  v_total   integer;
  v_ajustes integer;
BEGIN
  v_type := CASE p_acao
    WHEN 'aprovado' THEN 'linha_editorial_aprovada'
    WHEN 'ajustes'  THEN 'linha_editorial_ajustes'
    ELSE NULL
  END;
  IF v_type IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_l FROM public.linhas_editoriais WHERE id = p_linha_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT c.nome INTO v_nome FROM public.clientes c WHERE c.id = v_l.cliente_id;

  -- quem enviou a linha entra como "dele"; o resto por papel, pela regra do cliente
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_targets
    FROM (
      SELECT unnest(public.resolve_notification_targets(v_l.conta_id, NULL, ARRAY['owner', 'admin'], v_l.cliente_id)) AS u
      UNION
      SELECT wm.user_id FROM public.workspace_members wm
       WHERE wm.workspace_id = v_l.conta_id AND wm.user_id = v_l.enviada_por
    ) t
   WHERE u IS NOT NULL;

  SELECT count(*) INTO v_total FROM public.linha_editorial_respostas r
   WHERE r.linha_id = p_linha_id AND r.rodada = v_l.rodada
     AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL;

  -- (new)
  SELECT count(*) INTO v_ajustes FROM public.linha_editorial_itens i
   WHERE i.linha_id = p_linha_id AND i.aprovacao = 'ajustes';

  PERFORM public.insert_notification_batch(
    v_l.conta_id,
    v_targets,
    v_type,
    '/entregas?view=linha&clientes=' || v_l.cliente_id || '&mes=' || to_char(v_l.periodo, 'YYYY-MM'),
    jsonb_build_object(
      'linha_id',      v_l.id,
      'cliente_id',    v_l.cliente_id,
      'cliente_nome',  v_nome,
      'periodo',       to_char(v_l.periodo, 'YYYY-MM-DD'),
      'comentarios',   v_total,
      'itens_ajustes', v_ajustes,
      'titulo',        v_l.titulo
    ),
    NULL,
    v_l.cliente_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_post_approval_notification(p_post_id bigint, p_action text, p_comentario text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_type           text;
  v_link           text;
  v_metadata       jsonb;
  v_count          integer := 0;
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_type := CASE p_action
    WHEN 'aprovado' THEN 'post_approved'
    WHEN 'correcao' THEN 'post_correction'
    WHEN 'mensagem' THEN 'post_message'
    ELSE NULL
  END;

  IF v_type IS NULL THEN
    RETURN 0;
  END IF;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin'], v_cliente_id);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id || '&post=' || p_post_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id
  );

  IF v_type IN ('post_correction', 'post_message') THEN
    v_metadata := v_metadata || jsonb_build_object('comentario', p_comentario);
  END IF;

  PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, NULL, v_cliente_id);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_post_reference_notification(p_post_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_link           text;
  v_metadata       jsonb;
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo, wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('post_client_reference:' || p_post_id, 0));

  SELECT c.nome INTO v_client_name FROM clientes c WHERE c.id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin'], v_cliente_id);

  SELECT array_agg(t) INTO v_targets
    FROM unnest(COALESCE(v_targets, '{}'::uuid[])) AS t
   WHERE t IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM notifications n
        WHERE n.user_id = t
          AND n.type = 'post_client_reference'
          AND n.read_at IS NULL
          AND n.dismissed_at IS NULL
          AND n.metadata->>'post_id' = p_post_id::text
          AND n.created_at > now() - interval '15 minutes');

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_client_reference', v_link, v_metadata, NULL, v_cliente_id);

  RETURN array_length(v_targets, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_post_status_automations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r                 record;
  v_targets         uuid[];
  v_membro_id       bigint;
  v_meta            jsonb;
  v_status_label    text;
  v_client_name     text;
  v_status_changed  boolean := (new.status is distinct from old.status);
  v_custom_changed  boolean := (new.custom_status_id is distinct from old.custom_status_id);
begin
  -- config is user-shaped jsonb with no CHECK on its shape: every read of
  -- membro_id below guards the cast with a digits-only regex so a malformed
  -- rule degrades to a no-op instead of aborting the status transition that
  -- fired the trigger.
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if not (v_status_changed or v_custom_changed) then
    return new;
  end if;

  -- Phase 1: assign_responsavel — pure NEW mutation, cannot recurse. The
  -- membro must belong to the post's workspace: config is user data and a
  -- foreign id would leak a cross-tenant notification via
  -- notify_post_assigned.
  for r in
    select a.* from post_status_automations a
     where a.conta_id = new.conta_id
       and a.ativo
       and a.action_type = 'assign_responsavel'
       and (
         -- Canonical rule: fires when the canonical column changed, and
         -- also when the post entered a custom status behaving as it
         -- (custom-only move, canonical unchanged) -- the UI promises the
         -- equivalent standard-status rules fire too. Detaching back to
         -- the plain canonical (pointer -> null, e.g. archive mass-detach)
         -- is NOT an entry and must not re-fire.
         (a.trigger_status = new.status
            and (v_status_changed
              or (v_custom_changed and new.custom_status_id is not null)))
         or (v_custom_changed and a.trigger_custom_status_id = new.custom_status_id)
       )
     order by a.created_at -- deterministic: the newest matching rule wins
  loop
    v_membro_id := case
      when r.config->>'membro_id' ~ '^\d+$' then (r.config->>'membro_id')::bigint
      else null
    end;
    if v_membro_id is not null and exists (
      select 1 from membros m where m.id = v_membro_id and m.conta_id = new.conta_id
    ) then
      new.responsavel_id := v_membro_id;
    end if;
  end loop;

  -- Phase 2: notify — best-effort per RULE (a notification failure must
  -- never roll back the status change, and one malformed rule must not
  -- suppress the valid rules after it). Runs after phase 1 so target
  -- 'responsavel' sees a just-assigned responsavel.
  for r in
      select a.* from post_status_automations a
       where a.conta_id = new.conta_id
         and a.ativo
         and a.action_type = 'notify'
         and (
           (a.trigger_status = new.status
              and (v_status_changed
                or (v_custom_changed and new.custom_status_id is not null)))
           or (v_custom_changed and a.trigger_custom_status_id = new.custom_status_id)
         )
  loop
    begin
      v_targets := case r.config->>'target'
        -- membro escolhido na configuração: não é "dele", então passa pela
        -- regra de alvo por papel (dono, 'todos' ou atribuído; sem contexto)
        when 'member' then
          coalesce((
            select case when m.crm_user_id is null then '{}'::uuid[]
                        else array[m.crm_user_id] end
              from membros m
             where (r.config->>'membro_id') ~ '^\d+$'
               and m.id = (r.config->>'membro_id')::bigint
               and m.conta_id = new.conta_id
               and (new.cliente_id is null or exists (
                 select 1 from workspace_members wm
                  where wm.workspace_id = new.conta_id
                    and wm.user_id = m.crm_user_id
                    and (wm.role = 'owner' or wm.client_scope = 'todos'
                         or exists (select 1 from workspace_member_clientes wmc
                                     where wmc.workspace_id = new.conta_id
                                       and wmc.user_id = m.crm_user_id
                                       and wmc.cliente_id = new.cliente_id))))
          ), '{}'::uuid[])
        when 'responsavel' then
          resolve_notification_targets(new.conta_id, new.responsavel_id, null, new.cliente_id)
        when 'roles' then
          resolve_notification_targets(new.conta_id, null, (
            select coalesce(array_agg(x), '{}'::text[])
              from jsonb_array_elements_text(
                case when jsonb_typeof(r.config->'roles') = 'array'
                     then r.config->'roles' else '[]'::jsonb end) x
              where x in ('owner', 'admin')
          ), new.cliente_id)
        else '{}'::uuid[]
      end;

      if v_targets is null or array_length(v_targets, 1) is null then
        continue;
      end if;

      select coalesce(
               (select nome from post_status_definitions where id = new.custom_status_id),
               new.status)
        into v_status_label;
      select nome into v_client_name from clientes where id = new.cliente_id;

      v_meta := jsonb_build_object(
        'post_title', new.titulo,
        'post_id', new.id,
        'workflow_id', new.workflow_id,
        'client_name', v_client_name,
        'status_key', coalesce('custom:' || new.custom_status_id::text, new.status),
        'status_label', v_status_label
      );

      perform insert_notification_batch(
        new.conta_id,
        v_targets,
        'post_status_automation',
        case when new.workflow_id is null
          then '/entregas?post=' || new.id
          else '/entregas?drawer=' || new.workflow_id
        end,
        v_meta,
        auth.uid(),
        new.cliente_id
      );
    exception when others then
      raise warning 'run_post_status_automations notify rule % failed for post %: %',
        r.id, new.id, sqlerrm;
    end;
  end loop;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tarefa_comentario_enviar(p_tarefa_id bigint, p_conteudo text)
 RETURNS tarefa_comentarios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  t             tarefas;
  v_conteudo    text;
  v_row         tarefa_comentarios;
  v_mencionados uuid[];
  v_author_name text;
  v_meta        jsonb;
BEGIN
  SELECT * INTO t FROM tarefas WHERE id = p_tarefa_id;
  IF v_uid IS NULL
     OR t.id IS NULL
     OR t.conta_id IS DISTINCT FROM (SELECT get_my_conta_id())
     OR NOT EXISTS (
       SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = t.conta_id AND wm.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'tarefa_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- o comentário segue a tarefa visível (cliente acessível ou tarefa dele);
  -- a oculta responde como inexistente
  IF NOT public.my_client_scope_all()
     AND NOT (public.can_access_cliente(t.cliente_id)
                OR coalesce(t.responsavel_id = ANY (public.my_membro_ids()), false)
                OR t.user_id = v_uid) THEN
    RAISE EXCEPTION 'tarefa_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_conteudo := COALESCE(btrim(p_conteudo), '');
  IF v_conteudo = '' THEN
    RAISE EXCEPTION 'content_empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_conteudo) > 4000 THEN
    RAISE EXCEPTION 'content_too_long' USING ERRCODE = '22023';
  END IF;

  INSERT INTO tarefa_comentarios (conta_id, tarefa_id, author_id, conteudo)
  VALUES (t.conta_id, t.id, v_uid, v_conteudo)
  RETURNING * INTO v_row;

  PERFORM sync_mentions('tarefa_comentario', v_row.id,
                        post_discussao_membro_ids(v_conteudo, t.conta_id));

  BEGIN
    -- Users behind the membros mencoes actually kept for this comment.
    SELECT COALESCE(array_agg(DISTINCT mb.crm_user_id), '{}'::uuid[])
      INTO v_mencionados
      FROM mencoes me
      JOIN membros mb ON mb.id = me.mentioned_membro_id AND mb.conta_id = t.conta_id
     WHERE me.host_type = 'tarefa_comentario'
       AND me.host_id = v_row.id
       AND mb.crm_user_id IS NOT NULL;

    SELECT COALESCE(mb.nome, p.nome, 'Equipe') INTO v_author_name
      FROM auth.users u
      LEFT JOIN membros mb ON mb.crm_user_id = v_uid AND mb.conta_id = t.conta_id
      LEFT JOIN profiles p ON p.id = v_uid
     WHERE u.id = v_uid
     LIMIT 1;
    v_author_name := COALESCE(v_author_name, 'Equipe');

    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'task_id',     t.id::text,
      'task_title',  t.titulo,
      'author_name', v_author_name,
      'authors',     jsonb_build_array(v_author_name),
      'count',       1,
      -- Same token replacement as trg_post_comments_discussao_insert (20261025000003).
      'preview',     left(
        regexp_replace(
          v_conteudo,
          '@\[([^\]]+)\]\((membro|post|cliente|tarefa):[0-9:]+\)',
          '@\1',
          'g'
        ),
        280
      )
    ));

    -- cliente_id da tarefa: o sino e o e-mail aplicam a regra do cliente
    INSERT INTO notifications (workspace_id, user_id, type, metadata, link, cliente_id)
    SELECT t.conta_id, d.user_id, 'task_comment', v_meta,
           '/tarefas?tarefa=' || t.id || '&comentarios=1', t.cliente_id
      FROM (
        SELECT unnest(resolve_notification_targets(t.conta_id, t.responsavel_id, NULL, t.cliente_id)) AS user_id
        UNION
        SELECT t.user_id
        UNION
        SELECT tc.author_id
          FROM tarefa_comentarios tc
         WHERE tc.tarefa_id = t.id
           AND tc.conta_id = t.conta_id
           AND tc.id <> v_row.id
           AND tc.author_id IS NOT NULL
      ) d
     WHERE d.user_id IS NOT NULL
       AND d.user_id <> v_uid
       AND d.user_id <> ALL (v_mencionados)
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = t.conta_id AND wm.user_id = d.user_id
       )
    ON CONFLICT (user_id, ((metadata->>'task_id')))
      WHERE type = 'task_comment' AND read_at IS NULL AND dismissed_at IS NULL
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
    RAISE WARNING 'tarefa_comentario_enviar notification failed: % %', SQLERRM, SQLSTATE;
  END;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_briefing_answered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_workspace_id uuid;
  v_client_name  text;
  v_targets      uuid[];
BEGIN
  BEGIN
    SELECT c.conta_id, c.nome
      INTO v_workspace_id, v_client_name
      FROM clientes c
     WHERE c.id = NEW.cliente_id;

    IF v_workspace_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_workspace_id, NULL, ARRAY['owner','admin'], NEW.cliente_id);

    PERFORM insert_notification_batch(
      v_workspace_id,
      v_targets,
      'briefing_answered',
      '/clientes/' || NEW.cliente_id,
      jsonb_build_object(
        'client_name',   v_client_name,
        'question_text', NEW.question
      ),
      NULL,
      NEW.cliente_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_briefing_answered failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_client_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.conta_id, NULL, ARRAY['owner','admin'], NEW.cliente_id);

    PERFORM insert_notification_batch(
      NEW.conta_id,
      v_targets,
      'client_message',
      '/mensagens',
      jsonb_build_object(
        'client_name', v_client_name,
        'comentario',  left(NEW.content, 280),
        'cliente_id',  NEW.cliente_id
      ),
      NULL,
      NEW.cliente_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_client_message failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_idea_submitted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    IF NEW.origem = 'agencia' THEN
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM 'nova' THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.workspace_id, NULL, ARRAY['owner','admin'], NEW.cliente_id);

    PERFORM insert_notification_batch(
      NEW.workspace_id,
      v_targets,
      'idea_submitted',
      '/ideias',
      jsonb_build_object(
        'client_name', v_client_name,
        'idea_title',  NEW.titulo,
        'idea_id',     NEW.id,
        'tipo',        NEW.tipo
      ),
      NULL,
      NEW.cliente_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_idea_submitted failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_mention()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_name    text;
  v_context_title text;
  v_excerpt       text;
  v_workflow_id   bigint;
  v_post_id       bigint;
  v_task_id       bigint;
  v_cliente_id    bigint;
  v_link          text;
  v_metadata      jsonb;
  v_targets       uuid[];
BEGIN
  BEGIN
    -- Actor: prefer the membro record linked to the author's CRM login
    -- (matches the display name used elsewhere in the app); fall back to
    -- the auth.users profile for authors with no membro row yet.
    SELECT nome INTO v_actor_name
      FROM membros
     WHERE crm_user_id = NEW.author_id
       AND conta_id = NEW.conta_id
     LIMIT 1;

    IF v_actor_name IS NULL THEN
      SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_actor_name
        FROM auth.users
       WHERE id = NEW.author_id;
    END IF;

    IF NEW.host_type = 'tarefa' THEN
      SELECT titulo, cliente_id INTO v_context_title, v_cliente_id FROM tarefas WHERE id = NEW.host_id;
      IF v_context_title IS NULL THEN
        RETURN NEW; -- host vanished between insert and trigger; nothing to notify
      END IF;
      v_task_id := NEW.host_id;
      v_link := '/tarefas?tarefa=' || NEW.host_id;

    ELSIF NEW.host_type = 'workflow_post' THEN
      SELECT titulo, workflow_id, cliente_id INTO v_context_title, v_workflow_id, v_cliente_id
        FROM workflow_posts
       WHERE id = NEW.host_id;
      -- v_context_title (nao v_workflow_id) e o proxy de "host sumiu": titulo
      -- e NOT NULL DEFAULT '' em workflow_posts, entao so fica NULL quando o
      -- SELECT acima nao achou a linha -- workflow_id sozinho nao serve mais
      -- porque um avulso existente tem workflow_id NULL de forma legitima.
      IF v_context_title IS NULL THEN
        RETURN NEW; -- host vanished between insert and trigger; nothing to notify
      END IF;
      v_post_id := NEW.host_id;
      v_link := CASE WHEN v_workflow_id IS NULL
        THEN '/entregas?post=' || v_post_id
        ELSE '/entregas?drawer=' || v_workflow_id
      END;

    ELSIF NEW.host_type = 'post_comment' THEN
      -- Belt and suspenders: AND wp.conta_id = NEW.conta_id, in addition to
      -- the mencoes_tenant_all WITH CHECK guard above -- even if a malformed
      -- cross-workspace thread row somehow exists, this SECURITY DEFINER
      -- trigger must never read (and copy into a notification) a post title
      -- from a different workspace.
      SELECT wp.titulo, wp.workflow_id, wp.id, left(pc.content, 140), wp.cliente_id
        INTO v_context_title, v_workflow_id, v_post_id, v_excerpt, v_cliente_id
        FROM post_comments pc
        JOIN post_comment_threads pct ON pct.id = pc.thread_id
        JOIN workflow_posts wp ON wp.id = pct.post_id AND wp.conta_id = NEW.conta_id
       WHERE pc.id = NEW.host_id;
      -- Same proxy swap as the workflow_post branch above: v_context_title
      -- NULL means the JOIN found nothing, not "no workflow".
      IF v_context_title IS NULL THEN
        RETURN NEW;
      END IF;
      -- Discussão do post: the link opens the post with its discussion
      -- (20261025000003).
      v_link := CASE WHEN v_workflow_id IS NULL
        THEN '/entregas?post=' || v_post_id || '&discussao=1'
        ELSE '/entregas?drawer=' || v_workflow_id || '&post=' || v_post_id || '&discussao=1'
      END;

    ELSIF NEW.host_type = 'tarefa_comentario' THEN
      -- Comentário de tarefa (20261104000001). Both the comment and its task are read with
      -- conta_id = NEW.conta_id, so this definer trigger never copies another workspace's
      -- title or text into a notification.
      SELECT t.titulo, t.id, left(tc.conteudo, 140), t.cliente_id
        INTO v_context_title, v_task_id, v_excerpt, v_cliente_id
        FROM tarefa_comentarios tc
        JOIN tarefas t ON t.id = tc.tarefa_id AND t.conta_id = NEW.conta_id
       WHERE tc.id = NEW.host_id
         AND tc.conta_id = NEW.conta_id;
      IF v_context_title IS NULL THEN
        RETURN NEW; -- host vanished between insert and trigger; nothing to notify
      END IF;
      v_link := '/tarefas?tarefa=' || v_task_id || '&comentarios=1';
    END IF;

    v_metadata := jsonb_strip_nulls(jsonb_build_object(
      'actor_name',    v_actor_name,
      'host_type',     NEW.host_type,
      'host_id',       NEW.host_id,
      'context_title', v_context_title,
      'excerpt',       v_excerpt,
      'workflow_id',   v_workflow_id,
      'post_id',       v_post_id,
      'task_id',       v_task_id
    ));

    -- p_responsavel_id doubles here as "the mentioned membro": resolve_notification_targets
    -- appends that membro's crm_user_id (if set) to the target list, and with
    -- p_roles_filter NULL no extra role-based targets are added -- exactly
    -- the mentioned person, nobody else. The host's client is written on the
    -- row, so the bell and the e-mail apply the client rule to him.
    v_targets := resolve_notification_targets(NEW.conta_id, NEW.mentioned_membro_id, NULL, v_cliente_id);

    -- p_exclude_actor = NEW.author_id silences self-mentions.
    PERFORM insert_notification_batch(NEW.conta_id, v_targets, 'mention', v_link, v_metadata, NEW.author_id, v_cliente_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_mention failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_post_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_type           text;
  v_link           text;
  v_metadata       jsonb;
BEGIN
  -- Hub-originated approvals are handled by the edge function via
  -- create_post_approval_notification() RPC for better error visibility.
  IF NEW.is_workspace_user = false THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
           wp.conta_id, wp.cliente_id
      INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
      FROM workflow_posts wp
     WHERE wp.id = NEW.post_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

    v_type := CASE NEW.action
      WHEN 'aprovado' THEN 'post_approved'
      WHEN 'correcao' THEN 'post_correction'
      WHEN 'mensagem' THEN 'post_message'
      ELSE NULL
    END;

    IF v_type IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin'], v_cliente_id);
    v_link := CASE WHEN v_workflow_id IS NULL
      THEN '/entregas?post=' || NEW.post_id
      ELSE '/entregas?drawer=' || v_workflow_id
    END;
    v_metadata := jsonb_build_object(
      'client_name', v_client_name,
      'post_title',  v_post_title,
      'workflow_id', v_workflow_id,
      'post_id',     NEW.post_id
    );

    IF v_type IN ('post_correction', 'post_message') THEN
      v_metadata := v_metadata || jsonb_build_object('comentario', NEW.comentario);
    END IF;

    PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, auth.uid(), v_cliente_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_approval failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_post_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta_id    uuid;
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    v_conta_id := NEW.conta_id;
    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NEW.responsavel_id, NULL, NEW.cliente_id);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'post_assigned',
      CASE WHEN NEW.workflow_id IS NULL
        THEN '/entregas?post=' || NEW.id
        ELSE '/entregas?drawer=' || NEW.workflow_id
      END,
      jsonb_build_object(
        'client_name', v_client_name,
        'post_title',  NEW.titulo,
        'workflow_id', NEW.workflow_id,
        'post_id',     NEW.id
      ),
      auth.uid(),
      NEW.cliente_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_assigned failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_post_publish_failed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name text;
  v_targets     uuid[];
  v_notify      boolean := false;
BEGIN
  BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.publish_error_code IN
         ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED',
          'TRIAL_INELIGIBLE','CAPTION_TOO_LONG','ACCOUNT_RESTRICTED','COLLABORATOR_INVALID') THEN
      v_notify := true;
    ELSIF COALESCE(OLD.publish_retry_count, 0) < 3
       AND COALESCE(NEW.publish_retry_count, 0) >= 3 THEN
      v_notify := true;
    ELSIF OLD.publish_error_code IS DISTINCT FROM NEW.publish_error_code
       AND NEW.publish_error_code IN
         ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED',
          'TRIAL_INELIGIBLE','CAPTION_TOO_LONG','ACCOUNT_RESTRICTED','COLLABORATOR_INVALID') THEN
      v_notify := true;
    END IF;

    IF v_notify THEN
      SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

      v_targets := resolve_notification_targets(NEW.conta_id, NEW.responsavel_id, ARRAY['owner','admin'], NEW.cliente_id);

      PERFORM insert_notification_batch(
        NEW.conta_id,
        v_targets,
        'post_publish_failed',
        CASE WHEN NEW.workflow_id IS NULL
          THEN '/entregas?post=' || NEW.id
          ELSE '/entregas?drawer=' || NEW.workflow_id || '&post=' || NEW.id
        END,
        jsonb_build_object(
          'post_id',            NEW.id,
          'workflow_id',        NEW.workflow_id,
          'post_title',         NEW.titulo,
          'client_name',        v_client_name,
          'publish_error_code', NEW.publish_error_code
        ),
        NULL,
        NEW.cliente_id
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_publish_failed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_step_activated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta_id      uuid;
  v_cliente_id    bigint;
  v_client_name   text;
  v_workflow_title text;
  v_targets       uuid[];
BEGIN
  BEGIN
    SELECT w.conta_id, w.cliente_id, c.nome, w.titulo
      INTO v_conta_id, v_cliente_id, v_client_name, v_workflow_title
      FROM workflows w
      LEFT JOIN clientes c ON c.id = w.cliente_id
     WHERE w.id = NEW.workflow_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NEW.responsavel_id, ARRAY['owner','admin'], v_cliente_id);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'step_activated',
      '/entregas?drawer=' || NEW.workflow_id,
      jsonb_build_object(
        'client_name',     v_client_name,
        'workflow_title',  v_workflow_title,
        'step_name',       NEW.nome,
        'workflow_id',     NEW.workflow_id,
        'etapa_id',        NEW.id
      ),
      auth.uid(),
      v_cliente_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_step_activated failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_step_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta_id      uuid;
  v_cliente_id    bigint;
  v_client_name   text;
  v_workflow_title text;
  v_targets       uuid[];
BEGIN
  BEGIN
    SELECT w.conta_id, w.cliente_id, c.nome, w.titulo
      INTO v_conta_id, v_cliente_id, v_client_name, v_workflow_title
      FROM workflows w
      LEFT JOIN clientes c ON c.id = w.cliente_id
     WHERE w.id = NEW.workflow_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NULL, ARRAY['owner','admin'], v_cliente_id);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'step_completed',
      '/entregas?drawer=' || NEW.workflow_id,
      jsonb_build_object(
        'client_name',     v_client_name,
        'workflow_title',  v_workflow_title,
        'step_name',       NEW.nome,
        'workflow_id',     NEW.workflow_id,
        'etapa_id',        NEW.id
      ),
      auth.uid(),
      v_cliente_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_step_completed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_task_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    IF NEW.cliente_id IS NOT NULL THEN
      SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;
    END IF;

    v_targets := resolve_notification_targets(NEW.conta_id, NEW.responsavel_id, NULL, NEW.cliente_id);

    PERFORM insert_notification_batch(
      NEW.conta_id,
      v_targets,
      'task_assigned',
      '/tarefas?tarefa=' || NEW.id,
      jsonb_build_object(
        'task_title',  NEW.titulo,
        'client_name', v_client_name,
        'task_id',     NEW.id
      ),
      auth.uid(),
      NEW.cliente_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_task_assigned failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_notify_workflow_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.conta_id, NULL, ARRAY['owner','admin'], NEW.cliente_id);

    PERFORM insert_notification_batch(
      NEW.conta_id,
      v_targets,
      'workflow_completed',
      '/entregas?drawer=' || NEW.id,
      jsonb_build_object(
        'client_name',    v_client_name,
        'workflow_title', NEW.titulo,
        'workflow_id',    NEW.id
      ),
      auth.uid(),
      NEW.cliente_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_workflow_completed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

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

    -- cliente_id do post: o sino e o e-mail aplicam a regra do cliente
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

-- -------------------------------------------------------------
-- 5. claim_notification_emails
-- -------------------------------------------------------------
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
  -- Regra do cliente, no workspace da notificação (a do sino, 4e). A linha que
  -- não passa já recebeu emailed_at acima: não sai e não volta para a fila.
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
                 else public.can_see_cliente_context_for(c.user_id, c.workspace_id, c.cliente_id)
               end);
$function$;

-- -------------------------------------------------------------
-- 6. Pós-condição: grants dos três que mudaram de assinatura ou são novos
-- -------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.can_see_cliente_context_for(uuid, uuid, bigint)',
    'public.resolve_notification_targets(uuid, bigint, text[], bigint)',
    'public.insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid, bigint)',
    'public.claim_notification_emails(timestamptz, timestamptz, integer)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'acesso_por_cliente_f: ACL inesperada em %', f;
    END IF;
  END LOOP;
END $$;
