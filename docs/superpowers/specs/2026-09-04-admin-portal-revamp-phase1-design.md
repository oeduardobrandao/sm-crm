# Admin portal revamp, Phase 1: primitivos, lista de Workspaces e Dashboard

**Data:** 2026-09-04
**App:** `apps/admin`
**Status:** aprovado para plano de implementação

## Objetivo

Aproximar o Admin da identidade visual do CRM sem abandonar a paleta própria do Admin,
e tornar a lista de Workspaces uma ferramenta de operação de verdade: filtros ricos,
ordenação, colunas configuráveis, estado na URL, estados de carregamento/vazio/erro,
e um cartão "Atenção" no Dashboard com os workspaces em risco. Toda a copy do Admin
passa a ser em português.

## Decisões tomadas no brainstorming

| Decisão | Escolha |
|---|---|
| Grau de paridade visual | **Primitivos apenas.** O Admin mantém a paleta cinza-fria de `globals.css`, o `--radius: 0.75rem` e o toggle de liquid glass. Adota os primitivos shadcn do CRM (Button, Input, Select, Table, Badge, etc.). |
| Mecanismo de compartilhamento | **Cópia.** Os primitivos são copiados de `apps/crm/src/components/ui/` para `apps/admin/src/components/ui/`, com imports apontando para o `cn` do Admin. Não se cria pacote compartilhado nesta fase. Risco conhecido: os dois conjuntos podem divergir com o tempo; aceito pelo usuário. |
| Onde rodam filtros e ordenação | **No servidor**, dentro da RPC `admin_list_workspaces`. Única opção correta com paginação; o export CSV herda os filtros de graça. |
| Barra de filtros | **Selects inline**, sempre visíveis, com linha de chips resumindo o que está ativo. |
| Idioma | **Português** em todo o Admin. |
| Escopo | **Fase 1** (este spec): primitivos, Workspaces, Dashboard, passada de português. **Fase 2** (spec futuro): migrar as demais páginas para os primitivos, corrigir a sidebar em hex fixo no tema claro. |

## Fora de escopo (Fase 1)

- Migrar Plans, Admins, Banners, Popups, Articles, Article editor, Login e Workspace
  detail para os primitivos. Essas páginas recebem **apenas** a passada de português.
- Sidebar com cores hex fixas (`#12151a`, `#1e2430`) que ignoram o tema claro.
- Command palette (⌘K), ações em massa, filtros em outras listas além de Workspaces.
- Pacote compartilhado `packages/ui` para os primitivos.

## 1. Primitivos copiados para o Admin

Destino: `apps/admin/src/components/ui/`. Já existe `tooltip.tsx` ali; os demais são novos.

| Arquivo | Origem | Observação |
|---|---|---|
| `button.tsx` | CRM | Variantes `default`, `ink`, `destructive`, `outline`, `secondary`, `ghost`, `link`; tamanhos `default`, `sm`, `lg`, `icon`. Remover o `mb-2` da classe base do CRM (é um resquício de layout do CRM, não faz sentido no Admin). |
| `input.tsx` | CRM | Como está. |
| `select.tsx` | CRM | Radix Select. Substitui os `<select>` nativos da página de Workspaces. A regra global `select { appearance: none; … }` em `globals.css` continua valendo para os `<select>` nativos que sobram nas páginas não migradas. |
| `table.tsx` | CRM | `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`. |
| `badge.tsx` | **reescrito** | O Badge do CRM depende das classes `.badge*` de `apps/crm/style.css`, que o Admin não carrega. O do Admin mantém a mesma API (`variant`: `neutral`, `success`, `warning`, `danger`, `info`, `primary`, `outline`; `tone`: `soft`, `solid`; `size`: `sm`, `md`, `lg`) implementada com classes Tailwind sobre os tokens do Admin (`text-success bg-success/10`, etc.). Nas páginas desta fase (Workspaces e Dashboard) substitui os usos de `toneBadgeClass()` e os pills inline de plano; o pill de plano vira `<Badge variant="neutral" style={{ color, backgroundColor }}>` com as cores de `getPlanColor()` (a cor por plano é dado, não enum, então continua via `style`). `toneBadgeClass()` fica em `lib/subscription.ts` para o `WorkspaceDetailPage` até a Fase 2; `PlansPage` não muda nesta fase. |
| `dropdown-menu.tsx` | CRM | Para o menu "Colunas" (checkbox items + radio group de densidade). |
| `checkbox.tsx` | CRM | Usado dentro do dropdown e nos testes. |
| `skeleton.tsx` | CRM | Linhas de carregamento da tabela. |
| `tabs.tsx` | CRM | Cartão "Atenção" em telas estreitas. |
| `label.tsx`, `separator.tsx`, `card.tsx` | CRM | Utilitários de layout. |

