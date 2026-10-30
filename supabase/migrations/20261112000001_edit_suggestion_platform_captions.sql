-- =====================================================================
-- Sugestões de edição nas legendas de TikTok e Geral (PR 2).
-- Spec: docs/superpowers/specs/2026-10-30-hub-captions-per-platform-design.md, "PR 2",
-- itens 1 a 5. Invariantes: docs/superpowers/specs/2026-10-29-edit-suggestion-no-auto-reject-design.md.
--
-- Campos lógicos (p_touched_fields, p_fields, p_acknowledged) e onde moram:
--   texto           conteudo + conteudo_plain   workflow_posts (como antes)
--   legenda         ig_caption                  workflow_posts (como antes)
--   legenda_tiktok  tiktok_caption              workflow_posts
--   legenda_geral   geral_caption               post_targets.caption da linha 'geral'
--
-- 1. post_edit_suggestions ganha original_/suggested_tiktok_caption,
--    original_/suggested_geral_caption, geral_target_id (o post_targets.id da linha
--    geral quando legenda_geral entrou em changed_fields: linha removida e recriada
--    é target_gone, nunca herda a sugestão) e tiktok_followed_ig (o TikTok seguia o
--    Instagram, tiktok_caption nulo, quando legenda entrou em changed_fields).
-- 2. upsert_edit_suggestion: DROP + CREATE com p_suggested_captions jsonb no fim
--    ({"tiktok_caption": ..., "geral_caption": ...}). Ramo legado (p_touched_fields
--    nulo) não toca os campos novos e preserva em changed_fields as entradas
--    tiktok_caption/geral_caption de um Hub novo. Ordem de locks: post -> linha
--    geral -> sugestão.
-- 3. accept_edit_suggestion: mesma assinatura; aplica os campos novos, recusa
--    target_gone / target_locked, e com p_fields nulo e campo novo mudado levanta
--    suggestion_conflict (CRM antigo).
-- 4. Histórico de versões da legenda Geral: post_content_versions.geral_caption,
--    record_post_content_version grava o Geral atual, trigger novo em post_targets
--    (SECURITY DEFINER: authenticated não tem INSERT em post_content_versions).
--    Um aceite = uma versão (ver o accept).
-- 5. Grants reafirmados (upsert só service_role; accept authenticated + service_role).
--
-- Deadlock: post_targets_sync_platform faz post_targets -> workflow_posts num DELETE
-- de destino pelo PostgREST, o inverso da ordem daqui. As RPCs são seguras para
-- repetir; hub-edit-suggestion e o CRM tratam 40P01 como "tente de novo".
-- =====================================================================

-- ADD COLUMN e CREATE TRIGGER pedem lock forte: desiste em 5s em vez de enfileirar.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------
ALTER TABLE public.post_edit_suggestions
  ADD COLUMN IF NOT EXISTS original_tiktok_caption  text,
  ADD COLUMN IF NOT EXISTS suggested_tiktok_caption text,
  ADD COLUMN IF NOT EXISTS original_geral_caption   text,
  ADD COLUMN IF NOT EXISTS suggested_geral_caption  text,
  ADD COLUMN IF NOT EXISTS geral_target_id          bigint,
  ADD COLUMN IF NOT EXISTS tiktok_followed_ig       boolean;

-- '' = linha geral com legenda vazia; NULL = sem linha geral ou versão anterior a
-- esta migration ("não registrado"). Sem backfill.
ALTER TABLE public.post_content_versions
  ADD COLUMN IF NOT EXISTS geral_caption text;

-- ---------------------------------------------------------------------
-- 2. upsert_edit_suggestion
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb);

