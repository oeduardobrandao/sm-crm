# Admin: página Métricas + painel de Depósitos (sub-projeto A)

**Data:** 2026-09-24
**Apps:** `apps/admin`, `supabase/functions/platform-admin`
**Status:** aprovado para plano de implementação

## Contexto

O Dashboard do Admin mostra oito tiles (Workspaces, Usuários, Contas do Instagram, Pagantes, MRR,
Testes, Em risco, MRR projetado) calculados ao vivo a partir de `workspace_subscriptions` pelas
ações `get-mrr`, `get-trials` e `list-workspaces` da function `platform-admin`. O pedido maior é
uma página de métricas com gráficos ao longo do tempo, tiles clicáveis e uma visão clara de
**quando e quanto** a Stripe e o Pagar.me vão depositar na conta bancária.

O trabalho foi decomposto em três sub-projetos, cada um com spec, plano e PR próprios:

| Sub-projeto | Escopo |
|---|---|
| **A (esta spec)** | Painel de Depósitos com leitura ao vivo dos dois provedores + a casca da página `/admin/metricas` |
| B | Fundação de métricas: snapshot diário por workspace, cron, backfill, gráficos de MRR/ARR/churn, tiles do Dashboard viram links |
| C | Funil de trials + crescimento (workspaces, usuários, contas do Instagram) |

## Decisões tomadas no brainstorming

| Tema | Escolha |
|---|---|
| O que "depósito" significa | **Repasses ao banco** por provedor (Stripe payouts, Pagar.me transferências), leitura ao vivo, nada armazenado |
| Histórico dos gráficos (B) | Backfill único a partir dos provedores + snapshots diários dali em diante |
| Clique no tile (B) | Navega para a seção correspondente em `/admin/metricas` (deep-link) |
| Onde fica | Página nova **/admin/metricas**, entrada "Métricas" na sidebar. O Dashboard mantém os tiles |
| Ordem | A → B → C |
| Workspaces `is_internal` (B) | Excluídos em tudo, inclusive `get-mrr`/`get-trials` existentes, no mesmo PR que introduz os snapshots |
| Recebedor Pagar.me | Nova secret `PAGARME_RECIPIENT_ID`; sem ela o cartão mostra "Não configurado" |
| Layout da lista | Próximos 30 dias dia a dia, depois uma linha por mês para o restante do horizonte |
| Valores | **Líquidos** das taxas do provedor (o que cai na conta); bruto e taxa como detalhe secundário |

## Fora de escopo (A)

- Qualquer gráfico ou histórico (B).
- Tiles do Dashboard clicáveis (B).
- Saque manual, antecipação ou qualquer escrita nos provedores.
- Ferramenta MCP para depósitos.
- Persistir dados de repasses.

## 1. Backend: ação `get-deposits` em `platform-admin`

Novo módulo `supabase/functions/platform-admin/deposits.ts`, na mesma disciplina de
`pagarme-detail.ts`: helpers puros (sem env, rede ou Supabase) + portas de gateway injetadas em
`handleGetDeposits(headers, gateways?)`. Registrado com `case "get-deposits"` em
`platform-admin/index.ts`. **Não** é importado por `mcp-admin`.

### 1.1 Gateways (único código de rede; timeout 5s por chamada, `withTimeout` de `pricing.ts` como backstop)

**`StripeDepositsGateway`**, construído sobre `loadStripe()` (cast para um tipo estrutural local;
`null` ⇒ ramo Stripe responde `configured: false`):

| Chamada | Uso |
|---|---|
| `balance.retrieve()` | Entrada `brl` de `available[]` e `pending[]` |
| `payouts.list({ limit: 25 })` | `upcoming` = status `pending` / `in_transit` (`arrival_date`); `recent` = `paid` / `failed` / `canceled` |
| `balanceTransactions.list` (fundos pendentes) | Tenta o filtro `available_on: { gte: now }`; se a API rejeitar, pagina por `created >= now − 40d` e mantém `status === 'pending'`. Agrupa por dia de `available_on`, soma `net`. No Brasil o repasse é automático e diário (doc Stripe), então a chegada ao banco é projetada como `available_on` (próximo dia útil se cair em fim de semana) |
| `accounts.retrieve()` | `settings.payouts.schedule` (`interval`, `delay_days`) só para exibição |

**`PagarmeDepositsGateway`** sobre `pagarmeFetch` (`recipientId` vem de `PAGARME_RECIPIENT_ID`;
ausente ⇒ `configured: false`):

