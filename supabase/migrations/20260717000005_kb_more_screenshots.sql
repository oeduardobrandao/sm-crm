-- Add screenshots to four more Tier-1 procedural KB articles (Entregas,
-- Hub do Cliente, Instagram, Claude/MCP), continuing the pattern started in
-- 20260717000002_kb_article_screenshots.sql.
--
-- Images are inlineImage nodes with r2Key = NULL and a permanent public URL
-- from the kb-images bucket. r2Key MUST stay NULL. If it were set, the reader
-- (ArtigoPage.tsx -> extractR2Keys) would POST it to sign-r2-urls, which only
-- signs a key when it is under the CALLER's own conta prefix
-- (contas/<callerContaId>/) or exact-matches a published kb_articles
-- cover_image_url (sign-r2-urls/handler.ts:98-113). A KB body image is neither
-- for a cross-conta reader -- kb_articles has no conta_id, and these files live
-- in a public Supabase Storage bucket, not the R2 conta path -- so it would not
-- resolve, the node would keep whatever presigned src it was authored with, and
-- that 3600s URL would 403 an hour later. NULL bypasses that path entirely and
-- the permanent public src renders verbatim.
--
-- Articles are re-declared in full (not patched), matching
-- _kb_shot_upsert_article / _kb_shot2_upsert_article's whole-doc pattern.
-- Source of truth for the prose:
--   - Entregas (como-criar-e-gerenciar-fluxos) and Hub do Cliente
--     (como-configurar-o-hub-do-cliente) and Instagram
--     (como-conectar-o-instagram): 20260520000001_expand_kb_help_center.sql,
--     which upserts over the original 20260519000002 seed.
--   - Claude/MCP (como-conectar-o-claude-mcp): 20260624000002_seed_kb_mcp_articles.sql.
-- The only content changes vs. those sources: the ordered/bullet lists that
-- carry screenshots become _kb_shot2_ol_shots/_kb_shot2_ul_shots, and the MCP
-- article gets two standalone inlineImage nodes inserted between existing
-- blocks. All other prose is byte-identical to the live source.

