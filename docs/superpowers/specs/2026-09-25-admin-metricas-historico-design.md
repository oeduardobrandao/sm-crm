# Admin: histórico de MRR e churn na página Métricas (sub-projeto B)

**Data:** 2026-09-25
**Apps:** `apps/admin`, `supabase/functions/platform-admin`, nova function `metrics-snapshot-cron`, migrations
**Status:** aprovado para plano de implementação
**Antecessor:** `2026-09-24-admin-depositos-design.md` (sub-projeto A, PR #585). O §5 daquela spec
registrou as restrições que esta aqui detalha.

## Contexto

O tile de MRR do Dashboard é calculado ao vivo a partir do espelho `workspace_subscriptions`
(`get-mrr`), e nenhum histórico é guardado: as tabelas de eventos de webhook só têm
`event_id, type, processed_at`. Em prod (2026-09-25) o espelho tem 16 assinaturas Stripe ativas,
9 em trial, 4 canceladas, 8 sem status e 2 trials do Pagar.me; a primeira assinatura é de
2026-06-12 e nenhum workspace é `is_internal`.

B introduz o snapshot diário por workspace, o backfill a partir dos provedores, os gráficos
mensais de MRR/ARR/movimento/churn e os links dos tiles do Dashboard. O funil de trials e o
crescimento (workspaces, usuários, contas do Instagram) ficam para o sub-projeto C.

## Decisões tomadas no brainstorming

| Tema | Escolha |
|---|---|
| Backfill | **Sim**: junho a agosto reconstruídos a partir da Stripe e do Pagar.me, os gráficos nascem com histórico |
| Granularidade dos gráficos | **Mensal** em tudo; o mês corrente aparece como "até hoje". Snapshot guardado por dia |
| `past_due` | Categoria própria, **Inadimplência**; volta como **Recuperado**; vira churn só no cancelamento |
| Onde fica a agregação | TypeScript puro no `platform-admin` (`metrics-logic.ts`), não SQL nem tabela de agregados |
| `is_internal` | Excluído do snapshot e também de `get-mrr` / `get-trials` |
| Troca Stripe → Pagar.me | Nunca é churn: categoria **Troca de provedor** |

## 1. Dados

### Tabela `workspace_subscription_snapshots`

Migration nova (versão acima do fim de `main` no momento do PR). RLS ligada sem policies:
só a service role lê e escreve.

| Coluna | Tipo | Nota |
|---|---|---|
| `workspace_id` | `uuid` not null, FK `workspaces(id)` on delete cascade | |
| `snapshot_date` | `date` not null | Data em America/Sao_Paulo |
| `provider` | `text` not null | `stripe` / `pagarme` |
| `plan_id` | `text` null | mesmo tipo de `plans.id`; sem FK (plano apagado não pode quebrar o histórico) |
| `plan_name` | `text` null | nome do plano no dia, pelo mesmo motivo |
| `status` | `text` not null | status do provedor (`active`, `trialing`, `past_due`, `canceled`, ...) |
| `billing_interval` | `text` null | `month` / `year` (mesmo nome do espelho; `interval` é palavra-chave do Postgres) |
| `monthly_cents` | `integer` not null default 0 | valor normalizado para mês, líquido de cupom |
| `amount_source` | `text` not null | `stripe` / `pagarme` / `catalog` / `backfill` / `unpriced`: os três primeiros são o `amount_source` que `priceSubscriptionRows` já devolve (espelho ou leitura ao vivo aparecem pelo nome do provedor); `null` do helper vira `unpriced` com `monthly_cents = 0` |
| `provider_switch` | `boolean` not null default false | informativo: o marcador de troca estava presente no dia. **A classificação não depende dele** (ver §4) |
| `source` | `text` not null | `cron` / `backfill` |
| `created_at` | `timestamptz` not null default now() | |

`UNIQUE (workspace_id, snapshot_date)` + índice em `snapshot_date`.

Existe uma linha por workspace e dia **somente enquanto o workspace tem assinatura** (qualquer
status, inclusive `trialing` e `past_due`). Linha com `status` nulo no espelho não gera snapshot.
Ausência de linha = não pagante. Workspaces `is_internal` nunca têm linha.

### Tabela `metrics_snapshot_runs` (marcador de conclusão)

| Coluna | Tipo | Nota |
|---|---|---|
| `snapshot_date` | `date` primary key | |
| `source` | `text` not null | `cron` / `backfill` |
| `row_count` | `integer` not null | |
| `completed_at` | `timestamptz` not null default now() | |

RLS ligada sem policies. **Só datas com marcador existem para a leitura.** Linhas de um dia sem
marcador (execução interrompida) são ignoradas, então uma execução parcial nunca vira churn
falso. Um dia com marcador e zero linhas é um fechamento legítimo (ninguém com assinatura).

### RPC `admin_metrics_write_snapshot(p_date date, p_source text, p_rows jsonb)`

Grava o dia inteiro numa transação só:
- `p_source = 'cron'`: apaga todas as linhas daquela data, insere `p_rows` e faz upsert
  do marcador. Rodar de novo no mesmo dia substitui o dia inteiro, inclusive removendo workspace
  que deixou de ter assinatura.
- `p_source = 'backfill'`: se já existe marcador `cron` na data, não grava nada e devolve
  `skipped`; senão faz o mesmo que acima com `source='backfill'`.

Devolve `{ written, skipped }`. Grants, exatamente nesta forma:

```sql
revoke all on function public.admin_metrics_write_snapshot(date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_metrics_write_snapshot(date, text, jsonb)
  to service_role;
```

Os papéis são nomeados porque no Supabase hospedado `anon` e `authenticated` recebem `execute`
explícito na criação, e um `revoke ... from public` sozinho não os remove. O `grant` para
`service_role` é obrigatório: sem ele o banco local e o do CI (que não têm o ACL padrão do
hospedado) negam a chamada, e a function fica dependente de um grant implícito.

## 2. Cron `metrics-snapshot-cron`

Function nova, deploy com `--no-verify-jwt --use-api`.

- Verifica `x-cron-secret` antes de qualquer trabalho; em falha, `reportCronFailure`
  (`_shared/triage.ts`).
- Lê todas as linhas de `workspace_subscriptions` com `status` não nulo (paginado até o fim com
  `fetchAllRows`, como o `get-mrr`), remove os workspaces `is_internal` e precifica com o mesmo
  `priceSubscriptionRows` de `platform-admin/pricing.ts`, registrando `setStripeLoader` igual ao
  `platform-admin/index.ts`. Com isso o MRR do snapshot do dia é o mesmo número do tile.
- **A lista de internos falha fechada aqui.** O `fetchInternalWorkspaceIds` de
  `_shared/internal-workspaces.ts` devolve conjunto vazio em erro (de propósito, para os crons de
  sync); um snapshot gravado com um interno dentro polui o histórico para sempre. Por isso o cron
  e o backfill usam uma variante nova, `fetchInternalWorkspaceIdsOrThrow`, que lança; a execução
  aborta antes do RPC e nenhum marcador é gravado. O `get-mrr` / `get-trials` seguem com a
  variante que falha aberta (são leitura ao vivo, nada fica gravado).
- `monthly_cents` = `toMonthlyCents(interval, amount_cents)` do `_shared/billing-logic.ts`, o
  mesmo usado pelo `aggregateMrr`.
- `provider_switch = switched_from_stripe_subscription_id is not null`. É só informativo: o
  `billing-downgrade-cron` limpa esse marcador quando o cancelamento na Stripe fica seguro, então
  ele some antes do fechamento em boa parte das trocas.
- `snapshot_date` = hoje em America/Sao_Paulo. Grava tudo de uma vez por
  `admin_metrics_write_snapshot(snapshot_date, 'cron', rows)`: sem marcador, o dia não existe para
  a leitura; rodar duas vezes no mesmo dia substitui o dia inteiro.
- Stripe fora do ar: o `priceSubscriptionRows` já cai para espelho/catálogo, e o `amount_source`
  registra de onde veio.
- Agendamento: na mesma migration das tabelas e do RPC, com pg_cron padrão A (`net.http_post` com o `cron_secret` do vault),
  `44 2 * * *` UTC = 23:44 em São Paulo. **O fechamento do dia é definido como o estado às 23:44**
  (hora de São Paulo); o do último dia do mês é o fechamento do mês. O que muda entre 23:44 e a
  meia-noite entra no dia seguinte, o que é irrelevante para uma métrica mensal. Um disparo manual
  durante o dia grava o estado daquele momento e é substituído pela execução das 23:44. Minuto
  escolhido porque às 02:44 UTC só rodam os três jobs de todo minuto em prod (cron.job, 2026-09-25); às 02:47 seriam cinco.

### `get-mrr` e `get-trials`

Passam a excluir `is_internal` com o mesmo helper, para tile e gráfico usarem o mesmo filtro.
Nenhum workspace é interno em prod hoje: os números não mudam.

## 3. Backfill (`backfill-metrics`)

Ação admin nova no `platform-admin`.

- **Guard de ambiente:** sem a secret `METRICS_BACKFILL_ALLOWED=true` responde **403 antes de
  qualquer chamada remota**. Só prod recebe essa secret, porque prod e staging compartilham a conta
  Stripe. Teste da recusa obrigatório (o gateway falso não pode ser chamado).
- **Stripe:** `subscriptions.list({ status: 'all' })` paginado até o fim, ignorando
  `incomplete` e `incomplete_expired`. Mapeamento para workspace por
  `workspace_subscriptions.stripe_customer_id`; sem mapeamento = ignorada e contada.
- **Pagar.me:** lista de assinaturas, mapeada assim, nesta ordem:
  1. o id da assinatura é o `pagarme_subscription_id` do espelho de um workspace W: vai para W,
     **desde que** `metadata.workspace_id` seja vazio ou igual a W; se apontar para outro
     workspace, a assinatura é ignorada e contada como divergente;
  2. senão (assinatura antiga, substituída por outra no espelho), vai para
     `metadata.workspace_id` se esse workspace existir;
  3. senão, ignorada e contada como sem mapeamento.
  O `metadata` é gravado pelo checkout em `pagarme-checkout/gateway.ts`.
- **Meses:** do mês da assinatura mais antiga até o último mês fechado. Para cada fim de mês D
  (último dia do mês), o instante de comparação é **T = D às 23:44 em São Paulo**, o mesmo
  fechamento do cron (Brasil sem horário de verão desde 2019: T = D+1 às 02:44 UTC). Os campos da
  assinatura são timestamps e são comparados com T, nunca com a data D:
  - `start_date > T`: sem linha
  - dentro do trial (`trial_start <= T < trial_end`): `trialing`
  - `ended_at <= T`: sem linha
  - demais casos: `active`
- **Valor:** preço atual da assinatura líquido dos descontos que ela tem hoje, normalizado para
  mês, com `amount_source='backfill'`.
- **Precedência** quando Stripe e Pagar.me dão a mesma chave `(workspace_id, D)`: vence a
  assinatura em vigor em D; se as duas estiverem em vigor, vence o Pagar.me com
  `provider_switch=true`. Regra determinística, independente da ordem de paginação.
- **Idempotência:** cada fim de mês é gravado por
  `admin_metrics_write_snapshot(D, 'backfill', rows)`, que **nunca sobrescreve uma data com
  marcador `cron`** e substitui por inteiro uma data já backfilled. Workspaces `is_internal` ficam
  de fora.
- **Resposta:** `{ months_written, months_kept_cron, rows_written, skipped: { stripe_unmapped,
  pagarme_unmapped, pagarme_divergent } }`.
- Erros de provedor: logados internamente, o cliente recebe mensagem genérica.

**Limites conhecidos** (exibidos como nota nos meses backfilled):
- períodos de inadimplência anteriores a B não são reconstruíveis: contam como `active`;
- mudanças de preço anteriores a B não aparecem: o mês antigo usa o preço de hoje.

## 4. Leitura: `get-metrics-history`

Ação admin somente leitura.

1. Lê `metrics_snapshot_runs` inteira (uma linha por dia, pequena). Fechamento de cada mês =
   a maior `snapshot_date` com marcador naquele mês; se o cron falhou no último dia, vale a data
   com marcador mais recente do mês. O mês corrente usa a mais recente e vem com `closed: false`.
2. **A série de meses é gerada no calendário**, do mês do primeiro marcador até o mês corrente
   em São Paulo, e não a partir das linhas: um mês cujo fechamento tem zero linhas (todos
   cancelaram) aparece com MRR 0 e o churn do mês é calculado normalmente.
3. Mês sem nenhum marcador (cron parado o mês todo) aparece com `missing: true` e valores nulos;
   os movimentos do mês seguinte são calculados contra o último fechamento disponível e vêm com
   `movements_since` indicando esse mês.
4. Lê só as linhas das datas de fechamento e passa para o `metrics-logic.ts` puro.

### Classificação por workspace entre o fechamento anterior e o atual

"Pagante" = `status = 'active'` **e** `monthly_cents > 0`, a mesma elegibilidade do
`aggregateMrr` do `get-mrr` (linha ativa sem preço resolvido não entra em `paying_count` nem no
MRR). MRR = soma de `monthly_cents` dos pagantes.

Cada linha cai em uma de três classes: **pagante** (`active` com valor positivo),
**inadimplente** (`past_due`) e **fora** (sem linha, `active` sem preço, `trialing`,
`canceled`, `unpaid`, `incomplete` ou qualquer outro status).

**Exceção da troca em andamento:** uma linha Pagar.me `trialing` com `provider_switch=true` e
valor positivo conta como **pagante**. Na troca Stripe → Pagar.me o espelho passa a ser a linha
Pagar.me em `trialing` (`pagarme-checkout/logic.ts`) enquanto o cliente continua pagando a Stripe
até o fim do período; sem a exceção, um fechamento no meio da troca gravaria Churn e, no mês
seguinte, Novo. Durante essa janela o marcador ainda existe (o `billing-downgrade-cron` só o limpa
depois do cancelamento na Stripe), então a regra é confiável. Consequência conhecida: nesse
intervalo o gráfico conta o workspace e o tile de MRR ao vivo não (o tile já subconta trocas hoje;
corrigir o tile está fora do escopo). No backfill, a precedência "vence o Pagar.me com
`provider_switch=true`" produz exatamente essa linha.
A tabela cobre as nove combinações, então toda transição tem categoria:

| Anterior | Atual | Categoria |
|---|---|---|
| fora | pagante | **Novo** (inclui trial convertido e reativação de quem estava `canceled`) |
| pagante | pagante, mesmo provedor | **Expansão** / **Contração** pela diferença (zero se igual) |
| pagante | pagante, **provedor diferente** | **Troca de provedor** (só a diferença de valor), com ou sem `provider_switch` |
| pagante | inadimplente | **Inadimplência** (−valor anterior) |
| pagante | fora | **Churn** (−valor anterior) |
| inadimplente | pagante | **Recuperado** (+valor atual) |
| inadimplente | fora | R$ 0 nas barras (o valor já saiu como Inadimplência); conta só no bloco `churn` |
| inadimplente | inadimplente | R$ 0 |
| fora | inadimplente / fora | R$ 0 |

Uma troca com intervalo (Stripe ativa num fechamento, nada no seguinte, Pagar.me ativa depois)
aparece como Churn e depois Novo; isso só acontece se a troca atravessar um fechamento inteiro.

Invariante testada: a soma das sete categorias de `movements` é igual a
`mrr_atual − mrr_anterior`, por construção (cada uma das nove combinações soma exatamente a
diferença do workspace). `movements.churn` é **só** a parte que reconcilia (pagante → fora).

**Bloco `churn`** (separado dos movimentos de propósito, porque mede outra coisa):
- **carteira anterior** = workspaces `active` + `past_due` no fechamento anterior
  (`base_logos`, `base_cents` = soma do `monthly_cents` deles);
- **perdidos** = ativo → saiu **e** `past_due` → saiu (`logos`, `lost_cents` pelo valor da linha
  anterior de cada um);
- `logo_pct` = `logos ÷ base_logos`;
- `revenue_pct` (bruto) = `(lost_cents + |contração|) ÷ base_cents`;
- denominador zero → `null` (exibido como "n/d").

### Resposta

```ts
interface MetricsHistoryResponse {
  generated_at: string;
  first_month: string | null;              // 'YYYY-MM'
  months: MetricsMonth[];                  // ordem cronológica
}
interface MetricsMonth {
  month: string;                           // 'YYYY-MM'
  missing: boolean;                        // true: nenhum marcador no mês, demais campos nulos
  close_date: string | null;               // 'YYYY-MM-DD'
  closed: boolean;
  source: 'backfill' | 'cron' | null;      // de quem é o marcador do fechamento
  mrr_cents: number | null;
  arr_cents: number | null;                // mrr_cents * 12
  paying_count: number | null;
  by_provider: { stripe: number; pagarme: number } | null;
  by_plan: { plan_id: string | null; name: string; mrr_cents: number }[] | null;
  movements_since: string | null;          // mês do fechamento de comparação
  movements: {
    new: number; expansion: number; contraction: number; past_due: number;
    recovered: number; churn: number; switch: number;       // centavos com sinal
  } | null;                                // null no primeiro mês e em mês missing
  churn: {
    logos: number; lost_cents: number; base_logos: number; base_cents: number;
    logo_pct: number | null; revenue_pct: number | null;
  } | null;
}
```

## 5. Frontend (`apps/admin`)

- `lib/api.ts`: `getMetricsHistory()` e `backfillMetrics()` + tipos acima.
- `lib/chartTheme.ts`: lê as variáveis CSS do admin e devolve `hsl(...)` (funciona nos dois
  temas, sem hex; o teste `no-hex-literals` continua passando). Registro explícito de
  controllers, elementos e escalas do Chart.js (`chart.js` e `react-chartjs-2` já são deps).
- `MetricasPage`: duas seções novas acima de Depósitos, cada uma um `Card` com `Skeleton`,
  `ErrorState` com retry e vazio "Histórico começa em <data>":
  - **`#mrr` "Receita recorrente"**: tiles MRR atual, ARR, pagantes, variação vs. mês anterior;
    barras mensais empilhadas de MRR por provedor, com alternância para empilhar por plano.
  - **`#churn` "Movimento e churn"**: barras mensais das categorias (positivas acima de zero:
    novo, expansão, recuperado, troca; negativas abaixo: contração, inadimplência, churn); linha de
    churn % de logos e de receita; tabela compacta com os números.
  - Mês aberto rotulado "Setembro (até hoje)" com preenchimento mais claro; meses backfilled
    trazem os limites conhecidos no tooltip; mês `missing` fica como lacuna com o rótulo
    "Sem dados" e o mês seguinte indica "desde <mês>".
  - Botão "Reconstruir histórico" no cabeçalho da página, com diálogo de confirmação; chama
    `backfill-metrics` e mostra o relatório num toast; 403 vira "Disponível só em produção".
- React Query: `['admin','metrics-history']`, `staleTime` 5 min; o backfill invalida essa chave.
- Dashboard: tiles MRR, Pagantes e MRR projetado viram `Link` para `/admin/metricas#mrr`. Os
  demais esperam o sub-projeto C. A página rola até o hash depois que os dados carregam.
- Copy em português, sem travessão.

## 6. Testes

- **Deno**
  - `metrics-logic`: as nove combinações da tabela de classificação (inclusive `canceled` →
    pagante = Novo e troca de provedor com `provider_switch=false`); invariante de reconciliação; bloco
    `churn` com `past_due` → saiu (R$ 0 nos movimentos, contado em `lost_cents`); denominador zero
    (`null`); primeiro mês sem movimentos; mês com marcador e zero linhas (churn total calculado);
    mês `missing` no meio da série (`movements_since` aponta o mês anterior disponível).
  - backfill: status no fim de mês comparado ao instante T (assinatura que começa ao meio-dia do
    último dia entra; trial que termina antes das 23:44 do último dia já conta como ativo); precedência
    Stripe × Pagar.me nas duas ordens de paginação; os três passos do mapeamento do Pagar.me
    (inclusive divergente); data com marcador `cron` preservada; 403 sem
    `METRICS_BACKFILL_ALLOWED` sem chamar gateway.
  - cron: 401 sem `x-cron-secret`; exclui internos; `amount_source` nulo do helper vira
    `unpriced`; chama o RPC com a data de São Paulo (virada perto da meia-noite UTC).
  - RPC `admin_metrics_write_snapshot` (suíte psql de `supabase/tests/entitlements/`, que o CI
    roda): substituição do dia inteiro no `cron`, `skipped` do `backfill` sobre data `cron`,
    `anon`/`authenticated` sem `execute`.
  - `get-mrr` / `get-trials`: excluem `is_internal`.
- **Vitest**: helpers puros de view (rótulo do mês, séries por provedor/plano, sinais das
  categorias) e estados das seções (carregando, erro, vazio, dados); tiles do Dashboard com o
  `href` certo.

## 7. Implantação e verificação

Ordem (merge implanta o frontend na hora):

1. Staging, nesta ordem:
   1. deploy de `metrics-snapshot-cron` e `platform-admin` **antes** da migration: o deploy não
      precisa das tabelas, e agendar antes do deploy faria uma execução das 02:44 UTC cair numa
      function inexistente e virar alerta de cron (`db push` aplica todas as migrations pendentes
      de uma vez, então separar a migration do agendamento não resolveria);
   2. `db push` da migration (tabelas, RPC e agendamento juntos);
   3. disparo manual do cron; conferir linhas, marcador e `get-metrics-history`.
2. Prod: a mesma sequência, mais `METRICS_BACKFILL_ALLOWED=true` só em prod (definida pelo
   usuário).
3. Merge.
4. Backfill em prod pelo botão.

Âncoras:
- Disparo manual do cron e, logo em seguida, o tile de MRR: mesmo valor, salvo workspaces no meio
  de uma troca de provedor (ver exceção no §4). A comparação só vale
  nesse instante; depois disso o tile é ao vivo e o snapshot é o estado das 23:44, e uma
  diferença é legítima.
- Um mês backfilled == MRR do dashboard da Stripe naquele mês, dentro do arredondamento e dos
  limites conhecidos.

## 8. Fora do escopo

- Funil de trials e crescimento (sub-projeto C).
- Visão diária dos gráficos (os dados diários ficam guardados; dá para somar depois).
- Categoria "Reativação" separada: um workspace que volta após churn conta como Novo.
