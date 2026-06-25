-- Update Knowledge Base help article #2: O que o agente pode fazer
-- Adds rates (share/like/save/comment per-view) and ig_score to the Leitura section.
-- Idempotent: ON CONFLICT (slug) DO UPDATE; helper functions are dropped at the end.
-- Uses distinct prefix _kb_mcp2_* to avoid collision with _kb_mcp_* from 20260624000002.

-- ============================================================
-- Helper builders (TipTap/ProseMirror JSONB)
-- ============================================================

CREATE OR REPLACE FUNCTION _kb_mcp2_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp2_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_mcp2_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp2_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_mcp2_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp2_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_mcp2_p(item)))
    ) FROM unnest(items) AS item));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp2_ol(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_mcp2_p(item)))
    ) FROM unnest(items) AS item));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp2_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_mcp2_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp2_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp2_plain(doc jsonb) RETURNS text AS $$
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

CREATE OR REPLACE FUNCTION _kb_mcp2_upsert_article(
  p_id uuid,
  p_title text,
  p_slug text,
  p_excerpt text,
  p_content jsonb,
  p_category text,
  p_tags text[],
  p_display_order integer
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (
    id, title, slug, excerpt, content, content_plain, category, tags, status, display_order
  )
  VALUES (
    p_id, p_title, p_slug, p_excerpt, p_content, _kb_mcp2_plain(p_content), p_category, p_tags, 'published', p_display_order
  )
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
-- Article #2: O que o agente pode fazer (updated with rates + ig_score)
-- ============================================================

SELECT _kb_mcp2_upsert_article(
  'bbbbbbbb-0002-4000-b000-000000000002',
  'O que o agente pode fazer',
  'o-que-o-agente-pode-fazer',
  'As ferramentas de leitura e escrita disponíveis, as taxas por visualização, o ig_score e o fluxo completo de criação de conteúdo.',
  _kb_mcp2_doc(
    _kb_mcp2_h(2, 'Visão geral'),
    _kb_mcp2_p('Com o MCP conectado, o agente Claude trabalha como um colaborador de bastidores: ele consulta as informações do workspace e, quando autorizado, prepara rascunhos de conteúdo. Veja o que cada conjunto de ferramentas permite.'),
    _kb_mcp2_h(2, 'Leitura'),
    _kb_mcp2_p('Com escopos de leitura, o agente pode consultar:'),
    _kb_mcp2_ul(ARRAY[
      'Clientes — lista e detalhes com campos não sensíveis',
      'Perfil de marca e briefing — especialidade, cores, fontes e respostas do briefing',
      'Páginas do hub — estratégias e materiais publicados para o cliente',
      'Posts — pipeline com formato, modo, anotações e métricas quando publicados; cada post publicado inclui taxas por visualização (taxa de compartilhamentos, curtidas, salvamentos e comentários) e um ig_score de 0 a 100',
      'Detalhe do post — conteúdo completo, mídia com link temporário, métricas brutas, taxas por visualização e ig_score',
      'Baseline de desempenho — quartis por taxa (compartilhamentos, curtidas, salvamentos, comentários) com o número de amostras por métrica (n); o baseline reflete o histórico do próprio cliente, não benchmarks externos',
      'Feedback do cliente — aprovações, correções e mensagens, com a linha do tempo de status',
      'Fluxos — os fluxos de produção do workspace',
      'Modelos de fluxo — etapas e o esquema de propriedades personalizadas de cada modelo',
      'Ideias/Pautas — o backlog de ideias enviadas pelos clientes'
    ]),
    _kb_mcp2_h(3, 'Taxas por visualização e ig_score'),
    _kb_mcp2_p('Cada post publicado expõe quatro taxas calculadas sobre o número de visualizações únicas (impressões): taxa de compartilhamentos, taxa de curtidas, taxa de salvamentos e taxa de comentários. Com base nessas taxas, o Mesaas calcula um ig_score (0–100) que posiciona o post em relação ao histórico de posts do próprio cliente — quanto mais alto, melhor o desempenho relativo.'),
    _kb_mcp2_callout('📊', 'purple', 'O ig_score usa uma heurística interna alinhada ao Instagram (compartilhamentos > curtidas > salvamentos > comentários). O Instagram não publica os pesos reais; dados de Reels e repost não estão disponíveis na API pública.'),
    _kb_mcp2_p('O baseline de desempenho agora reporta os quartis por taxa (Q1, mediana, Q3) e o número de amostras por métrica. Isso permite ao agente identificar quais posts ficaram acima ou abaixo da mediana do cliente em cada dimensão.'),
    _kb_mcp2_h(2, 'Escrita'),
    _kb_mcp2_p('Com escopos de escrita, o agente pode criar e ajustar conteúdo em rascunho:'),
    _kb_mcp2_ul(ARRAY[
      'Criar fluxo — abre um fluxo de produção, opcionalmente a partir de um modelo',
      'Criar post — cria um post em rascunho dentro de um fluxo',
      'Editar post — ajusta título, formato, corpo e legenda e avança o status apenas para estágios internos (rascunho ou revisão interna)',
      'Definir propriedade — preenche uma propriedade personalizada do post (ex.: modo, anotação)',
      'Criar modelo de fluxo — cria um modelo com etapas e, opcionalmente, propriedades personalizadas'
    ]),
    _kb_mcp2_h(2, 'O fluxo completo de conteúdo'),
    _kb_mcp2_p('Combinando as ferramentas, o agente percorre todo o caminho de criação:'),
    _kb_mcp2_ol(ARRAY[
      'Lê marca, briefing, estratégia e baseline de taxas do cliente',
      'Identifica formatos e horários com melhor ig_score histórico',
      'Cria ou reaproveita um modelo de fluxo',
      'Abre um fluxo de produção',
      'Rascunha os posts',
      'Marca as propriedades de cada post',
      'Revisa os rascunhos com base no feedback do cliente'
    ]),
    _kb_mcp2_h(2, 'Escopos necessários'),
    _kb_mcp2_callout('💡', 'blue', 'Leitura exige os escopos de leitura correspondentes; criar e editar posts exige Posts (escrita); criar modelos exige Modelos (escrita). Taxas e ig_score são expostos automaticamente junto das métricas de posts — nenhum escopo adicional é necessário.')
  ),
  'claude-e-ia',
  ARRAY['mcp', 'claude', 'ferramentas', 'posts', 'fluxos', 'ia', 'ig_score', 'taxas', 'baseline'],
  6
);

-- ============================================================
-- Cleanup helper functions
-- ============================================================

DROP FUNCTION IF EXISTS _kb_mcp2_upsert_article(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_mcp2_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_mcp2_doc(VARIADIC jsonb[]);
DROP FUNCTION IF EXISTS _kb_mcp2_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_mcp2_ol(text[]);
DROP FUNCTION IF EXISTS _kb_mcp2_ul(text[]);
DROP FUNCTION IF EXISTS _kb_mcp2_h(int, text);
DROP FUNCTION IF EXISTS _kb_mcp2_p(text);
DROP FUNCTION IF EXISTS _kb_mcp2_text(text);
