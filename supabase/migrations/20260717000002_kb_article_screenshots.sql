-- Add screenshots to Tier-1 procedural KB articles.
--
-- Images are inlineImage nodes with r2Key = NULL and a permanent public URL
-- from the kb-images bucket. r2Key MUST stay NULL: a non-null value routes the
-- node through sign-r2-urls, which only re-signs kb_articles.cover_image_url
-- and never images inside the content JSONB -- so the node would keep its
-- 3600s presigned src and 403 an hour after authoring.
--
-- Articles are re-declared in full (not patched) because
-- _kb_shot_upsert_article takes the whole doc, matching the pattern used by
-- 20260625000002. Source of truth for the prose is
-- 20260520000001_expand_kb_help_center.sql, which upserts over the original
-- 20260519000002 seed.

CREATE OR REPLACE FUNCTION _kb_shot_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_shot_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_shot_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_shot_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_shot_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

-- An inlineImage node. r2Key is always NULL -- see header comment.
CREATE OR REPLACE FUNCTION _kb_shot_img(src text, alt text, w int, h int) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object(
    'r2Key', NULL,
    'src', src,
    'alt', alt,
    'width', w,
    'height', h,
    'blurSrc', NULL,
    'displayWidth', NULL,
    'loading', false
  ));
$$ LANGUAGE sql IMMUTABLE;

-- An orderedList where step i carries an optional screenshot beneath its text.
-- listItem content spec is "paragraph block*" and inlineImage is group 'block',
-- so [paragraph, inlineImage] is schema-valid (guarded by the vitest in
-- apps/crm/src/pages/ajuda/__tests__/inlineImageSchema.test.ts).
-- images[i] may be NULL for steps without a capture.
CREATE OR REPLACE FUNCTION _kb_shot_ol_shots(items text[], images jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content',
        CASE WHEN images[i] IS NULL
             THEN jsonb_build_array(_kb_shot_p(items[i]))
             ELSE jsonb_build_array(_kb_shot_p(items[i]), images[i])
        END)
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

-- inlineImage nodes carry no 'text', so they are naturally skipped.
CREATE OR REPLACE FUNCTION _kb_shot_plain(doc jsonb) RETURNS text AS $$
  WITH RECURSIVE nodes AS (
    SELECT doc AS node
    UNION ALL
    SELECT jsonb_array_elements(node->'content') AS node
    FROM nodes
    WHERE node->'content' IS NOT NULL AND jsonb_typeof(node->'content') = 'array'
  )
  SELECT coalesce(string_agg(node->>'text', ' '), '')
  FROM nodes
  WHERE node->>'type' = 'text';
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot_upsert_article(
  p_id uuid, p_title text, p_slug text, p_excerpt text, p_content jsonb,
  p_category text, p_tags text[], p_display_order integer
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES (p_id, p_title, p_slug, p_excerpt, p_content, _kb_shot_plain(p_content), p_category, p_tags, 'published', p_display_order)
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    excerpt = EXCLUDED.excerpt,
    content = EXCLUDED.content,
    content_plain = EXCLUDED.content_plain,
    category = EXCLUDED.category,
    tags = EXCLUDED.tags,
    status = EXCLUDED.status,
    display_order = EXCLUDED.display_order;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Como usar o Post Express
-- ============================================================
SELECT _kb_shot_upsert_article(
  'aaaaaaaa-000b-4000-a000-00000000000b',
  'Como usar o Post Express',
  'como-usar-o-post-express',
  'Publique rapidamente no Instagram sem montar uma entrega completa.',
  _kb_shot_doc(
    _kb_shot_h(2, 'O que é o Post Express?'),
    _kb_shot_p('O Post Express publica conteúdo direto no Instagram de um cliente conectado. Ele é indicado para conteúdos rápidos, urgentes ou pontuais, quando você não precisa montar um fluxo completo de produção.'),
    _kb_shot_h(2, 'Quem aparece na seleção'),
    _kb_shot_p('A lista mostra clientes com conta de Instagram conectada. Se um cliente não aparece, revise a conexão, o status da autorização e as permissões de publicação.'),
    _kb_shot_h(2, 'Como publicar'),
    _kb_shot_ol_shots(
      ARRAY[
        'Acesse Post Express',
        'Selecione o cliente',
        'Envie a mídia ou mídias do post',
        'Revise o tipo detectado: feed, reels ou carrossel',
        'Escreva a legenda com até 2.200 caracteres',
        'Confira o preview e publique'
      ],
      ARRAY[
        _kb_shot_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/01-acessar-post-express.png', 'Tela do Post Express aberta, com a lista de clientes disponível.', 1440, 900),
        _kb_shot_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/02-selecionar-cliente.png', 'Seletor de cliente aberto, mostrando as contas com Instagram conectado.', 1440, 900),
        _kb_shot_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/03-enviar-midia.png', 'Área de envio de mídia do Post Express.', 1440, 900),
        _kb_shot_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/04-tipo-detectado.png', 'Tipo do post detectado automaticamente a partir da mídia enviada.', 1440, 900),
        _kb_shot_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/05-escrever-legenda.png', 'Campo de legenda preenchido, com o contador de caracteres visível.', 1440, 900),
        _kb_shot_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/06-preview-e-publicar.png', 'Preview final do post ao lado do botão de publicar.', 1440, 900)
      ]
    ),
    _kb_shot_callout('💡', 'blue', 'O tipo é detectado pela mídia: várias imagens viram carrossel, vídeo tende a Reels e imagem única vira Feed. Vídeos podem exigir thumbnail para publicação.'),
    _kb_shot_h(2, 'O que acontece nos bastidores'),
    _kb_shot_p('O CRM cria um registro operacional para manter histórico da publicação. Se você abandonar um rascunho vazio, ele pode ser limpo automaticamente. Quando a publicação termina, o post fica registrado como concluído ou com erro para acompanhamento.'),
    _kb_shot_h(2, 'Erros comuns'),
    _kb_shot_ul(ARRAY[
      'Token expirado ou revogado',
      'Permissão de publicação ausente',
      'Legenda vazia ou acima do limite',
      'Vídeo sem thumbnail quando exigido',
      'Conta do cliente desconectada'
    ])
  ),
  'post-express',
  ARRAY['post-express', 'publicacao', 'instagram', 'rapido', 'thumbnail', 'permissoes'],
  60
);

-- ============================================================
-- Cleanup helper functions (matches the pattern in prior kb migrations)
-- ============================================================
DROP FUNCTION IF EXISTS _kb_shot_upsert_article(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_shot_ol_shots(text[], jsonb[]);
DROP FUNCTION IF EXISTS _kb_shot_img(text, text, int, int);
DROP FUNCTION IF EXISTS _kb_shot_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_shot_doc(jsonb[]);
DROP FUNCTION IF EXISTS _kb_shot_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_shot_ul(text[]);
DROP FUNCTION IF EXISTS _kb_shot_h(int, text);
DROP FUNCTION IF EXISTS _kb_shot_p(text);
DROP FUNCTION IF EXISTS _kb_shot_text(text);
