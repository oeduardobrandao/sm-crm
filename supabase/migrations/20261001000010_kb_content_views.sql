-- Contagem de visualizações da Central de Ajuda (spec 2026-10-01-kb-content-view-counts-design).
-- Um evento por abertura de artigo / play de vídeo. Escrita só via record_kb_view (SECURITY
-- DEFINER, authenticated); leitura agregada só via kb_view_stats (service_role, usada pelo
-- platform-admin). Admins da plataforma são gravados como qualquer usuário e excluídos NA
-- LEITURA, em todas as métricas, para que promover/remover um admin mova views e conclusões juntas.

CREATE TABLE IF NOT EXISTS kb_content_views (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  article_id uuid   REFERENCES kb_articles(id) ON DELETE CASCADE,
  video_id   bigint REFERENCES kb_videos(id)   ON DELETE CASCADE,
  user_id    uuid   REFERENCES auth.users(id)  ON DELETE SET NULL,
  conta_id   uuid,
  viewed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_content_views_one_target CHECK (num_nonnulls(article_id, video_id) = 1)
);

CREATE INDEX IF NOT EXISTS kb_content_views_article
  ON kb_content_views (article_id, viewed_at) WHERE article_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kb_content_views_video
  ON kb_content_views (video_id, viewed_at) WHERE video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kb_content_views_user
  ON kb_content_views (user_id, viewed_at);

-- Sem policies: ninguém além do service role / funções DEFINER toca a tabela. Hosted Supabase
-- concede ALL em tabela nova a anon/authenticated por ACL padrão, daí o REVOKE explícito.
ALTER TABLE kb_content_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kb_content_views FROM anon, authenticated;

-- Registra uma visualização do usuário atual. Conteúdo oculto ou inexistente retorna em
-- silêncio (mesmos critérios das policies de SELECT de kb_articles/kb_videos), então um
-- rascunho não se distingue de um id inexistente. Dedupe de 30 min por usuário+alvo para
-- refresh e StrictMode; sob concorrência duas linhas podem passar, aceitável para analytics.
CREATE OR REPLACE FUNCTION public.record_kb_view(
  p_article_id uuid DEFAULT NULL,
  p_video_id bigint DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF num_nonnulls(p_article_id, p_video_id) <> 1 THEN
    RAISE EXCEPTION 'exactly one of p_article_id, p_video_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_article_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM kb_articles a WHERE a.id = p_article_id AND a.status = 'published'
    ) THEN
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM kb_content_views cv
      WHERE cv.user_id = v_uid AND cv.article_id = p_article_id
        AND cv.viewed_at > now() - interval '30 minutes'
    ) THEN
      RETURN;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM kb_videos v
      JOIN kb_video_series s ON s.id = v.series_id
      WHERE v.id = p_video_id
        AND v.status = 'published'
        AND v.stream_status = 'ready'
        AND s.status = 'published'
    ) THEN
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM kb_content_views cv
      WHERE cv.user_id = v_uid AND cv.video_id = p_video_id
        AND cv.viewed_at > now() - interval '30 minutes'
    ) THEN
      RETURN;
    END IF;
  END IF;

  INSERT INTO kb_content_views (article_id, video_id, user_id, conta_id)
  VALUES (p_article_id, p_video_id, v_uid, get_my_conta_id());
END;
$$;

REVOKE ALL ON FUNCTION public.record_kb_view(uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_kb_view(uuid, bigint) TO authenticated;

-- Agregado por item para o Admin. Exclusão de admins é por pertencimento ATUAL a
-- platform_admins, em views e conclusões. Linhas de usuário apagado (user_id NULL) contam no
-- total e não em pessoas únicas. completed_total conta só quem concluiu E tem visualização
-- registrada do vídeo: conclusões anteriores à feature não aparecem, e um vídeo nunca mostra
-- conclusões sem views. Só itens com ao menos uma visualização retornam.
CREATE OR REPLACE FUNCTION public.kb_view_stats()
RETURNS TABLE (
  kind text,
  item_id text,
  views_30d bigint,
  users_30d bigint,
  views_total bigint,
  users_total bigint,
  completed_total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT cv.article_id, cv.video_id, cv.user_id, cv.viewed_at
    FROM kb_content_views cv
    WHERE cv.user_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = cv.user_id)
  )
  SELECT
    'article'::text,
    v.article_id::text,
    count(*) FILTER (WHERE v.viewed_at > now() - interval '30 days'),
    count(DISTINCT v.user_id) FILTER (WHERE v.viewed_at > now() - interval '30 days'),
    count(*),
    count(DISTINCT v.user_id),
    NULL::bigint
  FROM v
  WHERE v.article_id IS NOT NULL
  GROUP BY v.article_id
  UNION ALL
  SELECT
    'video'::text,
    v.video_id::text,
    count(*) FILTER (WHERE v.viewed_at > now() - interval '30 days'),
    count(DISTINCT v.user_id) FILTER (WHERE v.viewed_at > now() - interval '30 days'),
    count(*),
    count(DISTINCT v.user_id),
    (
      SELECT count(*)
      FROM kb_video_progress p
      WHERE p.video_id = v.video_id
        AND p.completed_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM v v2 WHERE v2.video_id = p.video_id AND v2.user_id = p.user_id)
    )
  FROM v
  WHERE v.video_id IS NOT NULL
  GROUP BY v.video_id;
$$;

REVOKE ALL ON FUNCTION public.kb_view_stats()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kb_view_stats() TO service_role;
