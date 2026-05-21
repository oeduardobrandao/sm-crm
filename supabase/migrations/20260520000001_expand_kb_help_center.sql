-- Expand Help Center content with deeper CRM workflow guidance.

-- ============================================================
-- Helper functions for building TipTap/ProseMirror JSONB nodes
-- ============================================================

CREATE OR REPLACE FUNCTION _kb_expand_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_expand_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_expand_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_expand_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_expand_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_expand_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_expand_p(item)))
    ) FROM unnest(items) AS item));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_expand_ol(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_expand_p(item)))
    ) FROM unnest(items) AS item));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_expand_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_expand_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_expand_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_expand_plain(doc jsonb) RETURNS text AS $$
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

CREATE OR REPLACE FUNCTION _kb_expand_upsert_article(
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
    p_id, p_title, p_slug, p_excerpt, p_content, _kb_expand_plain(p_content), p_category, p_tags, 'published', p_display_order
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

CREATE OR REPLACE FUNCTION _kb_expand_link(
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
-- Updated existing articles
-- ============================================================

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0001-4000-a000-000000000001',
  'Bem-vindo ao Mesaas',
  'bem-vindo-ao-mesaas',
  'Conheça os módulos do CRM, os perfis de acesso e a navegação principal.',
  _kb_expand_doc(
    _kb_expand_h(2, 'O que é o Mesaas?'),
    _kb_expand_p('O Mesaas é uma plataforma de gestão para social media managers e agências. Ele centraliza clientes, leads, entregas, arquivos, financeiro, equipe, contratos, analytics do Instagram, analytics de fluxos e o Hub do Cliente.'),
    _kb_expand_h(2, 'Principais módulos'),
    _kb_expand_ul(ARRAY[
      'Dashboard - visão geral com KPIs, onboarding, eventos do dia, contratos próximos do vencimento, pagamentos, prazos, aniversários e datas importantes',
      'Leads e Clientes - acompanhe oportunidades, converta leads, cadastre clientes e mantenha dados comerciais, operacionais e de Instagram em um só lugar',
      'Entregas - organize fluxos, etapas, responsáveis, prazos, posts, aprovações, comentários, mídia e publicações',
      'Arquivos - armazene pastas, peças, vídeos, thumbnails, documentos e materiais reutilizáveis por cliente ou projeto',
      'Calendário - veja pagamentos previstos, prazos de fluxos, aniversários, datas importantes e oportunidades de conteúdo',
      'Ideias - receba sugestões enviadas pelos clientes pelo Hub e acompanhe status, comentários e reações',
      'Analytics - acompanhe desempenho de Instagram por portfólio, conta e post, além dos gargalos dos fluxos de entrega',
      'Financeiro e Contratos - controle receitas, despesas, projeções, contratos vigentes e vencimentos',
      'Equipe - gerencie membros, custos, vínculos e responsáveis por etapas ou posts',
      'Hub do Cliente e Post Express - dê acesso ao cliente para aprovações e publique conteúdos rápidos sem montar um fluxo completo'
    ]),
    _kb_expand_h(2, 'Perfis de acesso'),
    _kb_expand_ul(ARRAY[
      'Proprietário - acesso total ao workspace, configurações, financeiro, contratos e permissões',
      'Admin - acesso amplo para operar e administrar o workspace',
      'Agente - acesso operacional a clientes, entregas, calendário, arquivos, analytics permitidos e ajuda, sem financeiro, contratos ou configurações restritas'
    ]),
    _kb_expand_callout('💡', 'blue', 'Se você está começando agora, siga o checklist do Dashboard: cliente, lead, equipe, Instagram e primeiro fluxo. Cada etapa libera uma parte importante da operação.'),
    _kb_expand_h(2, 'Como navegar'),
    _kb_expand_p('No desktop, use o menu lateral para alternar entre os módulos. No mobile, use a barra inferior e o botão Mais para abrir o restante da navegação. A área Ajuda mostra artigos gerais e também sugestões contextuais conforme a página atual.')
  ),
  'primeiros-passos',
  ARRAY['inicio', 'visao-geral', 'navegacao', 'dashboard', 'onboarding'],
  1
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0002-4000-a000-000000000002',
  'Como configurar seu workspace',
  'como-configurar-seu-workspace',
  'Configure perfil, logo, membros, convites, papéis e sincronização do Instagram.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Configuração inicial'),
    _kb_expand_p('Ao criar sua conta, informe o nome da empresa ou agência e seu nome completo. Depois, você pode ajustar esses dados em Configurações junto com telefone, WhatsApp, senha e preferências do workspace.'),
    _kb_expand_h(2, 'Logo e identidade do workspace'),
    _kb_expand_ul(ARRAY[
      'Envie um logotipo em PNG, JPG ou WebP com até 2MB',
      'O arquivo é otimizado para uso no CRM e no Hub do Cliente',
      'Você pode remover ou substituir o logo a qualquer momento'
    ]),
    _kb_expand_h(2, 'Membros, convites e papéis'),
    _kb_expand_ol(ARRAY[
      'Acesse Configurações e abra a seção Membros do Workspace',
      'Convide uma pessoa pelo e-mail e escolha o papel de Admin ou Agente',
      'Acompanhe convites pendentes, expirados ou aceitos',
      'Use reenviar convite quando a pessoa não recebeu ou perdeu o prazo',
      'Cancele convites ou remova usuários que não devem mais acessar o workspace'
    ]),
    _kb_expand_callout('📌', 'orange', 'Equipe e workspace não são a mesma coisa: membros da Equipe representam profissionais e custos; usuários do workspace representam pessoas com login. Vincule os dois quando quiser atribuir tarefas e comentários com clareza.'),
    _kb_expand_h(2, 'Sincronização automática do Instagram'),
    _kb_expand_p('Quando houver contas de Instagram conectadas, você pode ativar a sincronização automática. Ela vale para as contas conectadas ao workspace e atualiza métricas periodicamente sem depender do botão de sincronização manual.'),
    _kb_expand_h(2, 'O que agentes conseguem alterar'),
    _kb_expand_p('Agentes têm foco operacional e podem encontrar avisos de permissão em áreas administrativas. Para alterar papéis, convites, logo do workspace, financeiro ou contratos, use uma conta de Proprietário ou Admin.')
  ),
  'primeiros-passos',
  ARRAY['workspace', 'configuracao', 'membros', 'convite', 'permissoes', 'instagram'],
  2
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0003-4000-a000-000000000003',
  'Como adicionar e gerenciar clientes',
  'como-adicionar-e-gerenciar-clientes',
  'Cadastre clientes, mantenha dados operacionais e acompanhe entregas, arquivos, Hub e Instagram.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Adicionando um novo cliente'),
    _kb_expand_ol(ARRAY[
      'Acesse Clientes no menu lateral',
      'Clique em Novo Cliente',
      'Preencha nome, e-mail, telefone, plano, valor mensal, dia de pagamento, dia de entrega e especialidade',
      'Salve o cadastro e complete os detalhes quando necessário'
    ]),
    _kb_expand_callout('💡', 'blue', 'O dia de pagamento alimenta receitas previstas no Financeiro e no Calendário. O dia de entrega pode ser usado em fluxos com prazo baseado na data de entrega do cliente.'),
    _kb_expand_h(2, 'Detalhes que deixam a operação pronta'),
    _kb_expand_ul(ARRAY[
      'Informações comerciais e contato: e-mail, telefone, plano, valor, status e link do Notion',
      'Datas importantes: aniversário, datas comemorativas e lembretes relevantes para conteúdo',
      'Endereços: cadastre e use a busca automática por CEP quando disponível',
      'Arquivos: acesse a pasta raiz do cliente e reutilize materiais nas entregas',
      'Calendário de posts: acompanhe conteúdos agendados, postados, em aprovação ou com correção',
      'Instagram: conecte conta, veja resumo de métricas, abra analytics completo e controle auto-publicação',
      'Hub do Cliente: ative o portal, configure briefing, marca, páginas e ideias'
    ]),
    _kb_expand_h(2, 'Status do cliente'),
    _kb_expand_ul(ARRAY[
      'Ativo - cliente em atendimento regular',
      'Pausado - atendimento temporariamente suspenso',
      'Encerrado - contrato finalizado ou cliente inativo'
    ]),
    _kb_expand_h(2, 'Importação via CSV'),
    _kb_expand_p('Use a importação por CSV para cadastrar vários clientes. Revise nomes, e-mails, telefone, plano, valor mensal, dia de pagamento e campos obrigatórios antes de importar para evitar cadastros duplicados ou incompletos.')
  ),
  'clientes',
  ARRAY['clientes', 'cadastro', 'csv', 'importacao', 'hub', 'arquivos', 'cep', 'instagram'],
  10
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0004-4000-a000-000000000004',
  'Como converter leads em clientes',
  'como-converter-leads-em-clientes',
  'Gerencie o funil comercial, importe leads e transforme oportunidades em clientes.',
  _kb_expand_doc(
    _kb_expand_h(2, 'O que são leads?'),
    _kb_expand_p('Leads são contatos de potenciais clientes que ainda não fecharam contrato. O módulo de Leads ajuda a acompanhar origem, estágio, especialidade, potencial e observações até a conversão.'),
    _kb_expand_h(2, 'Campos importantes'),
    _kb_expand_ul(ARRAY[
      'Canal de origem: Instagram, Facebook, Google Ads, Indicação, Site, WhatsApp, Typeform ou Outro',
      'Instagram: o CRM normaliza o identificador para o formato @perfil quando possível',
      'Faixa de faturamento e especialidade: ajudam a priorizar oportunidades',
      'Tags e observações: registre contexto da conversa, objeções e próximos passos',
      'Status: Novo, Contatado, Qualificado, Perdido ou Convertido'
    ]),
    _kb_expand_h(2, 'Convertendo em cliente'),
    _kb_expand_ol(ARRAY[
      'Abra o lead que fechou contrato',
      'Clique em Converter em Cliente',
      'Complete telefone, plano, valor mensal e dia de pagamento',
      'Confirme para criar o cliente e marcar o lead como convertido'
    ]),
    _kb_expand_callout('🎯', 'green', 'A conversão reaproveita os dados do lead, como nome, e-mail e Instagram. Depois complete o cadastro do cliente com Hub, arquivos, contrato e Instagram.'),
    _kb_expand_h(2, 'Importação via CSV'),
    _kb_expand_p('Quando importar leads por CSV, padronize canais, faixas de faturamento e tags. Isso melhora filtros, busca e leitura do funil comercial.')
  ),
  'clientes',
  ARRAY['leads', 'funil', 'conversao', 'vendas', 'csv', 'instagram'],
  11
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0005-4000-a000-000000000005',
  'Como gerenciar sua equipe',
  'como-gerenciar-sua-equipe',
  'Cadastre profissionais, custos, vínculos e responsáveis por entregas.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Equipe vs usuários do workspace'),
    _kb_expand_p('Um membro da Equipe representa uma pessoa ou fornecedor usado na operação, nos custos e nas atribuições. Um usuário do workspace é uma pessoa com login no CRM. Quando a mesma pessoa precisa acessar o sistema e receber atribuições, vincule o membro da equipe ao usuário correspondente.'),
    _kb_expand_h(2, 'Adicionando membros'),
    _kb_expand_ol(ARRAY[
      'Acesse Equipe no menu lateral',
      'Clique em Novo Membro',
      'Informe nome, cargo, tipo de vínculo, custo mensal e data de pagamento',
      'Vincule a um usuário do workspace quando houver login correspondente',
      'Salve para usar essa pessoa em etapas, posts, comentários e relatórios'
    ]),
    _kb_expand_h(2, 'Tipos de vínculo'),
    _kb_expand_ul(ARRAY[
      'CLT - funcionário com custo fixo mensal',
      'Freelancer Mensal - prestador com valor recorrente',
      'Freelancer por Demanda - profissional usado por projeto ou tarefa'
    ]),
    _kb_expand_callout('💡', 'blue', 'Custos da equipe entram nas projeções financeiras. Agentes podem não ver custos ou ações administrativas, conforme as permissões do workspace.'),
    _kb_expand_h(2, 'Importação via CSV'),
    _kb_expand_p('Para importar equipe, use colunas como nome, cargo, tipo, custo_mensal e data_pagamento. Revise valores numéricos e datas antes de enviar.')
  ),
  'equipe',
  ARRAY['equipe', 'membros', 'usuarios', 'permissoes', 'clt', 'freelancer', 'custos', 'csv'],
  20
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0006-4000-a000-000000000006',
  'Como criar e gerenciar fluxos',
  'como-criar-e-gerenciar-fluxos',
  'Crie fluxos de entrega, acompanhe etapas, use visualizações e filtre o trabalho ativo.',
  _kb_expand_doc(
    _kb_expand_h(2, 'O que são fluxos?'),
    _kb_expand_p('Fluxos são projetos de entrega para clientes. Eles organizam etapas, responsáveis, prazos, posts, aprovações e histórico de execução. Use-os para transformar um processo recorrente em uma operação acompanhável.'),
    _kb_expand_h(2, 'Criando um fluxo'),
    _kb_expand_ol(ARRAY[
      'Acesse Entregas',
      'Clique em Novo Fluxo',
      'Selecione o cliente e, se fizer sentido, um template',
      'Revise etapas, responsáveis e prazos',
      'Defina se o fluxo é recorrente',
      'Salve e acompanhe a execução pela visualização escolhida'
    ]),
    _kb_expand_h(2, 'Visualizações disponíveis'),
    _kb_expand_ul(ARRAY[
      'Kanban - visão operacional por etapa',
      'Gráfico - leitura visual de progresso e volume',
      'Calendário - prazos e entregas por data',
      'Lista - visão compacta para busca e comparação',
      'Concluídas - histórico dos fluxos finalizados'
    ]),
    _kb_expand_h(2, 'Filtros úteis'),
    _kb_expand_p('Use filtros por busca, cliente, status, responsável da etapa, responsável do post, etapa, template, atrasados, urgentes ou em dia. Esses filtros ajudam a encontrar gargalos rapidamente.'),
    _kb_expand_callout('📌', 'orange', 'Para prazos avançados, propriedades customizadas e templates recorrentes, veja o artigo Templates, prazos e propriedades de fluxos.')
  ),
  'entregas-e-fluxos',
  ARRAY['fluxos', 'entregas', 'kanban', 'templates', 'etapas', 'responsaveis'],
  30
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0007-4000-a000-000000000007',
  'Aprovação e publicação de posts',
  'aprovacao-e-publicacao-de-posts',
  'Entenda status, aprovação do cliente, correções, calendário e publicação no Instagram.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Ciclo de vida de um post'),
    _kb_expand_ul(ARRAY[
      'Rascunho ou em produção - conteúdo ainda sendo preparado pela equipe',
      'Revisão interna - post pronto para checagem antes de enviar ao cliente',
      'Aprovado interno - post liberado para envio ao Hub do Cliente',
      'Enviado ao cliente - aguardando aprovação ou pedido de correção',
      'Correção solicitada - cliente pediu ajustes com comentários',
      'Aprovado pelo cliente - post aprovado e pronto para agendar ou publicar',
      'Agendado - publicação programada para data e horário definidos',
      'Postado - conteúdo publicado com sucesso',
      'Falha de publicação ou falha_publicacao - houve erro e a equipe precisa revisar permissões, mídia, token ou legenda'
    ]),
    _kb_expand_h(2, 'Aprovação pelo Hub'),
    _kb_expand_p('Ao enviar posts prontos ao cliente, eles aparecem na seção Aprovações do Hub. O cliente pode aprovar ou solicitar correções. Comentários e respostas ficam registrados no CRM.'),
    _kb_expand_callout('✅', 'green', 'Se Auto-publicar ao aprovar estiver ativo no cliente e a conta do Instagram tiver permissões válidas, posts aprovados podem seguir para publicação sem uma ação manual extra.'),
    _kb_expand_h(2, 'Quando uma aprovação é resetada'),
    _kb_expand_p('Alterar conteúdo, mídia ou dados importantes de um post já aprovado pode invalidar a aprovação anterior. O CRM avisa antes de devolver o post para revisão ou aprovação novamente.'),
    _kb_expand_h(2, 'Onde acompanhar'),
    _kb_expand_p('Use o calendário do cliente, a gaveta do fluxo e a página Entregas para acompanhar status, agendamentos, comentários, mídia e histórico de publicação.')
  ),
  'entregas-e-fluxos',
  ARRAY['posts', 'aprovacao', 'publicacao', 'instagram', 'hub', 'falha_publicacao'],
  31
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0008-4000-a000-000000000008',
  'Como configurar o Hub do Cliente',
  'como-configurar-o-hub-do-cliente',
  'Ative o portal do cliente e entenda aprovações, postagens, marca, briefing, páginas e ideias.',
  _kb_expand_doc(
    _kb_expand_h(2, 'O que é o Hub do Cliente?'),
    _kb_expand_p('O Hub do Cliente é um portal com link único onde o cliente acompanha aprovações, postagens, marca, páginas, briefing, ideias e, quando houver Instagram conectado, alguns dados de performance. O cliente não precisa criar conta para acessar.'),
    _kb_expand_h(2, 'Ativando o acesso'),
    _kb_expand_ol(ARRAY[
      'Abra o detalhe do cliente',
      'Vá até a seção Hub do Cliente',
      'Ative o Hub para gerar ou reativar o link',
      'Use visualizar para conferir a experiência antes de enviar',
      'Copie o link e compartilhe com o cliente por e-mail, WhatsApp ou canal combinado'
    ]),
    _kb_expand_callout('⚠️', 'orange', 'Apenas proprietários e admins gerenciam o Hub. Agentes podem ver avisos de permissão quando a ação for restrita.'),
    _kb_expand_h(2, 'O que configurar antes de enviar'),
    _kb_expand_ul(ARRAY[
      'Aprovações - posts prontos para o cliente aprovar ou pedir correção',
      'Postagens - calendário editorial com status visíveis ao cliente',
      'Marca - logo, cores, fontes e arquivos de referência',
      'Páginas - documentos em markdown para processos, combinados e materiais fixos',
      'Briefing - perguntas organizadas por seção, com respostas salvas pelo cliente',
      'Ideias - espaço para sugestões de conteúdo enviadas pelo cliente'
    ]),
    _kb_expand_h(2, 'Gerenciando o link'),
    _kb_expand_p('Você pode copiar, visualizar, desativar e reativar o Hub sem apagar os dados já configurados. Reative quando quiser devolver o acesso ao cliente.')
  ),
  'hub-do-cliente',
  ARRAY['hub', 'portal', 'cliente', 'aprovacao', 'briefing', 'marca', 'ideias'],
  40
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0009-4000-a000-000000000009',
  'Como conectar o Instagram',
  'como-conectar-o-instagram',
  'Conecte contas profissionais do Instagram para analytics, agendamento, publicação e Post Express.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Pré-requisitos'),
    _kb_expand_ul(ARRAY[
      'A conta do Instagram deve ser Profissional, Business ou Creator',
      'A conta precisa estar vinculada a uma Página do Facebook',
      'A pessoa que autoriza precisa ter acesso suficiente para conceder permissões',
      'Permissões de leitura alimentam Analytics; permissões de publicação liberam agendar, publicar agora e Post Express'
    ]),
    _kb_expand_h(2, 'Conectando a conta'),
    _kb_expand_ol(ARRAY[
      'Abra o detalhe do cliente',
      'Na seção Instagram, clique em Conectar Instagram',
      'Autorize pelo Facebook',
      'Selecione a página vinculada à conta correta',
      'Confirme permissões e aguarde a primeira sincronização'
    ]),
    _kb_expand_callout('⚠️', 'orange', 'Se a conta não aparecer, confirme se ela é profissional, está ligada a uma página do Facebook e se a pessoa logada no Facebook tem permissão sobre essa página.'),
    _kb_expand_h(2, 'Solução de problemas'),
    _kb_expand_ul(ARRAY[
      'Token expirado - reconecte a conta para renovar a autorização',
      'Permissões revogadas - peça ao responsável para autorizar novamente pelo Facebook',
      'Sem permissão de publicação - analytics pode funcionar, mas agendar, publicar agora e Post Express ficam bloqueados',
      'Conta desconectada ou revogada - revise o status no cliente antes de tentar publicar'
    ]),
    _kb_expand_h(2, 'Depois de conectar'),
    _kb_expand_p('A conta passa a alimentar Analytics, relatórios por conta, seleção de cliente no Post Express, agendamento de posts e a experiência de performance no Hub quando disponível.')
  ),
  'instagram-e-analytics',
  ARRAY['instagram', 'conexao', 'facebook', 'oauth', 'sync', 'permissoes', 'publicacao'],
  50
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-000a-4000-a000-00000000000a',
  'Entendendo o painel de Analytics',
  'entendendo-o-painel-de-analytics',
  'Leia métricas consolidadas do portfólio, destaques, alertas e desempenho das contas conectadas.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Visão geral do portfólio'),
    _kb_expand_p('O painel de Analytics mostra uma leitura consolidada das contas de Instagram conectadas. Use-o para comparar clientes, encontrar oportunidades e priorizar contas que precisam de atenção.'),
    _kb_expand_h(2, 'Indicadores principais'),
    _kb_expand_ul(ARRAY[
      'Contas conectadas e contas com dados recentes',
      'Total de seguidores e crescimento no período',
      'Alcance, impressões e engajamento médio',
      'Posts de melhor e pior desempenho',
      'Contas silenciosas ou com baixa atividade recente'
    ]),
    _kb_expand_h(2, 'Destaques e alertas'),
    _kb_expand_p('A área de destaques ajuda a identificar melhor engajamento, maior crescimento, maior alcance, maior audiência e contas mais ativas. Os alertas apontam contas sem publicações recentes ou com sinais de queda.'),
    _kb_expand_h(2, 'Usando os rankings'),
    _kb_expand_p('Ordene tabelas e listas por seguidores, engajamento, alcance, posts recentes ou outros indicadores para decidir onde investigar mais. Para uma leitura detalhada, abra o analytics da conta específica.'),
    _kb_expand_callout('🧠', 'purple', 'Este artigo cobre o portfólio. Para melhores horários, tags, demografia e relatórios de uma conta específica, veja Analytics por conta.')
  ),
  'instagram-e-analytics',
  ARRAY['analytics', 'metricas', 'engajamento', 'alcance', 'portfolio', 'instagram'],
  51
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-000b-4000-a000-00000000000b',
  'Como usar o Post Express',
  'como-usar-o-post-express',
  'Publique rapidamente no Instagram sem montar uma entrega completa.',
  _kb_expand_doc(
    _kb_expand_h(2, 'O que é o Post Express?'),
    _kb_expand_p('O Post Express publica conteúdo direto no Instagram de um cliente conectado. Ele é indicado para conteúdos rápidos, urgentes ou pontuais, quando você não precisa montar um fluxo completo de produção.'),
    _kb_expand_h(2, 'Quem aparece na seleção'),
    _kb_expand_p('A lista mostra clientes com conta de Instagram conectada. Se um cliente não aparece, revise a conexão, o status da autorização e as permissões de publicação.'),
    _kb_expand_h(2, 'Como publicar'),
    _kb_expand_ol(ARRAY[
      'Acesse Post Express',
      'Selecione o cliente',
      'Envie a mídia ou mídias do post',
      'Revise o tipo detectado: feed, reels ou carrossel',
      'Escreva a legenda com até 2.200 caracteres',
      'Confira o preview e publique'
    ]),
    _kb_expand_callout('💡', 'blue', 'O tipo é detectado pela mídia: várias imagens viram carrossel, vídeo tende a Reels e imagem única vira Feed. Vídeos podem exigir thumbnail para publicação.'),
    _kb_expand_h(2, 'O que acontece nos bastidores'),
    _kb_expand_p('O CRM cria um registro operacional para manter histórico da publicação. Se você abandonar um rascunho vazio, ele pode ser limpo automaticamente. Quando a publicação termina, o post fica registrado como concluído ou com erro para acompanhamento.'),
    _kb_expand_h(2, 'Erros comuns'),
    _kb_expand_ul(ARRAY[
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

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-000c-4000-a000-00000000000c',
  'Gestão financeira',
  'gestao-financeira',
  'Controle receitas, despesas, projeções, contratos, importações e calendário financeiro.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Receitas, despesas e projeções'),
    _kb_expand_p('O módulo Financeiro reúne transações manuais e previsões geradas por clientes, equipe e contratos. Use-o para acompanhar recebido, a receber, a pagar, saldo atual e saldo projetado.'),
    _kb_expand_h(2, 'Transações manuais'),
    _kb_expand_ol(ARRAY[
      'Acesse Financeiro',
      'Clique em Nova Transação',
      'Escolha entrada ou saída',
      'Informe descrição, valor, data, categoria, detalhe e status',
      'Salve e revise o mês filtrado'
    ]),
    _kb_expand_h(2, 'Pagamentos previstos'),
    _kb_expand_p('Receitas podem ser projetadas a partir do valor mensal e dia de pagamento dos clientes. Despesas podem vir dos custos e datas de pagamento da equipe. Ao confirmar um item previsto no Calendário, o CRM cria a transação correspondente.'),
    _kb_expand_h(2, 'Contratos'),
    _kb_expand_p('Em Contratos, registre título, cliente, datas, valor total e status. O Dashboard alerta contratos que vencem nos próximos 30 dias para evitar renovações esquecidas.'),
    _kb_expand_h(2, 'Importação via CSV'),
    _kb_expand_ul(ARRAY[
      'Financeiro: descricao, valor, data, tipo, categoria e detalhe',
      'Contratos: titulo, cliente_nome, data_inicio, data_fim, valor_total e status',
      'Revise datas no formato AAAA-MM-DD e valores numéricos antes de importar'
    ]),
    _kb_expand_callout('📌', 'orange', 'Agentes não veem financeiro e contratos. Use uma conta de Proprietário ou Admin para acessar esses módulos.')
  ),
  'financeiro',
  ARRAY['financeiro', 'receitas', 'despesas', 'contratos', 'calendario', 'csv', 'projecoes'],
  70
);