Todas as dependências Radix necessárias já estão no `package.json` da raiz. Nenhuma
dependência nova.

Componentes de composição, também novos em `apps/admin/src/components/`:

- `EmptyState.tsx`: ícone, título, descrição e ação opcional.
- `ErrorState.tsx`: mensagem genérica + botão "Tentar novamente" que chama `refetch`.
- `PageHeader.tsx`: título + subtítulo + slot de ações à direita.

## 2. Backend

### 2.1 Migration: `admin_list_workspaces` v5

Nova migration (versão a ser renumerada acima da cauda de `origin/main` na abertura do
PR) que faz `DROP FUNCTION` da assinatura atual e recria com os parâmetros abaixo.
Todos os novos parâmetros têm `DEFAULT NULL`, logo o frontend em produção continua
funcionando entre o `db push` e o deploy.

```sql
admin_list_workspaces(
  p_search        text        DEFAULT NULL,
  p_plan_id       text        DEFAULT NULL,
  p_offset        int         DEFAULT 0,
  p_limit         int         DEFAULT 20,
  p_as_of         timestamptz DEFAULT NULL,
  p_status        text        DEFAULT NULL,  -- grupo, ver 2.2
  p_has_overrides boolean     DEFAULT NULL,  -- true | false | null (todos)
  p_activity      text        DEFAULT NULL,  -- bucket, ver 2.3
  p_created_since timestamptz DEFAULT NULL,  -- created_at >= p_created_since
  p_sort          text        DEFAULT 'created_at',
  p_dir           text        DEFAULT 'desc'
)
```

Regras:

- `p_search` passa a casar também o e-mail do dono (`ILIKE`), não só o nome do workspace.
- `p_sort` é uma whitelist resolvida com `CASE`: `name`, `plan`, `client_count`,
  `member_count`, `created_at`, `last_activity_at`. Valor fora da lista cai em
  `created_at`. `p_dir` aceita `asc` | `desc`; qualquer outro vira `desc`.
  Desempate sempre por `id ASC`. `NULLS LAST` em `last_activity_at`.
- Os filtros de status, overrides e atividade, e a ordenação por qualquer coluna
  calculada, dependem de dados que hoje só existem na CTE `enriched`, que roda
  **depois** da paginação (só sobre as 20–100 linhas da página) com LATERALs por linha.
  Isso muda de lugar: a enriquecimento (assinatura, override, dono, última atividade,
  contagens) passa a rodar sobre **todo** o conjunto filtrado por busca/plano/data
  (`base`), e só então entram os filtros calculados, a ordenação e o `OFFSET/LIMIT`
  (via `row_number()`). Para não multiplicar o custo, `admin_workspace_last_activity`
  é chamada **uma vez** com o array de todos os ids candidatos, em vez de uma vez por
  linha. Os totais (`total`, `total_members`, `total_clients`, `total_with_overrides`)
  passam a ser somas sobre a CTE filtrada.
- `NULLS` em `last_activity_at`: `NULLS FIRST` quando `p_dir = 'asc'` e `NULLS LAST`
  quando `desc`. Assim "menos ativo primeiro" traz os que nunca ativaram no topo, que é
  o que o cartão "Atenção" precisa. As demais colunas ordenáveis não têm nulos
  relevantes (`plan_name` cai no plano default).
