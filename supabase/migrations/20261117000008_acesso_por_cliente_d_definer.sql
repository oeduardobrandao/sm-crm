-- Acesso por cliente, Migração D (SECURITY DEFINER): as RPCs que um usuário
-- logado chama e que leem ou escrevem posts, fluxos e processos sem passar pela
-- RLS respeitam o escopo do membro, com as mesmas regras das policies da C1:
--   * post: lido se o cliente é acessível ou o post é dele (responsavel_id);
--     editar (conteúdo, status, ordem no quadro, discussão, sugestão, processo
--     do post) vale também para o post dele num cliente oculto; mover, duplicar
--     e encerrar processo são estritos (cliente acessível);
--   * fluxo (workflows): lido também pelo "é dele" (workflow_has_own_item), mas
--     toda escrita é estrita, como a policy de UPDATE (avançar aprovação,
--     banner de rascunho, trocar modelo, reordenar, duplicar, destino de mover);
--   * processo de post: segue o post. Etapa de processo dele num post que ele
--     não lê dá só leitura (pps_select_member), como a filha de um item dele;
--   * modelo de fluxo: salvar e propagar reescrevem as etapas de todo fluxo
--     ativo do modelo; se algum é de cliente que ele não acessa, recusa
--     (mesma regra das RPCs de série da 4b, que recusam se alguma ocorrência
--     aberta está em cliente oculto);
--   * status que uma automação muda para outro responsável, no post dele num
--     cliente oculto: 42501, como no UPDATE direto (regra da 4a);
--   * tarefa_serie_aplicar_edicao: entregar a outro a ocorrência ou a série
--     dele num cliente oculto agora falha como o UPDATE direto (42501).
-- Id que ele não lê responde com o erro de inexistente da própria RPC (não
-- confirma o id); id que ele lê mas não pode escrever, client_scope_restricted
-- (42501). auth.uid() NULL (service role, cron) e quem vê todos saem no
-- primeiro my_client_scope_all(), sem outra leitura.
--
-- Corpo de cada RPC = definição atual (pg_get_functiondef) + as linhas
-- marcadas "[escopo]"; CREATE OR REPLACE mantém assinatura, volatilidade e ACL.
-- Fora daqui (ver o relatório da Task 5): agenda, mensagens, tokens do Hub,
-- séries, comentários de tarefa, linha editorial e pasta de relatórios já
-- foram escopados na 4b-4d; helpers de policy; contadores do workspace
-- (workspace_usage, storage_autoclean_preview); financeiro (Task 6).
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md

-- -------------------------------------------------------------
-- 0. Helpers (só as RPCs DEFINER chamam; EXECUTE só service_role)
-- -------------------------------------------------------------
-- Posts de p_ids na conta que o chamador não lê: levanta p_err/p_code (o erro
-- de inexistente da RPC). Com p_strict, post que ele lê só porque é dele, num
-- cliente que ele não acessa: client_scope_restricted.
CREATE OR REPLACE FUNCTION public.scope_check_posts(
  p_conta uuid, p_ids bigint[], p_err text, p_code text, p_strict boolean)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.my_client_scope_all() THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.workflow_posts wp
     WHERE wp.id = ANY (p_ids) AND wp.conta_id = p_conta
       AND NOT public.can_access_cliente(wp.cliente_id)
       AND NOT coalesce(wp.responsavel_id = ANY (public.my_membro_ids()), false)
  ) THEN
    RAISE EXCEPTION USING MESSAGE = p_err, ERRCODE = p_code;
  END IF;
  IF p_strict AND EXISTS (
    SELECT 1 FROM public.workflow_posts wp
     WHERE wp.id = ANY (p_ids) AND wp.conta_id = p_conta
       AND NOT public.can_access_cliente(wp.cliente_id)
  ) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Fluxos de p_ids: o que ele não lê (nem cliente acessível nem item dele)
-- levanta p_err/p_code; o que ele lê só pelo item dele, client_scope_restricted
-- (escrita em workflows é estrita).
CREATE OR REPLACE FUNCTION public.scope_check_workflows(
  p_conta uuid, p_ids bigint[], p_err text, p_code text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.my_client_scope_all() THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.workflows w
     WHERE w.id = ANY (p_ids) AND w.conta_id = p_conta
       AND NOT public.can_access_cliente(w.cliente_id)
       AND NOT public.workflow_has_own_item(w.id)
  ) THEN
    RAISE EXCEPTION USING MESSAGE = p_err, ERRCODE = p_code;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workflows w
     WHERE w.id = ANY (p_ids) AND w.conta_id = p_conta
       AND NOT public.can_access_cliente(w.cliente_id)
  ) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Processos de p_ids: seguem o post (process_not_found se ele não lê o post).
-- De propósito NÃO usa o ramo created_by = auth.uid() de pp_select_member: quem
-- criou o processo num post que não lê (o post mudou de cliente ou de
-- responsável depois) continua lendo o processo pela RLS, mas não escreve por
-- estas RPCs, que mexem no post (status). Processo segue o post: é a escolha
-- mais estrita. Não "corrija" para incluir created_by: isso abre o post oculto.
CREATE OR REPLACE FUNCTION public.scope_check_processes(
  p_conta uuid, p_ids bigint[], p_strict boolean)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.my_client_scope_all() THEN RETURN; END IF;
  PERFORM public.scope_check_posts(
    p_conta,
    ARRAY(SELECT pp.post_id FROM public.post_processes pp
           WHERE pp.id = ANY (p_ids) AND pp.conta_id = p_conta),
    'process_not_found', 'P0001', p_strict);
END;
$$;

-- Salvar ou propagar o modelo mexe em todo fluxo ativo dele: recusa se algum é
-- de cliente que o chamador não acessa.
CREATE OR REPLACE FUNCTION public.scope_check_template_workflows(
  p_conta uuid, p_template_id bigint)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.my_client_scope_all() THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.workflows w
     WHERE w.template_id = p_template_id AND w.conta_id = p_conta
       AND w.status = 'ativo'
       AND NOT public.can_access_cliente(w.cliente_id)
  ) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.scope_check_posts(uuid, bigint[], text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scope_check_posts(uuid, bigint[], text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.scope_check_workflows(uuid, bigint[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scope_check_workflows(uuid, bigint[], text, text) TO service_role;
REVOKE ALL ON FUNCTION public.scope_check_processes(uuid, bigint[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scope_check_processes(uuid, bigint[], boolean) TO service_role;
REVOKE ALL ON FUNCTION public.scope_check_template_workflows(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scope_check_template_workflows(uuid, bigint) TO service_role;

-- -------------------------------------------------------------
-- 1. RPCs
-- -------------------------------------------------------------

-- post_discussao_post_do_chamador
CREATE OR REPLACE FUNCTION public.post_discussao_post_do_chamador(p_post_id bigint)
 RETURNS workflow_posts
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  wp    workflow_posts;
BEGIN
  SELECT * INTO wp FROM workflow_posts WHERE id = p_post_id;
  IF v_uid IS NULL
     OR wp.id IS NULL
     OR wp.conta_id IS DISTINCT FROM (SELECT get_my_conta_id())
     OR NOT EXISTS (
       SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = wp.conta_id AND wm.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(wp.conta_id, ARRAY[wp.id], 'post_not_found', 'P0002', false);
  RETURN wp;
END;
$function$;

-- get_post_discussao_nao_lidas
CREATE OR REPLACE FUNCTION public.get_post_discussao_nao_lidas(p_post_ids bigint[] DEFAULT NULL::bigint[], p_workflow_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(post_id bigint, workflow_id bigint, total integer, nao_lidas integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid, get_my_conta_id() AS conta
  ),
  posts AS (
    SELECT wp.id, wp.workflow_id, wp.conta_id, wp.responsavel_id
      FROM workflow_posts wp, me
     WHERE me.uid IS NOT NULL
       AND wp.conta_id = me.conta
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = me.conta AND wm.user_id = me.uid
       )
       AND (   (p_post_ids IS NOT NULL AND wp.id = ANY (p_post_ids))
            OR (p_workflow_ids IS NOT NULL AND wp.workflow_id = ANY (p_workflow_ids)))
       -- [escopo] só posts que ele lê (RLS de workflow_posts)
       AND ((SELECT public.my_client_scope_all())
            OR public.can_access_cliente(wp.cliente_id)
            OR wp.responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[]))
  ),
  estado AS (
    SELECT p.id AS post_id,
           CASE
             WHEN pp.user_id IS NOT NULL THEN pp.seguindo
             ELSE EXISTS (
               SELECT 1 FROM membros mb
                WHERE mb.id = p.responsavel_id
                  AND mb.conta_id = p.conta_id
                  AND mb.crm_user_id = me.uid)
           END AS segue,
           COALESCE(pp.last_seen_comment_id, 0) AS marca
      FROM posts p
      CROSS JOIN me
      LEFT JOIN post_discussao_participantes pp
        ON pp.post_id = p.id AND pp.user_id = me.uid
  )
  SELECT p.id,
         p.workflow_id,
         count(pc.id)::int,
         (count(pc.id) FILTER (
            WHERE e.segue AND pct.status = 'active'
              AND pc.id > e.marca AND pc.author_id <> me.uid))::int
    FROM posts p
    CROSS JOIN me
    JOIN estado e ON e.post_id = p.id
    JOIN post_comment_threads pct ON pct.post_id = p.id AND pct.conta_id = p.conta_id
    JOIN post_comments pc ON pc.thread_id = pct.id
   GROUP BY p.id, p.workflow_id;
$function$;

-- accept_edit_suggestion
CREATE OR REPLACE FUNCTION public.accept_edit_suggestion(p_suggestion_id bigint, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_fields text[] DEFAULT NULL::text[], p_acknowledged text[] DEFAULT NULL::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_post_id       bigint;
  v_conta_id      uuid;
  v_post          record;
  v_suggestion    record;
  v_geral_id      bigint;
  v_geral_caption text;
  v_have_geral    boolean;
  v_tt_status     text;
  v_have_tt       boolean;
  v_ack           text[] := coalesce(p_acknowledged, '{}');
  v_texto_chg     boolean;
  v_legenda_chg   boolean;
  v_tt_chg        boolean;
  v_geral_chg     boolean;
  v_texto_conf    boolean;
  v_legenda_conf  boolean;
  v_tt_conf       boolean;
  v_geral_conf    boolean;
  v_do_texto      boolean;
  v_do_legenda    boolean;
  v_do_tt         boolean;
  v_do_geral      boolean;
  v_geral_old     text;
  v_geral_new     text;
begin
  select post_id, conta_id into v_post_id, v_conta_id
    from post_edit_suggestions
    where id = p_suggestion_id;

  if v_post_id is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and v_conta_id is distinct from get_my_conta_id()) then
    raise exception 'Suggestion not found';
  end if;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta_id, ARRAY[v_post_id], 'Suggestion not found', 'P0001', false);


  -- Ordem de locks: post -> linha geral -> sugestão.
  select conteudo, conteudo_plain, ig_caption, tiktok_caption into v_post
    from workflow_posts
    where id = v_post_id
    for update;

  select id, caption into v_geral_id, v_geral_caption
    from post_targets
    where post_id = v_post_id and platform = 'geral'
    for update;
  v_have_geral := found;

  select status into v_tt_status
    from post_targets
    where post_id = v_post_id and platform = 'tiktok';
  v_have_tt := found;

  select * into v_suggestion
    from post_edit_suggestions
    where id = p_suggestion_id
    for update;

  if v_suggestion is null then
    raise exception 'Suggestion not found';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion is not pending (status: %)', v_suggestion.status;
  end if;

  if p_expected_updated_at is not null
     and v_suggestion.updated_at is distinct from p_expected_updated_at then
    raise exception 'suggestion_changed' using errcode = 'P0001';
  end if;

  -- campos lógicos que o cliente mudou
  v_texto_chg   := v_suggestion.changed_fields && array['conteudo', 'conteudo_plain'];
  v_legenda_chg := 'ig_caption'     = any (v_suggestion.changed_fields);
  v_tt_chg      := 'tiktok_caption' = any (v_suggestion.changed_fields);
  v_geral_chg   := 'geral_caption'  = any (v_suggestion.changed_fields);

  -- conflito: a equipe mexeu, depois da base do cliente, num campo que o cliente mudou
  v_texto_conf := v_texto_chg and (
    coalesce(v_post.conteudo_plain, '') <> coalesce(v_suggestion.original_conteudo_plain, '')
    or _tiptap_inline_image_keys(v_post.conteudo)
         is distinct from _tiptap_inline_image_keys(v_suggestion.original_conteudo)
  );
  v_legenda_conf := v_legenda_chg
    and coalesce(v_post.ig_caption, '') <> coalesce(v_suggestion.original_ig_caption, '');
  v_tt_conf := v_tt_chg
    and coalesce(v_post.tiktok_caption, '') <> coalesce(v_suggestion.original_tiktok_caption, '');
  v_geral_conf := v_geral_chg
    and coalesce(v_geral_caption, '') <> coalesce(v_suggestion.original_geral_caption, '');

  if p_fields is null then
    -- CRM antigo: não sabe mostrar os campos novos, nunca os aplica às cegas.
    if v_tt_chg or v_geral_chg or v_texto_conf or v_legenda_conf then
      raise exception 'suggestion_conflict' using errcode = 'P0001';
    end if;
    v_do_texto   := v_texto_chg;
    v_do_legenda := v_legenda_chg;
    v_do_tt      := false;
    v_do_geral   := false;
  else
    v_do_texto   := v_texto_chg   and 'texto'          = any (p_fields);
    v_do_legenda := v_legenda_chg and 'legenda'        = any (p_fields);
    v_do_tt      := v_tt_chg      and 'legenda_tiktok' = any (p_fields);
    v_do_geral   := v_geral_chg   and 'legenda_geral'  = any (p_fields);

    -- destino ausente / já publicado: nada muda
    if v_do_geral and (not v_have_geral or v_geral_id is distinct from v_suggestion.geral_target_id) then
      raise exception 'target_gone' using errcode = 'P0001';
    end if;
    if v_do_tt and not v_have_tt then
      raise exception 'target_gone' using errcode = 'P0001';
    end if;
    if v_do_tt and v_tt_status in ('processando', 'publicado') then
      raise exception 'target_locked' using errcode = 'P0001';
    end if;

    -- a tela pode estar velha: o conflito é reavaliado aqui, e só passa o que a equipe reconheceu
    if (v_do_texto      and v_texto_conf   and not ('texto'          = any (v_ack)))
       or (v_do_legenda and v_legenda_conf and not ('legenda'        = any (v_ack)))
       or (v_do_tt      and v_tt_conf      and not ('legenda_tiktok' = any (v_ack)))
       or (v_do_geral   and v_geral_conf   and not ('legenda_geral'  = any (v_ack))) then
      raise exception 'suggestion_conflict' using errcode = 'P0001';
    end if;
  end if;

  if not (v_do_texto or v_do_legenda or v_do_tt or v_do_geral) then
    raise exception 'no_fields' using errcode = 'P0001';
  end if;

  perform set_config('app.accepting_edit_suggestion', v_suggestion.id::text, true);

  -- source is forced to 'client' (the TEXT is client-authored), while
  -- actor_user_id still resolves to auth.uid() via the content-version
  -- trigger's fallback (see 20260923000001).
  perform set_config('app.event_source', 'client', true);
  perform set_config('app.post_edit_suggestion_id', v_suggestion.id::text, true);

  -- Geral primeiro: o trigger de post_targets não grava durante o aceite.
  if v_do_geral then
    v_geral_old := coalesce(v_geral_caption, '');
    v_geral_new := coalesce(v_suggestion.suggested_geral_caption, '');
    if v_geral_old is distinct from v_geral_new then
      perform set_config('app.edit_suggestion_geral_before',
                         jsonb_build_object('v', v_geral_old)::text, true);
    end if;
    update post_targets set caption = v_suggestion.suggested_geral_caption
      where id = v_geral_id;
  end if;

  -- texto mantém o COALESCE: há sugestões com suggested_conteudo NULL (legenda de Story).
  if v_do_texto or v_do_legenda or v_do_tt then
    update workflow_posts set
      conteudo       = case when v_do_texto
                            then coalesce(v_suggestion.suggested_conteudo, conteudo)
                            else conteudo end,
      conteudo_plain = case when v_do_texto
                            then coalesce(v_suggestion.suggested_conteudo_plain, conteudo_plain)
                            else conteudo_plain end,
      ig_caption     = case when v_do_legenda then v_suggestion.suggested_ig_caption else ig_caption end,
      tiktok_caption = case when v_do_tt then v_suggestion.suggested_tiktok_caption else tiktok_caption end
    where id = v_suggestion.post_id;
  end if;

  -- Nenhuma coluna de workflow_posts mudou de fato: a versão do Geral sai daqui, uma vez.
  if nullif(current_setting('app.edit_suggestion_geral_before', true), '') is not null then
    perform _record_post_geral_caption_version(v_suggestion.post_id, v_geral_old, v_geral_new);
    perform set_config('app.edit_suggestion_geral_before', '', true);
  end if;

  update post_edit_suggestions set
    status      = 'accepted',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_suggestion_id;
end;
$function$;

-- reject_edit_suggestion
CREATE OR REPLACE FUNCTION public.reject_edit_suggestion(p_suggestion_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_suggestion record;
begin
  select * into v_suggestion
    from post_edit_suggestions
    where id = p_suggestion_id
    for update;

  if v_suggestion is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and v_suggestion.conta_id is distinct from get_my_conta_id()) then
    raise exception 'Suggestion not found';
  end if;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_suggestion.conta_id, ARRAY[v_suggestion.post_id], 'Suggestion not found', 'P0001', false);

  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion is not pending (status: %)', v_suggestion.status;
  end if;

  update post_edit_suggestions set
    status      = 'rejected',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_suggestion_id;
end;
$function$;

-- reorder_board_posts
CREATE OR REPLACE FUNCTION public.reorder_board_posts(p_post_ids bigint[], p_ordens double precision[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_conta uuid := public.get_my_conta_id();
  v_count int;
begin
  if v_conta is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_post_ids is null or p_ordens is null
     or array_length(p_post_ids, 1) is null
     or array_length(p_post_ids, 1) is distinct from array_length(p_ordens, 1) then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- Lock em ordem estavel (padrao da casa: FOR UPDATE separado da agregacao).
  perform 1 from workflow_posts
   where id = any(p_post_ids) and conta_id = v_conta
   order by id
   for update;

  -- Posse all-or-nothing. Ids duplicados no array tambem caem aqui: o count
  -- de linhas nunca alcanca array_length com duplicatas.
  select count(*) into v_count
    from workflow_posts
   where id = any(p_post_ids) and conta_id = v_conta;
  if v_count is distinct from array_length(p_post_ids, 1) then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, p_post_ids, 'post_not_found', 'P0001', false);

  update workflow_posts wp
     set board_ordem = u.ordem
    from unnest(p_post_ids, p_ordens) as u(id, ordem)
   where wp.id = u.id and wp.conta_id = v_conta;
end;
$function$;

-- reorder_workflow_positions
CREATE OR REPLACE FUNCTION public.reorder_workflow_positions(p_workflow_ids bigint[], p_positions integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_conta uuid := public.get_my_conta_id();
  v_count int;
begin
  if v_conta is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_workflow_ids is null or p_positions is null
     or array_length(p_workflow_ids, 1) is null
     or array_length(p_workflow_ids, 1) is distinct from array_length(p_positions, 1) then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  if array_position(p_positions, null) is not null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  perform 1 from workflows
   where id = any(p_workflow_ids) and conta_id = v_conta
   order by id
   for update;

  -- Ids duplicados no array tambem caem aqui: o count nunca alcanca array_length com duplicatas.
  select count(*) into v_count
    from workflows
   where id = any(p_workflow_ids) and conta_id = v_conta;
  if v_count is distinct from array_length(p_workflow_ids, 1) then
    raise exception 'workflow_not_found' using errcode = 'P0001';
  end if;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, p_workflow_ids, 'workflow_not_found', 'P0001');

  update workflows w
     set position = u.pos
    from unnest(p_workflow_ids, p_positions) as u(id, pos)
   where w.id = u.id and w.conta_id = v_conta;
end;
$function$;

-- reorder_fluxos_board
CREATE OR REPLACE FUNCTION public.reorder_fluxos_board(p_workflow_ids bigint[], p_workflow_positions integer[], p_process_ids bigint[], p_process_positions integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.post_process_require_editor();
  v_nw    int  := coalesce(array_length(p_workflow_ids, 1), 0);
  v_np    int  := coalesce(array_length(p_process_ids, 1), 0);
  v_count int;
BEGIN
  IF v_nw IS DISTINCT FROM coalesce(array_length(p_workflow_positions, 1), 0)
     OR v_np IS DISTINCT FROM coalesce(array_length(p_process_positions, 1), 0)
     OR (v_nw = 0 AND v_np = 0) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;

  -- Duplicatas derrubam a chamada ANTES de qualquer UPDATE. Com o mesmo id
  -- duas vezes num array, o UPDATE ... FROM unnest(...) junta a linha a duas
  -- fontes e o Postgres nao define qual vence: a ordem persistida sairia nao
  -- deterministica. Posicao repetida produz o mesmo sintoma na leitura, e como
  -- workflows.position e post_processes.board_position sao UM espaco de indices
  -- por coluna (secao 4.2), a checagem de posicao e sobre os dois arrays
  -- concatenados. count(DISTINCT) ignora NULL, entao um id ou uma posicao nula
  -- tambem cai aqui, o mesmo codigo que o molde reorder_workflow_positions usa
  -- para comprimento e nulos.
  --
  -- NAO se compara id de fluxo com id de processo: sao tabelas e sequences
  -- diferentes, e uma coluna legitima pode conter o fluxo 5 e o processo 5.
  -- Densidade tambem nao e exigida: a coluna pode ser esparsa (Decisao 19), so
  -- nao pode ter empate.
  IF v_nw > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_workflow_ids) x) IS DISTINCT FROM v_nw THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;
  IF v_np > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_process_ids) x) IS DISTINCT FROM v_np THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_workflow_positions || p_process_positions) x)
     IS DISTINCT FROM (v_nw + v_np) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'P0001';
  END IF;

  -- Ver cabecalho: apply/detach calculam MAX(board_position)+1 sob esta
  -- mesma chave, entao o reorder precisa serializar com elas para nao empatar.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Fluxo arquivado nao pode ter vindo de um drag, mesmo raciocinio do filtro de estado do processo abaixo.
  IF v_nw > 0 THEN
    PERFORM 1 FROM workflows w
     WHERE w.id = ANY(p_workflow_ids) AND w.conta_id = v_conta
       AND w.status IS DISTINCT FROM 'arquivado'
     ORDER BY w.id
       FOR UPDATE;
    SELECT count(DISTINCT w.id) INTO v_count FROM workflows w
     WHERE w.id = ANY(p_workflow_ids) AND w.conta_id = v_conta
       AND w.status IS DISTINCT FROM 'arquivado';
    IF v_count IS DISTINCT FROM (SELECT count(DISTINCT x) FROM unnest(p_workflow_ids) x) THEN
      RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
    END IF;
    -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
    PERFORM public.scope_check_workflows(v_conta, p_workflow_ids, 'workflow_not_found', 'P0001');
  END IF;

  -- Estado restrito a 'ativo' e 'concluido': sao os unicos que viram card no
  -- quadro. Um id de processo 'encerrado' nao pode ter vindo de um drag, entao
  -- gravar board_position nele so poluiria o espaco de indices. Com o filtro,
  -- a RPC fica mais fechada e o erro (process_not_found) fica correto.
  IF v_np > 0 THEN
    PERFORM 1 FROM post_processes pp
     WHERE pp.id = ANY(p_process_ids) AND pp.conta_id = v_conta
       AND pp.estado IN ('ativo', 'concluido')
     ORDER BY pp.id
       FOR UPDATE;
    SELECT count(DISTINCT pp.id) INTO v_count FROM post_processes pp
     WHERE pp.id = ANY(p_process_ids) AND pp.conta_id = v_conta
       AND pp.estado IN ('ativo', 'concluido');
    IF v_count IS DISTINCT FROM (SELECT count(DISTINCT x) FROM unnest(p_process_ids) x) THEN
      RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
    END IF;
    -- [escopo] processo segue o post (lido pela RLS)
    PERFORM public.scope_check_processes(v_conta, p_process_ids, false);
  END IF;

  IF v_nw > 0 THEN
    UPDATE workflows w
       SET position = u.pos
      FROM unnest(p_workflow_ids, p_workflow_positions) AS u(id, pos)
     WHERE w.id = u.id AND w.conta_id = v_conta;
  END IF;

  IF v_np > 0 THEN
    UPDATE post_processes pp
       SET board_position = u.pos
      FROM unnest(p_process_ids, p_process_positions) AS u(id, pos)
     WHERE pp.id = u.id AND pp.conta_id = v_conta;
  END IF;
END;
$function$;

-- attach_posts_to_flow
CREATE OR REPLACE FUNCTION public.attach_posts_to_flow(p_post_ids bigint[], p_workflow_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta           uuid := public.get_my_conta_id();
  v_ids             bigint[];
  v_requested       int;
  v_owned           int;
  v_wf_cliente_id   bigint;
  v_wf_status       text;
  v_not_avulso      int;
  v_wrong_client    int;
  v_limit           bigint;
  v_current         bigint;
  v_max_ordem       integer;
  v_attached        int;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 0: advisory lock por conta, ANTES de qualquer lock de linha --
  -- serializa esta RPC contra detach_posts_from_flow na mesma conta (ver
  -- nota grande no topo do arquivo, item 1).
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- PASSO 0b: advisory lock do limitador de plano (mesma chave de
  -- enforce_plan_count_limit, 20260611130002), tomado AQUI -- antes do lock
  -- de linha do workflow (passo 1 abaixo), nao mais junto da contagem (ver
  -- nota grande no topo do arquivo, item 2: sem isso, um INSERT concorrente
  -- em workflow_posts pode formar deadlock contra este attach via
  -- trg_limit_posts + a FOR KEY SHARE que a FK workflow_id pede na linha do
  -- workflow).
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  -- Dedupe + descarta NULLs; array vazio (ou so NULLs) e erro.
  SELECT coalesce(array_agg(DISTINCT x), '{}')
    INTO v_ids
    FROM unnest(p_post_ids) x
   WHERE x IS NOT NULL;

  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  -- 1) Trava o fluxo ALVO primeiro (lock ordering: workflow antes de posts).
  SELECT cliente_id, status INTO v_wf_cliente_id, v_wf_status
    FROM workflows
   WHERE id = p_workflow_id AND conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[p_workflow_id], 'workflow_not_found', 'P0001');
  IF v_wf_status <> 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- 2) Trava os posts em ordem estavel (mesmo padrao de
  -- detach_posts_from_flow / reorder_post_schedules).
  PERFORM 1
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;

  -- All-or-nothing de posse: mesma logica do detach.
  SELECT count(*) INTO v_owned
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta;
  IF v_owned <> v_requested THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, v_ids, 'post_not_found', 'P0001', true);

  -- Todos precisam estar avulsos (all-or-nothing -- nenhum reanexo parcial).
  SELECT count(*) INTO v_not_avulso
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta AND wp.workflow_id IS NOT NULL;
  IF v_not_avulso > 0 THEN
    RAISE EXCEPTION 'post_already_in_flow' USING ERRCODE = 'P0001';
  END IF;

  -- Todos precisam ser do MESMO cliente do fluxo alvo (all-or-nothing).
  SELECT count(*) INTO v_wrong_client
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta AND wp.cliente_id <> v_wf_cliente_id;
  IF v_wrong_client > 0 THEN
    RAISE EXCEPTION 'post_belongs_to_another_client' USING ERRCODE = 'P0001';
  END IF;

  -- 3) Guarda de limite. O advisory ':max_posts_per_workflow' ja foi tomado
  -- no PASSO 0b, antes do lock de linha do workflow (ver nota grande no topo
  -- do arquivo, item 2) -- aqui so falta contar e comparar, ja protegido por
  -- esse lock.
  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_current
      FROM workflow_posts
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta;

    -- Fronteira exata: current + incoming = limit PASSA (nao estoura);
    -- current + incoming = limit + 1 estoura. Mesma semantica de
    -- enforce_plan_count_limit aplicada a um lote (cada post do lote, se
    -- inserido um a um, precisaria satisfazer count_no_momento < limit).
    IF v_current + v_requested > v_limit THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4) ordem = max(ordem) atual do fluxo alvo + row_number() deterministico
  -- por id (nao pela ordem de p_post_ids, que nao e garantida estavel pelo
  -- chamador).
  SELECT coalesce(max(ordem), -1) INTO v_max_ordem
    FROM workflow_posts
   WHERE workflow_id = p_workflow_id AND conta_id = v_conta;

  PERFORM set_config('app.allow_post_move', 'on', true);

  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM workflow_posts
     WHERE id = ANY(v_ids) AND conta_id = v_conta
  )
  UPDATE workflow_posts wp
     SET workflow_id = p_workflow_id,
         ordem = (v_max_ordem + ranked.rn)::integer
    FROM ranked
   WHERE wp.id = ranked.id;
  GET DIAGNOSTICS v_attached = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'attached', v_attached);
