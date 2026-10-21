# Portal do Cliente — layout das abas do Hub — Design

Data: 2026-09-07 · Status: aprovado (brainstorming com mockups)

Mockups anotados: https://claude.ai/code/artifact/22ca98e3-1800-4b26-89e5-ea426ad929eb

Este é o **spec 1 de 2**. O spec 2 (`Marca` como repositório de elementos do cliente) sai
depois e tem seu próprio documento. A ordem foi escolhida pelo usuário: layout primeiro.

## Problema

A `ClienteDetalhePage` foi dividida em sete abas roteadas, e o conteúdo passou a ocupar uma
coluna larga (`.cliente-tabs-shell` = nav de 220px + `1fr`). As cinco páginas do Hub não
acompanharam: continuam formulários de coluna única desenhados para o card estreito anterior.
O resultado é a sensação de página vazia.

Três problemas concretos, em ordem de impacto:

1. **Três camadas de navegação empilhadas.** Nav lateral → card "Hub do Cliente" com título e
   subtítulo → fita de cinco pills. São ~200px consumidos antes de qualquer conteúdo.
2. **A sub-aba ativa é estado local** (`useState('acesso')` em `HubTab.tsx:184`). Recarregar a
   página joga o usuário de volta em "Acesso". Não há deep link para "a Marca do cliente 42".
3. **`HubTab.tsx` tem 1739 linhas** e concentra `BrandEditor`, `PagesEditor`, `BriefingEditor` e
   `IdeiasTab` num arquivo só.

Além disso, cada tela desperdiça a largura de um jeito próprio: Acesso tem uma informação e
cinco botões; Briefing empilha pergunta e resposta em linhas de 1000px; Páginas abre um modal
de 95% da janela dentro de uma página que já é larga; Ideias corta a descrição em uma linha e
esconde a contagem por estado atrás de um `<select>`.

## Escopo

1. **Rotas aninhadas** `/clientes/:id/hub/:subaba` para as cinco páginas, com redirect de
   `/clientes/:id/hub`.
2. **Grupo "Portal do cliente" no nav lateral** com as cinco páginas como itens irmãos. O item
   "Hub" deixa de existir: vira o rótulo do grupo.
3. **Quebra do `HubTab.tsx`** em cinco componentes de rota sob `pages/cliente-detalhe/hub/`.
4. **Redesenho de Acesso, Briefing, Páginas e Ideias** para a largura disponível.
5. **Editor rich text em Páginas**, substituindo o par markdown/preview, com um tipo de bloco
   novo (`richtext`) e conversão das páginas existentes.

**Marca fica fora.** A tela é movida para a rota nova e quebrada em arquivo próprio sem
nenhuma mudança de comportamento — o redesenho dela é o spec 2.

## Decisões de design

### Navegação: promover as sub-abas, não aninhar mais um nível

As cinco pills sobem para o nav lateral, que passa a ter onze itens em quatro grupos:

| Grupo | Itens |
|---|---|
| Cliente | Visão geral, Entregas |
| Canais e análise | Redes sociais, Relatórios |
| **Portal do cliente** | **Acesso, Briefing, Marca, Páginas, Ideias** |
| Gestão | Arquivos, Financeiro |

O nav já suporta grupos (`ClienteTab.group` + `CLIENTE_TAB_GROUP_LABELS`), e o rótulo aparece
sozinho quando o grupo muda — a mecânica não muda, só a lista.

Some junto o wrapper visual: o `<div className="card">` de `HubClienteTab.tsx` com o `<h3>`
"Hub do Cliente" e o parágrafo "Link permanente de acesso do cliente ao hub de conteúdo".
Cada página passa a ter seu próprio cabeçalho — título, uma linha de contexto e a ação
primária na mesma faixa.

**Alternativa descartada:** manter as pills e só virá-las rota. Resolve o deep link e permite
quebrar o arquivo, mas mantém o nível de chrome, que é o problema maior.

### O guard de rota precisa aprender caminhos aninhados