- `p_created_since` filtra `created_at >= p_created_since`; combina com o `p_as_of`
  existente (`created_at <= COALESCE(p_as_of, now())`).
- O JSON de `subscription` de cada linha ganha `failed_payment_count` (int) e
  `current_period_end` (timestamptz), lidos de `workspace_subscriptions`.
- Repetir o bloco `REVOKE ... FROM PUBLIC; GRANT EXECUTE ... TO service_role;` da
  migration anterior (o REVOKE FROM PUBLIC também derruba `service_role`).

### 2.2 Grupos de status

| `p_status` | Statuses Stripe/Pagar.me no espelho |
|---|---|
| `ativo` | `active` |
| `teste` | `trialing` |
| `pendente` | `past_due`, `unpaid`, `incomplete` |
| `cancelado` | `canceled`, `incomplete_expired`, `paused` |
| `sem_assinatura` | sem linha em `workspace_subscriptions` **ou** linha com `status IS NULL` |

Esse mapeamento existe em dois lugares e precisa ser mantido em sincronia: no SQL
(`CASE`) e em `apps/admin/src/lib/subscription.ts`, numa função **nova**
`statusGroup(status): WorkspaceStatusGroup`, que a UI usa para rotular e testar.
`statusGroup` é distinta da `statusMeta(status)` que já existe ali (8 statuses →
`{label, tone}` para o badge de status); `statusMeta` continua como está e mantém seus
chamadores e testes.

### 2.3 Buckets de atividade

Sobre `last_activity_at` (já produzido pela RPC) em relação a `now()`:

| `p_activity` | Condição |
|---|---|
| `7d` | `last_activity_at >= now() - interval '7 days'` |
| `30d` | `last_activity_at >= now() - interval '30 days'` |
| `dormente` | `last_activity_at < now() - interval '30 days'` |
| `nunca` | `last_activity_at IS NULL` |