-- ============================================================
-- New articles
-- ============================================================

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-000d-4000-a000-00000000000d',
  'Primeiros 30 minutos no Mesaas',
  'primeiros-30-minutos-no-mesaas',
  'Siga um roteiro rápido para deixar o workspace pronto para operar.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Objetivo do roteiro'),
    _kb_expand_p('Este roteiro acompanha o checklist do Dashboard. Ao completar estes passos, você sai de um workspace vazio para uma operação pronta para vender, produzir, aprovar e medir resultados.'),
    _kb_expand_h(2, '1. Cadastre o primeiro cliente'),
    _kb_expand_p('Crie um cliente com dados de contato, plano, valor mensal, dia de pagamento, dia de entrega e especialidade. Isso libera visão financeira, calendário, entregas e organização por cliente.'),
    _kb_expand_h(2, '2. Crie o primeiro lead'),
    _kb_expand_p('Registre uma oportunidade com canal, Instagram, especialidade, faixa de faturamento, tags e status. Assim você começa a medir o funil comercial antes da conversão.'),
    _kb_expand_h(2, '3. Adicione ou vincule a equipe'),
    _kb_expand_p('Cadastre profissionais, custos e vínculos. Se a pessoa também usa o CRM, vincule o membro da Equipe ao usuário do workspace. Isso melhora atribuições em etapas, posts e comentários.'),
    _kb_expand_h(2, '4. Conecte o Instagram'),
    _kb_expand_p('Conecte a conta profissional do cliente para liberar Analytics, Post Express, agendamento, publicação e métricas no Hub. Confirme permissões de publicação se pretende agendar ou publicar pelo Mesaas.'),
    _kb_expand_h(2, '5. Crie um fluxo de entrega'),
    _kb_expand_p('Monte um fluxo simples com etapas, responsáveis e prazos. Depois adicione posts, mídia, legenda, comentários e envie ao cliente quando estiver pronto.'),
    _kb_expand_callout('✅', 'green', 'Depois dos cinco passos, revise Arquivos, Hub do Cliente e Configurações para completar a operação com materiais, aprovações e permissões.')
  ),
  'primeiros-passos',
  ARRAY['onboarding', 'dashboard', 'primeiros-passos', 'checklist', 'workspace'],
  3
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-000e-4000-a000-00000000000e',
  'Permissões e papéis no workspace',
  'permissoes-e-papeis-no-workspace',
  'Entenda Proprietário, Admin, Agente, membros da Equipe e usuários com login.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Papéis de acesso'),
    _kb_expand_ul(ARRAY[
      'Proprietário - controla workspace, configurações, membros, financeiro, contratos e dados operacionais',
      'Admin - administra a operação com acesso amplo às áreas do CRM',
      'Agente - atua em tarefas operacionais e tem restrições em financeiro, contratos, custos e configurações sensíveis'
    ]),
    _kb_expand_h(2, 'Por que algumas ações ficam bloqueadas?'),
    _kb_expand_p('O CRM mostra avisos de restrição quando uma página ou ação exige permissões maiores. Isso protege dados financeiros, contratos, convites, papéis e configurações do workspace.'),
    _kb_expand_h(2, 'Equipe não é a mesma coisa que usuário'),
    _kb_expand_p('Um usuário entra no CRM com e-mail e senha. Um membro da Equipe representa alguém que recebe custo, tipo de vínculo e atribuições. A mesma pessoa pode existir nos dois lugares quando precisa acessar o CRM e ser responsável por etapas ou posts.'),
    _kb_expand_h(2, 'Quando vincular'),
    _kb_expand_ul(ARRAY[
      'Quando o profissional precisa aparecer como responsável por etapas ou posts',
      'Quando comentários e tarefas devem apontar para a pessoa correta',
      'Quando você quer relatórios de performance por membro',
      'Quando custos da equipe precisam entrar nas projeções financeiras'
    ]),
    _kb_expand_callout('📌', 'orange', 'Convites, troca de papéis e remoção de usuários devem ser feitos em Configurações por quem tem permissão administrativa.')
  ),
  'primeiros-passos',
  ARRAY['permissoes', 'papeis', 'owner', 'admin', 'agente', 'equipe', 'usuarios'],
  4
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-000f-4000-a000-00000000000f',
  'Importações via CSV no Mesaas',
  'importacoes-via-csv-no-mesaas',
  'Use CSV para importar dados em massa com menos retrabalho.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Quando usar CSV'),
    _kb_expand_p('Use importação por CSV quando precisar criar muitos registros de uma vez. Ela é útil para migrar dados antigos, iniciar um workspace ou atualizar listas operacionais.'),
    _kb_expand_h(2, 'Áreas com importação'),
    _kb_expand_ul(ARRAY[
      'Clientes - dados comerciais, contato, plano, valor e dia de pagamento',
      'Leads - nome, e-mail, Instagram, canal, especialidade, faturamento, tags e observações',
      'Equipe - nome, cargo, tipo, custo_mensal e data_pagamento',
      'Financeiro - descricao, valor, data, tipo, categoria e detalhe',
      'Contratos - titulo, cliente_nome, data_inicio, data_fim, valor_total e status',
      'Briefing do Hub - pergunta, secao e resposta inicial quando aplicável'
    ]),
    _kb_expand_h(2, 'Boas práticas'),
    _kb_expand_ul(ARRAY[
      'Mantenha uma linha de cabeçalho com os nomes das colunas',
      'Use datas no formato AAAA-MM-DD quando o importador solicitar',
      'Use valores numéricos sem símbolos de moeda',
      'Padronize status, tipos e canais antes de importar',
      'Teste com poucas linhas quando o arquivo vier de outra ferramenta',
      'Revise duplicidades de cliente, lead e contrato antes de confirmar'
    ]),
    _kb_expand_callout('💡', 'blue', 'Se a importação não reconhecer uma coluna, compare o nome do cabeçalho com a orientação exibida no próprio modal de importação.')
  ),
  'primeiros-passos',
  ARRAY['csv', 'importacao', 'clientes', 'leads', 'equipe', 'financeiro', 'contratos', 'briefing'],
  5
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0010-4000-a000-000000000010',
  'Como organizar e reutilizar arquivos',
  'como-organizar-e-reutilizar-arquivos',
  'Use a biblioteca de arquivos para organizar pastas, mídia, documentos e materiais dos clientes.',
  _kb_expand_doc(
    _kb_expand_h(2, 'O que fica em Arquivos'),
    _kb_expand_p('Arquivos é a biblioteca do workspace. Use-a para armazenar fotos, vídeos, thumbnails, documentos, referências, materiais de marca e pastas por cliente.'),
    _kb_expand_h(2, 'Navegação e organização'),
    _kb_expand_ul(ARRAY[
      'Use a árvore de pastas e breadcrumbs para navegar',
      'Crie novas pastas para campanhas, clientes, marcas ou entregas',
      'Alterne entre grade e lista conforme o volume de itens',
      'Filtre por tipo de arquivo, como imagem, vídeo ou documento',
      'Ordene para encontrar materiais recentes, antigos ou por nome'
    ]),
    _kb_expand_h(2, 'Uploads e previews'),
    _kb_expand_p('Arraste arquivos para enviar ou use o seletor de upload. A fila mostra progresso e processa múltiplos arquivos com controle de concorrência. Imagens e vídeos podem ser visualizados em lightbox; vídeos podem gerar thumbnail para uso em posts.'),
    _kb_expand_h(2, 'Ações em massa'),
    _kb_expand_ul(ARRAY[
      'Selecione vários itens para mover, copiar, compactar em zip ou excluir',
      'Use mover para reorganizar pastas sem reenviar arquivos',
      'Use copiar para reaproveitar materiais em outro cliente ou projeto',
      'Ao excluir, o CRM pode bloquear itens em uso por posts ou entregas'
    ]),
    _kb_expand_h(2, 'Reutilizando em entregas'),
    _kb_expand_p('Na criação de posts, escolha arquivos existentes em vez de reenviar mídia. Isso mantém histórico, economiza tempo e evita versões duplicadas de peças aprovadas.')
  ),
  'arquivos',
  ARRAY['arquivos', 'pastas', 'upload', 'thumbnail', 'zip', 'midia', 'documentos'],
  80
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0011-4000-a000-000000000011',
  'Preparando o Hub do Cliente antes de enviar o link',
  'preparando-o-hub-do-cliente-antes-de-enviar-o-link',
  'Monte briefing, marca, páginas e ideias antes de compartilhar o portal com o cliente.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Checklist antes de enviar'),
    _kb_expand_ul(ARRAY[
      'Ative o Hub e use Visualizar para conferir o acesso',
      'Revise se há posts prontos ou calendário útil para o cliente',
      'Crie perguntas de briefing por seção',
      'Cadastre logo, cores, fontes e arquivos de marca',
      'Adicione páginas com combinados, processos, links ou orientações fixas',
      'Explique ao cliente como enviar ideias pelo Hub'
    ]),
    _kb_expand_h(2, 'Briefing'),
    _kb_expand_p('Organize perguntas em seções para facilitar o preenchimento. Também é possível importar perguntas por CSV com colunas como pergunta, secao e resposta. As respostas do cliente ficam salvas no Hub.'),
    _kb_expand_h(2, 'Marca e páginas'),
    _kb_expand_p('Use Marca para centralizar logo, cores, fontes e arquivos que a equipe consulta com frequência. Use Páginas para documentos vivos, como tom de voz, calendário fixo, links importantes e regras de aprovação.'),
    _kb_expand_h(2, 'Ideias'),
    _kb_expand_p('A seção Ideias permite que o cliente sugira temas, referências e links. A equipe acompanha tudo pelo CRM, define status e responde com comentários.'),
    _kb_expand_callout('✅', 'green', 'Antes de enviar o link, abra o preview do Hub para conferir se a experiência está clara para o cliente.')
  ),
  'hub-do-cliente',
  ARRAY['hub', 'briefing', 'marca', 'paginas', 'ideias', 'csv'],
  41
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0012-4000-a000-000000000012',
  'Como o cliente aprova posts pelo Hub',
  'como-o-cliente-aprova-posts-pelo-hub',
  'Explique ao cliente como revisar, aprovar ou pedir correções em posts.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Onde o cliente encontra os posts'),
    _kb_expand_p('Posts enviados ao cliente aparecem em Aprovações no Hub. O cliente também pode acompanhar postagens visíveis no calendário editorial, conforme o status de cada conteúdo.'),
    _kb_expand_h(2, 'Tipos de revisão'),
    _kb_expand_ul(ARRAY[
      'Posts com mídia - imagens, vídeos, Reels, carrosséis e Stories com preview',
      'Posts textuais - conteúdos sem mídia anexa, usados quando a equipe ainda precisa de validação do texto',
      'Preview estilo Instagram - quando há conta conectada, o cliente pode entender melhor como o conteúdo aparecerá no feed'
    ]),
    _kb_expand_h(2, 'Aprovar ou pedir correção'),
    _kb_expand_p('Ao aprovar, o post volta para o CRM como aprovado pelo cliente. Ao pedir correção, o cliente registra comentários para a equipe ajustar. A equipe pode responder e reenviar quando o conteúdo estiver pronto.'),
    _kb_expand_h(2, 'Auto-publicação'),
    _kb_expand_p('Se a auto-publicação estiver ativa e a conta tiver permissões válidas, a aprovação do cliente pode disparar a publicação ou deixar o post pronto para seguir o agendamento configurado.'),
    _kb_expand_callout('📌', 'orange', 'Oriente o cliente a comentar de forma específica: texto, imagem, data, legenda ou peça que precisa mudar. Isso reduz retrabalho.')
  ),
  'hub-do-cliente',
  ARRAY['hub', 'aprovacao', 'cliente', 'correcao', 'auto-publicar', 'instagram'],
  42
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0013-4000-a000-000000000013',
  'Coletando ideias dos clientes pelo Hub',
  'coletando-ideias-dos-clientes-pelo-hub',
  'Receba sugestões de conteúdo dos clientes e acompanhe o status dentro do CRM.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Como o cliente envia ideias'),
    _kb_expand_p('No Hub, o cliente abre Ideias, cria um título, descreve a sugestão e pode adicionar links de referência. Enquanto a ideia está nova e sem resposta da equipe, o cliente pode editar ou excluir.'),
    _kb_expand_h(2, 'Acompanhando no CRM'),
    _kb_expand_ul(ARRAY[
      'Use a página Ideias para ver sugestões de todos os clientes',
      'Filtre por cliente ou status',
      'Abra a ideia para ler descrição, referências, reações e histórico',
      'Adicione comentário da agência para orientar o próximo passo',
      'Atualize o status para nova, em análise, aprovada ou descartada'
    ]),
    _kb_expand_h(2, 'Boas práticas'),
    _kb_expand_ul(ARRAY[
      'Combine com o cliente o tipo de referência esperado',
      'Use em análise para ideias que precisam de validação interna',
      'Transforme ideias aprovadas em pauta, post ou briefing de entrega',
      'Use comentário da agência para dar retorno mesmo quando a ideia for descartada'
    ]),
    _kb_expand_callout('💡', 'blue', 'Ideias ajudam a aproximar o cliente da produção sem misturar sugestões com aprovações formais de posts.')
  ),
  'hub-do-cliente',
  ARRAY['ideias', 'hub', 'cliente', 'referencias', 'status', 'comentarios'],
  43
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0014-4000-a000-000000000014',
  'Criando posts dentro de uma entrega',
  'criando-posts-dentro-de-uma-entrega',
  'Use a gaveta da entrega para criar posts, editar conteúdo, anexar mídia e colaborar.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Onde criar posts'),
    _kb_expand_p('Abra uma entrega e use a área de posts para adicionar conteúdos ao fluxo. Cada post pode ter tipo, status, responsável, data de agendamento, legenda, conteúdo interno, mídia e propriedades customizadas.'),
    _kb_expand_h(2, 'Campos principais'),
    _kb_expand_ul(ARRAY[
      'Título - nome operacional do conteúdo',
      'Tipo - feed, reels, stories ou carrossel',
      'Status - acompanha produção, revisão, aprovação, agendamento e publicação',
      'Responsável - membro da equipe encarregado pelo post',
      'Data e horário - usados para calendário, agendamento e organização do cliente',
      'Legenda do Instagram - necessária para publicar ou agendar quando aplicável'
    ]),
    _kb_expand_h(2, 'Editor e comentários'),
    _kb_expand_p('Use o editor para briefing, texto, notas, blocos e comentários. Comentários podem ser ligados a trechos selecionados, resolvidos, reabertos ou respondidos conforme a revisão avança.'),
    _kb_expand_h(2, 'Mídia e arquivos'),
    _kb_expand_p('Envie mídia do computador ou escolha arquivos já salvos em Arquivos. Reordene, defina capa, visualize em lightbox e baixe materiais quando necessário. Vídeos podem exigir thumbnail antes de envio ao cliente ou publicação.'),
    _kb_expand_callout('⚠️', 'orange', 'Editar conteúdo aprovado pode resetar a aprovação. Revise antes de alterar posts que já foram aprovados internamente ou pelo cliente.')
  ),
  'entregas-e-fluxos',
  ARRAY['posts', 'entregas', 'editor', 'comentarios', 'midia', 'arquivos', 'thumbnail'],
  32
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0015-4000-a000-000000000015',
  'Templates, prazos e propriedades de fluxos',
  'templates-prazos-e-propriedades-de-fluxos',
  'Padronize entregas com templates, modos de prazo e campos customizados.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Quando usar templates'),
    _kb_expand_p('Templates ajudam a repetir processos sem montar etapas do zero. Eles são úteis para calendário mensal, produção de posts, onboarding de clientes e entregas recorrentes.'),
    _kb_expand_h(2, 'Modos de prazo'),
    _kb_expand_ul(ARRAY[
      'Padrão - cada etapa usa duração em dias, corridos ou úteis',
      'Data fixa - cada etapa recebe uma data específica',
      'Data de entrega - prazos são calculados a partir do dia de entrega do cliente e de uma etapa de aprovação do cliente',
      'Recorrente - ao concluir um ciclo, um novo fluxo pode ser criado para o próximo período'
    ]),
    _kb_expand_callout('📌', 'orange', 'Para usar data de entrega, mantenha o dia de entrega preenchido no cliente e tenha uma etapa de aprovação do cliente no fluxo ou template.'),
    _kb_expand_h(2, 'Responsáveis e etapas'),
    _kb_expand_p('Cada etapa deve ter responsável definido para facilitar filtros, cobranças e leitura de gargalos. Use nomes de etapas claros para que equipe e cliente entendam o progresso.'),
    _kb_expand_h(2, 'Propriedades customizadas'),
    _kb_expand_p('Templates podem ter propriedades como texto, número, seleção, multiseleção, status, data, pessoa, checkbox, URL, e-mail, telefone e data de criação. Algumas propriedades podem ficar visíveis no portal para orientar o cliente.')
  ),
  'entregas-e-fluxos',
  ARRAY['templates', 'prazos', 'data de entrega', 'propriedades', 'recorrente', 'portal'],
  33
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0016-4000-a000-000000000016',
  'Agendar, publicar agora e resolver falhas no Instagram',
  'agendar-publicar-agora-e-resolver-falhas-no-instagram',
  'Prepare posts aprovados para publicação e resolva problemas de permissão, token, legenda ou mídia.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Antes de agendar ou publicar'),
    _kb_expand_ul(ARRAY[
      'O cliente precisa ter Instagram conectado',
      'A conta precisa ter permissão de publicação ativa',
      'O post deve estar aprovado pelo cliente quando fizer parte do fluxo de aprovação',
      'A legenda do Instagram deve estar preenchida quando exigida',
      'Data e horário devem estar definidos para agendamento',
      'Vídeos devem ter thumbnail quando o formato exigir'
    ]),
    _kb_expand_h(2, 'Agendar publicação'),
    _kb_expand_p('Use agendamento quando o conteúdo deve sair em data e horário definidos. Depois de agendado, acompanhe o status pelo post, pelo calendário do cliente e pelas entregas. Se necessário, cancele o agendamento antes da publicação.'),
    _kb_expand_h(2, 'Publicar agora'),
    _kb_expand_p('Use publicar agora quando o conteúdo já está aprovado e pode ir imediatamente para o Instagram. O CRM tenta publicar com as permissões atuais da conta e registra sucesso ou falha.'),
    _kb_expand_h(2, 'Como resolver falhas'),
    _kb_expand_ul(ARRAY[
      'Token expirado ou revogado - reconecte o Instagram',
      'Permissão de publicação ausente - autorize novamente pelo Facebook com permissões corretas',
      'Legenda ausente ou inválida - revise o campo de legenda',
      'Mídia incompatível - confira formato, quantidade e thumbnail',
      'Falha de publicação ou falha_publicacao - ajuste o problema indicado e use tentar novamente quando disponível'
    ]),
    _kb_expand_callout('💡', 'blue', 'Post Express usa a mesma base de permissões do Instagram. Se Post Express estiver bloqueado, revise a conexão do cliente antes de tentar de novo.')
  ),
  'entregas-e-fluxos',
  ARRAY['agendamento', 'publicar agora', 'instagram', 'falha de publicação', 'falha_publicacao', 'thumbnail', 'permissoes'],
  34
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0017-4000-a000-000000000017',
  'Analytics de Fluxos: gargalos, prazos e performance da equipe',
  'analytics-de-fluxos-gargalos-prazos-e-performance-da-equipe',
  'Use métricas de entregas para encontrar atrasos, gargalos e oportunidades de melhoria.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Para que serve'),
    _kb_expand_p('Analytics de Fluxos transforma entregas em métricas operacionais. Use esta página para entender volume ativo, conclusão, prazo, gargalos, desempenho por membro e eficiência dos templates.'),
    _kb_expand_h(2, 'Filtros'),
    _kb_expand_ul(ARRAY[
      'Período: 7, 30, 90 dias ou todo o histórico',
      'Cliente: investigue uma operação específica',
      'Template: compare processos padronizados'
    ]),
    _kb_expand_h(2, 'Métricas principais'),
    _kb_expand_ul(ARRAY[
      'Fluxos ativos e concluídos',
      'Taxa de entrega no prazo',
      'Tempo médio de conclusão',
      'Tempo médio em etapa ativa',
      'Conclusões ao longo do tempo',
      'Etapas com maior gargalo',
      'Performance por membro da equipe',
      'Performance por template'
    ]),
    _kb_expand_callout('🎯', 'green', 'Quando a taxa no prazo cair, comece pelos gargalos de etapa e depois compare responsáveis, clientes e templates.'),
    _kb_expand_h(2, 'Como agir a partir dos dados'),
    _kb_expand_p('Use os dados para ajustar prazos de templates, redistribuir responsáveis, reduzir etapas lentas e criar padrões mais realistas para clientes recorrentes.')
  ),
  'entregas-e-fluxos',
  ARRAY['analytics de fluxos', 'fluxos', 'gargalos', 'prazos', 'performance', 'equipe', 'templates'],
  35
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0018-4000-a000-000000000018',
  'Analytics por conta: melhores horários, tags e relatórios',
  'analytics-por-conta-melhores-horarios-tags-e-relatorios',
  'Analise uma conta conectada em profundidade e transforme métricas em decisões editoriais.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Quando usar analytics por conta'),
    _kb_expand_p('Abra uma conta específica quando precisar entender o desempenho de um cliente em detalhes. Essa visão complementa o painel de portfólio com métricas, gráficos, posts e relatórios da conta.'),
    _kb_expand_h(2, 'Leituras disponíveis'),
    _kb_expand_ul(ARRAY[
      'Histórico de seguidores',
      'Alcance, impressões e engajamento',
      'Demografia quando disponível',
      'Melhores horários para publicar',
      'Posts com mais alcance, engajamento, curtidas, comentários, salvos e compartilhamentos',
      'Performance por tipo de conteúdo',
      'Tags aplicadas aos posts'
    ]),
    _kb_expand_h(2, 'Usando filtros e ordenação'),
    _kb_expand_p('Filtre e ordene posts por data, formato, alcance, engajamento, curtidas, comentários, salvos e compartilhamentos. Use tags para agrupar editoriais, campanhas, temas ou hipóteses de conteúdo.'),
    _kb_expand_h(2, 'Relatórios'),
    _kb_expand_p('Use relatórios gerados para registrar análises, compartilhar aprendizados e comparar a evolução do cliente ao longo do tempo. Revise o histórico antes de tomar decisões de calendário.'),
    _kb_expand_callout('💡', 'blue', 'As melhores decisões vêm da combinação entre métricas da conta, calendário do cliente e status das entregas.')
  ),
  'instagram-e-analytics',
  ARRAY['analytics', 'conta', 'tags', 'relatorios', 'melhores horarios', 'instagram'],
  52
);