`ClienteDetalhePage.tsx` valida o **caminho inteiro** depois de `/clientes/:id/`, não só o
primeiro segmento — é deliberado (o comentário no arquivo explica: um prefixo conhecido com
segmento inválido cairia no catch-all do `App.tsx` e renderiza painel em branco). Com rotas
aninhadas essa extração passa a ver `hub/marca`, que não está em `CLIENTE_TABS`.

O modelo (`clienteTabs.model.ts`) troca a entrada `hub` pelas cinco sub-abas, com chave
composta (`hub/acesso`, `hub/briefing`, …). Como todas aparecem no nav, não é preciso campo de
visibilidade — as funções existentes (`canAccessClienteTab`, `canAccessClienteTabRole`,
`visibleClienteTabs`, `financeiroTabGuardOutcome`) continuam com a mesma assinatura e o mesmo
contrato, operando sobre uma lista maior.

Em `App.tsx`, `<Route path="hub" element={<ClienteHubTab />} />` vira um bloco aninhado com
`index` redirecionando para `acesso` e uma rota por sub-aba. O
`<Route path="*" element={null} />` que já existe continua sendo a rede que impede o branch
`/clientes/:id` de cair no 404 de topo. `/clientes/:id/hub` redireciona para
`/clientes/:id/hub/acesso`, então links antigos continuam válidos.

**`vercel.json` não muda.** O padrão nomeado já é `/(…|clientes|…)(/.*)?` — o sufixo cobre
qualquer profundidade.

### Papel: a checagem continua onde está

`hub` é a única aba com `roles: ALL` de propósito, para que um `agent` veja um
`RoleRestrictionNotice` em vez de ser redirecionado. As cinco sub-abas herdam isso: cada
componente de rota faz a própria checagem, como `HubClienteTab` faz hoje. Extrair o notice
para um componente compartilhado (`HubRoleGate`) evita repetir o bloco cinco vezes.

### Acesso: estado antes das ações

Duas colunas. À esquerda o link: estado (ativo/inativo, data de expiração) como primeira
linha do card, a URL, e os botões abaixo. "Estender +1 ano" continua condicionado a
`showRescue`. À direita, "O que o cliente vê": uma linha por seção do portal com a contagem
do que existe, e "vazia" em cinza quando não há nada. Cada linha é link para a aba
correspondente.

#### Os predicados, definidos

Contador sem predicado escrito vira número divergente. Cada linha do painel é exatamente
isto, tudo escopado por `cliente_id` (o RLS já escopa `conta_id`):

| Linha | Predicado | Fonte |
|---|---|---|
| Briefing | `count(*)` e `count(*) filter (where answer is not null and answer <> '')` | `hub_briefing_questions` |
| Marca | `count(*)` de `hub_brand_files` + existe linha em `hub_brand` | leitura já feita hoje |
| Páginas | `count(*)` | `hub_pages` |
| Ideias novas sem resposta | `status = 'nova' and comentario_agencia is null` | `getIdeias({cliente_id})`, já carregado |

Cada linha é link para a aba correspondente. Zero → "vazia" em cinza, que é o convite.
Enquanto carrega, a linha mostra um traço, não zero — zero é uma afirmação, e afirmar
"vazia" antes de saber é errado. Erro na query: traço e a linha não vira link.

**"Aprovações aguardando o cliente" fica fora.** Aprovação deriva de post + status + regra de
dupla aprovação, e existe um spec inteiro sobre isso (`dual_approval`). Definir o predicado
aqui, por fora, é como o número diverge do que a página de Aprovações mostra. Volta quando
houver uma fonte única para "aguardando o cliente".

**"Última visita do cliente" fica fora deste spec.** A ideia era derivar de
`expires_at − 365 dias`, mas o `hub_token_touch` só grava quando
`expires_at < now() + 350 days` — e, pior, `hub_token_extend` e `hub_token_rotate` gravam o
mesmo valor sem que o cliente tenha aberto nada. Um clique em "Estender +1 ano" da própria
agência apareceria como visita do cliente. O sinal correto exige uma coluna `last_seen_at`
escrita pelo mesmo UPDATE já throttled do `hub_token_touch` (mesmo número de escritas, sem
o falso positivo), o que traz migração + mudança de RPC + deploy de `hub-bootstrap` para um
spec que de resto é só frontend. Vira follow-up próprio.