END;
$function$;

-- attach_post_closing_process
CREATE OR REPLACE FUNCTION public.attach_post_closing_process(p_post_id bigint, p_workflow_id bigint, p_expected_revisao integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta      uuid := public.post_process_require_editor();
  v_wf         record;
  v_post       record;
  v_proc       record;
  v_limit      bigint;
  v_current    bigint;
  v_max_ordem  integer;
  v_revisao    integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  SELECT w.id, w.cliente_id, w.status INTO v_wf
    FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[p_workflow_id], 'workflow_not_found', 'P0001');
  -- IS DISTINCT FROM porque workflows.status e nullable: com <> um fluxo de
  -- status nulo passaria como ativo (mesmo raciocinio do detach, 20260919000003).
  IF v_wf.status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  SELECT wp.id, wp.workflow_id, wp.cliente_id INTO v_post
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, ARRAY[p_post_id], 'post_not_found', 'P0001', true);
  IF v_post.workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'post_already_in_flow' USING ERRCODE = 'P0001';
  END IF;
  IF v_post.cliente_id IS DISTINCT FROM v_wf.cliente_id THEN
    RAISE EXCEPTION 'post_belongs_to_another_client' USING ERRCODE = 'P0001';
  END IF;

  -- A busca NAO filtra estado: trava a execucao mais recente do post e depois
  -- decide. Filtrar por IN ('ativo','concluido') faria um post cuja unica
  -- execucao ja esta 'encerrado' responder process_not_found, quando o
  -- contrato (e o que remove_post_process ja faz no caso equivalente) e
  -- process_already_closed. Sem execucao nenhuma, ai sim process_not_found.
  SELECT pp.id, pp.estado, pp.etapa_atual, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.post_id = p_post_id AND pp.conta_id = v_conta
   ORDER BY pp.id DESC
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.estado = 'encerrado' THEN
    RAISE EXCEPTION 'process_already_closed' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  -- Limite de posts por fluxo: trg_limit_posts so roda em INSERT e nunca
  -- dispara neste UPDATE, entao esta guarda e o unico enforcement possivel.
  -- Mesma fronteira do attach: atual + 1 = limite passa, limite + 1 estoura.
  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_current FROM workflow_posts
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta;
    IF v_current + 1 > v_limit THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 1) Encerrar ANTES do attach (ver nota no topo).
  UPDATE post_process_steps SET estado = 'interrompido', interrompido_em = now()
   WHERE process_id = v_proc.id AND estado = 'ativo';
  UPDATE post_processes
     SET estado = 'encerrado', motivo_encerramento = 'vinculado', revisao = revisao + 1
   WHERE id = v_proc.id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, p_post_id, v_proc.id, 'vinculado',
    jsonb_build_object('estado', v_proc.estado, 'etapa_atual', v_proc.etapa_atual),
    jsonb_build_object('estado', 'encerrado', 'motivo_encerramento', 'vinculado',
                       'workflow_id', p_workflow_id));

  -- 2) Attach, no mesmo desenho de attach_posts_to_flow.
  SELECT coalesce(max(ordem), -1) INTO v_max_ordem
    FROM workflow_posts WHERE workflow_id = p_workflow_id AND conta_id = v_conta;

  PERFORM set_config('app.allow_post_move', 'on', true);
  UPDATE workflow_posts
     SET workflow_id = p_workflow_id, ordem = (v_max_ordem + 1)::integer
   WHERE id = p_post_id AND conta_id = v_conta;
  PERFORM set_config('app.allow_post_move', 'off', true);

  RETURN jsonb_build_object('ok', true, 'process_id', v_proc.id, 'post_id', p_post_id,
                            'workflow_id', p_workflow_id, 'estado', 'encerrado',
                            'motivo_encerramento', 'vinculado', 'revisao', v_revisao);
END;
$function$;

-- detach_posts_from_flow
CREATE OR REPLACE FUNCTION public.detach_posts_from_flow(p_post_ids bigint[], p_archive_empty_flow boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta                 uuid := public.get_my_conta_id();
  v_ids                   bigint[];
  v_requested             int;
  v_owned                 int;
  v_source_workflow_ids   bigint[];
  v_detached              int;
  v_archived              bigint[] := '{}';
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 0: advisory lock por conta, ANTES de qualquer lock de linha.
  -- Serializa esta RPC contra attach_posts_to_flow na MESMA conta -- sem
  -- isso, as duas ordens de lock de linha (detach: posts, depois workflow no
  -- arquivamento; attach: workflow, depois posts) podem formar um ciclo de
  -- espera circular (ver nota grande no topo do arquivo, item 1). Chave
  -- dedicada (':post_move'), distinta da ':max_posts_per_workflow' do
  -- limitador de plano -- outra preocupacao, outro lock, que este detach
  -- nunca toma.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Dedupe + descarta NULLs; array vazio (ou so NULLs) e erro -- nao ha
  -- "nada para desanexar" silencioso.
  SELECT coalesce(array_agg(DISTINCT x), '{}')
    INTO v_ids
    FROM unnest(p_post_ids) x
   WHERE x IS NOT NULL;

  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  -- Lock das linhas proprias em ordem estavel (previne deadlock com outra
  -- chamada concorrente que travar os mesmos posts em ordem diferente).
  PERFORM 1
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;

  -- All-or-nothing: todo id pedido tem que resolver para uma linha travada
  -- acima (mesma conta). Um id inexistente ou de outra conta nao trava nada
  -- e derruba a contagem abaixo do pedido -- nada foi alterado ainda.
  SELECT count(*) INTO v_owned
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta;

  IF v_owned <> v_requested THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, v_ids, 'post_not_found', 'P0001', true);

  -- Fontes com fluxo, capturadas ANTES do UPDATE abaixo zerar workflow_id --
  -- depois da UPDATE nao haveria mais como saber de qual fluxo cada post veio.
  SELECT coalesce(array_agg(DISTINCT wp.workflow_id), '{}')
    INTO v_source_workflow_ids
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta AND wp.workflow_id IS NOT NULL;

  -- Transacional (terceiro argumento true): reseta sozinha no COMMIT/ROLLBACK,
  -- nunca vaza para outra transacao/conexao. Sem isso o guard BEFORE UPDATE
  -- post_a0_sync_cliente (20260830000001) rejeitaria esta UPDATE com
  -- post_move_requires_rpc.
  PERFORM set_config('app.allow_post_move', 'on', true);

  -- Posts ja avulsos entre os pedidos (workflow_id ja NULL) sao no-op aqui --
  -- o predicado "workflow_id IS NOT NULL" so atualiza quem de fato tinha
  -- fluxo, e "detached" abaixo reflete exatamente essas linhas.
  UPDATE workflow_posts
     SET workflow_id = NULL
   WHERE id = ANY(v_ids) AND conta_id = v_conta AND workflow_id IS NOT NULL;
  GET DIAGNOSTICS v_detached = ROW_COUNT;

  IF p_archive_empty_flow AND array_length(v_source_workflow_ids, 1) IS NOT NULL THEN
    -- Trava (ordem estavel) so os workflows de ORIGEM do lote desanexado --
    -- nunca um workflow vazio qualquer que nao tenha nada a ver com esta
    -- chamada.
    PERFORM 1
      FROM workflows w
     WHERE w.id = ANY(v_source_workflow_ids) AND w.conta_id = v_conta
     ORDER BY w.id
       FOR UPDATE;

    SELECT coalesce(array_agg(w.id ORDER BY w.id), '{}')
      INTO v_archived
      FROM workflows w
     WHERE w.id = ANY(v_source_workflow_ids)
       AND w.conta_id = v_conta
       AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = w.id);

    IF array_length(v_archived, 1) IS NOT NULL THEN
      -- workflows_updated_event (20260826000001, Trigger B) dispara
      -- normalmente aqui e grava 'fluxo_arquivado' -- nao suprimimos: e o
      -- mesmo caminho de UPDATE direto que qualquer arquivamento manual ja
      -- usa, sem tratamento especial.
      UPDATE workflows SET status = 'arquivado' WHERE id = ANY(v_archived);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'detached', v_detached,
    'archived_workflow_ids', to_jsonb(v_archived)
  );