SELECT _kb_expand_upsert_article(
  'aaaaaaaa-0019-4000-a000-000000000019',
  'Usando o Calendário para finanças, prazos e datas importantes',
  'usando-o-calendario-para-financas-prazos-e-datas-importantes',
  'Acompanhe pagamentos, prazos de entregas, aniversários, datas importantes e oportunidades de conteúdo.',
  _kb_expand_doc(
    _kb_expand_h(2, 'Abas do Calendário'),
    _kb_expand_p('O Calendário reúne eventos financeiros, operacionais e editoriais. Use a aba financeira para pagamentos, prazos e datas importantes. Use a aba de datas de saúde/conteúdo quando ela fizer parte da sua operação editorial.'),
    _kb_expand_h(2, 'Eventos financeiros'),
    _kb_expand_ul(ARRAY[
      'Receitas previstas de clientes ativos',
      'Despesas previstas da equipe',
      'Transações manuais agendadas',
      'Confirmação de pagamentos previstos para criar transações reais'
    ]),
    _kb_expand_h(2, 'Eventos operacionais'),
    _kb_expand_ul(ARRAY[
      'Prazos de fluxos e etapas',
      'Aniversários de clientes',
      'Datas importantes cadastradas no cliente',
      'Alertas que ajudam a antecipar conteúdo, cobranças e entregas'
    ]),
    _kb_expand_h(2, 'Calendário de saúde e conteúdo'),
    _kb_expand_p('Quando usado, o calendário de saúde e datas comemorativas ajuda a encontrar oportunidades editoriais por mês e categoria, como Brasil, Mundial, Profissional, Câncer, Cardiologia, Saúde Mental e Infecção.'),
    _kb_expand_callout('📌', 'orange', 'Agentes podem ter acesso limitado a eventos financeiros. Para confirmar pagamentos, use um perfil com permissão adequada.')
  ),
  'financeiro',
  ARRAY['calendario', 'financeiro', 'prazos', 'datas importantes', 'aniversarios', 'conteudo', 'saude'],
  71
);