### Briefing: duas colunas e progresso

Rail de 250px à esquerda com a lista de briefings (hoje uma fita horizontal que esconde
itens) e, abaixo, o índice de seções com `respondidas/total`. Clicar numa seção rola até ela.

À direita: filtros por estado como chips com contagem (`Todas 12` · `Sem resposta 4` ·
`Respondidas 8`) mais uma barra de progresso, e as perguntas em grade de três colunas —
pergunta (250px), resposta (flexível), ações (78px). As não respondidas ficam evidentes na
varredura vertical.

O `<select>` de filtro sai. Chips com contagem respondem antes de filtrar; um `select`
esconde exatamente a informação que a equipe quer.

Reordenação por arrastar (dnd-kit), templates, importação de CSV e exportação continuam
exatamente como estão — o problema do Briefing nunca foi falta de recurso.

### Páginas: editor rich text, uma superfície só

O par markdown/preview sai. Entra um editor TipTap onde o texto é editado já com a aparência
final: barra fixa no topo (negrito, itálico, sublinhado, H2/H3, listas, citação, link,
destaque) e menu flutuante na seleção — o mesmo padrão do `PostEditor` e do `ArticleEditor`
do Admin.

**Sem botão de imagem.** Era uma assunção deste spec e está errada — ver "Perguntas
resolvidas".

O modal sai junto: rail de páginas à esquerda, editor à direita.

#### Ordem: a coluna existe, o caminho de escrita não

`display_order` existe e o rail promete controlá-la, mas hoje `upsertHubPage` **nunca
escreve essa coluna** — toda página nasce com o default `0`. CRM e `hub-pages` ordenam só por
ela, sem desempate, então a ordem atual é a que o Postgres devolver. Para o rail cumprir a
promessa:

- **Criação** grava `display_order = max(display_order) + 1` do cliente.
- **Reordenação** por arrastar (dnd-kit, mesmo padrão do Briefing) grava a lista inteira
  renumerada de 0..n-1 numa chamada.
- **Desempate** por `created_at` na leitura, no CRM e no `hub-pages`, para as linhas antigas
  empatadas em 0 terem ordem estável antes da primeira reordenação.

#### Alterações não salvas: quais saídas bloqueiam

O `isDirty` de hoje é `(editingPage.title ?? '') !== ''` — verdadeiro para qualquer página
com título, mesmo intocada. Não é detecção de alteração, é detecção de título. Some.

No lugar, comparação do documento serializado contra o carregado.

**`useBlocker` está proibido neste projeto e não é opção aqui.** React Router honra só o
último blocker registrado, e `getBlocker`/`deleteBlocker`/`subscribe` são `@private`:
registrar um blocker nesta tela desliga em silêncio a troca de versão entre deploys. Existe
teste contra o `createMemoryRouter` real guardando isso (`silent-update.router.test.ts`).

Sem blocker, a estratégia é não depender de bloqueio:

| Saída | Tratamento |
|---|---|
| Trocar de página no rail | Confirmação no próprio clique — é um handler nosso, não precisa do router |
| Refresh / fechar aba | `beforeunload` |
| Navegar para outra rota, voltar/avançar | **Não bloqueia.** Rascunho em `localStorage` por id de página, restaurado ao reabrir, com aviso "você tem alterações não salvas" e opção de descartar |

O rascunho é melhor que o bloqueio de qualquer forma: não sequestra a navegação e sobrevive
a fechar a aba. Chave `hub-page-draft:<pageId>`, limpa no salvamento bem-sucedido.

#### Formato guardado

`hub_pages.content` continua sendo um array de blocos em `jsonb`. O editor passa a gravar um
bloco só:

```json
[{ "type": "richtext", "doc": { "type": "doc", "content": [ … ] } }]
```

Manter o array (em vez de trocar a coluna por um documento solto) é o que torna a mudança
aditiva: o `renderBlock` do Hub já faz `switch` por tipo, e os tipos antigos continuam
funcionando sem backfill nem janela de risco.

#### As extensões vêm do PostEditor, não do ArticleEditor

`richTextExtensions()` (`apps/hub/src/components/RichTextContent.tsx`) tem que continuar sendo
um **superconjunto** do que o editor do CRM consegue persistir. Se aparecer no documento um nó
ou marca que o Hub não conhece, o TipTap descarta o documento inteiro e loga um aviso em vez
de lançar erro: o cliente abre a página e vê branco.

Por isso o conjunto de extensões nasce do `PostEditor` — que o Hub já cobre integralmente —
e **não** é copiado do `ArticleEditor` do Admin, que traz `Youtube` e `IframeExtension`, dois
nós ausentes do Hub. Menção (`MentionNode`) fica de fora: é conteúdo interno da agência e não
faz sentido numa página que o cliente lê.

Se o conjunto do editor de Páginas divergir do `PostEditor` em algum ponto, a extensão
correspondente entra em `richTextExtensions()` no mesmo PR. Um teste garante isso.

#### Três consumidores aprendem o tipo novo

| Onde | O que muda |
|---|---|
| `apps/hub/src/types.ts` | `HubContentBlock` é uma união fechada de cinco tipos com `content: string` **obrigatório**. `{ type: 'richtext', doc }` não compila. Vira união discriminada, com `richtext` carregando `doc` e sem `content` |
| `apps/hub/src/pages/PaginaPage.tsx` | `renderBlock` ganha `case 'richtext'` delegando ao `RichTextContent` já existente |
| `supabase/functions/mcp/content.ts` | `pageContentToMarkdown` lê `block.content` como **string**; um bloco rich text devolveria página vazia aos agentes. Ganha um caminho que serializa o doc do TipTap |
| Editor no CRM | Converte markdown legado para TipTap ao abrir |

#### O conjunto de extensões, fixado

Não basta dizer "nasce do `PostEditor`": dois implementadores chegariam a documentos
diferentes. O conjunto é exatamente este, e o teste de contrato compara contra ele:

`StarterKit` · `UnderlineExt` · `TextStyle` · `Color` · `Highlight(multicolor)` ·
`Link(openOnClick: false, autolink: true)` · `Placeholder` · `CalloutExtension`

Fora, com motivo: `MentionNode` (conteúdo interno da agência, não faz sentido numa página
que o cliente lê), `CommentHighlight` (o fluxo de comentários é de post, não de página),
`InlineImage` (ver abaixo), `Youtube` e `IframeExtension` (o Hub não tem os nós).

Todos os incluídos já têm contraparte em `richTextExtensions()` do Hub, então o schema fecha
sem tocar no Hub. `CalloutReadonly` já existe lá.

#### Conversão do legado: migração única, não preguiçosa

Consulta em produção (2026-09-07): **28 páginas em 21 clientes**, com dois tipos de bloco —
27 páginas com um bloco `markdown` e 1 com um bloco `paragraph`. Nenhum `heading`, `image` ou
`link`. O maior texto tem **46.858 caracteres**.

Com esse volume a conversão preguiçosa (converter só quando alguém abrir e salvar) não se
paga: deixaria dois formatos convivendo por tempo indeterminado, e uma página nunca reaberta
ficaria em markdown para sempre. O conversor precisa existir de qualquer jeito, porque o
editor tem que abrir página antiga.

Então: script único em `scripts/`, reusando o mesmo módulo conversor do editor, rodado
**depois** do deploy. Enquanto não roda, as páginas renderizam pelo caminho legado — que
permanece no `renderBlock` (custo zero, e é a rede de segurança). Só os dois tipos observados
precisam de conversão; os demais casos do `renderBlock` seguem intactos.