| Chamada | Uso |
|---|---|
| `GET /recipients/{id}/balance` | Saldo disponível / a compensar / transferido. **Nomes de campo a confirmar no sandbox** na implementação: a doc é v4 (`available.amount`, `waiting_funds.amount`); o parser aceita as duas formas |
| `GET /payables?recipient_id=…&status=waiting_funds&size=100` | Paginação com `forward_cursor` (objeto `paging`); o param `page` está descontinuado e não é usado. Líquido por recebível = `amount − fee − anticipation_fee`. Agrupa por dia de `payment_date` |
| `GET /recipients/{id}` | `transfer_settings { transfer_enabled, transfer_interval, transfer_day }` e `automatic_anticipation_settings`. Chegada ao banco por grupo = `projectTransferDate(payment_date, transfer_settings)` |
| `GET /transfers?recipient_id=…&status=pending_transfer,processing` | Em trânsito, com `funding_estimated_date`. O endpoint de withdrawals está descontinuado e não é usado |

`projectTransferDate`: `daily` → o próprio dia (próximo dia útil se fim de semana); `weekly` →
próximo `transfer_day` (1=seg … 5=sex) no dia ou depois; `monthly` → próximo `transfer_day` no
dia ou depois, limitado ao tamanho do mês. Se `transfer_enabled` for `false`, a linha recebe
`manual_withdrawal: true` e a UI mostra "disponível em" no lugar de "deposita em".

Um cartão 12x do Pagar.me gera 12 recebíveis pagos mês a mês, então o horizonte do Pagar.me
chega a um ano.

### 1.2 Helpers puros (testados unitariamente)

`pickBrl`, `groupByDay`, `projectTransferDate`, `projectStripeArrival`,
`splitHorizon(rows, today)` → `{ next30: DayRow[]; byMonth: MonthRow[] }`,
`summarize(stripe, pagarme)` → próximo depósito (data, valor, provedor), total dos próximos 30
dias, total a receber.

### 1.3 Contrato da resposta

`Promise.allSettled` por provedor; um provedor rejeitado vira
`{ configured: true, ok: false, error: 'unavailable' }`, nunca o erro cru.

```ts
interface DepositsResponse {
  generated_at: string;
  summary: {
    next: { date: string; amount_cents: number; provider: 'stripe' | 'pagarme' } | null;
    next_30d_cents: number;
    waiting_cents: number;
  };
  stripe: ProviderDeposits;
  pagarme: ProviderDeposits;
}

interface DayRow {
  date: string;          // dia em que o valor fica disponível (YYYY-MM-DD)
  deposit_on: string;    // dia projetado de chegada ao banco
  net_cents: number;
  gross_cents: number;
  fee_cents: number;
  count: number;
  kind: 'payout' | 'projected';
  manual_withdrawal?: boolean;
}

interface MonthRow { month: string; net_cents: number; gross_cents: number; fee_cents: number; count: number }

interface ProviderDeposits {
  configured: boolean;
  ok: boolean;
  error?: 'unavailable';
  balance: { available_cents: number; pending_cents: number; currency: 'brl' } | null;
  /** Específico do provedor: schedule da Stripe, transfer_settings / anticipation do Pagar.me. */
  meta: Record<string, string | number | boolean | null>;
  upcoming: { next30: DayRow[]; byMonth: MonthRow[] };
  in_transit: { id: string; amount_cents: number; expected_on: string | null; status: string }[];
  recent: { id: string; date: string; amount_cents: number; status: string }[];
}
```

### 1.4 Segurança e configuração

- Gate de admin igual a toda ação do `platform-admin`.
- Nunca devolver corpo de erro dos provedores; logar internamente.
- Secret nova `PAGARME_RECIPIENT_ID` (opcional, sem default), documentada na seção de env do
  CLAUDE.md, ao lado de `PAGARME_DASHBOARD_BASE`.

## 2. Frontend (`apps/admin`)

- `lib/api.ts`: `getDeposits(): Promise<DepositsResponse>` → `adminApi('get-deposits')`, mais os tipos acima.
- Rota `metricas` em `router.tsx` (lazy `pages/MetricasPage.tsx`) e entrada
  `{ to: '/admin/metricas', icon: TrendingUp, label: 'Métricas' }` em `NAV_ITEMS` de
  `layouts/AdminLayout.tsx`. `metricasPath()` em `lib/routes.ts`. O `vercel.json` já reescreve
  `/admin/…` inteiro, nada muda ali.
- `pages/MetricasPage.tsx`: `PageHeader` "Métricas" + seções. Em A só `<DepositsSection />`
  (âncora `#depositos`); B acrescenta as seções de gráficos acima dela.