-- ============================================================
-- Context links: wire articles to CRM pages
-- ============================================================

SELECT _kb_expand_link('/dashboard', 'bem-vindo-ao-mesaas', NULL, 0);
SELECT _kb_expand_link('/dashboard', 'primeiros-30-minutos-no-mesaas', 'Primeiros passos', 1);

SELECT _kb_expand_link('/configuracao', 'como-configurar-seu-workspace', NULL, 0);
SELECT _kb_expand_link('/configuracao', 'permissoes-e-papeis-no-workspace', 'Permissões e papéis', 1);

SELECT _kb_expand_link('/clientes', 'como-adicionar-e-gerenciar-clientes', NULL, 0);
SELECT _kb_expand_link('/clientes', 'como-configurar-o-hub-do-cliente', 'Hub do Cliente', 1);
SELECT _kb_expand_link('/clientes', 'preparando-o-hub-do-cliente-antes-de-enviar-o-link', 'Preparar Hub', 2);

SELECT _kb_expand_link('/leads', 'como-converter-leads-em-clientes', NULL, 0);
SELECT _kb_expand_link('/leads', 'importacoes-via-csv-no-mesaas', 'Importação CSV', 1);

SELECT _kb_expand_link('/equipe', 'como-gerenciar-sua-equipe', NULL, 0);
SELECT _kb_expand_link('/equipe', 'permissoes-e-papeis-no-workspace', 'Equipe e permissões', 1);