O script roda com o editor já no ar, então existe uma janela em que alguém abre uma página,
converte e salva antes do script chegar nela — e o script, escrevendo o que converteu do
conteúdo que leu no início, apagaria essa edição. Três exigências, nenhuma opcional:

1. **Update condicional.** Escreve com `WHERE id = $1 AND content = $2` (o conteúdo lido).
   Linha alterada no meio do caminho = zero linhas afetadas = pula e registra.
2. **Pula o que já é `richtext`.** Filtro no `SELECT` e recheque antes do `UPDATE`.
3. **Backup antes.** Dump do `id` + `content` das 28 linhas em arquivo JSON. Com esse volume
   o rollback é reaplicar o dump, e o script imprime ids convertidos, pulados e falhos.

Os 46.858 caracteres são o caso de teste de performance do editor: um documento desse tamanho
tem que abrir e digitar sem travar.

### Ideias: cards de duas colunas

Contadores por estado como chips clicáveis no lugar do `<select>`, e a lista em grade de dois
cards por linha com a descrição em três linhas (hoje `line-clamp-1`). "Responder" e "Virar
tarefa" viram atalho no card — as duas ações já existem dentro do `IdeiaDrawer`, que continua
sendo onde a interação acontece.

## Arquivos afetados

**Rotas e navegação**
- `apps/crm/src/pages/cliente-detalhe/clienteTabs.model.ts` — sub-abas, grupo novo, chaves compostas
- `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx` — sem mudança estrutural, lista maior
- `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` — guard aprende caminhos aninhados
- `apps/crm/src/App.tsx` — bloco de rotas aninhadas + redirect de `/hub`
- `apps/crm/src/pages/cliente-detalhe/tabs/HubClienteTab.tsx` — **removido**. O card wrapper
  sai, a checagem de papel vai para o `HubRoleGate`, e a query `workspace-slug` desce para a
  `AcessoPage`, única sub-aba que monta a URL do portal

**Quebra do monolito** — `HubTab.tsx` (1739 linhas) → `pages/cliente-detalhe/hub/`
- `AcessoPage.tsx`, `BriefingPage.tsx`, `MarcaPage.tsx`, `PaginasPage.tsx`, `IdeiasPage.tsx`
- `HubRoleGate.tsx` — o `RoleRestrictionNotice` compartilhado
- `PaginaRichTextEditor.tsx` + o módulo conversor de markdown
- `BriefingTemplatesModal.tsx` e `BriefingReorder.tsx` continuam onde estão

**Traduções** — sem elas a UI mostra a chave crua
- `packages/i18n/locales/pt/clients.json` e `.../en/clients.json` — cinco `detail.tabs.*`
  novas e `detail.tabGroups.portal`, nos dois idiomas

**Fora do CRM**
- `apps/hub/src/types.ts` — `HubContentBlock` vira união discriminada
- `apps/hub/src/pages/PaginaPage.tsx` — `case 'richtext'`
- `supabase/functions/mcp/content.ts` — `pageContentToMarkdown`
- `scripts/` — conversor único das 28 páginas
- `apps/crm/style.css` — `.cliente-tabs-nav` não muda; entram as classes das telas novas

## Testes

- **Modelo/guard**: sub-aba desconhecida sob `hub/` redireciona (não cai no catch-all);
  `/clientes/:id/hub` redireciona para `hub/acesso`; `agent` vê o notice em vez de ser
  redirecionado; as garantias existentes de `financeiro` continuam valendo.
- **Nav**: os cinco itens aparecem sob "Portal do cliente"; o item "Hub" não existe mais; o
  teste atual que proíbe `IntersectionObserver`/`scrollIntoView` continua passando.
- **Conversor de markdown**: os dois tipos observados em produção; documento de ~47k
  caracteres; markdown malformado não derruba o editor.
- **Script de conversão**: pula linha já em `richtext`; `UPDATE` condicional não escreve
  quando o `content` mudou entre a leitura e a escrita (simula a corrida).