CREATE FUNCTION public.upsert_edit_suggestion(
  p_post_id                  bigint,
  p_conta_id                 uuid,
  p_token                    text,
  p_suggested_conteudo       jsonb,
  p_suggested_conteudo_plain text,
  p_suggested_ig_caption     text,
  p_touched_fields           text[] DEFAULT NULL,
  p_bases                    jsonb  DEFAULT NULL,
  p_suggested_captions       jsonb  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post          record;
  v_row           record;
  v_have          boolean;
  v_changed       text[] := '{}';
  v_keep          text[] := '{}';
  v_result        record;
  v_is_new        boolean;
  v_geral_id      bigint;
  v_geral_caption text;
  v_have_geral    boolean;
  v_have_tt       boolean;
  v_t_texto       boolean;
  v_t_legenda     boolean;
  v_t_tt          boolean;
  v_t_geral       boolean;
  v_in_texto      boolean;
  v_in_legenda    boolean;
  v_in_tt         boolean;
  v_in_geral      boolean;
  -- original / sugerido que vão para a linha
  o_c             jsonb;
  o_p             text;
  o_cap           text;
  o_tt            text;
  o_g             text;
  s_c             jsonb;
  s_p             text;
  s_cap           text;
  s_tt            text;
  s_g             text;
  v_gid           bigint;
  v_followed      boolean;
  v_texto_chg     text[] := '{}';
  v_legenda_chg   boolean := false;
  v_tt_chg        boolean := false;
  v_geral_chg     boolean := false;
BEGIN
  -- Ordem de locks: post -> linha geral -> sugestão.
  SELECT conteudo, conteudo_plain, ig_caption, tiktok_caption, status, conta_id
    INTO v_post
    FROM workflow_posts
    WHERE id = p_post_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  IF v_post.status <> 'enviado_cliente' OR v_post.conta_id IS DISTINCT FROM p_conta_id THEN
    RAISE EXCEPTION 'post_not_pending' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, caption INTO v_geral_id, v_geral_caption
    FROM post_targets
    WHERE post_id = p_post_id AND platform = 'geral'
    FOR UPDATE;
  v_have_geral := FOUND;

  -- Só a existência importa (a legenda do TikTok mora em workflow_posts); sem lock.
  v_have_tt := EXISTS (SELECT 1 FROM post_targets WHERE post_id = p_post_id AND platform = 'tiktok');

  SELECT * INTO v_row
    FROM post_edit_suggestions
    WHERE post_id = p_post_id AND status = 'pending'
    FOR UPDATE;
  v_have := FOUND;

  -- ---------------------------------------------------------------
  -- Save legado: corpo de 20260928150001 §3a para texto e legenda. Não toca os
  -- campos novos; preserva em changed_fields as entradas tiktok_caption /
  -- geral_caption que um Hub novo gravou (uma aba antiga aberta não as apaga, nem
  -- apaga a linha quando texto e legenda voltam ao vivo).
  -- ---------------------------------------------------------------
  IF p_touched_fields IS NULL THEN
    IF COALESCE(p_suggested_conteudo_plain, '') IS DISTINCT FROM COALESCE(v_post.conteudo_plain, '') THEN
      v_changed := array_append(v_changed, 'conteudo_plain');
    END IF;
    IF p_suggested_conteudo::text IS DISTINCT FROM v_post.conteudo::text THEN
      v_changed := array_append(v_changed, 'conteudo');
    END IF;
    IF COALESCE(p_suggested_ig_caption, '') IS DISTINCT FROM COALESCE(v_post.ig_caption, '') THEN
      v_changed := array_append(v_changed, 'ig_caption');
    END IF;

    IF v_have THEN
      SELECT COALESCE(array_agg(f ORDER BY f DESC), '{}') INTO v_keep
        FROM unnest(v_row.changed_fields) AS f
        WHERE f IN ('tiktok_caption', 'geral_caption');
    END IF;
    v_changed := v_changed || v_keep;

    IF array_length(v_changed, 1) IS NULL THEN
      DELETE FROM post_edit_suggestions
        WHERE post_id = p_post_id AND status = 'pending';
      RETURN jsonb_build_object('action', 'deleted', 'suggestion', NULL, 'is_new', false);
    END IF;

    -- Linha nova: as legendas novas valem o vivo (original = sugerido); geral_target_id
    -- e tiktok_followed_ig ficam NULL. Numa linha existente o ON CONFLICT não mexe nelas.
    INSERT INTO post_edit_suggestions (
      post_id, conta_id, token,
      original_conteudo, original_conteudo_plain, original_ig_caption,
      suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption,
      original_tiktok_caption, suggested_tiktok_caption,
      original_geral_caption, suggested_geral_caption,
      changed_fields, status
    ) VALUES (
      p_post_id, p_conta_id, p_token,
      v_post.conteudo, v_post.conteudo_plain, v_post.ig_caption,
      p_suggested_conteudo, p_suggested_conteudo_plain, p_suggested_ig_caption,
      v_post.tiktok_caption, v_post.tiktok_caption,
      v_geral_caption, v_geral_caption,
      v_changed, 'pending'
    )
    ON CONFLICT (post_id) WHERE status = 'pending'
    DO UPDATE SET
      suggested_conteudo       = EXCLUDED.suggested_conteudo,
      suggested_conteudo_plain = EXCLUDED.suggested_conteudo_plain,
      suggested_ig_caption     = EXCLUDED.suggested_ig_caption,
      changed_fields           = EXCLUDED.changed_fields
    RETURNING *, (xmax = 0) AS _is_new
    INTO v_result;

    v_is_new := v_result._is_new;

    RETURN jsonb_build_object(
      'action', 'upserted',
      'is_new', v_is_new,
      'suggestion', jsonb_build_object(
        'id',                       v_result.id,
        'post_id',                  v_result.post_id,
        'suggested_conteudo',       v_result.suggested_conteudo,
        'suggested_conteudo_plain', v_result.suggested_conteudo_plain,
        'suggested_ig_caption',     v_result.suggested_ig_caption,
        'suggested_tiktok_caption', v_result.suggested_tiktok_caption,
        'suggested_geral_caption',  v_result.suggested_geral_caption,
        'changed_fields',           v_result.changed_fields,
        'updated_at',               v_result.updated_at
      )
    );
  END IF;

  -- ---------------------------------------------------------------
  -- Save por campo (spec de no-auto-reject §1).
  -- ---------------------------------------------------------------
  v_t_texto    := 'texto'          = ANY (p_touched_fields);
  v_t_legenda  := 'legenda'        = ANY (p_touched_fields);
  v_t_tt       := 'legenda_tiktok' = ANY (p_touched_fields);
  v_t_geral    := 'legenda_geral'  = ANY (p_touched_fields);
  v_in_texto   := v_have AND v_row.changed_fields && ARRAY['conteudo', 'conteudo_plain'];
  v_in_legenda := v_have AND 'ig_caption'     = ANY (v_row.changed_fields);
  v_in_tt      := v_have AND 'tiktok_caption' = ANY (v_row.changed_fields);
  v_in_geral   := v_have AND 'geral_caption'  = ANY (v_row.changed_fields);

  -- Destino ausente: checagem de intenção, antes de qualquer escrita. O TikTok pode ter
  -- saído (virou Stories, z7); o Geral pode ter sido removido, ou removido e recriado.
  IF v_t_tt AND NOT v_have_tt THEN
    RAISE EXCEPTION 'target_gone' USING ERRCODE = 'P0001';
  END IF;
  IF v_t_geral AND (NOT v_have_geral
                    OR (v_in_geral AND v_row.geral_target_id IS DISTINCT FROM v_geral_id)) THEN
    RAISE EXCEPTION 'target_gone' USING ERRCODE = 'P0001';
  END IF;

  -- texto = conteudo + conteudo_plain, sempre juntos.
  IF v_t_texto THEN
    IF v_in_texto THEN
      -- já é sugestão: a base guardada continua valendo
      o_c := v_row.original_conteudo;
      o_p := v_row.original_conteudo_plain;
    ELSE
      IF NOT (COALESCE(p_bases ? 'conteudo_plain', false) AND COALESCE(p_bases ? 'conteudo', false)) THEN
        RAISE EXCEPTION 'base_required' USING ERRCODE = 'P0001';
      END IF;
      o_c := NULLIF(p_bases -> 'conteudo', 'null'::jsonb);
      o_p := p_bases ->> 'conteudo_plain';
    END IF;
    s_c := NULLIF(p_suggested_conteudo, 'null'::jsonb);
    s_p := p_suggested_conteudo_plain;
    IF COALESCE(s_p, '') IS DISTINCT FROM COALESCE(o_p, '') THEN
      v_texto_chg := array_append(v_texto_chg, 'conteudo_plain');
    END IF;
    IF s_c IS DISTINCT FROM o_c THEN
      v_texto_chg := array_append(v_texto_chg, 'conteudo');
    END IF;
  ELSIF v_in_texto THEN
    -- não tocado e já sugerido: guarda o que está na linha
    o_c := v_row.original_conteudo;
    o_p := v_row.original_conteudo_plain;
    s_c := v_row.suggested_conteudo;
    s_p := v_row.suggested_conteudo_plain;
    SELECT COALESCE(array_agg(f), '{}') INTO v_texto_chg
      FROM unnest(v_row.changed_fields) AS f
      WHERE f IN ('conteudo', 'conteudo_plain');
  END IF;
  IF array_length(v_texto_chg, 1) IS NULL THEN
    -- sem mudança de texto: re-baseia no vivo (o texto do cliente é ignorado)
    o_c := v_post.conteudo;  s_c := v_post.conteudo;
    o_p := v_post.conteudo_plain;  s_p := v_post.conteudo_plain;
  END IF;

  -- legenda (Instagram)
  IF v_t_legenda THEN
    IF v_in_legenda THEN
      o_cap := v_row.original_ig_caption;
    ELSE
      IF NOT COALESCE(p_bases ? 'ig_caption', false) THEN
        RAISE EXCEPTION 'base_required' USING ERRCODE = 'P0001';
      END IF;
      o_cap := p_bases ->> 'ig_caption';
    END IF;
    s_cap := p_suggested_ig_caption;
    v_legenda_chg := COALESCE(s_cap, '') IS DISTINCT FROM COALESCE(o_cap, '');
  ELSIF v_in_legenda THEN
    o_cap := v_row.original_ig_caption;
    s_cap := v_row.suggested_ig_caption;
    v_legenda_chg := true;
  END IF;
  IF NOT v_legenda_chg THEN
    o_cap := v_post.ig_caption;
    s_cap := v_post.ig_caption;
  END IF;

  -- legenda_tiktok (workflow_posts.tiktok_caption)
  IF v_t_tt THEN
    IF v_in_tt THEN
      o_tt := v_row.original_tiktok_caption;
    ELSE
      IF NOT COALESCE(p_bases ? 'tiktok_caption', false) THEN
        RAISE EXCEPTION 'base_required' USING ERRCODE = 'P0001';
      END IF;
      o_tt := p_bases ->> 'tiktok_caption';
    END IF;
    s_tt := p_suggested_captions ->> 'tiktok_caption';
    v_tt_chg := COALESCE(s_tt, '') IS DISTINCT FROM COALESCE(o_tt, '');
  ELSIF v_in_tt THEN
    o_tt := v_row.original_tiktok_caption;
    s_tt := v_row.suggested_tiktok_caption;
    v_tt_chg := true;
  END IF;
  IF NOT v_tt_chg THEN
    o_tt := v_post.tiktok_caption;
    s_tt := v_post.tiktok_caption;
  END IF;

  -- legenda_geral (post_targets.caption da linha geral)
  IF v_t_geral THEN
    IF v_in_geral THEN
      o_g := v_row.original_geral_caption;
    ELSE
      IF NOT COALESCE(p_bases ? 'geral_caption', false) THEN
        RAISE EXCEPTION 'base_required' USING ERRCODE = 'P0001';
      END IF;
      o_g := p_bases ->> 'geral_caption';
    END IF;
    s_g := p_suggested_captions ->> 'geral_caption';
    v_geral_chg := COALESCE(s_g, '') IS DISTINCT FROM COALESCE(o_g, '');
    v_gid := v_geral_id;
  ELSIF v_in_geral THEN
    o_g := v_row.original_geral_caption;
    s_g := v_row.suggested_geral_caption;
    v_gid := v_row.geral_target_id;
    v_geral_chg := true;
  END IF;
  IF NOT v_geral_chg THEN
    o_g := v_geral_caption;
    s_g := v_geral_caption;
    v_gid := NULL;
  END IF;

  -- tiktok_followed_ig: registrado quando a legenda entra em changed_fields, guardado
  -- enquanto ela fica, limpo quando ela sai.
  IF v_legenda_chg THEN
    v_followed := CASE WHEN v_in_legenda THEN v_row.tiktok_followed_ig
                       ELSE v_post.tiktok_caption IS NULL END;
  ELSE
    v_followed := NULL;
  END IF;

  v_changed := v_texto_chg;
  IF v_legenda_chg THEN
    v_changed := array_append(v_changed, 'ig_caption');
  END IF;
  IF v_tt_chg THEN
    v_changed := array_append(v_changed, 'tiktok_caption');
  END IF;
  IF v_geral_chg THEN
    v_changed := array_append(v_changed, 'geral_caption');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    DELETE FROM post_edit_suggestions
      WHERE post_id = p_post_id AND status = 'pending';
    RETURN jsonb_build_object('action', 'deleted', 'suggestion', NULL, 'is_new', false);
  END IF;

  INSERT INTO post_edit_suggestions (
    post_id, conta_id, token,
    original_conteudo, original_conteudo_plain, original_ig_caption,
    suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption,
    original_tiktok_caption, suggested_tiktok_caption,
    original_geral_caption, suggested_geral_caption,
    geral_target_id, tiktok_followed_ig,
    changed_fields, status
  ) VALUES (
    p_post_id, p_conta_id, p_token,
    o_c, o_p, o_cap,
    s_c, s_p, s_cap,
    o_tt, s_tt,
    o_g, s_g,
    v_gid, v_followed,
    v_changed, 'pending'
  )
  ON CONFLICT (post_id) WHERE status = 'pending'
  DO UPDATE SET
    original_conteudo        = EXCLUDED.original_conteudo,
    original_conteudo_plain  = EXCLUDED.original_conteudo_plain,
    original_ig_caption      = EXCLUDED.original_ig_caption,
    suggested_conteudo       = EXCLUDED.suggested_conteudo,
    suggested_conteudo_plain = EXCLUDED.suggested_conteudo_plain,
    suggested_ig_caption     = EXCLUDED.suggested_ig_caption,
    original_tiktok_caption  = EXCLUDED.original_tiktok_caption,
    suggested_tiktok_caption = EXCLUDED.suggested_tiktok_caption,
    original_geral_caption   = EXCLUDED.original_geral_caption,
    suggested_geral_caption  = EXCLUDED.suggested_geral_caption,
    geral_target_id          = EXCLUDED.geral_target_id,
    tiktok_followed_ig       = EXCLUDED.tiktok_followed_ig,
    changed_fields           = EXCLUDED.changed_fields
  RETURNING *, (xmax = 0) AS _is_new
  INTO v_result;

  v_is_new := v_result._is_new;

  RETURN jsonb_build_object(
    'action', 'upserted',
    'is_new', v_is_new,
    'suggestion', jsonb_build_object(
      'id',                       v_result.id,
      'post_id',                  v_result.post_id,
      'suggested_conteudo',       v_result.suggested_conteudo,
      'suggested_conteudo_plain', v_result.suggested_conteudo_plain,
      'suggested_ig_caption',     v_result.suggested_ig_caption,
      'suggested_tiktok_caption', v_result.suggested_tiktok_caption,
      'suggested_geral_caption',  v_result.suggested_geral_caption,
      'changed_fields',           v_result.changed_fields,
      'updated_at',               v_result.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------
-- 4a. Versão por mudança da legenda Geral (fora de um UPDATE de workflow_posts)
-- ---------------------------------------------------------------------
-- Grava uma versão do post a partir do retrato ATUAL de workflow_posts (não há OLD de
-- post aqui), com a legenda Geral p_new (antes p_old). Mesma regra de
-- record_post_content_version: ator, source (app.event_source), suggestion_id
-- (app.post_edit_suggestion_id), coalescing (mesmo ator e source, janela de 5 min, sem
-- mudança de status depois da ponta; nunca para source='client'), baseline quando o post
-- não tem versão nenhuma. A baseline usa now() - 1s: post_targets.updated_at não é
-- mantido. Best-effort como o trigger. p_old/p_new chegam com COALESCE(caption,'') de
-- uma linha que existe; p_old NULL = não havia linha geral (INSERT).
CREATE OR REPLACE FUNCTION public._record_post_geral_caption_version(
  p_post_id bigint,
  p_old     text,
  p_new     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid;
  v_source         text;
  v_actor_name     text;
  v_suggestion     bigint;
  v_window         constant interval := interval '5 minutes';
  v_tip            post_content_versions;
  v_wp             record;
  v_baseline_actor text;
BEGIN
  BEGIN
    IF p_old IS NOT DISTINCT FROM p_new THEN
      RETURN;
    END IF;

    SELECT id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption, responsavel_id
      INTO v_wp
      FROM workflow_posts
      WHERE id = p_post_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;

    v_actor := COALESCE(NULLIF(current_setting('app.actor_id', true), '')::uuid, auth.uid());
    v_source := COALESCE(
      NULLIF(current_setting('app.event_source', true), ''),
      CASE WHEN v_actor IS NOT NULL THEN 'workspace_user' ELSE 'system' END
    );
    v_suggestion := NULLIF(current_setting('app.post_edit_suggestion_id', true), '')::bigint;

    IF v_actor IS NOT NULL THEN
      SELECT nome INTO v_actor_name FROM profiles WHERE id = v_actor;
    END IF;

    SELECT * INTO v_tip
      FROM post_content_versions
      WHERE post_id = p_post_id
      ORDER BY last_touched_at DESC
      LIMIT 1;

    -- Baseline: o estado antes desta mudança nunca foi registrado.
    IF v_tip.id IS NULL
       AND (v_wp.conteudo IS NOT NULL OR NULLIF(v_wp.conteudo_plain, '') IS NOT NULL
            OR v_wp.ig_caption IS NOT NULL OR v_wp.tiktok_caption IS NOT NULL
            OR NULLIF(p_old, '') IS NOT NULL)
    THEN
      v_baseline_actor := NULL;
      IF v_wp.responsavel_id IS NOT NULL THEN
        SELECT nome INTO v_baseline_actor
          FROM membros
          WHERE id = v_wp.responsavel_id AND conta_id = v_wp.conta_id;
      END IF;
      IF v_baseline_actor IS NULL THEN
        SELECT actor_name INTO v_baseline_actor
          FROM post_status_events
          WHERE post_id = p_post_id AND to_status = 'enviado_cliente'
          ORDER BY created_at ASC
          LIMIT 1;
      END IF;
      INSERT INTO post_content_versions
        (post_id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption, geral_caption,
         changed_fields, source, actor_user_id, actor_name, suggestion_id,
         created_at, last_touched_at)
      VALUES
        (p_post_id, v_wp.conta_id, v_wp.conteudo, v_wp.conteudo_plain, v_wp.ig_caption,
         v_wp.tiktok_caption, p_old,
         '{}', 'workspace_user', NULL, v_baseline_actor, NULL,
         now() - interval '1 second', now() - interval '1 second');
    END IF;

    IF v_tip.id IS NOT NULL
       AND v_source <> 'client'                                    -- nunca coalesce versão do cliente
       AND v_tip.source = v_source
       AND COALESCE(v_tip.actor_user_id::text, '') = COALESCE(v_actor::text, '')
       AND v_tip.last_touched_at >= now() - v_window
       AND NOT EXISTS (
         SELECT 1 FROM post_status_events
         WHERE post_id = p_post_id AND created_at > v_tip.last_touched_at
       )
    THEN
      UPDATE post_content_versions SET
        conteudo        = v_wp.conteudo,
        conteudo_plain  = v_wp.conteudo_plain,
        ig_caption      = v_wp.ig_caption,
        tiktok_caption  = v_wp.tiktok_caption,
        geral_caption   = p_new,
        changed_fields  = (
          SELECT array_agg(DISTINCT x ORDER BY x)
          FROM unnest(v_tip.changed_fields || ARRAY['geral_caption']) AS x
        ),
        last_touched_at = now()
      WHERE id = v_tip.id;
    ELSE
      INSERT INTO post_content_versions
        (post_id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption, geral_caption,
         changed_fields, source, actor_user_id, actor_name, suggestion_id,
         created_at, last_touched_at)
      VALUES
        (p_post_id, v_wp.conta_id, v_wp.conteudo, v_wp.conteudo_plain, v_wp.ig_caption,
         v_wp.tiktok_caption, p_new,
         ARRAY['geral_caption'], v_source, v_actor, v_actor_name, v_suggestion,
         now(), now());
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING '_record_post_geral_caption_version failed for post %: %', p_post_id, sqlerrm;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public._record_post_geral_caption_version(bigint, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_post_geral_caption_version(bigint, text, text)
  TO service_role;

-- Trigger em post_targets: só a linha geral. UPDATE só quando o valor muda; INSERT só
-- com legenda não vazia (z6 cria destinos com caption nulo em todo post novo). Não grava
-- nada durante um aceite: o accept registra uma versão só (ver abaixo). Sem DELETE: o
-- histórico é de texto, não de destinos.
CREATE OR REPLACE FUNCTION public.post_targets_geral_caption_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NULLIF(current_setting('app.accepting_edit_suggestion', true), '') IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public._record_post_geral_caption_version(NEW.post_id, NULL, COALESCE(NEW.caption, ''));
  ELSE
    PERFORM public._record_post_geral_caption_version(
      NEW.post_id, COALESCE(OLD.caption, ''), COALESCE(NEW.caption, ''));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.post_targets_geral_caption_version() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_targets_geral_caption_version() TO service_role;

DROP TRIGGER IF EXISTS post_targets_geral_caption_version_ins ON public.post_targets;
CREATE TRIGGER post_targets_geral_caption_version_ins
  AFTER INSERT ON public.post_targets
  FOR EACH ROW
  WHEN (NEW.platform = 'geral' AND COALESCE(NEW.caption, '') <> '')
  EXECUTE FUNCTION public.post_targets_geral_caption_version();

DROP TRIGGER IF EXISTS post_targets_geral_caption_version_upd ON public.post_targets;
CREATE TRIGGER post_targets_geral_caption_version_upd
  AFTER UPDATE OF caption ON public.post_targets
  FOR EACH ROW
  WHEN (NEW.platform = 'geral' AND OLD.caption IS DISTINCT FROM NEW.caption)
  EXECUTE FUNCTION public.post_targets_geral_caption_version();

-- ---------------------------------------------------------------------
-- 4b. record_post_content_version grava também a legenda Geral atual
-- ---------------------------------------------------------------------
-- Canônica: 20260923000008. Mudanças (-- PR2):
--   * geral_caption em cada versão = COALESCE(caption,'') da linha geral (NULL sem linha).
--   * Durante um aceite que mudou o Geral, o accept põe em
--     app.edit_suggestion_geral_before a legenda Geral de ANTES ({"v": ...}): a baseline
--     grava esse valor (não o novo, que já está em post_targets), changed_fields ganha
--     'geral_caption' e o GUC é consumido (zerado), o que diz ao accept que a versão
--     única já foi gravada.
create or replace function record_post_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor          uuid;
  v_source         text;
  v_actor_name     text;
  v_suggestion     bigint;
  v_changed        text[] := '{}';
  v_status_changed boolean;
  v_window         constant interval := interval '5 minutes';
  v_tip            post_content_versions;
  v_baseline_at    timestamptz;
  v_baseline_actor text;
  v_geral          text;    -- PR2
  v_geral_before   text;    -- PR2
  v_geral_guc      text;    -- PR2
begin
  begin
    v_actor := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid());
    v_source := coalesce(
      nullif(current_setting('app.event_source', true), ''),
      case when v_actor is not null then 'workspace_user' else 'system' end
    );
    v_suggestion := nullif(current_setting('app.post_edit_suggestion_id', true), '')::bigint;

    if v_actor is not null then
      select nome into v_actor_name from profiles where id = v_actor;
    end if;

    if new.conteudo is distinct from old.conteudo then
      v_changed := array_append(v_changed, 'conteudo');
    end if;
    if new.conteudo_plain is distinct from old.conteudo_plain then
      v_changed := array_append(v_changed, 'conteudo_plain');
    end if;
    if new.ig_caption is distinct from old.ig_caption then
      v_changed := array_append(v_changed, 'ig_caption');
    end if;
    if new.tiktok_caption is distinct from old.tiktok_caption then
      v_changed := array_append(v_changed, 'tiktok_caption');
    end if;

    -- PR2: legenda Geral atual ('' = linha com legenda vazia, NULL = sem linha geral).
    v_geral := (select coalesce(caption, '') from post_targets
                 where post_id = new.id and platform = 'geral');
    v_geral_before := v_geral;
    v_geral_guc := nullif(current_setting('app.edit_suggestion_geral_before', true), '');
    if v_geral_guc is not null then
      v_geral_before := (v_geral_guc::jsonb) ->> 'v';
      if v_geral_before is distinct from v_geral then
        v_changed := array_append(v_changed, 'geral_caption');
      end if;
    end if;

    -- Same-statement status change breaks coalescing regardless of AFTER-
    -- trigger firing order (see 20260923000008).
    v_status_changed :=
      new.status is distinct from old.status
      or new.custom_status_id is distinct from old.custom_status_id;

    -- The ACTUAL latest version row for this post (see 20260923000008).
    select * into v_tip
      from post_content_versions
      where post_id = new.id
      order by last_touched_at desc
      limit 1;

    -- Baseline for the first-ever content update (see 20260923000004..8).
    if v_tip.id is null
       and (old.conteudo is not null or nullif(old.conteudo_plain, '') is not null
            or old.ig_caption is not null or old.tiktok_caption is not null)
    then
      v_baseline_at := least(old.updated_at, now() - interval '1 second');
      v_baseline_actor := null;
      if old.responsavel_id is not null then
        select nome into v_baseline_actor
          from membros
          where id = old.responsavel_id and conta_id = new.conta_id;
      end if;
      if v_baseline_actor is null then
        select actor_name into v_baseline_actor
          from post_status_events
          where post_id = new.id and to_status = 'enviado_cliente'
          order by created_at asc
          limit 1;
      end if;
      if v_baseline_actor is null
         and new.status = 'enviado_cliente'
         and old.status is distinct from new.status
      then
        v_baseline_actor := v_actor_name;
      end if;
      insert into post_content_versions
        (post_id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption, geral_caption,
         changed_fields, source, actor_user_id, actor_name, suggestion_id,
         created_at, last_touched_at)
      values
        (new.id, new.conta_id, old.conteudo, old.conteudo_plain, old.ig_caption, old.tiktok_caption,
         v_geral_before,
         '{}', 'workspace_user', null, v_baseline_actor, null,
         v_baseline_at, v_baseline_at);
    end if;

    if v_tip.id is not null
       and v_source <> 'client'                                    -- never coalesce client-sourced rows
       and v_tip.source = v_source
       and coalesce(v_tip.actor_user_id::text, '') = coalesce(v_actor::text, '')
       and v_tip.last_touched_at >= now() - v_window
       and not v_status_changed
       and not exists (
         select 1 from post_status_events
         where post_id = new.id and created_at > v_tip.last_touched_at
       )
    then
      update post_content_versions set
        conteudo        = new.conteudo,
        conteudo_plain  = new.conteudo_plain,
        ig_caption      = new.ig_caption,
        tiktok_caption  = new.tiktok_caption,
        geral_caption   = v_geral,
        changed_fields  = (
          select array_agg(distinct x order by x)
          from unnest(v_tip.changed_fields || v_changed) as x
        ),
        last_touched_at = now()
      where id = v_tip.id;
    else
      insert into post_content_versions
        (post_id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption, geral_caption,
         changed_fields, source, actor_user_id, actor_name, suggestion_id,
         created_at, last_touched_at)
      values
        (new.id, new.conta_id, new.conteudo, new.conteudo_plain, new.ig_caption, new.tiktok_caption,
         v_geral,
         v_changed, v_source, v_actor, v_actor_name, v_suggestion,
         now(), now());
    end if;

    -- PR2: a versão do aceite já levou o Geral; o accept não grava outra.
    if v_geral_guc is not null then
      perform set_config('app.edit_suggestion_geral_before', '', true);
    end if;
  exception when others then
    raise warning 'record_post_content_version failed for post %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. accept_edit_suggestion
-- ---------------------------------------------------------------------
-- Corpo de 20261106000003 (checagem de workspace, suggestion_changed, conflito por
-- campo com p_acknowledged, no_fields, app.*) mantido. Novo:
--   * lê tiktok_caption com o post e trava a linha geral: post -> geral -> sugestão;
--   * legenda_tiktok / legenda_geral em p_fields e p_acknowledged, conflito com a
--     mesma regra de legenda (COALESCE(x,'') vivo <> original);
--   * p_fields NULL com tiktok_caption ou geral_caption em changed_fields:
--     suggestion_conflict (o CRM antigo não mostra esses campos);
--   * Geral escolhido e linha sumiu (ou id <> geral_target_id), TikTok escolhido e
--     linha tiktok sumiu: target_gone. TikTok escolhido com o destino em
--     processando/publicado: target_locked. Nada muda em nenhum dos casos;
--   * um UPDATE de workflow_posts com CASE por coluna (o trigger de versão tem WHEN
--     por valor, então reatribuir uma coluna a ela mesma não gera versão).
-- Um aceite = uma versão: o UPDATE de post_targets vem primeiro e o trigger dele não
-- grava durante o aceite; o UPDATE de workflow_posts grava a versão única, já com o
-- Geral novo (app.edit_suggestion_geral_before leva o valor de antes). Se nenhuma
-- coluna de workflow_posts mudou de fato (aceite só de Geral, ou o resto já igual ao
-- vivo), o GUC continua setado e o accept grava a versão explicitamente, uma vez.
create or replace function public.accept_edit_suggestion(
  p_suggestion_id       bigint,
  p_expected_updated_at timestamptz default null,
  p_fields              text[]      default null,
  p_acknowledged        text[]      default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.accept_edit_suggestion(bigint, timestamptz, text[], text[]) from public, anon;
grant execute on function public.accept_edit_suggestion(bigint, timestamptz, text[], text[]) to authenticated, service_role;