END;
$function$;

-- detach_posts_keeping_process
CREATE OR REPLACE FUNCTION public.detach_posts_keeping_process(p_post_ids bigint[], p_workflow_id bigint, p_fingerprint text, p_active_deadline timestamp with time zone, p_request_id uuid, p_step_deadlines jsonb DEFAULT NULL::jsonb, p_archive_empty_flow boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta       uuid := public.post_process_require_editor();
  v_ids         bigint[];
  v_requested   int;
  v_hash        text;
  v_owned       int;
  v_fora        int;
  v_prev        jsonb;
  v_wf          record;
  v_ativa       record;
  v_n_ativas    int;
  v_assinatura  text;
  v_tmpl_nome   text;
  v_board       integer;
  v_key         text;
  v_val         text;
  v_ordem       integer;
  v_post_id     bigint;
  v_proc        bigint;
  v_proc_ids    bigint[] := '{}';
  v_detached    int;
  v_archived    bigint[] := '{}';
  v_processes   jsonb;
  v_steps       jsonb;
  v_res         jsonb;
BEGIN
  IF NOT effective_plan_feature(v_conta, 'feature_post_processes') THEN
    RAISE EXCEPTION 'feature_disabled:feature_post_processes' USING ERRCODE = 'P0001';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_active_deadline IS NULL THEN
    RAISE EXCEPTION 'active_deadline_required' USING ERRCODE = 'P0001';
  END IF;

  -- Um NULL no lote seria descartado pelo agregado em silencio: o digest
  -- ficaria igual ao do mesmo lote sem ele e o chamador que perdeu um id por
  -- bug de front receberia 'ok'. Recusar em vez de aceitar menos do que veio.
  IF array_position(p_post_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_ids
    FROM unnest(p_post_ids) x WHERE x IS NOT NULL;
  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  -- Digest canonico das entradas que identificam o lote e o comando. v_ids ja
  -- esta deduplicado e ordenado, entao a mesma chamada em outra ordem de ids
  -- da o mesmo hash. p_archive_empty_flow entra por ser escolha do usuario.
  v_hash := md5(coalesce(p_workflow_id::text, '') || '|' ||
                array_to_string(v_ids, ',') || '|' ||
                coalesce(p_fingerprint, '') || '|' ||
                coalesce(p_archive_empty_flow::text, 'false'));

  -- PASSO 0: advisory por conta, antes de tudo.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- PASSO 1: recibo de idempotencia.
  SELECT r.resultado INTO v_prev
    FROM post_process_batch_requests r
   WHERE r.request_id = p_request_id AND r.conta_id = v_conta;
  IF FOUND THEN
    IF v_prev ->> 'input_hash' IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'request_mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_prev - 'input_hash';
  END IF;
  -- request_id e PK global: existir sem casar a conta e recibo alheio.
  IF EXISTS (SELECT 1 FROM post_process_batch_requests r WHERE r.request_id = p_request_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 2: fluxo de origem travado.
  SELECT w.id, w.titulo, w.status, w.template_id, w.modo_prazo
    INTO v_wf
    FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[p_workflow_id], 'workflow_not_found', 'P0001');
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, v_ids, 'post_not_found', 'P0001', true);
  -- IS DISTINCT FROM porque workflows.status e nullable: com <> um fluxo de
  -- status nulo passaria como ativo.
  IF v_wf.status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 2b: etapas da origem travadas antes do fingerprint. Ver ORDEM DE
  -- LOCKS no cabecalho: sem isto, uma edicao de etapa commitada entre o
  -- PASSO 3 e o PASSO 9 entraria no snapshot com fingerprint 'valido'.
  PERFORM 1 FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id
   ORDER BY e.id
     FOR UPDATE;

  -- PASSO 3: fingerprint recalculado sob lock.
  IF public.workflow_fingerprint(p_workflow_id) IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION 'workflow_changed' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 4: exatamente uma etapa ativa.
  SELECT count(*) INTO v_n_ativas FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo';
  IF v_n_ativas <> 1 THEN
    RAISE EXCEPTION 'workflow_etapas_inconsistent' USING ERRCODE = 'P0001';
  END IF;
  -- workflow_etapas nao tem UNIQUE (workflow_id, ordem) e o fingerprint tolera
  -- ordem repetida por desenho. Sem esta checagem, um fluxo com ordens 0,1,1
  -- passa daqui e estoura 23505 cru em post_process_steps_ordem_uq, sem codigo
  -- que o CRM saiba traduzir.
  IF EXISTS (SELECT 1 FROM workflow_etapas e
              WHERE e.workflow_id = p_workflow_id
              GROUP BY e.ordem HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'workflow_etapas_inconsistent' USING ERRCODE = 'P0001';
  END IF;
  SELECT e.ordem, e.nome INTO v_ativa FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo';

  -- PASSO 5: mapa de prazos de etapas futuras.
  IF p_step_deadlines IS NOT NULL THEN
    IF jsonb_typeof(p_step_deadlines) <> 'object' THEN
      RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(p_step_deadlines) LOOP
      IF v_key !~ '^(0|[1-9][0-9]{0,8})$' THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END IF;
      -- A regex ^(0|[1-9][0-9]{0,8})$ ja limita a chave a no maximo 9 digitos
      -- (0 a 999999999), dentro do range de integer (max 2147483647, 10
      -- digitos), entao o cast abaixo nunca deveria estourar. O bloco
      -- protegido e cinto e suspensorio: se a regex mudar um dia e deixar
      -- passar algo maior, o cast cru levantaria 22003 sem codigo mapeavel;
      -- protegido, vira o mesmo invalid_step_deadlines dos demais casos.
      BEGIN
        v_ordem := v_key::integer;
      EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END;
      IF v_ordem <= v_ativa.ordem THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM workflow_etapas e
                      WHERE e.workflow_id = p_workflow_id AND e.ordem = v_ordem) THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END IF;
      -- Valor JSON null chega aqui como v_val NULL e o cast nao levantaria: a
      -- etapa futura ficaria sem prazo em silencio, com o CRM achando que
      -- mandou um. Mapa de prazos so aceita prazo.
      IF v_val IS NULL THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        PERFORM v_val::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid_step_deadlines' USING ERRCODE = 'P0001';
      END;
    END LOOP;
  END IF;

  -- FIX ROUND 4 (PASSO 5b). Spec 7: "etapas futuras com data_limite mantem a
  -- data como prazo_efetivo". O loop acima so valida as chaves que o CRM
  -- mandou; sem esta checagem, uma etapa futura com data_limite omitida do
  -- mapa perderia a data em silencio (o INSERT do PASSO 9 so olha o mapa,
  -- nunca workflow_etapas.data_limite). Etapa futura SEM data_limite continua
  -- opcional, como antes.
  IF EXISTS (
       SELECT 1 FROM workflow_etapas e
        WHERE e.workflow_id = p_workflow_id
          AND e.ordem > v_ativa.ordem
          AND e.data_limite IS NOT NULL
          AND (p_step_deadlines -> e.ordem::text) IS NULL) THEN
    RAISE EXCEPTION 'step_deadline_required' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 6: posts travados em ordem estavel, all-or-nothing.
  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;

  SELECT count(*) INTO v_owned FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta;
  IF v_owned <> v_requested THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_fora FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
     AND wp.workflow_id IS DISTINCT FROM p_workflow_id;
  IF v_fora > 0 THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 7: snapshot compartilhado (assinatura, nome do template, base do board).
  SELECT string_agg(e.ordem::text || '|' || e.nome || '|' || coalesce(nullif(e.tipo, ''), 'padrao'),
                    chr(10) ORDER BY e.ordem)
    INTO v_assinatura
    FROM workflow_etapas e WHERE e.workflow_id = p_workflow_id;

  SELECT t.nome INTO v_tmpl_nome FROM workflow_templates t
   WHERE t.id = v_wf.template_id AND t.conta_id = v_conta;

  -- Base do board: max entre os processos que APARECEM no quadro, ativos e
  -- concluidos. So os ativos deixaria um concluido reaberto colidindo com um
  -- processo novo na mesma posicao (Decisao 19). Encerrado nao aparece.
  SELECT coalesce(max(pp.board_position), -1) INTO v_board
    FROM post_processes pp WHERE pp.conta_id = v_conta AND pp.estado IN ('ativo', 'concluido');

  -- PASSO 8: desvincular. O GUC e transacional e volta a 'off' logo depois,
  -- para nao deixar post_a0_sync_cliente aberto no resto da transacao. O
  -- trigger post_a1_process_guard nao dispara aqui: o UPDATE zera workflow_id.
  PERFORM set_config('app.allow_post_move', 'on', true);
  UPDATE workflow_posts SET workflow_id = NULL
   WHERE id = ANY(v_ids) AND conta_id = v_conta;
  GET DIAGNOSTICS v_detached = ROW_COUNT;
  PERFORM set_config('app.allow_post_move', 'off', true);

  -- PASSO 9: um processo por post, com as etapas em snapshot e o evento.
  FOREACH v_post_id IN ARRAY v_ids LOOP
    v_board := v_board + 1;
    INSERT INTO post_processes
      (conta_id, post_id, template_id, template_nome, assinatura, origem_workflow_id,
       origem_descricao, estado, etapa_atual, modo_prazo, board_position, created_by)
    VALUES
      (v_conta, v_post_id, v_wf.template_id, v_tmpl_nome, v_assinatura, p_workflow_id,
       v_wf.titulo || ', etapa ' || v_ativa.nome, 'ativo', v_ativa.ordem,
       coalesce(v_wf.modo_prazo, 'padrao'), v_board, auth.uid())
    RETURNING id INTO v_proc;
    v_proc_ids := v_proc_ids || v_proc;

    INSERT INTO post_process_steps
      (conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo,
       prazo_efetivo, estado, iniciado_em, origem_etapa_ordem, origem_etapa_nome)
    SELECT
      v_conta, v_proc, e.ordem, e.nome, coalesce(nullif(e.tipo, ''), 'padrao'),
      -- Decisao 17 tambem aqui: workflow_etapas.responsavel_id e FK simples
      -- para membros(id), sem tenant. post_process_steps.responsavel_id tem FK
      -- composta com conta_id, entao um valor cross-tenant derrubaria o lote
      -- inteiro com foreign_key_violation cru, sem codigo. Nao resolve, vira
      -- nulo, e a UI mostra "Sem responsavel".
      (SELECT m.id FROM membros m WHERE m.id = e.responsavel_id AND m.conta_id = v_conta),
      e.prazo_dias, e.tipo_prazo,
      CASE WHEN e.ordem = v_ativa.ordem THEN p_active_deadline
           WHEN e.ordem > v_ativa.ordem
             THEN (p_step_deadlines ->> e.ordem::text)::timestamptz
           ELSE NULL END,
      CASE WHEN e.ordem < v_ativa.ordem THEN 'herdado'
           WHEN e.ordem = v_ativa.ordem THEN 'ativo'
           ELSE 'pendente' END,
      CASE WHEN e.ordem = v_ativa.ordem THEN now() ELSE NULL END,
      e.ordem, e.nome
      FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id;

    PERFORM public.post_process_log_event(
      v_conta, v_post_id, v_proc, 'desmembrado',
      jsonb_build_object('workflow_id', p_workflow_id, 'workflow_titulo', v_wf.titulo,
                         'etapa_ordem', v_ativa.ordem, 'etapa_nome', v_ativa.nome),
      jsonb_build_object('process_id', v_proc, 'etapa_atual', v_ativa.ordem,
                         'prazo_efetivo', p_active_deadline));
  END LOOP;

  -- PASSO 10: arquivar a origem se este lote a esvaziou. A linha ja esta
  -- travada desde o passo 2; a ressalva contra INSERT concorrente e a mesma de
  -- detach_posts_from_flow (o FOR SHARE do trigger na linha do fluxo).
  IF p_archive_empty_flow
     AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = p_workflow_id) THEN
    UPDATE workflows SET status = 'arquivado' WHERE id = p_workflow_id;
    v_archived := ARRAY[p_workflow_id];
  END IF;

  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.post_id) INTO v_processes FROM (
    SELECT pp.id AS process_id, pp.post_id, pp.etapa_atual, pp.revisao, pp.board_position,
           pp.assinatura, pp.origem_workflow_id, pp.origem_descricao
      FROM post_processes pp WHERE pp.id = ANY(v_proc_ids)) x;

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.process_id, y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = ANY(v_proc_ids)) y;

  v_res := jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'detached', v_detached,
    'archived_workflow_ids', to_jsonb(v_archived),
    'processes', coalesce(v_processes, '[]'::jsonb),
    'steps', coalesce(v_steps, '[]'::jsonb));

  -- Corrida entre contas: colisao de uuid gerado pelo CRM e praticamente
  -- impossivel, mas duas contas com o mesmo request_id concorrente podem
  -- passar as duas pela leitura do PASSO 1 e a segunda estoura unique_violation
  -- cru aqui. Sem codigo mapeavel para a UI, vira request_not_found.
  BEGIN
    INSERT INTO post_process_batch_requests (request_id, conta_id, resultado)
    VALUES (p_request_id, v_conta, v_res || jsonb_build_object('input_hash', v_hash));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END;

  RETURN v_res;
END;
$function$;

-- move_posts_to_existing_flow
CREATE OR REPLACE FUNCTION public.move_posts_to_existing_flow(p_post_ids bigint[], p_source_workflow_id bigint, p_target_workflow_id bigint, p_archive_empty_flow boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta       uuid := public.get_my_conta_id();
  v_ids         bigint[];
  v_requested   int;
  v_source      bigint;
  v_src         record;
  v_tgt         record;
  v_limit       bigint;
  v_current     bigint;
  v_base_ordem  integer;
  v_moved       int;
  v_archived    bigint[] := '{}';
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x), '{}')
    INTO v_ids
    FROM unnest(p_post_ids) x
   WHERE x IS NOT NULL;
  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  IF p_target_workflow_id = p_source_workflow_id THEN
    RAISE EXCEPTION 'target_is_source' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 0: advisory locks (ordem documentada no topo; este caminho nao
  -- insere workflow e por isso nao toma ':max_active_workflows_per_client').
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  -- Todo post do lote precisa estar no fluxo DECLARADO (mesmo contrato do
  -- new-flow: descoberta sem lock + re-checagem travada mais abaixo).
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, v_ids, 'post_not_found', 'P0001', true);
  v_source := public.move_posts_source_of_batch(v_conta, v_ids);
  IF v_source <> p_source_workflow_id THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Trava origem E destino numa unica passada em ordem estavel de id
  -- (higiene de ordem entre duas chamadas com origem/destino invertidos --
  -- ':post_move' ja as serializa, mas a ordem estavel nao custa nada).
  PERFORM 1
    FROM workflows w
   WHERE w.id IN (v_source, p_target_workflow_id) AND w.conta_id = v_conta
   ORDER BY w.id
     FOR UPDATE;

  SELECT w.cliente_id, w.template_id INTO v_src
    FROM workflows w
   WHERE w.id = v_source AND w.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT w.cliente_id, w.template_id, w.status INTO v_tgt
    FROM workflows w
   WHERE w.id = p_target_workflow_id AND w.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[v_source, p_target_workflow_id], 'workflow_not_found', 'P0001');
  IF v_tgt.status <> 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_tgt.cliente_id <> v_src.cliente_id THEN
    RAISE EXCEPTION 'workflow_different_client' USING ERRCODE = 'P0001';
  END IF;
  IF v_src.template_id IS NULL
     OR v_tgt.template_id IS DISTINCT FROM v_src.template_id THEN
    RAISE EXCEPTION 'workflow_template_mismatch' USING ERRCODE = 'P0001';
  END IF;

  -- 2) Trava os posts e re-valida o lote (mesma logica do new-flow).
  PERFORM 1
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;
  IF public.move_posts_source_of_batch(v_conta, v_ids) IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] de novo com os posts travados: o cliente pode ter mudado desde a checagem
  -- [escopo] sem lock acima (ela fica, para o erro de inexistente vir antes de tudo)
  PERFORM public.scope_check_posts(v_conta, v_ids, 'post_not_found', 'P0001', true);

  -- 3) Limite de posts do destino (guarda manual; advisory ja tomado).
  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_current
      FROM workflow_posts
     WHERE workflow_id = p_target_workflow_id AND conta_id = v_conta;
    IF v_current + v_requested > v_limit THEN
      RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 4) Opcoes extras + move (append apos o max(ordem) atual do destino,
  -- mesma base do attach; lock e leitura agregada em instrucoes separadas,
  -- padrao reorder_post_schedules).
  PERFORM public.remap_moved_posts_select_options(
    v_conta, v_ids, v_source, p_target_workflow_id, v_src.template_id, false);

  SELECT coalesce(max(ordem), -1) INTO v_base_ordem
    FROM workflow_posts
   WHERE workflow_id = p_target_workflow_id AND conta_id = v_conta;

  v_moved := public.move_posts_core(v_conta, v_ids, p_target_workflow_id, v_base_ordem);

  -- 5) Arquiva a origem se este exato lote a esvaziou (linha ja travada).
  IF p_archive_empty_flow
     AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = v_source) THEN
    UPDATE workflows SET status = 'arquivado' WHERE id = v_source;
    v_archived := ARRAY[v_source];
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'target_workflow_id', p_target_workflow_id,
    'archived_workflow_ids', to_jsonb(v_archived)
  );
END;
$function$;

