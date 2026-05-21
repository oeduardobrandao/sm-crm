-- Seed initial Knowledge Base help articles for the CRM

-- ============================================================
-- Helper functions for building TipTap/ProseMirror JSONB nodes
-- ============================================================

CREATE OR REPLACE FUNCTION _kb_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_bold(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'marks', jsonb_build_array(jsonb_build_object('type', 'bold')), 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_p_mixed(VARIADIC parts jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', to_jsonb(parts));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_p(item)))
    ) FROM unnest(items) AS item));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_ol(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_p(item)))
    ) FROM unnest(items) AS item));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_plain(doc jsonb) RETURNS text AS $$
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

-- ============================================================
-- Insert articles
-- ============================================================

DO $$
DECLARE
  v_content jsonb;
  v_plain text;
BEGIN

  -- -------------------------------------------------------
  -- 1. Bem-vindo ao Mesaas
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'O que é o Mesaas?'),
    _kb_p('O Mesaas é uma plataforma completa de gestão para social media managers e agências de marketing digital. Com ele, você centraliza clientes, entregas, finanças, equipe e analytics do Instagram em um único lugar.'),
    _kb_h(2, 'Principais módulos'),
    _kb_ul(ARRAY[
      'Dashboard — visão geral do seu negócio com KPIs e eventos do dia',
      'Clientes — cadastro completo com informações, endereços e datas importantes',
      'Entregas — quadro Kanban para gerenciar fluxos de trabalho e aprovações',
      'Analytics — métricas do Instagram de todos os seus clientes em um painel unificado',
      'Financeiro — controle de receitas, despesas e contratos',
      'Equipe — gestão de membros CLT e freelancers com custos',
      'Hub do Cliente — portal exclusivo onde seus clientes aprovam posts e acompanham entregas',
      'Post Express — publique posts no Instagram rapidamente sem criar um fluxo completo'
    ]),
    _kb_h(2, 'Perfis de acesso'),
    _kb_p('O Mesaas possui três perfis de acesso com diferentes permissões:'),
    _kb_ul(ARRAY[
      'Proprietário — acesso total a todas as funcionalidades e configurações',
      'Admin — acesso completo, semelhante ao proprietário',
      'Agente — acesso operacional focado em entregas e clientes, sem visualização de dados financeiros ou contratos'
    ]),
    _kb_callout('💡', 'blue', 'Use o menu lateral para navegar entre os módulos. No celular, o menu fica na parte inferior da tela.'),
    _kb_h(2, 'Como navegar'),
    _kb_p('No desktop, a barra lateral esquerda mostra todos os módulos disponíveis. Clique em qualquer ícone para acessar a página. No mobile, use a barra de navegação inferior com os atalhos principais e o botão "Mais" para acessar as demais páginas.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0001-4000-a000-000000000001', 'Bem-vindo ao Mesaas', 'bem-vindo-ao-mesaas',
    'Conheça a plataforma, seus módulos e como navegar.',
    v_content, v_plain, 'primeiros-passos', ARRAY['inicio', 'visao-geral', 'navegacao'], 'published', 1)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 2. Como configurar seu workspace
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'Configuração inicial'),
    _kb_p('Ao criar sua conta, você será direcionado para a tela de configuração do workspace. Informe o nome da sua empresa ou agência e seu nome completo. Essas informações podem ser alteradas depois nas configurações.'),
    _kb_h(2, 'Personalizando o workspace'),
    _kb_p('Na página de Configurações, você pode:'),
    _kb_ul(ARRAY[
      'Alterar o nome do workspace (nome da sua empresa)',
      'Enviar um logotipo personalizado (PNG, JPG ou WebP, até 2MB)',
      'Editar seu perfil pessoal (nome, telefone, WhatsApp)',
      'Alterar sua senha de acesso'
    ]),
    _kb_h(2, 'Convidando membros'),
    _kb_p('Para adicionar novas pessoas ao workspace:'),
    _kb_ol(ARRAY[
      'Acesse Configurações e role até a seção "Membros do Workspace"',
      'Clique em "Convidar Membro"',
      'Informe o e-mail da pessoa e selecione o perfil: Admin ou Agente',
      'O convidado receberá um e-mail para configurar sua senha e acessar o CRM'
    ]),
    _kb_callout('📌', 'orange', 'Apenas proprietários e admins podem convidar novos membros e alterar configurações do workspace.'),
    _kb_h(2, 'Sincronização automática do Instagram'),
    _kb_p('Nas configurações, você pode ativar a sincronização automática do Instagram. Quando ativada, os dados de todas as contas conectadas são atualizados automaticamente uma vez por dia, sem necessidade de sincronizar manualmente.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0002-4000-a000-000000000002', 'Como configurar seu workspace', 'como-configurar-seu-workspace',
    'Configure o nome, logotipo, convide membros e ative a sincronização do Instagram.',
    v_content, v_plain, 'primeiros-passos', ARRAY['workspace', 'configuracao', 'membros', 'convite'], 'published', 2)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 3. Como adicionar e gerenciar clientes
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'Adicionando um novo cliente'),
    _kb_p('Para cadastrar um cliente:'),
    _kb_ol(ARRAY[
      'Acesse a página Clientes no menu lateral',
      'Clique no botão "Novo Cliente"',
      'Preencha as informações: nome, e-mail, telefone, plano, valor mensal, dia de pagamento e especialidade',
      'Clique em "Salvar" para finalizar o cadastro'
    ]),
    _kb_callout('💡', 'blue', 'O campo "Dia de Pagamento" é usado para gerar automaticamente as receitas previstas no calendário financeiro.'),
    _kb_h(2, 'Gerenciando informações'),
    _kb_p('Na página de detalhes do cliente, você pode editar todas as informações, adicionar endereços com busca automática por CEP, cadastrar datas importantes (aniversários, datas comemorativas) e acompanhar entregas ativas.'),
    _kb_h(2, 'Status do cliente'),
    _kb_p('Cada cliente possui um dos três status:'),
    _kb_ul(ARRAY[
      'Ativo — cliente em atendimento regular',
      'Pausado — contrato temporariamente suspenso',
      'Encerrado — contrato finalizado'
    ]),
    _kb_p('Use os filtros na página de Clientes para visualizar por status. Você também pode ordenar por nome, valor mensal ou dia de pagamento.'),
    _kb_h(2, 'Importação via CSV'),
    _kb_p('Para importar vários clientes de uma vez, clique no botão de importação e envie um arquivo CSV com as colunas: nome, e-mail, telefone, plano, valor mensal e dia de pagamento. O sistema criará os cadastros automaticamente.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0003-4000-a000-000000000003', 'Como adicionar e gerenciar clientes', 'como-adicionar-e-gerenciar-clientes',
    'Cadastre clientes, edite informações, gerencie status e importe via CSV.',
    v_content, v_plain, 'clientes', ARRAY['clientes', 'cadastro', 'csv', 'importacao'], 'published', 10)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 4. Como converter leads em clientes
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'O que são leads?'),
    _kb_p('Leads são contatos de potenciais clientes que ainda não fecharam contrato. O módulo de Leads permite acompanhar cada oportunidade desde o primeiro contato até a conversão.'),
    _kb_h(2, 'Cadastrando um lead'),
    _kb_ol(ARRAY[
      'Acesse a página Leads no menu lateral',
      'Clique em "Novo Lead"',
      'Preencha: nome, e-mail, Instagram, canal de origem, especialidade, faixa de faturamento, observações e tags',
      'Salve o cadastro'
    ]),
    _kb_h(2, 'Etapas do funil'),
    _kb_p('Cada lead passa por etapas que refletem o progresso da negociação:'),
    _kb_ul(ARRAY[
      'Novo — lead recém-cadastrado, sem contato ainda',
      'Contatado — primeiro contato realizado',
      'Qualificado — lead com potencial confirmado para fechar',
      'Perdido — negociação não avançou',
      'Convertido — lead se tornou cliente'
    ]),
    _kb_callout('🎯', 'green', 'Atualize o status do lead regularmente para manter o funil sempre organizado e saber exatamente quantas oportunidades estão em cada etapa.'),
    _kb_h(2, 'Convertendo em cliente'),
    _kb_p('Quando o lead fechar contrato, clique no botão "Converter em Cliente". Você poderá definir o plano, valor mensal e dia de pagamento. O sistema criará automaticamente o cadastro do cliente com as informações do lead.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0004-4000-a000-000000000004', 'Como converter leads em clientes', 'como-converter-leads-em-clientes',
    'Gerencie o funil de vendas e converta leads em clientes.',
    v_content, v_plain, 'clientes', ARRAY['leads', 'funil', 'conversao', 'vendas'], 'published', 11)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 5. Como gerenciar sua equipe
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'Adicionando membros da equipe'),
    _kb_p('O módulo Equipe permite cadastrar todos os profissionais que trabalham com você, sejam CLT ou freelancers. Para adicionar:'),
    _kb_ol(ARRAY[
      'Acesse a página Equipe no menu lateral',
      'Clique em "Novo Membro"',
      'Preencha: nome, cargo, tipo (CLT, Freelancer Mensal ou Freelancer por Demanda), custo mensal e dia de pagamento',
      'Salve o cadastro'
    ]),
    _kb_h(2, 'Tipos de vínculo'),
    _kb_ul(ARRAY[
      'CLT — funcionário com carteira assinada e custo fixo mensal',
      'Freelancer Mensal — prestador de serviço com valor fixo mensal',
      'Freelancer por Demanda — profissional contratado por projeto ou tarefa'
    ]),
    _kb_callout('💡', 'blue', 'O custo mensal de cada membro é automaticamente considerado nos cálculos financeiros do Dashboard e no calendário de pagamentos.'),
    _kb_h(2, 'Vinculando ao workspace'),
    _kb_p('Você pode vincular um membro da equipe a um usuário do workspace. Isso permite que a pessoa acesse o CRM com seu próprio login. Para vincular, edite o membro e selecione o usuário correspondente na lista.'),
    _kb_h(2, 'Visão geral de custos'),
    _kb_p('Na página da Equipe, o cabeçalho mostra o custo total mensal da equipe com breakdown por tipo de vínculo. Use essas informações para acompanhar a evolução dos custos operacionais.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0005-4000-a000-000000000005', 'Como gerenciar sua equipe', 'como-gerenciar-sua-equipe',
    'Cadastre membros da equipe, defina tipos de vínculo e acompanhe custos.',
    v_content, v_plain, 'equipe', ARRAY['equipe', 'membros', 'clt', 'freelancer', 'custos'], 'published', 20)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 6. Como criar e gerenciar fluxos
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'O que são fluxos?'),
    _kb_p('Fluxos são os projetos de entrega para seus clientes. Cada fluxo possui etapas sequenciais (como Briefing, Criação, Revisão, Aprovação) que organizam o trabalho da equipe. Os fluxos são exibidos em um quadro Kanban na página Entregas.'),
    _kb_h(2, 'Criando um fluxo'),
    _kb_ol(ARRAY[
      'Acesse a página Entregas no menu lateral',
      'Clique em "Novo Fluxo"',
      'Selecione o cliente',
      'Defina as etapas do fluxo: nome da etapa, prazo em dias, responsável e se o prazo conta dias úteis',
      'Opcionalmente, marque como fluxo recorrente para que um novo ciclo seja criado automaticamente ao concluir',
      'Salve o fluxo'
    ]),
    _kb_callout('📌', 'orange', 'Você pode criar Templates de fluxos para padronizar processos recorrentes. Assim, ao criar um novo fluxo, basta selecionar o template e as etapas serão preenchidas automaticamente.'),
    _kb_h(2, 'Visualizações disponíveis'),
    _kb_p('A página de Entregas oferece diferentes formas de visualizar seus fluxos:'),
    _kb_ul(ARRAY[
      'Kanban — arraste e acompanhe o progresso visual de cada fluxo',
      'Gráfico — veja métricas de desempenho e prazos',
      'Calendário — visualize entregas por data em um calendário mensal',
      'Lista — visão compacta em formato de tabela',
      'Concluídos — histórico de fluxos finalizados'
    ]),
    _kb_h(2, 'Gerenciando etapas'),
    _kb_p('Cada etapa de um fluxo mostra o responsável, prazo restante e indicadores de urgência. Etapas atrasadas são destacadas em vermelho. Ao concluir uma etapa, o fluxo avança automaticamente para a próxima.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0006-4000-a000-000000000006', 'Como criar e gerenciar fluxos', 'como-criar-e-gerenciar-fluxos',
    'Crie fluxos de trabalho com etapas, prazos e templates para organizar suas entregas.',
    v_content, v_plain, 'entregas-e-fluxos', ARRAY['fluxos', 'entregas', 'kanban', 'templates', 'etapas'], 'published', 30)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 7. Aprovação e publicação de posts
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'Ciclo de vida de um post'),
    _kb_p('Cada post dentro de um fluxo passa por etapas de aprovação antes de ser publicado:'),
    _kb_ol(ARRAY[
      'Enviado — o post foi criado e está aguardando revisão interna',
      'Enviado ao Cliente — post enviado para aprovação do cliente via Hub',
      'Aprovado pelo Cliente — cliente aprovou o conteúdo',
      'Agendado — post confirmado para publicação em data específica',
      'Publicado — post foi publicado no Instagram com sucesso'
    ]),
    _kb_h(2, 'Aprovação pelo cliente'),
    _kb_p('Quando um post é enviado ao cliente, ele aparece automaticamente no Hub do Cliente na seção de Aprovações. O cliente pode aprovar o post ou solicitar correções com comentários. Você recebe a notificação da resposta diretamente no CRM.'),
    _kb_callout('✅', 'green', 'Ative a opção "Auto-publicar ao aprovar" na página do cliente para que posts aprovados sejam publicados automaticamente no Instagram, sem necessidade de ação manual.'),
    _kb_h(2, 'Formatos de post suportados'),
    _kb_ul(ARRAY[
      'Feed — imagem única no feed do Instagram',
      'Carrossel — múltiplas imagens em sequência',
      'Reels — vídeos curtos',
      'Stories — conteúdo temporário de 24 horas'
    ]),
    _kb_h(2, 'Acompanhando publicações'),
    _kb_p('Na página de detalhes do cliente, o calendário de posts mostra todos os conteúdos organizados por data e tipo. Use os filtros para visualizar posts por status e acompanhar o progresso das entregas.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0007-4000-a000-000000000007', 'Aprovação e publicação de posts', 'aprovacao-e-publicacao-de-posts',
    'Entenda o fluxo de aprovação de posts e como publicar no Instagram.',
    v_content, v_plain, 'entregas-e-fluxos', ARRAY['posts', 'aprovacao', 'publicacao', 'instagram', 'hub'], 'published', 31)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 8. Como configurar o Hub do Cliente
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'O que é o Hub do Cliente?'),
    _kb_p('O Hub do Cliente é um portal exclusivo onde seus clientes podem aprovar posts, visualizar o calendário editorial, acessar diretrizes de marca, responder briefings e enviar ideias de conteúdo. Cada cliente recebe um link único e não precisa criar conta para acessar.'),
    _kb_h(2, 'Ativando o Hub'),
    _kb_ol(ARRAY[
      'Acesse a página de detalhes do cliente',
      'Na seção "Hub do Cliente", clique em "Ativar Hub"',
      'O sistema gerará um link exclusivo para o cliente',
      'Compartilhe o link com o cliente por e-mail ou WhatsApp'
    ]),
    _kb_callout('⚠️', 'orange', 'Apenas proprietários e admins podem ativar e gerenciar o Hub do Cliente. Agentes não têm acesso a esta seção.'),
    _kb_h(2, 'O que o cliente vê no Hub'),
    _kb_ul(ARRAY[
      'Aprovações — posts aguardando aprovação com opção de aprovar ou solicitar correções',
      'Postagens — calendário editorial completo com status de cada post',
      'Marca — diretrizes de identidade visual: logo, cores, tipografia e arquivos',
      'Briefing — questionário personalizado para o cliente preencher',
      'Ideias — espaço para o cliente sugerir ideias de conteúdo'
    ]),
    _kb_h(2, 'Gerenciando o acesso'),
    _kb_p('Você pode desativar temporariamente o Hub de um cliente sem perder os dados. Basta alternar o toggle de ativação na página de detalhes do cliente. O link permanece o mesmo quando reativado.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0008-4000-a000-000000000008', 'Como configurar o Hub do Cliente', 'como-configurar-o-hub-do-cliente',
    'Ative o portal do cliente para aprovações, briefings e comunicação.',
    v_content, v_plain, 'hub-do-cliente', ARRAY['hub', 'portal', 'cliente', 'aprovacao', 'briefing'], 'published', 40)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 9. Como conectar o Instagram
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'Pré-requisitos'),
    _kb_p('Para conectar uma conta do Instagram ao Mesaas, é necessário:'),
    _kb_ul(ARRAY[
      'A conta do Instagram deve ser do tipo Profissional (Business ou Creator)',
      'A conta deve estar vinculada a uma Página do Facebook',
      'O proprietário da conta deve autorizar o acesso durante o processo de conexão'
    ]),
    _kb_h(2, 'Conectando a conta'),
    _kb_ol(ARRAY[
      'Acesse a página de detalhes do cliente',
      'Na seção Instagram, clique em "Conectar Instagram"',
      'Você será redirecionado para o Facebook para autorizar o acesso',
      'Selecione a página do Facebook vinculada à conta do Instagram',
      'Confirme as permissões solicitadas',
      'Após a autorização, os dados da conta serão sincronizados automaticamente'
    ]),
    _kb_callout('⚠️', 'orange', 'Se a conta do Instagram não aparecer durante a autorização, verifique se ela está configurada como conta profissional e vinculada a uma página do Facebook.'),
    _kb_h(2, 'Sincronização de dados'),
    _kb_p('Após a conexão, o Mesaas busca automaticamente os dados da conta: seguidores, posts recentes, métricas de engajamento e alcance. A sincronização pode ser feita manualmente a qualquer momento clicando em "Sincronizar" ou automaticamente se a opção estiver ativada nas configurações.'),
    _kb_h(2, 'Solução de problemas'),
    _kb_ul(ARRAY[
      'Token expirado — reconecte a conta refazendo o processo de autorização',
      'Permissões revogadas — o proprietário da conta precisa autorizar novamente pelo Facebook',
      'Conta não encontrada — verifique se a conta é do tipo profissional e está vinculada a uma página'
    ])
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-0009-4000-a000-000000000009', 'Como conectar o Instagram', 'como-conectar-o-instagram',
    'Conecte contas do Instagram ao Mesaas para analytics e publicação.',
    v_content, v_plain, 'instagram-e-analytics', ARRAY['instagram', 'conexao', 'facebook', 'oauth', 'sync'], 'published', 50)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 10. Entendendo o painel de Analytics
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'Visão geral do portfólio'),
    _kb_p('O painel de Analytics mostra as métricas consolidadas de todas as contas de Instagram conectadas. No topo, os KPIs principais incluem: contas conectadas, total de seguidores, alcance total, taxa média de engajamento e cliques no site.'),
    _kb_h(2, 'Destaques e alertas'),
    _kb_p('A seção de destaques identifica automaticamente:'),
    _kb_ul(ARRAY[
      'Melhor engajamento — conta com maior taxa de interação',
      'Maior crescimento — conta que mais ganhou seguidores no período',
      'Maior alcance — conta que atingiu mais pessoas',
      'Mais seguidores — conta com maior audiência',
      'Mais ativa — conta com mais posts publicados no período'
    ]),
    _kb_p('O sistema também alerta sobre contas silenciosas — aquelas que não publicaram nos últimos 7 dias — para que você tome ação.'),
    _kb_h(2, 'Análise de IA do Portfólio'),
    _kb_p('A Análise de IA gera um diagnóstico completo do seu portfólio de contas usando inteligência artificial. Para ativá-la, clique no botão "Análise de IA" no painel de Analytics. O relatório inclui:'),
    _kb_ul(ARRAY[
      'Score de saúde — nota de 0 a 100 que resume a performance geral do portfólio, com código de cores (verde ≥ 70, amarelo ≥ 40, vermelho < 40)',
      'Ranking de contas — cada conta recebe um status (destaque, estável, atenção ou crítico) com a métrica principal em evidência',
      'Insights cruzados — a IA identifica padrões entre as contas, como formatos que performam melhor ou horários ideais de publicação',
      'Recomendações de alocação — sugestões de como distribuir esforço entre as contas para maximizar resultados',
      'Resumo mensal — um digest do desempenho geral do mês',
      'Ações prioritárias — lista estruturada com nível de prioridade (alta, média, baixa), conta afetada, ação sugerida e impacto esperado'
    ]),
    _kb_callout('🧠', 'purple', 'A análise é gerada sob demanda e pode levar alguns segundos. O timestamp indica quando foi gerada pela última vez, permitindo comparar a evolução ao longo do tempo.'),
    _kb_h(2, 'Melhores e piores posts'),
    _kb_p('A seção de posts mostra os 5 melhores e piores conteúdos por alcance. Clique em "Ver mais" para abrir o painel completo com filtros avançados por formato (imagem, reels, carrossel), cliente, período e ordenação.'),
    _kb_h(2, 'Tabela de contas'),
    _kb_p('A tabela lista todas as contas com colunas de seguidores, engajamento, alcance, posts recentes e cliques no site. Ordene por qualquer coluna para identificar rapidamente quais contas precisam de atenção e quais estão performando bem.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-000a-4000-a000-00000000000a', 'Entendendo o painel de Analytics', 'entendendo-o-painel-de-analytics',
    'Leia métricas do portfólio, identifique destaques e use a análise de IA.',
    v_content, v_plain, 'instagram-e-analytics', ARRAY['analytics', 'metricas', 'engajamento', 'alcance', 'ia'], 'published', 51)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 11. Como usar o Post Express
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'O que é o Post Express?'),
    _kb_p('O Post Express permite publicar posts diretamente no Instagram de um cliente sem precisar criar um fluxo de trabalho completo. Ideal para conteúdos rápidos, repostagens ou publicações urgentes.'),
    _kb_h(2, 'Como publicar'),
    _kb_ol(ARRAY[
      'Acesse Post Express no menu lateral',
      'Selecione o cliente (a conta de Instagram precisa estar conectada)',
      'Faça upload da mídia: imagem para post de feed, vídeo para reels ou múltiplas imagens para carrossel',
      'Escreva a legenda (até 2.200 caracteres)',
      'Visualize como o post ficará no Instagram',
      'Clique em "Publicar" para enviar ao Instagram'
    ]),
    _kb_callout('💡', 'blue', 'O sistema detecta automaticamente o tipo de post (feed, reels ou carrossel) com base na mídia enviada.'),
    _kb_h(2, 'Requisitos'),
    _kb_ul(ARRAY[
      'O cliente deve ter uma conta de Instagram conectada e ativa',
      'A conta do Instagram precisa ser do tipo profissional (Business ou Creator)',
      'As permissões de publicação devem estar autorizadas'
    ]),
    _kb_h(2, 'Após a publicação'),
    _kb_p('Quando o post é publicado com sucesso, o sistema cria automaticamente um fluxo de entrega como rascunho para manter o registro. Você pode acompanhar o status da publicação e, caso ocorra algum erro, será notificado para tomar ação.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-000b-4000-a000-00000000000b', 'Como usar o Post Express', 'como-usar-o-post-express',
    'Publique rapidamente no Instagram sem criar um fluxo completo.',
    v_content, v_plain, 'post-express', ARRAY['post-express', 'publicacao', 'instagram', 'rapido'], 'published', 60)
  ON CONFLICT (slug) DO NOTHING;

  -- -------------------------------------------------------
  -- 12. Gestão financeira
  -- -------------------------------------------------------
  v_content := _kb_doc(
    _kb_h(2, 'Receitas e despesas'),
    _kb_p('O módulo Financeiro centraliza o controle de todas as entradas e saídas do seu negócio. Para registrar uma transação:'),
    _kb_ol(ARRAY[
      'Acesse a página Financeiro no menu lateral',
      'Clique em "Nova Transação"',
      'Selecione o tipo: Entrada (receita) ou Saída (despesa)',
      'Preencha: descrição, valor, data, categoria e status (Pago ou Agendado)',
      'Salve a transação'
    ]),
    _kb_p('As categorias disponíveis incluem: Mensalidade, Produção, Tráfego, Salário, Imposto, Ferramenta e Outro.'),
    _kb_h(2, 'Indicadores financeiros'),
    _kb_p('O painel mostra cinco indicadores principais:'),
    _kb_ul(ARRAY[
      'Recebido — total de receitas já confirmadas no mês',
      'A Receber — receitas agendadas ainda não confirmadas',
      'A Pagar — despesas agendadas pendentes',
      'Saldo Atual — diferença entre recebido e pago',
      'Saldo Projetado — previsão considerando todas as transações do mês'
    ]),
    _kb_callout('📌', 'orange', 'Transações de receita são geradas automaticamente a partir do valor mensal e dia de pagamento de cada cliente ativo. Despesas são geradas a partir dos custos dos membros da equipe.'),
    _kb_h(2, 'Contratos'),
    _kb_p('Na página de Contratos, gerencie os acordos com seus clientes. Cada contrato possui título, cliente vinculado, datas de início e fim, valor total e status (A Assinar, Vigente ou Encerrado). O Dashboard alerta automaticamente sobre contratos que vencem nos próximos 30 dias.'),
    _kb_h(2, 'Calendário de pagamentos'),
    _kb_p('O Calendário mostra todas as receitas e despesas previstas para o mês, organizadas por dia. Clique em um dia para ver os detalhes e confirmar pagamentos diretamente pela interface.')
  );
  v_plain := _kb_plain(v_content);
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES ('aaaaaaaa-000c-4000-a000-00000000000c', 'Gestão financeira', 'gestao-financeira',
    'Controle receitas, despesas, contratos e o calendário de pagamentos.',
    v_content, v_plain, 'financeiro', ARRAY['financeiro', 'receitas', 'despesas', 'contratos', 'calendario'], 'published', 70)
  ON CONFLICT (slug) DO NOTHING;

