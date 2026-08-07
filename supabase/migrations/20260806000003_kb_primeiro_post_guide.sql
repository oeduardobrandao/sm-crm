-- Guia visual "Como agendar seu primeiro post".
--
-- Imagens sao nos inlineImage com r2Key = NULL e URL publica permanente do
-- bucket kb-images. r2Key TEM que continuar NULL: se fosse preenchido, o
-- leitor (ArtigoPage.tsx -> extractR2Keys) mandaria a chave para
-- sign-r2-urls, que so assina chaves sob o prefixo da propria conta do
-- chamador ou que batam exatamente com um cover_image_url publicado. Uma
-- imagem de corpo nao e nenhum dos dois, entao a assinatura falharia em
-- silencio e o src pre-assinado da autoria daria 403 uma hora depois.
--
-- Nem todo passo tem captura ainda. Os passos 4-6 da secao 3 (telas do
-- Facebook, captura manual) e os 4 passos da secao 7 (bloqueados por token
-- do Instagram) usam imagem NULL: o helper _kb_pp_ol renderiza o passo so
-- com texto, e o artigo publica assim mesmo, melhorando quando as capturas
-- chegarem.
--
-- Este arquivo tambem renumera a categoria primeiros-passos inteira. O
-- leitor ordena so por display_order (store/kb.ts:34), sem desempate, entao
-- empate significa ordem nao deterministica.

CREATE OR REPLACE FUNCTION _kb_pp_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_pp_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_pp_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_pp_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

-- r2Key sempre NULL. Ver cabecalho.
CREATE OR REPLACE FUNCTION _kb_pp_img(src text, alt text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object(
    'r2Key', NULL,
    'src', src,
    'alt', alt,
    'width', 1440,
    'height', 900,
    'blurSrc', NULL,
    'displayWidth', NULL,
    'loading', false
  ));
$$ LANGUAGE sql IMMUTABLE;

-- Atalho para a URL publica, que e deterministica a partir do nome do arquivo.
CREATE OR REPLACE FUNCTION _kb_pp_shot(file text, alt text) RETURNS jsonb AS $$
  SELECT _kb_pp_img(
    'https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-agendar-seu-primeiro-post/' || file,
    alt);
$$ LANGUAGE sql IMMUTABLE;

-- Lista ordenada onde cada passo carrega uma captura opcional embaixo do
-- texto. O content spec de listItem e "paragraph block*" e inlineImage e do
-- grupo 'block', entao [paragraph, inlineImage] e valido no schema.
-- images[i] pode ser NULL para passos sem captura.
CREATE OR REPLACE FUNCTION _kb_pp_ol(items text[], images jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content',
        CASE WHEN images[i] IS NULL
             THEN jsonb_build_array(_kb_pp_p(items[i]))
             ELSE jsonb_build_array(_kb_pp_p(items[i]), images[i])
        END)
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_plain(doc jsonb) RETURNS text AS $$
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