`7d` está contido em `30d` de propósito: são atalhos ("ativo na semana", "ativo no
mês"), não faixas disjuntas.

### 2.4 Edge function `platform-admin`

`list-workspaces.ts` aceita e repassa os novos campos do body (`status`,
`has_overrides`, `activity`, `created_since`, `sort`, `dir`) para a RPC como
`p_*`. Sem validação além do tipo: a whitelist mora no SQL. Sem os campos, o
comportamento é idêntico ao atual.

### 2.5 `apps/admin/src/lib/api.ts`

- `listWorkspaces(params)` ganha os campos opcionais acima, tipados com unions
  (`WorkspaceStatusGroup`, `WorkspaceActivityBucket`, `WorkspaceSortKey`, `'asc' | 'desc'`).
- `SubscriptionSummary` (em `lib/subscription.ts`) ganha `failed_payment_count: number`
  e `current_period_end: string | null`.

## 3. Página de Workspaces

### 3.1 Estado na URL

Módulo puro `apps/admin/src/pages/workspaces-params.ts`:

```ts
interface WorkspacesListParams {
  q: string;                         // busca
  plano: string;                     // plan_id ou ''
  status: WorkspaceStatusGroup | ''; // '' = todos
  overrides: 'sim' | 'nao' | '';     // '' = todos
  atividade: WorkspaceActivityBucket | '';
  criado: '' | '7d' | '30d' | '90d' | '12m';
  ord: WorkspaceSortKey;             // default 'created_at'
  dir: 'asc' | 'desc';               // default 'desc'
  pag: number;                       // 1-based, default 1
  por: 20 | 50 | 100;                // default 20
}

parseWorkspacesParams(searchParams: URLSearchParams): WorkspacesListParams
serializeWorkspacesParams(params: WorkspacesListParams): URLSearchParams
toListWorkspacesRequest(params: WorkspacesListParams, now: Date): Parameters<typeof listWorkspaces>[0]
```

- Valores default **não** aparecem na URL. Valores inválidos (status desconhecido,
  `pag=abc`, `por=37`) caem no default silenciosamente.
- `criado` é convertido em `created_since` absoluto em `toListWorkspacesRequest`,
  usando o `now` injetado (testável).
- Hook `useWorkspacesParams()` em `apps/admin/src/hooks/useWorkspacesParams.ts`
  envolve `useSearchParams` do React Router e expõe `params`, `set(patch)` e `reset()`.
  `reset()` limpa **apenas os campos de filtro** (`q`, `plano`, `status`, `overrides`,
  `atividade`, `criado`) e zera `pag`; nunca toca em `ord`, `dir` ou `por`. É o que
  "Limpar filtros" chama.
  `set` com qualquer chave que não seja `pag`/`ord`/`dir` zera `pag` para 1.
  Alterações de `q` usam `replace: true` (não poluem o histórico); as demais, push.
- A busca é debounced (300 ms) no componente antes de chamar `set`.

### 3.2 Barra de ferramentas

Na ordem, como no mockup:

1. `Input` de busca com ícone, placeholder "Buscar por nome ou e-mail do dono…".
2. `Select` **Plano**: "Todos" + planos de `listPlans()`.
3. `Select` **Status**: Todos, Ativo, Teste, Pagamento pendente, Cancelado, Sem assinatura.
4. `Select` **Overrides**: Todos, Com overrides, Sem overrides.
5. `Select` **Atividade**: Qualquer, Ativo (7 dias), Ativo (30 dias), Dormente (30d+), Nunca ativou.
6. `Select` **Criado**: Qualquer data, Últimos 7 dias, Últimos 30 dias, Últimos 90 dias, Últimos 12 meses.
7. `DropdownMenu` **Colunas** (alinhado à direita): checkbox por coluna ocultável +
   radio de densidade (Confortável, Compacta).
8. `Button` **Exportar CSV** (comportamento atual, agora herdando todos os filtros e
   a ordenação via `toListWorkspacesRequest`).

Um Select com valor diferente do default recebe destaque visual (borda/fundo em
`primary` a 8–55%), como no mockup.

### 3.3 Chips de filtros ativos

Linha abaixo da barra, visível apenas quando há ao menos um filtro ativo (busca conta):
um chip por filtro no formato "Rótulo: valor ×"; clicar no × limpa aquele filtro.
Depois dos chips, link "Limpar filtros" (chama `reset()` preservando `ord`/`dir`/`por`).
À direita, "N resultados" a partir de `data.total`.

### 3.4 Tabela

`Table` shadcn dentro de um `Card`. Colunas, na ordem:

| Coluna | Chave | Ordenável | Ocultável |
|---|---|---|---|
| Workspace (+ badge "overrides") | `name` | sim | **não** |
| Dono (e-mail) | — | não | sim |
| Plano | `plan` | sim | sim |
| Assinatura (badge status + valor) | — | não | sim |
| Clientes | `client_count` | sim | sim |
| Membros | `member_count` | sim | sim |
| Criado em | `created_at` | sim | sim |
| Última atividade | `last_activity_at` | sim | sim |
| → | — | não | não |

- Cabeçalho ordenável: clicar define `ord`; clicar de novo na mesma coluna inverte
  `dir`. Coluna ativa mostra seta (↑/↓) e cor `foreground`; as outras mostram ↕
  apagado no hover. `aria-sort` na `th` ativa.
- Linha inteira navega para `/admin/workspaces/:id` (mantido).
- Densidade: Confortável = `py-3`, Compacta = `py-1.5` e fonte 12px.
- Visibilidade e densidade persistem em `localStorage` sob
  `admin.workspaces.columns` (array de chaves visíveis) e `admin.workspaces.density`.
  Leitura e escrita em `try/catch` com fallback para o default (todas visíveis,
  confortável). Módulo puro `workspaces-columns.ts` com `readColumnPrefs()` /
  `writeColumnPrefs()`.
- Layout mobile (`< md`): mantém o card atual por linha; ignora visibilidade de
  colunas e densidade.

### 3.5 Rodapé

"{início}–{fim} de {total}" à esquerda, `Select` de tamanho de página (20, 50, 100)
ao lado, e paginação à direita: ‹, números (janela de até 5 com o atual no centro,
elipses quando há mais), ›. Some quando `total <= por`. Trocar `por` zera `pag`.

### 3.6 Estados

| Estado | Render |
|---|---|
| Carregando (primeira carga) | 5 linhas de `Skeleton` respeitando as colunas visíveis. |
| Recarregando (troca de filtro) | Tabela anterior com `opacity-60` e `aria-busy` (via `isFetching` e `placeholderData: keepPreviousData` do TanStack Query). |
| Vazio com filtros ativos | `EmptyState` "Nenhum workspace com esses filtros" + "Tente ampliar a busca ou remover um dos filtros ativos." + botão "Limpar filtros". |
| Vazio sem filtros | `EmptyState` "Nenhum workspace cadastrado ainda." sem ação. |
| Erro | `ErrorState` "Não foi possível carregar os workspaces." + "Tentar novamente" (`refetch`). Nunca exibe a mensagem bruta do erro. |

## 4. Dashboard

### 4.1 Novo KPI: "Em risco"

O Dashboard já tem oito tiles de KPI (Workspaces, Total Users, Total Clients, Active
Plans, With Overrides, MRR, Trials, Total MRR). "Em risco" entra logo depois de
"Testes" (ex-Trials), empurrando "MRR total" para o fim: a grade passa a ter nove
tiles e "Em risco" é o oitavo. Os rótulos existentes são traduzidos na seção 5.

Valor = (testes terminando em até 3 dias) + (workspaces com status `pendente`).
Subtítulo: "{a} testes vencendo · {b} pendentes". Cor do valor em `warning` quando
> 0. Enquanto qualquer uma das duas fontes carrega, mostra "—".

Fontes:
- Testes: `getTrials()` já usado na página; filtrar client-side por
  `trial_ends_at` entre `now` e `now + 3 dias` (inclusive), via função pura
  `selectTrialsEndingSoon(trials, now, days = 3)` em `pages/dashboard-risk.ts`,
  ordenada por `trial_ends_at` crescente.
- Pendentes: nova query `listWorkspaces({ status: 'pendente', sort: 'last_activity_at', dir: 'asc', limit: 5 })`.
  O `total` retornado alimenta o KPI; as 5 linhas alimentam o cartão.

### 4.2 Cartão "Atenção"

Posição: logo abaixo dos KPIs, acima de "Workspaces pagantes". Cabeçalho "Atenção"
com `Tabs` (Todos, Testes, Pendentes) à direita; em `>= md` a aba "Todos" mostra os
dois grupos lado a lado e as outras abas filtram; em `< md` só uma aba é visível por
vez e "Todos" empilha.

Grupo esquerdo, **"Testes terminando em até 3 dias"** (badge `warning` com a contagem,
link "ver todos os testes →" para `/admin/workspaces?status=teste`; o rótulo diz
"todos os testes" de propósito, porque a lista não tem filtro de "vencendo em 3 dias"
e mostra todos os `trialing`):
- Linha: nome do workspace; abaixo "Plano · R$ X/mês · {atividade}" onde atividade
  reutiliza `describeActivity()`; à direita "hoje" / "amanhã" / "em N dias" em `warning`.
- Máximo 5 linhas; se houver mais, última linha "+N workspaces".
- Clique na linha → `/admin/workspaces/:id`.

Grupo direito, **"Pagamento pendente"** (badge `danger` com o total, link
"ver todos →" para `/admin/workspaces?status=pendente`):
- Linha: nome; abaixo "Plano · valor · {atividade}"; à direita, se
  `failed_payment_count > 0`, "{n}ª tentativa" em `danger`; senão, se
  `current_period_end` existe, "vence em N dias" / "venceu há N dias"; senão "—".
- Máximo 5 linhas + "+N workspaces" quando `total > 5`.

Quando ambos os grupos estão vazios, o corpo do cartão mostra uma única linha
"Tudo em ordem: nenhum teste vencendo nem pagamento pendente." em `muted-foreground`.
Erro em qualquer uma das fontes mostra `ErrorState` compacto no grupo afetado sem
derrubar o outro.

## 5. Passada de português

Todas as strings visíveis do Admin, em todas as páginas, `AdminLayout`, toasts, títulos
de documento e placeholders. Regras:

- Termos de produto ficam como estão: Dashboard, Workspaces, Admins, Banners, Popups,
  Stripe, MRR, CSV, overrides.
- Nav: "Plans" → "Planos", "Articles" → "Artigos". Os demais itens já estão certos.
- Datas via `toLocaleDateString('pt-BR', …)` e `date-fns` com locale `ptBR`.
- Sem travessão em copy (usar ponto, dois-pontos ou "·").
- Exemplos: "All Plans" → "Todos os planos", "Export CSV" → "Exportar CSV",
  "Exporting…" → "Exportando…", "Nothing to export" → "Nada para exportar",
  "Loading..." → skeleton ou "Carregando…", "No workspaces found." → estado vazio
  da seção 3.6, "Search workspaces..." → "Buscar por nome ou e-mail do dono…",
  "Platform overview" → "Visão geral da plataforma", "Paying Workspaces" →
  "Workspaces pagantes", "Trials" → "Testes", "Recent Workspaces" → "Workspaces
  recentes", "Trial ends" → "Fim do teste", "Last Activity" → "Última atividade".

## 6. Testes

### Vitest (`apps/admin/src/**/__tests__/`)

- `workspaces-params.test.ts`: round-trip parse → serialize → parse para um conjunto
  completo; defaults omitidos da URL; valores inválidos caem no default
  (`status=xyz`, `pag=0`, `pag=abc`, `por=37`, `dir=sideways`); `toListWorkspacesRequest`
  converte `criado` em `created_since` correto dado um `now` fixo e omite campos
  vazios.
- `subscription.test.ts` (estender): `statusGroup()` cobre todos os statuses conhecidos
  e `null`/desconhecido.
- `workspaces-columns.test.ts`: leitura/escrita em `localStorage`, fallback quando o
  storage lança ou contém lixo, coluna `name` nunca removível.
- `dashboard-risk.test.ts`: `selectTrialsEndingSoon` inclui `now` e `now + 3d`
  exatos, exclui `now + 3d + 1ms` e passado, ordena crescente, ignora
  `trial_ends_at: null`; rótulo de prazo ("hoje", "amanhã", "em N dias");
  rótulo de pendência (tentativa vs vence em vs venceu há vs "—").
- `WorkspacesPage.test.tsx` (novo): com `api` mockado e `MemoryRouter` com
  `initialEntries`, verifica que (a) a URL inicial vira a chamada certa a
  `listWorkspaces`; (b) trocar um Select atualiza a URL e zera `pag`; (c) clicar em
  um cabeçalho ordenável define `ord`/`dir` e o segundo clique inverte; (d) chips
  aparecem e o × remove o filtro; (e) estado vazio com filtros mostra "Limpar filtros";
  (f) erro mostra "Tentar novamente" e o clique refaz a chamada; (g) ocultar uma coluna
  remove a `th` e persiste em `localStorage`.
- `DashboardPage.test.tsx` (estender): KPI "Em risco" soma as duas fontes; cartão
  "Atenção" renderiza os dois grupos, o "+N" e o estado "Tudo em ordem".
- Testes existentes que quebram com a mudança de contrato (`workspaces-export`,
  `DashboardPage`) são atualizados, não apagados.

### Deno (`supabase/functions/__tests__/`)

- `platform-admin-list-workspaces_test.ts` (estender): os seis novos campos do body
  chegam à RPC como `p_*`; ausentes viram `null` (ou o default de sort/dir).

### RPC (psql, barrado pelo CI)

`supabase/tests/entitlements/67..69_admin_list_workspaces_*.sql` já cobrem esta RPC
(desempate de dono, desempate de paginação, snapshot `p_as_of`) e rodam no job
`entitlement-tests` via `scripts/test-entitlements.sh`. Esta fase adiciona, no mesmo
padrão (`begin; do $$ ... $$; rollback;`, `set local role service_role`, dados com
prefixo único filtrados por `p_search`):

- `70_admin_list_workspaces_status_filter.sql`: cria workspaces com assinatura
  `active`, `trialing`, `past_due`, `canceled` e sem assinatura; para cada
  `p_status` confere `total` e os ids retornados; `sem_assinatura` inclui o workspace
  sem linha em `workspace_subscriptions` e um com linha de `status IS NULL`;
  `p_status` desconhecido não filtra.
- `71_admin_list_workspaces_sort.sql`: três workspaces com `client_count` 0/2/5 e
  nomes fora de ordem; confere `p_sort='client_count'` asc/desc, `p_sort='name'`
  asc/desc, `p_sort` inválido cai em `created_at desc`, e que `total` não muda com a
  ordenação. Confere também que a paginação por `row_number` não duplica nem perde
  linhas entre `offset 0/limit 2` e `offset 2/limit 2`.
- `72_admin_list_workspaces_activity_overrides.sql`: `p_has_overrides` true/false
  contra um workspace com `workspace_plan_overrides` e outro sem; `p_activity='nunca'`
  contra um workspace recém-criado sem atividade; `p_sort='last_activity_at',
  p_dir='asc'` coloca o `NULL` primeiro; `p_created_since` exclui um workspace com
  `created_at` anterior.
- `73_admin_list_workspaces_owner_email_search.sql`: `p_search` casa pelo e-mail do
  dono (insere um `auth.users` + `workspace_members role='owner'`) e não casa membros
  não-donos.

Os quatro rodam localmente com `npm run test:db` (precisa de Docker) e no CI de
qualquer forma. Os 67..69 existentes têm de continuar passando com a assinatura nova
(eles chamam a RPC positionalmente com 4–5 argumentos, o que segue válido porque os
novos parâmetros têm default).

## 7. Rollout

1. Renumerar a migration acima da cauda de `origin/main` (`git ls-tree origin/main:supabase/migrations | tail`).
2. `npx supabase db push` em **produção** antes do merge (o merge deploya o frontend
   na hora). A RPC nova é retrocompatível com o frontend atual.
3. `npx supabase functions deploy platform-admin --use-api --project-ref <prod>`
   antes do merge. O handler novo é retrocompatível.
4. Merge do PR. Verificar em produção: filtros, ordenação, export, cartão "Atenção".
5. Staging recebe a mesma migration quando o drift atual for resolvido; não bloqueia.

## Riscos e mitigação

- **Deriva dos primitivos copiados.** Aceito. Registrar no `DESIGN_SYSTEM.md` que o
  Admin tem cópias e que correções em um lado devem ser espelhadas no outro.
- **Custo da RPC.** O enriquecimento (contagens, dono, assinatura, última atividade)
  deixa de rodar só sobre a página e passa a rodar sobre todo o conjunto filtrado por
  busca/plano/data. Mitigações: `admin_workspace_last_activity` em uma única chamada
  com o array de ids (hoje é uma por linha); a tabela `workspaces` tem centenas de
  linhas, não milhares; a lista já é paginada e o export já pagina em lotes de 200.
  Sem índice novo nesta fase. Se o tempo da RPC passar de ~1 s em produção, o próximo
  passo é materializar `last_activity_at` numa coluna atualizada por trigger, fora
  desta fase.
- **Primitivos copiados e o stacking do Admin.** `dropdown-menu.tsx` usa `z-[9011]` e
  `select.tsx` `z-[9012]`; o `tooltip.tsx` do Admin usa `z-[9999]`. Todos ficam acima
  da sidebar (`z-50`), então compõem. As classes `animate-in`/`fade-in-0` dos
  primitivos dependem do plugin `tailwindcss-animate`, que não está registrado no
  `tailwind.config.js` da raiz; elas compilam para nada tanto no CRM quanto no Admin.
  Sem transição de abrir/fechar, e sem regressão.
- **Mapeamento de status em dois lugares.** Teste de `statusGroup()` + comentário
  cruzado no SQL e no TS apontando um para o outro.
