# Switch seamless mensal Stripe → anual 12x Pagar.me — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assinante mensal Stripe (active/trialing) troca para o anual 12x Pagar.me sem gap de acesso, sem cobrança dupla e sem novo trial, com undo durante a janela.

**Architecture:** `pagarme-checkout` ganha modo `switch: true` que verifica o mensal remotamente na Stripe, cria a subscription Pagar.me com `start_at` = fronteira ceiled, flipa a linha num CAS único (provider + mirror + markers) e cancela a Stripe com `cancel_at_period_end` (falha → rollback completo em-request). O undo em `pagarme-subscription` reativa a Stripe e devolve a linha. Um leg novo do `billing-downgrade-cron` (rotação justa) é o backstop durável. Spec: `docs/superpowers/specs/2026-08-14-stripe-pagarme-switch-design.md` — leia antes de qualquer task.

**Tech Stack:** Deno edge functions (Supabase), Stripe SDK `npm:stripe@17`, Pagar.me v5 via `_shared/pagarme.ts`, React 19 + TanStack Query (CRM), Vitest + `deno test`.

## Global Constraints

- Copy PT-BR voltada ao usuário NUNCA usa travessão (em-dash). Ponto, dois-pontos ou "·".
- Flip de provider + amount-mirror + markers sempre no MESMO statement UPDATE, com CAS no provider/id observados. Nunca em writes separados.
- `canWebhookWrite` e o comportamento dos webhooks NÃO mudam nesta feature.
- Mirror = total observado do gateway; nunca o preço da tabela quando o observado existe.
- Sem novo trial: switch nunca chama `resolveTrialDays`.
- Todo I/O remoto/DB em handler com estado é bounded: DB `AbortSignal.timeout(10_000)`, Stripe `{ timeout: 10_000 }` por chamada.
- Dados de cartão (token, document, address) nunca aparecem em logs, banco ou PostHog.
- Edge functions: erros para o cliente são mensagens genéricas fixas; detalhe só no log.
- Depois de QUALQUER `deno test` ou deploy de function: `git checkout -- deno.lock` e, antes de confiar em prettier/tsc locais, `npm ci` (deno polui node_modules).
- Migration: prefixo de versão único, ACIMA do tail de `git ls-tree origin/main:supabase/migrations` no momento do `gh pr create` (re-verificar ao abrir o PR).
- Commits frequentes, um por task no mínimo. Branch: `claude/stripe-pagarme-upgrade-flow-12c154` (worktree `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/stripe-pagarme-upgrade-flow-12c154`). Rode `pwd` e `git branch --show-current` antes do primeiro commit.
- Testes Deno: `deno test supabase/functions/__tests__/<arquivo>` (depois `git checkout -- deno.lock`). Vitest: `npx vitest run <caminho>` a partir da raiz do worktree.

---

### Task 1: Migration dos markers + quarentena

**Files:**
- Create: `supabase/migrations/20260816000001_switch_from_stripe_marker.sql`

**Interfaces:**
- Produces: colunas `workspace_subscriptions.switched_from_stripe_subscription_id text`, `switched_from_plan_id text`, `switch_checked_at timestamptz`; estado `'quarantined'` no check de `pagarme_checkout_attempts.state`; índice único parcial `one_blocking_attempt_per_workspace (workspace_id) where state in ('pending','quarantined')` substituindo `one_pending_attempt_per_workspace`.

- [ ] **Step 1: Confirmar premissas da migration**

Run:
```bash
git ls-tree origin/main:supabase/migrations | tail -3
```
Expected: último prefixo ≤ `20260815...`. Se houver prefixo ≥ `20260816000001`, renumere o arquivo acima do tail.

Run:
```bash
grep -n "check\|one_pending" supabase/migrations/20260812000001_pagarme_provider.sql
```
Expected: o CHECK de `state` é inline sem nome (Postgres auto-nomeia `pagarme_checkout_attempts_state_check`) e o índice se chama `one_pending_attempt_per_workspace`. Se os nomes diferirem, ajuste o SQL do Step 2.

- [ ] **Step 2: Escrever a migration**

```sql
-- Switch seamless mensal Stripe -> anual 12x Pagar.me (spec 2026-08-14).

-- 1) Markers do switch + bookkeeping de rotacao do leg D do billing-downgrade-cron.
alter table workspace_subscriptions
  add column switched_from_stripe_subscription_id text,
  add column switched_from_plan_id text,
  add column switch_checked_at timestamptz;

comment on column workspace_subscriptions.switched_from_stripe_subscription_id is
  'Non-null = 12x Pagar.me vinculado por switch a partir deste mensal Stripe. O cron (leg D) confirma o cancel_at_period_end remoto e limpa quando seguro; enquanto a linha esta trialing tambem habilita o undo e o estado "Troca agendada" no frontend.';
comment on column workspace_subscriptions.switched_from_plan_id is
  'Plano-fonte no momento do switch. O undo restaura plan_id daqui: precos Stripe legados nao sao resolviveis via resolvePlanFromPriceId.';
comment on column workspace_subscriptions.switch_checked_at is
  'Bookkeeping do leg D (rotacao justa da fila de markers). Fora dos statements de invariante.';

create index workspace_subscriptions_switch_marker
  on workspace_subscriptions (switch_checked_at, workspace_id)
  where switched_from_stripe_subscription_id is not null;

-- 2) Estado quarantined nas attempts (born-active do switch; decisao 10 do spec).
alter table pagarme_checkout_attempts
  drop constraint pagarme_checkout_attempts_state_check;
alter table pagarme_checkout_attempts
  add constraint pagarme_checkout_attempts_state_check
  check (state in ('pending','succeeded','failed','expired','quarantined'));

-- 3) Garantia atomica da quarentena: o indice so-pending deixa um INSERT concorrente
-- entrar no exato instante em que a attempt sai de pending para quarantined.
drop index one_pending_attempt_per_workspace;
create unique index one_blocking_attempt_per_workspace
  on pagarme_checkout_attempts (workspace_id)
  where state in ('pending','quarantined');
```

- [ ] **Step 3: Guard de versão local**

Run:
```bash
ls supabase/migrations | grep -o '^[0-9]*' | sort | uniq -d
```
Expected: saída vazia (nenhum prefixo duplicado).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260816000001_switch_from_stripe_marker.sql
git commit -m "feat(billing): migration dos markers do switch + estado quarantined"
```

---

### Task 2: `_shared/stripe-switch.ts` (gateway Stripe injetável + assessment puro)

**Files:**
- Create: `supabase/functions/_shared/stripe-switch.ts`
- Test: `supabase/functions/__tests__/stripe-switch_test.ts`

**Interfaces:**
- Consumes: `fetchStripeAmount`, `StripeAmount` de `../_shared/stripe-amount.ts` (existentes).
- Produces (usados pelas Tasks 5-7, 10-12):
  - `STRIPE_SWITCH_TIMEOUT_MS = 10_000`
  - `type StripeSourceAssessment = { ok: true; status: "active" | "trialing"; periodEnd: Date; cancelAtPeriodEnd: boolean; priceId: string | null } | { ok: false; code: "not_in_force" | "not_monthly" | "boundary_elapsed" | "malformed" }`
  - `assessStripeSourceSub(sub: unknown, now: Date): StripeSourceAssessment`
  - `readStripeSubSnapshot(sub: unknown): { status: string | null; cancelAtPeriodEnd: boolean; periodEndMs: number | null }`
  - `isStripeNotFoundError(e: unknown): boolean`
  - `interface StripeSwitchGateway { retrieveSubscription(id: string): Promise<unknown>; setCancelAtPeriodEnd(id: string, value: boolean): Promise<void>; cancelNow(id: string): Promise<void>; fetchAmount(id: string): Promise<StripeAmount> }`
  - `createStripeSwitchGateway(secretKey: string): StripeSwitchGateway`

- [ ] **Step 1: Escrever os testes (falhando)**

Crie `supabase/functions/__tests__/stripe-switch_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import {
  assessStripeSourceSub,
  isStripeNotFoundError,
  readStripeSubSnapshot,
} from "../_shared/stripe-switch.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");
// Stripe usa unix SEGUNDOS.
const FUTURE_END = Math.floor(Date.parse("2026-09-15T14:23:11Z") / 1000);
const PAST_END = Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000);

function monthlySub(overrides: Record<string, unknown> = {}) {
  return {
    status: "active",
    cancel_at_period_end: false,
    current_period_end: FUTURE_END,
    items: { data: [{ price: { id: "price_m1", recurring: { interval: "month" } } }] },
    ...overrides,
  };
}

Deno.test("assess: mensal active ok, com periodEnd e priceId", () => {
  const r = assessStripeSourceSub(monthlySub(), NOW);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.status, "active");
    assertEquals(r.periodEnd.toISOString(), "2026-09-15T14:23:11.000Z");
    assertEquals(r.cancelAtPeriodEnd, false);
    assertEquals(r.priceId, "price_m1");
  }
});

Deno.test("assess: trialing ok", () => {
  const r = assessStripeSourceSub(monthlySub({ status: "trialing" }), NOW);
  assert(r.ok && r.status === "trialing");
});

Deno.test("assess: cancel_at_period_end=true continua elegivel (decisao 7)", () => {
  const r = assessStripeSourceSub(monthlySub({ cancel_at_period_end: true }), NOW);
  assert(r.ok);
  if (r.ok) assertEquals(r.cancelAtPeriodEnd, true);
});

Deno.test("assess: anual -> not_monthly", () => {
  const r = assessStripeSourceSub(
    monthlySub({ items: { data: [{ price: { id: "p", recurring: { interval: "year" } } }] } }),
    NOW,
  );
  assert(!r.ok && r.code === "not_monthly");
});

Deno.test("assess: past_due/canceled/unpaid -> not_in_force", () => {
  for (const status of ["past_due", "canceled", "unpaid", "incomplete"]) {
    const r = assessStripeSourceSub(monthlySub({ status }), NOW);
    assert(!r.ok && r.code === "not_in_force", `status ${status}`);
  }
});

Deno.test("assess: fronteira passada -> boundary_elapsed", () => {
  const r = assessStripeSourceSub(monthlySub({ current_period_end: PAST_END }), NOW);
  assert(!r.ok && r.code === "boundary_elapsed");
});

Deno.test("assess: period end no ITEM (shape basil) funciona", () => {
  const sub = monthlySub({ current_period_end: undefined });
  (sub.items.data[0] as Record<string, unknown>).current_period_end = FUTURE_END;
  const r = assessStripeSourceSub(sub, NOW);
  assert(r.ok);
});

Deno.test("assess: malformado (sem period end, sem objeto) -> malformed", () => {
  assert(!assessStripeSourceSub(null, NOW).ok);
  const r = assessStripeSourceSub(monthlySub({ current_period_end: "not-a-number" }), NOW);
  assert(!r.ok && r.code === "malformed");
});

Deno.test("snapshot: le status, cap_end e periodEndMs (root e item)", () => {
  const s = readStripeSubSnapshot(monthlySub({ cancel_at_period_end: true }));
  assertEquals(s.status, "active");
  assertEquals(s.cancelAtPeriodEnd, true);
  assertEquals(s.periodEndMs, FUTURE_END * 1000);
  assertEquals(readStripeSubSnapshot(null).status, null);
});

