-- supabase/migrations/20261002000020_duplicate_post.sql
-- Duplicar post (spec docs/superpowers/specs/2026-10-02-duplicate-posts-fluxos-design.md).
--
-- _remap_option_value: troca option_ids de select/multiselect/status pelo mapa
--   que a copia de fluxo monta (option_id e UNIQUE global, entao o fluxo novo
--   precisa de ids novos). Select guarda o option_id como string; multiselect,
--   como array de strings.
-- _clone_post_row: a copia de UM post, compartilhada por duplicate_post e
--   duplicate_workflow. p_solo = true e o "Duplicar post" (sufixo, logo depois
--   do original, processo clonado); false e um post dentro da copia de fluxo
--   (sem sufixo, mesma ordem, sem ranque no quadro).
-- duplicate_post: a RPC do botao.
--
-- SECURITY DEFINER porque post_processes/post_process_steps recusam INSERT de
-- authenticated. A checagem de conta e de permissao e explicita no comeco.
-- Status: agendado/postado/falha_publicacao viram aprovado_cliente no modo
-- "manter" (o clone nunca publica sozinho: auto-publicacao so roda em
-- hub-approve). scheduled_at e mantido; o servidor recusa agendar com menos
-- de 10 minutos de antecedencia (validateForScheduling), entao uma data antiga
-- obriga a escolher outra.

