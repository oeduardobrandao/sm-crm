# Guia de primeiros passos (onboarding wizard) — design

- **Data:** 2026-08-25
- **Status:** aprovado (mockups + 6 decisões fechadas com o usuário)
- **Mockups:** https://claude.ai/code/artifact/979339a0-9bf2-496e-b507-d584b2695c53
- **Branch:** `claude/client-onboarding-wizard-cf66d0`

## Objetivo

Um wizard de onboarding para o dono de um workspace novo: um modal impossível de não
ver e fácil de fechar, com três trilhas de páginas curtas (uma ideia por página) que
guiam pelas tarefas essenciais — adicionar um cliente (cadastro, Instagram, link do
Hub), montar a equipe (membros, papéis, tarefas) e criar entregas (fluxos, posts,
status, agendamento). Ações "Fazer agora" levam direto à tela real do app; o guia
marca páginas como concluídas sozinho quando detecta o resultado.

Duas peças permanentes acompanham (fora do guia): o glossário fixo fluxo/modelo/post
no passo 1 do assistente de novo fluxo, e o pill de reentrada "Guia".

## Decisões fechadas

1. **Formato:** modal centrado, mesmo padrão do `NewWorkflowWizard` (760px máx,
   barra de progresso segmentada).
2. **`OnboardingBanner` do dashboard é aposentado.** O guia cobre os mesmos passos;
   o pill vira a reentrada única.
3. **Auto-abertura:** dono do workspace, workspace sem clientes e sem fluxos, primeira
   visita ao dashboard. Workspaces existentes (com dados) só veem o pill.
4. **Persistência:** `localStorage` por workspace (padrão da casa). Sem servidor.
5. **Nomenclatura:** padronizar **"modelo"** em toda a cópia nova (o app hoje mistura
   "template" e "modelo").
6. **Conteúdo:** leads e briefing ficam de fora (trilha futura, se entrarem).

## Escopo

- Novo componente global de guia (modal + pill + conteúdo das 15 páginas + home).
- Deep links "Fazer agora" com abertura automática de dialogs nas páginas alvo.
- Remoção do `OnboardingBanner` do dashboard.
- Glossário fixo no `StepTemplate` do assistente de fluxo + troca de "template" por
  "modelo" nas strings visíveis do assistente.

### Não-escopo

- Trilhas de leads/briefing; persistência server-side; i18n (cópia pt-BR hardcoded,
  como os wizards existentes); renomear identificadores de código, eventos de
  analytics ou colunas de banco na troca template→modelo; tour driver.js novo.

## UX

### Montagem e form factor

- Renderizado em `AppLayout` (`apps/crm/src/components/layout/AppLayout.tsx`), como
  irmão de `<main>`, lazy + `<Suspense fallback={null}>` (mesmo padrão do
  `GlobalBannerContainer`). Assim aparece em qualquer página autenticada e **não**
  aparece em `/workspace-setup`, `/comecar` e `/oauth/consent` (fora do AppLayout).
- Dialog shadcn (`components/ui/dialog.tsx`), `maxWidth: 760`, overlay padrão
  (`bg-black/80`). Sem `confirmClose` — fechar nunca perde nada; fechar salva o
  progresso.

### Tela inicial (home)

- Título "Bem-vindo ao Mesaas", subtítulo prometendo que fechar não perde progresso.
- Barra de progresso geral fina (amarela `--primary-color`) + contador "N de 15 páginas".
- Três cards de trilha: ícone, título numerado, uma linha de resumo + contagem de
  páginas/tempo, botão Começar/Continuar (ink no próximo passo sugerido, outline nos
  demais). Card 1 leva o badge amarelo "Dica: comece com o seu próprio Instagram".
- Rodapé: "Fechar por enquanto" (link discreto) + "Seu progresso fica salvo".

### Anatomia de página

- Header: breadcrumb com nome da trilha (volta para a home), "Página N de M", X.
- Barra segmentada (M segmentos, 4px, amarelo/`--border-color`, `aria-hidden` com
  alternativa textual no header), como no `NewWorkflowWizard`.
