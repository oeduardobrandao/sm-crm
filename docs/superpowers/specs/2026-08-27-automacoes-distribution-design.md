# Distribuição da feature Automações: primeiros passos, banners e paywall de nav

**Data:** 2026-08-27
**Contexto:** o App Review da Meta foi aprovado, `IG_AUTOMATION_SCOPES_LIVE=true` em prod e
`feature_instagram_automation=true` nos planos `pro` e `max`. A feature existe e funciona,
mas nada no produto a apresenta: quem tem acesso não sabe que ela chegou nem o que fazer
primeiro, e quem não tem plano não a vê (o nav esconde o item quando a flag é falsa).

**Objetivo:** três superfícies de distribuição, todas aprovadas em mockup pelo usuário
(sessão de brainstorming 2026-08-27, tema escuro, formato B do checklist):

1. Checklist de primeiros passos na própria página de Automações (Pro/Max e overrides).
2. Dois banners globais por plano — anúncio (Pro/Max) e upsell (Start/Free) — **via dados,
   sem código**.
3. Nav item "Automações" visível com cadeado para Start/Free, levando à página bloqueada
   com pitch da feature.

Fora de escopo (YAGNI): trilha nova no Guia de primeiros passos, dialog modal de upsell,
banner hard-coded no app, e-mail de anúncio.

---

## 1. Checklist "Comece por aqui" na AutomacoesPage

**Formato aprovado: checklist vertical compacto** (estilo dos cards do guia), num card no
topo da `AutomacoesPage`, acima da tabela de automações. Três passos com progresso real por
sinais do workspace:

| # | Passo | Sinal de conclusão | CTA |
|---|---|---|---|
| 1 | Reconecte o Instagram do cliente | ≥1 `instagram_accounts` do workspace com `authorization_status='active'`, `permissions` contendo `instagram_business_manage_comments` **e** `instagram_business_manage_messages`, e `comments_subscribed_at IS NOT NULL` (a mesma elegibilidade tripla do processador) | link para a lista de clientes (`/clientes`) |
| 2 | Crie sua primeira automação | `automations.length > 0` (dados que a página já busca) | botão "Criar →" que abre o dialog Nova automação existente (continua atrás do `FeatureGate` de criação) |
| 3 | Teste com um comentário | algum `dms_sent_count > 0` na lista já buscada | nenhum CTA; texto explicativo curto ("Comente a palavra-chave num post e veja a DM chegar.") |

**Copy aprovada (pt):** título "Comece por aqui", subtítulo "3 passos para a primeira DM
automática", link "Dispensar". Passos como na tabela. Versão en no mesmo padrão da página
(i18n pt/en já existente na AutomacoesPage).

**Estados visuais:** concluído = check verde (`--success`) com texto riscado/esmaecido;
atual = círculo com anel `--primary-color`; pendente = círculo cinza, linha com opacidade
reduzida.

**Comportamento:**
- Aparece quando a página renderiza seu conteúdo normal (flag ligada ou workspace com
  automações legadas) **e** há passo incompleto **e** não foi dispensado.
- Some sozinho quando os 3 sinais completam (sem persistir "completou": os sinais são
  duráveis o bastante — recomputar a cada visita é correto e barato).
- "Dispensar" persiste em `localStorage` com chave por workspace
  (`automacoes_checklist_dismissed:<conta_id>`), padrão do guia. Sem persistência em DB.
- Sinal 1 exige uma query nova e leve no `store` (select em `instagram_accounts` das
  colunas `authorization_status`, `permissions`, `comments_subscribed_at`, limitada ao
  workspace via RLS), embrulhada em `useQuery` na página. Sinais 2 e 3 derivam dos dados
  já carregados — nenhuma busca extra.

**Unidade isolada:** componente `AutomacoesChecklist` em
`apps/crm/src/pages/automacoes/AutomacoesChecklist.tsx`, recebendo os três booleanos de
sinal + callback de "criar automação" por props (puro e testável sem QueryClient); a página
é quem liga sinais e persistência.

## 2. Banners globais — dados, não código

O sistema `global_banners` (migration `20260502000001`) já cobre tudo: targeting por plano
(`target_mode='plan'`, `target_plan_ids`), dismiss por usuário, agendamento, markdown no
conteúdo e a `BannersPage` do admin para criar. **Nenhuma mudança de código.**

Dois registros a criar (via admin, na hora do rollout):