Deno.test("isStripeNotFoundError: 404/resource_missing true, resto false", () => {
  assert(isStripeNotFoundError({ statusCode: 404 }));
  assert(isStripeNotFoundError({ code: "resource_missing" }));
  assert(!isStripeNotFoundError(new Error("boom")));
  assert(!isStripeNotFoundError(null));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/stripe-switch_test.ts`
Expected: FAIL (módulo `stripe-switch.ts` não existe).

- [ ] **Step 3: Implementar `_shared/stripe-switch.ts`**

```ts
// Porta Stripe injetavel do switch seamless (mensal Stripe -> 12x Pagar.me) e do leg D do
// cron. Modulo dedicado em vez de _shared/stripe.ts porque aquele LANCA no import quando
// STRIPE_SECRET_KEY nao existe: importa-lo de uma function que precisa bootar em ambiente
// dark (billing-downgrade-cron) derrubaria a function inteira. Aqui a factory recebe a key
// como argumento; cada index.ts constroi o gateway atras de Deno.env.get e passa null
// quando dark (mesmo padrao do gateway Pagar.me nulo em billing-downgrade-cron/index.ts).

import Stripe from "npm:stripe@17";
import { fetchStripeAmount, StripeAmount } from "./stripe-amount.ts";

// Toda chamada é bounded para que um stall vire erro capturavel, nunca Edge kill
// (precedente: STRIPE_CANCEL_TIMEOUT_MS no stripe-webhook).
export const STRIPE_SWITCH_TIMEOUT_MS = 10_000;

export type StripeSourceAssessment =
  | {
    ok: true;
    status: "active" | "trialing";
    periodEnd: Date;
    cancelAtPeriodEnd: boolean;
    priceId: string | null;
  }
  | { ok: false; code: "not_in_force" | "not_monthly" | "boundary_elapsed" | "malformed" };

/**
 * Elegibilidade REMOTA da assinatura Stripe de origem do switch. O billing_interval local
 * nao e confiavel (null para price legado), entao o remoto e a autoridade: status
 * active|trialing, interval do price do primeiro item === "month" e period end ainda no
 * futuro. O period end e dual-read (root, depois item) para sobreviver a diferenca de
 * shape acacia/basil, igual ao stripe-webhook.
 */
export function assessStripeSourceSub(sub: unknown, now: Date): StripeSourceAssessment {
  if (typeof sub !== "object" || sub === null) return { ok: false, code: "malformed" };
  const s = sub as {
    status?: unknown;
    cancel_at_period_end?: unknown;
    current_period_end?: unknown;
    items?: {
      data?: Array<
        {
          current_period_end?: unknown;
          price?: { id?: unknown; recurring?: { interval?: unknown } | null } | null;
        } | undefined
      > | null;
    } | null;
  };
  const status = typeof s.status === "string" ? s.status : null;
  if (status !== "active" && status !== "trialing") return { ok: false, code: "not_in_force" };
  const item = s.items?.data?.[0];
  if (item?.price?.recurring?.interval !== "month") return { ok: false, code: "not_monthly" };
  const rawEnd = typeof s.current_period_end === "number"
    ? s.current_period_end
    : typeof item?.current_period_end === "number"
    ? item.current_period_end
    : null;
  if (rawEnd === null || !Number.isFinite(rawEnd)) return { ok: false, code: "malformed" };
  const periodEnd = new Date(rawEnd * 1000); // timestamps Stripe sao unix SEGUNDOS
  if (periodEnd.getTime() <= now.getTime()) return { ok: false, code: "boundary_elapsed" };
  return {
    ok: true,
    status,
    periodEnd,
    cancelAtPeriodEnd: s.cancel_at_period_end === true,
    priceId: typeof item?.price?.id === "string" ? item.price.id : null,
  };
}

/** Snapshot minimo do estado remoto para as decisoes de enforcement do leg D. */
export function readStripeSubSnapshot(
  sub: unknown,
): { status: string | null; cancelAtPeriodEnd: boolean; periodEndMs: number | null } {
  if (typeof sub !== "object" || sub === null) {
    return { status: null, cancelAtPeriodEnd: false, periodEndMs: null };
  }
  const s = sub as {
    status?: unknown;
    cancel_at_period_end?: unknown;
    current_period_end?: unknown;
    items?: { data?: Array<{ current_period_end?: unknown } | undefined> | null } | null;
  };
  const item = s.items?.data?.[0];
  const rawEnd = typeof s.current_period_end === "number"
    ? s.current_period_end
    : typeof item?.current_period_end === "number"
    ? item.current_period_end
    : null;
  return {
    status: typeof s.status === "string" ? s.status : null,
    cancelAtPeriodEnd: s.cancel_at_period_end === true,
    periodEndMs: rawEnd === null ? null : rawEnd * 1000,
  };
}

/** True para "assinatura nao existe" da Stripe (404 / resource_missing). */
export function isStripeNotFoundError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { statusCode?: unknown; code?: unknown };
  return err.statusCode === 404 || err.code === "resource_missing";
}

export interface StripeSwitchGateway {
  /** GET subscription com items.data.price expandido (input do assessStripeSourceSub). */
  retrieveSubscription(id: string): Promise<unknown>;
  /** Update de cancel_at_period_end apenas. Idempotente por valor. */
  setCancelAtPeriodEnd(id: string, value: boolean): Promise<void>;
  /** Cancel imediato (leg D: renovacao escapou / consolidacao do undo). */
  cancelNow(id: string): Promise<void>;
  /** Valor vivo para restaurar o mirror no undo (fetchStripeAmount, interval month). */
  fetchAmount(id: string): Promise<StripeAmount>;
}

export function createStripeSwitchGateway(secretKey: string): StripeSwitchGateway {
  const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
  return {
    retrieveSubscription: (id) =>
      stripe.subscriptions.retrieve(
        id,
        { expand: ["items.data.price"] },
        { timeout: STRIPE_SWITCH_TIMEOUT_MS },
      ),
    setCancelAtPeriodEnd: async (id, value) => {
      await stripe.subscriptions.update(
        id,
        { cancel_at_period_end: value },
        { timeout: STRIPE_SWITCH_TIMEOUT_MS },
      );
    },
    cancelNow: async (id) => {
      await stripe.subscriptions.cancel(id, undefined, { timeout: STRIPE_SWITCH_TIMEOUT_MS });
    },
    fetchAmount: (id) =>
      fetchStripeAmount(
        stripe as unknown as Parameters<typeof fetchStripeAmount>[0],
        id,
        "month",
      ),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/stripe-switch_test.ts`
Expected: PASS (11 testes). Depois: `git checkout -- deno.lock`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/stripe-switch.ts supabase/functions/__tests__/stripe-switch_test.ts
git commit -m "feat(billing): gateway Stripe injetavel + assessment remoto do switch"
```

---

### Task 3: Pures compartilhados em `_shared/pagarme-logic.ts`

**Files:**
- Modify: `supabase/functions/_shared/pagarme-logic.ts` (adicionar ao final; NÃO tocar em `canWebhookWrite`/`isInForce`/`isPaidThrough` etc.)
- Test: `supabase/functions/__tests__/pagarme-logic_test.ts` (adicionar ao final)

**Interfaces:**
- Consumes: `isInForce` (mesmo arquivo).
- Produces (usados pelas Tasks 7, 9, 11):
  - `buildRestoreStripeColumns(args: { status: "active" | "trialing"; cancelAtPeriodEnd: boolean; periodEndIso: string | null; sourcePlanId: string | null; amountColumns: Record<string, unknown>; nowIso: string }): Record<string, unknown>`
  - `stripePortalBlocked(row: { provider?: string | null; status?: string | null; switched_from_stripe_subscription_id?: string | null } | null | undefined): boolean`

- [ ] **Step 1: Escrever os testes (falhando)**

Adicione ao final de `supabase/functions/__tests__/pagarme-logic_test.ts` (imports: acrescente `buildRestoreStripeColumns, stripePortalBlocked` ao import de `../_shared/pagarme-logic.ts`):

```ts
Deno.test("buildRestoreStripeColumns: payload completo num statement, markers e pagarme id limpos", () => {
  const cols = buildRestoreStripeColumns({
    status: "active",
    cancelAtPeriodEnd: false,
    periodEndIso: "2026-09-15T14:23:11.000Z",
    sourcePlanId: "start",
    amountColumns: { amount_cents: null, gross_cents: null, currency: null, amount_interval: null, discount_label: null, amount_refreshed_at: null },
    nowIso: "2026-08-12T12:00:00.000Z",
  });
  assertEquals(cols.provider, "stripe");
  assertEquals(cols.status, "active");
  assertEquals(cols.plan_id, "start");
  assertEquals(cols.billing_interval, "month");
  assertEquals(cols.installments, null);
  assertEquals(cols.current_period_end, "2026-09-15T14:23:11.000Z");
  assertEquals(cols.cancel_at_period_end, false);
  assertEquals(cols.pagarme_subscription_id, null);
  assertEquals(cols.switched_from_stripe_subscription_id, null);
  assertEquals(cols.switched_from_plan_id, null);
  assertEquals(cols.amount_cents, null);
  assertEquals(cols.updated_at, "2026-08-12T12:00:00.000Z");
});

Deno.test("buildRestoreStripeColumns: fonte em churn preserva cancel_at_period_end=true", () => {
  const cols = buildRestoreStripeColumns({
    status: "active",
    cancelAtPeriodEnd: true,
    periodEndIso: "2026-09-15T14:23:11.000Z",
    sourcePlanId: "pro",
    amountColumns: {},
    nowIso: "2026-08-12T12:00:00.000Z",
  });
  assertEquals(cols.cancel_at_period_end, true);
});

Deno.test("buildRestoreStripeColumns: periodEnd/plan desconhecidos sao OMITIDOS, nunca null por cima", () => {
  const cols = buildRestoreStripeColumns({
    status: "trialing",
    cancelAtPeriodEnd: false,
    periodEndIso: null,
    sourcePlanId: null,
    amountColumns: {},
    nowIso: "2026-08-12T12:00:00.000Z",
  });
  assert(!("current_period_end" in cols));
  assert(!("plan_id" in cols));
});

Deno.test("stripePortalBlocked: linha pagarme in force ou com marker bloqueia; stripe nunca", () => {
  assert(stripePortalBlocked({ provider: "pagarme", status: "active", switched_from_stripe_subscription_id: null }));
  assert(stripePortalBlocked({ provider: "pagarme", status: "trialing", switched_from_stripe_subscription_id: "sub_s1" }));
  assert(stripePortalBlocked({ provider: "pagarme", status: "canceled", switched_from_stripe_subscription_id: "sub_s1" }));
  assert(!stripePortalBlocked({ provider: "pagarme", status: "canceled", switched_from_stripe_subscription_id: null }));
  assert(!stripePortalBlocked({ provider: "stripe", status: "active", switched_from_stripe_subscription_id: null }));
  assert(!stripePortalBlocked(null));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/pagarme-logic_test.ts`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: Implementar os dois pures**

Adicione ao final de `supabase/functions/_shared/pagarme-logic.ts`:

```ts
/**
 * Payload completo que devolve a linha ao ownership Stripe depois de um switch desfeito.
 * Usado pelo UNDO (pagarme-subscription) e pelo ROLLBACK da perna Stripe do checkout
 * (pagarme-checkout). Mesmo invariante de statement unico do bind: provider + mirror +
 * markers juntos, com CAS do caller pinado nas coordenadas pagarme observadas.
 * pagarme_subscription_id e LIMPO de proposito: sem ele a future sub remota deixa de ser
 * "linked" e o leg C do billing-downgrade-cron varre a orfa se o DELETE best-effort do
 * caller falhar. current_period_end e plan_id sao OMITIDOS quando desconhecidos (nunca
 * null por cima; invariante dos handlers de cancel).
 */
export function buildRestoreStripeColumns(args: {
  status: "active" | "trialing";
  cancelAtPeriodEnd: boolean;
  periodEndIso: string | null;
  sourcePlanId: string | null;
  amountColumns: Record<string, unknown>;
  nowIso: string;
}): Record<string, unknown> {
  return {
    provider: "stripe",
    status: args.status,
    ...(args.sourcePlanId ? { plan_id: args.sourcePlanId } : {}),
    billing_interval: "month",
    installments: null,
    ...(args.periodEndIso ? { current_period_end: args.periodEndIso } : {}),
    cancel_at_period_end: args.cancelAtPeriodEnd,
    pagarme_subscription_id: null,
    switched_from_stripe_subscription_id: null,
    switched_from_plan_id: null,
    failed_payment_count: 0,
    past_due_since: null,
    next_payment_attempt: null,
    ...args.amountColumns,
    updated_at: args.nowIso,
  };
}

/**
 * Bloqueia o Billing Portal da Stripe quando a linha e pagarme (in force) ou carrega uma
 * janela de switch viva: o "renovar" do portal desfaria o cancel_at_period_end na Stripe,
 * o webhook resultante e negado pos-flip e nada local perceberia ate o leg D. Cobranca
 * dupla no start_at. Linhas realmente Stripe seguem abrindo o portal normalmente.
 */
export function stripePortalBlocked(row: {
  provider?: string | null;
  status?: string | null;
  switched_from_stripe_subscription_id?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  if (row.provider !== "pagarme") return false;
  return isInForce(row.status) || !!row.switched_from_stripe_subscription_id;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/pagarme-logic_test.ts`
Expected: PASS (todos, incluindo os 66 pré-existentes intactos). Depois: `git checkout -- deno.lock`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/pagarme-logic.ts supabase/functions/__tests__/pagarme-logic_test.ts
git commit -m "feat(billing): buildRestoreStripeColumns + stripePortalBlocked"
```

---

### Task 4: `pagarme-checkout/logic.ts` — parse do switch, elegibilidade local, ceil, markers

**Files:**
- Modify: `supabase/functions/pagarme-checkout/logic.ts`
- Test: `supabase/functions/__tests__/pagarme-checkout-logic_test.ts`
- Modify (mecânico): `supabase/functions/__tests__/pagarme-checkout-handler_test.ts` (o literal `REQ` ganha `isSwitch: false`)

**Interfaces:**
- Produces (usados pelas Tasks 5-7):
  - `PagarmeCheckoutRequest` ganha `isSwitch: boolean`
  - `parseCheckoutBody`: aceita `switch?: true` no body (presente e não-`true` → 400 `invalid_request`)
  - `stripeSwitchSourceEligible(row: { provider?: string | null; stripe_subscription_id?: string | null; status?: string | null; billing_interval?: string | null } | null | undefined): boolean`
  - `ceilToUtcMidnightDate(boundary: Date): string` (formato `YYYY-MM-DD`)
  - `buildPagarmeSubscriptionColumns` args ganham `switchedFromStripeSubscriptionId?: string | null` e `switchedFromPlanId?: string | null`; payload SEMPRE emite `switched_from_stripe_subscription_id`, `switched_from_plan_id` (default null) e `switch_checked_at: null`

- [ ] **Step 1: Escrever os testes (falhando)**

Em `pagarme-checkout-logic_test.ts`, adicione (ajuste os imports do topo para incluir `ceilToUtcMidnightDate, stripeSwitchSourceEligible`):

```ts
Deno.test("parseCheckoutBody: switch true e aceito e vira isSwitch", () => {
  const r = parseCheckoutBody({ ...VALID_BODY, switch: true });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.isSwitch, true);
});

Deno.test("parseCheckoutBody: switch ausente -> isSwitch false", () => {
  const r = parseCheckoutBody(VALID_BODY);
  assert(r.ok);
  if (r.ok) assertEquals(r.value.isSwitch, false);
});

Deno.test("parseCheckoutBody: switch presente e nao-boolean-true -> 400", () => {
  for (const bad of [false, "true", 1, null]) {
    const r = parseCheckoutBody({ ...VALID_BODY, switch: bad });
    assert(!r.ok, `switch=${String(bad)}`);
  }
});

Deno.test("stripeSwitchSourceEligible: matriz", () => {
  const base = {
    provider: "stripe",
    stripe_subscription_id: "sub_s1",
    status: "active",
    billing_interval: "month",
  };
  assert(stripeSwitchSourceEligible(base));
  assert(stripeSwitchSourceEligible({ ...base, status: "trialing" }));
  // provider null = legado stripe
  assert(stripeSwitchSourceEligible({ ...base, provider: null }));
  // billing_interval null (price legado) passa: a autoridade e o remoto
  assert(stripeSwitchSourceEligible({ ...base, billing_interval: null }));
  // estrito: past_due/unpaid NUNCA (nao usar isInForce)
  assert(!stripeSwitchSourceEligible({ ...base, status: "past_due" }));
  assert(!stripeSwitchSourceEligible({ ...base, status: "unpaid" }));
  assert(!stripeSwitchSourceEligible({ ...base, status: "canceled" }));
  assert(!stripeSwitchSourceEligible({ ...base, provider: "pagarme" }));
  assert(!stripeSwitchSourceEligible({ ...base, billing_interval: "year" }));
  assert(!stripeSwitchSourceEligible({ ...base, stripe_subscription_id: null }));
  assert(!stripeSwitchSourceEligible(null));
});

Deno.test("ceilToUtcMidnightDate: meio-dia sobe para o proximo midnight; midnight exato fica", () => {
  assertEquals(ceilToUtcMidnightDate(new Date("2026-09-15T14:23:11Z")), "2026-09-16");
  assertEquals(ceilToUtcMidnightDate(new Date("2026-09-15T00:00:00.000Z")), "2026-09-15");
  // virada de mes
  assertEquals(ceilToUtcMidnightDate(new Date("2026-08-31T23:59:59Z")), "2026-09-01");
});

Deno.test("buildPagarmeSubscriptionColumns: markers do switch no MESMO payload + switch_checked_at zerado", () => {
  const cols = buildPagarmeSubscriptionColumns({
    customerId: "cus_1",
    subscriptionId: "sub_1",
    status: "trialing",
    planId: "pro",
    annualPriceCents: 155880,
    currentPeriodEnd: "2026-09-16T00:00:00Z",
    everSubscribedAt: "2026-01-01T00:00:00Z",
    nowIso: "2026-08-12T12:00:00.000Z",
    switchedFromStripeSubscriptionId: "sub_s1",
    switchedFromPlanId: "start",
  });
  assertEquals(cols.switched_from_stripe_subscription_id, "sub_s1");
  assertEquals(cols.switched_from_plan_id, "start");
  assertEquals(cols.switch_checked_at, null);
});
```

`VALID_BODY` é o body válido que os testes existentes de `parseCheckoutBody` já usam nesse arquivo — reuse a constante/literal existente (grep `parseCheckoutBody` no arquivo). Se for literal inline, extraia para uma const local no bloco novo repetindo os campos.

- [ ] **Step 2: Atualizar o teste pinado do payload**

No mesmo arquivo, o teste "provider flip and amount mirror in ONE payload" (linha ~228) faz igualdade exata do objeto retornado por `buildPagarmeSubscriptionColumns`. Adicione ao objeto esperado:

```ts
    switched_from_stripe_subscription_id: null,
    switched_from_plan_id: null,
    switch_checked_at: null,
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-logic_test.ts`
Expected: FAIL (novos exports inexistentes + payload divergente).

- [ ] **Step 4: Implementar em `pagarme-checkout/logic.ts`**

(a) `PagarmeCheckoutRequest` ganha o campo:

```ts
  billingAddress: { cep: string; line1: string; city: string; state: string };
  /** Switch mensal Stripe -> 12x: consentimento explicito no body (spec 2026-08-14).
   * Clientes velhos sem o campo seguem recebendo o 409 de linha vigente. */
  isSwitch: boolean;
```

(b) Em `parseCheckoutBody`, logo após o check de `installments`:

```ts
  if (body.switch !== undefined && body.switch !== true) {
    return fail("Requisição inválida.");
  }
```

e no objeto retornado: `isSwitch: body.switch === true,`

(c) Novo pure após `pagarmeCheckoutBlocked`:

```ts
/**
 * Gate LOCAL do switch (spec, decisao 3): linha Stripe (null = legado) com id remoto,
 * status ESTRITO active|trialing (nunca isInForce: past_due fica fora, dunning primeiro)
 * e billing_interval que nao afirme "year". billing_interval null passa: o stripe-webhook
 * grava null para price desconhecido, e a autoridade de "e mensal" e a verificacao REMOTA
 * do handler (assessStripeSourceSub).
 */
export function stripeSwitchSourceEligible(row: {
  provider?: string | null;
  stripe_subscription_id?: string | null;
  status?: string | null;
  billing_interval?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  if ((row.provider ?? "stripe") !== "stripe") return false;
  if (!row.stripe_subscription_id) return false;
  if (row.status !== "active" && row.status !== "trialing") return false;
  return row.billing_interval !== "year";
}
```

(d) Extrair o ceil (mantendo `resolveStartAt` com a mesma assinatura):

```ts
/** Ceil de uma fronteira arbitraria para a proxima meia-noite UTC, date-only (o gateway
 * le start_at como midnight UTC). Direcao segura: nunca cobra antes da fronteira paga. */
export function ceilToUtcMidnightDate(boundary: Date): string {
  const end = new Date(boundary.getTime());
  if (
    end.getUTCHours() !== 0 || end.getUTCMinutes() !== 0 ||
    end.getUTCSeconds() !== 0 || end.getUTCMilliseconds() !== 0
  ) {
    end.setUTCHours(24, 0, 0, 0); // ceil to the next UTC midnight
  }
  return end.toISOString().slice(0, 10);
}

export function resolveStartAt(trialDays: number | undefined, now: Date): string | undefined {
  if (!trialDays) return undefined;
  return ceilToUtcMidnightDate(new Date(now.getTime() + trialDays * 24 * 3600 * 1000));
}
```

(mantenha o doc comment existente do `resolveStartAt` acima dele)

(e) `buildPagarmeSubscriptionColumns`: args ganham

```ts
  switchedFromStripeSubscriptionId?: string | null;
  switchedFromPlanId?: string | null;
```

e o objeto retornado ganha, logo após `cancel_at_period_end: false,`:

```ts
    // Markers do switch (spec 2026-08-14): sempre emitidos (null no checkout comum) para
    // manter o invariante de payload unico auto-documentado. switch_checked_at zerado poe
    // um segundo switch do mesmo workspace na FRENTE da fila do leg D.
    switched_from_stripe_subscription_id: args.switchedFromStripeSubscriptionId ?? null,
    switched_from_plan_id: args.switchedFromPlanId ?? null,
    switch_checked_at: null,
```

(f) Em `pagarme-checkout-handler_test.ts`, o literal `REQ` (linha ~14) ganha `isSwitch: false,` (o tipo agora exige).

- [ ] **Step 5: Rodar e ver passar**

Run:
```bash
deno test supabase/functions/__tests__/pagarme-checkout-logic_test.ts && deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts
```
Expected: PASS em ambos (handler intacto: os markers novos entram como null e nenhum teste pina a ausencia deles). Depois: `git checkout -- deno.lock`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/pagarme-checkout/logic.ts supabase/functions/__tests__/pagarme-checkout-logic_test.ts supabase/functions/__tests__/pagarme-checkout-handler_test.ts
git commit -m "feat(billing): parse do switch, elegibilidade local, ceil e markers no bind"
```

---

### Task 5: Handler do checkout — gates do switch (tudo pré-reserva)

**Files:**
- Modify: `supabase/functions/pagarme-checkout/handler.ts`
- Test: `supabase/functions/__tests__/pagarme-checkout-handler_test.ts`

**Interfaces:**
- Consumes: `stripeSwitchSourceEligible` (Task 4), `assessStripeSourceSub`, `StripeSwitchGateway` (Task 2).
- Produces: `createPagarmeCheckoutHandler` deps ganham `stripeSwitch?: StripeSwitchGateway | null` (opcional: testes existentes compilam sem mudança). O select da linha ganha `billing_interval, plan_id`. Fluxo switch até a reserva; a criação/bind ficam na Task 6.

- [ ] **Step 1: Estender os fixtures do teste**

Em `pagarme-checkout-handler_test.ts`:

(a) `makeDb` fixture ganha campos e branches:

```ts
  /** Linha devolvida pelo read de workspaces do PASSO 3b do switch (plan_id + plan_source)
   * e pelo read do plan-writer (que so olha plan_source). */
  workspaceRow?: { plan_id?: string | null; plan_source: string };
  /** True = existe attempt quarantined para o workspace (gate amigavel da decisao 10). */
  quarantinedAttempt?: boolean;
```

no `settle()`, substitua o branch de `workspaces`+read por:

```ts
      if (table === "workspaces" && op === "read") {
        return { data: fx.workspaceRow ?? { plan_source: "system" }, error: null };
      }
```

e substitua o branch de `pagarme_checkout_attempts`+read por (o read de quarentena se distingue pelo filtro `state=quarantined`; o de stale-pending pelo `state=pending`):

```ts
      if (table === "pagarme_checkout_attempts" && op === "read") {
        if (filters.some(([m, c, v]) => m === "eq" && c === "state" && v === "quarantined")) {
          return { data: fx.quarantinedAttempt ? { id: "at-q" } : null, error: null };
        }
        return { data: fx.stalePending ?? [], error: null };
      }
```

(b) `chain.limit = () => chain;` no makeDb (o read de quarentena usa `.limit(1)`).

(c) Novo fake do gateway Stripe + fixture remoto, depois de `makeGateway`:

```ts
// Fronteira do mensal de teste: 2026-09-15T14:23:11Z -> ceil = "2026-09-16".
const STRIPE_BOUNDARY_UNIX = Math.floor(Date.parse("2026-09-15T14:23:11Z") / 1000);
const STRIPE_SUB_MONTHLY = {
  status: "active",
  cancel_at_period_end: false,
  current_period_end: STRIPE_BOUNDARY_UNIX,
  items: { data: [{ price: { id: "price_m1", recurring: { interval: "month" } } }] },
};

function makeStripeSwitch(fx: {
  calls: Array<{ method: string; args: unknown[] }>;
  retrieveResult?: unknown;
  retrieveThrows?: unknown;
  /** Lanca em setCancelAtPeriodEnd(id, true) (a perna do switch). */
  setCancelTrueThrows?: unknown;
  /** Lanca em setCancelAtPeriodEnd(id, false). */
  setCancelFalseThrows?: unknown;
}): StripeSwitchGateway {
  const record = (method: string, args: unknown[]) => fx.calls.push({ method, args });
  return {
    retrieveSubscription: (id) => {
      record("retrieveSubscription", [id]);
      if (fx.retrieveThrows) return Promise.reject(fx.retrieveThrows);
      return Promise.resolve(fx.retrieveResult ?? STRIPE_SUB_MONTHLY);
    },
    setCancelAtPeriodEnd: (id, value) => {
      record("setCancelAtPeriodEnd", [id, value]);
      if (value === true && fx.setCancelTrueThrows) return Promise.reject(fx.setCancelTrueThrows);
      if (value === false && fx.setCancelFalseThrows) return Promise.reject(fx.setCancelFalseThrows);
      return Promise.resolve();
    },
    cancelNow: (id) => {
      record("cancelNow", [id]);
      return Promise.resolve();
    },
    fetchAmount: (id) => {
      record("fetchAmount", [id]);
      return Promise.resolve({
        amount_cents: 9990,
        gross_cents: null,
        currency: "brl",
        interval: "month",
        discount_label: null,
        livemode: false,
      });
    },
  };
}
```

(import `StripeSwitchGateway` de `../_shared/stripe-switch.ts` no topo do arquivo)

(d) O helper `run()` ganha o terceiro fixture opcional:

```ts
function run(
  dbFx: Omit<Parameters<typeof makeDb>[0], "events">,
  gwFx: Omit<Parameters<typeof makeGateway>[0], "calls"> = {},
  swFx?: Omit<Parameters<typeof makeStripeSwitch>[0], "calls"> | null,
  req: PagarmeCheckoutRequest = REQ,
) {
  const events: Ev[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stripeCalls: Array<{ method: string; args: unknown[] }> = [];
  const handle = createPagarmeCheckoutHandler({
    db: makeDb({ ...dbFx, events }),
    gateway: makeGateway({ ...gwFx, calls }),
    now: () => NOW,
    stripeSwitch: swFx === null ? null : makeStripeSwitch({ ...(swFx ?? {}), calls: stripeCalls }),
  });
  return { events, calls, stripeCalls, result: handle(CTX, req) };
}
```

(e) Fixtures de request/linha do switch, perto de `REQ`:

```ts
const SWITCH_REQ: PagarmeCheckoutRequest = { ...REQ, isSwitch: true };
const STRIPE_ROW = {
  provider: "stripe",
  stripe_subscription_id: "sub_s1",
  pagarme_customer_id: null,
  pagarme_subscription_id: null,
  status: "active",
  cancel_at_period_end: false,
  current_period_end: "2026-09-15T14:23:11Z",
  ever_subscribed_at: "2026-01-01T00:00:00Z",
  billing_interval: "month",
  plan_id: "start",
};
const WS_ROW = { plan_id: "start", plan_source: "system" };
```

- [ ] **Step 2: Escrever os testes dos gates (falhando)**

```ts
Deno.test("switch: linha stripe active elegivel passa do gate e chega na reserva", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 200);
  assert(events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: linha inelegivel (past_due) -> 409 switch_not_eligible, zero remoto, zero reserva", async () => {
  const { events, calls, stripeCalls, result } = run(
    { plan: PLAN, subRow: { ...STRIPE_ROW, status: "past_due" }, workspaceRow: WS_ROW },
    {},
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals((res.body as { code?: string }).code, "switch_not_eligible");
  assertEquals(calls.length, 0);
  assertEquals(stripeCalls.length, 0);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: stripeSwitch null (env dark) -> 500, zero reserva", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    {},
    null,
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 500);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: verify remoto diz anual -> 409 antes da reserva", async () => {
  const annual = {
    ...STRIPE_SUB_MONTHLY,
    items: { data: [{ price: { id: "p_y", recurring: { interval: "year" } } }] },
  };
  const { events, calls, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    {},
    { retrieveResult: annual },
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals(calls.length, 0);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: fronteira remota ja passada -> 409 com copy de renovacao", async () => {
  const elapsed = { ...STRIPE_SUB_MONTHLY, current_period_end: Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000) };
  const { result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    {},
    { retrieveResult: elapsed },
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals(
    (res.body as { error?: string }).error,
    "Sua renovação está em processamento. Tente novamente em alguns minutos.",
  );
});

Deno.test("switch: retrieve remoto lanca -> 500, zero reserva", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    {},
    { retrieveThrows: new Error("stripe down") },
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 500);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: plan_source manual -> 409 pre-reserva (decisao 11)", async () => {
  const { result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: { plan_id: "pro", plan_source: "manual" } },
    {},
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
});

Deno.test("switch: plano-fonte prefere workspaces.plan_id; row.plan_id e fallback", async () => {
  // workspaces.plan_id=pro, row.plan_id=start -> marker de plano deve ser pro (Task 6 asserta
  // o bind; aqui so garante que NAO 409a e diverge com log)
  const { result } = await (async () => {
    const r = run(
      { plan: PLAN, subRow: { ...STRIPE_ROW, plan_id: "start" }, workspaceRow: { plan_id: "pro", plan_source: "system" } },
      { subStatus: "future", subStartAt: "2026-09-16" },
      {},
      SWITCH_REQ,
    );
    return { result: await r.result };
  })();
  assertEquals(result.status, 200);
});

Deno.test("switch: ambos os planos-fonte null -> 409 pre-reserva", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: { ...STRIPE_ROW, plan_id: null }, workspaceRow: { plan_id: null, plan_source: "system" } },
    {},
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("quarentena existente -> 409 antes da reserva (qualquer request, nao so switch)", async () => {
  const { events, result } = run({ plan: PLAN, subRow: null, quarantinedAttempt: true });
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals((res.body as { code?: string }).code, "quarantined");
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("regressao: nao-switch continua 409 em linha stripe in-force", async () => {
  const { result } = run({ plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW });
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals((res.body as { error?: string }).error, "Este workspace já tem uma assinatura vigente.");
});
```

Nota: o primeiro e o oitavo teste só passam por completo depois da Task 6 (criação com
start_at). Se o handler ainda não tiver o caminho de criação do switch, marque ESSES DOIS
com `ignore: true` temporário e remova o ignore na Task 6. Os demais devem passar já nesta
task.

- [ ] **Step 3: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts`
Expected: FAIL nos testes novos.

- [ ] **Step 4: Implementar os gates no handler**

Em `pagarme-checkout/handler.ts`:

(a) Imports novos:

```ts
import {
  assessStripeSourceSub,
  StripeSwitchGateway,
} from "../_shared/stripe-switch.ts";
```

e no import de `./logic.ts` acrescente `ceilToUtcMidnightDate, stripeSwitchSourceEligible`.

(b) Deps:

```ts
export function createPagarmeCheckoutHandler(deps: {
  db: SupabaseClient;
  gateway: PagarmeGateway;
  now: () => Date;
  /** Porta Stripe do switch. null/ausente = ambiente sem STRIPE_SECRET_KEY: switch 500a. */
  stripeSwitch?: StripeSwitchGateway | null;
}) {
```

(c) O select da linha (passo 2) ganha `billing_interval, plan_id`:

```ts
      .select(
        "provider, stripe_subscription_id, pagarme_customer_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end, ever_subscribed_at, billing_interval, plan_id",
      )
```

(d) Mova as consts `GENERIC_500` e `ROW_CONFLICT_409` para ANTES do passo do gate (elas
passam a ser usadas mais cedo). Entre o read da linha e o gate 409 existente, insira:

```ts
    // ── Switch mensal Stripe -> 12x (spec 2026-08-14). Gate local estrito + verificacao
    // REMOTA como autoridade + plano-fonte, tudo ANTES da reserva: nada remoto foi criado,
    // entao cada saida aqui e um 4xx/5xx limpo sem compensacao. O retrieve read-only antes
    // da reserva e excecao documentada a regra "nenhuma chamada remota antes da reserva"
    // (nao cria recurso; mesma familia da excecao do self-heal abaixo). ──
    const isSwitch = reqData.isSwitch;
    const SWITCH_NOT_ELIGIBLE_409 = {
      status: 409,
      body: {
        error: "A troca está disponível apenas para assinaturas mensais ativas.",
        code: "switch_not_eligible",
      },
    } as const;
    let switchBoundary: Date | null = null;
    let switchSourcePlanId: string | null = null;
    let switchObserved: { status: "active" | "trialing"; cancelAtPeriodEnd: boolean } | null =
      null;
    if (isSwitch) {
      if (!row || !stripeSwitchSourceEligible(row)) return { ...SWITCH_NOT_ELIGIBLE_409 };
      if (!deps.stripeSwitch) {
        console.error("[pagarme-checkout] switch requested but no Stripe gateway configured");
        return { status: 500, body: GENERIC_500 };
      }
      let remoteSub: unknown;
      try {
        remoteSub = await deps.stripeSwitch.retrieveSubscription(
          row.stripe_subscription_id as string,
        );
      } catch (e) {
        console.error(
          "[pagarme-checkout] switch verify failed:",
          e instanceof Error ? e.message : String(e),
        );
        return { status: 500, body: GENERIC_500 };
      }
      const assessed = assessStripeSourceSub(remoteSub, now);
      if (!assessed.ok) {
        if (assessed.code === "boundary_elapsed") {
          return {
            status: 409,
            body: {
              error: "Sua renovação está em processamento. Tente novamente em alguns minutos.",
              code: "switch_not_eligible",
            },
          };
        }
        return { ...SWITCH_NOT_ELIGIBLE_409 };
      }
      switchBoundary = assessed.periodEnd;
      switchObserved = {
        status: assessed.status,
        cancelAtPeriodEnd: assessed.cancelAtPeriodEnd,
      };

      // Plano-fonte NAO nulo antes de criar qualquer coisa: o undo precisa cumprir
      // "continua como estava". workspaces.plan_id (fonte efetiva) primeiro; row.plan_id e
      // fallback (o stripe-webhook grava null para price desconhecido). plan_source manual
      // nao troca em self-service: writeWorkspacePlan preservaria o comp e a copy de
      // concessao imediata viraria mentira (decisao 11).
      const { data: ws, error: wsErr } = await db
        .from("workspaces")
        .select("plan_id, plan_source")
        .eq("id", ctx.workspaceId)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
        .single();
      if (wsErr) throw new Error(`workspace read failed: ${wsErr.message}`);
      if (ws?.plan_source === "manual") {
        return {
          status: 409,
          body: {
            error: "Seu plano é gerenciado pelo suporte. Fale com a gente para trocar.",
            code: "switch_not_eligible",
          },
        };
      }
      const wsPlanId = (ws?.plan_id as string | null) ?? null;
      const rowPlanId = (row.plan_id as string | null) ?? null;
      if (wsPlanId !== rowPlanId) {
        console.warn(
          `[pagarme-checkout] switch source plan divergence for workspace ${ctx.workspaceId}: workspaces=${wsPlanId} row=${rowPlanId}`,
        );
      }
      switchSourcePlanId = wsPlanId ?? rowPlanId;
      if (!switchSourcePlanId) {
        return {
          status: 409,
          body: {
            error: "Não foi possível confirmar seu plano atual. Fale com o suporte.",
            code: "switch_not_eligible",
          },
        };
      }
    }

    // Quarentena (decisao 10): read amigavel para a mensagem; a garantia atomica e o
    // indice unico parcial alargado (a reserva abaixo 23505a se uma quarentena existir).
    const { data: quarantinedAttempt, error: quarantineErr } = await db
      .from("pagarme_checkout_attempts")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("state", "quarantined")
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (quarantineErr) throw new Error(`quarantine read failed: ${quarantineErr.message}`);
    if (quarantinedAttempt) {
      return {
        status: 409,
        body: {
          error: "Encontramos uma cobrança que precisa de revisão. Fale com o suporte.",
          code: "quarantined",
        },
      };
    }
```

(e) O gate existente vira carve-out (eligibilidade do switch já foi validada acima, então
`isSwitch` aqui implica elegível):

```ts
    if (!isSwitch && pagarmeCheckoutBlocked(row, now)) {
      return { status: 409, body: { error: "Este workspace já tem uma assinatura vigente." } };
    }
```

(f) `switchObserved` e `switchSourcePlanId` ficam sem uso até a Task 6/7 — prefixe com
`void switchObserved; void switchBoundary;` temporário se o lint reclamar (removido na
Task 6), ou implemente as Tasks 5-6 no mesmo push.

- [ ] **Step 5: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts`
Expected: PASS (com os 2 `ignore` temporários da nota do Step 2). Depois: `git checkout -- deno.lock`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/pagarme-checkout/handler.ts supabase/functions/__tests__/pagarme-checkout-handler_test.ts
git commit -m "feat(billing): gates pre-reserva do switch no pagarme-checkout"
```

---

### Task 6: Handler do checkout — criação com start_at, born-active em quarentena, CAS com markers

**Files:**
- Modify: `supabase/functions/pagarme-checkout/handler.ts`
- Test: `supabase/functions/__tests__/pagarme-checkout-handler_test.ts`

**Interfaces:**
- Consumes: `ceilToUtcMidnightDate`, `buildPagarmeSubscriptionColumns` com markers (Task 4), `switchBoundary`/`switchSourcePlanId`/`switchObserved` (Task 5).
- Produces: response do switch `{ status: "trialing", trial_ends_at: null, next_charge_at, installment_amount_cents, switched: true, first_charge_at }`; `finishAttempt` aceita `"quarantined"`. A perna Stripe fica na Task 7 (nesta task o switch termina após o grant com `finishAttempt("succeeded")` — a Task 7 move isso).

- [ ] **Step 1: Escrever os testes (falhando)** — remova os `ignore` da Task 5 e adicione:

```ts
Deno.test("switch happy path: start_at da fronteira, CAS com pin de status + markers, response switched", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 200);
  const body = res.body as Record<string, unknown>;
  assertEquals(body.status, "trialing");
  assertEquals(body.trial_ends_at, null); // switch nunca fala de trial
  assertEquals(body.switched, true);
  assertEquals(body.first_charge_at, "2026-09-16");
  assertEquals(body.next_charge_at, "2026-09-16");

  // start_at enviado ao gateway = ceil da fronteira Stripe (14:23Z -> dia seguinte)
  const createCall = calls.find((c) => c.method === "createSubscription")!;
  const subInput = createCall.args[0] as Record<string, unknown>;
  assertEquals(subInput.start_at, "2026-09-16");

  // CAS: pins existentes + pin extra de status + markers no MESMO payload
  const bind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assert(bind.filters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "stripe"));
  assert(
    bind.filters.some(([m, c, v]) => m === "eq" && c === "stripe_subscription_id" && v === "sub_s1"),
  );
  assert(bind.filters.some(([m, c, v]) => m === "eq" && c === "status" && v === "active"));
  assertEquals(bind.values?.switched_from_stripe_subscription_id, "sub_s1");
  assertEquals(bind.values?.switched_from_plan_id, "start");
  assertEquals(bind.values?.switch_checked_at, null);
});

Deno.test("switch: nunca chama resolveTrialDays (sem start_at de trial mesmo se nunca assinou)", async () => {
  // Linha stripe sem ever_subscribed_at nao existe na pratica (o id ja implica), mas o pin
  // aqui e: o start_at do switch vem SEMPRE da fronteira, nunca de now+30d.
  const { calls, result } = run(
    { plan: PLAN, subRow: { ...STRIPE_ROW, ever_subscribed_at: null }, workspaceRow: WS_ROW },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  await result;
  const subInput = calls.find((c) => c.method === "createSubscription")!.args[0] as Record<string, unknown>;
  assertEquals(subInput.start_at, "2026-09-16"); // e nao "2026-09-11" (now+30d)
});

Deno.test("switch born-active: cancel remoto + attempt QUARANTINED + 500", async () => {
  const { events, calls, result } = await withConsoleSpies(async () => {
    const r = run(
      { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
      { subStatus: "active" },
      {},
      SWITCH_REQ,
    );
    return { events: r.events, calls: r.calls, result: await r.result };
  }).then(({ result: inner }) => inner);
  assertEquals(result.status, 500);
  assert(calls.some((c) => c.method === "cancelSubscription"));
  const quarantineWrite = events.find(
    (e) => e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "quarantined",
  );
  assert(quarantineWrite, "attempt deve virar quarantined, nunca failed");
  assert(!events.some(
    (e) => e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed",
  ));
});

Deno.test("switch: CAS zero rows (webhook concorrente mudou status) -> compensa + 409", async () => {
  const { calls, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW, bindZeroRows: true },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assert(calls.some((c) => c.method === "cancelSubscription"));
});

Deno.test("switch com price legado: billing_interval null passa e o marker persiste o plano-fonte", async () => {
  const { events, result } = run(
    {
      plan: PLAN,
      subRow: { ...STRIPE_ROW, billing_interval: null, plan_id: null },
      workspaceRow: { plan_id: "start", plan_source: "system" },
    },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 200);
  const bind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(bind.values?.switched_from_plan_id, "start");
});
```

Nota sobre o teste born-active: siga o shape real do `withConsoleSpies` já presente no
arquivo (ele devolve `{ result, errors, warnings }`); o esqueleto acima indica a
intenção — capture os spies e asserte `result.status === 500` + as escritas. Ajuste a
plumbing conforme os usos existentes no arquivo (há vários exemplos).

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts`
Expected: FAIL nos novos.

- [ ] **Step 3: Implementar**

(a) `finishAttempt` aceita o terceiro estado:

```ts
    const finishAttempt = async (
      state: "succeeded" | "failed" | "quarantined",
      pagarmeSubscriptionId?: string,
    ) => {
```

(b) `startAt` (passo 4 do try):

```ts
      // (4) Trial (checkout comum) OU fronteira do switch. O switch NUNCA consulta
      // resolveTrialDays: o "periodo gratis" dele e o mes Stripe ja pago, e a 1a parcela
      // cai no ceil da fronteira (spec: nao ha gap de acesso; o plano e concedido no bind).
      const trialDays = isSwitch ? undefined : resolveTrialDays(hasEverSubscribed(row));
      const startAt = isSwitch && switchBoundary
        ? ceilToUtcMidnightDate(switchBoundary)
        : resolveStartAt(trialDays, now);
```

(c) Logo depois do orphan-pointer write (passo 8) e ANTES do check born-non-live
existente (passo 9), insira o caso do switch:

```ts
        // (9a) Switch DEVE nascer future->trialing (start_at estritamente futuro). Nascer
        // active = 1a cobranca disparou com a Stripe ainda cobrando: malfuncionamento do
        // gateway. Quarentena duravel (decisao 10): cancela a sub remota e trava NOVAS
        // tentativas nos dois providers ate revisao manual. NUNCA "failed": failed libera
        // retry com nova idempotency key e possivel segunda cobranca.
        const normalized = normalizePagarmeStatus(sub.status);
        if (isSwitch && normalized !== "trialing") {
          console.error(
            `[pagarme-checkout] CRITICAL: switch subscription born ${sub.status} for workspace ${ctx.workspaceId} (subscription ${sub.id}); quarantining checkout`,
          );
          try {
            await gateway.cancelSubscription(sub.id);
          } catch (e) {
            console.error(
              "[pagarme-checkout] CRITICAL: quarantine cancel failed; subscription may be live AND charged:",
              e instanceof Error ? e.message : String(e),
            );
          }
          await finishAttempt("quarantined", sub.id);
          return { status: 500, body: GENERIC_500 };
        }
```

(o `const normalized` existente do passo 9 é substituído por este; o check born-non-live
existente continua logo abaixo, inalterado, usando o mesmo `normalized`)

(d) Colunas do bind (passo 10) ganham os markers:

```ts
        const columns = buildPagarmeSubscriptionColumns({
          customerId: customer.id,
          subscriptionId: sub.id,
          status: normalized,
          planId: reqData.planId,
          annualPriceCents: amountMirror.amountCents,
          currentPeriodEnd: temporal.current_period_end,
          everSubscribedAt: (row?.ever_subscribed_at as string | null) ?? nowIso,
          nowIso,
          switchedFromStripeSubscriptionId: isSwitch
            ? (row!.stripe_subscription_id as string)
            : null,
          switchedFromPlanId: isSwitch ? switchSourcePlanId : null,
        });
```

e o CAS ganha o pin extra (logo após o `.eq("provider", observedProvider)`):

```ts
          let bind = db
            .from("workspace_subscriptions")
            .update(columns)
            .eq("workspace_id", ctx.workspaceId)
            .eq("provider", observedProvider);
          if (isSwitch) {
            // Pin extra do switch: um webhook Stripe concorrente que mudou o status entre o
            // verify e o bind (deleted, renovacao) faz o CAS falhar -> compensa + 409.
            bind = bind.eq("status", row!.status as string);
          }
```

(e) Response do switch (substituindo o return final do try):

```ts
      const successBody = isSwitch
        ? {
          status: liveStatus,
          trial_ends_at: null,
          next_charge_at: currentPeriodEnd,
          installment_amount_cents: amountMirror.installmentAmountCents,
          switched: true,
          first_charge_at: currentPeriodEnd,
        }
        : {
          status: liveStatus,
          trial_ends_at: liveStatus === "trialing" ? currentPeriodEnd : null,
          next_charge_at: currentPeriodEnd,
          installment_amount_cents: amountMirror.installmentAmountCents,
        };
      await finishAttempt("succeeded", sub.id);
      return { status: 200, body: successBody };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts`
Expected: PASS (incluindo todos os pré-existentes: o checkout comum não mudou de
comportamento). Depois: `git checkout -- deno.lock`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pagarme-checkout/handler.ts supabase/functions/__tests__/pagarme-checkout-handler_test.ts
git commit -m "feat(billing): criacao do switch com start_at da fronteira + quarentena born-active"
```

---

### Task 7: Handler do checkout — perna Stripe com rollback + wiring do index

**Files:**
- Modify: `supabase/functions/pagarme-checkout/handler.ts`
- Modify: `supabase/functions/pagarme-checkout/index.ts`
- Test: `supabase/functions/__tests__/pagarme-checkout-handler_test.ts`

**Interfaces:**
- Consumes: `buildRestoreStripeColumns` (Task 3), `clearedAmountColumns` de `../_shared/stripe-amount.ts`, `writeWorkspacePlan` (já importado), `switchObserved`/`switchBoundary`/`switchSourcePlanId` (Task 5).
- Produces: perna `setCancelAtPeriodEnd(id, true)` como último passo do switch; falha → rollback completo (500) ou parcial (200 + CRITICAL). `finishAttempt` do switch movido para depois da perna.

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
Deno.test("switch: perna Stripe roda por ULTIMO e com sucesso -> 200 switched", async () => {
  const { events, stripeCalls, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 200);
  const leg = stripeCalls.find((c) => c.method === "setCancelAtPeriodEnd");
  assert(leg);
  assertEquals(leg!.args, ["sub_s1", true]);
  // attempt succeeded DEPOIS da perna: o update de state=succeeded e o ultimo evento de attempts
  const attemptWrites = events.filter(
    (e) => e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state !== undefined,
  );
  assertEquals(attemptWrites[attemptWrites.length - 1]?.values?.state, "succeeded");
});

Deno.test("switch: perna Stripe falha -> ROLLBACK completo, attempt failed, 500 retryable", async () => {
  const { events, calls, stripeCalls, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    { subStatus: "future", subStartAt: "2026-09-16" },
    { setCancelTrueThrows: new Error("stripe 500") },
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 500);
  assertEquals((res.body as { error?: string }).error, "Não foi possível concluir a troca. Tente novamente.");

  // (i) CAS flip-back pinado em pagarme+sub+trialing com colunas restauradas
  const updates = events.filter((e) => e.table === "workspace_subscriptions" && e.op === "update");
  const restore = updates.find((e) => e.values?.provider === "stripe")!;
  assert(restore, "flip-back deve existir");
  assert(restore.filters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "pagarme"));
  assert(restore.filters.some(([m, c, v]) => m === "eq" && c === "pagarme_subscription_id" && v === "sub_1"));
  assert(restore.filters.some(([m, c, v]) => m === "eq" && c === "status" && v === "trialing"));
  assertEquals(restore.values?.plan_id, "start");
  assertEquals(restore.values?.cancel_at_period_end, false); // valor OBSERVADO no verify
  assertEquals(restore.values?.pagarme_subscription_id, null);
  assertEquals(restore.values?.switched_from_stripe_subscription_id, null);

  // (ii) restore remoto do cap_end ao valor observado (timeout ambiguo)
  const restores = stripeCalls.filter((c) => c.method === "setCancelAtPeriodEnd");
  assertEquals(restores[restores.length - 1]?.args, ["sub_s1", false]);

  // (iv) DELETE da future sub
  assert(calls.some((c) => c.method === "cancelSubscription"));

  // attempt failed
  const attemptWrites = events.filter(
    (e) => e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state !== undefined,
  );
  assertEquals(attemptWrites[attemptWrites.length - 1]?.values?.state, "failed");
});

Deno.test("switch: rollback PARCIAL (flip-back CAS falha) -> troca fica de pe, 200 + succeeded", async () => {
  // bindZeroRows faria o PRIMEIRO CAS (bind) falhar tambem. Em vez disso o fixture precisa
  // falhar SO o segundo update de workspace_subscriptions: adicione ao makeDb o campo
  // `secondSubUpdateZeroRows?: boolean` que conta os updates da tabela e devolve [] a
  // partir do segundo. (Implemente no settle: `if (op === "update" && table === "workspace_subscriptions") { subUpdates++; if (fx.secondSubUpdateZeroRows && subUpdates >= 2) return { data: [], error: null }; ... }`)
  const { result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW, secondSubUpdateZeroRows: true },
    { subStatus: "future", subStartAt: "2026-09-16" },
    { setCancelTrueThrows: new Error("stripe 500") },
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { switched?: boolean }).switched, true);
});
```

(implemente `secondSubUpdateZeroRows` no makeDb como descrito no comentário: um contador
`let subUpdates = 0;` no escopo do `from`-factory não funciona porque cada `from()` cria um
chain novo — o contador vive no closure de `makeDb`, fora do `from`)

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts`
Expected: FAIL nos 3 novos.

- [ ] **Step 3: Implementar a perna + rollback**

(a) Imports: `clearedAmountColumns` de `../_shared/stripe-amount.ts`;
`buildRestoreStripeColumns` de `../_shared/pagarme-logic.ts`.

(b) Substitua o bloco final do try (o `successBody` + `finishAttempt` da Task 6) por:

```ts
      if (!isSwitch) {
        await finishAttempt("succeeded", sub.id);
        return {
          status: 200,
          body: {
            status: liveStatus,
            trial_ends_at: liveStatus === "trialing" ? currentPeriodEnd : null,
            next_charge_at: currentPeriodEnd,
            installment_amount_cents: amountMirror.installmentAmountCents,
          },
        };
      }

      // (12) Perna Stripe do switch, por ULTIMO. Falha -> ROLLBACK completo em-request
      // (spec pos-review Codex): perto da renovacao, esperar o cron das 06:00 abriria uma
      // janela real de cobranca dupla, nao o residual de segundos aceito. O leg D fica
      // como backstop apenas de CRASH entre o bind e esta perna.
      const switchSuccessBody = {
        status: liveStatus,
        trial_ends_at: null,
        next_charge_at: currentPeriodEnd,
        installment_amount_cents: amountMirror.installmentAmountCents,
        switched: true,
        first_charge_at: currentPeriodEnd,
      };
      try {
        await deps.stripeSwitch!.setCancelAtPeriodEnd(
          row!.stripe_subscription_id as string,
          true,
        );
      } catch (stripeLegErr) {
        console.error(
          "[pagarme-checkout] switch stripe leg failed, rolling back:",
          stripeLegErr instanceof Error ? stripeLegErr.message : String(stripeLegErr),
        );
        // (i) Flip-back local primeiro (ordem do undo): se o CAS falhar, NADA remoto foi
        // desfeito e a troca fica de pe com o leg D como recuperacao.
        const restore = buildRestoreStripeColumns({
          status: switchObserved!.status,
          cancelAtPeriodEnd: switchObserved!.cancelAtPeriodEnd,
          periodEndIso: switchBoundary!.toISOString(),
          sourcePlanId: switchSourcePlanId,
          amountColumns: clearedAmountColumns(),
          nowIso: new Date().toISOString(),
        });
        const { data: rolled, error: rollErr } = await db
          .from("workspace_subscriptions")
          .update(restore)
          .eq("workspace_id", ctx.workspaceId)
          .eq("provider", "pagarme")
          .eq("pagarme_subscription_id", sub.id)
          .eq("status", "trialing")
          .select("workspace_id")
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
        if (rollErr || !rolled?.length) {
          console.error(
            `[pagarme-checkout] CRITICAL: switch rollback CAS failed for workspace ${ctx.workspaceId}; switch stands, leg D will enforce the stripe cancel${rollErr ? `: ${rollErr.message}` : ""}`,
          );
          await finishAttempt("succeeded", sub.id);
          return { status: 200, body: switchSuccessBody };
        }
        // (ii) O timeout da perna e ambiguo: o true pode ter landado. Restaura o valor
        // OBSERVADO no verify (cobre a fonte em churn da decisao 7).
        try {
          await deps.stripeSwitch!.setCancelAtPeriodEnd(
            row!.stripe_subscription_id as string,
            switchObserved!.cancelAtPeriodEnd,
          );
        } catch (e) {
          console.error(
            "[pagarme-checkout] CRITICAL: rollback cap_end restore failed (mismatch self-surfaces via stripe webhooks, allowed again post flip-back):",
            e instanceof Error ? e.message : String(e),
          );
        }
        // (iii) Re-grant do plano-fonte (falha: CRITICAL, precedente do grant pos-bind).
        try {
          await writeWorkspacePlan(db, ctx.workspaceId, switchSourcePlanId!, "stripe");
        } catch (e) {
          console.error(
            `[pagarme-checkout] CRITICAL: rollback plan re-grant failed for workspace ${ctx.workspaceId}:`,
            e instanceof Error ? e.message : String(e),
          );
        }
        // (iv) DELETE da future sub (nada cobrado). Falha: leg C varre a orfa, ja que o
        // flip-back limpou pagarme_subscription_id (skip_linked desligado).
        try {
          await gateway.cancelSubscription(sub.id);
        } catch (e) {
          console.error(
            "[pagarme-checkout] rollback pagarme cancel failed (leg C sweeps the orphan):",
            e instanceof Error ? e.message : String(e),
          );
        }
        await finishAttempt("failed", sub.id);
        return {
          status: 500,
          body: { error: "Não foi possível concluir a troca. Tente novamente.", code: "gateway_error" },
        };
      }

      await finishAttempt("succeeded", sub.id);
      return { status: 200, body: switchSuccessBody };
```

(c) `pagarme-checkout/index.ts`: import + wiring:

```ts
import { createStripeSwitchGateway } from "../_shared/stripe-switch.ts";
```

e na construção do handler:

```ts
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const handle = createPagarmeCheckoutHandler({
      db: svc,
      gateway: createPagarmeGateway(),
      now: () => new Date(),
      stripeSwitch: stripeKey ? createStripeSwitchGateway(stripeKey) : null,
    });
```

- [ ] **Step 4: Rodar a suíte inteira do handler + logic e ver passar**

Run:
```bash
deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts && deno test supabase/functions/__tests__/pagarme-checkout-logic_test.ts
```
Expected: PASS. Depois: `git checkout -- deno.lock`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pagarme-checkout/handler.ts supabase/functions/pagarme-checkout/index.ts supabase/functions/__tests__/pagarme-checkout-handler_test.ts
git commit -m "feat(billing): perna Stripe do switch com rollback completo em-request"
```

---

### Task 8: Gate de quarentena no `billing-checkout` (fail closed)

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts`
- Modify: `supabase/functions/billing-checkout/index.ts`
- Test: `supabase/functions/__tests__/billing-logic_test.ts`

**Interfaces:**
- Produces: `quarantinedAttemptBlocksCheckout(found: boolean, readError: { message: string } | null | undefined): boolean` — fail CLOSED (contraste deliberado com `pendingPagarmeAttemptBlocksCheckout`, que fail-open).

- [ ] **Step 1: Testes (falhando)** — em `billing-logic_test.ts`, junto dos testes de `pendingPagarmeAttemptBlocksCheckout`:

```ts
Deno.test("quarantinedAttemptBlocksCheckout: encontrado bloqueia", () => {
  assertEquals(quarantinedAttemptBlocksCheckout(true, null), true);
});

Deno.test("quarantinedAttemptBlocksCheckout: ausente libera", () => {
  assertEquals(quarantinedAttemptBlocksCheckout(false, null), false);
});

Deno.test("quarantinedAttemptBlocksCheckout: erro de leitura FALHA FECHADO (contraste com pending)", () => {
  assertEquals(quarantinedAttemptBlocksCheckout(false, { message: "boom" }), true);
  // O gate de pending continua fail-open:
  assertEquals(pendingPagarmeAttemptBlocksCheckout(false, { message: "boom" }), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/billing-logic_test.ts`
Expected: FAIL (export inexistente).

- [ ] **Step 3: Implementar** — em `_shared/billing-logic.ts`, logo após `pendingPagarmeAttemptBlocksCheckout`:

```ts
/**
 * Gate de quarentena (spec do switch, decisao 10): uma attempt `quarantined` marca uma
 * cobranca possivelmente NAO estornada em revisao manual. Diferente do gate de pending
 * acima (fail-open: pending expira sozinho em 15min), este FALHA FECHADO: um erro de
 * leitura bloqueia o checkout, porque liberar poderia cobrar o usuario de novo antes da
 * revisao.
 */
export function quarantinedAttemptBlocksCheckout(
  found: boolean,
  readError: { message: string } | null | undefined,
): boolean {
  if (readError) return true;
  return found;
}
```

- [ ] **Step 4: Wiring no `billing-checkout/index.ts`** — logo APÓS o bloco do
`pendingPagarmeAttemptBlocksCheckout` (linha ~139), insira:

```ts
    // Quarentena (spec do switch, decisao 10): cobranca possivelmente nao estornada em
    // revisao manual bloqueia AMBOS os providers. Fail closed no erro de leitura.
    const { data: quarantinedAttempt, error: quarantinedErr } = await svc
      .from("pagarme_checkout_attempts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("state", "quarantined")
      .limit(1)
      .abortSignal(AbortSignal.timeout(10_000))
      .maybeSingle();
    if (quarantinedErr) {
      console.error(
        "[billing-checkout] quarantined attempt read failed, blocking (fail-closed):",
        quarantinedErr.message,
      );
    }
    if (quarantinedAttemptBlocksCheckout(!!quarantinedAttempt, quarantinedErr)) {
      return json(
        { error: "Encontramos uma cobrança que precisa de revisão. Fale com o suporte." },
        409,
        headers,
      );
    }
```

(acrescente `quarantinedAttemptBlocksCheckout` ao import de `_shared/billing-logic.ts` no
topo; `billing-checkout/index.ts` é monolítico e sem testes de handler — a cobertura é o
teste puro do Step 1)

- [ ] **Step 5: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/billing-logic_test.ts`
Expected: PASS. Depois: `git checkout -- deno.lock`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/billing-logic.ts supabase/functions/billing-checkout/index.ts supabase/functions/__tests__/billing-logic_test.ts
git commit -m "feat(billing): gate fail-closed de attempt quarentenada no billing-checkout"
```

---

### Task 9: Hardening do `billing-portal`

**Files:**
- Modify: `supabase/functions/billing-portal/index.ts`

**Interfaces:**
- Consumes: `stripePortalBlocked` (Task 3, já testado).

- [ ] **Step 1: Implementar** — em `billing-portal/index.ts`, o select da linha (linha ~46)
ganha as colunas e o gate:

```ts
    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_customer_id, provider, status, switched_from_stripe_subscription_id")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (!subRow?.stripe_customer_id) return json({ error: "No subscription" }, 400, headers);
    // Linha pagarme (in force ou com janela de switch viva) nao abre o portal: o "renovar"
    // de la desfaria o cancel_at_period_end na Stripe, o webhook resultante e negado
    // pos-flip e nada local perceberia ate o leg D (spec do switch).
    if (stripePortalBlocked(subRow)) {
      return json({ error: "Sua assinatura atual é gerenciada fora do portal Stripe." }, 409, headers);
    }
```

(import: `import { stripePortalBlocked } from "../_shared/pagarme-logic.ts";`)

- [ ] **Step 2: Verificação (função monolítica, sem testes de handler)**

Run: `deno check supabase/functions/billing-portal/index.ts`
Expected: sem erros de tipo. (A lógica do gate está testada na Task 3.) Depois: `git checkout -- deno.lock`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/billing-portal/index.ts
git commit -m "feat(billing): billing-portal 409 para linha pagarme (janela de switch)"
```

---

### Task 10: `pagarme-subscription` — roteamento do undo + regra de idempotência

**Files:**
- Modify: `supabase/functions/pagarme-subscription/handler.ts`
- Test: `supabase/functions/__tests__/pagarme-subscription-handler_test.ts`

**Interfaces:**
- Produces: regra de estado final (decisão 9) ANTES do 404; `run()` roteia `cancel` com
  `switched_from_stripe_subscription_id` + `status='trialing'` para `handleUndoSwitch`
  (stub nesta task: `{ status: 501, body: { error: "switch undo not implemented" } }`,
  substituído na Task 11); `handleCancel` ganha param `extraColumns: Record<string, unknown> = {}`
  mesclado nas colunas do CAS; select da linha ganha `switched_from_stripe_subscription_id, switched_from_plan_id`.
- Consumes (Task 11): `PagarmeSubscriptionDeps` ganha `stripeSwitch?: StripeSwitchGateway | null`.

- [ ] **Step 1: Testes (falhando)** — em `pagarme-subscription-handler_test.ts` (siga o
`run()` helper existente do arquivo; `ROW` base tem `provider: "pagarme"`):

```ts
Deno.test("idempotencia (decisao 9): linha stripe in-force sem pagarme id -> 200 reverted", async () => {
  const { result } = run(
    {
      subRow: {
        provider: "stripe",
        pagarme_customer_id: null,
        pagarme_subscription_id: null,
        status: "active",
        cancel_at_period_end: false,
        current_period_end: "2026-09-15T14:23:11Z",
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals(res.body, { status: "reverted", access_until: "2026-09-15T14:23:11Z" });
});

Deno.test("idempotencia: assinatura Stripe comum que NUNCA fez switch tambem recebe o no-op 200 (amplitude deliberada, antes 404)", async () => {
  const { events, result } = run(
    {
      subRow: {
        provider: null, // legado = stripe
        pagarme_customer_id: null,
        pagarme_subscription_id: null,
        status: "trialing",
        cancel_at_period_end: false,
        current_period_end: null,
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
  // no-op de verdade: nenhum write
  assert(!events.some((e) => e.op === "update"));
});

Deno.test("idempotencia NAO se aplica a update_card nem a linha stripe fora de vigor", async () => {
  const deadRow = {
    provider: "stripe",
    pagarme_customer_id: null,
    pagarme_subscription_id: null,
    status: "canceled",
    cancel_at_period_end: false,
    current_period_end: null,
    switched_from_stripe_subscription_id: null,
    switched_from_plan_id: null,
  };
  const r1 = await run({ subRow: deadRow }, {}, { action: "cancel" }).result;
  assertEquals(r1.status, 404);
  const r2 = await run(
    { subRow: { ...deadRow, status: "active" } },
    {},
    { action: "update_card", cardToken: "t", billingAddress: ADDRESS },
  ).result;
  assertEquals(r2.status, 404);
});

Deno.test("roteamento: marker + trialing vai para o undo, nunca para buildCancelColumns", async () => {
  const { calls, result } = run(
    {
      subRow: {
        provider: "pagarme",
        pagarme_customer_id: "cus_1",
        pagarme_subscription_id: SUB,
        status: "trialing",
        cancel_at_period_end: false,
        current_period_end: "2026-09-16T00:00:00Z",
        switched_from_stripe_subscription_id: "sub_s1",
        switched_from_plan_id: "start",
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  // Nesta task o undo e um stub 501; o pin aqui e o ROTEAMENTO: o cancel comum NAO rodou.
  assertEquals(res.status, 501);
  assert(!calls.some((c) => c.method === "cancelSubscription"));
});

Deno.test("regressao: cancel sem marker segue o fluxo comum (trialing = downgrade imediato)", async () => {
  const { calls, result } = run(
    {
      subRow: {
        provider: "pagarme",
        pagarme_customer_id: "cus_1",
        pagarme_subscription_id: SUB,
        status: "trialing",
        cancel_at_period_end: false,
        current_period_end: null,
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "canceled");
  assert(calls.some((c) => c.method === "cancelSubscription"));
});

Deno.test("regressao: marker + ACTIVE segue o cancel comum paid-through (undo so na janela)", async () => {
  const { result } = run(
    {
      subRow: {
        provider: "pagarme",
        pagarme_customer_id: "cus_1",
        pagarme_subscription_id: SUB,
        status: "active",
        cancel_at_period_end: false,
        current_period_end: "2027-09-16T00:00:00Z",
        switched_from_stripe_subscription_id: "sub_s1",
        switched_from_plan_id: "start",
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "canceled");
});
```

Se o `run()` do arquivo não expõe `events`/`calls` dessa forma, siga o shape dele (os
testes existentes mostram o padrão exato).

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/pagarme-subscription-handler_test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar em `pagarme-subscription/handler.ts`**

(a) Select da linha:

```ts
    .select(
      "provider, pagarme_customer_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end, switched_from_stripe_subscription_id, switched_from_plan_id",
    )
```

(b) Em `run()`, ANTES do check de 404 existente:

```ts
  // Decisao 9 do spec (idempotencia do undo, amplitude DELIBERADA): um retry do undo apos
  // resposta perdida encontra a linha ja flipada para stripe sem pagarme_subscription_id.
  // Uma assinatura Stripe comum que nunca fez switch tambem cai aqui e recebe o mesmo
  // no-op 200 (antes: 404) — inofensivo e pinado em teste de regressao.
  if (
    action.action === "cancel" &&
    row && ((row.provider as string | null) ?? "stripe") === "stripe" &&
    isInForce(row.status as string | null | undefined) &&
    !row.pagarme_subscription_id
  ) {
    return {
      status: 200,
      body: {
        status: "reverted",
        access_until: (row.current_period_end as string | null) ?? null,
      },
    };
  }
```

(c) O dispatch do cancel:

```ts
  if (action.action === "cancel") {
    // Janela de switch (marker + trialing): o cancel E o undo (decisao 1 do spec) e nunca
    // pode chegar em buildCancelColumns, que derrubaria o plano na hora.
    if (row.switched_from_stripe_subscription_id && row.status === "trialing") {
      return await handleUndoSwitch(deps, ctx, row, subId, now);
    }
    return await handleCancel(deps, ctx, row, subId, now);
  }
```

com o stub temporário:

```ts
async function handleUndoSwitch(
  _deps: PagarmeSubscriptionDeps,
  _ctx: SubscriptionContext,
  _row: Record<string, unknown>,
  _subId: string,
  _now: () => Date,
): Promise<SubscriptionResult> {
  return { status: 501, body: { error: "switch undo not implemented" } };
}
```

(d) `handleCancel` ganha o param extra (usado pela Task 11 no fallback terminal):

```ts
async function handleCancel(
  deps: PagarmeSubscriptionDeps,
  ctx: SubscriptionContext,
  row: Record<string, unknown>,
  subId: string,
  now: () => Date,
  extraColumns: Record<string, unknown> = {},
): Promise<SubscriptionResult> {
```

e o CAS usa `.update({ ...columns, ...extraColumns })`.

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/pagarme-subscription-handler_test.ts`
Expected: PASS (18 pré-existentes + 6 novos). Depois: `git checkout -- deno.lock`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pagarme-subscription/handler.ts supabase/functions/__tests__/pagarme-subscription-handler_test.ts
git commit -m "feat(billing): roteamento do undo + regra de idempotencia no pagarme-subscription"
```

---

### Task 11: `pagarme-subscription` — fluxo completo do undo + wiring

**Files:**
- Modify: `supabase/functions/pagarme-subscription/handler.ts`
- Modify: `supabase/functions/pagarme-subscription/index.ts`
- Test: `supabase/functions/__tests__/pagarme-subscription-handler_test.ts`

**Interfaces:**
- Consumes: `StripeSwitchGateway`, `assessStripeSourceSub`, `isStripeNotFoundError` (Task 2); `buildRestoreStripeColumns` (Task 3); `buildAmountColumns`, `clearedAmountColumns` de `../_shared/stripe-amount.ts`; `resolvePlanFromPriceId, PlanPriceRow` de `../_shared/billing-logic.ts`; `writeWorkspacePlan` de `../_shared/plan-writer.ts`; `handleCancel(..., extraColumns)` (Task 10).
- Produces: `PagarmeSubscriptionDeps` ganha `stripeSwitch?: StripeSwitchGateway | null`. Response do undo `{ status: "reverted", access_until: <ISO> }`. 409 de consolidação com copy por estado.

- [ ] **Step 1: Estender fixtures do teste**

(a) `makeDb`: o read de `plans` precisa distinguir `getDefaultPlanId` (filtro `is_default`)
da lista de price rows do fallback do plano-fonte:

```ts
      if (table === "plans") {
        if (filters.some(([m, c]) => m === "eq" && c === "is_default")) {
          return { data: fx.defaultPlan === undefined ? { id: "free" } : fx.defaultPlan, error: null };
        }
        return { data: fx.planPriceRows ?? [], error: null };
      }
```

(fixture novo: `planPriceRows?: Array<{ id: string; stripe_price_id: string | null; stripe_price_id_annual: string | null }>`)

(b) `makeDb` fixture: `casZeroRows` já existe; adicione `reReadRow?: Record<string, unknown> | null`
para o re-read pós-CAS-zero (é um segundo read de `workspace_subscriptions`; distinga por
contador: `let subReads = 0;` no closure de `makeDb`, o segundo read devolve `fx.reReadRow`),
e `secondCasZeroRows?: boolean` (retry pinado em canceled) com contador de updates análogo.
Adicione também `workspaceRow?: { plan_source: string }` para o read do plan-writer
(`workspaces` + read → `{ data: fx.workspaceRow ?? { plan_source: "system" }, error: null }`)
e um branch para `workspaces` + update (plan-writer write → `{ data: null, error: null }`).

(c) Fake do gateway Stripe (copie `makeStripeSwitch` + `STRIPE_SUB_MONTHLY` da Task 5 —
mesmo código; os arquivos de teste Deno não compartilham helpers entre si neste repo,
repita o bloco) e o `run()` do arquivo ganha o quarto fixture `swFx` igual ao da Task 5.

(d) `SWITCH_WINDOW_ROW` fixture:

```ts
const SWITCH_WINDOW_ROW = {
  provider: "pagarme",
  pagarme_customer_id: "cus_1",
  pagarme_subscription_id: SUB,
  status: "trialing",
  cancel_at_period_end: false,
  current_period_end: "2026-09-16T00:00:00Z",
  switched_from_stripe_subscription_id: "sub_s1",
  switched_from_plan_id: "start",
};
```

- [ ] **Step 2: Testes do undo (falhando)**

```ts
Deno.test("undo happy path: leituras -> cap_end=false -> CAS restaurando plan_id -> grant stripe -> DELETE -> reverted", async () => {
  const { events, calls, stripeCalls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals(res.body, { status: "reverted", access_until: "2026-09-15T14:23:11.000Z" });

  // ordem: retrieve e fetchAmount ANTES do setCancelAtPeriodEnd(false)
  const methods = stripeCalls.map((c) => c.method);
  const reactivateIdx = methods.indexOf("setCancelAtPeriodEnd");
  assert(methods.indexOf("retrieveSubscription") < reactivateIdx);
  assert(methods.indexOf("fetchAmount") < reactivateIdx);
  assertEquals(stripeCalls[reactivateIdx].args, ["sub_s1", false]);

  // CAS: pins pagarme + sub + trialing; colunas restauram plan_id do marker e limpam tudo
  const cas = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "pagarme"));
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "pagarme_subscription_id" && v === SUB));
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "status" && v === "trialing"));
  assertEquals(cas.values?.provider, "stripe");
  assertEquals(cas.values?.plan_id, "start");
  assertEquals(cas.values?.pagarme_subscription_id, null);
  assertEquals(cas.values?.switched_from_stripe_subscription_id, null);
  assertEquals(cas.values?.switched_from_plan_id, null);
  assertEquals(cas.values?.cancel_at_period_end, false);
  // mirror restaurado do fetchAmount (amount_cents 9990 no fake)
  assertEquals(cas.values?.amount_cents, 9990);

  // grant do plano-fonte via workspaces (plan-writer), plan_source stripe
  const planWrite = events.find((e) => e.table === "workspaces" && e.op === "update")!;
  assertEquals(planWrite.values?.plan_id, "start");
  assertEquals(planWrite.values?.plan_source, "stripe");

  // DELETE da future sub por ultimo
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === SUB));
});

Deno.test("undo: stripeSwitch null -> 500 sem nada remoto/local", async () => {
  const { events, calls, result } = run({ subRow: SWITCH_WINDOW_ROW }, {}, { action: "cancel" }, null);
  const res = await result;
  assertEquals(res.status, 500);
  assertEquals(calls.length, 0);
  assert(!events.some((e) => e.op === "update"));
});

Deno.test("undo: cap_end=false falha -> rearme imediato cap_end=true + 500 sem writes locais", async () => {
  const { events, stripeCalls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { setCancelFalseThrows: new Error("timeout ambiguo") },
  );
  const res = await result;
  assertEquals(res.status, 500);
  const sets = stripeCalls.filter((c) => c.method === "setCancelAtPeriodEnd");
  assertEquals(sets.map((c) => c.args[1]), [false, true]); // tentativa + rearme
  assert(!events.some((e) => e.table === "workspace_subscriptions" && e.op === "update"));
});

Deno.test("undo: erro de DB no CAS -> compensacao cap_end=true + 500", async () => {
  const { stripeCalls, result } = run(
    { subRow: SWITCH_WINDOW_ROW, casError: { message: "db down" } },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 500);
  const sets = stripeCalls.filter((c) => c.method === "setCancelAtPeriodEnd");
  assertEquals(sets[sets.length - 1]?.args, ["sub_s1", true]);
});

Deno.test("undo: fetchAmount falha -> mirror CLEARED no mesmo statement, fluxo segue", async () => {
  const { events, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { amountThrows: new Error("stripe amount down") },
  );
  const res = await result;
  assertEquals(res.status, 200);
  const cas = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(cas.values?.amount_cents, null);
  assertEquals(cas.values?.amount_refreshed_at, null);
});

Deno.test("undo: marker de plano null usa resolvePlanFromPriceId; ambos null -> grant pulado + CRITICAL", async () => {
  const row = { ...SWITCH_WINDOW_ROW, switched_from_plan_id: null };
  // fallback resolve pelo price do assess (price_m1 -> start)
  const r1 = run(
    { subRow: row, planPriceRows: [{ id: "start", stripe_price_id: "price_m1", stripe_price_id_annual: null }] },
    {},
    { action: "cancel" },
    {},
  );
  const res1 = await r1.result;
  assertEquals(res1.status, 200);
  const cas = r1.events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(cas.values?.plan_id, "start");
  // ambos null: sem plan_id no CAS e sem write em workspaces
  const r2 = run({ subRow: row, planPriceRows: [] }, {}, { action: "cancel" }, {});
  const res2 = await r2.result;
  assertEquals(res2.status, 200);
  const cas2 = r2.events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assert(!("plan_id" in (cas2.values ?? {})));
  assert(!r2.events.some((e) => e.table === "workspaces" && e.op === "update"));
});

Deno.test("undo: remota terminal (canceled) -> fallback cancel comum limpando os DOIS markers no mesmo CAS", async () => {
  const { events, calls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { retrieveResult: { ...STRIPE_SUB_MONTHLY, status: "canceled" } },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "canceled");
  assert(calls.some((c) => c.method === "cancelSubscription")); // cancel comum cancela a pagarme
  const cas = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(cas.values?.switched_from_stripe_subscription_id, null);
  assertEquals(cas.values?.switched_from_plan_id, null);
  assertEquals(cas.values?.status, "canceled");
});

Deno.test("undo zero-rows -> re-read ACTIVE (fronteira cruzou): consolidacao cancelNow + 409", async () => {
  const { stripeCalls, result } = run(
    {
      subRow: SWITCH_WINDOW_ROW,
      casZeroRows: true,
      reReadRow: { provider: "pagarme", status: "active", pagarme_subscription_id: SUB },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals(
    (res.body as { error?: string }).error,
    "A troca já foi concluída e a primeira parcela foi cobrada.",
  );
  assert(stripeCalls.some((c) => c.method === "cancelNow"));
});

Deno.test("undo zero-rows -> re-read PAST_DUE: consolidacao com copy de cobranca pendente", async () => {
  const { result } = run(
    {
      subRow: SWITCH_WINDOW_ROW,
      casZeroRows: true,
      reReadRow: { provider: "pagarme", status: "past_due", pagarme_subscription_id: SUB },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals(
    (res.body as { error?: string }).error,
    "A troca já foi concluída e a primeira cobrança está pendente. Atualize o cartão ou cancele a assinatura.",
  );
});

Deno.test("undo zero-rows -> re-read provider stripe: 200 reverted idempotente", async () => {
  const { result } = run(
    {
      subRow: SWITCH_WINDOW_ROW,
      casZeroRows: true,
      reReadRow: { provider: "stripe", status: "active", pagarme_subscription_id: null },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
});

Deno.test("undo: DELETE da pagarme falha -> ainda 200 reverted (leg C e o backstop)", async () => {
  const { result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    { cancelThrows: new Error("gateway down") },
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
});

Deno.test("undo: retry pos-undo com resposta perdida PARTE do estado final -> 200 reverted (decisao 9)", async () => {
  // Estado FINAL do undo: provider stripe, sem pagarme id, markers limpos, active.
  const { result } = run(
    {
      subRow: {
        provider: "stripe",
        pagarme_customer_id: "cus_1",
        pagarme_subscription_id: null,
        status: "active",
        cancel_at_period_end: false,
        current_period_end: "2026-09-15T14:23:11Z",
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
});
```

- [ ] **Step 3: Rodar e ver falhar** (o stub 501 derruba quase todos)

Run: `deno test supabase/functions/__tests__/pagarme-subscription-handler_test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar `handleUndoSwitch`** (substitui o stub):

```ts
const UNDO_500 = {
  status: 500,
  body: { error: "Erro ao desfazer a troca. Tente novamente.", code: "gateway_error" },
} as const;

async function handleUndoSwitch(
  deps: PagarmeSubscriptionDeps,
  ctx: SubscriptionContext,
  row: Record<string, unknown>,
  subId: string,
  now: () => Date,
): Promise<SubscriptionResult> {
  const { db, gateway } = deps;
  const stripeSwitch = deps.stripeSwitch ?? null;
  const nowIso = now().toISOString();
  const marker = row.switched_from_stripe_subscription_id as string;
  if (!stripeSwitch) {
    console.error("[pagarme-subscription] undo requested but no Stripe gateway configured");
    return { ...UNDO_500 };
  }
  // Compensacao dos exits pos-mutacao (spec, review rodada 2): o cap_end=false pode ter
  // landado num timeout ambiguo, entao TODO exit entre a mutacao e o flip confirmado
  // rearma true imediatamente; so se o rearme tambem falhar o leg D vira backstop.
  const rearm = async () => {
    try {
      await stripeSwitch.setCancelAtPeriodEnd(marker, true);
    } catch (e) {
      console.error(
        "[pagarme-subscription] CRITICAL: undo rearm failed; leg D must re-enforce the stripe cancel:",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  // ── (1) LEITURAS primeiro: nada remoto e mutado ate tudo estar em maos. ──
  let remote: unknown;
  try {
    remote = await stripeSwitch.retrieveSubscription(marker);
  } catch (e) {
    if (isStripeNotFoundError(e)) {
      // Stripe morta remotamente (decisao 4): nao ha para onde voltar. Cancel comum
      // limpando os DOIS markers no mesmo CAS.
      return await handleCancel(deps, ctx, row, subId, now, {
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      });
    }
    console.error(
      "[pagarme-subscription] undo retrieve failed:",
      e instanceof Error ? e.message : String(e),
    );
    return { ...UNDO_500 };
  }
  const assessed = assessStripeSourceSub(remote, now());
  if (!assessed.ok) {
    if (assessed.code === "not_in_force") {
      // canceled/incomplete_expired remoto = decisao 4 (fallback).
      return await handleCancel(deps, ctx, row, subId, now, {
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      });
    }
    // not_monthly/malformed/boundary_elapsed: transiente ou estado inesperado; nada mudou.
    console.error(`[pagarme-subscription] undo assess failed: ${assessed.code}`);
    return { ...UNDO_500 };
  }

  let amountColumns: Record<string, unknown>;
  try {
    amountColumns = buildAmountColumns(await stripeSwitch.fetchAmount(marker));
  } catch (e) {
    // Cleared se auto-cura na leitura do admin (precedente stripe-webhook).
    console.warn(
      "[pagarme-subscription] undo amount fetch failed, clearing mirror:",
      e instanceof Error ? e.message : String(e),
    );
    amountColumns = clearedAmountColumns();
  }

  let sourcePlanId = (row.switched_from_plan_id as string | null) ?? null;
  if (!sourcePlanId && assessed.priceId) {
    const { data: planRows, error: planErr } = await db
      .from("plans")
      .select("id, stripe_price_id, stripe_price_id_annual")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (planErr) {
      console.error("[pagarme-subscription] undo plan rows read failed:", planErr.message);
    } else {
      sourcePlanId =
        resolvePlanFromPriceId(assessed.priceId, (planRows ?? []) as PlanPriceRow[])?.plan_id ??
          null;
    }
  }
  if (!sourcePlanId) {
    console.error(
      `[pagarme-subscription] CRITICAL: undo has no restorable source plan for workspace ${ctx.workspaceId}; plan grant will be skipped`,
    );
  }

  // ── (2) Mutacao remota: reativa o mensal. Falha -> rearme imediato + 500. ──
  try {
    await stripeSwitch.setCancelAtPeriodEnd(marker, false);
  } catch (e) {
    console.error(
      "[pagarme-subscription] undo reactivation failed:",
      e instanceof Error ? e.message : String(e),
    );
    await rearm();
    return { ...UNDO_500 };
  }

  // ── (3) CAS flip-back num statement. ──
  const columns = buildRestoreStripeColumns({
    status: assessed.status,
    cancelAtPeriodEnd: false, // o undo ACABOU de reativar
    periodEndIso: assessed.periodEnd.toISOString(),
    sourcePlanId,
    amountColumns,
    nowIso,
  });
  const runCas = (statusPin: string) =>
    db
      .from("workspace_subscriptions")
      .update(columns)
      .eq("workspace_id", ctx.workspaceId)
      .eq("provider", "pagarme")
      .eq("pagarme_subscription_id", subId)
      .eq("status", statusPin)
      .select("workspace_id")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  const { data: casRows, error: casErr } = await runCas("trialing");
  if (casErr) {
    console.error("[pagarme-subscription] undo CAS failed:", casErr.message);
    await rearm();
    return { ...UNDO_500 };
  }
  if (!casRows?.length) {
    // Fronteira/transicao cruzou o undo em voo: re-read e branch (decisao 8).
    const { data: current, error: reErr } = await db
      .from("workspace_subscriptions")
      .select("provider, status, pagarme_subscription_id")
      .eq("workspace_id", ctx.workspaceId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (reErr) {
      console.error("[pagarme-subscription] undo re-read failed:", reErr.message);
      await rearm();
      return { ...UNDO_500 };
    }
    const st = current?.status as string | undefined;
    if (((current?.provider as string | null) ?? "stripe") === "stripe") {
      return {
        status: 200,
        body: { status: "reverted", access_until: assessed.periodEnd.toISOString() },
      };
    }
    if (st === "active" || st === "past_due") {
      // A 1a parcela disparou (ou falhou) durante o undo; a Stripe ja morreu na fronteira
      // e o cap_end=false do passo 2 pode te-la renovado: consolida cancelando JA.
      console.error(
        `[pagarme-subscription] CRITICAL: switch boundary crossed mid-undo for workspace ${ctx.workspaceId}; consolidating (stripe cancelNow)`,
      );
      try {
        await stripeSwitch.cancelNow(marker);
      } catch (e) {
        console.error(
          "[pagarme-subscription] CRITICAL: consolidation cancelNow failed; leg D repeats it:",
          e instanceof Error ? e.message : String(e),
        );
      }
      return {
        status: 409,
        body: {
          error: st === "past_due"
            ? "A troca já foi concluída e a primeira cobrança está pendente. Atualize o cartão ou cancele a assinatura."
            : "A troca já foi concluída e a primeira parcela foi cobrada.",
        },
      };
    }
    if (st === "canceled") {
      // 12x morreu em voo; o undo continua correto (restaurar a Stripe). Um retry pinado.
      const { data: retryRows, error: retryErr } = await runCas("canceled");
      if (retryErr || !retryRows?.length) {
        // Residual documentado no spec: dead-end raro (12x morto em voo + retry falhou);
        // suporte resolve via CRITICAL. NAO rearma: a Stripe reativada e o que o usuario quer.
        console.error(
          `[pagarme-subscription] CRITICAL: undo retry CAS failed for workspace ${ctx.workspaceId}; manual repair needed${retryErr ? `: ${retryErr.message}` : ""}`,
        );
        return { ...UNDO_500 };
      }
    } else {
      await rearm();
      return { ...UNDO_500 };
    }
  }

  // ── (4) Plano-fonte de volta (plan-writer respeita comp manual). ──
  if (sourcePlanId) {
    try {
      await writeWorkspacePlan(db, ctx.workspaceId, sourcePlanId, "stripe");
    } catch (e) {
      console.error(
        `[pagarme-subscription] CRITICAL: undo plan re-grant failed for workspace ${ctx.workspaceId}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // ── (5) DELETE best-effort da future sub (nada cobrado; leg C e o backstop, ja que o
  // CAS limpou pagarme_subscription_id e o skip_linked desligou). ──
  try {
    await gateway.cancelSubscription(subId);
  } catch (e) {
    console.error(
      "[pagarme-subscription] CRITICAL: undo pagarme delete failed (leg C sweeps the orphan):",
      e instanceof Error ? e.message : String(e),
    );
  }

  return {
    status: 200,
    body: { status: "reverted", access_until: assessed.periodEnd.toISOString() },
  };
}
```

Imports novos no topo do handler:

```ts
import {
  buildRestoreStripeColumns,
  isDefinitiveGatewayReject,
  isInForce,
} from "../_shared/pagarme-logic.ts";
import {
  assessStripeSourceSub,
  isStripeNotFoundError,
  StripeSwitchGateway,
} from "../_shared/stripe-switch.ts";
import { buildAmountColumns, clearedAmountColumns } from "../_shared/stripe-amount.ts";
import { getDefaultPlanId, PlanPriceRow, resolvePlanFromPriceId } from "../_shared/billing-logic.ts";
import { writeWorkspacePlan } from "../_shared/plan-writer.ts";
```

e `PagarmeSubscriptionDeps` ganha:

```ts
  /** Porta Stripe do undo do switch. null/ausente = ambiente dark: undo 500a. */
  stripeSwitch?: StripeSwitchGateway | null;
```

(d) `pagarme-subscription/index.ts` — wiring:

```ts
import { createStripeSwitchGateway } from "../_shared/stripe-switch.ts";
```

```ts
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const result = await handleSubscriptionAction(
      {
        db: svc,
        gateway: createPagarmeSubscriptionGateway(),
        stripeSwitch: stripeKey ? createStripeSwitchGateway(stripeKey) : null,
      },
      { workspaceId },
      parsed.value,
    );
```

- [ ] **Step 5: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/pagarme-subscription-handler_test.ts && deno test supabase/functions/__tests__/pagarme-subscription-logic_test.ts`
Expected: PASS. Depois: `git checkout -- deno.lock`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/pagarme-subscription/ supabase/functions/__tests__/pagarme-subscription-handler_test.ts
git commit -m "feat(billing): undo do switch com compensacao e consolidacao de fronteira"
```

---

### Task 12: Leg D do `billing-downgrade-cron` (rotação justa + enforcement)

**Files:**
- Modify: `supabase/functions/billing-downgrade-cron/handler.ts`
- Modify: `supabase/functions/billing-downgrade-cron/index.ts`
- Test: `supabase/functions/__tests__/billing-downgrade-cron-handler_test.ts`
- Modify (doc): `CLAUDE.md` (linha da env `STRIPE_SECRET_KEY`: mencionar que billing-downgrade-cron a usa opcionalmente para o leg D; ausente = leg pulado)

**Interfaces:**
- Consumes: `StripeSwitchGateway`, `readStripeSubSnapshot`, `isStripeNotFoundError`, `createStripeSwitchGateway` (Task 2).
- Produces: `DowngradeCronDeps` ganha `stripeGateway: StripeSwitchGateway | null`; `CronResult` ganha `switchesEnforced: number; switchesCleared: number; switchesCanceledNow: number; switchSkipped: boolean; switchSweepTruncated: boolean`.

- [ ] **Step 1: Ler o fixture existente do teste**

Run: `sed -n '1,120p' supabase/functions/__tests__/billing-downgrade-cron-handler_test.ts`
O arquivo tem um `makeDb` house-pattern (thenable chain com events por tabela/op). Os
steps seguintes descrevem os testes em termos desse padrão — adapte os nomes de fixture ao
que o arquivo realmente usa, mantendo as ASSERÇÕES exatamente como abaixo.

- [ ] **Step 2: Estender fixtures**

(a) `makeDb`: fixture `markerRows?: Array<Record<string, unknown>>` — devolvido pelo read
de `workspace_subscriptions` cujos filtros contêm o predicado do leg D (`.not(...)` sobre
`switched_from_stripe_subscription_id` + `.or(...)`). Como o leg D pagina até esvaziar, o
fixture deve devolver `markerRows` na PRIMEIRA leitura e `[]` nas seguintes (contador no
closure), exceto no teste de duas páginas, que usa
`markerPages?: Array<Array<Record<string, unknown>>>` (uma página por leitura). Adicione
`chain.not`, `chain.or`, `chain.order`, `chain.limit` como no-ops que retornam o chain
(alguns já existem para os legs A-C). O re-read pós-enforce (select de
`switched_from_stripe_subscription_id` com eq workspace_id) se distingue por ser um
`maybeSingle` — devolva `fx.recheckRow ?? { switched_from_stripe_subscription_id: "sub_s1" }`.
Updates de `workspace_subscriptions` com `values.switch_checked_at` são os carimbos;
updates com `values.switched_from_stripe_subscription_id === null` são o clear.

(b) Copie o `makeStripeSwitch` (Task 5) para este arquivo, acrescentando
`retrieveResults?: Record<string, unknown>` (map por sub id) para múltiplas linhas.

(c) `run()` do arquivo ganha `stripeGateway` nas deps (null por default nos testes
existentes — eles continuam passando porque o leg D com gateway null só seta
`switchSkipped`).

- [ ] **Step 3: Testes (falhando)** — asserções a pinar:

```ts
// Fixtures basicos
const MARKER_ROW = {
  workspace_id: "ws-1",
  provider: "pagarme",
  status: "trialing",
  current_period_end: "2026-09-16T00:00:00Z",
  switched_from_stripe_subscription_id: "sub_s1",
  switched_from_plan_id: "start",
  pagarme_subscription_id: "sub_pm_1",
  switch_checked_at: null,
};
const REMOTE_ACTIVE_NO_CAP = {
  status: "active",
  cancel_at_period_end: false,
  current_period_end: Math.floor(Date.parse("2026-09-15T14:23:11Z") / 1000),
  items: { data: [{ price: { id: "price_m1", recurring: { interval: "month" } } }] },
};

Deno.test("leg D: gateway null -> switchSkipped true, nenhuma linha tocada", async () => {
  // markerRows presentes mas stripeGateway null
  // asserte: result.switchSkipped === true; nenhum update de switch_checked_at
});

Deno.test("leg D enforce: janela aberta + remoto ativo sem cap_end -> setCancelAtPeriodEnd(true) + carimbo", async () => {
  // markerRows: [MARKER_ROW]; retrieveResult: REMOTE_ACTIVE_NO_CAP; recheckRow com marker
  // asserte: stripeCalls contem ["sub_s1", true]; switchesEnforced === 1;
  //          um update com values.switch_checked_at definido (carimbo);
  //          NENHUM clear (status trialing mantem markers)
});

Deno.test("leg D: re-read pos-write sem marker (undo correu no meio) -> reverte para false", async () => {
  // recheckRow: { switched_from_stripe_subscription_id: null }
  // asserte: sets = [true, false] nessa ordem; switchesEnforced === 0
});

Deno.test("leg D: renovacao escapou (period end remoto > fronteira) -> cancelNow + CRITICAL", async () => {
  // remoto com current_period_end = 2026-10-15 (> fronteira 2026-09-16)
  // asserte: cancelNow chamado; switchesCanceledNow === 1
});

Deno.test("leg D: janela fechada (status != trialing) + remoto seguro -> clear dos DOIS markers", async () => {
  // MARKER_ROW com status "active"; retrieveResult com cancel_at_period_end: true
  // asserte: update com switched_from_stripe_subscription_id: null E switched_from_plan_id: null,
  //          pins eq workspace_id + eq switched_from_stripe_subscription_id + neq status trialing;
  //          switchesCleared === 1
});

Deno.test("leg D: remoto 404 e seguro; retrieve com erro nao-404 coleta erro e SEGUE para a proxima linha", async () => {
  // duas linhas: a primeira com retrieveThrows generico, a segunda 404 + status active
  // asserte: errors.length === 1; a segunda linha foi processada (clear ou carimbo)
});

Deno.test("leg D rotacao intra-run: duas paginas na MESMA execucao, cada workspace UMA vez", async () => {
  // markerPages: [pagina de 100 (ws-0..ws-99)], [pagina com ws-100], []]
  // asserte: 101 carimbos, ids distintos, nenhum repetido
});

Deno.test("leg D: carimbo mesmo no caso 'seguro mas trialing' (fila avanca)", async () => {
  // MARKER_ROW trialing + remoto com cap_end ja true
  // asserte: update de switch_checked_at existe; markers NAO limpos
});
```

Escreva cada corpo seguindo o padrão de asserção dos testes dos legs A-C no mesmo arquivo
(eles verificam `result.<contador>` e os `events` do makeDb). Os comentários acima definem
o CONTRATO de cada teste; o corpo é mecânico no padrão da casa.

- [ ] **Step 4: Implementar o leg D** — em `billing-downgrade-cron/handler.ts`:

(a) Imports/constantes/deps/result:

```ts
import {
  isStripeNotFoundError,
  readStripeSubSnapshot,
  type StripeSwitchGateway,
} from "../_shared/stripe-switch.ts";
```

```ts
const SWITCH_BATCH_LIMIT = 100;
const SWITCH_MAX_PAGES = 20;
```

`DowngradeCronDeps` ganha `stripeGateway: StripeSwitchGateway | null;`
`CronResult` ganha os 5 campos (Interfaces acima); inicialize
`let switchesEnforced = 0; let switchesCleared = 0; let switchesCanceledNow = 0; let switchSkipped = false; let switchSweepTruncated = false;`
e inclua-os no objeto retornado.

(b) O leg:

```ts
  // ── Leg D: enforcement do switch (spec 2026-08-14) ────────────────────────
  // Rotacao justa por switch_checked_at: markers persistem a janela inteira (ate ~31d),
  // entao um limit fixo ou keyset do menor workspace_id deixaria a cauda sem enforcement
  // para sempre (diferente do leg C, cujo conjunto avanca porque orfas sao removidas).
  // runStartedAt + carimbo por linha: dentro do run cada workspace aparece UMA vez (o
  // carimbo tira a linha do predicado), e entre runs a fila retoma do mais antigo.
  async function runLegD(): Promise<void> {
    if (deps.stripeGateway === null) {
      switchSkipped = true;
      console.warn("[billing-downgrade-cron] STRIPE_SECRET_KEY unset; leg D skipped");
      return;
    }
    const stripeGateway = deps.stripeGateway;
    try {
      const runStartedAt = now().toISOString();
      let pages = 0;
      while (true) {
        const { data: batch, error: batchErr } = await deps.db
          .from("workspace_subscriptions")
          .select(
            "workspace_id, provider, status, current_period_end, switched_from_stripe_subscription_id, switched_from_plan_id, pagarme_subscription_id, switch_checked_at",
          )
          .not("switched_from_stripe_subscription_id", "is", null)
          .or(`switch_checked_at.is.null,switch_checked_at.lt.${runStartedAt}`)
          .order("switch_checked_at", { ascending: true, nullsFirst: true })
          .order("workspace_id", { ascending: true })
          .limit(SWITCH_BATCH_LIMIT)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
        if (batchErr) throw new Error(`leg D batch read failed: ${batchErr.message}`);
        const rows = (batch ?? []) as Array<Record<string, unknown>>;
        if (rows.length === 0) break;
        pages++;

        for (const row of rows) {
          const wsId = row.workspace_id as string;
          const marker = row.switched_from_stripe_subscription_id as string;
          // Carimbo PRIMEIRO: garante progresso da fila mesmo quando o processamento da
          // linha falha. Um carimbo que falha ABORTA o leg (rethrow): sem ele a mesma
          // linha voltaria no proximo batch deste run em loop infinito.
          const { error: stampErr } = await deps.db
            .from("workspace_subscriptions")
            .update({ switch_checked_at: new Date().toISOString() })
            .eq("workspace_id", wsId)
            .not("switched_from_stripe_subscription_id", "is", null)
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          if (stampErr) throw new Error(`leg D stamp failed for ${wsId}: ${stampErr.message}`);

          try {
            let remote: unknown | null = null;
            let notFound = false;
            try {
              remote = await stripeGateway.retrieveSubscription(marker);
            } catch (e) {
              if (isStripeNotFoundError(e)) {
                notFound = true; // sub nao existe mais: seguro
              } else {
                errors.push(`leg D retrieve failed for workspace ${wsId}: ${errMessage(e)}`);
                continue;
              }
            }
            const snap = notFound ? null : readStripeSubSnapshot(remote);
            let safe = snap === null ||
              snap.status === "canceled" ||
              snap.status === "incomplete_expired" ||
              snap.cancelAtPeriodEnd;

            if (!safe) {
              const boundaryMs = typeof row.current_period_end === "string"
                ? Date.parse(row.current_period_end)
                : NaN;
              const windowOpen = row.provider === "pagarme" && row.status === "trialing";
              const renewalFired = Number.isFinite(boundaryMs) &&
                snap!.periodEndMs !== null && snap!.periodEndMs > boundaryMs;
              if (windowOpen && !renewalFired) {
                await stripeGateway.setCancelAtPeriodEnd(marker, true);
                switchesEnforced++;
                // Re-read pos-write: o undo pode ter corrido no meio e limpado o marker;
                // nesse caso o mensal foi REATIVADO de proposito — reverte o true.
                const { data: recheck, error: recheckErr } = await deps.db
                  .from("workspace_subscriptions")
                  .select("switched_from_stripe_subscription_id")
                  .eq("workspace_id", wsId)
                  .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
                  .maybeSingle();
                if (recheckErr) {
                  errors.push(`leg D recheck failed for workspace ${wsId}: ${recheckErr.message}`);
                  continue;
                }
                if (!recheck?.switched_from_stripe_subscription_id) {
                  await stripeGateway.setCancelAtPeriodEnd(marker, false);
                  switchesEnforced--;
                }
                continue; // janela aberta: markers ficam (undo/frontend dependem deles)
              }
              // Renovacao escapou ou a janela fechou com o mensal ainda armado: cap_end=true
              // agora esperaria mais um mes inteiro — cancela JA e aponta o refund manual.
              console.error(
                `[billing-downgrade-cron] CRITICAL: leg D canceling stripe sub ${marker} NOW for workspace ${wsId} (renewal escaped or window closed); check for a renewal charge to refund manually`,
              );
              await stripeGateway.cancelNow(marker);
              switchesCanceledNow++;
              safe = true;
            }

            // Clear so quando seguro E fora da janela (trialing precisa dos markers).
            if (safe && row.status !== "trialing") {
              const { error: clearErr } = await deps.db
                .from("workspace_subscriptions")
                .update({
                  switched_from_stripe_subscription_id: null,
                  switched_from_plan_id: null,
                  updated_at: nowIso,
                })
                .eq("workspace_id", wsId)
                .eq("switched_from_stripe_subscription_id", marker)
                .neq("status", "trialing")
                .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
              if (clearErr) {
                errors.push(`leg D clear failed for workspace ${wsId}: ${clearErr.message}`);
                continue;
              }
              switchesCleared++;
            }
          } catch (e) {
            errors.push(`leg D row failed for workspace ${wsId}: ${errMessage(e)}`);
          }
        }

        if (pages >= SWITCH_MAX_PAGES) {
          switchSweepTruncated = true;
          errors.push("leg D truncated at SWITCH_MAX_PAGES pages");
          break;
        }
      }
    } catch (e) {
      errors.push(`leg D failed: ${errMessage(e)}`);
    }
  }
```

e chame `await runLegD();` depois de `await runLegC();`.

(c) `index.ts`:

```ts
import { createStripeSwitchGateway } from "../_shared/stripe-switch.ts";
```

```ts
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    ...
      const deps: DowngradeCronDeps = {
        db: svc,
        gateway,
        stripeGateway: stripeKey ? createStripeSwitchGateway(stripeKey) : null,
        now: () => new Date(),
      };
```

(d) `CLAUDE.md`: na entrada de `STRIPE_SECRET_KEY`, acrescente: "também usada
(opcionalmente) pelo billing-downgrade-cron para o leg D do switch; ausente = leg pulado
com `switchSkipped: true`".

- [ ] **Step 5: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/billing-downgrade-cron-handler_test.ts`
Expected: PASS (18 pré-existentes + 8 novos). Depois: `git checkout -- deno.lock`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/billing-downgrade-cron/ supabase/functions/__tests__/billing-downgrade-cron-handler_test.ts CLAUDE.md
git commit -m "feat(billing): leg D do cron com rotacao justa para enforcement do switch"
```

---

### Task 13: Frontend — `services/billing.ts`

**Files:**
- Modify: `apps/crm/src/services/billing.ts`
- Test: `apps/crm/src/services/__tests__/billing.test.ts`

**Interfaces:**
- Produces (usados pelas Tasks 14-16):
  - `WorkspaceSubscription` ganha `billingInterval: string | null` e `switchScheduled: boolean` (o id cru `switched_from_stripe_subscription_id` é descartado como os demais)
  - `PagarmeCheckoutPayload` ganha `switch?: true`
  - `PagarmeCheckoutResult` ganha `switched?: boolean; first_charge_at?: string | null`
  - `cancelPagarmeSubscription(): Promise<{ status: 'canceled' | 'reverted'; access_until: string | null }>`

- [ ] **Step 1: Atualizar o teste pinado do select (falhando)**

Em `billing.test.ts` (linha ~239) a string exata do select é assertada. Atualize para:

```
'status, plan_id, current_period_end, cancel_at_period_end, past_due_since, next_payment_attempt, provider, installments, billing_interval, stripe_subscription_id, pagarme_subscription_id, ever_subscribed_at, switched_from_stripe_subscription_id'
```

e adicione testes de derivação:

```ts
it('expõe billingInterval e deriva switchScheduled do marker, descartando o id cru', async () => {
  // No mock do supabase, a linha retornada inclui:
  //   billing_interval: 'month', switched_from_stripe_subscription_id: 'sub_s1'
  const sub = await getWorkspaceSubscription();
  expect(sub?.billingInterval).toBe('month');
  expect(sub?.switchScheduled).toBe(true);
  expect(sub as object).not.toHaveProperty('switched_from_stripe_subscription_id');
});

it('switchScheduled false quando o marker é null', async () => {
  // linha com switched_from_stripe_subscription_id: null
  const sub = await getWorkspaceSubscription();
  expect(sub?.switchScheduled).toBe(false);
});

it('startPagarmeCheckout repassa switch: true no body quando presente', async () => {
  // fetch mockado; payload com switch: true
  // expect(JSON.parse(fetchMock.mock.calls[0][1].body).switch).toBe(true)
});
```

(siga o padrão de mock do arquivo — ele mocka `supabase` com `importOriginal` e o `fetch`
global; os testes existentes de `startPagarmeCheckout` mostram o shape exato)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/services/__tests__/billing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

(a) Interface:

```ts
export interface WorkspaceSubscription {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  next_payment_attempt: string | null;
  /** 'stripe' | 'pagarme' | null — which provider currently owns the subscription. */
  provider: string | null;
  /** Pagar.me installment count (12 for the annual-upfront-in-12x plan); null for Stripe. */
  installments: number | null;
  /** 'month' | 'year' | null. Null = price não resolvido (legado); trate como "não anual". */
  billingInterval: string | null;
  /** True enquanto a linha carrega uma troca mensal→12x agendada (janela do switch). */
  switchScheduled: boolean;
  hasEverSubscribed: boolean;
}
```

(b) `getWorkspaceSubscription`: select da string do Step 1; destruture também
`billing_interval: billingInterval` e `switched_from_stripe_subscription_id: switchedFromStripeSubscriptionId`
e monte:

```ts
  return {
    ...(rest as Omit<
      WorkspaceSubscription,
      'hasEverSubscribed' | 'provider' | 'installments' | 'billingInterval' | 'switchScheduled'
    >),
    provider: (rest.provider as string | null) ?? null,
    installments: (rest.installments as number | null) ?? null,
    billingInterval: (billingInterval as string | null) ?? null,
    switchScheduled: Boolean(switchedFromStripeSubscriptionId),
    hasEverSubscribed: Boolean(stripeSubscriptionId || pagarmeSubscriptionId || everSubscribedAt),
  };
```

(c) Tipos do checkout/cancel:

```ts
export interface PagarmeCheckoutPayload {
  plan_id: string;
  card_token: string;
  document: string;
  phone: { ddd: string; number: string };
  billing_address: PagarmeBillingAddress;
  source: CheckoutSource;
  /** Switch mensal Stripe → 12x: consentimento explícito (o backend exige o campo). */
  switch?: true;
}

export interface PagarmeCheckoutResult {
  status: 'trialing' | 'active';
  trial_ends_at: string | null;
  next_charge_at: string | null;
  installment_amount_cents: number;
  /** Presentes apenas na resposta de um switch. */
  switched?: boolean;
  first_charge_at?: string | null;
}
```

```ts
export async function cancelPagarmeSubscription(): Promise<{
  status: 'canceled' | 'reverted';
  access_until: string | null;
}> {
```

(o corpo não muda; só o tipo do retorno)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/services/__tests__/billing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts
git commit -m "feat(billing): billing_interval + switchScheduled no subscription do frontend"
```

---

### Task 14: Frontend — `plan-display.ts` (switchEligible + ceil espelhado)

**Files:**
- Modify: `apps/crm/src/pages/configuracao/cobranca/plan-display.ts`
- Test: `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts`

**Interfaces:**
- Produces (Tasks 15-16):
  - `switchEligible(subscription: { provider?: string | null; status?: string | null; billingInterval?: string | null } | null | undefined): boolean`
  - `ceilPeriodEndToUtcDate(iso: string): string | null` (`YYYY-MM-DD` ou null se iso inválido)
- `canUpgradeTo` e `checkoutBlocked` NÃO mudam de assinatura nem de comportamento.

- [ ] **Step 1: Testes (falhando)** — em `plan-display.test.ts`:

```ts
describe('switchEligible', () => {
  const base = { provider: 'stripe', status: 'active', billingInterval: 'month' };
  it('mensal stripe active/trialing é elegível (provider null = stripe legado)', () => {
    expect(switchEligible(base)).toBe(true);
    expect(switchEligible({ ...base, status: 'trialing' })).toBe(true);
    expect(switchEligible({ ...base, provider: null })).toBe(true);
    expect(switchEligible({ ...base, billingInterval: null })).toBe(true);
  });
  it('past_due, pagarme, anual e ausência nunca são elegíveis', () => {
    expect(switchEligible({ ...base, status: 'past_due' })).toBe(false);
    expect(switchEligible({ ...base, status: 'unpaid' })).toBe(false);
    expect(switchEligible({ ...base, status: 'canceled' })).toBe(false);
    expect(switchEligible({ ...base, provider: 'pagarme' })).toBe(false);
    expect(switchEligible({ ...base, billingInterval: 'year' })).toBe(false);
    expect(switchEligible(null)).toBe(false);
  });
});

describe('ceilPeriodEndToUtcDate', () => {
  // MESMOS casos do teste Deno de ceilToUtcMidnightDate: as duas implementações precisam
  // concordar ou a data prometida no form diverge do start_at real.
  it('meio-dia sobe para o próximo midnight UTC', () => {
    expect(ceilPeriodEndToUtcDate('2026-09-15T14:23:11Z')).toBe('2026-09-16');
  });
  it('midnight exato fica', () => {
    expect(ceilPeriodEndToUtcDate('2026-09-15T00:00:00.000Z')).toBe('2026-09-15');
  });
  it('virada de mês', () => {
    expect(ceilPeriodEndToUtcDate('2026-08-31T23:59:59Z')).toBe('2026-09-01');
  });
  it('iso inválido -> null', () => {
    expect(ceilPeriodEndToUtcDate('not-a-date')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** — adicione ao final de `plan-display.ts`:

```ts
/**
 * Espelho frontend do gate local do switch no backend (stripeSwitchSourceEligible em
 * pagarme-checkout/logic.ts): linha stripe (null = legado), status ESTRITO active/trialing
 * e billingInterval que não afirme 'year' (null passa; a autoridade final é a verificação
 * remota do backend). Os dois devem mudar juntos ou o CTA oferece um switch que 409a
 * depois do usuário digitar o cartão inteiro.
 */
export function switchEligible(
  subscription:
    | { provider?: string | null; status?: string | null; billingInterval?: string | null }
    | null
    | undefined,
): boolean {
  if (!subscription) return false;
  if ((subscription.provider ?? 'stripe') !== 'stripe') return false;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false;
  return subscription.billingInterval !== 'year';
}

/**
 * Réplica EXATA do ceilToUtcMidnightDate do backend (pagarme-checkout/logic.ts): o
 * start_at é date-only lido como meia-noite UTC, então um current_period_end de
 * 15/09 12:00Z vira 16/09. Exibir a data crua prometeria o dia errado. Retorna
 * YYYY-MM-DD (formatável com formatUtcDateBR) ou null para iso inválido.
 */
export function ceilPeriodEndToUtcDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const end = new Date(t);
  if (
    end.getUTCHours() !== 0 ||
    end.getUTCMinutes() !== 0 ||
    end.getUTCSeconds() !== 0 ||
    end.getUTCMilliseconds() !== 0
  ) {
    end.setUTCHours(24, 0, 0, 0);
  }
  return end.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts`
Expected: PASS (novos + 28 pré-existentes intactos).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/configuracao/cobranca/plan-display.ts apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts
git commit -m "feat(billing): switchEligible + ceil espelhado no frontend"
```

---

### Task 15: Frontend — `CobrancaPage.tsx` (CTA de switch, janela "Troca agendada", undo)

**Files:**
- Modify: `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`
- Test: `apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.test.tsx`

**Interfaces:**
- Consumes: `switchEligible`, `ceilPeriodEndToUtcDate` (Task 14); `switchScheduled`/`billingInterval` (Task 13); `formatUtcDateBR` (export existente de `PagarmeCheckoutDialog.tsx`); dialog `mode: 'switch'` + props `firstChargeAt`/`switchChangesPlan` (Task 16 — nesta task passe as props já; a Task 16 as implementa. Se executar 15 antes de 16, o TS falha: execute 15 e 16 na ordem 16→15 OU aceite que o typecheck só fecha após ambas. Recomendado: implementar Task 16 ANTES desta.)
- Produces: estado `pagarmeDialog` com modo `'switch'`; copy do undo; toast `'reverted'`.

Nota de ordem: **execute a Task 16 antes desta** (o dialog precisa aceitar as props novas
para esta task typecheckar). As duas juntas formam um push.

- [ ] **Step 1: Atualizar factory + testes (falhando)**

Em `CobrancaPage.test.tsx`:

(a) A factory `subscription(overrides)` (linha ~79) enumera o shape completo — adicione os
defaults `billingInterval: null, switchScheduled: false`.

(b) Fixture de assinante mensal elegível + testes:

```tsx
const MONTHLY_STRIPE_SUB = subscription({
  status: 'active',
  provider: 'stripe',
  billingInterval: 'month',
  current_period_end: '2026-09-15T14:23:11Z',
});

it('assinante mensal stripe vê o CTA de switch no card do plano ATUAL no toggle anual', async () => {
  // plans: [PRO_PLAN_PAGARME] com effectivePlanId 'pro'; subscription MONTHLY_STRIPE_SUB
  // clicar no toggle "Anual"
  // expect button 'Trocar para o anual em 12x' visível no card do plano atual
  // e a nota 'Primeira parcela prevista para 16/09/2026. Sem cobrança agora.'
});

it('assinante mensal stripe vê "Mudar para {plano} em 12x" nos outros cards anuais', async () => {
  // effectivePlanId 'start' (plano atual start), card PRO_PLAN_PAGARME no toggle anual
  // expect button 'Mudar para Pro em 12x'
});

it('clicar no CTA de switch abre o dialog em modo switch SEM chamar startCheckout', async () => {
  // click em 'Trocar para o anual em 12x'
  // expect título 'Trocar para o anual em 12x' no dialog; startCheckout NÃO chamado;
  // captureCheckoutStarted('pro', 'year', 'billing', 'pagarme') chamado
});

it('sem CTA de switch para: anual stripe, past_due, linha pagarme, toggle mensal', async () => {
  // quatro renders com subscription variando (billingInterval 'year' / status 'past_due' /
  // provider 'pagarme' / toggle mensal) — expect queryByText(/em 12x$/) ausente
});

it('janela do switch: badge "Troca agendada", meta "Primeira cobrança em", ações Atualizar cartão + Desfazer a troca', async () => {
  // subscription({ provider: 'pagarme', status: 'trialing', switchScheduled: true,
  //   installments: 12, current_period_end: '2026-09-16T00:00:00Z' })
  // expect badge 'Troca agendada' (e NÃO 'Teste'); texto 'Primeira cobrança em 16/09/2026';
  // buttons 'Atualizar cartão' e 'Desfazer a troca' (e NÃO 'Cancelar assinatura')
});

it('undo: dialog com copy própria e sucesso reverted mostra o toast de troca desfeita', async () => {
  // mesma subscription da janela; cancelPagarmeSubscription resolve
  //   { status: 'reverted', access_until: '2026-09-15T14:23:11Z' }
  // click 'Desfazer a troca' -> dialog com 'Seu plano mensal continua como estava e o 12x
  //   agendado é cancelado sem cobrança.' -> confirmar
  // expect toast.success('Troca desfeita. Seu plano mensal continua ativo.')
});

it('undo: 409 de consolidação mostra a mensagem do backend e dispara o poll', async () => {
  // cancelPagarmeSubscription rejeita com BillingApiError('A troca já foi concluída e a
  //   primeira parcela foi cobrada.')
  // expect toast.error com essa mensagem
});
```

(preencha os corpos seguindo o `renderPage()` e os padrões de query dos testes existentes
do arquivo — os testes de gate ON/OFF na linha ~190 mostram toggle de intervalo, clicks e
asserção de dialog)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar em `CobrancaPage.tsx`**

(a) Imports: acrescente `ceilPeriodEndToUtcDate, switchEligible` ao import de
`./plan-display`.

(b) Estado do dialog ganha o modo:

```tsx
  const [pagarmeDialog, setPagarmeDialog] = useState<{
    mode: 'checkout' | 'update-card' | 'switch';
    plan: BillingPlan | null;
  } | null>(null);
```

(c) Deriváveis, junto de `blocked` (linha ~217):

```tsx
  // Switch mensal Stripe -> 12x (espelho do gate do backend; os dois mudam juntos).
  const canSwitch = switchEligible(subscription) && !isInternalPlan(currentPlanId);
  const switchWindow =
    subscription?.provider === 'pagarme' &&
    subscription?.status === 'trialing' &&
    subscription?.switchScheduled === true;
  const switchPreviewDate = subscription?.current_period_end
    ? ceilPeriodEndToUtcDate(subscription.current_period_end)
    : null;
```

(`isInternalPlan` já é exportado por `plan-display.ts`; adicione ao import)

(d) Handler do switch, junto de `handleUpgrade`:

```tsx
  function handleSwitch(planId: string) {
    const plan = plans?.find((p) => p.id === planId);
    captureCheckoutStarted(planId, 'year', 'billing', 'pagarme');
    setPagarmeDialog({ mode: 'switch', plan: plan ?? null });
  }
```

(e) `renderCta` ganha o branch do switch ANTES dos existentes (um assinante mensal ativo
tem `hasActiveSub` true, então nenhum branch atual mostraria CTA — inclusive o card do
plano atual, que hoje é só "Plano atual"):

```tsx
  function renderCta(p: BillingPlan) {
    const switchable =
      canSwitch && interval === 'year' && isPagarme12xEnabled(p) && p.id !== 'free';
    if (switchable) {
      return (
        <>
          <button
            className="btn-primary"
            onClick={() => handleSwitch(p.id)}
            disabled={busy === p.id}
          >
            {busy === p.id
              ? 'Aguarde…'
              : p.id === currentPlanId
                ? 'Trocar para o anual em 12x'
                : `Mudar para ${p.name} em 12x`}
          </button>
          <p className="plan-cta__note">
            {switchPreviewDate
              ? `Primeira parcela prevista para ${formatUtcDateBR(switchPreviewDate)}. Sem cobrança agora.`
              : 'Sem cobrança agora. A primeira parcela vem depois do período já pago.'}
          </p>
        </>
      );
    }
    if (p.id === currentPlanId) {
      return <span className="plan-cta__static">Plano atual</span>;
    }
    // ... resto inalterado ...
```

(importe `formatUtcDateBR` — já é importado neste arquivo para o cancel dialog; confira)

Nota: sem CTA "Assinar à vista" no modo switch — o checkout Stripe anual 409aria com a
assinatura ativa.

(f) Manage card na janela (badge + meta + ações), alterando os pontos das linhas ~345-377:

```tsx
                <span
                  className={`badge ${subscription?.status === 'past_due' ? 'badge-warning' : 'badge-success'}`}
                >
                  {switchWindow
                    ? 'Troca agendada'
                    : subscription?.status === 'trialing'
                      ? 'Teste'
                      : subscription?.status === 'past_due'
                        ? 'Pagamento pendente'
                        : 'Ativo'}
                </span>
```

```tsx
              {subscription?.current_period_end && (
                <div className="billing-current__meta">
                  {switchWindow
                    ? 'Primeira cobrança em '
                    : subscription.cancel_at_period_end
                      ? 'Cancela em '
                      : 'Renova em '}
                  {formatPeriodEnd(subscription.current_period_end, subscription.provider)}
                </div>
              )}
```

```tsx
                  <button className="btn-secondary" onClick={() => setCancelDialogOpen(true)}>
                    {switchWindow ? 'Desfazer a troca' : 'Cancelar assinatura'}
                  </button>
```

(g) Copy do dialog de cancel (linha ~325): o branch do switch vem PRIMEIRO:

```tsx
  const cancelDialogDescription = !showPagarmeManage
    ? ''
    : switchWindow
      ? 'Seu plano mensal continua como estava e o 12x agendado é cancelado sem cobrança.'
      : subscription?.status === 'trialing'
        ? 'Sua assinatura será cancelada agora, sem cobrança.'
        : /* ... resto inalterado ... */
```

(h) `handleCancelPagarmeSubscription` trata o `reverted` e o 409 de consolidação:

```tsx
  async function handleCancelPagarmeSubscription() {
    setCancelling(true);
    try {
      const result = await cancelPagarmeSubscription();
      toast.success(
        result.status === 'reverted'
          ? 'Troca desfeita. Seu plano mensal continua ativo.'
          : 'Assinatura cancelada.',
      );
      startPlanRefetchPoll();
      setCancelDialogOpen(false);
    } catch (err) {
      // O 409 de consolidação (a fronteira cruzou durante o undo) muda o estado no
      // backend: mostra a mensagem e re-sincroniza.
      toast.error((err as Error).message);
      startPlanRefetchPoll();
    } finally {
      setCancelling(false);
    }
  }
```

(i) Wiring do dialog (linha ~515): passe as props novas:

```tsx
        mode={pagarmeDialog?.mode ?? 'checkout'}
        ...
        firstChargeAt={switchPreviewDate}
        switchChangesPlan={pagarmeDialog?.plan ? pagarmeDialog.plan.id !== currentPlanId : false}
        onPayUpfront={
          pagarmeDialog?.plan && pagarmeDialog.mode === 'checkout'
            ? () => {
                setPagarmeDialog(null);
                void startStripeUpgrade(pagarmeDialog.plan!.id);
              }
            : undefined
        }
```

(o `onPayUpfront` fica `undefined` no modo switch: a saída à vista abriria um checkout
Stripe que 409a com a assinatura ativa)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.test.tsx`
Expected: PASS (novos + todos os pré-existentes: os fluxos sem switch não mudaram).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.test.tsx
git commit -m "feat(billing): CTA de switch, janela Troca agendada e undo na CobrancaPage"
```

---

### Task 16: Frontend — `PagarmeCheckoutDialog.tsx` modo switch

(Executar ANTES da Task 15 — ver nota lá.)

**Files:**
- Modify: `apps/crm/src/components/billing/PagarmeCheckoutDialog.tsx`
- Test: `apps/crm/src/components/billing/__tests__/PagarmeCheckoutDialog.test.tsx`

**Interfaces:**
- Consumes: `PagarmeCheckoutPayload.switch` e `PagarmeCheckoutResult.first_charge_at` (Task 13).
- Produces: props ganham `mode: 'checkout' | 'update-card' | 'switch'`,
  `firstChargeAt?: string | null` (YYYY-MM-DD previsto) e `switchChangesPlan?: boolean`.
  Ambas opcionais: a factory `baseProps()` dos testes existentes continua compilando.

- [ ] **Step 1: Testes (falhando)** — em `PagarmeCheckoutDialog.test.tsx`, novo describe
(use `baseProps()` existente + overrides):

```tsx
describe('modo switch', () => {
  const switchProps = () => ({
    ...baseProps(),
    mode: 'switch' as const,
    firstChargeAt: '2026-09-16',
    trialEligible: false,
  });

  it('título e nota de previsão, sem copy de trial e sem saída à vista', () => {
    render(<PagarmeCheckoutDialog {...switchProps()} onPayUpfront={undefined} />);
    expect(screen.getByText('Trocar para o anual em 12x')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sem cobrança agora. A primeira parcela está prevista para 16/09/2026, quando termina o período que você já pagou.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/30 dias grátis/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pagar à vista')).not.toBeInTheDocument();
  });

  it('submit envia switch: true no payload', async () => {
    // preencha o form como nos testes de checkout existentes e submeta
    // expect(startPagarmeCheckout).toHaveBeenCalledWith(expect.objectContaining({ switch: true }))
  });

  it('CTA é "Confirmar troca"', () => {
    render(<PagarmeCheckoutDialog {...switchProps()} />);
    expect(screen.getByRole('button', { name: 'Confirmar troca' })).toBeInTheDocument();
  });

  it('sucesso usa first_charge_at do response e a copy de mesmo plano', async () => {
    // startPagarmeCheckout resolve { status: 'trialing', trial_ends_at: null,
    //   next_charge_at: '2026-09-16', installment_amount_cents: 12990,
    //   switched: true, first_charge_at: '2026-09-16' }
    // submit -> tela de sucesso:
    // 'Troca confirmada!' + 'Primeira parcela de 12x em 16/09/2026.' +
    // 'Até lá nada muda no seu acesso.' (switchChangesPlan ausente/false)
  });

  it('sucesso com troca entre planos avisa a mudança imediata de recursos', async () => {
    // mesmo fluxo com switchChangesPlan: true ->
    // 'Os recursos do plano Pro passam a valer imediatamente.'
  });

  it('firstChargeAt null degrada a nota sem data', () => {
    render(<PagarmeCheckoutDialog {...switchProps()} firstChargeAt={null} />);
    expect(
      screen.getByText('Sem cobrança agora. A primeira parcela vem quando terminar o período que você já pagou.'),
    ).toBeInTheDocument();
  });
});
```

(preencha os corpos de submit copiando o fill-and-submit dos testes de checkout do
arquivo — linhas ~197-216 mostram o preenchimento completo e a asserção do payload)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/components/billing/__tests__/PagarmeCheckoutDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

(a) Props:

```tsx
  mode: 'checkout' | 'update-card' | 'switch';
  /** Data PREVISTA da 1ª parcela do switch (YYYY-MM-DD, ceil do mirror local). A data
   * autoritativa vem no response (first_charge_at) e é a única exibida como definitiva. */
  firstChargeAt?: string | null;
  /** True quando o switch muda de plano (recursos passam a valer imediatamente). */
  switchChangesPlan?: boolean;
```

(b) Guard: `if ((mode === 'checkout' || mode === 'switch') && !plan) return null;`

(c) Em todos os pontos em que o form distingue checkout de update-card, o switch segue o
lado do CHECKOUT (campos document/phone/address/summary), exceto:
- Título: `mode === 'switch' ? 'Trocar para o anual em 12x' : ...`
- Nota de trial substituída no switch por:

```tsx
  {mode === 'switch' ? (
    <p className="pagarme-dialog__trial-note">
      {firstChargeAt
        ? `Sem cobrança agora. A primeira parcela está prevista para ${formatUtcDateBR(firstChargeAt)}, quando termina o período que você já pagou.`
        : 'Sem cobrança agora. A primeira parcela vem quando terminar o período que você já pagou.'}
    </p>
  ) : (
    /* nota de trial existente, apenas quando trialEligible && mode === 'checkout' */
  )}
```

- A saída à vista (`onPayUpfront` + 'Pagar à vista') renderiza APENAS em `mode === 'checkout'`.
- CTA: `mode === 'switch' ? 'Confirmar troca' : ...` (nunca a variante de trial).

(d) Submit: no branch de checkout, o payload ganha o campo:

```tsx
        const result = await startPagarmeCheckout({
          plan_id: plan.id,
          card_token: cardToken,
          document: onlyDigits(values.document),
          phone: splitPhone(values.phone)!,
          billing_address: billingAddress,
          source,
          ...(mode === 'switch' ? { switch: true as const } : {}),
        });
```

(o branch update-card não muda; o `mode === 'switch'` entra no mesmo caminho do checkout)

(e) Tela de sucesso:

```tsx
  {mode === 'switch' ? (
    <>
      <h3>Troca confirmada!</h3>
      <p>
        {successResult?.first_charge_at
          ? `Primeira parcela de 12x em ${formatUtcDateBR(successResult.first_charge_at)}. `
          : 'Sua troca para o anual em 12x está agendada. '}
        {switchChangesPlan
          ? `Os recursos do plano ${plan?.name} passam a valer imediatamente.`
          : 'Até lá nada muda no seu acesso.'}
      </p>
    </>
  ) : (
    /* sucesso existente do checkout */
  )}
```

(siga a estrutura JSX real da tela de sucesso do arquivo — título/descrição podem ser
`DialogTitle`/`DialogDescription`; mantenha as classes)

(f) Eventos PostHog: nada a mudar — `mode` já é enviado em `card_form_submitted`
/`card_form_abandoned`, e o valor novo `'switch'` flui sozinho.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/components/billing/__tests__/PagarmeCheckoutDialog.test.tsx`
Expected: PASS (20 pré-existentes + 6 novos).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/billing/PagarmeCheckoutDialog.tsx apps/crm/src/components/billing/__tests__/PagarmeCheckoutDialog.test.tsx
git commit -m "feat(billing): modo switch no PagarmeCheckoutDialog"
```

---

### Task 17: Verificação integral

**Files:** nenhum novo (correções pontuais se algo falhar).

- [ ] **Step 1: Grep pelos shapes antigos nas DUAS suítes** (contract changes quebram ambas)

```bash
grep -rn "canceled' | 'reverted\|status: string; access_until" apps/crm/src --include="*.ts*" | grep -v __tests__
grep -rn "one_pending_attempt_per_workspace" supabase/functions supabase/migrations
grep -rn "'pending','succeeded','failed','expired'" supabase/functions
```
Expected: nenhuma referência órfã ao índice antigo fora da migration antiga; nenhum
consumidor de `cancelPagarmeSubscription` ignorando `reverted` (ComecarPage/TrialNudgeCard
não chamam cancel; confirme).

- [ ] **Step 2: npm ci (deno poluiu node_modules) + suites completas**

```bash
npm ci
npm run test
npm run test:functions
git checkout -- deno.lock
```
Expected: verde nas duas.

- [ ] **Step 3: Lint + format + os 4 tsc do CI**

```bash
npm run lint
npm run format
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run format:check
```
Expected: tudo verde (format auto-fixa antes do check).

- [ ] **Step 4: Verificação visual (dev server)**

Suba o CRM contra staging (`npm run dev:staging` — copie `.env.staging` para o worktree
antes; worktrees não o têm) e confira na CobrancaPage de um workspace SEM assinatura que
nada mudou (CTAs de upgrade normais, sem CTA de switch). O fluxo completo do switch só é
testável no roteiro de staging do spec (seção Rollout), que fica para a sessão de deploy.

- [ ] **Step 5: Commit final + push**

```bash
git status
git push -u origin claude/stripe-pagarme-upgrade-flow-12c154
```

Antes do `gh pr create` (sessão de deploy): re-verificar o tail de
`git ls-tree origin/main:supabase/migrations` e renumerar a migration se o main andou.

## Notas de deploy (fora do escopo da implementação; roteiro completo no spec)

1. Staging primeiro: migration (`db push --linked`, conferir `supabase/.temp/project-ref`
   = wlyzhyfondykzpsiqsce) → functions `--no-verify-jwt --use-api` (pagarme-checkout,
   pagarme-subscription, billing-downgrade-cron, billing-checkout, billing-portal) →
   frontend. Colunas antes das functions; functions antes do frontend.
2. E2E staging: Stripe é conta compartilhada NÃO sandboxed — o mensal de teste custa
   dinheiro real (menor plano, refund depois). Roteiro completo na seção "Rollout e
   verificação" do spec.
3. Runbook da quarentena: CRITICAL log → conferir/estornar charge no dashboard Pagar.me →
   `update pagarme_checkout_attempts set state='failed' where id=... and state='quarantined'`
   via `supabase db query`.




