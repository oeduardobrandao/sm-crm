# Guia visual: "Como agendar seu primeiro post"

**Data:** 2026-08-06
**Branch:** `claude/first-post-scheduling-guide-ec47b9`
**Status:** Design aprovado. Pronto para plano de implementação

## Problema

Os 28 artigos da Central de Ajuda são todos de **referência**, organizados por tela:
"aqui estão os campos de Clientes", "aqui está o que a gaveta da entrega faz". Nenhum
acompanha uma conta nova do início ao fim.

O artigo mais próximo, `primeiros-30-minutos-no-mesaas`, são cinco parágrafos de prosa
sem uma única imagem e sem um único clique. Ele descreve o destino, não o caminho.

O resultado é que a pergunta mais comum de quem acabou de criar a conta ("como eu agendo
um post?") não tem resposta procedural em lugar nenhum. Pior: existe um bloqueio real no
meio do caminho que o produto não explica, documentado abaixo.

## Descobertas que moldam o design

### 1. O botão Agendar não existe até o post estar aprovado

Esta é a descoberta central. `ScheduleButton.tsx` só renderiza controles de agendamento
quando `post.status === 'aprovado_cliente'` (`ScheduleButton.tsx:495`). Em qualquer
status anterior (`rascunho`, `revisao_interna`, `aprovado_interno`, `enviado_cliente`),
não há botão de agendar. Nenhum. A UI não diz por quê.

Existem dois caminhos até `aprovado_cliente`, ambos oferecidos no diálogo que abre ao
avançar uma etapa de aprovação (`KanbanView.tsx:414-437`):

| Ação | Efeito |
|---|---|
| **Aprovar internamente** | `approvePostsInternally()` leva os posts direto a `aprovado_cliente`, sem sair do CRM |
| **Enviar ao portal** | `sendPostsToCliente()` leva a `enviado_cliente`; o cliente aprova no Hub |

O guia usa o caminho interno. Ver Decisões.

### 2. O leitor já renderiza imagens. `r2Key` precisa ser NULL

Herdado de `20260717000002_kb_article_screenshots.sql`, cujo cabeçalho documenta a
armadilha por extenso: um nó `inlineImage` com `r2Key` preenchido faz `ArtigoPage.tsx`
pedir assinatura a `sign-r2-urls`, que só assina chaves do próprio `conta_id` do leitor
ou capas de artigo. Uma imagem de corpo não é nenhum dos dois, a assinatura falha em
silêncio, e o `src` pré-assinado da autoria expira em 3600s.

**Toda imagem deste artigo usa `r2Key: NULL` e um URL público permanente do bucket
`kb-images`.** É o único formato que renderiza para sempre, para qualquer leitor.

### 3. A infraestrutura de captura já existe e é opt-in

O projeto Playwright `screenshots` (`playwright.config.ts`) só entra no array de projects
quando `CAPTURE_SCREENSHOTS` está setado, justamente para que um `playwright test` puro
nunca dispare capturas contra produção. Roda a 1440×900, `deviceScaleFactor: 2`, tema
claro forçado. `capture.ts` grava em `e2e/.shots/<slug>/NN-nome.png`, gitignorado.
`scripts/upload-kb-images.mjs` sobe e devolve os URLs públicos.

### 4. Agendar tem dois caminhos, e a rede de segurança cobre um e meio

Agendar um post não é uma operação só. São duas, por rotas diferentes:

| Caminho | O que dispara | Coberto? |
|---|---|---|
| Botão `Agendar` na gaveta, post de Instagram | `POST /functions/v1/instagram-publish/schedule/:id` (`instagram.ts:181`) | Sim, `instagram-publish` está em `BLOCKED_FUNCTIONS` |
| Botão `Agendar` na gaveta, post de TikTok ou `both` | `POST /functions/v1/tiktok-publish/schedule/:id` (`tiktok.ts:14,261`) | **Não. Lacuna real** |
| Arrastar no calendário | write PostgREST em `workflow_posts` (`posts.ts:458-470`) | Sim, `isSchedulingWrite()` |

`isSchedulingWrite()` barra um POST/PATCH/PUT em `workflow_posts` que sete
`status = 'agendado'` **ou** `scheduled_at` não nulo. Isso cobre o caminho do calendário,
não os das edge functions, que são cobertos pela blocklist de nomes de função.

**`tiktok-publish` não está na blocklist.** Para um post que mire TikTok, um clique
acidental em `Agendar` durante uma execução de captura agenda uma publicação real. Ver
Peça 2.

O bloqueio de `scheduled_at` é mais amplo do que precisa ser. As três fases de
`claim_posts_for_publishing` (`20260429000001_authorization_status_disconnected.sql:22-33`)
exigem `wp.status = 'agendado'`:

```sql
WHEN 'container' THEN wp.status = 'agendado' AND wp.scheduled_at <= now() + interval '1 hour' ...
WHEN 'publish'   THEN wp.status = 'agendado' AND wp.instagram_container_id IS NOT NULL ...
WHEN 'retry'     THEN wp.status = 'falha_publicacao' AND ...
```

Uma data sem mudança de status é inerte: o cron nunca reivindica a linha. Isso importa
porque o botão Agendar só fica habilitado com `post.scheduled_at` preenchido
(`ScheduleButton.tsx:497`), então a captura do estado habilitado depende de uma linha que
já tenha data.

### 5. As capturas externas do esforço anterior nunca aconteceram

`docs/superpowers/plans/2026-07-16-external-shot-list.md` pediu 6 PNGs manuais (telas do
Claude e do Facebook). Nenhum foi entregue: `como-conectar-o-instagram` ainda tem slots
`NULL` nos passos 3 e 4 (`20260717000003_kb_more_screenshots.sql:274-275`), e a string
`ext-0` não aparece em nenhuma migration.

Consequência de design: **nada neste artigo pode depender de captura manual para ser
publicável.** Os slots externos existem, ficam vazios, e o artigo vai ao ar sem eles.

### 6. As specs existentes preferem ler estado a criar estado

`entregas.spec.ts` mira um workflow de produção que já existe (id 217), escolhido por
já ter três posts reais. `hub.spec.ts` documenta explicitamente "ZERO writes" e captura
o cluster de acesso já ativo do cliente 41. O precedente é claro e este design o segue.

## Decisões

| Decisão | Escolha |
|---|---|
| Relação com `primeiros-30-minutos-no-mesaas` | Artigo novo. O antigo é rebaixado, não removido |
| Conexão do Instagram | Cobertura completa, incluindo as telas do Facebook (captura manual, slots vazios até chegarem) |
| "Membro da equipe" | Ambos: membro de Equipe (roster) e convite de usuário |
| Caminho de aprovação | Aprovação interna. O portal vira callout com link |
| Escrita em produção durante a captura | Zero. Formulários capturados preenchidos, antes de salvar |
| Formato | Um artigo único, com nove seções `h2` para o índice lateral |

### Por que rebaixar e não substituir

`primeiros-30-minutos-no-mesaas` continua útil como mapa em prosa para quem quer entender
o produto antes de operá-lo, e o slug pode já estar linkado de e-mails de ciclo de vida.
Ele desce uma posição e cede o topo do link de contexto de `/dashboard`.

### Ordenação final

`getPublishedArticles()` ordena **somente** por `display_order` (`store/kb.ts:34`), sem
critério de desempate. Empate significa ordem não determinística, então inserir o guia
exige renumerar a categoria inteira, não só empurrar um artigo.

A categoria `primeiros-passos` hoje tem cinco artigos em 1 a 5. Estado final:

| Ordem | Slug | Mudança |
|---|---|---|
| 1 | `bem-vindo-ao-mesaas` | inalterado |
| 2 | `como-configurar-seu-workspace` | inalterado |
| 3 | `como-agendar-seu-primeiro-post` | **novo** |
| 4 | `primeiros-30-minutos-no-mesaas` | era 3 |
| 5 | `permissoes-e-papeis-no-workspace` | era 4 |
| 6 | `importacoes-via-csv-no-mesaas` | era 5 |

Links de contexto de `/dashboard`, que hoje são dois (ordens 0 e 1). Estado final:

| Ordem | Slug | Label | Mudança |
|---|---|---|---|
| 0 | `como-agendar-seu-primeiro-post` | `Agendar o primeiro post` | **novo** |
| 1 | `bem-vindo-ao-mesaas` | `NULL` | era 0 |
| 2 | `primeiros-30-minutos-no-mesaas` | `Primeiros passos` | era 1 |

`_kb_expand_link` faz `ON CONFLICT (route_pattern, article_id) DO UPDATE` do `label` e do
`display_order` (`20260520000001:...`), então a migration reemite as três chamadas com as
ordens explícitas acima e não precisa de `DELETE`.

### Por que aprovação interna

O guia é sobre o **primeiro** post. Nesse momento o cliente provavelmente nem recebeu o
link do Hub. O caminho interno fecha o ciclo dentro de um app só, é 100% capturável pelo
script existente, e não arrasta um segundo app para dentro de um tutorial de primeira
utilização. O caminho do portal ganha um callout apontando para
`como-o-cliente-aprova-posts-pelo-hub`, que já é dono desse assunto.

## Arquitetura

Seis peças. Cinco novas, uma reaproveitada.

### Peça 1: a spec de captura

`e2e/screenshots/primeiro-post.spec.ts`, slug `como-agendar-seu-primeiro-post`. Roda por
`npm run screenshots:capture` junto das outras. Instala a rede de segurança e chama
`assertNoViolations` por último, como todas as demais.

**Política de zero escrita**, em duas modalidades:

- **Passos de criação** (Novo Cliente, Novo Membro, Novo Fluxo, Novo Post) são capturados
  com o **formulário preenchido, antes do submit**. Um formulário completo ensina tanto
  quanto um registro salvo, e não grava nada.
- **Passos de resultado** são capturados contra as **personas que já existem no DK TESTE**
  e já foram liberadas para publicação nas specs anteriores (Studio Bem-Estar,
  Dr. Rafael Nunes e as outras duas).

Três passos são obrigatoriamente pré-clique. O que os protege **não é o mesmo em cada
caso**, e a diferença importa:

| Passo | Protegido por |
|---|---|
| `Convidar` | Rede de segurança. `invite-user` está na blocklist |
| `Agendar` | Rede de segurança, **depois da Peça 2**. Hoje só o caminho de Instagram está coberto |
| OAuth do Facebook | **Nada, no nível de rede.** Só a disciplina da spec |

A rede opera sobre `**/functions/v1/**` e `**/rest/v1/**` (`installSafetyNet`). Ela não
vê, e estruturalmente não pode ver, uma navegação para `facebook.com`. Um clique acidental
em `Conectar Instagram` que atravesse o consentimento altera uma integração real e a rede
segue verde.

O próprio `safety.ts` já diz isso no seu docstring: é um backstop para erros, não uma
garantia contra toda consequência de clicar no controle errado. A spec de captura para no
botão `Conectar Instagram` e nunca o clica. Esse passo depende da spec estar certa, e o
plano deve tratá-lo como o passo de maior risco da execução, não como mais um pré-clique.

### Peça 2: fechar a lacuna do TikTok na rede de segurança

**Precede qualquer execução de captura.** Adicionar `tiktok-publish` a
`BLOCKED_FUNCTIONS` em `e2e/screenshots/safety.ts`.

A lacuna é a da descoberta 4: agendar um post de TikTok chama
`tiktok-publish/schedule/:id`, um nome de função que a blocklist não contém, então nem o
interceptador de `functions/v1` nem `isSchedulingWrite()` o pegam. A rede foi escrita
quando o agendamento por PostgREST era o caminho conhecido, e a superfície do TikTok
chegou depois.

`tiktok-publish` serve também leituras que specs de captura poderiam querer
(`creator-info/:clientId`, `tiktok.ts:248`). Se alguma spec futura precisar delas, a
correção é bloquear o sub-caminho `schedule` via `BLOCKED_FUNCTION_SUBPATHS`, mecanismo
que já existe para exatamente esse formato. Nenhuma spec atual precisa, então bloquear a
função inteira é mais seguro e mais simples.

Isso vale independentemente deste artigo: a lacuna existe hoje para qualquer execução de
captura.

### Peça 3: o artigo

Migration `20260806000002_kb_primeiro_post_guide.sql`. Declara os helpers `_kb_*`, faz o
upsert do artigo, rebaixa o artigo antigo, reescreve os links de contexto de `/dashboard`,
e derruba os helpers no fim. Mesmo formato de `20260717000002`.

| Campo | Valor |
|---|---|
| Título | `Como agendar seu primeiro post` |
| Slug | `como-agendar-seu-primeiro-post` |
| Categoria | `primeiros-passos` |
| `display_order` | 3, com renumeração da categoria (ver Ordenação final) |
| Link de contexto | `/dashboard`, ordem 0, com renumeração dos dois existentes |

**Estrutura**, nove seções `h2` para que `TableOfContents` dê um menu de salto em vez de
uma rolagem única:

| # | Seção | Telas | Capturas |
|---|---|---|---|
| 0 | O que você vai precisar | callout | 0 |
| 1 | Cadastre o cliente | `/clientes` | 4 |
| 2 | Monte sua equipe | `/equipe` | 5 |
| 3 | Conecte o Instagram do cliente | `/clientes/:id` + Facebook | 3 + 3 externas |
| 4 | Crie o fluxo de entrega | `/entregas` | 5 |
| 5 | Crie o post dentro do fluxo | gaveta da entrega | 5 |
| 6 | Aprove o post | diálogo de etapa no kanban | 3 |
| 7 | Agende a publicação | gaveta, bloco de publicação | 4 |
| 8 | E agora? | acompanhamento e falhas | 1 |

Total: 33 slots. 30 capturados pelo script, 3 manuais.

**A seção 6 é a razão de o artigo existir.** Ela abre nomeando o sintoma nas palavras do
leitor ("não encontro o botão de agendar"), explica que agendar exige post aprovado, e
mostra o diálogo com a escolha `Aprovar internamente`.

As seções 2, 3 e 8 levam um link de saída cada para o artigo que já é dono daquele tema,
para que este guia continue sendo uma espinha e não vire um manual.

### Peça 4: o teste de guarda

Em `apps/crm/src/pages/ajuda/__tests__/`, lendo o arquivo da migration:

1. Todo nó `inlineImage` do artigo tem `r2Key` nulo. Um valor não nulo passa no smoke
   test da autoria e dá 403 uma hora depois, que é exatamente o modo de falha que a
   descoberta 2 descreve.
2. Nenhum travessão (`—`) no texto do artigo.

O segundo item foi contestado numa revisão externa como "escopo de teste sem valor de
implementação". Fica. Ausência de travessão é regra de estilo da casa para toda copy
voltada ao usuário, e este artigo é a copy mais voltada ao usuário do repositório: vai
para a Central de Ajuda de todos os clientes. A regra não tem hoje nenhum guardião
automatizado, e este é o texto que menos pode parecer gerado por máquina.

### Peça 5: filtro de slug no script de upload

`scripts/upload-kb-images.mjs` hoje itera **todo** `e2e/.shots` e sobe cada slug que
encontrar (`for (const slug of readdirSync(SHOT_DIR))`). O diretório é gitignorado e
persiste entre execuções, então ele carrega capturas de esforços anteriores, mais
qualquer PNG parcial de uma execução que quebrou no meio.

Isso fura a barreira de revisão humana: a revisão cobre as capturas deste artigo, e o
script publicaria tudo o que estivesse no diretório, revisado ou não, num bucket público.

Mudança mínima: aceitar um slug como argumento e subir apenas aquele subdiretório.
Sem argumento, o script recusa a execução em vez de assumir "tudo", para que o
comportamento perigoso deixe de ser o padrão. O script é ferramenta de desenvolvimento,
fora de qualquer caminho de CI ou de produção.

### Peça 6: a lista de capturas externas

Um documento novo em `docs/superpowers/plans/`, no formato do de 2026-07-16: arquivo a
criar, tela, estado exigido e o que redigir. Três entradas, todas do fluxo do Facebook.

## Dependência em aberto

A captura final precisa do botão `Agendar` **habilitado**. A condição real é mais estrita
do que só ter data e legenda (`ScheduleButton.tsx:504`):

```ts
const canSchedule = !!post.scheduled_at && hasRequiredCaption && !accountWarning && tiktokReady;
```

Desdobrando `accountWarning` (`ScheduleButton.tsx:213`) e `tiktokReady` (`:231`), o post
alvo precisa satisfazer **todas** estas condições:

| Requisito | Origem |
|---|---|
| `status = 'aprovado_cliente'` | `:495`, senão o bloco nem renderiza |
| `scheduled_at` não nulo | `:504` |
| Legenda de Instagram preenchida, ou tipo `stories` | `hasRequiredCaption`, `:498` |
| Instagram conectado, token não expirado, sem revogação | `accountBlocked` |
| Permissão de publicação presente | `missingPublishPermission` |
| Não mirar TikTok, ou ter configurações de TikTok completas | `tiktokReady` |

A consulta da primeira tarefa precisa filtrar por tudo isso e fixar a plataforma em
`instagram`, senão devolve um post cujo botão aparece **desabilitado** e a captura final
não serve.

> A revisão externa afirmou que as quatro personas do DK TESTE estão com token de
> Instagram expirado. Isso não foi verificado e não é assumido aqui: é exatamente o que a
> consulta abaixo existe para descobrir.

**Primeira tarefa do plano:** consulta somente leitura em produção procurando um post do
DK TESTE que satisfaça a tabela acima.

- **Se existir:** a spec mira nele, e a política de zero escrita permanece intacta.
- **Se não existir:** **parar e perguntar.** Nenhum dos caminhos de contorno é decisão de
  implementação.

Os dois contornos, para quando essa conversa acontecer:

1. **Provisionar o estado uma vez, fora da execução de captura.** Um post preparado à mão
   no DK TESTE, com data bem no futuro, tratado como fixture permanente e referenciado por
   id na spec. É o que preserva melhor a política de zero escrita: a spec continua só
   lendo, e a escrita é um ato humano único e auditável, não um efeito colateral de um
   comando de captura.
2. **Estreitar `isSchedulingWrite()`** para barrar apenas `status: 'agendado'`, liberando
   `scheduled_at`. A inércia do campo é prova, não estimativa (descoberta 4). Mas isto
   **contradiz a política de zero escrita** declarada nas Decisões: a captura passaria a
   gravar uma data num post real de produção. Se for escolhido, deixa de ser "zero
   escrita" e vira uma exceção nomeada, que exige alvo exato, responsável e reversão
   explícita (`scheduled_at: null` ao fim da execução, que a própria rede de segurança já
   permite por não ser agendamento).

A opção 1 é a recomendada, justamente por não exigir que a política seja reescrita.

## Ordem de execução

A migration não pode ser finalizada antes das capturas, porque depende dos URLs reais.

1. Copiar `.env.e2e.local` e `.env.kb-upload.local` do checkout principal para a worktree.
   Worktrees não herdam esses arquivos
2. Adicionar `tiktok-publish` a `BLOCKED_FUNCTIONS` (Peça 2). **Antes de qualquer
   execução de captura**, não depois
3. Consulta somente leitura em produção pelo post agendável
4. Escrever a spec e rodar `npm run screenshots:capture`
5. **Revisão humana das 30 PNGs** antes de qualquer upload
6. `node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs como-agendar-seu-primeiro-post`
7. Escrever a migration com os URLs retornados
8. Documento de capturas externas, preenchido quando os PNGs chegarem
9. Verificação (abaixo)

O passo 5 é uma barreira dura, não uma sugestão.

## Verificação

- `npm run format`, `npm run lint`
- Os quatro `tsc` que o CI roda (crm, hub, admin, scripts). `npm run build` cobre só o CRM
- `npm run test`, incluindo o teste de guarda novo
- Ler o artigo no browser e confirmar que as imagens renderizam
- Confirmar que o índice lateral lista as nove seções
- Confirmar que `primeiros-30-minutos-no-mesaas` continua acessível, agora abaixo do guia
- Verificar o prefixo de versão da migration contra `origin/main` **na hora de abrir o PR**,
  não na hora de criar o arquivo. Colisão de versão já atingiu este repositório duas vezes

## Riscos

**Vazamento de dados reais.** DK TESTE convive com a agência real em produção. O switcher
de workspace, listas de clientes e a sidebar podem expor nomes reais. Mitigação: a revisão
humana do passo 5, e a preferência por personas já auditadas pelas specs anteriores.
Publicado é permanente.

**Deriva entre passo e imagem.** 30 imagens viram passivo assim que a UI muda. Se alguém
reordenar os passos sem reordenar as imagens, o artigo fica ativamente enganoso, pior do
que sem imagem. Mitigação: `alt` descritivo em pt-BR em toda imagem, e a spec versionada
que permite recapturar tudo com um comando.

**O artigo é longo.** Trinta capturas numa página só. Mitigação: as nove seções `h2` e o
índice lateral que `ArtigoPage` já renderiza.

## Fora de escopo

- O caminho de aprovação pelo Hub, que continua sendo de `como-o-cliente-aprova-posts-pelo-hub`
- Retrofit de capturas nos outros 24 artigos sem imagem
- As capturas externas do Claude/MCP que ficaram pendentes de 2026-07-16
- O bug dos links de contexto de `/configuracao/mcp`, registrado no design de 2026-07-16