-- move_posts_to_new_flow
CREATE OR REPLACE FUNCTION public.move_posts_to_new_flow(p_post_ids bigint[], p_source_workflow_id bigint, p_titulo text, p_start_ordem integer, p_archive_empty_flow boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta       uuid := public.get_my_conta_id();
  v_ids         bigint[];
  v_requested   int;
  v_source      bigint;
  v_src         record;
  v_limit       bigint;
  v_new_wf      bigint;
  v_moved       int;
  v_archived    bigint[] := '{}';
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Dedupe + descarta NULLs; array vazio (ou so NULLs) e erro.
  SELECT coalesce(array_agg(DISTINCT x), '{}')
    INTO v_ids
    FROM unnest(p_post_ids) x
   WHERE x IS NOT NULL;
  IF array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'post_ids_required' USING ERRCODE = 'P0001';
  END IF;
  v_requested := array_length(v_ids, 1);

  IF p_titulo IS NULL OR btrim(p_titulo) = '' THEN
    RAISE EXCEPTION 'titulo_required' USING ERRCODE = 'P0001';
  END IF;

  -- PASSO 0: advisory locks por conta, na ordem documentada no topo do
  -- arquivo, ANTES de qualquer lock de linha.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_active_workflows_per_client'));
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':max_posts_per_workflow'));

  -- Todo post do lote precisa estar no fluxo DECLARADO (leitura sem lock --
  -- os locks de linha vem depois, workflow antes de posts, e o lote e
  -- re-validado ja travado).
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, v_ids, 'post_not_found', 'P0001', true);
  v_source := public.move_posts_source_of_batch(v_conta, v_ids);
  IF v_source <> p_source_workflow_id THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Trava a origem e captura o que o fluxo novo herda.
  SELECT w.cliente_id, w.template_id, w.modo_prazo, w.user_id, w.plataformas
    INTO v_src
    FROM workflows w
   WHERE w.id = v_source AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[v_source], 'workflow_not_found', 'P0001');

  -- 2) A etapa inicial pedida precisa existir na origem.
  PERFORM 1
    FROM workflow_etapas e
   WHERE e.workflow_id = v_source AND e.ordem = p_start_ordem;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_start_etapa' USING ERRCODE = 'P0001';
  END IF;

  -- 3) Trava os posts em ordem estavel e re-valida o lote ja travado. Um
  -- lote que mudou de fluxo no meio (teorico sob ':post_move') ou encolheu
  -- (DELETE concorrente) cai num erro limpo aqui.
  PERFORM 1
    FROM workflow_posts wp
   WHERE wp.id = ANY(v_ids) AND wp.conta_id = v_conta
   ORDER BY wp.id
     FOR UPDATE OF wp;
  IF public.move_posts_source_of_batch(v_conta, v_ids) IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION 'post_not_in_source_flow' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] de novo com os posts travados: o cliente pode ter mudado desde a checagem
  -- [escopo] sem lock acima (ela fica, para o erro de inexistente vir antes de tudo)
  PERFORM public.scope_check_posts(v_conta, v_ids, 'post_not_found', 'P0001', true);

  -- 4) Limite de posts do fluxo destino (que nasce vazio): o trigger
  -- trg_limit_posts so roda em INSERT e nunca dispara neste UPDATE, entao a
  -- guarda manual e o unico enforcement -- mesma fronteira do attach
  -- (= limite passa; limite + 1 estoura).
  v_limit := effective_plan_limit(v_conta, 'max_posts_per_workflow');
  IF v_limit IS NOT NULL AND v_requested > v_limit THEN
    RAISE EXCEPTION 'plan_limit_exceeded:max_posts_per_workflow' USING ERRCODE = 'P0001';
  END IF;

  -- 5) Fluxo novo. trg_limit_workflows (BEFORE INSERT, status ativo) valida
  -- max_active_workflows_per_client sozinho e ja levanta o erro no formato
  -- plan_limit_exceeded:* -- o advisory correspondente foi tomado no PASSO 0.
  -- auth.uid() e o criador real; o fallback para o dono da origem cobre
  -- chamadas service_role sem usuario.
  INSERT INTO workflows
    (user_id, conta_id, cliente_id, titulo, template_id, status, etapa_atual,
     recorrente, modo_prazo, created_via, plataformas)
  VALUES
    (coalesce(auth.uid(), v_src.user_id), v_conta, v_src.cliente_id,
     btrim(p_titulo), v_src.template_id, 'ativo', p_start_ordem,
     false, v_src.modo_prazo, 'human', v_src.plataformas)
  RETURNING id INTO v_new_wf;

  INSERT INTO workflow_etapas
    (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
     status, iniciado_em, concluido_em, data_limite)
  SELECT v_new_wf, e.ordem, e.nome, e.prazo_dias, e.tipo_prazo,
         e.responsavel_id, e.tipo,
         CASE WHEN e.ordem < p_start_ordem THEN 'concluido'
              WHEN e.ordem = p_start_ordem THEN 'ativo'
              ELSE 'pendente' END,
         CASE WHEN e.ordem < p_start_ordem THEN coalesce(e.iniciado_em, now())
              WHEN e.ordem = p_start_ordem THEN now()
              ELSE NULL END,
         CASE WHEN e.ordem < p_start_ordem THEN coalesce(e.concluido_em, now())
              ELSE NULL END,
         e.data_limite
    FROM workflow_etapas e
   WHERE e.workflow_id = v_source;

  -- Futuras pelo template (20261021120000): origem com etapas duplicadas nao
  -- passa o defeito para o fluxo novo. Antes do RETURN, que devolve as etapas.
  PERFORM public._realign_pending_etapas_to_template(v_new_wf);

  -- 6) Opcoes extras por fluxo + move em si.
  PERFORM public.remap_moved_posts_select_options(
    v_conta, v_ids, v_source, v_new_wf, v_src.template_id, true);
  v_moved := public.move_posts_core(v_conta, v_ids, v_new_wf, -1);

  -- 7) Arquiva a origem se este exato lote a esvaziou (mesma semantica do
  -- detach; a linha ja esta travada desde o passo 1). O Trigger B de
  -- workflow_events grava 'fluxo_arquivado' normalmente.
  IF p_archive_empty_flow
     AND NOT EXISTS (SELECT 1 FROM workflow_posts wp WHERE wp.workflow_id = v_source) THEN
    UPDATE workflows SET status = 'arquivado' WHERE id = v_source;
    v_archived := ARRAY[v_source];
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'target_workflow_id', v_new_wf,
    'archived_workflow_ids', to_jsonb(v_archived),
    'workflow', (SELECT to_jsonb(w) FROM workflows w WHERE w.id = v_new_wf),
    'etapas', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.ordem), '[]'::jsonb)
                 FROM workflow_etapas e WHERE e.workflow_id = v_new_wf)
  );
END;
$function$;

-- apply_post_process
CREATE OR REPLACE FUNCTION public.apply_post_process(p_post_id bigint, p_template_id bigint, p_template_fingerprint text, p_start_ordem integer, p_step_overrides jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta      uuid := public.post_process_require_editor();
  v_post       record;
  v_tmpl       record;
  v_n          int;
  v_etapa      jsonb;
  v_key        text;
  v_val        jsonb;
  v_chave      text;
  v_ordem      integer;
  v_resp       bigint;
  v_assinatura text;
  v_board      integer;
  v_proc       bigint;
  v_revisao    integer;
  v_estado     text;
  v_steps      jsonb;
BEGIN
  IF NOT effective_plan_feature(v_conta, 'feature_post_processes') THEN
    RAISE EXCEPTION 'feature_disabled:feature_post_processes' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT wp.id, wp.workflow_id INTO v_post
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, ARRAY[p_post_id], 'post_not_found', 'P0001', false);
  IF v_post.workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'post_in_workflow' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM post_processes pp
              WHERE pp.post_id = p_post_id AND pp.conta_id = v_conta
                AND pp.estado IN ('ativo', 'concluido')) THEN
    RAISE EXCEPTION 'post_has_active_process' USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.nome, t.etapas, t.modo_prazo INTO v_tmpl
    FROM workflow_templates t
   WHERE t.id = p_template_id AND t.conta_id = v_conta
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_tmpl.etapas IS NULL OR jsonb_typeof(v_tmpl.etapas) <> 'array'
     OR jsonb_array_length(v_tmpl.etapas) = 0 THEN
    RAISE EXCEPTION 'template_empty' USING ERRCODE = 'P0001';
  END IF;

  -- FIX ROUND 1 (F1): etapas e jsonb livre, sem CHECK na escrita. VALIDA em
  -- vez de coagir, para nao divergir de post_process_assinatura(), que le o
  -- mesmo jsonb sem normalizar prazo_dias nem responsavel_id. Roda antes de
  -- qualquer INSERT: template invalido nao cria linha nenhuma.
  FOR v_etapa IN SELECT e.val FROM jsonb_array_elements(v_tmpl.etapas) AS e(val) LOOP
    IF coalesce(v_etapa ->> 'nome', '') = '' THEN
      RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF nullif(v_etapa ->> 'tipo', '') IS NOT NULL
       AND nullif(v_etapa ->> 'tipo', '') NOT IN ('padrao', 'aprovacao_cliente') THEN
      RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF nullif(v_etapa ->> 'tipo_prazo', '') IS NOT NULL
       AND nullif(v_etapa ->> 'tipo_prazo', '') NOT IN ('uteis', 'corridos') THEN
      RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
    END IF;
    -- jsonb_typeof(NULL) e NULL quando a chave esta ausente (operador ->
    -- devolve SQL NULL); quando presente com valor JSON null, devolve 'null'.
    -- So os dois casos pulam a checagem; qualquer outro tipo que nao seja
    -- number, ou um number com casas decimais/sinal, e template_invalid.
    -- FIX ROUND 2 (F3): alem de inteiro nao negativo, o valor precisa caber no
    -- tipo da coluna de destino, senao o cast do INSERT (linhas abaixo)
    -- estoura 22003 cru. Regex com limite de digitos garante isso sem
    -- precisar de cast protegido: 9 digitos cabe com folga em integer, 18 em
    -- bigint.
    -- FIX ROUND 4: 9 digitos cabe em integer, mas ainda deixa passar um
    -- prazo_dias absurdo (ate 999999999) que trava computeDeadlineDate no
    -- CRM em 'uteis'. Teto de 3 digitos = 0-999, mesmo limite de
    -- update_post_process_step (20260920000003) e de
    -- PostProductionSection.tsx MAX_PRAZO_DIAS.
    IF jsonb_typeof(v_etapa -> 'prazo_dias') IS NOT NULL
       AND jsonb_typeof(v_etapa -> 'prazo_dias') <> 'null' THEN
      IF jsonb_typeof(v_etapa -> 'prazo_dias') <> 'number'
         OR (v_etapa -> 'prazo_dias') #>> '{}' !~ '^[0-9]{1,3}$' THEN
        RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF jsonb_typeof(v_etapa -> 'responsavel_id') IS NOT NULL
       AND jsonb_typeof(v_etapa -> 'responsavel_id') <> 'null' THEN
      IF jsonb_typeof(v_etapa -> 'responsavel_id') <> 'number'
         OR (v_etapa -> 'responsavel_id') #>> '{}' !~ '^[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'template_invalid' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  IF public.template_fingerprint(p_template_id) IS DISTINCT FROM p_template_fingerprint THEN
    RAISE EXCEPTION 'template_changed' USING ERRCODE = 'P0001';
  END IF;

  v_n := jsonb_array_length(v_tmpl.etapas);
  IF p_start_ordem IS NULL OR p_start_ordem < 0 OR p_start_ordem >= v_n THEN
    RAISE EXCEPTION 'invalid_start_ordem' USING ERRCODE = 'P0001';
  END IF;

  -- Exigencia estrutural do modo data_entrega (spec secao 7, Decisao 18): a
  -- sequencia a partir da inicial precisa ter ao menos uma etapa
  -- aprovacao_cliente. E checagem de FORMA, nao de data: le so 'tipo' do jsonb
  -- do template e nao reimplementa dias uteis nem clientes.dia_entrega em SQL,
  -- o que a secao 7 proibe. Vem depois de invalid_start_ordem, porque a regra e
  -- relativa a ordem inicial, e antes da validacao de p_step_overrides e de
  -- qualquer INSERT: template invalido nao cria linha nenhuma. Os demais modos
  -- ('padrao', 'data_fixa') ignoram a regra.
  IF coalesce(v_tmpl.modo_prazo, 'padrao') = 'data_entrega'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord)
        WHERE (e.ord - 1) >= p_start_ordem
          AND coalesce(nullif(e.val ->> 'tipo', ''), 'padrao') = 'aprovacao_cliente') THEN
    RAISE EXCEPTION 'data_entrega_requires_approval_step' USING ERRCODE = 'P0001';
  END IF;

  -- Validacao de p_step_overrides: objeto de objetos, chaves numericas dentro
  -- da sequencia e nao anteriores a inicial, e no maximo responsavel_id e
  -- prazo_efetivo dentro de cada uma.
  IF p_step_overrides IS NOT NULL THEN
    IF jsonb_typeof(p_step_overrides) <> 'object' THEN
      RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_step_overrides) LOOP
      -- FIX ROUND 1 (F2): sem zero a esquerda e ate 9 digitos, o que cabe com
      -- folga em integer. Cast protegido como em detach_posts_keeping_process
      -- (20260919000003): mesmo com a regex apertada, uma chave sem
      -- correspondencia cai aqui em vez de estourar erro cru.
      IF v_key !~ '^(0|[1-9][0-9]{0,8})$' THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        v_ordem := v_key::integer;
      EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END;
      IF v_ordem >= v_n OR v_ordem < p_start_ordem THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END IF;
      IF jsonb_typeof(v_val) <> 'object' THEN
        RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
      END IF;
      FOR v_chave IN SELECT jsonb_object_keys(v_val) LOOP
        IF v_chave NOT IN ('responsavel_id', 'prazo_efetivo') THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
      IF (v_val ->> 'prazo_efetivo') IS NOT NULL THEN
        BEGIN
          PERFORM (v_val ->> 'prazo_efetivo')::timestamptz;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END;
      END IF;
      IF (v_val ->> 'responsavel_id') IS NOT NULL THEN
        BEGIN
          v_resp := (v_val ->> 'responsavel_id')::bigint;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_step_overrides' USING ERRCODE = 'P0001';
        END;
        IF NOT EXISTS (SELECT 1 FROM membros m WHERE m.id = v_resp AND m.conta_id = v_conta) THEN
          RAISE EXCEPTION 'membro_not_found' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- A etapa inicial e a unica que precisa de prazo agora: e ela que fica ativa.
  IF (p_step_overrides -> p_start_ordem::text ->> 'prazo_efetivo') IS NULL THEN
    RAISE EXCEPTION 'start_deadline_required' USING ERRCODE = 'P0001';
  END IF;

  -- FIX ROUND 3. Nos modos data_fixa e data_entrega (spec 5.2, 7), o prazo
  -- resultante de CADA etapa e materializado no snapshot: nao basta a etapa
  -- inicial ter prazo_efetivo, toda etapa a partir dela precisa. O modo
  -- padrao continua exigindo so a inicial (checagem acima).
  IF coalesce(v_tmpl.modo_prazo, 'padrao') IN ('data_fixa', 'data_entrega') THEN
    FOR v_ordem IN p_start_ordem .. (v_n - 1) LOOP
      IF (p_step_overrides -> v_ordem::text ->> 'prazo_efetivo') IS NULL THEN
        RAISE EXCEPTION 'step_deadline_required' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  SELECT string_agg((e.ord - 1)::text || '|' || coalesce(e.val ->> 'nome', '')
                    || '|' || coalesce(nullif(e.val ->> 'tipo', ''), 'padrao'),
                    chr(10) ORDER BY e.ord)
    INTO v_assinatura
    FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord);

  -- Ativos e concluidos: sao os dois estados que aparecem no quadro. So os
  -- ativos deixaria um concluido reaberto colidindo com um processo novo na
  -- mesma posicao (Decisao 19). Encerrado nao aparece e nao entra no max.
  SELECT coalesce(max(pp.board_position), -1) + 1 INTO v_board
    FROM post_processes pp WHERE pp.conta_id = v_conta AND pp.estado IN ('ativo', 'concluido');

  INSERT INTO post_processes
    (conta_id, post_id, template_id, template_nome, assinatura, estado, etapa_atual,
     modo_prazo, board_position, created_by)
  VALUES
    (v_conta, p_post_id, p_template_id, v_tmpl.nome, v_assinatura, 'ativo', p_start_ordem,
     coalesce(v_tmpl.modo_prazo, 'padrao'), v_board, auth.uid())
  RETURNING id, revisao, estado INTO v_proc, v_revisao, v_estado;

  -- responsavel_id: override vence; senao o do template, mas so se ainda
  -- resolver para um membro da conta (um template pode carregar id de membro
  -- ja removido, e a FK composta derrubaria a operacao inteira).
  INSERT INTO post_process_steps
    (conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo,
     prazo_efetivo, estado, iniciado_em)
  SELECT
    v_conta, v_proc, (e.ord - 1)::integer,
    coalesce(e.val ->> 'nome', ''),
    coalesce(nullif(e.val ->> 'tipo', ''), 'padrao'),
    -- Override presente vence sempre, inclusive {"responsavel_id": null} para
    -- limpar o responsavel do template; so a AUSENCIA da chave herda do template.
    CASE WHEN (p_step_overrides -> (e.ord - 1)::text) ? 'responsavel_id'
         THEN (p_step_overrides -> (e.ord - 1)::text ->> 'responsavel_id')::bigint
         ELSE (SELECT m.id FROM membros m
                WHERE m.id = (e.val ->> 'responsavel_id')::bigint AND m.conta_id = v_conta)
    END,
    (e.val ->> 'prazo_dias')::integer,
    nullif(e.val ->> 'tipo_prazo', ''),
    (p_step_overrides -> (e.ord - 1)::text ->> 'prazo_efetivo')::timestamptz,
    CASE WHEN (e.ord - 1) < p_start_ordem THEN 'ignorado'
         WHEN (e.ord - 1) = p_start_ordem THEN 'ativo'
         ELSE 'pendente' END,
    CASE WHEN (e.ord - 1) = p_start_ordem THEN now() ELSE NULL END
    FROM jsonb_array_elements(v_tmpl.etapas) WITH ORDINALITY AS e(val, ord);

  PERFORM public.post_process_log_event(
    v_conta, p_post_id, v_proc, 'aplicado', NULL,
    jsonb_build_object('template_id', p_template_id, 'template_nome', v_tmpl.nome,
                       'start_ordem', p_start_ordem, 'etapa_atual', p_start_ordem));

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = v_proc) y;

  RETURN jsonb_build_object(
    'ok', true,
    'process_id', v_proc,
    'post_id', p_post_id,
    'estado', v_estado,
    'etapa_atual', p_start_ordem,
    'revisao', v_revisao,
    'assinatura', v_assinatura,
    'template_id', p_template_id,
    'template_nome', v_tmpl.nome,
    'steps', coalesce(v_steps, '[]'::jsonb));
END;
$function$;

