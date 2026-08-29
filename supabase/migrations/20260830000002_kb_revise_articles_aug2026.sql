-- Revisao dos artigos existentes da Central de Ajuda para os lancamentos de
-- agosto/2026 (abas do cliente, visao Grade, migracao de template, status
-- personalizados, personalizacao do Hub, limpeza automatica de midia, link de
-- autoconexao do Instagram, Visualizacoes como KPI, Datas Comemorativas,
-- causas acionaveis de falha, mencoes com @, ferramentas de importacao do MCP
-- e reforma do Post Express).
--
-- Tres tecnicas, nesta ordem:
--   1. Re-declaracao completa (_kb_rv_upsert) para artigos com mudanca
--      estrutural. como-usar-o-post-express troca as 6 capturas antigas (do
--      layout anterior a reforma do stepper, PR #330) por 6 novas, tiradas
--      via e2e/screenshots/post-express.spec.ts e hospedadas no bucket
--      publico kb-images; o Calendario ganha a captura da aba Datas
--      Comemorativas (e2e/screenshots/kb-agosto.spec.ts).
--   2. Append idempotente (_kb_rv_append, padrao do 20260826000003) para
--      artigos que so ganham secoes novas -- preserva as capturas existentes.
--      O marcador e um trecho unico do conteudo novo: presente no
--      content_plain, o append vira no-op.
--   3. Patch textual pontual (_kb_rv_replace_text) para trocar "secao" por
--      "aba" nos passos que apontavam para a antiga pagina unica do cliente
--      (reestruturada em abas roteadas no PR #362). Os textos sao frases
--      unicas sem caracteres especiais de JSON, entao replace sobre
--      content::text e seguro e idempotente.

-- -----------------------------------------------------------------------
-- Helpers (prefixo _kb_rv_), dropados no fim
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _kb_rv_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_rv_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_rv_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_rv_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_rv_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_rv_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_rv_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_rv_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_rv_ol(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_rv_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_rv_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_rv_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

-- inlineImage com r2Key NULL + URL publica permanente do bucket kb-images
-- (ver o cabecalho de 20260717000003 para o porque do r2Key nulo).
CREATE OR REPLACE FUNCTION _kb_rv_img(src text, alt text, w int, h int) RETURNS jsonb AS $$
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

-- orderedList onde o passo i carrega uma captura opcional abaixo do texto.
-- images[i] pode ser NULL; SEMPRE passar o array com cast ::jsonb[] (um array
-- todo-NULL sem cast vira text[] e o call quebra com 42883).
CREATE OR REPLACE FUNCTION _kb_rv_ol_shots(items text[], images jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content',
        CASE WHEN images[i] IS NULL
             THEN jsonb_build_array(_kb_rv_p(items[i]))
             ELSE jsonb_build_array(_kb_rv_p(items[i]), images[i])
        END)
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_rv_plain(doc jsonb) RETURNS text AS $$
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

CREATE OR REPLACE FUNCTION _kb_rv_upsert(
  p_id uuid, p_title text, p_slug text, p_excerpt text, p_content jsonb,
  p_category text, p_tags text[], p_display_order integer
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES (p_id, p_title, p_slug, p_excerpt, p_content, _kb_rv_plain(p_content), p_category, p_tags, 'published', p_display_order)
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

-- Append idempotente: adiciona os nos ao fim do doc quando o marcador ainda
-- nao aparece no content_plain; regenera o content_plain sempre.
CREATE OR REPLACE FUNCTION _kb_rv_append(p_slug text, p_marker text, VARIADIC nodes jsonb[]) RETURNS void AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM kb_articles WHERE slug = p_slug;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'KB article slug not found: %', p_slug;
  END IF;
  UPDATE kb_articles
     SET content = jsonb_set(content, '{content}', (content->'content') || to_jsonb(nodes))
   WHERE id = v_id
     AND content_plain NOT LIKE '%' || p_marker || '%';
  UPDATE kb_articles SET content_plain = _kb_rv_plain(content) WHERE id = v_id;
END;
$$ LANGUAGE plpgsql;

-- Troca pontual de texto dentro do doc. Usar apenas com frases unicas sem
-- aspas, barras invertidas ou caracteres de controle (JSON-safe).
CREATE OR REPLACE FUNCTION _kb_rv_replace_text(p_slug text, p_from text, p_to text) RETURNS void AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM kb_articles WHERE slug = p_slug;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'KB article slug not found: %', p_slug;
  END IF;
  UPDATE kb_articles
     SET content = replace(content::text, p_from, p_to)::jsonb
   WHERE id = v_id
     AND content::text LIKE '%' || p_from || '%';
  UPDATE kb_articles SET content_plain = _kb_rv_plain(content) WHERE id = v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _kb_rv_link(
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

-- =======================================================================
-- 1. RE-DECLARACOES COMPLETAS
-- =======================================================================

-- Como usar o Post Express: reforma em stepper de 5 etapas + modo Aprovacao
-- do cliente (PRs #330/#332). Perde as capturas antigas de proposito.
SELECT _kb_rv_upsert(
  'aaaaaaaa-000b-4000-a000-00000000000b',
  'Como usar o Post Express',
  'como-usar-o-post-express',
  'Publique rapidamente no Instagram, na hora ou com aprovação do cliente, sem montar uma entrega completa.',
  _kb_rv_doc(
    _kb_rv_h(2, 'O que é o Post Express?'),
    _kb_rv_p('O Post Express publica conteúdo no Instagram de um cliente conectado sem montar um fluxo completo de produção. Ele é indicado para conteúdos rápidos, urgentes ou pontuais, e pode publicar na hora ou enviar o post para o cliente aprovar no portal antes.'),
    _kb_rv_h(2, 'Quem aparece na seleção'),
    _kb_rv_p('A lista mostra clientes com conta de Instagram conectada. Se um cliente não aparece, revise a conexão, o status da autorização e as permissões de publicação.'),
    _kb_rv_h(2, 'Publicando em cinco etapas'),
    _kb_rv_p('A página guia você por cinco etapas, de cima para baixo:'),
    _kb_rv_ol_shots(
      ARRAY[
        'Formato - escolha entre Publicação (feed, carrossel ou reels, detectado pela mídia) e Stories',
        'Cliente - selecione um cliente com Instagram conectado',
        'Mídia - envie as imagens ou o vídeo do post',
        'Legenda do Instagram - escreva a legenda, com o limite de 2.200 caracteres do Instagram',
        'Envio - escolha o modo de envio, confira o preview e confirme'
      ],
      ARRAY[
        _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/01-etapa-formato.png', 'Post Express recém-aberto, com o passo a passo em cinco etapas e o formato Publicação selecionado.', 1440, 900),
        _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/02-selecionar-cliente.png', 'Etapa Cliente com um cliente selecionado no seletor.', 1440, 900),
        _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/03-enviar-midia.png', 'Etapa Mídia com uma imagem enviada e marcada como capa.', 1440, 900),
        _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/04-escrever-legenda.png', 'Etapa Legenda do Instagram com o texto preenchido e o contador de caracteres.', 1440, 900),
        _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/05-modo-de-envio.png', 'Etapa Envio com o modo Publicar agora selecionado e o preview do post.', 1440, 900)
      ]::jsonb[]
    ),
    _kb_rv_callout('💡', 'blue', 'O tipo é detectado pela mídia: várias imagens viram carrossel, vídeo tende a Reels e imagem única vira Feed. Vídeos podem exigir thumbnail para publicação.'),
    _kb_rv_h(2, 'Publicar agora ou enviar para aprovação'),
    _kb_rv_p('Na etapa de Envio, o campo Modo de envio tem duas opções:'),
    _kb_rv_ul(ARRAY[
      'Publicar agora - o post vai direto para o Instagram do cliente, sem passar por fluxo nem aprovação. É o modo clássico do Post Express',
      'Aprovação do cliente - nada é publicado agora. O post é enviado para o portal do cliente, que aprova ou pede correção por lá, como em qualquer post de fluxo'
    ]),
    _kb_rv_p('No modo de aprovação, se o cliente tiver a publicação automática ligada, o post é publicado sozinho assim que ele aprovar. A tela avisa se o cliente ainda não tem um link ativo do portal: nesse caso, crie ou reative o link na página do cliente antes de enviar.'),
    _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-usar-o-post-express/06-aprovacao-do-cliente.png', 'Modo Aprovação do cliente selecionado, com a confirmação de link do portal ativo para o cliente.', 1440, 900),
    _kb_rv_callout('✅', 'green', 'Use a aprovação do cliente quando o combinado exige o aval dele, mas a peça não precisa de um fluxo inteiro de produção. O feedback aparece no post e no feed de Mensagens.'),
    _kb_rv_h(2, 'O que acontece nos bastidores'),
    _kb_rv_p('O CRM cria um registro operacional para manter histórico da publicação. Se você abandonar um rascunho vazio, ele pode ser limpo automaticamente. Quando a publicação termina, o post fica registrado como concluído ou com erro para acompanhamento.'),
    _kb_rv_h(2, 'Erros comuns'),
    _kb_rv_ul(ARRAY[
      'Token expirado ou revogado',
      'Permissão de publicação ausente',
      'Legenda vazia ou acima do limite',
      'Vídeo sem thumbnail quando exigido',
      'Conta do cliente desconectada'
    ])
  ),
  'post-express',
  ARRAY['post-express', 'publicacao', 'instagram', 'rapido', 'aprovacao', 'thumbnail', 'permissoes'],
  60
);

-- Bem-vindo ao Mesaas: modulos novos (Mensagens, Tarefas, Automacoes,
-- Relatorios interativos) + secao Hoje do Dashboard.
SELECT _kb_rv_upsert(
  'aaaaaaaa-0001-4000-a000-000000000001',
  'Bem-vindo ao Mesaas',
  'bem-vindo-ao-mesaas',
  'Conheça os módulos do CRM, os perfis de acesso e a navegação principal.',
  _kb_rv_doc(
    _kb_rv_h(2, 'O que é o Mesaas?'),
    _kb_rv_p('O Mesaas é uma plataforma de gestão para social media managers e agências. Ele centraliza clientes, leads, entregas, tarefas, mensagens, arquivos, financeiro, equipe, contratos, analytics do Instagram, relatórios e o Hub do Cliente.'),
    _kb_rv_h(2, 'Principais módulos'),
    _kb_rv_ul(ARRAY[
      'Dashboard - abre com a seção Hoje, as pendências do dia ajustadas ao seu papel, seguida de KPIs, contratos próximos do vencimento, pagamentos, prazos, aniversários e datas importantes',
      'Leads e Clientes - acompanhe oportunidades, converta leads, cadastre clientes e mantenha dados comerciais, operacionais e de Instagram em um só lugar',
      'Entregas - organize fluxos, etapas, responsáveis, prazos, posts, aprovações, comentários, mídia e publicações',
      'Mensagens - as conversas com cada cliente em um só lugar: mensagens trocadas pelo Hub e feedback dos posts em um feed único',
      'Tarefas - o quadro de pendências internas da equipe, com responsável, prazo, subtarefas e vínculo com cliente',
      'Arquivos - armazene pastas, peças, vídeos, thumbnails, documentos e materiais reutilizáveis por cliente ou projeto',
      'Calendário - veja pagamentos previstos, prazos de fluxos, aniversários, datas importantes e a aba Datas Comemorativas por nicho',
      'Ideias - receba sugestões enviadas pelos clientes pelo Hub e acompanhe status, comentários e reações',
      'Analytics - acompanhe desempenho de Instagram por portfólio, conta e post, além dos gargalos dos fluxos de entrega',
      'Relatórios interativos - relatórios de Instagram montados em blocos, personalizados com a cara da agência e entregues pelo Hub, com exportação em PDF',
      'Automações - respostas automáticas no Instagram: comentário com palavra-chave vira DM, conforme o plano',
      'Financeiro e Contratos - controle receitas, despesas, projeções, contratos vigentes e vencimentos',
      'Equipe - gerencie membros, custos, vínculos e responsáveis por etapas ou posts',
      'Hub do Cliente e Post Express - dê acesso ao cliente para aprovações e publique conteúdos rápidos sem montar um fluxo completo'
    ]),
    _kb_rv_h(2, 'Perfis de acesso'),
    _kb_rv_ul(ARRAY[
      'Proprietário - acesso total ao workspace, configurações, financeiro, contratos e permissões',
      'Admin - acesso amplo para operar e administrar o workspace',
      'Agente - acesso operacional a clientes, entregas, calendário, arquivos, analytics permitidos e ajuda, sem financeiro, contratos ou configurações restritas'
    ]),
    _kb_rv_callout('💡', 'blue', 'Se você está começando agora, siga o checklist do Dashboard: cliente, lead, equipe, Instagram e primeiro fluxo. Cada etapa libera uma parte importante da operação.'),
    _kb_rv_h(2, 'Como navegar'),
    _kb_rv_p('No desktop, use o menu lateral para alternar entre os módulos. No mobile, use a barra inferior e o botão Mais para abrir o restante da navegação. A área Ajuda mostra artigos gerais e também sugestões contextuais conforme a página atual.')
  ),
  'primeiros-passos',
  ARRAY['inicio', 'visao-geral', 'navegacao', 'dashboard', 'onboarding'],
  1
);

-- Como adicionar e gerenciar clientes: pagina do cliente reestruturada em
-- 7 abas roteadas (PR #362).
SELECT _kb_rv_upsert(
  'aaaaaaaa-0003-4000-a000-000000000003',
  'Como adicionar e gerenciar clientes',
  'como-adicionar-e-gerenciar-clientes',
  'Cadastre clientes, navegue pelas abas da página do cliente e acompanhe entregas, redes sociais, Hub e financeiro.',
  _kb_rv_doc(
    _kb_rv_h(2, 'Adicionando um novo cliente'),
    _kb_rv_ol(ARRAY[
      'Acesse Clientes no menu lateral',
      'Clique em Novo Cliente',
      'Preencha nome, e-mail, telefone, plano, valor mensal, dia de pagamento, dia de entrega e especialidade',
      'Salve o cadastro e complete os detalhes quando necessário'
    ]),
    _kb_rv_callout('💡', 'blue', 'O dia de pagamento alimenta receitas previstas no Financeiro e no Calendário. O dia de entrega pode ser usado em fluxos com prazo baseado na data de entrega do cliente.'),
    _kb_rv_h(2, 'A página do cliente em abas'),
    _kb_rv_p('Ao abrir um cliente, a página se organiza em abas, agrupadas em três blocos:'),
    _kb_rv_ul(ARRAY[
      'Visão geral - dados de contato, plano, status, datas importantes e o resumo do cliente',
      'Entregas - os fluxos e posts daquele cliente',
      'Redes sociais - conexão do Instagram e das demais contas, sincronização e status da autorização',
      'Relatórios - os relatórios interativos do cliente e o atalho para o Analytics completo',
      'Hub - o portal do cliente, com o link de acesso e a prévia',
      'Arquivos - os arquivos do cliente na biblioteca',
      'Financeiro - valores, cobranças e histórico, visível conforme a permissão financeira do seu papel'
    ]),
    _kb_rv_p('Cada aba tem endereço próprio, então dá para favoritar ou compartilhar o link direto de uma aba com a equipe.'),
    _kb_rv_callout('📌', 'orange', 'Procurando a conexão do Instagram? Ela fica na aba Redes sociais. Os botões de reconectar espalhados pelo sistema também levam para lá.'),
    _kb_rv_h(2, 'Status do cliente'),
    _kb_rv_ul(ARRAY[
      'Ativo - cliente em atendimento regular',
      'Pausado - atendimento temporariamente suspenso',
      'Encerrado - contrato finalizado ou cliente inativo'
    ]),
    _kb_rv_h(2, 'Importação via CSV'),
    _kb_rv_p('Use a importação por CSV para cadastrar vários clientes. Revise nomes, e-mails, telefone, plano, valor mensal, dia de pagamento e campos obrigatórios antes de importar para evitar cadastros duplicados ou incompletos.')
  ),
  'clientes',
  ARRAY['clientes', 'cadastro', 'abas', 'csv', 'importacao', 'hub', 'arquivos', 'instagram'],
  10
);

-- Entendendo o painel de Analytics: Visualizacoes como metrica de destaque
-- (PR #331).
SELECT _kb_rv_upsert(
  'aaaaaaaa-000a-4000-a000-00000000000a',
  'Entendendo o painel de Analytics',
  'entendendo-o-painel-de-analytics',
  'Leia métricas consolidadas do portfólio, destaques, alertas e desempenho das contas conectadas.',
  _kb_rv_doc(
    _kb_rv_h(2, 'Visão geral do portfólio'),
    _kb_rv_p('O painel de Analytics mostra uma leitura consolidada das contas de Instagram conectadas. Use-o para comparar clientes, encontrar oportunidades e priorizar contas que precisam de atenção.'),
    _kb_rv_h(2, 'Indicadores principais'),
    _kb_rv_ul(ARRAY[
      'Visualizações - quantas vezes o conteúdo das contas foi visto no período, com a variação em relação ao período anterior; é a métrica de destaque do painel',
      'Contas conectadas e contas com dados recentes',
      'Total de seguidores e crescimento no período',
      'Alcance, impressões e engajamento médio',
      'Posts de melhor e pior desempenho',
      'Contas silenciosas ou com baixa atividade recente'
    ]),
    _kb_rv_h(2, 'Destaques e alertas'),
    _kb_rv_p('A área de destaques ajuda a identificar melhor engajamento, maior crescimento, maior alcance, maior audiência e contas mais ativas. Os alertas apontam contas sem publicações recentes ou com sinais de queda.'),
    _kb_rv_h(2, 'Usando os rankings'),
    _kb_rv_p('Ordene tabelas e listas por seguidores, engajamento, alcance, posts recentes ou outros indicadores para decidir onde investigar mais. Para uma leitura detalhada, abra o analytics da conta específica.'),
    _kb_rv_callout('🧠', 'purple', 'Este artigo cobre o portfólio. Para melhores horários, tags, demografia e relatórios de uma conta específica, veja Analytics por conta.')
  ),
  'instagram-e-analytics',
  ARRAY['analytics', 'metricas', 'visualizacoes', 'engajamento', 'alcance', 'portfolio', 'instagram'],
  51
);

-- Analytics por conta: Visualizacoes na abertura + Relatorios Interativos.
SELECT _kb_rv_upsert(
  'aaaaaaaa-0018-4000-a000-000000000018',
  'Analytics por conta: melhores horários, tags e relatórios',
  'analytics-por-conta-melhores-horarios-tags-e-relatorios',
  'Analise uma conta conectada em profundidade e transforme métricas em decisões editoriais.',
  _kb_rv_doc(
    _kb_rv_h(2, 'Quando usar analytics por conta'),
    _kb_rv_p('Abra uma conta específica quando precisar entender o desempenho de um cliente em detalhes. Essa visão complementa o painel de portfólio com métricas, gráficos, posts e relatórios da conta.'),
    _kb_rv_h(2, 'Leituras disponíveis'),
    _kb_rv_ul(ARRAY[
      'Visualizações do período, a métrica de abertura da conta',
      'Histórico de seguidores',
      'Alcance, impressões e engajamento',
      'Demografia quando disponível',
      'Melhores horários para publicar',
      'Posts com mais alcance, engajamento, curtidas, comentários, salvos e compartilhamentos',
      'Performance por tipo de conteúdo',
      'Tags aplicadas aos posts'
    ]),
    _kb_rv_h(2, 'Usando filtros e ordenação'),
    _kb_rv_p('Filtre e ordene posts por data, formato, alcance, engajamento, curtidas, comentários, salvos e compartilhamentos. Use tags para agrupar editoriais, campanhas, temas ou hipóteses de conteúdo.'),
    _kb_rv_h(2, 'Relatórios'),
    _kb_rv_p('A seção de relatórios da conta tem dois formatos:'),
    _kb_rv_ul(ARRAY[
      'Relatórios Interativos - o formato atual: gere um relatório do mês, monte e personalize em blocos e entregue pelo Hub, com opção de PDF. O artigo Como montar um relatório interativo mostra o passo a passo',
      'Relatórios Gerados - o formato anterior, de página única, que continua disponível para consulta e download'
    ]),
    _kb_rv_callout('💡', 'blue', 'As melhores decisões vêm da combinação entre métricas da conta, calendário do cliente e status das entregas.')
  ),
  'instagram-e-analytics',
  ARRAY['analytics', 'conta', 'visualizacoes', 'tags', 'relatorios', 'melhores horarios', 'instagram'],
  52
);

-- Calendario: aba Datas Comemorativas com 5 nichos (PR #336).
SELECT _kb_rv_upsert(
  'aaaaaaaa-0019-4000-a000-000000000019',
  'Usando o Calendário para finanças, prazos e datas importantes',
  'usando-o-calendario-para-financas-prazos-e-datas-importantes',
  'Acompanhe pagamentos, prazos de entregas, aniversários, datas importantes e oportunidades de conteúdo.',
  _kb_rv_doc(
    _kb_rv_h(2, 'Abas do Calendário'),
    _kb_rv_p('O Calendário reúne eventos financeiros, operacionais e editoriais. Use a aba financeira para pagamentos, prazos e datas importantes, e a aba Datas Comemorativas para oportunidades de conteúdo por nicho.'),
    _kb_rv_h(2, 'Eventos financeiros'),
    _kb_rv_ul(ARRAY[
      'Receitas previstas de clientes ativos',
      'Despesas previstas da equipe',
      'Transações manuais agendadas',
      'Confirmação de pagamentos previstos para criar transações reais'
    ]),
    _kb_rv_h(2, 'Eventos operacionais'),
    _kb_rv_ul(ARRAY[
      'Prazos de fluxos e etapas',
      'Aniversários de clientes',
      'Datas importantes cadastradas no cliente',
      'Alertas que ajudam a antecipar conteúdo, cobranças e entregas'
    ]),
    _kb_rv_h(2, 'A aba Datas Comemorativas'),
    _kb_rv_p('Além dos eventos dos seus clientes, o Calendário tem a aba Datas Comemorativas: um banco de datas relevantes para pautas de conteúdo, organizado por nicho. Escolha entre Médico, Jurídico, Varejo, Beleza e Estética ou Gastronomia no seletor, e o calendário mostra as datas daquele mercado no mês, prontas para virarem ideia de post.'),
    _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/usando-o-calendario-para-financas-prazos-e-datas-importantes/01-datas-comemorativas.png', 'Aba Datas Comemorativas com o seletor de nicho, os filtros por categoria e as datas do mês.', 1440, 900),
    _kb_rv_p('A escolha do nicho fica memorizada para a próxima visita. As datas são uma referência global do sistema, iguais para todos os workspaces, e não se misturam com os eventos dos seus clientes.'),
    _kb_rv_callout('📌', 'orange', 'Agentes podem ter acesso limitado a eventos financeiros. Para confirmar pagamentos, use um perfil com permissão adequada.')
  ),
  'financeiro',
  ARRAY['calendario', 'financeiro', 'prazos', 'datas importantes', 'aniversarios', 'datas comemorativas', 'nichos'],
  71
);

-- Agendar, publicar agora e resolver falhas: causas acionaveis (PR #310).
SELECT _kb_rv_upsert(
  'aaaaaaaa-0016-4000-a000-000000000016',
  'Agendar, publicar agora e resolver falhas no Instagram',
  'agendar-publicar-agora-e-resolver-falhas-no-instagram',
  'Prepare posts aprovados para publicação e entenda a causa e a solução quando uma publicação falha.',
  _kb_rv_doc(
    _kb_rv_h(2, 'Antes de agendar ou publicar'),
    _kb_rv_ul(ARRAY[
      'O cliente precisa ter Instagram conectado',
      'A conta precisa ter permissão de publicação ativa',
      'O post deve estar aprovado pelo cliente quando fizer parte do fluxo de aprovação',
      'A legenda do Instagram deve estar preenchida quando exigida',
      'Data e horário devem estar definidos para agendamento',
      'Vídeos devem ter thumbnail quando o formato exigir'
    ]),
    _kb_rv_h(2, 'Agendar publicação'),
    _kb_rv_p('Use agendamento quando o conteúdo deve sair em data e horário definidos. Depois de agendado, acompanhe o status pelo post, pelo calendário do cliente e pelas entregas. Se necessário, cancele o agendamento antes da publicação.'),
    _kb_rv_h(2, 'Publicar agora'),
    _kb_rv_p('Use publicar agora quando o conteúdo já está aprovado e pode ir imediatamente para o Instagram. O CRM tenta publicar com as permissões atuais da conta e registra sucesso ou falha.'),
    _kb_rv_h(2, 'Quando a publicação falha'),
    _kb_rv_p('Um post que falha ao publicar fica com o status Falha e mostra, no próprio post, um bloco com o que aconteceu, por que aconteceu e o que fazer. As causas que o sistema identifica e explica:'),
    _kb_rv_ul(ARRAY[
      'Conexão com o Instagram expirou - a autorização venceu ou foi revogada. Reconecte a conta na aba Redes sociais do cliente',
      'Mídia muito pesada para o Instagram - o arquivo passa dos limites da plataforma. Troque por uma versão mais leve',
      'Carrossel acima do limite do Instagram - o Instagram aceita no máximo 10 itens por carrossel',
      'Post sem mídia anexada - o post chegou à publicação sem arquivo',
      'Instagram não conseguiu processar a mídia - formato ou codificação que a plataforma rejeitou. Reexporte o arquivo',
      'Publicação preparada expirou no Instagram - a janela de preparação venceu antes do envio. Tente publicar de novo',
      'Limite de publicações do Instagram atingido - a conta bateu o teto diário de publicações via API. Aguarde e reagende',
      'Instabilidade temporária do Instagram - falha do lado da plataforma. O sistema tenta de novo sozinho'
    ]),
    _kb_rv_p('Falhas temporárias são retentadas automaticamente, até três vezes. Se todas falharem, além do bloco no post, o responsável recebe o aviso por e-mail, com a mesma explicação e a solução.'),
    _kb_rv_callout('✅', 'green', 'Resolvida a causa, use Agendar ou Publicar agora normalmente. O histórico da falha fica registrado no post.'),
    _kb_rv_callout('💡', 'blue', 'Post Express usa a mesma base de permissões do Instagram. Se Post Express estiver bloqueado, revise a conexão do cliente antes de tentar de novo.')
  ),
  'entregas-e-fluxos',
  ARRAY['agendamento', 'publicar agora', 'instagram', 'falha de publicação', 'falha_publicacao', 'thumbnail', 'permissoes'],
  34
);

-- Como conectar o Instagram: o fluxo real hoje e o login empresarial do
-- Instagram (instagram.com) com UMA tela de consentimento -- nao existe mais
-- o passo no Facebook nem o seletor de paginas que o texto descrevia
-- (verificado num connect real em 2026-08-29; capturas do proprio fluxo).
-- Re-declaracao completa; a secao do link de autoconexao continua vindo do
-- append logo abaixo.
SELECT _kb_rv_upsert(
  'aaaaaaaa-0009-4000-a000-000000000009',
  'Como conectar o Instagram',
  'como-conectar-o-instagram',
  'Conecte contas profissionais do Instagram para analytics, agendamento, publicação e Post Express.',
  _kb_rv_doc(
    _kb_rv_h(2, 'Pré-requisitos'),
    _kb_rv_ul(ARRAY[
      'A conta do Instagram deve ser Profissional, Business ou Creator',
      'Quem autoriza precisa do login da própria conta do Instagram; se a conta é do cliente, você pode pedir que ele autorize pelo link de conexão, descrito abaixo',
      'Permissões de leitura alimentam Analytics; a permissão de publicação libera agendar, publicar agora e Post Express'
    ]),
    _kb_rv_h(2, 'Conectando a conta'),
    _kb_rv_ol_shots(
      ARRAY[
        'Abra o cliente e vá até a aba Redes sociais',
        'Clique em Conectar Instagram; se a conexão expirou, o aviso na mesma aba traz o botão Reconectar',
        'Entre com a conta do Instagram do cliente na tela da Meta',
        'Revise as permissões solicitadas e confirme em Permitir'
      ],
      ARRAY[
        NULL,
        _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-conectar-o-instagram/02-reconectar-redes-sociais.png', 'Aba Redes sociais com o aviso de autorização expirada e a reconexão em andamento.', 1440, 900),
        NULL,
        _kb_rv_img('https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-conectar-o-instagram/04-permissoes-instagram.png', 'Tela de autorização do Instagram com as permissões solicitadas pelo Mesaas e o botão Permitir.', 1440, 900)
      ]::jsonb[]
    ),
    _kb_rv_callout('⚠️', 'orange', 'Mantenha a permissão de publicar conteúdo ligada na tela de autorização. Sem ela a conta conecta, os analytics funcionam, e o agendamento falha depois. É a causa mais comum de falha de publicação.'),
    _kb_rv_p('A tela de autorização aparece no idioma configurado na conta do Instagram, então pode estar em inglês, como no exemplo acima.'),
    _kb_rv_h(2, 'Solução de problemas'),
    _kb_rv_ul(ARRAY[
      'Token expirado - a Meta exige renovação periódica da conexão. Reconecte a conta pela aba Redes sociais',
      'Permissões revogadas - a autorização foi desfeita do lado do Instagram, geralmente após troca de senha ou revisão de segurança. Conecte novamente',
      'Sem permissão de publicação - a permissão de publicar conteúdo foi desligada na tela de autorização. Reconecte mantendo todas as permissões ligadas',
      'Conta desconectada - revise o status na aba Redes sociais antes de tentar publicar'
    ]),
    _kb_rv_h(2, 'Depois de conectar'),
    _kb_rv_p('A conta passa a alimentar Analytics, relatórios por conta, seleção de cliente no Post Express, agendamento de posts e a experiência de performance no Hub quando disponível.')
  ),
  'instagram-e-analytics',
  ARRAY['instagram', 'conexao', 'oauth', 'sync', 'permissoes', 'publicacao'],
  50
);

-- =======================================================================
-- 2. APPENDS IDEMPOTENTES (preservam capturas e conteudo existente)
-- =======================================================================

-- Como criar e gerenciar fluxos: visao Grade, status personalizados no
-- kanban e painel Como funciona (PRs #344, #372, #365/#366).
SELECT _kb_rv_append('como-criar-e-gerenciar-fluxos', 'feed do Instagram em três colunas',
  _kb_rv_h(2, 'A visão Grade: o feed antes de publicar'),
  _kb_rv_p('Com um fluxo aberto, alterne entre Posts, Calendário e Grade. A Grade mostra os posts do cliente como um feed do Instagram em três colunas, misturando o que já está publicado com o que está em produção, cada um na posição da data planejada.'),
  _kb_rv_p('Arraste um post para trocar a posição com outro: as datas de agendamento trocam junto. Posts já publicados são âncoras fixas, e um post agendado só aceita cair em uma posição futura. É a forma mais rápida de conferir a harmonia do feed antes de aprovar o mês.'),
  _kb_rv_h(2, 'Status personalizados no kanban'),
  _kb_rv_p('Além dos status padrão, o workspace pode ter status personalizados de posts, por exemplo Em design ou Em revisão de texto, criados em Configurações, na aba Status de posts. Eles aparecem como colunas e etiquetas próprias no kanban. O artigo Templates, prazos e propriedades de fluxos explica como criá-los.'),
  _kb_rv_h(2, 'Entenda a página pelo painel Como funciona'),
  _kb_rv_p('Na primeira visita, a página de Entregas mostra o painel Como funciona, um resumo visual de quem faz o quê: o que é ação da equipe (criar posts, avançar etapas, enviar ao cliente), o que chega do portal (aprovação do cliente) e o que é automático (post agendado publica na data, status vira Postado ou Falha, fluxo recorrente gera o próximo ciclo). Feche quando quiser; dá para reabrir pelo botão Como funciona.')
);

-- Templates, prazos e propriedades: migracao de template (PR #370) e status
-- personalizados com automacoes (PRs #296/#302).
SELECT _kb_rv_append('templates-prazos-e-propriedades-de-fluxos', 'Template de destino',
  _kb_rv_h(2, 'Migrando um fluxo para outro template'),
  _kb_rv_p('Mudou o processo da agência e o fluxo antigo ficou com etapas defasadas? Não precisa recriar o fluxo: migre-o para o template novo.'),
  _kb_rv_ol(ARRAY[
    'Abra o fluxo e entre na edição',
    'Use a ação Migrar template',
    'Escolha o Template de destino',
    'Responda em qual etapa o fluxo está agora, para o sistema saber onde retomar',
    'Confirme'
  ]),
  _kb_rv_p('Os posts e todo o conteúdo permanecem; as etapas passam a ser as do template novo, com o fluxo posicionado na etapa que você indicou. Antes de confirmar, o diálogo avisa o que acontece com as propriedades personalizadas: valores de propriedades que não existem no template de destino são perdidos na migração, e o aviso lista quais. Se nada se perde, ele diz isso explicitamente.'),
  _kb_rv_h(2, 'Status personalizados de posts'),
  _kb_rv_p('Os status padrão dos posts cobrem o essencial, mas cada agência tem seu vocabulário. Em Configurações, na aba Status de posts, você cria status próprios, por exemplo Em design:'),
  _kb_rv_ol(ARRAY[
    'Dê o nome do status e escolha em qual status padrão ele se comporta: isso define o que o sistema faz com o post, inclusive se o cliente o vê no portal',
    'Reordene com Subir e Descer para controlar a ordem das colunas no kanban',
    'Arquive um status quando não usar mais: os posts que estavam nele voltam ao status padrão correspondente'
  ]),
  _kb_rv_p('Cada status pode ter Automações por status: ao entrar um post naquele status, o sistema pode notificar o responsável do post, notificar owners e admins, notificar um membro específico ou atribuir um responsável automaticamente. É útil para avisar o designer assim que um post cai em Em design, sem ninguém precisar lembrar.')
);

-- Como configurar o Hub do Cliente: aba Mensagens e personalizacao visual
-- (PRs #364, #279).
SELECT _kb_rv_append('como-configurar-o-hub-do-cliente', 'Deixando o Hub com a cara da agência',
  _kb_rv_h(2, 'A aba Mensagens'),
  _kb_rv_p('O Hub também tem a aba Mensagens: o canal direto entre o cliente e a agência. O que ele escreve ali aparece para a equipe na página Mensagens do CRM, junto com o feedback deixado nos posts. Veja o artigo Mensagens: as conversas com cada cliente em um só lugar.'),
  _kb_rv_h(2, 'Deixando o Hub com a cara da agência'),
  _kb_rv_p('Em Configurações, na aba Hub, você controla o visual do portal que todos os seus clientes veem:'),
  _kb_rv_ul(ARRAY[
    'Cor da marca - aplicada a botões, navegação ativa e calendário, com contraste garantido automaticamente',
    'Logo no hub - a marca da agência dentro do portal, com variante própria para o modo escuro',
    'Tema de superfície - o clima geral, claro ou escuro. O cliente ainda pode alternar entre os dois',
    'Tipografia - combinações de fontes sugeridas, com ajuste fino se quiser',
    'Cantos e estilo de cards - a forma dos cards e controles'
  ]),
  _kb_rv_p('A Pré-visualização ao vivo mostra o resultado enquanto você mexe. Comece por uma combinação pronta nas Cores sugeridas e ajuste a partir dela.'),
  _kb_rv_callout('💡', 'blue', 'A personalização vale para o portal inteiro, todos os clientes veem o mesmo visual. A cor de marca também é herdada pelo tema Padrão dos relatórios interativos.')
);

-- Como o cliente aprova posts pelo Hub: Post Express e feed de Mensagens.
SELECT _kb_rv_append('como-o-cliente-aprova-posts-pelo-hub', 'Post Express no modo',
  _kb_rv_h(2, 'Posts do Post Express'),
  _kb_rv_p('A aprovação pelo Hub não vale só para posts de fluxo. Um post criado pelo Post Express no modo Aprovação do cliente chega ao portal do mesmo jeito, e o cliente aprova ou pede correção pela mesma tela. Se a publicação automática estiver ligada, o post aprovado vai direto para o Instagram.'),
  _kb_rv_h(2, 'Acompanhando pelo CRM'),
  _kb_rv_p('Tudo que o cliente faz na aprovação, aprovar, pedir correção, comentar, também aparece na página Mensagens do CRM, no feed daquele cliente. Você acompanha a conversa inteira sem sair de uma tela, e cada item do feed tem o atalho para abrir o post em questão.')
);

-- Como organizar e reutilizar arquivos: limpeza automatica de midia
-- publicada (PR #327).
SELECT _kb_rv_append('como-organizar-e-reutilizar-arquivos', 'Limpeza automática de mídia publicada',
  _kb_rv_h(2, 'Limpeza automática de mídia publicada'),
  _kb_rv_p('Depois que um post é publicado no Instagram, a mídia dele já cumpriu o papel, mas continua ocupando o armazenamento do plano. A limpeza automática resolve isso: ela remove a mídia de posts já publicados depois de um prazo que você escolhe.'),
  _kb_rv_p('Em Configurações, na aba Armazenamento, o dono do workspace define:'),
  _kb_rv_ul(ARRAY[
    'Quando remover a mídia após a publicação - Imediatamente, 7 dias, 30 dias ou 90 dias, contados a partir da publicação do post',
    'Limiar de uso - escolha entre Sempre ou Somente quando o uso passar de um percentual do plano, para a limpeza só agir quando o espaço aperta'
  ]),
  _kb_rv_p('O post em si nunca é apagado: legenda, histórico e comentários ficam. No lugar da mídia removida, o post mostra um marcador de mídia limpa, e o link da publicação no Instagram continua funcionando.'),
  _kb_rv_callout('⚠️', 'orange', 'A remoção é definitiva: o arquivo sai da biblioteca e não pode ser recuperado pelo sistema. Se costuma reaproveitar mídias antigas, use um prazo maior, ou o limiar de uso, para não perder material que ainda seria útil.')
);

-- O que o agente pode fazer: ferramentas de importacao do MCP (PR #313).
SELECT _kb_rv_append('o-que-o-agente-pode-fazer', 'Importação assistida',
  _kb_rv_h(2, 'Importação assistida'),
  _kb_rv_p('O agente também ajuda a povoar o workspace: ele pode criar clientes e membros de equipe, e listar os membros existentes. Isso permite, por exemplo, colar uma lista de clientes numa conversa com o Claude e pedir que ele cadastre todos, ou migrar dados de outra ferramenta conversando. As criações são seguras para repetição: se o agente tentar criar um cliente que já existe com o mesmo nome, o sistema reaproveita o registro existente e completa só os campos vazios, em vez de duplicar.'),
  _kb_rv_p('Para usar as ferramentas de importação, a chave ou conexão do agente precisa dos escopos de leitura e escrita de clientes e membros, concedidos na tela de conexão.')
);

-- Como conectar o Instagram: link de autoconexao do cliente (PR #308).
SELECT _kb_rv_append('como-conectar-o-instagram', 'Gerar link para o cliente',
  _kb_rv_h(2, 'Deixe o cliente conectar a própria conta'),
  _kb_rv_p('Nem sempre dá para conectar o Instagram na frente do cliente, e pedir a senha dele está fora de questão. Para esses casos, gere um link de conexão:'),
  _kb_rv_ol(ARRAY[
    'Abra o cliente e vá até a aba Redes sociais',
    'Clique em Gerar link para o cliente',
    'Copie o link, ou informe o e-mail e clique em Enviar'
  ]),
  _kb_rv_p('O cliente abre o link, vê o pedido da agência e clica em Conectar Instagram. Ele entra com a própria conta na tela da Meta e autoriza o acesso; a senha não é vista nem armazenada pelo Mesaas. Quando ele conclui, a conta aparece conectada no CRM, como se você tivesse feito a conexão.'),
  _kb_rv_p('O link tem validade e pode ser revogado a qualquer momento pela mesma tela. Se o cliente reportar link inválido ou expirado, gere um novo.'),
  _kb_rv_callout('💡', 'blue', 'No celular, o aplicativo do Instagram pode abrir sozinho no meio da autorização e travar o fluxo. Se acontecer, oriente o cliente a voltar para o navegador pela seta de retorno no canto superior da tela e tocar de novo em Conectar Instagram.')
);

-- Importacoes via CSV: caminho conversacional pelo agente (complementa a
-- secao de exportacao adicionada em 20260826000003).
SELECT _kb_rv_append('importacoes-via-csv-no-mesaas', 'Importando com o agente',
  _kb_rv_h(2, 'Importando com o agente (MCP)'),
  _kb_rv_p('Além dos CSVs e do Assistente de Importação, quem usa o agente do Mesaas pode colar os dados numa conversa e pedir que ele cadastre clientes e membros da equipe. O artigo O que o agente pode fazer explica os limites e os escopos necessários.')
);

-- Criando posts dentro de uma entrega: mencoes com @ (PR #287) e status
-- personalizados.
SELECT _kb_rv_append('criando-posts-dentro-de-uma-entrega', 'Mencionando pessoas',
  _kb_rv_h(2, 'Mencionando pessoas e itens com @'),
  _kb_rv_p('No texto e nos comentários do post, digite @ para mencionar:'),
  _kb_rv_ul(ARRAY[
    'Pessoas - quem for mencionado recebe notificação no sino e, se não ler, um e-mail com as menções pendentes',
    'Posts, clientes e tarefas - a menção vira um atalho clicável para o item, útil para dar contexto sem colar links'
  ]),
  _kb_rv_p('Use a menção a pessoas para pedir revisão ou avisar de mudança sem sair do post: é mais rastreável que avisar por fora, porque a conversa fica registrada onde o trabalho está.'),
  _kb_rv_h(2, 'Status personalizados'),
  _kb_rv_p('Se o workspace tem status personalizados configurados, eles aparecem aqui como opções de status do post, com o mesmo comportamento do status padrão em que se baseiam. A criação e as automações desses status estão no artigo Templates, prazos e propriedades de fluxos.')
);

-- =======================================================================
-- 3. PATCHES TEXTUAIS: "secao" da antiga pagina unica vira "aba"
-- =======================================================================

SELECT _kb_rv_replace_text('como-agendar-seu-primeiro-post',
  'Vá até a seção de Instagram na página do cliente',
  'Abra a aba Redes sociais na página do cliente');
SELECT _kb_rv_replace_text('como-agendar-seu-primeiro-post',
  'Seção de Instagram na página do cliente, com o painel da conta.',
  'Aba Redes sociais na página do cliente, com o painel da conta.');

SELECT _kb_rv_replace_text('como-configurar-o-hub-do-cliente',
  'Vá até a seção Hub do Cliente',
  'Abra a aba Hub');
SELECT _kb_rv_replace_text('como-configurar-o-hub-do-cliente',
  'Seção Hub do Cliente na página do cliente.',
  'Aba Hub na página do cliente.');

-- No guia de primeiro post, os passos de conexão descreviam o fluxo antigo
-- via Facebook (autorizar + seletor de páginas); o fluxo real é o login do
-- Instagram com uma tela de consentimento, e a exigência de Página do
-- Facebook não existe mais nesse caminho.
SELECT _kb_rv_replace_text('como-agendar-seu-primeiro-post',
  'A conta precisa ser profissional, comercial ou de criador, e estar vinculada a uma página do Facebook.',
  'A conta precisa ser profissional, comercial ou de criador.');
SELECT _kb_rv_replace_text('como-agendar-seu-primeiro-post',
  'Autorize o acesso na tela do Facebook',
  'Entre com a conta do Instagram do cliente');
SELECT _kb_rv_replace_text('como-agendar-seu-primeiro-post',
  'Escolha a página vinculada à conta do cliente',
  'Revise as permissões solicitadas na tela do Instagram');
SELECT _kb_rv_replace_text('como-agendar-seu-primeiro-post',
  'Confirme as permissões, incluindo a de publicação',
  'Confirme em Permitir, mantendo a permissão de publicação ligada');

-- =======================================================================
-- 4. Context links: artigo orfao ganha rotas
-- =======================================================================

SELECT _kb_rv_link('/clientes', 'como-o-cliente-aprova-posts-pelo-hub', 'Aprovação pelo Hub', 3);
SELECT _kb_rv_link('/entregas', 'como-o-cliente-aprova-posts-pelo-hub', 'Aprovação do cliente no Hub', 5);

-- -----------------------------------------------------------------------
-- Limpeza dos helpers
-- -----------------------------------------------------------------------

DROP FUNCTION IF EXISTS _kb_rv_link(text, text, text, integer);
DROP FUNCTION IF EXISTS _kb_rv_replace_text(text, text, text);
DROP FUNCTION IF EXISTS _kb_rv_append(text, text, VARIADIC jsonb[]);
DROP FUNCTION IF EXISTS _kb_rv_upsert(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_rv_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_rv_ol_shots(text[], jsonb[]);
DROP FUNCTION IF EXISTS _kb_rv_img(text, text, int, int);
DROP FUNCTION IF EXISTS _kb_rv_doc(VARIADIC jsonb[]);
DROP FUNCTION IF EXISTS _kb_rv_ul(text[]);
DROP FUNCTION IF EXISTS _kb_rv_ol(text[]);
DROP FUNCTION IF EXISTS _kb_rv_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_rv_h(int, text);
DROP FUNCTION IF EXISTS _kb_rv_p(text);
DROP FUNCTION IF EXISTS _kb_rv_text(text);
