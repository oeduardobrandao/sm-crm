-- Artigo "Como exportar seus dados do Notion, Trello e ClickUp" + context
-- links para /importar e cross-link no artigo legado de importacoes.
--
-- Texto puro (sem imagens). Se no futuro forem adicionadas imagens via
-- inlineImage, lembrar de usar o cast `::jsonb[]` no array de images do
-- helper _kb_pp_ol (ver 20260806000003 para o padrao).

-- -----------------------------------------------------------------------
-- Helpers (prefixo _kb_imp_)
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _kb_imp_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_imp_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_imp_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_imp_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_imp_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_imp_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_imp_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_imp_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_imp_ol(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_imp_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_imp_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_imp_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_imp_plain(doc jsonb) RETURNS text AS $$
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

CREATE OR REPLACE FUNCTION _kb_imp_upsert(
  p_id uuid, p_title text, p_slug text, p_excerpt text, p_content jsonb,
  p_category text, p_tags text[], p_display_order integer
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES (p_id, p_title, p_slug, p_excerpt, p_content, _kb_imp_plain(p_content), p_category, p_tags, 'published', p_display_order)
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

CREATE OR REPLACE FUNCTION _kb_imp_link(
  p_route_pattern text, p_slug text, p_label text, p_display_order integer
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

-- -----------------------------------------------------------------------
-- Artigo
-- -----------------------------------------------------------------------

SELECT _kb_imp_upsert(
  'aaaaaaaa-001b-4000-a000-00000000001b',
  'Como exportar seus dados do Notion, Trello e ClickUp',
  'como-exportar-seus-dados-do-notion-trello-e-clickup',
  'De qual página, quadro ou lista exportar em cada ferramenta, e em qual formato, antes de importar no Mesaas.',
  _kb_imp_doc(
    _kb_imp_h(2, 'Antes de começar'),
    _kb_imp_p('O Assistente de Importação aceita até 5 arquivos por vez, cada um com no máximo 20 MB, e até 2.000 linhas por importação. Os arquivos são lidos no seu navegador. Nenhum arquivo é enviado para nossos servidores.'),
    _kb_imp_p('Depois de importar, você pode desfazer a importação inteira em até 7 dias.'),

    _kb_imp_h(2, 'O jeito mais completo: um agente de IA com MCP'),
    _kb_imp_p('Se você usa o Claude, o ChatGPT ou o Codex, pode conectar o agente ao Mesaas via MCP e pedir algo como "migre meus clientes e o calendário do Notion para o Mesaas". O agente lê os dados direto na outra ferramenta e cria clientes, posts e tarefas por aqui, sem você precisar exportar arquivos.'),
    _kb_imp_p('Veja como conectar no artigo Como conectar o Claude, o ChatGPT ou o Codex ao Mesaas.'),
    _kb_imp_callout('💡', 'blue', 'O agente consegue fazer coisas que o assistente de arquivos não faz, como trazer briefings, descrições e campos personalizados. Para migrações grandes ou complexas, é o caminho recomendado.'),

    _kb_imp_h(2, 'Notion: exporte uma vez, da página certa'),
    _kb_imp_p('No Notion, cada página e cada base de dados tem o seu próprio botão "Exportar". É comum exportar a página de um cliente só e receber um zip que não contém nenhuma tabela.'),
    _kb_imp_callout('⚠️', 'orange', 'Exporte a partir da página mais de cima que contém a lista de clientes (a que mostra todos eles), não a página de um cliente individual. Com "Incluir subpáginas" marcado, todas as bases de dados que estão dentro vêm junto em um único zip.'),
    _kb_imp_ol(ARRAY[
      'No Notion, abra a página mais de cima que contém a lista de clientes.',
      'Clique em ••• no canto superior direito e escolha "Exportar".',
      'Em "Formato de exportação", escolha "Markdown & CSV".',
      'Marque "Incluir subpáginas": é isso que traz as bases de dados que estão dentro da página.',
      'Se aparecer a opção de incluir arquivos e imagens, escolha não incluir. O zip fica menor.',
      'Envie o .zip no Assistente de Importação, escolhendo a origem "Notion".'
    ]),
    _kb_imp_p('Não é preciso exportar cliente por cliente. Só tabelas e bases de dados (arquivos CSV dentro do zip) são importadas. Textos de páginas e briefings não entram nesta importação.'),

    _kb_imp_h(2, 'Trello: um JSON por quadro'),
    _kb_imp_p('A exportação do Trello é feita quadro a quadro. Cada quadro gera um arquivo .json separado.'),
    _kb_imp_ol(ARRAY[
      'Abra o quadro que quer trazer.',
      'Vá em Menu → Mais → Imprimir e exportar → "Exportar como JSON".',
      'Salve o arquivo .json.',
      'Repita para cada quadro (até 5 por importação).',
      'Envie os arquivos .json no Assistente de Importação, escolhendo a origem "Trello".'
    ]),
    _kb_imp_callout('💡', 'blue', 'Tem mais de 5 quadros? Importe os 5 primeiros e repita o assistente para os demais.'),
    _kb_imp_p('Se você tem o export em CSV do Trello Premium, use a origem "Planilha (CSV)" no assistente.'),

    _kb_imp_h(2, 'ClickUp: a Lista em CSV, não XLSX'),
    _kb_imp_p('O ClickUp oferece exportação em CSV e em XLSX (Excel). O formato Excel não é aceito pelo assistente. Na hora de exportar, escolha CSV.'),
    _kb_imp_ol(ARRAY[
      'No ClickUp, abra a Lista (ou o Espaço) que quer trazer.',
      'Clique em ••• → "Baixar" (ou "Exportar") e escolha CSV.',
      'Repita para cada lista (até 5 por importação).',
      'Envie os arquivos .csv no Assistente de Importação, escolhendo a origem "ClickUp".'
    ]),

    _kb_imp_h(2, 'Planilha genérica (CSV)'),
    _kb_imp_p('Para qualquer outra ferramenta, exporte ou salve os dados como CSV.'),
    _kb_imp_ol(ARRAY[
      'No Google Sheets: Arquivo → Fazer download → Valores separados por vírgula (.csv).',
      'No Excel: Arquivo → Salvar como → CSV.',
      'A primeira linha do arquivo precisa conter os títulos das colunas.',
      'Envie o arquivo .csv no Assistente de Importação, escolhendo a origem "Planilha (CSV)".'
    ]),

    _kb_imp_h(2, 'Erros comuns e como resolver'),
    _kb_imp_ul(ARRAY[
      '"Nenhuma tabela foi encontrada": o zip do Notion contém apenas páginas, sem bases de dados CSV. Exporte de novo a partir da página mais de cima, com "Incluir subpáginas" marcado.',
      '"O arquivo é um .zip, não um JSON do Trello": você enviou um zip (provavelmente do Notion) na origem Trello. Volte e escolha a origem "Notion".',
      '"O arquivo está no formato Excel (.xlsx)": exporte de novo escolhendo o formato CSV.',
      '"O arquivo é um JSON, mas não é a exportação de um quadro do Trello": o JSON enviado não tem a estrutura de um quadro. No Trello, a exportação é feita quadro a quadro.',
      '"O arquivo parece uma planilha (CSV), não um JSON do Trello": você enviou um CSV na origem Trello. Se é o CSV do Trello Premium, use a origem "Planilha (CSV)".'
    ])
  ),
  'primeiros-passos',
  ARRAY['importacao','notion','trello','clickup','csv','exportacao','migracao'],
  7
);

-- -----------------------------------------------------------------------
-- Context links para /importar
-- -----------------------------------------------------------------------

SELECT _kb_imp_link('/importar', 'como-exportar-seus-dados-do-notion-trello-e-clickup', 'Como exportar seus dados', 0);
SELECT _kb_imp_link('/importar', 'como-conectar-o-claude-mcp', 'Migrar com um agente (MCP)', 1);
SELECT _kb_imp_link('/importar', 'importacoes-via-csv-no-mesaas', NULL, 2);

-- -----------------------------------------------------------------------
-- Cross-link no artigo legado de importacoes
-- -----------------------------------------------------------------------

UPDATE kb_articles
SET content = jsonb_set(
  content,
  '{content}',
  content->'content' || jsonb_build_array(
    _kb_imp_h(2, 'Guia detalhado de exportação'),
    _kb_imp_p('Para instruções passo a passo de como exportar do Notion, Trello e ClickUp, veja o artigo Como exportar seus dados do Notion, Trello e ClickUp. Ou abra o Assistente de Importação direto em Importar dados no CRM.')
  )
),
content_plain = _kb_imp_plain(
  jsonb_set(
    content,
    '{content}',
    content->'content' || jsonb_build_array(
      _kb_imp_h(2, 'Guia detalhado de exportação'),
      _kb_imp_p('Para instruções passo a passo de como exportar do Notion, Trello e ClickUp, veja o artigo Como exportar seus dados do Notion, Trello e ClickUp. Ou abra o Assistente de Importação direto em Importar dados no CRM.')
    )
  )
)
WHERE slug = 'importacoes-via-csv-no-mesaas'
  AND content_plain NOT LIKE '%Assistente de Importação%';

-- -----------------------------------------------------------------------
-- Limpeza dos helpers
-- -----------------------------------------------------------------------

DROP FUNCTION IF EXISTS _kb_imp_link(text, text, text, integer);
DROP FUNCTION IF EXISTS _kb_imp_upsert(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_imp_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_imp_ol(text[]);
DROP FUNCTION IF EXISTS _kb_imp_ul(text[]);
DROP FUNCTION IF EXISTS _kb_imp_doc(jsonb[]);
DROP FUNCTION IF EXISTS _kb_imp_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_imp_h(int, text);
DROP FUNCTION IF EXISTS _kb_imp_p(text);
DROP FUNCTION IF EXISTS _kb_imp_text(text);