-- transition_post_process
CREATE OR REPLACE FUNCTION public.transition_post_process(p_process_id bigint, p_expected_revisao integer, p_command text, p_approval_choice text DEFAULT NULL::text, p_expected_post_status text DEFAULT NULL::text, p_next_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta        uuid := public.post_process_require_editor();
  v_post_id      bigint;
  v_proc         record;
  v_status       text;
  v_novo_status  text;
  v_mudou_post   boolean := false;
  v_atual        record;
  v_prox         record;
  v_ant          record;
  v_liberado     boolean;
  v_estado       text;
  v_ponteiro     integer;
  v_revisao      integer;
  v_steps        jsonb;
BEGIN
  IF p_command IS NULL OR p_command NOT IN ('avancar', 'voltar', 'concluir', 'reabrir') THEN
    RAISE EXCEPTION 'invalid_command' USING ERRCODE = 'P0001';
  END IF;
  IF p_approval_choice IS NOT NULL
     AND p_approval_choice NOT IN ('aprovar_interno', 'sem_alterar', 'voltar_rascunho') THEN
    RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Leitura sem lock so para descobrir o post e travar na ordem da familia.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, ARRAY[v_post_id], 'process_not_found', 'P0001', false);

  SELECT wp.status INTO v_status FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.id, pp.post_id, pp.estado, pp.etapa_atual, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  v_estado   := v_proc.estado;
  v_ponteiro := v_proc.etapa_atual;

  IF p_command = 'reabrir' THEN
    IF v_proc.estado <> 'concluido' THEN
      RAISE EXCEPTION 'process_not_concluded' USING ERRCODE = 'P0001';
    END IF;
    -- Preserva iniciado_em e prazo_efetivo, inclusive vencidos. Divergencia
    -- deliberada em relacao a reopenWorkflow, que reinicia a contagem.
    UPDATE post_process_steps
       SET estado = 'ativo', concluido_em = NULL, iniciado_em = coalesce(iniciado_em, now())
     WHERE process_id = p_process_id AND ordem = v_proc.etapa_atual;
    v_estado := 'ativo';
    PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'reaberto',
      jsonb_build_object('estado', 'concluido'),
      jsonb_build_object('estado', 'ativo', 'etapa_atual', v_ponteiro));
  ELSE
    IF v_proc.estado <> 'ativo' THEN
      RAISE EXCEPTION 'process_not_active' USING ERRCODE = 'P0001';
    END IF;

    SELECT s.ordem, s.nome, s.tipo INTO v_atual
      FROM post_process_steps s
     WHERE s.process_id = p_process_id AND s.estado = 'ativo';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0001';
    END IF;

    -- PRE-CHECAGENS DE 'avancar', antes da arvore de aprovacao. Sem proxima
    -- etapa pendente o comando certo e 'concluir' (Decisao 12), e essa
    -- mensagem tem de chegar ao usuario antes de qualquer exigencia do
    -- dialogo de aprovacao.
    IF p_command = 'avancar' THEN
      SELECT s.ordem, s.nome, s.prazo_dias, s.prazo_efetivo INTO v_prox
        FROM post_process_steps s
       WHERE s.process_id = p_process_id AND s.ordem > v_atual.ordem AND s.estado = 'pendente'
       ORDER BY s.ordem LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no_next_step' USING ERRCODE = 'P0001';
      END IF;
      IF p_next_deadline IS NULL AND v_prox.prazo_efetivo IS NULL AND v_prox.prazo_dias IS NOT NULL THEN
        RAISE EXCEPTION 'next_deadline_required' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- PRE-CHECAGEM DE 'concluir' (Decisao 12, secao 5.5). Concluir e para a
    -- ultima etapa que importa: etapa de ordem maior ainda pendente derruba o
    -- comando antes de qualquer escrita e antes da arvore de aprovacao, para
    -- que "ainda ha etapas pendentes" chegue ao usuario antes de qualquer
    -- exigencia do dialogo. Estados herdado, ignorado, concluido e
    -- interrompido nao bloqueiam.
    IF p_command = 'concluir' AND EXISTS (
         SELECT 1 FROM post_process_steps s
          WHERE s.process_id = p_process_id AND s.ordem > v_atual.ordem
            AND s.estado = 'pendente') THEN
      RAISE EXCEPTION 'pending_steps_remaining' USING ERRCODE = 'P0001';
    END IF;

    -- ARVORE DE APROVACAO, compartilhada por 'avancar' e 'concluir'. Ver a
    -- nota do topo: a 5.5 manda concluir sobre etapa aprovacao_cliente abrir o
    -- mesmo dialogo do avancar. Sem re-arm automatico desde 20261023000002:
    -- voltar a rascunho e a escolha explicita 'voltar_rascunho'.
    IF p_command IN ('avancar', 'concluir') AND v_atual.tipo = 'aprovacao_cliente' THEN
      IF p_expected_post_status IS NULL THEN
        RAISE EXCEPTION 'expected_post_status_required' USING ERRCODE = 'P0001';
      END IF;
      IF p_expected_post_status IS DISTINCT FROM v_status THEN
        RAISE EXCEPTION 'post_changed' USING ERRCODE = 'P0001';
      END IF;

      v_liberado := v_status IN ('aprovado_cliente', 'agendado', 'postado', 'falha_publicacao');

      IF p_approval_choice = 'voltar_rascunho' THEN
        -- Concluir nao tem proximo ciclo para onde voltar.
        IF p_command = 'concluir' THEN
          RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
        END IF;
        IF v_status IN ('agendado', 'postado', 'falha_publicacao') THEN
          RAISE EXCEPTION 'post_locked' USING ERRCODE = 'P0001';
        END IF;
        IF v_status <> 'rascunho' THEN
          v_novo_status := 'rascunho';
        END IF;
      ELSIF NOT v_liberado THEN
        IF p_approval_choice IS NULL THEN
          RAISE EXCEPTION 'approval_choice_required' USING ERRCODE = 'P0001';
        END IF;
        IF p_approval_choice = 'aprovar_interno' AND v_status NOT IN ('agendado', 'postado') THEN
          v_novo_status := 'aprovado_cliente';
        END IF;
      END IF;

      IF v_novo_status IS NOT NULL THEN
        UPDATE workflow_posts SET status = v_novo_status
         WHERE id = v_post_id AND conta_id = v_conta;
        v_status := v_novo_status;
        v_mudou_post := true;
      END IF;
    END IF;

    IF p_command = 'concluir' THEN
      UPDATE post_process_steps SET estado = 'concluido', concluido_em = now()
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      v_estado := 'concluido';
      -- Ponteiro na etapa que ACABOU de ser concluida, nao no valor lido do
      -- processo: se os dois divergirem, reabrir reativaria a etapa errada.
      v_ponteiro := v_atual.ordem;
      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'concluido',
        jsonb_build_object('estado', 'ativo', 'etapa_atual', v_proc.etapa_atual,
                           'post_status', p_expected_post_status),
        jsonb_build_object('estado', 'concluido', 'etapa_atual', v_atual.ordem,
                           'post_status', v_status, 'approval_choice', p_approval_choice));

    ELSIF p_command = 'voltar' THEN
      SELECT s.ordem, s.nome INTO v_ant
        FROM post_process_steps s
       WHERE s.process_id = p_process_id AND s.ordem < v_atual.ordem
       ORDER BY s.ordem DESC LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'no_previous_step' USING ERRCODE = 'P0001';
      END IF;
      -- Uma etapa ativa por processo (indice parcial): a atual sai antes.
      UPDATE post_process_steps SET estado = 'pendente', iniciado_em = NULL
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      UPDATE post_process_steps
         SET estado = 'ativo', concluido_em = NULL, iniciado_em = coalesce(iniciado_em, now())
       WHERE process_id = p_process_id AND ordem = v_ant.ordem;
      v_ponteiro := v_ant.ordem;
      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'voltou',
        jsonb_build_object('etapa_ordem', v_atual.ordem, 'etapa_nome', v_atual.nome),
        jsonb_build_object('etapa_ordem', v_ant.ordem, 'etapa_nome', v_ant.nome));

    ELSE  -- avancar. v_prox e a arvore de aprovacao ja rodaram acima.
      UPDATE post_process_steps SET estado = 'concluido', concluido_em = now()
       WHERE process_id = p_process_id AND ordem = v_atual.ordem;
      UPDATE post_process_steps
         SET estado = 'ativo', iniciado_em = now(),
             prazo_efetivo = coalesce(p_next_deadline, prazo_efetivo)
       WHERE process_id = p_process_id AND ordem = v_prox.ordem;
      v_ponteiro := v_prox.ordem;

      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'avancou',
        jsonb_build_object('etapa_ordem', v_atual.ordem, 'etapa_nome', v_atual.nome,
                           'post_status', p_expected_post_status),
        jsonb_build_object('etapa_ordem', v_prox.ordem, 'etapa_nome', v_prox.nome,
                           'post_status', v_status, 'approval_choice', p_approval_choice));
    END IF;
  END IF;

  -- Este UPDATE toca a coluna estado, entao passa pelo trigger
  -- post_processes_requires_avulso. Em 'reabrir' (concluido -> ativo) o guard
  -- faz early-return, porque a condicao dele e old.estado = 'encerrado': nao e
  -- obvio, mas e o que faz reabrir nao precisar reler o post. O trigger
  -- set_post_process_concluido_em, endurecido na Task 2, limpa concluido_em em
  -- qualquer transicao para 'ativo' e carimba em 'concluido'.
  -- [escopo] automação de status que tira o post dele: mesmo 42501 do caminho direto
  PERFORM public.scope_check_posts(v_conta, ARRAY[v_post_id], 'client_scope_restricted', '42501', false);

  UPDATE post_processes
     SET estado = v_estado, etapa_atual = v_ponteiro, revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  SELECT jsonb_agg(to_jsonb(y) ORDER BY y.ordem) INTO v_steps FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em, s.concluido_em
      FROM post_process_steps s WHERE s.process_id = p_process_id) y;

  RETURN jsonb_build_object(
    'ok', true,
    'process_id', p_process_id,
    'post_id', v_post_id,
    'command', p_command,
    'estado', v_estado,
    'etapa_atual', v_ponteiro,
    'revisao', v_revisao,
    'post_status', v_status,
    'post_status_changed', v_mudou_post,
    'steps', coalesce(v_steps, '[]'::jsonb));
END;
$function$;

-- update_post_process_step
CREATE OR REPLACE FUNCTION public.update_post_process_step(p_process_id bigint, p_expected_revisao integer, p_ordem integer, p_responsavel_id bigint DEFAULT NULL::bigint, p_prazo_efetivo timestamp with time zone DEFAULT NULL::timestamp with time zone, p_prazo_dias integer DEFAULT NULL::integer, p_tipo_prazo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta   uuid := public.post_process_require_editor();
  v_post_id bigint;
  v_proc    record;
  v_step    record;
  v_revisao integer;
  v_novo    jsonb;
BEGIN
  IF p_tipo_prazo IS NOT NULL AND p_tipo_prazo NOT IN ('uteis', 'corridos') THEN
    RAISE EXCEPTION 'tipo_prazo_invalido' USING ERRCODE = 'P0001';
  END IF;
  -- Mesmo teto do input da UI (PostProductionSection.tsx MAX_PRAZO_DIAS):
  -- sem isso, um valor absurdo em 'uteis' trava computeDeadlineDate (loop
  -- de 1 iteracao por dia util) para qualquer um que abrir o board/drawer.
  IF p_prazo_dias IS NOT NULL AND (p_prazo_dias < 0 OR p_prazo_dias > 999) THEN
    RAISE EXCEPTION 'prazo_dias_invalido' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Leitura sem lock so para descobrir o post e travar na ordem da familia.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, ARRAY[v_post_id], 'process_not_found', 'P0001', false);

  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.id, pp.post_id, pp.estado, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- Etapa 'pendente'/'ativo' sozinha nao basta: remove deixa etapas futuras
  -- 'pendente' num processo ja encerrado, e sem esta guarda editar a etapa de
  -- uma execucao encerrada gravava responsavel/prazo, bumpava revisao e
  -- logava evento 'etapa_editada' num processo terminal. Mesmo codigo que
  -- transition_post_process ja usa para o mesmo caso.
  IF v_proc.estado <> 'ativo' THEN
    RAISE EXCEPTION 'process_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.ordem, s.nome, s.estado, s.responsavel_id, s.prazo_dias, s.tipo_prazo, s.prazo_efetivo
    INTO v_step
    FROM post_process_steps s
   WHERE s.process_id = p_process_id AND s.ordem = p_ordem;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_step.estado NOT IN ('pendente', 'ativo') THEN
    RAISE EXCEPTION 'step_not_editable' USING ERRCODE = 'P0001';
  END IF;

  IF p_responsavel_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM membros m WHERE m.id = p_responsavel_id AND m.conta_id = v_conta) THEN
    RAISE EXCEPTION 'membro_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE post_process_steps
     SET responsavel_id = p_responsavel_id,
         prazo_efetivo  = p_prazo_efetivo,
         prazo_dias     = p_prazo_dias,
         tipo_prazo     = p_tipo_prazo
   WHERE process_id = p_process_id AND ordem = p_ordem;

  UPDATE post_processes SET revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, v_proc.post_id, p_process_id, 'etapa_editada',
    jsonb_build_object('ordem', v_step.ordem, 'nome', v_step.nome,
                       'responsavel_id', v_step.responsavel_id, 'prazo_efetivo', v_step.prazo_efetivo,
                       'prazo_dias', v_step.prazo_dias, 'tipo_prazo', v_step.tipo_prazo),
    jsonb_build_object('ordem', v_step.ordem, 'nome', v_step.nome,
                       'responsavel_id', p_responsavel_id, 'prazo_efetivo', p_prazo_efetivo,
                       'prazo_dias', p_prazo_dias, 'tipo_prazo', p_tipo_prazo));

  SELECT to_jsonb(y) INTO v_novo FROM (
    SELECT s.process_id, s.ordem, s.nome, s.tipo, s.estado, s.responsavel_id,
           s.prazo_dias, s.tipo_prazo, s.prazo_efetivo, s.iniciado_em
      FROM post_process_steps s WHERE s.process_id = p_process_id AND s.ordem = p_ordem) y;

  RETURN jsonb_build_object('ok', true, 'process_id', p_process_id, 'ordem', p_ordem,
                            'revisao', v_revisao, 'step', v_novo);
END;
$function$;

-- resolve_post_process_rascunho_banner
CREATE OR REPLACE FUNCTION public.resolve_post_process_rascunho_banner(p_process_id bigint, p_expected_ciclo timestamp with time zone, p_reset boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta   uuid := public.post_process_require_editor();
  v_post_id bigint;
  v_proc    record;
  v_ativo   record;
  v_ciclo   timestamptz;
  v_n       integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Leitura sem lock so para descobrir o post e travar na ordem da familia.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, ARRAY[v_post_id], 'process_not_found', 'P0001', false);

  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.estado, pp.aviso_rascunho_dispensado_em INTO v_proc FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT max(s.concluido_em) INTO v_ciclo FROM post_process_steps s
   WHERE s.process_id = p_process_id
     AND s.tipo = 'aprovacao_cliente' AND s.estado = 'concluido';
  IF v_ciclo IS NULL OR v_ciclo IS DISTINCT FROM p_expected_ciclo THEN
    RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(p_reset, false) THEN
    -- Guardas do reset (ver o topo).
    IF v_proc.estado IS DISTINCT FROM 'ativo' THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    SELECT s.ordem, s.nome, s.tipo INTO v_ativo FROM post_process_steps s
     WHERE s.process_id = p_process_id AND s.estado = 'ativo';
    IF NOT FOUND OR v_ativo.tipo IS DISTINCT FROM 'padrao' THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM post_process_steps s
          WHERE s.process_id = p_process_id AND s.tipo = 'aprovacao_cliente'
            AND s.estado = 'pendente' AND s.ordem > v_ativo.ordem) THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    IF v_proc.aviso_rascunho_dispensado_em IS NOT NULL
       AND v_proc.aviso_rascunho_dispensado_em >= v_ciclo THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;

    UPDATE workflow_posts SET status = 'rascunho'
     WHERE id = v_post_id AND conta_id = v_conta
       AND status = 'aprovado_cliente';
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n > 0 THEN
      PERFORM public.post_process_log_event(v_conta, v_post_id, p_process_id, 'voltou_rascunho',
        jsonb_build_object('etapa_ordem', v_ativo.ordem, 'etapa_nome', v_ativo.nome,
                           'post_status', 'aprovado_cliente'),
        jsonb_build_object('etapa_ordem', v_ativo.ordem, 'etapa_nome', v_ativo.nome,
                           'post_status', 'rascunho', 'approval_choice', 'voltar_rascunho'));
    END IF;
  END IF;

  -- [escopo] automação de status que tira o post dele: mesmo 42501 do caminho direto
  PERFORM public.scope_check_posts(v_conta, ARRAY[v_post_id], 'client_scope_restricted', '42501', false);

  UPDATE post_processes SET aviso_rascunho_dispensado_em = now()
   WHERE id = p_process_id AND conta_id = v_conta;

  RETURN v_n > 0;
END;
$function$;

-- remove_post_process
CREATE OR REPLACE FUNCTION public.remove_post_process(p_process_id bigint, p_expected_revisao integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta   uuid := public.post_process_require_editor();
  v_post_id bigint;
  v_proc    record;
  v_revisao integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  -- Mesma leitura sem lock e mesma ordem post -> processo do update de etapa.
  SELECT pp.post_id INTO v_post_id FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, ARRAY[v_post_id], 'process_not_found', 'P0001', true);

  PERFORM 1 FROM workflow_posts wp
   WHERE wp.id = v_post_id AND wp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT pp.id, pp.post_id, pp.estado, pp.etapa_atual, pp.revisao INTO v_proc
    FROM post_processes pp
   WHERE pp.id = p_process_id AND pp.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'process_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.revisao IS DISTINCT FROM p_expected_revisao THEN
    RAISE EXCEPTION 'process_changed' USING ERRCODE = 'P0001';
  END IF;
  IF v_proc.estado = 'encerrado' THEN
    RAISE EXCEPTION 'process_already_closed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE post_process_steps
     SET estado = 'interrompido', interrompido_em = now()
   WHERE process_id = p_process_id AND estado = 'ativo';

  UPDATE post_processes
     SET estado = 'encerrado', motivo_encerramento = 'removido', revisao = revisao + 1
   WHERE id = p_process_id AND conta_id = v_conta
  RETURNING revisao INTO v_revisao;

  PERFORM public.post_process_log_event(v_conta, v_proc.post_id, p_process_id, 'removido',
    jsonb_build_object('estado', v_proc.estado, 'etapa_atual', v_proc.etapa_atual),
    jsonb_build_object('estado', 'encerrado', 'motivo_encerramento', 'removido'));

  RETURN jsonb_build_object('ok', true, 'process_id', p_process_id, 'post_id', v_proc.post_id,
                            'estado', 'encerrado', 'motivo_encerramento', 'removido',
                            'revisao', v_revisao);
