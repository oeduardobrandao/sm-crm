-- A capa de um post agora é derivada: a mídia com is_cover se existir, senão a
-- primeira por sort_order. Flag deliberada só vem de post_file_link_set_cover,
-- chamada pelo PATCH /links/:id do file-manage (e pelo equivalente legado em
-- post-media-manage) quando o usuário troca a capa manualmente na UI. A RPC
-- post_media_set_from_uploads, usada pelo set_post_media do MCP, não seta mais
-- flag nenhuma: ver item 2 abaixo.
-- Todos os leitores (post-media-manage nos três branches, hub-posts, MCP e a
-- galeria do CRM) aplicam essa resolução.
--
-- 1) Remove os triggers que mantinham o modelo antigo de flag manual:
--    - auto_cover flagava o próximo insert quando o post não tinha capa; depois
--      da limpeza abaixo, ele flagaria a mídia recém-anexada (a última da
--      ordem), e o flag venceria a regra da primeira. Reordenar não corrigiria.
--    - reassign_cover repassava o flag ao deletar a capa flagada, mantendo o
--      flag vivo indefinidamente.
drop trigger if exists trg_post_file_link_auto_cover on post_file_links;
drop function if exists post_file_link_auto_cover();
drop trigger if exists trg_post_file_link_reassign_cover on post_file_links;
drop function if exists post_file_link_reassign_cover();

-- 2) post_media_set_from_uploads era o último escritor automático de is_cover:
--    a RPC por trás do set_post_media do MCP (supabase/functions/mcp/media.ts),
--    que flagava o primeiro item de todo envio e assim vencia qualquer ordem
--    manual feita depois via drag-reorder. Re-issue verbatim a partir da
--    definição atual em 20260722000002_drop_estudio_objects.sql:137-193, só
--    trocando o valor de is_cover no INSERT de "i = 0" para "false". Agora essa
--    RPC insere tudo com false e a capa segue a regra derivada.
CREATE OR REPLACE FUNCTION post_media_set_from_uploads(
  p_conta_id uuid, p_post_id bigint, p_uploaded_by uuid, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post workflow_posts;
  v_item jsonb;
  i int := 0;
  v_new_tipo text;
  v_old bigint[];
  v_new bigint[] := '{}';
  v_fid bigint;
BEGIN
  SELECT * INTO v_post FROM workflow_posts
    WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_post.status NOT IN ('rascunho','revisao_interna','correcao_cliente','enviado_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_post.status USING ERRCODE = 'P0001';
  END IF;
  IF v_post.tipo NOT IN ('feed','carrossel') THEN
    RAISE EXCEPTION 'tipo_not_image:%', v_post.tipo USING ERRCODE = 'P0001';
  END IF;

  v_new_tipo := CASE WHEN jsonb_array_length(p_items) > 1 THEN 'carrossel' ELSE 'feed' END;

  SELECT COALESCE(array_agg(file_id), '{}') INTO v_old
    FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;
  DELETE FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id INTO v_fid FROM files                                        -- P2-1 idempotent reuse
      WHERE conta_id = p_conta_id AND r2_key = v_item->>'r2_key' LIMIT 1;
    IF v_fid IS NULL THEN
      v_fid := (file_insert_with_quota(jsonb_build_object(
        'conta_id', p_conta_id, 'r2_key', v_item->>'r2_key',
        'name', COALESCE(v_item->>'filename', 'post-'||p_post_id||'-'||(i+1)),
        'kind','image', 'mime_type', v_item->>'mime_type',
        'size_bytes', (v_item->>'size_bytes')::bigint,
        'width', COALESCE(v_item->>'width',''), 'height', COALESCE(v_item->>'height',''),
        'uploaded_by', p_uploaded_by))).id;                                -- raises 'quota_exceeded'
    END IF;
    INSERT INTO post_file_links(post_id, conta_id, file_id, origin, sort_order, is_cover)
      VALUES (p_post_id, p_conta_id, v_fid, 'manual', i, false);
    v_new := v_new || v_fid; i := i + 1;
  END LOOP;

  DELETE FROM files                                                        -- P2-2 GC old unreused
    WHERE conta_id = p_conta_id AND id = ANY(v_old) AND id <> ALL(v_new) AND reference_count = 0;

  UPDATE workflow_posts SET
    tipo = v_new_tipo,
    status = CASE WHEN status = 'correcao_cliente' THEN 'revisao_interna' ELSE status END
  WHERE id = p_post_id;

  RETURN jsonb_build_object('post_id', p_post_id, 'item_count', i, 'tipo', v_new_tipo,
                            'status', (SELECT status FROM workflow_posts WHERE id = p_post_id));
END; $$;

-- 3) Limpa as flags legadas. Seguro em um único UPDATE: o índice parcial
--    post_file_links_one_cover só indexa linhas true, e aqui só escrevemos false.
--
-- Ordem de deploy: publique a function post-media-manage (fallback por ordem no
-- branch de workflow_ids) ANTES de rodar "supabase db push", senão as thumbnails
-- dos boards ficam em branco até o deploy.
update post_file_links set is_cover = false where is_cover = true;
