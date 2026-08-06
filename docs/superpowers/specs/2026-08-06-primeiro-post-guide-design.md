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

### 4. A rede de segurança bloqueia agendamento, e isso é deliberado

`e2e/screenshots/safety.ts` intercepta chamadas a edge functions que agem para fora
(`instagram-publish`, `invite-user`, `billing-*`) **e** writes PostgREST que agendam:
`isSchedulingWrite()` barra um POST/PATCH/PUT em `workflow_posts` que sete
`status = 'agendado'` **ou** `scheduled_at` não nulo.

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
| Formato | Um artigo único, com oito seções `h2` para o índice lateral |

### Por que rebaixar e não substituir

`primeiros-30-minutos-no-mesaas` continua útil como mapa em prosa para quem quer entender
o produto antes de operá-lo, e o slug pode já estar linkado de e-mails de ciclo de vida.
Ele cai para `display_order: 4` e cede o link de contexto de `/dashboard`.

### Por que aprovação interna

O guia é sobre o **primeiro** post. Nesse momento o cliente provavelmente nem recebeu o
link do Hub. O caminho interno fecha o ciclo dentro de um app só, é 100% capturável pelo
script existente, e não arrasta um segundo app para dentro de um tutorial de primeira
utilização. O caminho do portal ganha um callout apontando para
`como-o-cliente-aprova-posts-pelo-hub`, que já é dono desse assunto.

## Arquitetura

Quatro peças. Três novas, uma reaproveitada.

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

Três passos são obrigatoriamente pré-clique, e a rede de segurança é quem garante isso,
não a boa vontade da spec: `Convidar` (dispara e-mail real via `invite-user`), `Agendar`
(arma o cron de publicação) e as telas de OAuth do Facebook (externas).

### Peça 2: o artigo

Migration `20260806000002_kb_primeiro_post_guide.sql`. Declara os helpers `_kb_*`, faz o
upsert do artigo, rebaixa o artigo antigo, reescreve os links de contexto de `/dashboard`,
e derruba os helpers no fim. Mesmo formato de `20260717000002`.

| Campo | Valor |
|---|---|
| Título | `Como agendar seu primeiro post` |
| Slug | `como-agendar-seu-primeiro-post` |
| Categoria | `primeiros-passos` |
| `display_order` | 3 |
| Link de contexto | `/dashboard`, ordem 0 |

**Estrutura**, oito seções `h2` para que `TableOfContents` dê um menu de salto em vez de
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

### Peça 3: o teste de guarda

Em `apps/crm/src/pages/ajuda/__tests__/`, lendo o arquivo da migration:

1. Todo nó `inlineImage` do artigo tem `r2Key` nulo. Um valor não nulo passa no smoke
   test da autoria e dá 403 uma hora depois, que é exatamente o modo de falha que a
   descoberta 2 descreve.
2. Nenhum travessão (`—`) no texto do artigo.

### Peça 4: a lista de capturas externas

Um documento novo em `docs/superpowers/plans/`, no formato do de 2026-07-16: arquivo a
criar, tela, estado exigido e o que redigir. Três entradas, todas do fluxo do Facebook.

## Dependência em aberto

A captura final precisa do botão `Agendar` **habilitado**, o que exige um post com
`status = 'aprovado_cliente'`, `scheduled_at` preenchido e legenda. A rede de segurança
impede a spec de fabricar esse estado.

**Primeira tarefa do plano:** consulta somente leitura em produção procurando um post do
DK TESTE nessas condições.

- **Se existir:** a spec mira nele e nada mais muda.
- **Se não existir:** estreitar `isSchedulingWrite()` para barrar apenas
  `status: 'agendado'`, liberando `scheduled_at`. A justificativa está na descoberta 4 e é
  uma prova, não uma estimativa: o predicado de `claim_posts_for_publishing` exige
  `status = 'agendado'` nas três fases. Afrouxar um controle de segurança que uma sessão
  anterior escreveu com cuidado exige aviso explícito antes, e o bloqueio de
  `status: 'agendado'` permanece absoluto de qualquer forma.

## Ordem de execução

A migration não pode ser finalizada antes das capturas, porque depende dos URLs reais.

1. Copiar `.env.e2e.local` e `.env.kb-upload.local` do checkout principal para a worktree.
   Worktrees não herdam esses arquivos
2. Consulta somente leitura em produção pelo post agendável
3. Escrever a spec e rodar `npm run screenshots:capture`
4. **Revisão humana das 30 PNGs** antes de qualquer upload
5. `node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs`
6. Escrever a migration com os URLs retornados
7. Documento de capturas externas, preenchido quando os PNGs chegarem
8. Verificação (abaixo)

O passo 4 é uma barreira dura, não uma sugestão.

## Verificação

- `npm run format`, `npm run lint`
- Os quatro `tsc` que o CI roda (crm, hub, admin, scripts). `npm run build` cobre só o CRM
- `npm run test`, incluindo o teste de guarda novo
- Ler o artigo no browser e confirmar que as imagens renderizam
- Confirmar que o índice lateral lista as oito seções
- Confirmar que `primeiros-30-minutos-no-mesaas` continua acessível, agora abaixo do guia
- Verificar o prefixo de versão da migration contra `origin/main` **na hora de abrir o PR**,
  não na hora de criar o arquivo. Colisão de versão já atingiu este repositório duas vezes

## Riscos

**Vazamento de dados reais.** DK TESTE convive com a agência real em produção. O switcher
de workspace, listas de clientes e a sidebar podem expor nomes reais. Mitigação: a revisão
humana do passo 4, e a preferência por personas já auditadas pelas specs anteriores.
Publicado é permanente.

**Deriva entre passo e imagem.** 30 imagens viram passivo assim que a UI muda. Se alguém
reordenar os passos sem reordenar as imagens, o artigo fica ativamente enganoso, pior do
que sem imagem. Mitigação: `alt` descritivo em pt-BR em toda imagem, e a spec versionada
que permite recapturar tudo com um comando.

**O artigo é longo.** Trinta capturas numa página só. Mitigação: as oito seções `h2` e o
índice lateral que `ArtigoPage` já renderiza.

## Fora de escopo

- O caminho de aprovação pelo Hub, que continua sendo de `como-o-cliente-aprova-posts-pelo-hub`
- Retrofit de capturas nos outros 24 artigos sem imagem
- As capturas externas do Claude/MCP que ficaram pendentes de 2026-07-16
- O bug dos links de contexto de `/configuracao/mcp`, registrado no design de 2026-07-16