END;
$function$;

-- advance_workflow_from_approval
CREATE OR REPLACE FUNCTION public.advance_workflow_from_approval(p_workflow_id bigint, p_expected_etapa_id bigint, p_choice text, p_expected_counts jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta     uuid;
  v_wf        record;
  v_atual     record;
  v_prox      record;
  v_tem_prox  boolean;
  v_actual    jsonb;
  v_divergiu  boolean;
  v_changed   integer := 0;
  v_status    text;
  v_ponteiro  integer;
BEGIN
  IF p_choice IS NULL OR p_choice NOT IN ('manter', 'aprovar_todos', 'voltar_rascunho') THEN
    RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
  END IF;

  v_conta := public.post_process_require_editor();

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT w.id, w.status INTO v_wf FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[p_workflow_id], 'workflow_not_found', 'P0001');
  -- Fluxo arquivado (move_posts_* arquiva a origem) pode guardar etapa ativa:
  -- um confirm velho nao pode concluir esse fluxo.
  IF v_wf.status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- workflow_etapas nao tem conta_id: o escopo vem do fluxo travado acima.
  SELECT e.id, e.ordem, e.tipo INTO v_atual FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo'
   ORDER BY e.ordem LIMIT 1
     FOR UPDATE;
  IF NOT FOUND OR v_atual.id IS DISTINCT FROM p_expected_etapa_id THEN
    RAISE EXCEPTION 'etapa_changed' USING ERRCODE = 'P0001';
  END IF;
  IF v_atual.tipo IS DISTINCT FROM 'aprovacao_cliente' THEN
    RAISE EXCEPTION 'not_approval_etapa' USING ERRCODE = 'P0001';
  END IF;

  SELECT e.id, e.ordem INTO v_prox FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id AND e.ordem > v_atual.ordem
   ORDER BY e.ordem LIMIT 1;
  v_tem_prox := FOUND;
  IF NOT v_tem_prox AND p_choice = 'voltar_rascunho' THEN
    RAISE EXCEPTION 'invalid_approval_choice' USING ERRCODE = 'P0001';
  END IF;

  IF p_choice IN ('aprovar_todos', 'voltar_rascunho') THEN
    IF p_expected_counts IS NULL OR jsonb_typeof(p_expected_counts) <> 'object' THEN
      RAISE EXCEPTION 'expected_counts_required' USING ERRCODE = 'P0001';
    END IF;

    -- Trava os posts do fluxo antes de contar (ver ORDEM DE LOCKS no topo).
    PERFORM 1 FROM workflow_posts wp
     WHERE wp.workflow_id = p_workflow_id AND wp.conta_id = v_conta
     ORDER BY wp.id
       FOR UPDATE;

    SELECT coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb) INTO v_actual
      FROM (SELECT wp.status, count(*) AS n FROM workflow_posts wp
             WHERE wp.workflow_id = p_workflow_id AND wp.conta_id = v_conta
             GROUP BY wp.status) c;

    -- Comparacao por chave sobre a uniao das chaves; ausente = 0. Igualdade
    -- de jsonb, entao valor nao numerico no esperado so diverge, sem erro de cast.
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT jsonb_object_keys(p_expected_counts) AS k
        UNION
        SELECT jsonb_object_keys(v_actual)) keys
       WHERE coalesce(p_expected_counts -> keys.k, '0'::jsonb)
             IS DISTINCT FROM coalesce(v_actual -> keys.k, '0'::jsonb))
      INTO v_divergiu;
    IF v_divergiu THEN
      RAISE EXCEPTION 'posts_changed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_choice = 'aprovar_todos' THEN
    UPDATE workflow_posts SET status = 'aprovado_cliente'
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta
       AND status NOT IN ('aprovado_cliente', 'agendado', 'postado', 'falha_publicacao');
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  ELSIF p_choice = 'voltar_rascunho' THEN
    UPDATE workflow_posts SET status = 'rascunho'
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta
       AND status NOT IN ('rascunho', 'agendado', 'postado', 'falha_publicacao');
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  -- Mesmas escritas de completeEtapa. Os triggers workflow_etapas_updated_event
  -- e notify_step_activated disparam sozinhos.
  UPDATE workflow_etapas SET status = 'concluido', concluido_em = now()
   WHERE id = v_atual.id;

  IF v_tem_prox THEN
    UPDATE workflow_etapas SET status = 'ativo', iniciado_em = now()
     WHERE id = v_prox.id;
    SELECT count(*) INTO v_ponteiro FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id AND e.ordem < v_prox.ordem;
    UPDATE workflows SET etapa_atual = v_ponteiro
     WHERE id = p_workflow_id
    RETURNING status INTO v_status;
  ELSE
    SELECT count(*) INTO v_ponteiro FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id AND e.ordem < v_atual.ordem;
    UPDATE workflows SET status = 'concluido', etapa_atual = v_ponteiro
     WHERE id = p_workflow_id
    RETURNING status INTO v_status;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'workflow_status', v_status,
    'etapa_atual', v_ponteiro,
    'posts_changed', v_changed);
END;
$function$;

-- resolve_workflow_rascunho_banner
CREATE OR REPLACE FUNCTION public.resolve_workflow_rascunho_banner(p_workflow_id bigint, p_expected_ciclo timestamp with time zone, p_reset boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.post_process_require_editor();
  v_wf    record;
  v_ativa record;
  v_ciclo timestamptz;
  v_n     integer := 0;
BEGIN
  -- Mesma ordem de locks de advance_workflow_from_approval.
  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT w.status, w.aviso_rascunho_dispensado_em INTO v_wf FROM workflows w
   WHERE w.id = p_workflow_id AND w.conta_id = v_conta
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[p_workflow_id], 'workflow_not_found', 'P0001');

  SELECT max(e.concluido_em) INTO v_ciclo FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id
     AND e.tipo = 'aprovacao_cliente' AND e.status = 'concluido';
  IF v_ciclo IS NULL OR v_ciclo IS DISTINCT FROM p_expected_ciclo THEN
    RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(p_reset, false) THEN
    -- Guardas do reset (ver o topo). Mesmo codigo do ciclo: o CRM trata como
    -- estado velho e recarrega.
    IF v_wf.status IS DISTINCT FROM 'ativo' THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    SELECT e.ordem, e.tipo INTO v_ativa FROM workflow_etapas e
     WHERE e.workflow_id = p_workflow_id AND e.status = 'ativo'
     ORDER BY e.ordem LIMIT 1;
    IF NOT FOUND OR v_ativa.tipo IS DISTINCT FROM 'padrao' THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM workflow_etapas e
          WHERE e.workflow_id = p_workflow_id AND e.tipo = 'aprovacao_cliente'
            AND e.status = 'pendente' AND e.ordem > v_ativa.ordem) THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;
    IF v_wf.aviso_rascunho_dispensado_em IS NOT NULL
       AND v_wf.aviso_rascunho_dispensado_em >= v_ciclo THEN
      RAISE EXCEPTION 'ciclo_changed' USING ERRCODE = 'P0001';
    END IF;

    UPDATE workflow_posts SET status = 'rascunho'
     WHERE workflow_id = p_workflow_id AND conta_id = v_conta
       AND status = 'aprovado_cliente';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  UPDATE workflows SET aviso_rascunho_dispensado_em = now()
   WHERE id = p_workflow_id;

  RETURN v_n;
END;
$function$;

