# Pagar.me no Admin: paridade com a Stripe

**Data:** 2026-09-05
**Apps:** `apps/admin`, `supabase/functions/platform-admin`, migration da RPC `admin_list_workspaces`
**Status:** aprovado para plano de implementação

## Objetivo

Dar às assinaturas Pagar.me (plano anual em 12x) o mesmo tratamento que as assinaturas
Stripe já têm no Admin: link direto para o painel do provedor, leitura ao vivo ao abrir o
workspace, e nomes de provedor corretos na lista e no detalhe. Hoje a linha Pagar.me só
mostra o espelho local (`workspace_subscriptions`), sem link e sem nenhuma consulta ao
gateway; a lista não diz qual provedor cobra o cliente.

## Estado atual (o que já existe)

- O cartão "Assinatura Pagar.me" no detalhe do workspace mostra status, plano, valor com
  sufixo "12x" e data de renovação, tudo lido do espelho. O comentário em
  `buildSubscriptionDetail` registra "no dashboard URL in v1".
- MRR, Trials e o export do Dashboard já consideram linhas Pagar.me (`amount_source`
  `'pagarme'`). Nada muda ali.
- A página Plans já tem o toggle 12x, o id do plano anual Pagar.me e o preço da parcela.
- A lista de Workspaces (revamp fase 1, PR #460) já chama a coluna de "Assinatura" e não
  usa mais a palavra Stripe. A célula mostra badge de status + valor, sem provedor.
- A leitura `GET /subscriptions/{id}` já existe como port no `pagarme-webhook/gateway.ts`;
  `normalizePagarmeStatus` e `mapPagarmeTemporalFields` vivem em `_shared/pagarme-logic.ts`.

## Decisões tomadas no brainstorming

| Decisão | Escolha |
|---|---|
| Escopo | **Paridade completa** (opção B): link + leitura ao vivo + labels. |
| O que a leitura ao vivo faz com o espelho | **Só exibe.** Nunca grava de volta. Divergência vira um aviso visível no cartão. A propriedade do espelho continua com checkout, webhook e cron de downgrade. |
| Link para o painel | Base por ambiente em secret `PAGARME_DASHBOARD_BASE`; sem a secret o link some. Padrão confirmado pelo usuário: `https://dash.pagar.me/{merch}/{acc}/subscriptions/{sub_id}/info`. |
| Progresso de parcelas | **Não existe.** O 12x é uma única cobrança anual que a bandeira parcela; o Pagar.me não acompanha "parcela N de 12". Em vez disso, mostrar o cartão (bandeira, últimos 4, validade). |
| Provedor na lista | **Incluído.** Nova versão da RPC `admin_list_workspaces` expõe `provider` no JSON da assinatura; a célula ganha uma legenda "Stripe" ou "Pagar.me"; o CSV ganha a coluna "Provedor". |
| Ferramenta MCP `get_workspace` (`readOnly`) | Continua lendo só o espelho: **nenhuma** chamada ao Pagar.me e sem link. Mesmo gate do Stripe. |

## Fora de escopo

- Botão "Sincronizar" ou qualquer reconcile disparado pelo Admin (candidato a follow-up
  se a divergência aparecer na prática).
- Histórico de cobranças/ciclos do Pagar.me no Admin.
- Cancelar ou trocar cartão pelo Admin.
- Mudanças em Dashboard, MRR e Trials.

## 1. Backend: módulo puro `platform-admin/pagarme-detail.ts`

Novo módulo sem rede, env ou Supabase, no padrão de `pricing.ts` e `_shared/pagarme-logic.ts`.

### Tipos

```ts
export interface PagarmeRemoteSubscription {
  id: string;
  status: string;                       // 'future' | 'active' | 'canceled' | 'failed' | outro
  start_at?: string | null;
  next_billing_at?: string | null;
  canceled_at?: string | null;
  current_cycle?: {
    start_at?: string | null;
    end_at?: string | null;
    billing_at?: string | null;
    status?: string | null;
  } | null;
  card?: {
    brand?: string | null;
    first_six_digits?: string | null;
    last_four_digits?: string | null;
    /** Único campo de número que o exemplo oficial mostra na assinatura, ex. "424242******4242". */
    masked_number?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
  } | null;
}

export interface PagarmeLiveCard {
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
}

export interface PagarmeDrift {
  /** Presente só quando o status normalizado ao vivo difere do espelho. */
  status: { mirror: string | null; live: string } | null;
  /** Presente só quando o fim de período ao vivo difere do espelho (granularidade de dia). */
  period: { mirror: string | null; live: string } | null;
}

export interface PagarmeLive {
  /** Status normalizado (mesma tabela do webhook); null quando o status remoto é desconhecido. */
  status: 'trialing' | 'active' | 'canceled' | null;
  remote_status: string;
  /** Próxima cobrança: active = next_billing_at ?? current_cycle.billing_at; future = start_at; senão null. */
  next_billing_at: string | null;
  start_at: string | null;
  canceled_at: string | null;
  card: PagarmeLiveCard | null;
  /** null quando nada diverge. */
  drift: PagarmeDrift | null;
}

export interface PagarmeDetailGateway {
  fetchSubscription(subId: string): Promise<PagarmeRemoteSubscription>;
}
```

### Funções

- `pagarmeDashboardUrl(base: string | null | undefined, subId: string): string | null`
  - Retorna `null` se `base` for vazio, não começar com `https://`, ou `subId` for vazio.
  - Remove barras finais da base e monta `${base}/subscriptions/${encodeURIComponent(subId)}/info`.
- `buildPagarmeLive(remote, mirror: { status: string | null; current_period_end: string | null }): PagarmeLive`
  - `status` via `normalizePagarmeStatus(remote.status)`.
  - `next_billing_at` conforme a regra do tipo acima.
  - `card` mapeado campo a campo; `null` quando `remote.card` é ausente. **Shape do cartão
    não validado no repo** (nenhum caller lê o cartão de volta hoje): o exemplo oficial de
    resposta de assinatura mostra `card` no topo com `holder_name`, `masked_number`,
    `exp_month`, `exp_year`, `status`, sem `brand` nem `last_four_digits`. Por isso o mapper é
    defensivo: `last4 = last_four_digits ?? últimos 4 dígitos de masked_number`, `brand`
    fica `null` quando ausente (a UI mostra só `•••• 4242 · 12/28`). A verificação manual
    em staging (seção 7) precisa confirmar valores reais renderizados; "—" com assinatura
    ativa é sinal de shape errado e bloqueia o merge até ajustar o mapper.
  - `drift` conforme as regras abaixo.
- `createPagarmeDetailGateway(): PagarmeDetailGateway`
  - Port fino sobre `pagarmeFetch<PagarmeRemoteSubscription>("GET", "/subscriptions/{id}")`,
    igual ao do webhook. Fica no mesmo arquivo para não espalhar mais um `gateway.ts`; o
    módulo continua importável em teste porque `_shared/pagarme.ts` só exige a secret dentro
    de `pagarmeFetch`.

### Regras de divergência (drift)

Codificam conhecimento de billing já fixado pelo webhook; os testes as pinam.

1. **Status.** Divergência quando `normalizePagarmeStatus(remote.status)` é não-nulo e difere
   de `mirror.status`. Exceção: espelho `past_due` com remoto `active` **não** é divergência.
   O episódio de dunning é verdade local (regra 2 de `buildReconcileColumns`): só
   `charge.paid` fecha o episódio, então um `active` remoto durante o dunning é esperado.
   Status remoto desconhecido (normalizado `null`) nunca gera divergência; só é exibido.
2. **Período.** Compara `mapPagarmeTemporalFields(remote).current_period_end` com
   `mirror.current_period_end` como instantes: só é divergência quando a diferença absoluta
   passa de 24 horas. O Pagar.me devolve `start_at` como data pura e o espelho guarda
   timestamp; uma tolerância de um dia absorve qualquer deslocamento de fuso, e uma
   mudança real de período é sempre de um mês ou um ano. Valor imparsável de um dos lados
   conta como diferente.
3. **Período remoto `null` nunca é divergência.** `mapPagarmeTemporalFields` devolve `null`
   para qualquer status que não seja `future`/`active` (isto é, `canceled` **e** `failed`,
   que a regra 1 normaliza para o mesmo `canceled`) e também para `active`/`future` sem
   datas. Em todos esses casos o espelho retém o `current_period_end` de propósito
   (`isPaidThrough` depende disso) e não há como julgar. A regra é sobre o período mapeado,
   não sobre a string bruta de status.
4. Ambos `null` (espelho e remoto) não é divergência. Espelho `null` com remoto preenchido é.

## 2. Backend: `workspace-detail.ts`

`buildSubscriptionDetail(svc, workspaceId, opts)` ganha em `opts` um campo opcional
`pagarme?: PagarmeDetailGateway` (default `createPagarmeDetailGateway()`), para injeção em
teste, e o objeto `info` ganha três campos, presentes em **toda** resposta (também nas
linhas Stripe, como `null`/`false`):

```ts
pagarme_dashboard_url: string | null;
pagarme_live: PagarmeLive | null;
pagarme_live_error: boolean;
```

Fluxo do ramo Pagar.me (reestruturado para que os dois caminhos de valor, espelho e
catálogo, passem pela etapa ao vivo):

1. Preenche valor/moeda/intervalo do espelho; se `amount_cents` for `null`, aplica
   `applyCatalogFallback` (comportamento atual, inalterado).
2. Se `opts.readOnly` ou `row.pagarme_subscription_id` vazio: retorna sem link e sem
   leitura ao vivo (comportamento atual do MCP e de linhas ainda não vinculadas).
3. `pagarme_dashboard_url = pagarmeDashboardUrl(Deno.env.get("PAGARME_DASHBOARD_BASE"), id)`.
   Independe do resultado da leitura: o link funciona com a API fora do ar.
4. `try { remote = await gateway.fetchSubscription(id); info.pagarme_live = buildPagarmeLive(remote, { status: row.status, current_period_end: row.current_period_end }) }`
   `catch { info.pagarme_live_error = true; console.error("[platform-admin] pagarme fetch failed:", (err as Error).message) }`.
   O timeout de 5 s já vem de `pagarmeFetch`. Nenhum detalhe do erro vai ao cliente.
5. **Nenhuma escrita** em `workspace_subscriptions` neste ramo, em nenhum caso.

Import de `_shared/pagarme.ts` é estático: o módulo não lê env no import e não depende de
npm, então não reproduz a quebra do bundler `--use-api` que motivou o `stripe-loader.ts`.
O `mcp-admin` continua importando `workspace-detail.ts` e nunca chega ao passo 3 por causa
do `readOnly`.

### Variável de ambiente

`PAGARME_DASHBOARD_BASE`: prefixo do painel Pagar.me até a conta, ex.
`https://dash.pagar.me/merch_xxx/acc_yyy`. Opcional, sem default; quando ausente ou
inválida o link é omitido. Valores diferentes em prod (conta live) e staging (conta
sandbox). Documentar em `CLAUDE.md` junto das outras `PAGARME_*` **e** acrescentar ao
bloco Pagar.me de `.env.example` (regra do `AGENTS.md`: os templates `*.example` são
atualizados a cada variável nova). `.env.e2e.local.example` não muda: a variável não entra
no E2E.

## 3. Contrato do frontend (`apps/admin/src/lib/subscription.ts`)

- `SubscriptionInfo` ganha `pagarme_dashboard_url`, `pagarme_live` e `pagarme_live_error`
  com os tipos da seção 1 (espelhados em TS do Admin; os dois apps não compartilham código).
- `SubscriptionSummary` ganha `provider: 'stripe' | 'pagarme' | null`. `null` tolera um
  payload da RPC anterior à migration (a legenda simplesmente não aparece).
- Novo helper puro `providerLabel(provider): string` retornando `'Stripe'` ou `'Pagar.me'`
  (`'Stripe'` para `null`/desconhecido, que é o default da coluna no banco).

## 4. Frontend: detalhe do workspace (`WorkspaceDetailPage.tsx`)

Cartão "Assinatura Pagar.me":

- **Link no cabeçalho.** "Abrir no Pagar.me" com `ExternalLink`, quando
  `pagarme_dashboard_url` existir, passando por `sanitizeExternalUrl` como o link Stripe.
- **Campos novos** no grid, só para `provider === 'pagarme'` e quando `pagarme_live` existir:
  - "Cartão": `formatCard(card)` → `Visa •••• 4242 · 12/28`; partes ausentes são omitidas;
    cartão ausente mostra "—".
  - "Próxima cobrança": `pagarme_live.next_billing_at` formatado em pt-BR; "—" se `null`.
- **Aviso de divergência** abaixo do grid, tom `warning`, título "Espelho desatualizado" e
  uma linha por campo divergente, ex.: "Status: espelho Ativo, Pagar.me Cancelado" e
  "Período: espelho 03/09/2026, Pagar.me 03/09/2027". Usa `statusMeta` para os rótulos.
- **Falha na leitura** (`pagarme_live_error`): nota discreta "Sem resposta do Pagar.me,
  exibindo o espelho local." Os campos do espelho continuam como hoje.
- **Copy corrigida** para os dois provedores: "Sem assinatura Stripe." vira "Sem assinatura."
  e a nota de comp passa a dizer "assinatura real do cliente no {providerLabel}".

Os helpers `formatCard`, `describeDrift(drift)` e a formatação de data ficam em
`apps/admin/src/pages/workspace-subscription.ts` (padrão de `plan-form.ts` e
`workspace-events.ts`), sem JSX, para teste unitário sem renderizar a página. Formatos:
bandeira com inicial maiúscula (`visa` → `Visa`), últimos 4 precedidos de `••••`, validade
`MM/AA` (mês com dois dígitos, ano com os dois últimos), separador ` · `; datas em
`dd/MM/yyyy` via `date-fns`.

## 5. Frontend: lista de Workspaces e CSV

- **Migration** `20260910000001_admin_list_workspaces_provider.sql` (prefixo a reconferir
  contra `git ls-tree origin/main:supabase/migrations | tail` na abertura do PR): `CREATE OR
  REPLACE FUNCTION admin_list_workspaces(...)` com o corpo da v5 (`20260909000001`) copiado
  na íntegra e **uma** chave a mais no `sub_json`: `'provider', s.provider`. Mesma assinatura,
  mesmos `REVOKE`/`GRANT` (service_role apenas).
- **`WorkspacesTable.tsx`, `SubscriptionCell`:** depois do valor, legenda
  `providerLabel(ws.subscription.provider)` em texto pequeno e discreto
  (`text-[0.65rem] uppercase tracking-wider text-dim-foreground`), só quando `provider`
  não for `null`.
- **`workspaces-export.ts`:** nova coluna `{ key: 'provider', label: 'Provedor' }` logo após
  "Status da assinatura", valor `providerLabel(provider)` quando há assinatura **e**
  `provider` não é `null`; vazio nos demais casos (mesma regra da legenda na lista).
  Atualizar `workspaces-export.test.ts` (mudança de contrato).

## 6. Segurança e falhas

- Nenhum corpo de erro do Pagar.me chega ao cliente; só o booleano `pagarme_live_error`.
- Timeout de 5 s por chamada (já em `pagarmeFetch`); pior caso o detalhe demora 5 s a mais,
  igual ao caminho Stripe.
- URL do painel validada no servidor (`https://` obrigatório) e sanitizada no cliente.
- `readOnly` (MCP) nunca faz chamada externa nem expõe o link.
- A RPC nova mantém `SECURITY DEFINER` + `search_path = public` + execução só por
  `service_role`.

## 7. Testes

**Deno (`supabase/functions/__tests__/`)**

- `platform-admin-pagarme-detail_test.ts` (puro):
  - URL: base normal, base com barra final, base `http://`, base ausente, `subId` com
    caractere especial.
  - `buildPagarmeLive`: `future` → `trialing` com `next_billing_at = start_at`; `active` com
    e sem `current_cycle`; `canceled`/`failed`; status desconhecido → `status: null` sem
    drift; cartão ausente → `card: null`.
  - Drift: status igual → `null`; status diferente; exceção `past_due` × `active`; período
    igual em instantes diferentes do mesmo dia; período em dias diferentes; cancelado sem
    ciclo com espelho preenchido → sem drift de período.
- `platform-admin-workspace-detail_test.ts` (integração com `svc` fake, no padrão do
  fake db de `mcp-admin-platform_test.ts`, e gateway fake injetado):
  - Linha Pagar.me com id: gateway chamado **uma** vez, `pagarme_live` preenchido, link
    presente quando o env está setado, **zero** `update` em `workspace_subscriptions`.
  - Gateway lança: `pagarme_live = null`, `pagarme_live_error = true`, valor do espelho
    intacto, link presente.
  - `readOnly: true`: gateway **não** chamado, link `null`.
  - Linha Pagar.me sem `amount_cents`: catálogo aplicado **e** leitura ao vivo feita.
  - Linha Stripe: os três campos novos vêm `null`/`false` e o caminho Stripe não muda.

**Vitest (`apps/admin`)**

- `lib/__tests__/subscription.test.ts`: `providerLabel`.
- `pages/__tests__/workspace-subscription.test.ts`: `formatCard` (completo, sem validade, sem
  bandeira, `null`), `describeDrift` (só status, só período, ambos, `null`).
- `pages/__tests__/workspaces-export.test.ts`: coluna "Provedor" com e sem assinatura.
- `pages/__tests__/WorkspacesTable.test.tsx`: legenda "Pagar.me"/"Stripe" na célula e
  ausência de legenda quando `provider` é `null`.

**Verificação manual** com o Admin em `dev:admin:staging` contra a conta sandbox (que tem
assinaturas e cartões reais de teste): link abre a assinatura certa, campos ao vivo
aparecem **com valores reais** (o campo "Cartão" precisa mostrar últimos 4 e validade de um
cartão de teste, nunca "—", e "Próxima cobrança" uma data; "—" numa assinatura ativa
indica shape errado da resposta e bloqueia o merge até corrigir o mapper), e a nota de
falha aparece ao remover temporariamente a secret. Confirmar também que `get_workspace` do
`mcp-admin` continua sem chamada externa (teste Deno cobre).

## 8. Rollout

Ordem obrigatória (o merge faz deploy do frontend na hora; ver incidente #434):

1. `supabase db push` da migration em **staging e prod** (a RPC nova é compatível com o
   frontend atual: só adiciona uma chave).
2. `supabase secrets set PAGARME_DASHBOARD_BASE=...` em staging (conta sandbox) e prod
   (conta live), via arquivo, nunca como argumento literal.
3. Deploy de `platform-admin` nos dois ambientes com `--no-verify-jwt --use-api`. O
   `mcp-admin` importa `workspace-detail.ts`; redeployar também para manter o bundle
   coerente, ainda que o comportamento dele não mude.
4. Merge do PR (frontend). O frontend é null-safe nos campos novos, então a ordem 3 → 4 só
   evita uma janela sem link.
5. Atualizar `CLAUDE.md` e `.env.example` (variável nova) no mesmo PR.
