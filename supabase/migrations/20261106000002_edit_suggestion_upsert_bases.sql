-- =====================================================================
-- Sugestões de edição sem auto-recusa, parte 2: upsert por campo.
-- Spec: docs/superpowers/specs/2026-10-29-edit-suggestion-no-auto-reject-design.md §1 e §2.
--
-- Hoje o upsert mede `changed_fields` contra o post VIVO a cada save e nunca
-- re-baseia `original_*`. Com a equipe podendo editar o post enquanto a sugestão
-- está pendente (o trigger não recusa mais, 20261106000001), isso faz um painel
-- aberto antes de uma edição da equipe devolver a legenda velha como se fosse
-- mudança do cliente. A nova versão recebe:
--   p_touched_fields text[]  campos que o cliente de fato editou: 'texto' | 'legenda'
--   p_bases jsonb            a base de cada campo tocado, como o Hub a buscou:
--                            {"conteudo": ..., "conteudo_plain": ..., "ig_caption": ...}
-- e mede cada campo tocado contra a SUA base (não contra o vivo), de modo que uma
-- edição da equipe entre a busca e o save aparece como conflito no accept.
--
-- p_touched_fields NULL = save legado (Hub antigo, aba aberta antes do deploy):
-- corpo de 20260928150001 §3a INTACTO (compara contra o vivo, `::text`, original_*
-- nunca re-baseado numa linha existente). A rede de segurança dele é o accept.
--
-- A assinatura muda: DROP + CREATE, grants reafirmados (só service_role).
-- Também cria _tiptap_inline_image_keys, usada pelo accept (conflito de texto).
-- =====================================================================

-- r2Key de cada nó inlineImage, ordenado e sem repetição. Espelha extractR2Keys de
-- hub-edit-suggestion/handler.ts (r2Key ausente, null ou '' não conta). Não é STRICT:
-- NULL vira '{}', e quem compara usa IS DISTINCT FROM (há linhas com conteudo NULL).
CREATE OR REPLACE FUNCTION public._tiptap_inline_image_keys(p_doc jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), '{}'::text[])
  FROM jsonb_path_query(
         COALESCE(p_doc, 'null'::jsonb),
         'lax $.** ? (@.type == "inlineImage" && @.attrs.r2Key != null && @.attrs.r2Key != "").attrs.r2Key'
       ) AS t(j),
       LATERAL (SELECT t.j #>> '{}') AS x(k);
$$;

REVOKE ALL ON FUNCTION public._tiptap_inline_image_keys(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tiptap_inline_image_keys(jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text);

CREATE FUNCTION public.upsert_edit_suggestion(
  p_post_id                  bigint,
  p_conta_id                 uuid,
  p_token                    text,
  p_suggested_conteudo       jsonb,
  p_suggested_conteudo_plain text,
  p_suggested_ig_caption     text,
  p_touched_fields           text[] DEFAULT NULL,
  p_bases                    jsonb  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post        record;
  v_row         record;
  v_have        boolean;
  v_changed     text[] := '{}';
  v_result      record;
  v_is_new      boolean;
  v_t_texto     boolean;
  v_t_legenda   boolean;
  v_in_texto    boolean;
  v_in_legenda  boolean;
  -- original / sugerido que vão para a linha
  o_c           jsonb;
  o_p           text;
  o_cap         text;
  s_c           jsonb;
  s_p           text;
  s_cap         text;
  v_texto_chg   text[] := '{}';
  v_legenda_chg boolean := false;
BEGIN
  SELECT conteudo, conteudo_plain, ig_caption, status, conta_id
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

  -- ---------------------------------------------------------------
  -- Save legado: corpo de 20260928150001 §3a, sem mudança.
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

    IF array_length(v_changed, 1) IS NULL THEN
      DELETE FROM post_edit_suggestions
        WHERE post_id = p_post_id AND status = 'pending';
      RETURN jsonb_build_object('action', 'deleted', 'suggestion', NULL, 'is_new', false);
    END IF;

    INSERT INTO post_edit_suggestions (
      post_id, conta_id, token,
      original_conteudo, original_conteudo_plain, original_ig_caption,
      suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption,
      changed_fields, status
    ) VALUES (
      p_post_id, p_conta_id, p_token,
      v_post.conteudo, v_post.conteudo_plain, v_post.ig_caption,
      p_suggested_conteudo, p_suggested_conteudo_plain, p_suggested_ig_caption,
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
        'changed_fields',           v_result.changed_fields,
        'updated_at',               v_result.updated_at
      )
    );
  END IF;

  -- ---------------------------------------------------------------
  -- Save por campo (spec §1). Ordem de locks: o post (acima), depois a sugestão.
  -- ---------------------------------------------------------------
  SELECT * INTO v_row
    FROM post_edit_suggestions
    WHERE post_id = p_post_id AND status = 'pending'
    FOR UPDATE;
  v_have := FOUND;

  v_t_texto    := 'texto'   = ANY (p_touched_fields);
  v_t_legenda  := 'legenda' = ANY (p_touched_fields);
  v_in_texto   := v_have AND v_row.changed_fields && ARRAY['conteudo', 'conteudo_plain'];
  v_in_legenda := v_have AND 'ig_caption' = ANY (v_row.changed_fields);

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

  v_changed := v_texto_chg;
  IF v_legenda_chg THEN
    v_changed := array_append(v_changed, 'ig_caption');
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
    changed_fields, status
  ) VALUES (
    p_post_id, p_conta_id, p_token,
    o_c, o_p, o_cap,
    s_c, s_p, s_cap,
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
      'changed_fields',           v_result.changed_fields,
      'updated_at',               v_result.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb)
  TO service_role;