-- migrate_workflow_template
CREATE OR REPLACE FUNCTION public.migrate_workflow_template(p_workflow_id bigint, p_template_id bigint, p_new_etapas jsonb, p_active_ordem integer, p_modo_prazo text, p_expected_template_id bigint, p_expected_etapa_atual integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_wf record;
  v_old_template_id bigint;
  v_n integer;
  v_i integer := 0;
  v_etapa jsonb;
  v_nome text;
  v_prazo integer;
  v_resp bigint;
  v_etapa_id bigint;
  v_active_id bigint;
  v_data_limite date;
  v_old_etapas jsonb;
  v_dropped_names text[] := '{}';
  v_dropped_values jsonb := '[]'::jsonb;
  v_legacy_approvals jsonb := '[]'::jsonb;
  -- workflow_events additions (Part A of 20260826000002)
  v_from_template_nome text;
  v_to_template_nome text;
  v_active_nome text;
  v_event_metadata jsonb;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  SELECT id, template_id, status, etapa_atual INTO v_wf
    FROM workflows
    WHERE id = p_workflow_id AND conta_id = v_conta
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_not_found'; END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[p_workflow_id], 'workflow_not_found', 'P0001');
  IF v_wf.template_id IS DISTINCT FROM p_expected_template_id
     OR v_wf.etapa_atual IS DISTINCT FROM p_expected_etapa_atual THEN
    RAISE EXCEPTION 'workflow_changed';
  END IF;
  IF v_wf.status <> 'ativo' THEN RAISE EXCEPTION 'workflow_not_active'; END IF;
  v_old_template_id := v_wf.template_id;

  -- migrar para o próprio template seria um no-op destrutivo (apagaria os
  -- timestamps da escada sem mudar nada); a UI nem oferece, a RPC também barra
  IF v_old_template_id IS NOT NULL AND p_template_id = v_old_template_id THEN
    RAISE EXCEPTION 'same_template';
  END IF;

  PERFORM 1 FROM workflow_templates WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;

  -- NULL explícito nos IFs: em plpgsql um IF com expressão NULL é pulado
  -- (lógica trivalente), então sem estas guardas um p_modo_prazo/p_active_ordem
  -- nulo atravessaria as validações e deixaria o fluxo sem etapa ativa
  IF p_modo_prazo IS NULL OR p_modo_prazo NOT IN ('padrao', 'data_fixa', 'data_entrega') THEN
    RAISE EXCEPTION 'invalid_modo_prazo';
  END IF;

  IF p_new_etapas IS NULL OR jsonb_typeof(p_new_etapas) <> 'array' THEN
    RAISE EXCEPTION 'empty_etapas';
  END IF;
  v_n := jsonb_array_length(p_new_etapas);
  IF v_n = 0 THEN RAISE EXCEPTION 'empty_etapas'; END IF;
  IF p_active_ordem IS NULL OR p_active_ordem < 0 OR p_active_ordem >= v_n THEN
    RAISE EXCEPTION 'invalid_active_ordem';
  END IF;

  -- Addition #1 (20260826000002): suppress Trigger A/B/C for the rest of
  -- this function's writes (etapa DELETE+reinsert, the re-activation
  -- UPDATE, and the final workflows UPDATE below). Transaction-local
  -- (third arg `true`) -- resets at COMMIT/ROLLBACK, never leaks to other
  -- transactions or connections.
  PERFORM set_config('app.suppress_workflow_events', '1', true);

  IF v_old_template_id IS NOT NULL AND v_old_template_id <> p_template_id THEN
    -- ---- 1. copia valores para as definições casadas do destino ----
    WITH m AS (
      SELECT DISTINCT ON (o.id)
             o.id AS old_id, o.display_order AS old_display_order, n.id AS new_id
      FROM template_property_definitions o
      JOIN template_property_definitions n
        ON n.template_id = p_template_id
       AND n.type = o.type
       AND lower(btrim(n.name, E' \t\r\n')) = lower(btrim(o.name, E' \t\r\n'))
      WHERE o.template_id = v_old_template_id
        AND o.type NOT IN ('select', 'multiselect', 'status')
      ORDER BY o.id, n.display_order, n.id
    )
    INSERT INTO post_property_values (post_id, property_definition_id, value)
    SELECT DISTINCT ON (pv.post_id, m.new_id) pv.post_id, m.new_id, pv.value
    FROM post_property_values pv
    JOIN m ON m.old_id = pv.property_definition_id
    WHERE pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id)
    ORDER BY pv.post_id, m.new_id, m.old_display_order, m.old_id
    ON CONFLICT (post_id, property_definition_id) DO NOTHING;

    -- ---- 2. snapshot do que se perde (órfãos + perdedores de conflito) ----
    WITH m AS (
      SELECT DISTINCT ON (o.id) o.id AS old_id, n.id AS new_id
      FROM template_property_definitions o
      JOIN template_property_definitions n
        ON n.template_id = p_template_id
       AND n.type = o.type
       AND lower(btrim(n.name, E' \t\r\n')) = lower(btrim(o.name, E' \t\r\n'))
      WHERE o.template_id = v_old_template_id
        AND o.type NOT IN ('select', 'multiselect', 'status')
      ORDER BY o.id, n.display_order, n.id
    ),
    perdas AS (
      SELECT pv.post_id, d.name, pv.value
      FROM post_property_values pv
      JOIN template_property_definitions d ON d.id = pv.property_definition_id
      LEFT JOIN m ON m.old_id = pv.property_definition_id
      WHERE d.template_id = v_old_template_id
        AND pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id)
        AND (m.new_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM post_property_values x
          WHERE x.post_id = pv.post_id
            AND x.property_definition_id = m.new_id
            AND x.value IS NOT DISTINCT FROM pv.value))
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'post_id', post_id, 'name', name, 'value', value)), '[]'::jsonb),
           coalesce(array_agg(DISTINCT name), '{}')
      INTO v_dropped_values, v_dropped_names
    FROM perdas;

    -- ---- 3. apaga todos os valores sob definições do template origem ----
    DELETE FROM post_property_values pv
    USING template_property_definitions d
    WHERE d.id = pv.property_definition_id
      AND d.template_id = v_old_template_id
      AND pv.post_id IN (SELECT id FROM workflow_posts WHERE workflow_id = p_workflow_id);

    -- ---- 4. select options do template origem (tipos de opção nunca casam) ----
    DELETE FROM workflow_select_options wso
    USING template_property_definitions d
    WHERE d.id = wso.property_definition_id
      AND d.template_id = v_old_template_id
      AND wso.workflow_id = p_workflow_id;
  END IF;

  -- ---- 5. arquiva portal_approvals legadas antes da cascata ----
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'portal_approval_id', pa.id,
           'workflow_etapa_id', pa.workflow_etapa_id,
           'etapa_nome', we.nome,
           'action', pa.action,
           'comentario', pa.comentario,
           'created_at', pa.created_at)), '[]'::jsonb)
    INTO v_legacy_approvals
  FROM portal_approvals pa
  JOIN workflow_etapas we ON we.id = pa.workflow_etapa_id
  WHERE we.workflow_id = p_workflow_id;

  -- ---- 6. escada ----
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.ordem), '[]'::jsonb) INTO v_old_etapas
  FROM workflow_etapas e WHERE e.workflow_id = p_workflow_id;

  DELETE FROM workflow_etapas WHERE workflow_id = p_workflow_id;

  FOR v_etapa IN SELECT * FROM jsonb_array_elements(p_new_etapas) LOOP
    v_nome := btrim(coalesce(v_etapa->>'nome', ''));
    IF v_nome = '' THEN RAISE EXCEPTION 'invalid_etapa'; END IF;

    BEGIN
      v_prazo := (v_etapa->>'prazo_dias')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_etapa';
    END;
    IF v_prazo IS NULL OR v_prazo < 0 THEN RAISE EXCEPTION 'invalid_etapa'; END IF;

    IF coalesce(v_etapa->>'tipo_prazo', '') NOT IN ('uteis', 'corridos') THEN
      RAISE EXCEPTION 'invalid_etapa';
    END IF;
    IF coalesce(v_etapa->>'tipo', 'padrao') NOT IN ('padrao', 'aprovacao_cliente') THEN
      RAISE EXCEPTION 'invalid_etapa';
    END IF;

    BEGIN
      v_resp := NULLIF(v_etapa->>'responsavel_id', '')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_responsavel';
    END;
    IF v_resp IS NOT NULL THEN
      PERFORM 1 FROM membros WHERE id = v_resp AND conta_id = v_conta;
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_responsavel'; END IF;
    END IF;

    BEGIN
      v_data_limite := NULLIF(v_etapa->>'data_limite', '')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_etapa';
    END;

    -- a etapa ativa entra como 'pendente' e é ativada por UPDATE no fim do loop,
    -- para o trigger notify_step_activated (AFTER UPDATE) disparar
    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
       status, iniciado_em, concluido_em, data_limite)
    VALUES
      (p_workflow_id, v_i, v_nome, v_prazo, v_etapa->>'tipo_prazo', v_resp,
       coalesce(v_etapa->>'tipo', 'padrao'),
       CASE WHEN v_i < p_active_ordem THEN 'concluido' ELSE 'pendente' END,
       NULL, NULL,
       v_data_limite)
    RETURNING id INTO v_etapa_id;
    IF v_i = p_active_ordem THEN v_active_id := v_etapa_id; END IF;
    v_i := v_i + 1;
  END LOOP;

  UPDATE workflow_etapas
  SET status = 'ativo', iniciado_em = now()
  WHERE id = v_active_id;

  -- ---- 7. workflow ----
  UPDATE workflows
  SET template_id = p_template_id, etapa_atual = p_active_ordem, modo_prazo = p_modo_prazo
  WHERE id = p_workflow_id;

  -- ---- 8. auditoria ----
  INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (v_conta, auth.uid(), 'workflow.template_migrated', 'workflow', p_workflow_id::text,
    jsonb_build_object(
      'from_template_id', v_old_template_id,
      'to_template_id', p_template_id,
      'modo_prazo', p_modo_prazo,
      'active_ordem', p_active_ordem,
      'old_etapas', v_old_etapas,
      'dropped_property_names', to_jsonb(v_dropped_names),
      'dropped_property_values', v_dropped_values,
      'legacy_portal_approvals', v_legacy_approvals));

  -- ---- 9. workflow_events: template_migrado (Addition #2, 20260826000002) ----
  -- Best-effort, mirrors the trigger philosophy in 20260826000001: a
  -- failure recording this summary event must never fail or roll back the
  -- migration itself, so it is isolated in its own exception block,
  -- separate from the rest of the function.
  BEGIN
    v_from_template_nome := NULL;
    IF v_old_template_id IS NOT NULL THEN
      SELECT nome INTO v_from_template_nome
      FROM workflow_templates
      WHERE id = v_old_template_id AND conta_id = v_conta;
    END IF;

    v_to_template_nome := NULL;
    SELECT nome INTO v_to_template_nome
    FROM workflow_templates
    WHERE id = p_template_id AND conta_id = v_conta;

    v_active_nome := NULL;
    SELECT nome INTO v_active_nome FROM workflow_etapas WHERE id = v_active_id;

    v_event_metadata := jsonb_build_object(
      'from_template_id', v_old_template_id,
      'to_template_id', p_template_id,
      'modo_prazo', p_modo_prazo,
      'active_ordem', p_active_ordem
    );
    IF v_from_template_nome IS NOT NULL THEN
      v_event_metadata := v_event_metadata || jsonb_build_object('from_template_nome', v_from_template_nome);
    END IF;
    IF v_to_template_nome IS NOT NULL THEN
      v_event_metadata := v_event_metadata || jsonb_build_object('to_template_nome', v_to_template_nome);
    END IF;

    PERFORM record_workflow_event(
      p_workflow_id, v_conta, 'template_migrado', v_active_id, v_active_nome, v_event_metadata
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'migrate_workflow_template: failed to record template_migrado event for workflow %: %', p_workflow_id, SQLERRM;
  END;
END;
$function$;

-- duplicate_post
CREATE OR REPLACE FUNCTION public.duplicate_post(p_post_id bigint, p_to_rascunho boolean)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_wf    bigint;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission_for(auth.uid(), v_conta, 'entregas', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT wp.workflow_id INTO v_wf
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = v_conta
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] post que ele não lê = mesmo erro de inexistente
  PERFORM public.scope_check_posts(v_conta, ARRAY[p_post_id], 'not_found', 'P0001', true);

  RETURN public._clone_post_row(v_conta, p_post_id, v_wf, coalesce(p_to_rascunho, false), '{}'::jsonb, true);
END;
$function$;

-- duplicate_workflow
CREATE OR REPLACE FUNCTION public.duplicate_workflow(p_workflow_id bigint, p_to_rascunho boolean)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  w       workflows%ROWTYPE;
  v_new   bigint;
  o       record;
  v_opt   uuid;
  v_map   jsonb := '{}'::jsonb;
  p       record;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF public.has_permission_for(auth.uid(), v_conta, 'entregas', 'editar') IS NOT TRUE THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'));

  SELECT * INTO w FROM workflows
   WHERE id = p_workflow_id AND conta_id = v_conta
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;
  -- [escopo] fluxo é escrita estrita (policy de UPDATE de workflows)
  PERFORM public.scope_check_workflows(v_conta, ARRAY[p_workflow_id], 'not_found', 'P0001');

  -- Logo depois do original: empurrar todos os posteriores da conta preserva a
  -- ordem relativa em todas as colunas. position nao gera evento.
  -- Fluxos e cards de processo avulso dividem UM espaco de indices por coluna
  -- (reorder_fluxos_board, 20260919000008), entao os dois sao empurrados; so
  -- ativo/concluido viram card, mesmo filtro da RPC de reordenar.
  UPDATE workflows SET position = position + 1
   WHERE conta_id = v_conta AND position > w.position;
  UPDATE post_processes SET board_position = board_position + 1
   WHERE conta_id = v_conta AND estado IN ('ativo', 'concluido')
     AND board_position > w.position;

  INSERT INTO workflows (
    user_id, conta_id, cliente_id, titulo, template_id, status, etapa_atual,
    recorrente, position, modo_prazo, link_notion, link_drive, concluido_em,
    created_via, plataformas)
  VALUES (
    auth.uid(), v_conta, w.cliente_id, w.titulo || ' (cópia)', w.template_id,
    w.status, w.etapa_atual, w.recorrente,
    w.position + 1,
    w.modo_prazo, w.link_notion, w.link_drive, w.concluido_em, 'human',
    w.plataformas)
  RETURNING id INTO v_new;

  INSERT INTO workflow_etapas (
    workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
    status, iniciado_em, concluido_em, data_limite)
  SELECT v_new, e.ordem, e.nome, e.prazo_dias, e.tipo_prazo, e.responsavel_id,
         e.tipo, e.status, e.iniciado_em, e.concluido_em, e.data_limite
    FROM workflow_etapas e
   WHERE e.workflow_id = w.id
   ORDER BY e.ordem, e.id;

  -- Futuras pelo template (20261021120000): origem com etapas duplicadas nao
  -- passa o defeito para a copia.
  PERFORM public._realign_pending_etapas_to_template(v_new);

  -- workflow_select_options so tem RLS pelo conta_id da propria linha: filtrar
  -- por conta (e pela definicao) impede copiar linha forjada por outra conta.
  FOR o IN
    SELECT wso.* FROM workflow_select_options wso
     WHERE wso.workflow_id = w.id
       AND wso.conta_id = v_conta
       AND EXISTS (SELECT 1 FROM template_property_definitions d
                    WHERE d.id = wso.property_definition_id AND d.conta_id = v_conta)
     ORDER BY wso.id
  LOOP
    INSERT INTO workflow_select_options (workflow_id, property_definition_id, conta_id, label, color)
    VALUES (v_new, o.property_definition_id, v_conta, o.label, o.color)
    RETURNING option_id INTO v_opt;
    v_map := v_map || jsonb_build_object(o.option_id::text, v_opt::text);
  END LOOP;

  FOR p IN
    SELECT id FROM workflow_posts
     WHERE workflow_id = w.id AND conta_id = v_conta
     ORDER BY ordem, id
  LOOP
    PERFORM public._clone_post_row(v_conta, p.id, v_new, coalesce(p_to_rascunho, false), v_map, false);
  END LOOP;

  RETURN v_new;
END;
$function$;

-- update_workflow_template
CREATE OR REPLACE FUNCTION public.update_workflow_template(p_template_id bigint, p_nome text, p_etapas jsonb, p_modo_prazo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_old jsonb;
  v_nome text := btrim(p_nome);
  v_e jsonb;
  v_resp_raw text;
  v_wf record;
  v_etapa record;
  v_old_e jsonb;
  v_new_e jsonb;
  -- template antigo, normalizado
  o_nome text; o_prazo integer; o_prazo_ok boolean; o_tp text;
  o_resp bigint; o_resp_ok boolean; o_tipo text;
  -- template novo, normalizado (ja validado)
  n_nome text; n_prazo integer; n_tp text; n_resp bigint; n_tipo text;
  -- valores a gravar na etapa
  w_nome text; w_prazo integer; w_tp text; w_resp bigint; w_tipo text;
  v_changes jsonb;
  v_wf_changes jsonb;
  v_updated bigint[];   -- ids das etapas reescritas (merge e/ou ordem)
  v_inserted integer;
  v_removed integer;
  v_rows integer;
  v_n_new integer;
  v_n_old integer;
  -- p_etapas com os nomes aparados: e o que se grava e o que se propaga
  v_etapas jsonb;
  -- alinhamento template antigo -> novo
  v_old_nomes text[];
  v_new_nomes text[];
  v_tmap int[];      -- v_tmap[j+1] = posicao antiga da posicao nova j, ou NULL
  v_inv int[];       -- v_inv[i+1]  = posicao nova da posicao antiga i, ou NULL
  -- etapas do fluxo (ordem, id)
  f_id bigint[];
  f_nome text[];
  f_fmap int[];      -- f_fmap[r] = posicao antiga casada com a linha r, ou NULL
  v_covered boolean[];  -- posicao nova ja tem linha do fluxo
  -- itens da escada final: linha existente (id) ou nova (posicao j do template)
  it_id bigint[];
  it_j int[];
  it_key bigint[];
  it_status text[];
  v_r int;
  v_oi int;
  v_tj int;
  v_pred_j int;
  v_deletable boolean;
  v_active_pos int;
  v_new_atual int;
  v_item record;
  v_new_id bigint;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  -- Trava a linha do template: dois saves do mesmo template serializam, e cada um
  -- faz o merge contra a versao que o outro gravou.
  SELECT etapas INTO v_old
  FROM workflow_templates
  WHERE id = p_template_id AND conta_id = v_conta
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;
  -- [escopo] a propagação reescreve as etapas de todo fluxo ativo do modelo
  PERFORM public.scope_check_template_workflows(v_conta, p_template_id);

  -- ---------- validacao (toda checagem trata NULL explicitamente) ----------
  IF coalesce(v_nome, '') = '' THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;
  IF p_modo_prazo IS NULL OR p_modo_prazo NOT IN ('padrao', 'data_fixa', 'data_entrega') THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;
  IF p_etapas IS NULL OR jsonb_typeof(p_etapas) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_etapas) = 0 THEN
    RAISE EXCEPTION 'template_invalid';
  END IF;

  FOR v_e IN SELECT value FROM jsonb_array_elements(p_etapas) LOOP
    IF jsonb_typeof(v_e) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF jsonb_typeof(v_e -> 'nome') IS DISTINCT FROM 'string'
       OR public.trim_etapa_nome(v_e ->> 'nome') = '' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    -- inteiro 0..999 como numero JSON (mesma regra de apply_post_process)
    IF jsonb_typeof(v_e -> 'prazo_dias') IS DISTINCT FROM 'number'
       OR (v_e -> 'prazo_dias') #>> '{}' !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF (v_e ->> 'tipo_prazo') IS NOT NULL
       AND (v_e ->> 'tipo_prazo') NOT IN ('uteis', 'corridos') THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    IF (v_e ->> 'tipo') IS NOT NULL
       AND (v_e ->> 'tipo') NOT IN ('padrao', 'aprovacao_cliente') THEN
      RAISE EXCEPTION 'template_invalid';
    END IF;
    -- responsavel precisa ser membro DESTE workspace: workflow_etapas.responsavel_id
    -- so tem FK global, e esta funcao e SECURITY DEFINER. Mesma forma estrita de
    -- apply_post_process (20260920000011): so JSON number (ou null/ausente)
    -- passam aqui; uma string como "5" ou "" e invalid_responsavel, mesmo sendo
    -- numerica. O lado OLD-template abaixo continua lenient (regex sobre ->>),
    -- porque le valores salvos sem essa validacao.
    IF jsonb_typeof(v_e -> 'responsavel_id') IS NOT NULL
       AND jsonb_typeof(v_e -> 'responsavel_id') <> 'null' THEN
      IF jsonb_typeof(v_e -> 'responsavel_id') <> 'number'
         OR (v_e -> 'responsavel_id') #>> '{}' !~ '^[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'invalid_responsavel';
      END IF;
      v_resp_raw := (v_e -> 'responsavel_id') #>> '{}';
      PERFORM 1 FROM membros WHERE id = v_resp_raw::bigint AND conta_id = v_conta;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_responsavel';
      END IF;
    END IF;
  END LOOP;

  -- validado acima: todo elemento e objeto com nome string nao vazio
  SELECT jsonb_agg(jsonb_set(e, '{nome}', to_jsonb(public.trim_etapa_nome(e ->> 'nome'))) ORDER BY o)
    INTO v_etapas
    FROM jsonb_array_elements(p_etapas) WITH ORDINALITY AS x(e, o);

  -- ---------- salva o template ----------
  UPDATE workflow_templates
  SET nome = v_nome, etapas = v_etapas, modo_prazo = p_modo_prazo
  WHERE id = p_template_id;

  v_n_new := jsonb_array_length(v_etapas);
  v_new_nomes := ARRAY(SELECT e ->> 'nome' FROM jsonb_array_elements(v_etapas) WITH ORDINALITY AS x(e, o) ORDER BY o);

  -- Template antigo ilegivel (nao-array): finge um antigo do tamanho do novo, sem
  -- nenhum nome. O alinhamento vira posicional e nenhuma posicao tem valor antigo,
  -- entao nada e mesclado nem removido; so as posicoes que faltam sao criadas.
  IF jsonb_typeof(v_old) = 'array' THEN
    v_n_old := jsonb_array_length(v_old);
    v_old_nomes := ARRAY(
      SELECT CASE WHEN jsonb_typeof(e) = 'object' THEN e ->> 'nome' END
      FROM jsonb_array_elements(v_old) WITH ORDINALITY AS x(e, o) ORDER BY o);
  ELSE
    v_n_old := v_n_new;
    v_old_nomes := array_fill(NULL::text, ARRAY[v_n_new]);
  END IF;

  v_tmap := public._align_etapa_nomes(v_old_nomes, v_new_nomes);
  v_inv := array_fill(NULL::int, ARRAY[greatest(v_n_old, 1)]);
  FOR v_tj IN 0..v_n_new - 1 LOOP
    IF v_tmap[v_tj + 1] IS NOT NULL THEN
      v_inv[v_tmap[v_tj + 1] + 1] := v_tj;
    END IF;
  END LOOP;

  -- Suprime Triggers A/B/C nas escritas de etapa abaixo (transaction-local).
  PERFORM set_config('app.suppress_workflow_events', '1', true);

  -- ---------- propagacao ----------
  -- conta_id no cursor e a fronteira de tenant obrigatoria (template_id e FK global).
  FOR v_wf IN
    SELECT id FROM workflows
    WHERE template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
    ORDER BY id
  LOOP
    -- Re-checa sob lock (serializa contra migrate_workflow_template).
    PERFORM 1 FROM workflows
      WHERE id = v_wf.id AND template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
      FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_updated := '{}';
    v_inserted := 0;
    v_removed := 0;
    v_wf_changes := '[]'::jsonb;

    -- FOR UPDATE em TODAS as etapas ANTES de comparar: updateWorkflowEtapa no CRM
    -- escreve workflow_etapas direto, sem tocar a linha do fluxo. Com o lock, uma
    -- edicao manual concorrente ou commita antes (e este cursor le o valor novo) ou
    -- espera. Todas, nao so pendente/ativo: a renumeracao mexe nas concluidas.
    PERFORM 1 FROM workflow_etapas WHERE workflow_id = v_wf.id FOR UPDATE;
    SELECT coalesce(array_agg(id ORDER BY ordem, id), '{}'),
           coalesce(array_agg(nome ORDER BY ordem, id), '{}')
      INTO f_id, f_nome
      FROM workflow_etapas WHERE workflow_id = v_wf.id;

    f_fmap := public._align_etapa_nomes(v_old_nomes, f_nome);
    v_covered := array_fill(false, ARRAY[v_n_new]);
    it_id := '{}'; it_j := '{}'; it_key := '{}'; it_status := '{}';
    v_pred_j := -1;

    FOR v_r IN 1..coalesce(array_length(f_id, 1), 0) LOOP
      SELECT id, ordem, status, nome, prazo_dias, tipo_prazo, responsavel_id, tipo,
             iniciado_em, concluido_em, data_limite
        INTO v_etapa FROM workflow_etapas WHERE id = f_id[v_r];
      v_oi := f_fmap[v_r];
      v_tj := CASE WHEN v_oi IS NOT NULL THEN v_inv[v_oi + 1] END;
      v_old_e := CASE WHEN jsonb_typeof(v_old) = 'array' AND v_oi IS NOT NULL THEN v_old -> v_oi END;

      -- ---- posicao antiga removida do template: sai se herdada e intocada ----
      IF v_oi IS NOT NULL AND v_tj IS NULL THEN
        v_deletable := jsonb_typeof(v_old_e) = 'object'
          AND public.trim_etapa_nome(v_etapa.nome)
              IS NOT DISTINCT FROM public.trim_etapa_nome(v_old_e ->> 'nome')
          AND v_etapa.status IN ('pendente', 'concluido')
          AND v_etapa.iniciado_em IS NULL
          AND v_etapa.concluido_em IS NULL
          AND NOT EXISTS (SELECT 1 FROM portal_approvals pa WHERE pa.workflow_etapa_id = v_etapa.id)
          AND NOT EXISTS (SELECT 1 FROM workflow_events ev
                          WHERE ev.workflow_id = v_wf.id AND ev.etapa_id = v_etapa.id);
        IF v_deletable THEN
          DELETE FROM workflow_etapas WHERE id = v_etapa.id AND status = v_etapa.status;
          GET DIAGNOSTICS v_rows = ROW_COUNT;
          IF v_rows > 0 THEN
            v_removed := v_removed + 1;
            -- 'de' e o snapshot inteiro: o evento e o registro para desfazer o save.
            v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
              'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'removida',
              'de', jsonb_build_object(
                'nome', v_etapa.nome, 'prazo_dias', v_etapa.prazo_dias,
                'tipo_prazo', v_etapa.tipo_prazo, 'responsavel_id', v_etapa.responsavel_id,
                'tipo', v_etapa.tipo, 'data_limite', v_etapa.data_limite),
              'para', NULL));
            CONTINUE;
          END IF;
        END IF;
      END IF;

      IF v_tj IS NULL THEN
        -- ---- etapa propria: logo depois da etapa que vinha antes dela ----
        it_id := it_id || v_etapa.id;
        it_j := it_j || NULL::int;
        it_key := it_key || ((v_pred_j + 1)::bigint * 1000000 + 100000 + v_r);
        it_status := it_status || v_etapa.status;
        CONTINUE;
      END IF;

      -- ---- etapa casada: vai para a posicao nova v_tj ----
      v_pred_j := v_tj;
      v_covered[v_tj + 1] := true;
      it_id := it_id || v_etapa.id;
      it_j := it_j || v_tj;
      it_key := it_key || ((v_tj + 1)::bigint * 1000000);
      it_status := it_status || v_etapa.status;

      CONTINUE WHEN v_etapa.status NOT IN ('pendente', 'ativo');
      CONTINUE WHEN v_old_e IS NULL OR jsonb_typeof(v_old_e) <> 'object';  -- sem valor antigo: tudo conta como customizado
      v_new_e := v_etapas -> v_tj;

      -- antigo, com guardas (nunca cast cru no lado armazenado)
      o_nome := public.trim_etapa_nome(v_old_e ->> 'nome');
      o_prazo_ok := (v_old_e ->> 'prazo_dias') ~ '^[0-9]{1,9}$';
      o_prazo := CASE WHEN o_prazo_ok THEN (v_old_e ->> 'prazo_dias')::integer END;
      o_prazo_ok := coalesce(o_prazo_ok, false);
      o_tp := coalesce(v_old_e ->> 'tipo_prazo', 'corridos');
      v_resp_raw := NULLIF(v_old_e ->> 'responsavel_id', '');
      o_resp_ok := v_resp_raw IS NULL OR v_resp_raw ~ '^[0-9]{1,18}$';
      o_resp := CASE WHEN v_resp_raw ~ '^[0-9]{1,18}$' THEN v_resp_raw::bigint END;
      o_tipo := coalesce(v_old_e ->> 'tipo', 'padrao');

      -- novo (validado acima)
      n_nome := v_new_e ->> 'nome';
      n_prazo := (v_new_e ->> 'prazo_dias')::integer;
      n_tp := coalesce(v_new_e ->> 'tipo_prazo', 'corridos');
      n_resp := NULLIF(v_new_e ->> 'responsavel_id', '')::bigint;
      n_tipo := coalesce(v_new_e ->> 'tipo', 'padrao');

      w_nome := v_etapa.nome;
      w_prazo := v_etapa.prazo_dias;
      w_tp := v_etapa.tipo_prazo;
      w_resp := v_etapa.responsavel_id;
      w_tipo := v_etapa.tipo;
      v_changes := '[]'::jsonb;

      IF n_nome IS DISTINCT FROM o_nome
         AND public.trim_etapa_nome(v_etapa.nome) IS NOT DISTINCT FROM o_nome THEN
        w_nome := n_nome;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'nome',
          'de', to_jsonb(v_etapa.nome), 'para', to_jsonb(n_nome)));
      END IF;

      IF o_prazo_ok
         AND (n_prazo, n_tp) IS DISTINCT FROM (o_prazo, o_tp)
         AND (v_etapa.prazo_dias, coalesce(v_etapa.tipo_prazo, 'corridos'))
             IS NOT DISTINCT FROM (o_prazo, o_tp) THEN
        w_prazo := n_prazo;
        w_tp := n_tp;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'prazo',
          'de', jsonb_build_object('prazo_dias', v_etapa.prazo_dias, 'tipo_prazo', v_etapa.tipo_prazo),
          'para', jsonb_build_object('prazo_dias', n_prazo, 'tipo_prazo', n_tp)));
      END IF;

      IF o_resp_ok
         AND n_resp IS DISTINCT FROM o_resp
         AND v_etapa.responsavel_id IS NOT DISTINCT FROM o_resp THEN
        w_resp := n_resp;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'responsavel_id',
          'de', to_jsonb(v_etapa.responsavel_id), 'para', to_jsonb(n_resp)));
      END IF;

      -- 'ativo': nunca toca tipo (gate de aprovacao em andamento).
      IF v_etapa.status = 'pendente'
         AND n_tipo IS DISTINCT FROM o_tipo
         AND coalesce(v_etapa.tipo, 'padrao') = o_tipo THEN
        w_tipo := n_tipo;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_etapa.id, 'ordem', v_etapa.ordem, 'campo', 'tipo',
          'de', to_jsonb(v_etapa.tipo), 'para', to_jsonb(n_tipo)));
      END IF;

      IF jsonb_array_length(v_changes) > 0 THEN
        UPDATE workflow_etapas
        SET nome = w_nome, prazo_dias = w_prazo, tipo_prazo = w_tp,
            responsavel_id = w_resp, tipo = w_tipo
        WHERE id = v_etapa.id AND status = v_etapa.status;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows > 0 THEN
          v_updated := v_updated || v_etapa.id;
          v_wf_changes := v_wf_changes || v_changes;
        END IF;
      END IF;
    END LOOP;

    -- posicoes novas sem linha no fluxo
    FOR v_tj IN 0..v_n_new - 1 LOOP
      CONTINUE WHEN v_covered[v_tj + 1];
      it_id := it_id || NULL::bigint;
      it_j := it_j || v_tj;
      it_key := it_key || ((v_tj + 1)::bigint * 1000000);
      it_status := it_status || NULL::text;
    END LOOP;

    -- ---------- escada final: ordem 0..n-1 ----------
    SELECT min(pos) INTO v_active_pos
    FROM (SELECT s, row_number() OVER (ORDER BY k) - 1 AS pos
          FROM unnest(it_key, it_status) AS u(k, s)) q
    WHERE s = 'ativo';

    v_new_atual := NULL;
    FOR v_item IN
      SELECT u.id, u.j, (row_number() OVER (ORDER BY u.k) - 1)::int AS pos
      FROM unnest(it_id, it_j, it_key) AS u(id, j, k)
      ORDER BY u.k
    LOOP
      IF v_item.id IS NULL THEN
        v_new_e := v_etapas -> v_item.j;
        INSERT INTO workflow_etapas
          (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id,
           tipo, status, iniciado_em, concluido_em, data_limite)
        VALUES
          (v_wf.id, v_item.pos, v_new_e ->> 'nome', (v_new_e ->> 'prazo_dias')::integer,
           coalesce(v_new_e ->> 'tipo_prazo', 'corridos'),
           NULLIF(v_new_e ->> 'responsavel_id', '')::bigint,
           coalesce(v_new_e ->> 'tipo', 'padrao'),
           CASE WHEN v_item.pos < v_active_pos THEN 'concluido' ELSE 'pendente' END,
           NULL, NULL, NULL)
        RETURNING id INTO v_new_id;
        v_inserted := v_inserted + 1;
        v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
          'etapa_id', v_new_id, 'ordem', v_item.pos, 'campo', 'criada',
          'de', NULL,
          'para', jsonb_build_object(
            'nome', v_new_e ->> 'nome',
            'status', CASE WHEN v_item.pos < v_active_pos THEN 'concluido' ELSE 'pendente' END)));
      ELSE
        SELECT ordem INTO v_rows FROM workflow_etapas WHERE id = v_item.id;
        IF v_rows IS DISTINCT FROM v_item.pos THEN
          UPDATE workflow_etapas SET ordem = v_item.pos WHERE id = v_item.id;
          IF NOT v_item.id = ANY (v_updated) THEN
            v_updated := v_updated || v_item.id;
          END IF;
          v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
            'etapa_id', v_item.id, 'ordem', v_rows, 'campo', 'ordem',
            'de', v_rows, 'para', v_item.pos));
        END IF;
      END IF;
    END LOOP;

    -- etapa_atual acompanha a ativa (o board e o avanco leem por ela)
    IF v_active_pos IS NOT NULL THEN
      UPDATE workflows SET etapa_atual = v_active_pos
      WHERE id = v_wf.id AND etapa_atual IS DISTINCT FROM v_active_pos
      RETURNING etapa_atual INTO v_new_atual;
      IF v_new_atual IS NOT NULL THEN
        v_wf_changes := v_wf_changes || jsonb_build_array(jsonb_build_object(
          'campo', 'etapa_atual', 'para', v_new_atual));
      END IF;
    END IF;

    -- Transacional de proposito (sem EXCEPTION): este evento e o registro de undo.
    IF jsonb_array_length(v_wf_changes) > 0 THEN
      PERFORM record_workflow_event(
        v_wf.id, v_conta, 'template_propagado', NULL, NULL,
        jsonb_build_object(
          'template_id', p_template_id,
          'template_nome', v_nome,
          'etapas_atualizadas', coalesce(array_length(v_updated, 1), 0),
          'etapas_criadas', v_inserted,
          'etapas_removidas', v_removed,
          'alteracoes', v_wf_changes
        )
      );
    END IF;
  END LOOP;