END;
$$;

-- ============================================================
-- Context links: wire articles to CRM pages
-- ============================================================

INSERT INTO kb_context_links (route_pattern, article_id, label, display_order) VALUES
  ('/dashboard',    'aaaaaaaa-0001-4000-a000-000000000001', NULL, 0),
  ('/configuracao', 'aaaaaaaa-0002-4000-a000-000000000002', NULL, 0),
  ('/clientes',     'aaaaaaaa-0003-4000-a000-000000000003', NULL, 0),
  ('/clientes',     'aaaaaaaa-0008-4000-a000-000000000008', 'Hub do Cliente', 1),
  ('/leads',        'aaaaaaaa-0004-4000-a000-000000000004', NULL, 0),
  ('/equipe',       'aaaaaaaa-0005-4000-a000-000000000005', NULL, 0),
  ('/entregas',     'aaaaaaaa-0006-4000-a000-000000000006', NULL, 0),
  ('/entregas',     'aaaaaaaa-0007-4000-a000-000000000007', NULL, 1),
  ('/analytics',    'aaaaaaaa-0009-4000-a000-000000000009', NULL, 0),
  ('/analytics',    'aaaaaaaa-000a-4000-a000-00000000000a', NULL, 1),
  ('/post-express', 'aaaaaaaa-000b-4000-a000-00000000000b', NULL, 0),
  ('/financeiro',   'aaaaaaaa-000c-4000-a000-00000000000c', NULL, 0),
  ('/contratos',    'aaaaaaaa-000c-4000-a000-00000000000c', NULL, 0),
  ('/calendario',   'aaaaaaaa-000c-4000-a000-00000000000c', NULL, 0)
ON CONFLICT (route_pattern, article_id) DO NOTHING;

-- ============================================================
-- Cleanup helper functions
-- ============================================================

DROP FUNCTION IF EXISTS _kb_doc(VARIADIC jsonb[]);
DROP FUNCTION IF EXISTS _kb_h(int, text);
DROP FUNCTION IF EXISTS _kb_p(text);
DROP FUNCTION IF EXISTS _kb_p_mixed(VARIADIC jsonb[]);
DROP FUNCTION IF EXISTS _kb_text(text);
DROP FUNCTION IF EXISTS _kb_bold(text);
DROP FUNCTION IF EXISTS _kb_ul(text[]);
DROP FUNCTION IF EXISTS _kb_ol(text[]);
DROP FUNCTION IF EXISTS _kb_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_plain(jsonb);