CREATE OR REPLACE FUNCTION _kb_shot2_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot2_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_shot2_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot2_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_shot2_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot2_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_shot2_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot2_ol(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_shot2_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot2_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_shot2_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_shot2_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

-- An inlineImage node. r2Key is always NULL -- see header comment.
CREATE OR REPLACE FUNCTION _kb_shot2_img(src text, alt text, w int, h int) RETURNS jsonb AS $$
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
CREATE OR REPLACE FUNCTION _kb_shot2_ol_shots(items text[], images jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content',
        CASE WHEN images[i] IS NULL
             THEN jsonb_build_array(_kb_shot2_p(items[i]))
             ELSE jsonb_build_array(_kb_shot2_p(items[i]), images[i])
        END)
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

-- Same as _kb_shot2_ol_shots but a bulletList (no attrs.start). images[i] may
-- be NULL for items without a capture.
CREATE OR REPLACE FUNCTION _kb_shot2_ul_shots(items text[], images jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content',
        CASE WHEN images[i] IS NULL
             THEN jsonb_build_array(_kb_shot2_p(items[i]))
             ELSE jsonb_build_array(_kb_shot2_p(items[i]), images[i])
        END)
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

-- inlineImage nodes carry no 'text', so they are naturally skipped.
CREATE OR REPLACE FUNCTION _kb_shot2_plain(doc jsonb) RETURNS text AS $$
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

CREATE OR REPLACE FUNCTION _kb_shot2_upsert_article(
  p_id uuid, p_title text, p_slug text, p_excerpt text, p_content jsonb,
  p_category text, p_tags text[], p_display_order integer
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES (p_id, p_title, p_slug, p_excerpt, p_content, _kb_shot2_plain(p_content), p_category, p_tags, 'published', p_display_order)
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
-- Como criar e gerenciar fluxos
-- ============================================================
SELECT _kb_shot2_upsert_article(
  'aaaaaaaa-0006-4000-a000-000000000006',
  'Como criar e gerenciar fluxos',
  'como-criar-e-gerenciar-fluxos',
  'Crie fluxos de entrega, acompanhe etapas, use visualizações e filtre o trabalho ativo.',
  _kb_shot2_doc(
    _kb_shot2_h(2, 'O que são fluxos?'),
    _kb_shot2_p('Fluxos são projetos de entrega para clientes. Eles organizam etapas, responsáveis, prazos, posts, aprovações e histórico de execução. Use-os para transformar um processo recorrente em uma operação acompanhável.'),
    _kb_shot2_h(2, 'Criando um fluxo'),
    _kb_shot2_ol_shots(
      ARRAY[
        'Acesse Entregas',
        'Clique em Novo Fluxo',
        'Selecione o cliente e, se fizer sentido, um template',
        'Revise etapas, responsáveis e prazos',
        'Defina se o fluxo é recorrente',
        'Salve e acompanhe a execução pela visualização escolhida'
      ],
      ARRAY[
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/01-step-acessar-entregas.png', 'Página Entregas aberta pelo menu lateral.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/02-step-novo-fluxo.png', 'Botão Novo Fluxo destacado no topo da página Entregas.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/03-step-selecionar-cliente-template.png', 'Modal Novo Fluxo de Entrega com cliente e template selecionados.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/04-step-revisar-etapas.png', 'Etapas do fluxo com responsáveis e prazos para revisar.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/05-step-fluxo-recorrente.png', 'Opção de fluxo recorrente no modal de criação.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/06-step-acompanhar-execucao.png', 'Fluxo em execução exibido na visualização Kanban.', 1440, 900)
      ]
    ),
    _kb_shot2_h(2, 'Visualizações disponíveis'),
    _kb_shot2_ul_shots(
      ARRAY[
        'Kanban - visão operacional por etapa',
        'Gráfico - leitura visual de progresso e volume',
        'Calendário - prazos e entregas por data',
        'Lista - visão compacta para busca e comparação',
        'Concluídas - histórico dos fluxos finalizados'
      ],
      ARRAY[
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/01-view-kanban.png', 'Visualização Kanban dos fluxos por etapa.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/02-view-grafico.png', 'Visualização em gráfico do progresso dos fluxos.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/03-view-calendario.png', 'Visualização em calendário com prazos e entregas.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-criar-e-gerenciar-fluxos/04-view-lista.png', 'Visualização em lista dos fluxos.', 1440, 900),
        NULL
      ]
    ),
    _kb_shot2_h(2, 'Filtros úteis'),
    _kb_shot2_p('Use filtros por busca, cliente, status, responsável da etapa, responsável do post, etapa, template, atrasados, urgentes ou em dia. Esses filtros ajudam a encontrar gargalos rapidamente.'),
    _kb_shot2_callout('📌', 'orange', 'Para prazos avançados, propriedades customizadas e templates recorrentes, veja o artigo Templates, prazos e propriedades de fluxos.')
  ),
  'entregas-e-fluxos',
  ARRAY['fluxos', 'entregas', 'kanban', 'templates', 'etapas', 'responsaveis'],
  30
);

-- ============================================================
-- Como configurar o Hub do Cliente
-- ============================================================
SELECT _kb_shot2_upsert_article(
  'aaaaaaaa-0008-4000-a000-000000000008',
  'Como configurar o Hub do Cliente',
  'como-configurar-o-hub-do-cliente',
  'Ative o portal do cliente e entenda aprovações, postagens, marca, briefing, páginas e ideias.',
  _kb_shot2_doc(
    _kb_shot2_h(2, 'O que é o Hub do Cliente?'),
    _kb_shot2_p('O Hub do Cliente é um portal com link único onde o cliente acompanha aprovações, postagens, marca, páginas, briefing, ideias e, quando houver Instagram conectado, alguns dados de performance. O cliente não precisa criar conta para acessar.'),
    _kb_shot2_h(2, 'Ativando o acesso'),
    _kb_shot2_ol_shots(
      ARRAY[
        'Abra o detalhe do cliente',
        'Vá até a seção Hub do Cliente',
        'Ative o Hub para gerar ou reativar o link',
        'Use visualizar para conferir a experiência antes de enviar',
        'Copie o link e compartilhe com o cliente por e-mail, WhatsApp ou canal combinado'
      ],
      ARRAY[
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-configurar-o-hub-do-cliente/01-abrir-detalhe-cliente.png', 'Página de detalhe do cliente aberta.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-configurar-o-hub-do-cliente/02-ir-para-hub-do-cliente.png', 'Seção Hub do Cliente na página do cliente.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-configurar-o-hub-do-cliente/03-hub-ja-ativo.png', 'Hub ativo com link de acesso e botões Copiar, Preview e Desativar.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-configurar-o-hub-do-cliente/04-visualizar-preview.png', 'Prévia do Hub como o cliente vê, com as abas Home, Aprovações e Postagens.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-configurar-o-hub-do-cliente/05-copiar-link.png', 'Link do Hub copiado, com a confirmação exibida.', 1440, 900)
      ]
    ),
    _kb_shot2_callout('⚠️', 'orange', 'Apenas proprietários e admins gerenciam o Hub. Agentes podem ver avisos de permissão quando a ação for restrita.'),
    _kb_shot2_h(2, 'O que configurar antes de enviar'),
    _kb_shot2_ul(ARRAY[
      'Aprovações - posts prontos para o cliente aprovar ou pedir correção',
      'Postagens - calendário editorial com status visíveis ao cliente',
      'Marca - logo, cores, fontes e arquivos de referência',
      'Páginas - documentos em markdown para processos, combinados e materiais fixos',
      'Briefing - perguntas organizadas por seção, com respostas salvas pelo cliente',
      'Ideias - espaço para sugestões de conteúdo enviadas pelo cliente'
    ]),
    _kb_shot2_h(2, 'Gerenciando o link'),
    _kb_shot2_p('Você pode copiar, visualizar, desativar e reativar o Hub sem apagar os dados já configurados. Reative quando quiser devolver o acesso ao cliente.')
  ),
  'hub-do-cliente',
  ARRAY['hub', 'portal', 'cliente', 'aprovacao', 'briefing', 'marca', 'ideias'],
  40
);

-- ============================================================
-- Como conectar o Instagram
-- ============================================================
SELECT _kb_shot2_upsert_article(
  'aaaaaaaa-0009-4000-a000-000000000009',
  'Como conectar o Instagram',
  'como-conectar-o-instagram',
  'Conecte contas profissionais do Instagram para analytics, agendamento, publicação e Post Express.',
  _kb_shot2_doc(
    _kb_shot2_h(2, 'Pré-requisitos'),
    _kb_shot2_ul(ARRAY[
      'A conta do Instagram deve ser Profissional, Business ou Creator',
      'A conta precisa estar vinculada a uma Página do Facebook',
      'A pessoa que autoriza precisa ter acesso suficiente para conceder permissões',
      'Permissões de leitura alimentam Analytics; permissões de publicação liberam agendar, publicar agora e Post Express'
    ]),
    _kb_shot2_h(2, 'Conectando a conta'),
    _kb_shot2_ol_shots(
      ARRAY[
        'Abra o detalhe do cliente',
        'Na seção Instagram, clique em Conectar Instagram',
        'Autorize pelo Facebook',
        'Selecione a página vinculada à conta correta',
        'Confirme permissões e aguarde a primeira sincronização'
      ],
      ARRAY[
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-conectar-o-instagram/01-abrir-detalhe-cliente.png', 'Página de detalhe do cliente aberta.', 1440, 900),
        _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-conectar-o-instagram/02-conectar-instagram.png', 'Seção Instagram com o botão Conectar com o Instagram.', 1440, 900),
        NULL,
        NULL,
        NULL
      ]
    ),
    _kb_shot2_callout('⚠️', 'orange', 'Se a conta não aparecer, confirme se ela é profissional, está ligada a uma página do Facebook e se a pessoa logada no Facebook tem permissão sobre essa página.'),
    _kb_shot2_h(2, 'Solução de problemas'),
    _kb_shot2_ul(ARRAY[
      'Token expirado - reconecte a conta para renovar a autorização',
      'Permissões revogadas - peça ao responsável para autorizar novamente pelo Facebook',
      'Sem permissão de publicação - analytics pode funcionar, mas agendar, publicar agora e Post Express ficam bloqueados',
      'Conta desconectada ou revogada - revise o status no cliente antes de tentar publicar'
    ]),
    _kb_shot2_h(2, 'Depois de conectar'),
    _kb_shot2_p('A conta passa a alimentar Analytics, relatórios por conta, seleção de cliente no Post Express, agendamento de posts e a experiência de performance no Hub quando disponível.')
  ),
  'instagram-e-analytics',
  ARRAY['instagram', 'conexao', 'facebook', 'oauth', 'sync', 'permissoes', 'publicacao'],
  50
);

-- ============================================================
-- Como conectar o Claude (MCP)
-- ============================================================
SELECT _kb_shot2_upsert_article(
  'bbbbbbbb-0001-4000-b000-000000000001',
  'Como conectar o Claude (MCP)',
  'como-conectar-o-claude-mcp',
  'Conecte um agente Claude ao seu workspace por conector (sem chave) ou por chave de API.',
  _kb_shot2_doc(
    _kb_shot2_h(2, 'O que é o MCP'),
    _kb_shot2_p('O MCP (Model Context Protocol) conecta um agente Claude ao seu workspace do Mesaas. Com ele, o agente pode ler informações como clientes, posts, pautas e fluxos e, quando você autoriza, criar rascunhos de conteúdo — sempre dentro dos limites que você define.'),
    _kb_shot2_h(2, 'Onde encontrar'),
    _kb_shot2_p('Abra Configurações e acesse a página Claude (MCP). Apenas proprietários e administradores podem gerenciar a integração, e o recurso precisa estar liberado no seu plano.'),
    _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-conectar-o-claude-mcp/01-pagina-mcp.png', 'Página Claude (MCP) em Configurações, com a URL do conector e as instruções.', 1440, 900),
    _kb_shot2_h(2, 'Método recomendado — claude.ai e Claude Desktop (sem chave)'),
    _kb_shot2_ol(ARRAY[
      'No Claude, abra Configurações, vá em Conectores e clique em Adicionar conector personalizado',
      'Copie a URL do MCP exibida na página Claude (MCP) do Mesaas, cole no Claude e deixe os campos de OAuth em branco',
      'Clique em Adicionar, faça login no Mesaas, escolha o workspace e as permissões e clique em Autorizar'
    ]),
    _kb_shot2_callout('💡', 'blue', 'Essa é a forma mais simples: não envolve chaves e a conexão pode ser revogada a qualquer momento direto no Mesaas.'),
    _kb_shot2_h(2, 'Claude Code, API ou agentes headless (com chave)'),
    _kb_shot2_ol(ARRAY[
      'Na página Claude (MCP), clique em Criar chave de API e dê um nome (ex.: Agente de conteúdo)',
      'Escolha as permissões da chave e copie o valor exibido (formato mesaas_sk_…), que aparece uma única vez',
      'Use o comando pronto (Claude Code) ou o bloco de configuração (Claude Desktop) mostrado na página; se já tiver uma chave, use Conectar ao lado dela'
    ]),
    _kb_shot2_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-conectar-o-claude-mcp/02-criar-chave.png', 'Modal Criar chave de API com nome e permissões de leitura selecionadas.', 1440, 900),
    _kb_shot2_callout('⚠️', 'orange', 'A chave é mostrada apenas no momento da criação. Guarde-a em local seguro; se perdê-la, gere uma nova e revogue a antiga.'),
    _kb_shot2_h(2, 'Permissões (escopos)'),
    _kb_shot2_p('Ao conectar, você escolhe os escopos de acesso. Conceda apenas o necessário:'),
    _kb_shot2_ul(ARRAY[
      'Clientes, Posts, Fluxos e Ideias/Pautas (leitura) — para o agente consultar informações',
      'Posts (escrita) — para criar e editar rascunhos de posts e fluxos',
      'Modelos (escrita) — para criar modelos de fluxo'
    ]),
    _kb_shot2_p('O preset de agente vem somente com leitura. A escrita é opcional e deve ser ativada por você.'),
    _kb_shot2_h(2, 'Gerenciar e revogar acesso'),
    _kb_shot2_p('Na seção Conexões Claude você vê as conexões ativas e pode desconectar para revogar o acesso na hora. Chaves de API podem ser revogadas individualmente na lista de chaves.'),
    _kb_shot2_h(2, 'Primeiros comandos'),
    _kb_shot2_callout('✅', 'green', 'Depois de conectar, peça ao agente: "liste meus clientes ativos" ou "mostre o post X com métricas".')
  ),
  'claude-e-ia',
  ARRAY['mcp', 'claude', 'conector', 'chave-api', 'integracao', 'ia'],
  5
);

-- ============================================================
-- Cleanup helper functions (matches the pattern in prior kb migrations)
-- ============================================================
DROP FUNCTION IF EXISTS _kb_shot2_upsert_article(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_shot2_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_shot2_ul_shots(text[], jsonb[]);
DROP FUNCTION IF EXISTS _kb_shot2_ol_shots(text[], jsonb[]);
DROP FUNCTION IF EXISTS _kb_shot2_img(text, text, int, int);
DROP FUNCTION IF EXISTS _kb_shot2_doc(jsonb[]);
DROP FUNCTION IF EXISTS _kb_shot2_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_shot2_ol(text[]);
DROP FUNCTION IF EXISTS _kb_shot2_ul(text[]);
DROP FUNCTION IF EXISTS _kb_shot2_h(int, text);
DROP FUNCTION IF EXISTS _kb_shot2_p(text);
DROP FUNCTION IF EXISTS _kb_shot2_text(text);
