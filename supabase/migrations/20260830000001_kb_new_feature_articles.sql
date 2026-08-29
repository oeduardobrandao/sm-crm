-- Nove artigos novos da Central de Ajuda cobrindo os lançamentos de agosto/2026:
-- relatorio interativo de blocos (2), cobranca 12x + troca de plano + uso do
-- plano (3), Mensagens, Tarefas, Automacoes e Notificacoes por e-mail.
--
-- Categorias novas usadas aqui (relatorios, cobranca, mensagens, tarefas,
-- automacoes) sao valores livres na coluna text; os rotulos amigaveis ficam em
-- apps/crm/src/pages/ajuda/categoryConfig.ts e no mapa CATEGORIES do admin,
-- atualizados no mesmo PR.
--
-- O artigo de Automacoes nasce com status 'draft' de proposito: o recurso
-- depende de aprovacao de permissoes pela Meta e esta liberado para um unico
-- workspace. Publicar pelo admin quando abrir para todos.
--
-- Texto puro (sem imagens). Se no futuro forem adicionadas imagens via
-- inlineImage, usar o cast ::jsonb[] no array de images (ver 20260806000003).

-- -----------------------------------------------------------------------
-- Helpers (prefixo _kb_nf_), dropados no fim
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _kb_nf_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_nf_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_nf_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_nf_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_nf_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_nf_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_nf_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_nf_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_nf_ol(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_nf_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_nf_ul(items text[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'bulletList', 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(_kb_nf_p(items[i])))
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_nf_plain(doc jsonb) RETURNS text AS $$
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

-- Igual aos upserts anteriores, mas com p_status explicito: o artigo de
-- Automacoes entra como draft.
CREATE OR REPLACE FUNCTION _kb_nf_upsert(
  p_id uuid, p_title text, p_slug text, p_excerpt text, p_content jsonb,
  p_category text, p_tags text[], p_display_order integer, p_status text
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES (p_id, p_title, p_slug, p_excerpt, p_content, _kb_nf_plain(p_content), p_category, p_tags, p_status, p_display_order)
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

CREATE OR REPLACE FUNCTION _kb_nf_link(
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
-- Relatorios (2 artigos)
-- -----------------------------------------------------------------------

SELECT _kb_nf_upsert(
  'cccccccc-0001-4000-c000-000000000001',
  'Como montar um relatório interativo',
  'como-montar-um-relatorio-interativo',
  'Crie relatórios de Instagram em blocos, com números, gráficos e textos que você monta como quiser, e compartilhe com o cliente pelo Hub.',
  _kb_nf_doc(
    _kb_nf_h(2, 'O que é o relatório interativo'),
    _kb_nf_p('O relatório interativo é um documento montado em blocos: você escolhe quais números, gráficos e textos entram, arrasta cada um para a posição que quiser e o resultado vira uma página que o cliente abre direto no Hub. É diferente do relatório gerado em página única: aqui você tem controle total sobre o conteúdo e a ordem.'),
    _kb_nf_p('Os dados vêm da conta de Instagram conectada ao cliente. Antes de montar o primeiro relatório, a conta precisa estar conectada e sincronizada. Se ainda não estiver, o artigo Como conectar o Instagram mostra o caminho.'),
    _kb_nf_h(2, 'Criando um relatório'),
    _kb_nf_ol(ARRAY[
      'Abra Analytics no menu lateral e entre na conta do cliente',
      'Role até a seção Relatórios Interativos',
      'Clique em Novo relatório interativo',
      'Escolha o modelo: Padrão do sistema ou um template salvo por você',
      'Escolha o mês do relatório e clique em Gerar relatório'
    ]),
    _kb_nf_p('O sistema busca os dados do período e abre o editor com o relatório já montado no modelo escolhido. A partir daí, tudo é editável.'),
    _kb_nf_h(2, 'Editando os blocos'),
    _kb_nf_p('No editor, cada bloco pode ser arrastado, redimensionado ou excluído. Para adicionar um bloco novo, clique em Adicionar widget e escolha entre as categorias:'),
    _kb_nf_ul(ARRAY[
      'Números - novos seguidores, seguidores totais, alcance, visualizações, taxa de engajamento, salvamentos, publicações, visitas ao perfil e cliques no link',
      'Gráficos - evolução de seguidores, desempenho por formato e melhores horários',
      'Audiência - gênero, faixa etária, cidades e países',
      'Conteúdo - top publicações, lista de publicações e performance por tópico',
      'Texto - texto livre, resumo do mês, recomendações e metas',
      'Estrutura - capa, cabeçalho de seção e divisor de página'
    ]),
    _kb_nf_p('Os blocos de texto têm editor completo, com negrito, listas e títulos. Os blocos Resumo do mês, Recomendações e Metas vêm com uma análise gerada automaticamente a partir dos dados do período, que você pode editar ou reescrever por completo antes de enviar.'),
    _kb_nf_p('O painel Camadas lista todos os blocos na ordem em que aparecem. Arraste para reordenar ou clique em um item para localizá-lo no relatório. O botão Desfazer reverte a última alteração, e tudo é salvo automaticamente enquanto você edita.'),
    _kb_nf_callout('💡', 'blue', 'Se os dados mudaram depois que o relatório foi gerado, use Atualizar dados para puxar os números mais recentes sem perder a montagem.'),
    _kb_nf_h(2, 'Salvando um template'),
    _kb_nf_p('Se você montou uma estrutura que quer repetir todo mês, salve como template:'),
    _kb_nf_ol(ARRAY[
      'Abra o menu de ações do relatório',
      'Clique em Salvar como template e dê um nome, por exemplo Relatório mensal padrão',
      'Nos próximos relatórios, escolha esse template no campo Modelo ao criar, ou use Aplicar template em um relatório já aberto'
    ]),
    _kb_nf_p('Um template guarda os blocos, a ordem e a aparência. Você pode marcar um como Definir como padrão para que ele venha pré-selecionado nos próximos relatórios.'),
    _kb_nf_h(2, 'Compartilhando com o cliente'),
    _kb_nf_p('O relatório aparece automaticamente na aba Relatórios do Hub do cliente assim que fica pronto. Antes de avisar o cliente, use Ver como cliente no editor para conferir exatamente o que ele vai ver.'),
    _kb_nf_callout('⚠️', 'orange', 'O relatório fica visível no Hub para qualquer pessoa com o link do portal. Revise o conteúdo antes de considerar o relatório entregue.'),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('Para deixar o relatório com a cara da sua agência, com tema, fontes e cor de destaque próprios, veja o artigo Aparência, temas e PDF do relatório. Para entender de onde vêm os números, veja Analytics por conta: melhores horários, tags e relatórios.')
  ),
  'relatorios',
  ARRAY['relatorios', 'analytics', 'instagram', 'hub', 'blocos', 'templates'],
  1,
  'published'
);

SELECT _kb_nf_upsert(
  'cccccccc-0002-4000-c000-000000000002',
  'Aparência, temas e PDF do relatório',
  'aparencia-temas-e-pdf-do-relatorio',
  'Personalize o visual do relatório interativo com temas, fontes e cor de destaque, e exporte uma versão em PDF para enviar por e-mail ou WhatsApp.',
  _kb_nf_doc(
    _kb_nf_h(2, 'Onde fica a personalização'),
    _kb_nf_p('Com um relatório aberto no editor, clique em Aparência. O popover reúne as três escolhas visuais do documento:'),
    _kb_nf_ul(ARRAY[
      'Tema do relatório - Padrão, Clean, Editorial ou Bold',
      'Fontes do relatório - combinações de fonte de título e fonte de texto',
      'Cor de destaque - a cor que pinta capa, números e detalhes'
    ]),
    _kb_nf_p('Essas escolhas valem para aquele relatório. Se você salvar a montagem como template, a aparência viaja junto: os próximos relatórios criados a partir dele já nascem com o mesmo visual.'),
    _kb_nf_h(2, 'Escolhendo o tema'),
    _kb_nf_p('O tema Padrão segue o visual do Hub do cliente, incluindo a cor de marca configurada na personalização do portal. É a escolha certa quando você quer que o relatório pareça parte do Hub, sem esforço extra.'),
    _kb_nf_p('Os outros três temas assumem uma direção própria:'),
    _kb_nf_ul(ARRAY[
      'Clean prioriza fundo claro e leitura rápida, bom para relatórios densos em números',
      'Editorial usa tipografia serifada e mais respiro, com cara de publicação',
      'Bold aposta em contraste e peso, para apresentações de impacto'
    ]),
    _kb_nf_callout('💡', 'blue', 'Troque de tema a qualquer momento sem medo: o conteúdo e a posição dos blocos não mudam, só o visual.'),
    _kb_nf_h(2, 'Cor de destaque'),
    _kb_nf_p('Ao escolher uma cor de destaque, o relatório deriva automaticamente uma paleta inteira a partir dela: tons para textos sobre a cor, linhas e preenchimentos. O contraste é calculado para manter a leitura confortável, então você pode usar a cor exata da marca do cliente sem se preocupar com texto ilegível.'),
    _kb_nf_h(2, 'Exportando em PDF'),
    _kb_nf_p('Nem todo cliente vai abrir o Hub. Para enviar o relatório por e-mail ou WhatsApp:'),
    _kb_nf_ol(ARRAY[
      'Abra o relatório no editor',
      'Clique em Exportar PDF',
      'Aguarde a geração e salve o arquivo'
    ]),
    _kb_nf_p('O PDF respeita o tema, as fontes e a cor de destaque escolhidos, com quebras de página nos divisores que você posicionou. Se quiser controlar onde cada página termina, use o bloco Divisor de página, da categoria Estrutura, nos pontos de corte.'),
    _kb_nf_callout('⚠️', 'orange', 'O PDF é uma foto do relatório naquele momento. Se você atualizar os dados ou editar blocos depois, exporte de novo para gerar a versão atualizada.'),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('Se você ainda não montou o primeiro relatório, comece pelo artigo Como montar um relatório interativo. Para configurar a cor de marca que o tema Padrão herda, veja Como configurar o Hub do Cliente.')
  ),
  'relatorios',
  ARRAY['relatorios', 'pdf', 'personalizacao', 'whitelabel', 'temas'],
  2,
  'published'
);

-- -----------------------------------------------------------------------
-- Cobranca (3 artigos)
-- -----------------------------------------------------------------------

SELECT _kb_nf_upsert(
  'cccccccc-0003-4000-c000-000000000003',
  'Assinatura anual em 12x no cartão',
  'assinatura-anual-em-12x',
  'Assine o plano anual parcelado em 12x no cartão de crédito, sem juros, com teste grátis de 30 dias na primeira assinatura.',
  _kb_nf_doc(
    _kb_nf_h(2, 'As formas de pagar o plano anual'),
    _kb_nf_p('O plano anual tem duas formas de pagamento, e você escolhe na hora de assinar:'),
    _kb_nf_ul(ARRAY[
      '12x no cartão de crédito, sem juros - o valor da parcela aparece no card do plano',
      'À vista - pagamento único com desconto sobre o total'
    ]),
    _kb_nf_p('O plano mensal continua existindo como terceira opção, com cobrança mês a mês. Os valores de cada modalidade aparecem em Configuração, na aba do plano, e também na página de preços.'),
    _kb_nf_h(2, 'Assinando em 12x'),
    _kb_nf_ol(ARRAY[
      'Abra Configuração no menu lateral e vá até a aba do plano',
      'Escolha o plano e clique no botão de assinatura',
      'Preencha os dados do cartão: número, nome impresso, validade e CVV',
      'Informe CPF ou CNPJ, celular e o endereço de cobrança',
      'Clique em Começar 30 dias grátis, ou Confirmar assinatura se você já foi assinante antes'
    ]),
    _kb_nf_p('Na primeira assinatura, os 30 primeiros dias são de teste grátis: a primeira parcela só é cobrada quando o período de teste termina, e você pode cancelar antes sem nenhuma cobrança. Quem já teve uma assinatura antes não passa por novo período de teste, e a primeira parcela é cobrada na confirmação.'),
    _kb_nf_callout('🔒', 'purple', 'Os dados do cartão vão direto do seu navegador para o processador de pagamento. Eles não passam pelos servidores do Mesaas e não ficam armazenados aqui.'),
    _kb_nf_p('Se preferir pagar à vista, use a opção Assinar à vista no mesmo diálogo: ela mostra o valor com desconto e segue para o checkout de pagamento único.'),
    _kb_nf_h(2, 'Como funciona a cobrança'),
    _kb_nf_p('As 12 parcelas são cobradas no cartão, uma por mês. É um parcelamento de verdade: você não paga o ano inteiro de uma vez, e cada parcela aparece separadamente na fatura do cartão.'),
    _kb_nf_p('Se uma cobrança falhar, por exemplo por cartão vencido ou limite, você recebe um aviso por e-mail com o link para atualizar o cartão. O acesso não é cortado de imediato: há um período de recuperação antes de qualquer bloqueio.'),
    _kb_nf_h(2, 'Gerenciando a assinatura'),
    _kb_nf_p('Tudo fica em Configuração, na aba do plano, pelo botão Gerenciar assinatura:'),
    _kb_nf_ul(ARRAY[
      'Atualizar cartão - cadastre um cartão novo a qualquer momento. A próxima cobrança já usa o novo cartão',
      'Cancelar assinatura - durante o teste grátis, o cancelamento é imediato e sem cobrança. Com a assinatura ativa, você mantém o acesso até o fim do período já pago'
    ]),
    _kb_nf_callout('⚠️', 'orange', 'Só o dono do workspace vê e gerencia a assinatura. Administradores e agentes não têm acesso à aba de cobrança.'),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('Se você já assina o plano mensal e quer migrar para o anual em 12x sem perder o período que já pagou, veja o artigo Como trocar do plano mensal para o anual em 12x. Para entender os limites de cada plano, veja Entendendo o uso do plano.')
  ),
  'cobranca',
  ARRAY['cobranca', 'assinatura', 'pagamento', 'plano', '12x', 'cartao'],
  1,
  'published'
);

SELECT _kb_nf_upsert(
  'cccccccc-0004-4000-c000-000000000004',
  'Como trocar do plano mensal para o anual em 12x',
  'trocar-do-mensal-para-o-anual-em-12x',
  'Migre da assinatura mensal para o anual parcelado sem pagar duas vezes, sem perder acesso e com opção de desfazer antes da virada.',
  _kb_nf_doc(
    _kb_nf_h(2, 'O que a troca faz'),
    _kb_nf_p('Se você assina o plano mensal e quer passar para o anual em 12x, não precisa cancelar uma assinatura e abrir outra. A troca cuida de tudo:'),
    _kb_nf_ul(ARRAY[
      'Você não paga duas assinaturas ao mesmo tempo',
      'O período mensal que você já pagou é respeitado até o último dia',
      'A primeira parcela do 12x só é cobrada quando o período mensal atual termina',
      'Até lá, nada muda no seu acesso'
    ]),
    _kb_nf_h(2, 'Fazendo a troca'),
    _kb_nf_ol(ARRAY[
      'Abra Configuração no menu lateral e vá até a aba do plano',
      'No card do plano anual, clique em Trocar para o anual em 12x',
      'Preencha os dados do cartão de crédito e o endereço de cobrança',
      'Clique em Confirmar troca'
    ]),
    _kb_nf_p('Pronto: a troca fica agendada. O card do plano passa a mostrar Troca agendada, com a data em que o anual começa. Sua assinatura mensal segue normal até essa data e é encerrada automaticamente na virada, sem nova cobrança mensal.'),
    _kb_nf_callout('💡', 'blue', 'A troca usa o cartão que você informar nesse momento, que pode ser diferente do cartão da assinatura mensal.'),
    _kb_nf_h(2, 'Desfazendo a troca'),
    _kb_nf_p('Mudou de ideia? Enquanto a troca estiver agendada, ou seja, antes da primeira parcela do 12x ser cobrada, dá para voltar atrás:'),
    _kb_nf_ol(ARRAY[
      'Abra Configuração e vá até a aba do plano',
      'No card com a Troca agendada, clique em Desfazer a troca'
    ]),
    _kb_nf_p('Seu plano mensal continua como estava e o 12x agendado é cancelado sem nenhuma cobrança. Depois que a primeira parcela do anual é cobrada, a troca está concluída e o caminho passa a ser o cancelamento normal da assinatura anual.'),
    _kb_nf_h(2, 'Perguntas comuns'),
    _kb_nf_h(3, 'Vou perder algum dia que já paguei?'),
    _kb_nf_p('Não. O anual só começa quando o período mensal pago termina.'),
    _kb_nf_h(3, 'A troca tem teste grátis?'),
    _kb_nf_p('Não. O teste de 30 dias vale para a primeira assinatura. Na troca, você já é assinante, então a primeira parcela é cobrada na data da virada.'),
    _kb_nf_h(3, 'Quem pode fazer a troca?'),
    _kb_nf_p('Só o dono do workspace, que é quem tem acesso à aba de cobrança.'),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('Para entender como funciona o parcelamento, a cobrança das parcelas e a gestão do cartão, veja o artigo Assinatura anual em 12x no cartão.')
  ),
  'cobranca',
  ARRAY['cobranca', 'assinatura', 'troca de plano', 'plano anual', '12x'],
  2,
  'published'
);

SELECT _kb_nf_upsert(
  'cccccccc-0008-4000-c000-000000000008',
  'Entendendo o uso do plano',
  'entendendo-o-uso-do-plano',
  'O painel Uso do plano mostra quanto do limite de clientes, equipe, armazenamento e outros recursos você já consumiu, e o que acontece ao chegar no teto.',
  _kb_nf_doc(
    _kb_nf_h(2, 'Onde ver o uso'),
    _kb_nf_p('Em Configuração, na aba do plano, o painel Uso do plano mostra um medidor para cada limite do seu plano:'),
    _kb_nf_ul(ARRAY[
      'Clientes',
      'Contas de Instagram',
      'Leads',
      'Vagas de equipe',
      'Portais do Hub',
      'Modelos de fluxo',
      'Chaves MCP',
      'Armazenamento'
    ]),
    _kb_nf_p('Cada medidor mostra o consumo atual sobre o limite, por exemplo 7 de 10. Recursos ilimitados no seu plano aparecem sem barra de limite. O armazenamento também aparece como medidor na barra lateral da página Arquivos.'),
    _kb_nf_h(2, 'Como ler os medidores'),
    _kb_nf_p('A barra fica verde enquanto há folga. Quando o uso passa de 75%, o dono do workspace começa a ver o aviso de upgrade, e a barra muda de cor conforme se aproxima do teto. A ideia é avisar antes de travar: com o aviso aparecendo, ainda há espaço para agir com calma.'),
    _kb_nf_callout('💡', 'blue', 'As vagas de equipe contam convites pendentes: um convite enviado e ainda não aceito já ocupa uma vaga. Se um convite antigo não vai ser aceito, cancele-o para liberar o espaço.'),
    _kb_nf_h(2, 'O que acontece ao atingir um limite'),
    _kb_nf_p('Ao chegar no teto de um recurso, a criação de novos itens daquele tipo é bloqueada: por exemplo, com o limite de clientes atingido, o sistema não deixa cadastrar um cliente novo. O que já existe continua funcionando normalmente, nada é apagado nem desativado.'),
    _kb_nf_p('Para voltar a criar, os caminhos são:'),
    _kb_nf_ul(ARRAY[
      'Liberar espaço - arquivar ou excluir itens que não usa mais. No caso do armazenamento, a limpeza automática de mídia publicada ajuda bastante, veja Como organizar e reutilizar arquivos',
      'Fazer upgrade - na mesma aba do plano, compare os planos e troque para um com limites maiores'
    ]),
    _kb_nf_h(2, 'Quem vê o quê'),
    _kb_nf_p('Todos os usuários do workspace veem os medidores. O aviso com o botão de upgrade aparece só para o dono do workspace, que é quem pode mudar o plano.'),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('Para conhecer as formas de pagamento do plano, veja Assinatura anual em 12x no cartão. Para gerenciar o espaço em disco, veja Como organizar e reutilizar arquivos.')
  ),
  'cobranca',
  ARRAY['plano', 'limites', 'uso', 'upgrade', 'armazenamento'],
  3,
  'published'
);

-- -----------------------------------------------------------------------
-- Mensagens
-- -----------------------------------------------------------------------

SELECT _kb_nf_upsert(
  'cccccccc-0005-4000-c000-000000000005',
  'Mensagens: as conversas com cada cliente em um só lugar',
  'mensagens-com-o-cliente',
  'A página de Mensagens reúne a conversa geral com o cliente e os comentários de aprovação de posts em um único feed, no CRM e no Hub.',
  _kb_nf_doc(
    _kb_nf_h(2, 'O que aparece em Mensagens'),
    _kb_nf_p('A página Mensagens, no menu lateral, mostra uma conversa por cliente, no formato de lista de conversas à esquerda e conversa aberta à direita. Cada conversa reúne, em ordem cronológica:'),
    _kb_nf_ul(ARRAY[
      'Mensagens gerais - o que você escreve para o cliente e o que ele responde pelo Hub',
      'Feedback de posts - aprovações, pedidos de correção e comentários que o cliente deixa nos posts pelo portal'
    ]),
    _kb_nf_p('Ou seja, você não precisa caçar o contexto em dois lugares: a conversa inteira com aquele cliente, incluindo o que aconteceu dentro das aprovações, está no mesmo feed.'),
    _kb_nf_h(2, 'Conversando com o cliente'),
    _kb_nf_ol(ARRAY[
      'Abra Mensagens no menu lateral',
      'Escolha a conversa na lista, ou use Buscar cliente para filtrar',
      'Escreva no campo de mensagem e clique em Enviar mensagem'
    ]),
    _kb_nf_p('Do lado do cliente, a conversa aparece na aba Mensagens do Hub. Ele lê e responde por lá, sem precisar de login: o acesso é pelo link do portal, como nas demais abas do Hub.'),
    _kb_nf_callout('💡', 'blue', 'Quando uma mensagem do feed se refere a um post, ela vem com um atalho do post. Clique nele para abrir o post direto, já no contexto da conversa.'),
    _kb_nf_h(2, 'Como saber que chegou mensagem'),
    _kb_nf_p('Mensagens novas do cliente geram notificação no sino do CRM. Se quiser receber também por e-mail, ative o tipo Mensagem do cliente em Configuração, na aba Notificações. O artigo Notificações por e-mail explica como funciona o resumo por e-mail.'),
    _kb_nf_p('No Hub, o cliente vê o indicador de novas mensagens ao abrir o portal.'),
    _kb_nf_h(2, 'Boas práticas'),
    _kb_nf_ul(ARRAY[
      'Use Mensagens para o combinado do dia a dia: alinhamentos, avisos de entrega, pedidos de material',
      'Feedback específico de um post continua melhor dentro do próprio post, pela aprovação: assim ele fica amarrado à peça certa, e mesmo assim aparece no feed da conversa',
      'A conversa é por cliente, não por pessoa: todos os usuários do workspace com acesso veem o mesmo histórico'
    ]),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('Se o cliente ainda não usa o portal, comece pelo artigo Como configurar o Hub do Cliente. Para entender o fluxo de aprovação que alimenta este feed, veja Como o cliente aprova posts pelo Hub.')
  ),
  'mensagens',
  ARRAY['mensagens', 'hub', 'comunicacao', 'aprovacao', 'cliente'],
  1,
  'published'
);

-- -----------------------------------------------------------------------
-- Tarefas
-- -----------------------------------------------------------------------

SELECT _kb_nf_upsert(
  'cccccccc-0006-4000-c000-000000000006',
  'Como organizar as tarefas da equipe',
  'como-organizar-as-tarefas-da-equipe',
  'Crie tarefas com responsável, prazo, subtarefas e vínculo com cliente, e acompanhe tudo em lista, kanban, calendário ou por membro.',
  _kb_nf_doc(
    _kb_nf_h(2, 'Para que serve a página Tarefas'),
    _kb_nf_p('Os fluxos de Entregas organizam a produção de conteúdo. A página Tarefas organiza todo o resto: ligar para um cliente, ajustar um contrato, preparar uma proposta, revisar o briefing. É o quadro de pendências internas da equipe, com responsável, prazo e vínculo opcional com um cliente.'),
    _kb_nf_p('No topo da página, quatro contadores dão o pulso do dia: Abertas, Atrasadas, Vencem hoje e Concluídas hoje.'),
    _kb_nf_h(2, 'Criando uma tarefa'),
    _kb_nf_ol(ARRAY[
      'Abra Tarefas no menu lateral',
      'Clique no botão de nova tarefa',
      'Dê um título respondendo à pergunta: o que precisa ser feito?',
      'Preencha o que fizer sentido: descrição, responsável, cliente, prazo e tags',
      'Se a tarefa tem etapas menores, adicione subtarefas'
    ]),
    _kb_nf_p('Só o título é obrigatório. O responsável é um membro da Equipe, o que permite atribuir tarefas até para quem não tem login no CRM. Se a pessoa tem login e o membro está vinculado ao usuário dela, a tarefa aparece nas pendências dela no Dashboard.'),
    _kb_nf_callout('💡', 'blue', 'Uma tarefa atribuída a alguém com login gera notificação no sino e, se a pessoa quiser, por e-mail: é o tipo Tarefa atribuída a você, em Configuração, na aba Notificações.'),
    _kb_nf_h(2, 'As quatro visualizações'),
    _kb_nf_p('Use as abas no topo para trocar de visão:'),
    _kb_nf_ul(ARRAY[
      'Lista - agrupada por prazo: Atrasadas, Hoje, Amanhã, Esta semana, Depois e Sem data. É a visão de o que queima primeiro',
      'Por membro - uma coluna por pessoa, para equilibrar a carga da equipe e achar gargalos',
      'Kanban - colunas A fazer, Em andamento e Concluídas, para acompanhar andamento',
      'Calendário - as tarefas nos dias de prazo, para enxergar a semana'
    ]),
    _kb_nf_p('Em qualquer visão, dá para concluir uma tarefa pela caixa de seleção, mudar status, prazo e responsável sem abrir o detalhe. Concluiu sem querer? Use Reabrir tarefa.'),
    _kb_nf_h(2, 'Filtros e tags'),
    _kb_nf_p('A barra de filtros combina busca por texto, cliente, membro, status e tags. As tags são livres: crie as suas, por exemplo comercial, financeiro ou urgente, e filtre por elas em qualquer visualização.'),
    _kb_nf_h(2, 'Tarefas no Dashboard'),
    _kb_nf_p('A seção Hoje do Dashboard puxa as tarefas com prazo para o dia, junto com posts e etapas, cada item com seu dono. Agentes veem as próprias pendências; donos e administradores veem o quadro do workspace inteiro. Assim ninguém precisa abrir a página Tarefas só para saber o que tem para hoje.'),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('Para entender a diferença entre membro da Equipe e usuário com login, veja Permissões e papéis no workspace. Para o trabalho de produção de conteúdo, que tem etapas e aprovação, o caminho é Como criar e gerenciar fluxos.')
  ),
  'tarefas',
  ARRAY['tarefas', 'equipe', 'produtividade', 'prazos', 'subtarefas'],
  1,
  'published'
);

-- -----------------------------------------------------------------------
-- Automacoes (DRAFT: publicar quando o recurso abrir para todos os planos)
-- -----------------------------------------------------------------------

SELECT _kb_nf_upsert(
  'cccccccc-0007-4000-c000-000000000007',
  'Automações: comentário no Instagram vira DM automática',
  'automacoes-de-comentario-para-dm',
  'Configure palavras-chave que, ao aparecerem nos comentários de um post, disparam uma mensagem automática no direct do seguidor, com até 3 botões de link.',
  _kb_nf_doc(
    _kb_nf_h(2, 'O que a automação faz'),
    _kb_nf_p('Você define palavras-chave, por exemplo quero ou link. Quando alguém comenta uma dessas palavras em um post do cliente, o sistema responde automaticamente com uma mensagem no direct dessa pessoa, e, se você quiser, também com uma resposta pública no comentário.'),
    _kb_nf_p('É o fluxo clássico de comente X que eu te mando o link, sem ninguém da equipe precisar ficar de plantão nos comentários.'),
    _kb_nf_h(2, 'Antes de começar'),
    _kb_nf_p('A automação usa permissões do Instagram que não faziam parte da conexão original. Se a conta do cliente foi conectada antes de a permissão de comentários existir, a página avisa e mostra o botão Reconectar Instagram. A reconexão é o mesmo fluxo de sempre, descrito em Como conectar o Instagram, apenas confirmando as permissões novas na tela da Meta.'),
    _kb_nf_h(2, 'Criando uma automação'),
    _kb_nf_ol(ARRAY[
      'Abra Automações no menu lateral',
      'Clique em Nova automação',
      'Dê um nome, por exemplo Promoção de agosto, e escolha o cliente',
      'Escolha o alvo: Todos os posts ou um Post específico',
      'Adicione as palavras-chave, digitando e pressionando Enter',
      'Escreva a mensagem do direct e, se quiser, a resposta pública',
      'Salve'
    ]),
    _kb_nf_p('No alvo por post específico, você escolhe entre posts Publicados e posts Em produção. Escolher um post em produção deixa a automação pronta de antemão: ela começa a valer sozinha quando o post for publicado, marcada como Aguardando publicação até lá.'),
    _kb_nf_callout('💡', 'blue', 'Se mais de uma automação casar com o mesmo comentário, a mais antiga vence. Cada comentário recebe no máximo uma DM, mesmo que a pessoa comente a palavra-chave várias vezes.'),
    _kb_nf_h(2, 'Botões de link na DM'),
    _kb_nf_p('Além do texto, a mensagem pode levar até 3 botões que abrem um link:'),
    _kb_nf_ol(ARRAY[
      'No formulário da automação, clique em Adicionar botão',
      'Dê um título de até 20 caracteres, por exemplo Ver oferta',
      'Cole a URL, que precisa começar com https://'
    ]),
    _kb_nf_p('Com botões, o texto da DM vai até 640 caracteres. A prévia ao lado do formulário mostra como a mensagem chega para o seguidor.'),
    _kb_nf_callout('⚠️', 'orange', 'Os botões aparecem no aplicativo do Instagram. Em quem lê a DM pelo Instagram web, pode aparecer só o texto. Se os botões não puderem ser entregues, o sistema envia a mensagem como texto simples em vez de não enviar nada.'),
    _kb_nf_h(2, 'Acompanhando os envios'),
    _kb_nf_p('A tabela de automações mostra, para cada uma, os DMs enviados, o último disparo e o interruptor Ativa. Clique em uma automação para ver o histórico de envios, com o status de cada um: Enviado, Parcial, Falhou ou Ignorado.'),
    _kb_nf_p('Para pausar sem apagar, desligue o interruptor. Excluir uma automação para de responder comentários imediatamente e remove o histórico de envios dela.'),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('A conexão da conta e as permissões estão em Como conectar o Instagram. Para publicar os posts que vão receber os comentários, veja Agendar, publicar agora e resolver falhas no Instagram.')
  ),
  'automacoes',
  ARRAY['automacoes', 'instagram', 'dm', 'comentarios', 'palavras-chave'],
  1,
  'draft'
);

-- -----------------------------------------------------------------------
-- Notificacoes por e-mail (primeiros-passos)
-- -----------------------------------------------------------------------

SELECT _kb_nf_upsert(
  'cccccccc-0009-4000-c000-000000000009',
  'Notificações por e-mail',
  'notificacoes-por-email',
  'Escolha quais avisos do sino também chegam por e-mail, em um resumo consolidado, e pause tudo quando precisar de silêncio.',
  _kb_nf_doc(
    _kb_nf_h(2, 'Sino e e-mail: qual a diferença'),
    _kb_nf_p('Tudo que acontece no workspace e diz respeito a você aparece no sino do CRM. O e-mail é uma camada extra, pensada para o que não pode esperar você abrir o sistema: uma publicação que falhou, um cliente pedindo correção, uma tarefa nova no seu nome.'),
    _kb_nf_p('Nem todo aviso do sino vira e-mail. Só os tipos de maior urgência têm envio por e-mail, e cada pessoa escolhe os seus.'),
    _kb_nf_h(2, 'Os tipos disponíveis'),
    _kb_nf_p('Em Configuração, na aba Notificações, a seção Notificações por e-mail lista os tipos que você pode ligar ou desligar:'),
    _kb_nf_ul(ARRAY[
      'Falha ao publicar - um post agendado não conseguiu ser publicado',
      'Correção do cliente - o cliente pediu ajustes em um post pelo Hub',
      'Mensagem em um post - alguém comentou em um post em que você está envolvido',
      'Mensagem do cliente - o cliente mandou mensagem pelo Hub',
      'Prazo se aproximando - uma etapa ou entrega sob sua responsabilidade está perto do prazo',
      'Tarefa atribuída a você',
      'Post atribuído a você',
      'Menções - alguém citou você com @ em um comentário ou descrição'
    ]),
    _kb_nf_p('Todos vêm ligados por padrão. A preferência é sua, individual: desligar um tipo não afeta o e-mail dos colegas, e o aviso continua aparecendo no sino normalmente.'),
    _kb_nf_h(2, 'O resumo consolidado'),
    _kb_nf_p('Para não virar spam, os avisos não saem um por e-mail. O sistema agrupa o que aconteceu em um único e-mail de resumo, enviado poucos minutos depois dos eventos, com o mais urgente no topo: falhas de publicação primeiro, menções por último. Se só uma coisa aconteceu, o resumo tem um item só.'),
    _kb_nf_callout('💡', 'blue', 'Cada item do resumo traz o link direto para o post, a tarefa ou a conversa em questão. Dá para resolver a pendência sem procurar nada.'),
    _kb_nf_h(2, 'Pausando tudo'),
    _kb_nf_p('Precisa de silêncio total, por exemplo em férias? Use a chave Pausar todos os e-mails no topo da aba. Ela suspende o envio de todos os tipos de uma vez, sem mexer nas suas escolhas individuais: ao despausar, tudo volta como estava.'),
    _kb_nf_h(2, 'Próximos passos'),
    _kb_nf_p('Boa parte dos avisos nasce das menções e das atribuições de trabalho. Veja Criando posts dentro de uma entrega para o dia a dia dos posts e Como organizar as tarefas da equipe para as tarefas.')
  ),
  'primeiros-passos',
  ARRAY['notificacoes', 'email', 'preferencias'],
  7,
  'published'
);

-- -----------------------------------------------------------------------
-- Context links
-- -----------------------------------------------------------------------

SELECT _kb_nf_link('/relatorios', 'como-montar-um-relatorio-interativo', NULL, 0);
SELECT _kb_nf_link('/relatorios', 'aparencia-temas-e-pdf-do-relatorio', 'Aparência e PDF', 1);
SELECT _kb_nf_link('/analytics', 'como-montar-um-relatorio-interativo', 'Relatório interativo', 3);

SELECT _kb_nf_link('/configuracao', 'assinatura-anual-em-12x', 'Plano anual em 12x', 2);
SELECT _kb_nf_link('/configuracao', 'trocar-do-mensal-para-o-anual-em-12x', 'Trocar para o 12x', 3);
SELECT _kb_nf_link('/configuracao', 'entendendo-o-uso-do-plano', 'Uso do plano', 4);
SELECT _kb_nf_link('/configuracao', 'notificacoes-por-email', 'Notificações por e-mail', 5);

SELECT _kb_nf_link('/mensagens', 'mensagens-com-o-cliente', NULL, 0);

SELECT _kb_nf_link('/tarefas', 'como-organizar-as-tarefas-da-equipe', NULL, 0);
SELECT _kb_nf_link('/dashboard', 'como-organizar-as-tarefas-da-equipe', 'Tarefas da equipe', 3);

-- O leitor filtra artigos draft, entao este link fica inerte ate a publicacao.
SELECT _kb_nf_link('/automacoes', 'automacoes-de-comentario-para-dm', NULL, 0);

-- -----------------------------------------------------------------------
-- Limpeza dos helpers
-- -----------------------------------------------------------------------

DROP FUNCTION IF EXISTS _kb_nf_link(text, text, text, integer);
DROP FUNCTION IF EXISTS _kb_nf_upsert(uuid, text, text, text, jsonb, text, text[], integer, text);
DROP FUNCTION IF EXISTS _kb_nf_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_nf_doc(VARIADIC jsonb[]);
DROP FUNCTION IF EXISTS _kb_nf_ul(text[]);
DROP FUNCTION IF EXISTS _kb_nf_ol(text[]);
DROP FUNCTION IF EXISTS _kb_nf_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_nf_h(int, text);
DROP FUNCTION IF EXISTS _kb_nf_p(text);
DROP FUNCTION IF EXISTS _kb_nf_text(text);