- `pages/metricas/DepositsSection.tsx` + `pages/metricas/deposits-view.ts` (helpers puros de formatação):
  - React Query `['admin', 'deposits']`, `staleTime` 5 min, botão "Atualizar".
  - Faixa de resumo com três tiles: "Próximo depósito" (data · valor · provedor), "Próximos 30
    dias", "A receber (total)".
  - Um `Card` por provedor (Stripe, Pagar.me): linha de saldo (disponível / a compensar), legenda
    com o schedule ou transfer_settings, tabela "Próximos 30 dias" (deposita em · valor líquido ·
    n itens; bruto e taxa em `Tooltip`), tabela "Meses seguintes", lista "Em trânsito" quando não
    vazia, lista "Recentes" com `Badge` de status.
  - Estados por provedor: `Skeleton` carregando; `ErrorState` com retry quando `ok: false`;
    `EmptyState` "Não configurado" citando a secret quando `configured: false`; "Nada previsto"
    quando as listas estão vazias.
  - Copy em português, sem travessão. Cores só por tokens Tailwind (teste de hex literal).
  - Dinheiro via `formatMoney` de `lib/subscription.ts`.

## 3. Testes

- Deno, `supabase/functions/__tests__/platform-admin-deposits_test.ts`: `pickBrl`, `groupByDay`,
  `projectTransferDate` (daily / weekly / monthly, fim de semana e clamp de fim de mês),
  `splitHorizon` na fronteira do dia 30, `summarize` com um provedor falho, e `handleGetDeposits`
  com gateways falsos (falha parcial ⇒ `ok: false` só naquele provedor, sem vazar corpo de erro;
  recebedor ausente ⇒ `configured: false`).
- Vitest: `apps/admin/src/pages/__tests__/deposits-view.test.ts` (helpers) e
  `apps/admin/src/pages/__tests__/DepositsSection.test.tsx` (carregando / erro / não configurado / dados).
- `AdminLayout.test.tsx` se enumerar itens de navegação.

## 4. Verificação

1. `npm run lint`, `npm run format:check`, os quatro `tsc`, `npm run test`, `npm run check:functions`, `npm run test:functions`.
2. Deploy de `platform-admin` em **staging** (`--use-api`, `--project-ref wlyzhyfondykzpsiqsce`),
   definir `PAGARME_RECIPIENT_ID` (recebedor do sandbox) e confirmar os nomes de campo de balance e
   payables contra a resposta real; ajustar o parser se a forma divergir.
3. `npm run dev:admin:staging`, abrir `/admin/metricas` no Browser pane: os dois cartões renderizam,
   a faixa de resumo bate com os totais dos cartões, o estado de erro aparece ao remover a secret.
4. Conferência de números: "a compensar" da Stripe = saldo pendente no dashboard da Stripe; soma de
   `waiting_funds` do Pagar.me = "a receber" no dashboard do Pagar.me; próximo payout da Stripe
   (data e valor) = o que o dashboard mostra.
5. Prod: deploy da function + secret **antes** do merge (o merge deploya o frontend na hora).

## 5. Restrições registradas para B (a brainstormar depois)

- Snapshot **por workspace e dia** (`workspace_subscription_snapshots`: `workspace_id, snapshot_date,
  provider, plan_id, status, monthly_cents, amount_source, is_trial`, `UNIQUE(workspace_id,
  snapshot_date)`, RLS service-role), no molde de `20260526000000_metrics_daily_snapshots.sql`.
  Agregados (MRR por provedor/plano, ARR, churn de logos e de receita, novo/expansão/contração)
  derivam do diff entre dias consecutivos.
- Consistência no dia zero: o cron precifica com o mesmo `priceSubscriptionRows` do `get-mrr`
  (registrando `setStripeLoader` como o `platform-admin/index.ts`). `mcp-admin/queries.ts` já
  importa do `platform-admin`, então import cruzado é precedente aceito.
- Excluir `is_internal` no snapshot e em `get-mrr`/`get-trials` (`_shared/internal-workspaces.ts`).
- Troca Stripe → Pagar.me **não é churn**: linhas com `switched_from_stripe_subscription_id`
  são classificadas como troca de provedor no backfill e no diff diário.
- Backfill como ação admin idempotente (`backfill-metrics`, linhas de fim de mês, upsert em
  `(workspace_id, snapshot_date)`), nunca script local com chave. Stripe:
  `subscriptions.list({ status: 'all' })` mapeado por `stripe_customer_id`, excluindo `incomplete*`;
  Pagar.me: lista de assinaturas com `start_at` / `canceled_at`. Prod e staging compartilham a
  conta Stripe: backfill só contra prod.
- Cron pg_cron padrão A (`net.http_post` com `cron_secret` do vault, checagem `x-cron-secret`,
  `reportCronFailure`), em minuto livre segundo `20260925110001_stagger_cron_schedules.sql`.
- Frontend: Chart.js no `apps/admin` com um `chartTheme.ts` próprio que envolve os triplets HSL em
  `hsl(...)`; registro explícito de controllers; tiles do Dashboard viram `Link` para
  `/admin/metricas#<seção>`.
- Âncora de verificação: MRR do snapshot do dia zero == tile de MRR; um mês backfilled == MRR do
  dashboard da Stripe dentro do arredondamento.