CREATE OR REPLACE FUNCTION public._remap_option_value(p_value jsonb, p_map jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_map IS NULL OR p_map = '{}'::jsonb THEN p_value
    WHEN jsonb_typeof(p_value) = 'string'
      THEN coalesce(p_map -> (p_value #>> '{}'), p_value)
    WHEN jsonb_typeof(p_value) = 'array' THEN (
      SELECT coalesce(
               jsonb_agg(
                 CASE WHEN jsonb_typeof(t.e) = 'string'
                      THEN coalesce(p_map -> (t.e #>> '{}'), t.e)
                      ELSE t.e END
                 ORDER BY t.i),
               '[]'::jsonb)
        FROM jsonb_array_elements(p_value) WITH ORDINALITY AS t(e, i))
    ELSE p_value
  END
$$;

REVOKE ALL ON FUNCTION public._remap_option_value(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._remap_option_value(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._clone_post_row(
  p_conta              uuid,
  p_src_post_id        bigint,
  p_target_workflow_id bigint,
  p_to_rascunho        boolean,
  p_option_map         jsonb,
  p_solo               boolean
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s          workflow_posts%ROWTYPE;
  v_status   text;
  v_custom   uuid;
  v_ordem    integer;
  v_board    double precision := NULL;
  v_next     double precision;
  v_mid      double precision;
  v_new      bigint;
  pp         post_processes%ROWTYPE;
  v_proc     bigint;
  v_pos      integer;
BEGIN
  SELECT * INTO s FROM workflow_posts WHERE id = p_src_post_id AND conta_id = p_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_to_rascunho THEN
    v_status := 'rascunho';            v_custom := NULL;
  ELSIF s.status IN ('agendado', 'postado', 'falha_publicacao') THEN
    v_status := 'aprovado_cliente';    v_custom := NULL;
  ELSE
    v_status := s.status;              v_custom := s.custom_status_id;
  END IF;

  IF p_solo THEN
    -- Logo depois do original. Avulso nao tem irmaos ordenados (createAvulsoPost
    -- grava ordem 0), entao so posts de fluxo empurram os seguintes.
    v_ordem := s.ordem + CASE WHEN s.workflow_id IS NULL THEN 0 ELSE 1 END;
    IF s.workflow_id IS NOT NULL THEN
      UPDATE workflow_posts
         SET ordem = ordem + 1
       WHERE conta_id = p_conta AND workflow_id = s.workflow_id AND ordem > s.ordem;
    END IF;

    -- Quadro de Publicacoes: so ranqueia quando o original tem ranque e o clone
    -- cai na MESMA coluna (mesmo status e status customizado). Senao, null:
    -- entra na cauda automatica da coluna (postsBoardOrder.ts).
    IF s.board_ordem IS NOT NULL
       AND v_status = s.status
       AND v_custom IS NOT DISTINCT FROM s.custom_status_id THEN
      SELECT min(wp.board_ordem) INTO v_next
        FROM workflow_posts wp
       WHERE wp.conta_id = p_conta
         AND wp.status = v_status
         AND wp.custom_status_id IS NOT DISTINCT FROM v_custom
         AND wp.board_ordem > s.board_ordem;
      IF v_next IS NULL THEN
        v_board := s.board_ordem + 1024;
      ELSE
        v_mid := (s.board_ordem + v_next) / 2;
        IF v_mid > s.board_ordem AND v_mid < v_next THEN
          v_board := v_mid;
        END IF;
      END IF;
    END IF;
  ELSE
    v_ordem := s.ordem;
  END IF;

  INSERT INTO workflow_posts (
    workflow_id, conta_id, cliente_id, titulo, conteudo, conteudo_plain, tipo,
    ordem, status, custom_status_id, responsavel_id, platform, ig_caption,
    music_note, cover_url, tiktok_caption, tiktok_title, tiktok_settings,
    ig_trial_strategy, is_express, scheduled_at, board_ordem, created_via)
  VALUES (
    p_target_workflow_id, p_conta, s.cliente_id,
    s.titulo || CASE WHEN p_solo THEN ' (cópia)' ELSE '' END,
    s.conteudo, s.conteudo_plain, s.tipo,
    v_ordem, v_status, v_custom, s.responsavel_id, s.platform, s.ig_caption,
    s.music_note, s.cover_url, s.tiktok_caption, s.tiktok_title, s.tiktok_settings,
    s.ig_trial_strategy, s.is_express, s.scheduled_at, v_board, 'human')
  RETURNING id INTO v_new;

  -- Midia: mesmos arquivos (reference_count sobe por trigger). Capa primeiro,
  -- para o auto-cover nao escolher outra.
  INSERT INTO post_file_links (post_id, file_id, conta_id, sort_order, is_cover, origin)
  SELECT v_new, l.file_id, l.conta_id, l.sort_order, true, l.origin
    FROM post_file_links l
   WHERE l.post_id = s.id AND l.is_cover;
  INSERT INTO post_file_links (post_id, file_id, conta_id, sort_order, is_cover, origin)
  SELECT v_new, l.file_id, l.conta_id, l.sort_order, false, l.origin
    FROM post_file_links l
   WHERE l.post_id = s.id AND NOT l.is_cover
   ORDER BY l.sort_order, l.id;

  -- Propriedades: opcoes por fluxo passam pelo mapa (vazio na copia de post).
  INSERT INTO post_property_values (post_id, property_definition_id, value)
  SELECT v_new, v.property_definition_id,
         CASE WHEN d.type IN ('select', 'multiselect', 'status')
              THEN public._remap_option_value(v.value, p_option_map)
              ELSE v.value END
    FROM post_property_values v
    JOIN template_property_definitions d ON d.id = v.property_definition_id
   WHERE v.post_id = s.id;

  -- Processo do post individual: so na copia de post avulso e com a feature
  -- ligada (o trigger trg_feature_post_processes recusaria o INSERT).
  IF p_solo AND s.workflow_id IS NULL
     AND effective_plan_feature(p_conta, 'feature_post_processes') THEN
    SELECT * INTO pp FROM post_processes
     WHERE post_id = s.id AND conta_id = p_conta AND estado IN ('ativo', 'concluido');
    IF FOUND THEN
      -- Fim da coluna, como apply_post_process: empurrar os outros mexeria em
      -- linhas que o quadro aberto de outra pessoa esta vendo.
      SELECT coalesce(max(x.board_position), -1) + 1 INTO v_pos
        FROM post_processes x WHERE x.conta_id = p_conta;
      INSERT INTO post_processes (
        conta_id, post_id, template_id, template_nome, assinatura,
        origem_workflow_id, origem_descricao, estado, etapa_atual, modo_prazo,
        board_position, revisao, created_by, concluido_em)
      VALUES (
        p_conta, v_new, pp.template_id, pp.template_nome, pp.assinatura,
        pp.origem_workflow_id, pp.origem_descricao, pp.estado, pp.etapa_atual,
        pp.modo_prazo, v_pos, 1, auth.uid(), pp.concluido_em)
      RETURNING id INTO v_proc;

      INSERT INTO post_process_steps (
        conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias,
        tipo_prazo, prazo_efetivo, estado, iniciado_em, concluido_em,
        interrompido_em, origem_etapa_ordem, origem_etapa_nome)
      SELECT p_conta, v_proc, st.ordem, st.nome, st.tipo, st.responsavel_id,
             st.prazo_dias, st.tipo_prazo, st.prazo_efetivo, st.estado,
             st.iniciado_em, st.concluido_em, st.interrompido_em,
             st.origem_etapa_ordem, st.origem_etapa_nome
        FROM post_process_steps st
       WHERE st.process_id = pp.id
       ORDER BY st.ordem;
    END IF;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public._clone_post_row(uuid, bigint, bigint, boolean, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._clone_post_row(uuid, bigint, bigint, boolean, jsonb, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.duplicate_post(p_post_id bigint, p_to_rascunho boolean)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  RETURN public._clone_post_row(v_conta, p_post_id, v_wf, coalesce(p_to_rascunho, false), '{}'::jsonb, true);
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_post(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_post(bigint, boolean) TO authenticated, service_role;