END;
$function$;

-- propagate_template_to_workflows
CREATE OR REPLACE FUNCTION public.propagate_template_to_workflows(p_template_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_etapas jsonb;
  v_template_nome text;
  v_wf record;
  v_inserted_count integer;
BEGIN
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  SELECT etapas, nome INTO v_etapas, v_template_nome
  FROM workflow_templates
  WHERE id = p_template_id AND conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;
  -- [escopo] a propagação cria etapas em todo fluxo ativo do modelo
  PERFORM public.scope_check_template_workflows(v_conta, p_template_id);

  IF jsonb_typeof(v_etapas) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;

  PERFORM set_config('app.suppress_workflow_events', '1', true);

  FOR v_wf IN
    SELECT id FROM workflows
    WHERE template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
  LOOP
    PERFORM 1 FROM workflows
      WHERE id = v_wf.id AND template_id = p_template_id AND conta_id = v_conta AND status = 'ativo'
      FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO workflow_etapas
      (workflow_id, ordem, nome, prazo_dias, tipo_prazo, responsavel_id,
       tipo, status, iniciado_em, concluido_em, data_limite)
    SELECT v_wf.id,
           (t.idx - 1)::integer,
           t.etapa ->> 'nome',
           (t.etapa ->> 'prazo_dias')::integer,
           coalesce(t.etapa ->> 'tipo_prazo', 'corridos'),
           NULLIF(t.etapa ->> 'responsavel_id', '')::bigint,
           coalesce(t.etapa ->> 'tipo', 'padrao'),
           'pendente', NULL, NULL, NULL
    FROM jsonb_array_elements(v_etapas) WITH ORDINALITY AS t(etapa, idx)
    WHERE jsonb_typeof(t.etapa) = 'object'
      AND NOT EXISTS (
        SELECT 1 FROM workflow_etapas we
        WHERE we.workflow_id = v_wf.id AND we.ordem = (t.idx - 1)::integer
      );
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count > 0 THEN
      BEGIN
        PERFORM record_workflow_event(
          v_wf.id, v_conta, 'template_propagado', NULL, NULL,
          jsonb_build_object(
            'template_id', p_template_id,
            'template_nome', v_template_nome,
            'etapas_atualizadas', 0,
            'etapas_criadas', v_inserted_count
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'propagate_template_to_workflows: failed to record template_propagado event for workflow %: %', v_wf.id, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$function$;

-- tarefa_serie_aplicar_edicao
CREATE OR REPLACE FUNCTION public.tarefa_serie_aplicar_edicao(p_tarefa_id bigint, p_tarefa jsonb, p_tag_ids bigint[], p_regra jsonb, p_encerrar boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
  v_t record;
  v_s record;
  v_data date;
  v_fim date;
  v_resp bigint;
  v_cli bigint;
  v_tags bigint[];
  v_subs text[];
  v_titulo text;
  v_descricao text;
  v_rich jsonb;
  v_dias int[];
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;

  -- (0) lock the occurrence and the series; effective due date up front
  SELECT id, serie_id, data_limite, cliente_id, responsavel_id, user_id INTO v_t
    FROM tarefas WHERE id = p_tarefa_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada neste workspace.'; END IF;
  IF NOT public.my_client_scope_all()
     AND NOT (public.can_access_cliente(v_t.cliente_id)
                OR coalesce(v_t.responsavel_id = ANY (public.my_membro_ids()), false)
                OR v_t.user_id = v_user) THEN
    RAISE EXCEPTION 'Tarefa não encontrada neste workspace.';
  END IF;
  IF v_t.serie_id IS NULL THEN RAISE EXCEPTION 'Esta tarefa não pertence a uma série.'; END IF;
  SELECT cliente_id, responsavel_id, user_id INTO v_s
    FROM tarefa_series WHERE id = v_t.serie_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Série não encontrada neste workspace.'; END IF;
  -- a edição reescreve o modelo da série: a série também tem de ser visível
  IF NOT public.my_client_scope_all()
     AND NOT (public.can_access_cliente(v_s.cliente_id)
                OR coalesce(v_s.responsavel_id = ANY (public.my_membro_ids()), false)
                OR v_s.user_id = v_user) THEN
    RAISE EXCEPTION 'Série não encontrada neste workspace.';
  END IF;
  -- Effective due date. An OMITTED key keeps the stored value. A key present
  -- with JSON null is an explicit "clear the prazo": honoured only when the
  -- occurrence is being detached from the series (p_encerrar, "Nao repete"),
  -- because a series occurrence must have a prazo; otherwise it raises.
  IF p_tarefa ? 'data_limite' THEN
    v_data := (p_tarefa->>'data_limite')::date;
  ELSE
    v_data := v_t.data_limite;
  END IF;
  IF v_data IS NULL AND NOT p_encerrar THEN
    RAISE EXCEPTION 'Tarefas de uma série precisam de prazo.';
  END IF;

  v_resp := (p_tarefa->>'responsavel_id')::bigint;
  v_cli := (p_tarefa->>'cliente_id')::bigint;
  PERFORM tarefa_serie_validar_refs(v_conta, v_resp, v_cli);
  -- item dele: editar sim, realocar nunca (origem e destino acessíveis), nem se
  -- pôr como responsável num cliente que ele não acessa
  IF NOT public.my_client_scope_all() THEN
    IF (v_cli IS DISTINCT FROM v_t.cliente_id
          AND NOT (((v_t.cliente_id IS NULL
                      AND (v_t.user_id IS NOT DISTINCT FROM v_user
                           OR coalesce(v_t.responsavel_id = ANY (public.my_membro_ids()), false)))
                     OR public.can_access_cliente(v_t.cliente_id))
                   AND public.can_access_cliente(v_cli)))
       OR (NOT p_encerrar AND v_cli IS DISTINCT FROM v_s.cliente_id
          AND NOT (((v_s.cliente_id IS NULL
                      AND (v_s.user_id IS NOT DISTINCT FROM v_user
                           OR coalesce(v_s.responsavel_id = ANY (public.my_membro_ids()), false)))
                     OR public.can_access_cliente(v_s.cliente_id))
                   AND public.can_access_cliente(v_cli)))
       OR (v_resp IS DISTINCT FROM v_t.responsavel_id AND coalesce(v_resp = ANY (public.my_membro_ids()), false)
          AND NOT public.can_access_cliente(v_cli)) THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
    END IF;
    -- [escopo] entregar a outro a ocorrência (ou a série) dele num cliente oculto: a
    -- [escopo] linha sairia da visão dele, e o UPDATE direto já falha com 42501
    IF NOT (public.can_access_cliente(v_cli)
            OR coalesce(v_resp = ANY (public.my_membro_ids()), false)
            OR v_t.user_id IS NOT DISTINCT FROM v_user)
       OR (NOT p_encerrar
           AND NOT (public.can_access_cliente(v_cli)
                    OR coalesce(v_resp = ANY (public.my_membro_ids()), false)
                    OR v_s.user_id IS NOT DISTINCT FROM v_user)) THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT coalesce(array_agg(t.id ORDER BY t.id), '{}') INTO v_tags
    FROM tarefa_tags t WHERE t.id = ANY (coalesce(p_tag_ids, '{}')) AND t.conta_id = v_conta;
  SELECT coalesce(array_agg(titulo ORDER BY ordem, id), '{}') INTO v_subs
    FROM subtarefas WHERE tarefa_id = p_tarefa_id AND btrim(titulo) <> '';
  v_titulo := btrim(coalesce(p_tarefa->>'titulo', ''));
  v_descricao := NULLIF(btrim(coalesce(p_tarefa->>'descricao', '')), '');
  v_rich := NULLIF(p_tarefa->'descricao_rich', 'null'::jsonb);

  -- (1) series first, so the completion trigger in (2) sees the new template / closed series
  IF p_encerrar THEN
    UPDATE tarefa_series SET encerrada_em = coalesce(encerrada_em, now()) WHERE id = v_t.serie_id;
  ELSE
    v_fim := (p_regra->>'fim')::date;
    v_dias := tarefa_serie_parse_dias_semana(p_regra->'dias_semana');
    IF v_fim IS NOT NULL AND v_fim < v_data THEN
      RAISE EXCEPTION 'A data final precisa ser igual ou depois do prazo.';
    END IF;
    UPDATE tarefa_series
       SET freq = p_regra->>'freq',
           intervalo = coalesce((p_regra->>'intervalo')::int, 1),
           dias_semana = v_dias,
           dia_mes = (p_regra->>'dia_mes')::int,
           mes = (p_regra->>'mes')::int,
           modo = p_regra->>'modo',
           inicio = v_data,          -- re-anchors the phase; dia_mes/mes come from p_regra
           fim = v_fim,
           titulo = v_titulo, descricao = v_descricao, descricao_rich = v_rich,
           responsavel_id = v_resp, cliente_id = v_cli,
           tag_ids = v_tags, subtarefas = to_jsonb(v_subs)
     WHERE id = v_t.serie_id;
  END IF;

  -- (2) the occurrence (status included: the completion trigger fires here).
  -- In the p_encerrar branch serie_id = NULL and a NULL data_limite land in the
  -- same UPDATE, so tarefas_serie_exige_prazo (serie_id IS NULL OR data_limite
  -- IS NOT NULL) is satisfied: the row is a standalone task by then.
  UPDATE tarefas
     SET titulo = v_titulo, descricao = v_descricao, descricao_rich = v_rich,
         status = coalesce(p_tarefa->>'status', status),
         responsavel_id = v_resp, cliente_id = v_cli, data_limite = v_data,
         serie_id = CASE WHEN p_encerrar THEN NULL ELSE serie_id END
   WHERE id = p_tarefa_id;

  -- (3) tags of this occurrence; its subtasks are untouched
  DELETE FROM tarefa_tag_links WHERE tarefa_id = p_tarefa_id;
  INSERT INTO tarefa_tag_links (tarefa_id, tag_id, conta_id)
  SELECT p_tarefa_id, t, v_conta FROM unnest(v_tags) t;

  -- (4) an ao_concluir series whose last occurrence is already completed and
  -- whose rule / fim / modo just changed would otherwise stay dormant: the
  -- completion trigger only fires on the status transition. No-op when an open
  -- occurrence exists, the series is paused or ended, or the next date is past fim.
  IF NOT p_encerrar THEN
    PERFORM tarefa_serie_garantir_aberta(v_t.serie_id, v_data);
  END IF;
END;
$function$;

-- -------------------------------------------------------------
-- 2. Pós-condições
-- -------------------------------------------------------------
DO $$
DECLARE
  f text;
  acl text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.scope_check_posts(uuid, bigint[], text, text, boolean)',
    'public.scope_check_workflows(uuid, bigint[], text, text)',
    'public.scope_check_processes(uuid, bigint[], boolean)',
    'public.scope_check_template_workflows(uuid, bigint)'] LOOP
    SELECT array_to_string(proacl, ',') INTO acl FROM pg_proc WHERE oid = f::regprocedure;
    IF acl IS NULL OR acl NOT LIKE '%service_role=X%' THEN
      RAISE EXCEPTION '%: service_role lacks EXECUTE — acl=%', f, acl;
    END IF;
    IF acl LIKE '%authenticated=X%' OR acl LIKE '%anon=X%' OR acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
      RAISE EXCEPTION '%: unexpected EXECUTE grant — acl=%', f, acl;
    END IF;
  END LOOP;
  -- o helper da discussão continua fora do alcance de authenticated
  IF has_function_privilege('authenticated', 'public.post_discussao_post_do_chamador(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post_discussao_post_do_chamador: authenticated can EXECUTE';
  END IF;
END $$;