SELECT _kb_expand_link('/entregas', 'como-criar-e-gerenciar-fluxos', NULL, 0);
SELECT _kb_expand_link('/entregas', 'criando-posts-dentro-de-uma-entrega', 'Posts dentro da entrega', 1);
SELECT _kb_expand_link('/entregas', 'templates-prazos-e-propriedades-de-fluxos', 'Templates e prazos', 2);
SELECT _kb_expand_link('/entregas', 'aprovacao-e-publicacao-de-posts', 'Aprovação e publicação', 3);
SELECT _kb_expand_link('/entregas', 'agendar-publicar-agora-e-resolver-falhas-no-instagram', 'Agendar e publicar', 4);

SELECT _kb_expand_link('/analytics', 'como-conectar-o-instagram', NULL, 0);
SELECT _kb_expand_link('/analytics', 'entendendo-o-painel-de-analytics', NULL, 1);
SELECT _kb_expand_link('/analytics', 'analytics-por-conta-melhores-horarios-tags-e-relatorios', 'Analytics por conta', 2);

SELECT _kb_expand_link('/analytics-fluxos', 'analytics-de-fluxos-gargalos-prazos-e-performance-da-equipe', NULL, 0);

SELECT _kb_expand_link('/post-express', 'como-usar-o-post-express', NULL, 0);
SELECT _kb_expand_link('/post-express', 'agendar-publicar-agora-e-resolver-falhas-no-instagram', 'Resolver falhas', 1);