- **Ordem das páginas**: página nova nasce com `max + 1`; reordenação persiste 0..n-1;
  leitura desempata por `created_at` com todas as linhas em `display_order = 0`.
- **Rascunho não salvo**: `beforeunload` arma com documento alterado e não arma sem alteração;
  rascunho é restaurado ao reabrir e limpo após salvar. **E um teste que falha se
  `useBlocker` aparecer nesta tela** — é a regressão que desligaria a troca silenciosa.
- **i18n**: nenhuma `labelKey` de `CLIENTE_TABS` fica sem tradução em pt e en.
- **Contadores do Acesso**: cada predicado da tabela; estado de carregamento mostra traço,
  não zero.
- **Contrato de schema**: teste que compara o conjunto de extensões do editor de Páginas com
  `richTextExtensions()` do Hub e falha se o editor puder persistir algo que o Hub não lê.
  É o teste que impede a página em branco.
- **Renderer do Hub**: bloco `richtext` renderiza; blocos legados continuam renderizando.
- **MCP**: `pageContentToMarkdown` com bloco `richtext` devolve texto, não string vazia.

## Rollout

Sem migração de banco. A ordem importa mesmo assim:

1. **Deploy de `mcp`** (`npx supabase functions deploy mcp`) antes do merge. Ele passa a
   entender `richtext`; enquanto o front não mudou, isso é inócuo.
2. **Merge.** Publica CRM e Hub juntos no mesmo deploy da Vercel — o renderer novo do
   `PaginaPage` e o editor novo sobem atomicamente, então não há janela onde o CRM grava um
   formato que o Hub não lê.
3. **Rodar o script de conversão** das 28 páginas.
4. Verificar uma página convertida no portal real antes de considerar concluído.

O caminho legado do `renderBlock` fica. Remover é limpeza de outro PR, depois que a conversão
estiver confirmada.

## Perguntas resolvidas

- **Quantas páginas em markdown existem?** 28, em 21 clientes, com dois tipos de bloco.
  Consulta em produção em 2026-09-07. Resolve a favor da migração única.
- **Última visita do cliente é confiável?** Não pela derivação: `extend` e `rotate` produzem
  falso positivo. Sai do escopo, vira follow-up com `last_seen_at`.
- **Imagem dentro da página entra aqui?** **Não.** A assunção anterior — "é só reusar
  `uploadFile()`, e se mudar a decisão de cota é remover um botão" — estava errada. O
  uploader em si é genérico (`uploadInlineImage` cria uma linha em `files` via
  `file-upload-url`/`file-upload-finalize`, sem vínculo com post), mas o resto não fecha:
  1. **O `src` guardado não é durável.** Inline image guarda `r2Key` e o `src` é reassinado na
     leitura. O Hub faz isso em `hub-posts` (`extractR2Keys` + `injectSignedUrls`);
     `hub-pages` não tem nada disso. Sem essa passagem, a imagem quebra no portal.
  2. **Vazamento permanente de cota.** `storage_autoclean_candidates` só considera arquivos
     que tenham linha em `post_file_links`. Imagem de página nunca teria — então nunca é
     recolhida. Tirar a imagem da página ou apagar a página deixaria o objeto no R2 e na cota
     para sempre, sem forma de reclamar.

  Sai do escopo. Volta junto com a decisão de armazenamento do spec 2, que é onde o moodboard
  enfrenta exatamente os mesmos dois problemas.

## Perguntas em aberto

- **Paginação/virtualização em Briefing e Ideias.** Nenhum cliente hoje tem volume que peça
  isso. Fica registrado para não ser redescoberto.

## Fora de escopo

- Redesenho da Marca (spec 2).
- Imagem dentro da página, e a passagem de assinatura de URL em `hub-pages` que ela exige.
- `last_seen_at` e o painel de atividade do cliente.
- "Aprovações aguardando o cliente" no painel do Acesso.
- Qualquer mudança em templates de briefing, importação de CSV ou exportação.
- Remoção do caminho legado do `renderBlock`.