CREATE OR REPLACE FUNCTION _kb_pp_upsert(
  p_id uuid, p_title text, p_slug text, p_excerpt text, p_content jsonb,
  p_category text, p_tags text[], p_display_order integer
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES (p_id, p_title, p_slug, p_excerpt, p_content, _kb_pp_plain(p_content), p_category, p_tags, 'published', p_display_order)
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

CREATE OR REPLACE FUNCTION _kb_pp_link(
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

SELECT _kb_pp_upsert(
  'aaaaaaaa-001a-4000-a000-00000000001a',
  'Como agendar seu primeiro post',
  'como-agendar-seu-primeiro-post',
  'Do workspace vazio ao primeiro post agendado, passo a passo, com telas reais do sistema.',
  _kb_pp_doc(
    _kb_pp_h(2, 'O que você vai precisar'),
    _kb_pp_p('Este guia vai do workspace recém-criado até um post agendado no Instagram, em sete etapas, ilustradas com telas reais do sistema. Se você já cumpriu alguma delas, use o índice ao lado para pular direto.'),
    _kb_pp_callout('⏱️', 'blue', 'Separe cerca de 20 minutos. A parte mais demorada é conectar o Instagram, porque depende da autorização pelo Facebook.'),

    _kb_pp_h(2, '1. Cadastre o cliente'),
    _kb_pp_p('Tudo no Mesaas se organiza por cliente: entregas, financeiro, calendário e analytics. Sem um cliente cadastrado, não há onde o post morar.'),
    _kb_pp_ol(
      ARRAY[
        'Abra Clientes no menu lateral',
        'Clique em Novo Cliente',
        'Preencha nome, e-mail e telefone de contato',
        'Informe plano, valor mensal, dia de pagamento e dia de entrega, e salve'
      ],
      ARRAY[
        _kb_pp_shot('01-abrir-clientes.png', 'Lista de clientes, com o botão Novo Cliente no topo.'),
        _kb_pp_shot('02-novo-cliente.png', 'Formulário de novo cliente recém-aberto, ainda vazio.'),
        _kb_pp_shot('03-preencher-dados.png', 'Formulário com nome, e-mail e telefone preenchidos.'),
        _kb_pp_shot('04-plano-e-valores.png', 'Bloco de plano e valores do formulário, com valor mensal preenchido.')
      ]::jsonb[]
    ),

    _kb_pp_h(2, '2. Monte sua equipe'),
    _kb_pp_p('Existem duas coisas diferentes aqui, e confundi-las é comum. Um membro da Equipe é um registro de pessoa ou fornecedor: serve para custos e para ser escolhido como responsável por etapas e posts. Um usuário do workspace é alguém com login no CRM. A mesma pessoa pode ser os dois, e nesse caso você vincula um ao outro.'),
    _kb_pp_ol(
      ARRAY[
        'Abra Equipe no menu lateral',
        'Clique em Adicionar Membro',
        'Informe nome e cargo',
        'Escolha o tipo de vínculo: CLT, freelancer mensal ou freelancer por demanda, e salve',
        'Para dar acesso ao CRM, use Convidar para o workspace e escolha o papel da pessoa'
      ],
      ARRAY[
        _kb_pp_shot('05-abrir-equipe.png', 'Página de Equipe, com a lista de membros e o botão Adicionar Membro.'),
        _kb_pp_shot('06-adicionar-membro.png', 'Formulário de novo membro recém-aberto.'),
        _kb_pp_shot('07-dados-do-membro.png', 'Formulário com nome e cargo preenchidos.'),
        _kb_pp_shot('08-tipo-de-vinculo.png', 'Campo de tipo de vínculo do formulário de membro.'),
        _kb_pp_shot('09-convidar-usuario.png', 'Bloco Convidar para o workspace, com campo de e-mail e seletor de papel.')
      ]::jsonb[]
    ),
    _kb_pp_callout('💡', 'blue', 'O convite vira acesso só depois que a pessoa aceita o e-mail. Enquanto isso, ela não aparece como responsável em etapas nem em posts. Para poder atribuir tarefas agora, cadastre o membro de Equipe, que é independente do convite.'),
    _kb_pp_p('Papéis e o que cada um enxerga estão detalhados no artigo Permissões e papéis no workspace.'),

    _kb_pp_h(2, '3. Conecte o Instagram do cliente'),
    _kb_pp_p('Sem conta conectada não existe agendamento, publicação nem analytics. A conta precisa ser profissional, comercial ou de criador, e estar vinculada a uma página do Facebook.'),
    _kb_pp_ol(
      ARRAY[
        'Abra o cliente na lista de Clientes',
        'Vá até a seção de Instagram na página do cliente',
        'Clique em Conectar Instagram',
        'Autorize o acesso na tela do Facebook',
        'Escolha a página vinculada à conta do cliente',
        'Confirme as permissões, incluindo a de publicação'
      ],
      ARRAY[
        _kb_pp_shot('10-abrir-cliente.png', 'Página de detalhe do cliente, com o cabeçalho e as seções disponíveis.'),
        _kb_pp_shot('11-secao-instagram.png', 'Seção de Instagram na página do cliente, com o painel da conta.'),
        _kb_pp_shot('12-conectar-instagram.png', 'Botão Conectar Instagram, para um cliente que ainda não tem conta vinculada.'),
        NULL,
        NULL,
        NULL
      ]::jsonb[]
    ),
    _kb_pp_callout('⚠️', 'orange', 'Confirme a permissão de publicação nessa tela. Sem ela a conta conecta, os analytics funcionam, e o agendamento falha depois. É a causa mais comum de falha de publicação.'),
    _kb_pp_p('Se a conta não aparecer na lista de páginas, ou se a autorização falhar, o artigo Como conectar o Instagram cobre cada erro em detalhe.'),

    _kb_pp_h(2, '4. Crie o fluxo de entrega'),
    _kb_pp_p('Um fluxo é o pacote de trabalho de um mês, uma campanha ou um lote de conteúdo. Ele tem etapas, responsáveis e prazos, e é dentro dele que os posts vivem.'),
    _kb_pp_ol(
      ARRAY[
        'Abra Entregas no menu lateral',
        'Clique em Novo Fluxo',
        'Escolha um template ou comece do zero',
        'Revise as etapas: produção, revisão, aprovação e publicação',
        'Defina responsável e prazo de cada etapa, e salve'
      ],
      ARRAY[
        _kb_pp_shot('16-abrir-entregas.png', 'Página de Entregas no modo kanban, com o botão Novo Fluxo.'),
        _kb_pp_shot('17-novo-fluxo.png', 'Diálogo de novo fluxo recém-aberto.'),
        _kb_pp_shot('18-escolher-template.png', 'Seleção de template do fluxo.'),
        _kb_pp_shot('19-etapas-do-fluxo.png', 'Lista de etapas do fluxo sendo montada.'),
        _kb_pp_shot('20-responsavel-e-prazo.png', 'Campos de responsável e prazo de uma etapa.')
      ]::jsonb[]
    ),
    _kb_pp_callout('💡', 'blue', 'Inclua uma etapa de aprovação do cliente. É ela que destrava o agendamento, como você vai ver na etapa 6.'),

    _kb_pp_h(2, '5. Crie o post dentro do fluxo'),
    _kb_pp_p('Abra o fluxo para ver a gaveta da entrega. É ali que o post ganha tipo, mídia e legenda.'),
    _kb_pp_ol(
      ARRAY[
        'Clique no card do fluxo para abrir a gaveta',
        'Adicione um post à lista',
        'Escolha o tipo, feed, reels, stories ou carrossel, e dê um título',
        'Envie a mídia do computador, ou escolha um arquivo já salvo em Arquivos',
        'Escreva a legenda do Instagram, com até 2.200 caracteres'
      ],
      ARRAY[
        _kb_pp_shot('21-abrir-gaveta.png', 'Gaveta da entrega aberta, mostrando etapas e posts.'),
        _kb_pp_shot('22-novo-post.png', 'Área de posts da gaveta, com a opção de adicionar um post.'),
        _kb_pp_shot('23-tipo-e-titulo.png', 'Campos de tipo e título do post preenchidos.'),
        _kb_pp_shot('24-enviar-midia.png', 'Área de mídia do post, com um arquivo enviado.'),
        _kb_pp_shot('25-escrever-legenda.png', 'Campo de legenda do Instagram preenchido, com o contador de caracteres.')
      ]::jsonb[]
    ),
    _kb_pp_callout('⚠️', 'orange', 'Reels e vídeos podem exigir thumbnail antes de publicar. Se o campo aparecer, preencha agora, porque a falta dele só reaparece como erro na hora de agendar.'),

    _kb_pp_h(2, '6. Aprove o post'),
    _kb_pp_p('Se você chegou até aqui procurando o botão de agendar e não achou, o motivo é este: o agendamento só aparece depois que o post está aprovado. Em rascunho, em revisão ou aprovado apenas internamente, não existe botão de agendar na tela.'),
    _kb_pp_p('Ao avançar a etapa de aprovação do fluxo, o Mesaas pergunta como você quer resolver a aprovação. São dois caminhos e ambos levam ao mesmo lugar.'),
    _kb_pp_ol(
      ARRAY[
        'Na página de Entregas, avance a etapa de aprovação do fluxo',
        'Escolha Aprovar internamente para aprovar sem enviar ao cliente, ou Enviar ao portal para que o cliente aprove pelo Hub',
        'Confirme que o post ficou como Aprovado pelo cliente'
      ],
      ARRAY[
        _kb_pp_shot('26-avancar-etapa.png', 'Card do fluxo no kanban, na etapa de aprovação.'),
        _kb_pp_shot('27-dialogo-de-aprovacao.png', 'Diálogo de aprovação, com as opções de aprovar internamente e enviar ao portal.'),
        _kb_pp_shot('28-post-aprovado.png', 'Post com o status Aprovado pelo cliente.')
      ]::jsonb[]
    ),
    _kb_pp_callout('💡', 'blue', 'Aprovar internamente serve para o primeiro post, para testes e para clientes que aprovam por fora do sistema. Quando quiser que o cliente aprove pelo portal, veja o artigo Como o cliente aprova posts pelo Hub.'),

    _kb_pp_h(2, '7. Agende a publicação'),
    _kb_pp_p('Com o post aprovado, o bloco de publicação aparece na gaveta.'),
    _kb_pp_ol(
      ARRAY[
        'Defina data e horário da publicação',
        'Clique em Agendar',
        'Confirme que o post mostra o selo Agendado',
        'Se precisar mudar algo, use Cancelar para liberar a edição e agende de novo'
      ],
      ARRAY[
        NULL,
        NULL,
        NULL,
        NULL
      ]::jsonb[]
    ),
    _kb_pp_callout('⚠️', 'orange', 'Depois de agendado, a data e a legenda do Instagram ficam travadas. Para editar, cancele o agendamento primeiro.'),
    _kb_pp_p('Se o botão Agendar aparecer desabilitado, falta algo: data, legenda do Instagram, ou permissão de publicação na conta conectada. A própria tela indica o que está faltando.'),

    _kb_pp_h(2, 'E agora?'),
    _kb_pp_p('O post agendado aparece no calendário do cliente e no fluxo. Na hora marcada, o Mesaas publica sozinho e o status muda para Postado.'),
    _kb_pp_ol(
      ARRAY['Acompanhe pelo Calendário, pelas Entregas ou pelo Hub do cliente'],
      ARRAY[_kb_pp_shot('33-acompanhar-no-calendario.png', 'Calendário com o post agendado marcado na data.')]::jsonb[]
    ),
    _kb_pp_p('Se a publicação falhar, o post mostra o motivo e um botão de tentar novamente. O artigo Agendar, publicar agora e resolver falhas no Instagram cobre cada erro possível.')
  ),
  'primeiros-passos',
  ARRAY['primeiro post', 'agendamento', 'onboarding', 'passo a passo', 'instagram', 'fluxo', 'aprovacao', 'equipe', 'cliente'],
  3
);

-- Renumeracao da categoria primeiros-passos. O leitor ordena so por
-- display_order, sem desempate, entao empate = ordem nao deterministica.
-- Ordem final: 1 bem-vindo, 2 configurar workspace, 3 primeiro post (novo),
-- 4 primeiros 30 minutos, 5 permissoes, 6 importacoes.
UPDATE kb_articles SET display_order = 4 WHERE slug = 'primeiros-30-minutos-no-mesaas';
UPDATE kb_articles SET display_order = 5 WHERE slug = 'permissoes-e-papeis-no-workspace';
UPDATE kb_articles SET display_order = 6 WHERE slug = 'importacoes-via-csv-no-mesaas';

-- Links de contexto de /dashboard. As tres chamadas sao reemitidas com as
-- ordens explicitas: _kb_pp_link faz ON CONFLICT DO UPDATE, entao nao ha
-- necessidade de DELETE.
SELECT _kb_pp_link('/dashboard', 'como-agendar-seu-primeiro-post', 'Agendar o primeiro post', 0);
SELECT _kb_pp_link('/dashboard', 'bem-vindo-ao-mesaas', NULL, 1);
SELECT _kb_pp_link('/dashboard', 'primeiros-30-minutos-no-mesaas', 'Primeiros passos', 2);

-- Limpeza dos helpers, seguindo o padrao das migrations anteriores.
DROP FUNCTION IF EXISTS _kb_pp_link(text, text, text, integer);
DROP FUNCTION IF EXISTS _kb_pp_upsert(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_pp_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_pp_ol(text[], jsonb[]);
DROP FUNCTION IF EXISTS _kb_pp_shot(text, text);
DROP FUNCTION IF EXISTS _kb_pp_img(text, text);
DROP FUNCTION IF EXISTS _kb_pp_doc(jsonb[]);
DROP FUNCTION IF EXISTS _kb_pp_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_pp_h(int, text);
DROP FUNCTION IF EXISTS _kb_pp_p(text);
DROP FUNCTION IF EXISTS _kb_pp_text(text);
