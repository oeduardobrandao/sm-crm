-- =====================================================================
-- 20261111000001_ig_story_user_tags.sql
-- Menções no Stories do Instagram (Graph `user_tags` sem x/y: a conta é
-- marcada sem sticker na mídia; suportado desde 2025-07-09).
--
-- 1) Helper ig_user_tags_valid(text[]): mesma regra de username de
--    ig_collaborators_valid, com no máximo 10 contas.
-- 2) workflow_posts.ig_user_tags + CHECK.
-- 3) workflow_posts_clear_ig_trial(): zera ig_user_tags fora de stories ou
--    quando o post deixa de ir para o Instagram. Corpo copiado de
--    20261019000001_ig_collaborators.sql com UMA edição (o bloco de
--    ig_user_tags). Este arquivo passa a ser a definição canônica.
-- 4) _clone_post_row: copia ig_user_tags (INSERT e re-apply do UPDATE).
--    Corpo copiado de 20261019000001_ig_collaborators.sql (canônica). Este
--    arquivo passa a ser a definição canônica.
--
-- claim_posts_for_publishing NÃO muda: o publicador lê ig_user_tags na hora
-- de criar os containers de cada segmento (createMissingStorySegmentContainers).
-- =====================================================================

-- ACCESS EXCLUSIVE em workflow_posts (ADD COLUMN + CHECK que varre a tabela):
-- desiste em 5s em vez de enfileirar o tráfego atrás do ALTER.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1) Helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ig_user_tags_valid(p text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- COALESCE: um CHECK passa em NULL (desconhecido), então qualquer entrada
  -- ruim, inclusive NULL, tem de virar false aqui.
  SELECT COALESCE(
    p IS NOT NULL
    AND cardinality(p) <= 10
    AND array_position(p, NULL) IS NULL
    AND NOT EXISTS (SELECT 1 FROM unnest(p) x WHERE x !~ '^[a-z0-9._]{1,30}$')
    AND cardinality(p) = (SELECT count(DISTINCT x) FROM unnest(p) x),
    false);
$$;

-- ---------------------------------------------------------------------
-- 2) Coluna + CHECK
-- ---------------------------------------------------------------------
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS ig_user_tags text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN workflow_posts.ig_user_tags IS
  'Usernames do Instagram (sem @, minúsculos) mencionados no Stories via user_tags, sem sticker. Só vale em tipo stories mirando Instagram. No máximo 10, sem repetição.';

ALTER TABLE workflow_posts
  ADD CONSTRAINT workflow_posts_ig_user_tags_valid
  CHECK (ig_user_tags_valid(ig_user_tags));

-- ---------------------------------------------------------------------
-- 3) Trigger de invariante (workflow_posts_z5_clear_ig_trial, nome mantido)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workflow_posts_clear_ig_trial()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ig_trial_strategy IS NOT NULL
     AND (NEW.tipo <> 'reels'
          OR COALESCE(NEW.platform, 'instagram') NOT IN ('instagram', 'both')) THEN
    NEW.ig_trial_strategy := NULL;
  END IF;
  IF NEW.tipo = 'stories'
     OR COALESCE(NEW.platform, 'instagram') NOT IN ('instagram', 'both') THEN
    NEW.ig_collaborators := '{}';
  END IF;
  IF NEW.tipo IS DISTINCT FROM 'stories'
     OR COALESCE(NEW.platform, 'instagram') NOT IN ('instagram', 'both') THEN
    NEW.ig_user_tags := '{}';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.ig_collaborators IS DISTINCT FROM OLD.ig_collaborators THEN
    NEW.ig_collaborators_refused := '{}';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 4) _clone_post_row
-- ---------------------------------------------------------------------
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
  v_prev     text := current_setting('app.post_targets_sync', true);
  v_derived  text;
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
    ig_trial_strategy, ig_collaborators, ig_user_tags, is_express, scheduled_at, board_ordem,
    created_via)
  VALUES (
    p_target_workflow_id, p_conta, s.cliente_id,
    s.titulo || CASE WHEN p_solo THEN ' (cópia)' ELSE '' END,
    s.conteudo, s.conteudo_plain, s.tipo,
    v_ordem, v_status, v_custom, s.responsavel_id, s.platform, s.ig_caption,
    s.music_note, s.cover_url, s.tiktok_caption, s.tiktok_title, s.tiktok_settings,
    s.ig_trial_strategy, s.ig_collaborators, s.ig_user_tags, s.is_express, s.scheduled_at, v_board,
    'human')
  RETURNING id INTO v_new;

  -- Destinos da origem (P1): troca os que z6 semeou pelo quadro pelos da
  -- origem, só platform e format, e re-deriva platform. GUC ligado: o sync de
  -- post_targets e o a2 não mexem na linha; o UPDATE abaixo grava o derivado.
  -- caption/title/settings do destino ficam de fora DE PROPÓSITO em P1 (nada
  -- os grava ainda); rever quando o editor de Destinos de P2 passar a gravá-los.
  PERFORM set_config('app.post_targets_sync', 'on', true);
  DELETE FROM post_targets WHERE post_id = v_new;
  INSERT INTO post_targets (conta_id, post_id, platform, format)
  SELECT p_conta, v_new, t.platform, t.format
    FROM post_targets t
   WHERE t.post_id = s.id AND t.conta_id = p_conta
     -- stories nunca vai para o TikTok, mesmo que a origem legada carregue o destino
     AND NOT (s.tipo = 'stories' AND t.platform = 'tiktok')
   ORDER BY t.id;
  v_derived := public.derive_post_platform(v_new);
  -- Se o quadro não lista Instagram, o z4b derivou outro platform no INSERT e
  -- o z5 limpou o trial, os colaboradores e as menções; com o Instagram da
  -- origem de volta, os três voltam juntos (o z5 roda de novo neste UPDATE e
  -- ainda limpa se não for Instagram).
  UPDATE workflow_posts SET platform = v_derived, ig_trial_strategy = s.ig_trial_strategy,
         ig_collaborators = s.ig_collaborators, ig_user_tags = s.ig_user_tags
   WHERE id = v_new AND platform IS DISTINCT FROM v_derived;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);

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