- Corpo: título (1 linha), lead (1–2 frases), um visual (cards de opção, mini-form,
  checklist, pills) — nunca mais que isso. Texto mastigado, sem parágrafos longos.
- Páginas "mão na massa" têm um `actbox`: uma linha explicando o que abre + botão ink
  "Fazer agora". Clicar fecha o modal, navega e registra `lastPageId`.
- Rodapé: "Voltar" (ghost) à esquerda; "Continuar" (outline) à direita. Última página
  de trilha troca o Continuar pela ponte ink para a próxima trilha (ou "Concluir
  guia" na t3p6).

### Trilhas e páginas

IDs estáveis (persistidos no localStorage). Sinais de conclusão em §Arquitetura.

| ID | Título | Ação "Fazer agora" | Sinal de conclusão | Flag |
|---|---|---|---|---|
| `t1p1` | Tudo começa com um cliente | — | vista | — |
| `t1p2` | Crie o cadastro | `/clientes?novo=1` | `clientes > 0` | — |
| `t1p3` | Conecte o Instagram do cliente | `/clientes/:id/redes-sociais` | conta IG conectada | — |
| `t1p4` | Gere o link do Hub | `/clientes/:id/hub` | token de hub existe | `feature_hub_portal` |
| `t1p5` | Primeiro cliente pronto (recap) | — | vista | — |
| `t2p1` | Membro é uma coisa, acesso é outra | — | vista | — |
| `t2p2` | Três papéis de acesso | — | vista | — |
| `t2p3` | Convide alguém da equipe | `/equipe?novo=1` | `membros > 0` | — |
| `t2p4` | O dia a dia vive nas Tarefas (ponte) | — | vista | — |
| `t3p1` | Fluxo, etapas e posts | — | vista | — |
| `t3p2` | Crie o primeiro fluxo | `/entregas?novo-fluxo=1` | `workflows > 0` | — |
| `t3p3` | O post reúne tudo | — | vista | — |
| `t3p4` | Status contam a história | — | vista | — |
| `t3p5` | Regras de agendamento | — | vista | — |
| `t3p6` | Pronto para rodar (conclusão) | — | vista | — |

- Páginas com flag de entitlement seguem o precedente do `OnboardingBanner`: quando
  `hasFeature` é falso, a página **sai da trilha** (a contagem encolhe) — nunca
  oferecer um passo paywalled que impediria o guia de chegar a 100%. `hasFeature` é
  fail-open durante o load, igual ao resto do app.
- Cópia das páginas: seguir os mockups do artifact. Fontes canônicas: papéis vêm do
  artigo "Permissões e papéis no workspace" da central de ajuda (migration
  `20260520000001`); fluxo/etapas/posts/modelo vêm do `ComoFuncionaPanel`; regras de
  agendamento vêm de `_shared/instagram-publish-utils.ts` (`validateForScheduling`) e
  `instagramLimits.ts`; nomes reais de status padrão são verificados no código na
  implementação (o mockup usa nomes ilustrativos).
- Deep links de `t1p3`/`t1p4` usam o cliente mais recente do workspace; sem cliente,
  caem em `/clientes`.

### Pill de reentrada

- Fixed no canto inferior direito: "Guia · N de 15" + ponto amarelo de pendência.
- **`display: none` por padrão; visível só dentro de `@media (min-width: 1101px)`**
  (regra dura do layout do CRM para UI fixa ancorada — abaixo disso a sidebar vira
  drawer). Abaixo de 1101px a reentrada é um item "Guia de primeiros passos" na
  sidebar (drawer), com o mesmo ponto de pendência.
- Visível para donos enquanto o guia não estiver concluído. Some quando: (a) o
  usuário clica "Concluir guia" na t3p6, (b) todas as páginas estão concluídas, ou
  (c) todos os sinais de ação (clientes, IG, hub, membros, fluxos) já são verdadeiros
  — workspace claramente ativo, guia irrelevante (espelha o auto-dismiss do banner).

### Peças permanentes

1. **Glossário fixo** no `StepTemplate` (passo 1 do `NewWorkflowWizard`): substitui o
   tip box atual (que explica fluxo e template mas não menciona post) pelas três
   linhas Fluxo/Modelo/Post do mockup. Permanente, independente do guia.
2. **Template → modelo** nas strings visíveis do assistente: cards do passo 1, cópia
   do `StepReview` ("Salvar estas etapas como modelo" etc.). O `ComoFuncionaPanel` já
   diz "modelo". Identificadores de código, eventos e banco não mudam.

## Arquitetura

### Arquivos novos (`apps/crm/src/components/guide/`)

| Arquivo | Papel |
|---|---|
| `GuideDialog.tsx` | O modal: home + render da página corrente, navegação, footer |
| `GuidePill.tsx` | Pill fixed (desktop) + item de sidebar (drawer) |
| `guideContent.tsx` | Conteúdo declarativo: trilhas → páginas (id, título, corpo JSX, ação, sinal, flag) |
| `useGuideProgress.ts` | Estado + persistência localStorage + derivados (contagens, próxima página) |
| `useGuideSignals.ts` | Queries TanStack dos sinais de conclusão |
| `__tests__/` | Testes (ver §Testes) |

`AppLayout` monta `<GuideDialog>` e `<GuidePill>` (lazy). A `Sidebar` recebe o item
de reentrada condicional.

### Modelo de conteúdo

```ts
type GuidePage = {
  id: string;                 // 't1p2' — persistido, nunca renumerar
  title: string;
  body: ReactNode;            // corpo pré-montado, sem lógica
  action?: { label: string; to: (ctx: GuideCtx) => string; caption: string };
  signal?: SignalKey;         // ausente = conclui ao ser vista
  entitlementFlag?: keyof FeatureFlags;
};
type GuideTrail = { id: 't1' | 't2' | 't3'; title: string; icon: ...; pages: GuidePage[] };
```

### Persistência (localStorage, por workspace)

- Chave: `` `guia_v1_${conta_id}` `` (idioma de versionamento `.v1` da casa; conta_id
  de `profile.conta_id`, como todas as chaves irmãs).
- Valor JSON: `{ autoOpenedAt?, dismissedAt?, pagesSeen: string[], pagesDone: string[],
  lastPageId?, concludedAt? }`. Parse corrompido → reseta para vazio.
- A chave antiga `onboarding_dismissed_${conta_id}` do banner é ignorada (workspaces
  que a têm já possuem dados e não recebem auto-abertura de qualquer forma).
- `profiles.onboarding_complete` **não é tocado** — semanticamente significa "aceitou
  convite/definiu senha", não "viu o produto".

### Sinais de conclusão (`useGuideSignals`)

Queries próprias (o guia é global; não herda as do dashboard), `staleTime` curto e
`refetchOnWindowFocus: true` para que a volta de um deep link atualize os checks:

| Sinal | Fonte |
|---|---|
| `hasCliente` | `getClientes()` count > 0 (store) |
| `hasInstagram` | `getPortfolioAccounts()` length > 0 (`services/analytics`, mesma fonte do banner) |
| `hasHubToken` | novo helper `hasAnyHubToken()` em `store/hub.ts`: `select count` em `client_hub_tokens` do workspace (RLS já escopa) |
| `hasMembro` | `getMembros()` count > 0 |
| `hasWorkflow` | `getWorkflows()` count > 0 |

Página com `signal` conclui quando o sinal fica verdadeiro (mesmo com o guia
fechado); página sem `signal` conclui ao ser vista.

### Auto-abertura (gating)

Abre sozinho no máximo **uma vez por workspace** (grava `autoOpenedAt`), quando TODAS
as condições valem:

- `loading === false` no `AuthContext` e `useIsWorkspaceOwner()` retorna true (o
  helper estrito: `membershipResolved !== false && workspaceRole === 'owner'`).
- Rota atual é `/dashboard`.
- Storage sem `autoOpenedAt`, `dismissedAt` e `concludedAt`.
- Queries de `hasCliente` e `hasWorkflow` **resolvidas** e ambas zero (padrão
  `TrialNudgeCard`: nunca decidir sobre dados parciais — sem flash para workspace
  ativo, sem flash para agente).

Sem auto-abertura, a entrada é o pill/item de sidebar (mesmas regras de visibilidade
do §Pill). Fechar o modal (X, overlay, "Fechar por enquanto") grava `dismissedAt` e
mantém o progresso.

### Deep links "Fazer agora"

Fluxo: fecha o modal → `navigate(to)` → grava `lastPageId`. Reabrir pelo pill volta
direto em `lastPageId`. O modal **não** reaparece sozinho depois da ação.

Alterações nas páginas alvo (efeito on-mount que lê o param, abre o dialog e o
remove via `setSearchParams(..., { replace: true })`):

| Rota | Param | Abre |
|---|---|---|
| `/clientes` | `?novo=1` | dialog de novo cliente (`ClientesPage`) |
| `/equipe` | `?novo=1` | dialog de novo membro (`EquipePage`) |
| `/entregas` | `?novo-fluxo=1` | `NewWorkflowWizard` (`EntregasPage`) |

`/clientes/:id/redes-sociais` e `/clientes/:id/hub` já são rotas — sem param, só
navegação (id = cliente mais recente). Nenhuma rota nova → **sem mudança no
`vercel.json`**.

### Remoção do OnboardingBanner

- Remover `<OnboardingBanner ...>` do `DashboardPage`, o componente e seu teste.
- As queries do dashboard que só o alimentavam (ex.: `leads` se ninguém mais usa) são
  revisadas na implementação; remover apenas o que ficar órfão.

### Analytics (`captureEvent`)

`guide_opened` `{source: 'auto'|'pill'|'sidebar'}` · `guide_closed` `{page}` ·
`guide_page_viewed` `{page}` · `guide_action_clicked` `{page}` ·
`guide_trail_completed` `{trail}` · `guide_completed` `{via: 'cta'|'signals'}`.

## Acessibilidade

- Radix Dialog cuida de foco/escape. Barras de progresso `aria-hidden` com o texto
  "Página N de M" visível como alternativa. Breadcrumb é botão real (volta à home).
- Cores: texto de erro nunca usa `--danger` puro (regra AA da casa); pills de status
  do mockup seguem os tokens soft existentes do `Badge`.

## Testes

- `useGuideProgress`: persistência, parse corrompido, marcação vista/concluída,
  derivação de contadores e `lastPageId`.
- Gating de auto-abertura: dono vs. agente, membership não resolvida, workspace com
  dados, queries pendentes (não abre antes de resolver), abre uma vez só.
- `guideContent`: ids únicos, sinais válidos, filtro por entitlement encolhe a trilha.
- Deep links: cada página alvo abre o dialog com o param e o remove da URL. Lição do
  flake da `ImportarPage`: nunca esperar por heading que renderiza antes dos dados;
  interagir só depois de o controle estar habilitado.
- Dashboard sem o banner: testes existentes atualizados.
- Pill/media query: jsdom não avalia `@media` — visibilidade responsiva é verificada
  no browser, não em teste unitário.

## Riscos e gotchas

- **UI fixa ancorada só ≥1101px** (`display: none` por padrão) — regra dura do
  layout; abaixo disso o pill não existe, existe o item de sidebar.
- **Entitlements fail-open** durante o load: o filtro de páginas pode piscar uma
  página paywalled por instantes; aceito (mesmo comportamento do banner).
- **Sem dialogs empilhados:** o guia sempre fecha antes de navegar; nunca coexiste
  com o `NewWorkflowWizard` aberto.
- **Estados dos sinais são eventual-consistentes** (staleTime/focus refetch); o check
  pode demorar alguns segundos ao voltar — o texto do guia não promete instantâneo.
- Nomes reais dos status padrão de post devem ser lidos do código na implementação
  antes de escrever a cópia final de `t3p4`.