| | Pro/Max | Start/Free |
|---|---|---|
| `type` | `info` | `info` |
| `target_plan_ids` | `{pro,max}` | `{start,free}` |
| conteúdo (markdown) | ✨ **Novo: Automações de Instagram.** Comentário com palavra-chave vira DM automática. Já disponível no seu plano. [Criar minha primeira automação →](https://mesaas.com.br/automacoes) | ✨ **Novo: Automações de Instagram:** responda comentários com DM automática. Disponível nos planos Pro e Max. [Fazer upgrade →](https://mesaas.com.br/configuracao/cobranca) |

Regra da casa aplicada: sem travessão (em-dash) em copy de usuário; os "—" dos mockups
viram ponto ou dois-pontos aqui e no pitch da tela bloqueada.
| `dismissible` | true | true |
| `ends_at` | ~3 semanas após o rollout | idem |

Nota consciente: links de banner abrem com `target="_blank"` (comportamento do
`GlobalBannerContainer`) — o CTA abre nova aba do app. Aceito; não vale mudança de código.

## 3. Nav com cadeado + página bloqueada (Start/Free)

**Hoje:** `getNavGroups` *remove* o item `automacoes` quando
`features.feature_instagram_automation` é falso, salvo workspace com automações legadas
(`buildEffectiveNavFeatures` faz o OR com `hasAutomations`).

**Novo comportamento:** em vez de remover, o item fica **visível, esmaecido, com ícone
`Lock`** (lucide) à direita — novo campo opcional `showLockedWhenGated: true` na definição
do item de nav, irmão do `comingSoon` existente; só `automacoes` o declara. O item
continua clicável e navega para `/automacoes`.

- Sidebar **e** MobileNav (as duas superfícies consomem `getNavGroups`).
- `getNavGroups` passa a devolver o item com um marcador `locked: true` (em vez de
  filtrá-lo) quando o flag correspondente é falso e o item declara `showLockedWhenGated`.
  O contrato existente de `features: null` (carregando/ilimitado = sem filtro) não muda.
- A regra de automações legadas não muda: com `hasAutomations`, o OR do
  `buildEffectiveNavFeatures` mantém o item destravado e a página acessível.

**Página bloqueada:** `/automacoes` com flag desligada e sem automações legadas renderiza
em página cheia a `UpgradeLockedScreen` enriquecida com o pitch aprovado:

- Ícone ⚡, título "Automações não está no seu plano", parágrafo-pitch ("Responda
  comentários do Instagram com uma DM automática: palavra-chave no comentário, mensagem
  (com botões de link) na caixa de entrada do seguidor.").
- Três mini-cards: 💬 "Palavra-chave no comentário dispara a DM", 🔗 "Até 3 botões de link
  na mensagem", ↩️ "Resposta pública automática opcional".
- Owner: botão "Fazer upgrade" → `/configuracao/cobranca`. Agent/admin sem poder de
  compra: "Fale com o dono do workspace para liberar este recurso." (comportamento que a
  `UpgradeLockedScreen` já tem).
- Telemetria `reportPaywallHit` (render + clique) que a tela já dispara — sem mudança.

**Mecânica:** `UpgradeLockedScreen` ganha uma prop opcional `children` (renderizada entre o
título/pitch e o botão), retrocompatível com os callers atuais. A `AutomacoesPage` decide:
flag off e sem automações → `UpgradeLockedScreen` com o pitch; caso contrário → página
normal (o botão "Nova automação" continua individualmente gateado pelo `FeatureGate`, que
cobre a janela de entitlement obsoleto). Verificar na implementação se a rota já passa por
`ProtectedRoute` com feature — se sim, o gate de página vive lá e recebe o pitch; a regra
"legadas continuam acessando" tem de ser preservada onde quer que o gate esteja.

## Dados / backend

Nenhuma migration, nenhuma edge function. Tudo é frontend + dois registros de banner.

## Testes

- `AutomacoesChecklist` (unit): 3 combinações de sinais (0/3, 1/3 com passo atual certo,
  3/3 → não renderiza), dismiss chama callback, estados visuais por classe.
- Página: dismiss persistido por workspace no localStorage; checklist não aparece
  dispensado; reaparece em outro workspace.
- `getNavGroups`/`buildEffectiveNavFeatures`: flag off + `showLockedWhenGated` → item
  presente com `locked: true`; flag off sem o campo → removido (comportamento atual dos
  demais); flag on → normal; `hasAutomations` → destravado. **Atualizar os testes de
  Sidebar/MobileNav que hoje esperam ocultação.**
- Sidebar/MobileNav (render): item locked esmaecido com ícone de cadeado e href ativo.
- `UpgradeLockedScreen`: com `children` renderiza o pitch; sem, comportamento atual
  (callers existentes não quebram).
- Página bloqueada: flag off + 0 automações → locked screen; flag off + automações
  legadas → página normal.

## Riscos e decisões registradas

- **Sinal 1 é por workspace, não por cliente:** basta UMA conta reconectada para o passo
  contar como feito. Simples e suficiente para a primeira DM; refinamento por cliente só
  se houver demanda.
- **`comingSoon` (TikTok) e `locked` são campos distintos** — inerte vs. clicável — e não
  se combinam.
- O checklist reusa a estética dos `guideBits` mas **não** importa o sistema do guia
  (trilhas/sinais/storage próprios); é um componente local da página.
