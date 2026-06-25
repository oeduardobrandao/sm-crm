-- Seed Knowledge Base help articles for the Claude/MCP integration.
-- Category: claude-e-ia (rendered second on the Ajuda page).
-- Idempotent: ON CONFLICT DO UPDATE; helper functions are dropped at the end.

-- ============================================================
-- Helper builders (TipTap/ProseMirror JSONB)
-- ============================================================

CREATE OR REPLACE FUNCTION _kb_mcp_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_mcp_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_mcp_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_mcp_p(item)))
    ) FROM unnest(items) AS item));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp_ol(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_mcp_p(item)))
    ) FROM unnest(items) AS item));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_mcp_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_mcp_plain(doc jsonb) RETURNS text AS $$
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

CREATE OR REPLACE FUNCTION _kb_mcp_upsert_article(
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
    p_id, p_title, p_slug, p_excerpt, p_content, _kb_mcp_plain(p_content), p_category, p_tags, 'published', p_display_order
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

CREATE OR REPLACE FUNCTION _kb_mcp_link(
  p_route_pattern text,
  p_slug text,
  p_label text,
  p_display_order integer
) RETURNS void AS $$
DECLARE
  v_article_id uuid;
BEGIN
  SELECT id INTO v_article_id FROM kb_articles WHERE slug = p_slug;

  IF v_article_id IS NULL THEN
    RAISE EXCEPTION 'KB article slug not found: %', p_slug;
  END IF;

  INSERT INTO kb_context_links (route_pattern, article_id, label, display_order)
  VALUES (p_route_pattern, v_article_id, p_label, p_display_order)
  ON CONFLICT (route_pattern, article_id) DO UPDATE SET
    label = EXCLUDED.label,
    display_order = EXCLUDED.display_order;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Articles
-- ============================================================

-- 1. Como conectar o Claude (MCP)
SELECT _kb_mcp_upsert_article(
  'bbbbbbbb-0001-4000-b000-000000000001',
  'Como conectar o Claude (MCP)',
  'como-conectar-o-claude-mcp',
  'Conecte um agente Claude ao seu workspace por conector (sem chave) ou por chave de API.',
  _kb_mcp_doc(
    _kb_mcp_h(2, 'O que é o MCP'),
    _kb_mcp_p('O MCP (Model Context Protocol) conecta um agente Claude ao seu workspace do Mesaas. Com ele, o agente pode ler informações como clientes, posts, pautas e fluxos e, quando você autoriza, criar rascunhos de conteúdo — sempre dentro dos limites que você define.'),
    _kb_mcp_h(2, 'Onde encontrar'),
    _kb_mcp_p('Abra Configurações e acesse a página Claude (MCP). Apenas proprietários e administradores podem gerenciar a integração, e o recurso precisa estar liberado no seu plano.'),
    _kb_mcp_h(2, 'Método recomendado — claude.ai e Claude Desktop (sem chave)'),
    _kb_mcp_ol(ARRAY[
      'No Claude, abra Configurações, vá em Conectores e clique em Adicionar conector personalizado',
      'Copie a URL do MCP exibida na página Claude (MCP) do Mesaas, cole no Claude e deixe os campos de OAuth em branco',
      'Clique em Adicionar, faça login no Mesaas, escolha o workspace e as permissões e clique em Autorizar'
    ]),
    _kb_mcp_callout('💡', 'blue', 'Essa é a forma mais simples: não envolve chaves e a conexão pode ser revogada a qualquer momento direto no Mesaas.'),
    _kb_mcp_h(2, 'Claude Code, API ou agentes headless (com chave)'),
    _kb_mcp_ol(ARRAY[
      'Na página Claude (MCP), clique em Criar chave de API e dê um nome (ex.: Agente de conteúdo)',
      'Escolha as permissões da chave e copie o valor exibido (formato mesaas_sk_…), que aparece uma única vez',
      'Use o comando pronto (Claude Code) ou o bloco de configuração (Claude Desktop) mostrado na página; se já tiver uma chave, use Conectar ao lado dela'
    ]),
    _kb_mcp_callout('⚠️', 'orange', 'A chave é mostrada apenas no momento da criação. Guarde-a em local seguro; se perdê-la, gere uma nova e revogue a antiga.'),
    _kb_mcp_h(2, 'Permissões (escopos)'),
    _kb_mcp_p('Ao conectar, você escolhe os escopos de acesso. Conceda apenas o necessário:'),
    _kb_mcp_ul(ARRAY[
      'Clientes, Posts, Fluxos e Ideias/Pautas (leitura) — para o agente consultar informações',
      'Posts (escrita) — para criar e editar rascunhos de posts e fluxos',
      'Modelos (escrita) — para criar modelos de fluxo'
    ]),
    _kb_mcp_p('O preset de agente vem somente com leitura. A escrita é opcional e deve ser ativada por você.'),
    _kb_mcp_h(2, 'Gerenciar e revogar acesso'),
    _kb_mcp_p('Na seção Conexões Claude você vê as conexões ativas e pode desconectar para revogar o acesso na hora. Chaves de API podem ser revogadas individualmente na lista de chaves.'),
    _kb_mcp_h(2, 'Primeiros comandos'),
    _kb_mcp_callout('✅', 'green', 'Depois de conectar, peça ao agente: "liste meus clientes ativos" ou "mostre o post X com métricas".')
  ),
  'claude-e-ia',
  ARRAY['mcp', 'claude', 'conector', 'chave-api', 'integracao', 'ia'],
  5
);

-- 2. O que o agente pode fazer
SELECT _kb_mcp_upsert_article(
  'bbbbbbbb-0002-4000-b000-000000000002',
  'O que o agente pode fazer',
  'o-que-o-agente-pode-fazer',
  'As ferramentas de leitura e escrita disponíveis e o fluxo completo de criação de conteúdo.',
  _kb_mcp_doc(
    _kb_mcp_h(2, 'Visão geral'),
    _kb_mcp_p('Com o MCP conectado, o agente Claude trabalha como um colaborador de bastidores: ele consulta as informações do workspace e, quando autorizado, prepara rascunhos de conteúdo. Veja o que cada conjunto de ferramentas permite.'),
    _kb_mcp_h(2, 'Leitura'),
    _kb_mcp_p('Com escopos de leitura, o agente pode consultar:'),
    _kb_mcp_ul(ARRAY[
      'Clientes — lista e detalhes com campos não sensíveis',
      'Perfil de marca e briefing — especialidade, cores, fontes e respostas do briefing',
      'Páginas do hub — estratégias e materiais publicados para o cliente',
      'Posts — pipeline com formato, modo, anotações e métricas quando publicados',
      'Detalhe do post — conteúdo completo, mídia com link temporário e métricas',
      'Baseline de desempenho — quartis por métrica e formato a partir do histórico do Instagram',
      'Feedback do cliente — aprovações, correções e mensagens, com a linha do tempo de status',
      'Fluxos — os fluxos de produção do workspace',
      'Modelos de fluxo — etapas e o esquema de propriedades personalizadas de cada modelo',
      'Ideias/Pautas — o backlog de ideias enviadas pelos clientes'
    ]),
    _kb_mcp_h(2, 'Escrita'),
    _kb_mcp_p('Com escopos de escrita, o agente pode criar e ajustar conteúdo em rascunho:'),
    _kb_mcp_ul(ARRAY[
      'Criar fluxo — abre um fluxo de produção, opcionalmente a partir de um modelo',
      'Criar post — cria um post em rascunho dentro de um fluxo',
      'Editar post — ajusta título, formato, corpo e legenda e avança o status apenas para estágios internos (rascunho ou revisão interna)',
      'Definir propriedade — preenche uma propriedade personalizada do post (ex.: modo, anotação)',
      'Criar modelo de fluxo — cria um modelo com etapas e, opcionalmente, propriedades personalizadas'
    ]),
    _kb_mcp_h(2, 'O fluxo completo de conteúdo'),
    _kb_mcp_p('Combinando as ferramentas, o agente percorre todo o caminho de criação:'),
    _kb_mcp_ol(ARRAY[
      'Lê marca, briefing, estratégia e baseline do cliente',
      'Cria ou reaproveita um modelo de fluxo',
      'Abre um fluxo de produção',
      'Rascunha os posts',
      'Marca as propriedades de cada post',
      'Revisa os rascunhos com base no feedback do cliente'
    ]),
    _kb_mcp_callout('💡', 'blue', 'Leitura exige os escopos de leitura correspondentes; criar e editar posts exige Posts (escrita); criar modelos exige Modelos (escrita).')
  ),
  'claude-e-ia',
  ARRAY['mcp', 'claude', 'ferramentas', 'posts', 'fluxos', 'ia'],
  6
);

-- 3. Limites e segurança
SELECT _kb_mcp_upsert_article(
  'bbbbbbbb-0003-4000-b000-000000000003',
  'Limites e segurança',
  'limites-e-seguranca-do-agente',
  'O que o agente nunca faz — publicação, envio ao cliente, exclusões e isolamento de dados.',
  _kb_mcp_doc(
    _kb_mcp_h(2, 'O que o agente nunca faz'),
    _kb_mcp_p('A integração foi desenhada para manter o controle com você. O agente atua apenas até o ponto da revisão humana — nunca além.'),
    _kb_mcp_h(2, 'Não publica'),
    _kb_mcp_p('O agente não publica nem agenda nada no Instagram. A publicação continua sendo uma ação humana.'),
    _kb_mcp_h(2, 'Não envia ao cliente'),
    _kb_mcp_p('O agente não move posts para estágios visíveis ao cliente. Se ele editar um post que já está visível ao cliente, o post volta automaticamente para revisão interna. O portão de aprovação humano é obrigatório.'),
    _kb_mcp_h(2, 'Escrita apenas em rascunho e estágios internos'),
    _kb_mcp_p('As ferramentas de escrita só operam em rascunhos e estágios internos editáveis. Fora disso, a ação é recusada.'),
    _kb_mcp_h(2, 'Não exclui nada'),
    _kb_mcp_p('Nenhuma ferramenta apaga clientes, posts, fluxos, modelos ou ideias.'),
    _kb_mcp_h(2, 'Não acessa dados sensíveis'),
    _kb_mcp_p('A leitura de clientes é limitada a campos não sensíveis. O agente não vê financeiro, contratos nem dados brutos de contato e cobrança.'),
    _kb_mcp_h(2, 'Isolamento por workspace'),
    _kb_mcp_p('Cada conexão enxerga apenas o workspace autorizado. Não há acesso cruzado entre contas.'),
    _kb_mcp_h(2, 'Ideias e feedback são somente leitura'),
    _kb_mcp_p('O agente pode ler ideias e feedback, mas não cria pautas nem feedback no lugar do cliente.'),
    _kb_mcp_h(2, 'Privilégio mínimo e privacidade'),
    _kb_mcp_ul(ARRAY[
      'O preset de agente vem somente com leitura; a escrita é opcional',
      'Erros retornam mensagens genéricas, sem vazar detalhes internos',
      'Os logs de auditoria registram identificadores, filtros e contagens — nunca o conteúdo dos posts'
    ]),
    _kb_mcp_callout('🔒', 'purple', 'Pense no agente como um colaborador de rascunho: ele acelera a produção, mas nada chega ao cliente ou ao público sem a sua aprovação. Isso ajuda a manter conformidade com a LGPD e com as regras do CFM para conteúdo médico.')
  ),
  'claude-e-ia',
  ARRAY['mcp', 'claude', 'seguranca', 'limites', 'lgpd', 'ia'],
  7
);

-- ============================================================
-- Context links: surface these on the Claude (MCP) page
-- ============================================================

SELECT _kb_mcp_link('/configuracao/mcp', 'como-conectar-o-claude-mcp', NULL, 0);
SELECT _kb_mcp_link('/configuracao/mcp', 'o-que-o-agente-pode-fazer', NULL, 1);
SELECT _kb_mcp_link('/configuracao/mcp', 'limites-e-seguranca-do-agente', NULL, 2);

-- ============================================================
-- Cleanup helper functions
-- ============================================================

DROP FUNCTION IF EXISTS _kb_mcp_link(text, text, text, integer);
DROP FUNCTION IF EXISTS _kb_mcp_upsert_article(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_mcp_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_mcp_doc(VARIADIC jsonb[]);
DROP FUNCTION IF EXISTS _kb_mcp_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_mcp_ol(text[]);
DROP FUNCTION IF EXISTS _kb_mcp_ul(text[]);
DROP FUNCTION IF EXISTS _kb_mcp_h(int, text);
DROP FUNCTION IF EXISTS _kb_mcp_p(text);
DROP FUNCTION IF EXISTS _kb_mcp_text(text);