SELECT _kb_expand_link('/financeiro', 'gestao-financeira', NULL, 0);
SELECT _kb_expand_link('/financeiro', 'importacoes-via-csv-no-mesaas', 'Importação CSV', 1);

SELECT _kb_expand_link('/contratos', 'gestao-financeira', NULL, 0);
SELECT _kb_expand_link('/contratos', 'importacoes-via-csv-no-mesaas', 'Importação CSV', 1);

SELECT _kb_expand_link('/calendario', 'usando-o-calendario-para-financas-prazos-e-datas-importantes', NULL, 0);
SELECT _kb_expand_link('/calendario', 'gestao-financeira', 'Financeiro', 1);

SELECT _kb_expand_link('/arquivos', 'como-organizar-e-reutilizar-arquivos', NULL, 0);

SELECT _kb_expand_link('/ideias', 'coletando-ideias-dos-clientes-pelo-hub', NULL, 0);
SELECT _kb_expand_link('/ideias', 'preparando-o-hub-do-cliente-antes-de-enviar-o-link', 'Ideias no Hub', 1);

-- ============================================================
-- Cleanup helper functions
-- ============================================================

DROP FUNCTION IF EXISTS _kb_expand_link(text, text, text, integer);
DROP FUNCTION IF EXISTS _kb_expand_upsert_article(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_expand_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_expand_doc(VARIADIC jsonb[]);
DROP FUNCTION IF EXISTS _kb_expand_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_expand_ol(text[]);
DROP FUNCTION IF EXISTS _kb_expand_ul(text[]);
DROP FUNCTION IF EXISTS _kb_expand_h(int, text);
DROP FUNCTION IF EXISTS _kb_expand_p(text);
DROP FUNCTION IF EXISTS _kb_expand_text(text);
