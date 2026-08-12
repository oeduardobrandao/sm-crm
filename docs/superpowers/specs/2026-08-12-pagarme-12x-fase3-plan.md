# Pagar.me 12x — Fase 3: pagarme-checkout + 409 cross-provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `pagarme-checkout` edge function (atomic reservation → customer → card attach → 12x subscription → synchronous ownership+mirror write) dark behind `plans.pagarme_12x_enabled`, and close the recorded Fase 2 blocker by extending `billing-checkout`'s 409 to refuse cross-provider in-force/paid-through rows.

**Architecture:** Four-file function — `index.ts` (serve shell: CORS, auth, owner check, rate limit, body validation), `handler.ts` (orchestration with injected `{db, gateway, now}` for testability, mirroring `instagram-connect-link/handler.ts`), `gateway.ts` (thin typed wrapper over `_shared/pagarme.ts`'s `pagarmeFetch`), `logic.ts` (pure decisions: validation, decline mapping, column builder, gate). One new pure function in `_shared/pagarme-logic.ts` (`crossProviderCheckoutBlocked`) is shared by both checkout functions. No migration: every table/column was created in Fase 1 (`20260812000001_pagarme_provider.sql`).

**Tech Stack:** Deno edge functions, supabase-js v2 (service-role), Pagar.me core/v5 REST via `_shared/pagarme.ts`, `deno test` with the house `__tests__/assert.ts`.

## Global Constraints

- **Worktree discipline:** ALL work happens in `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/instagram-post-lookback-406f72` on branch `claude/pagarme-12x-fase3-checkout`. Run `pwd` and `git branch --show-current` before writing any file; if either does not match, STOP and report.
- **Invisible while dark:** with `plans.pagarme_12x_enabled = false` (current state everywhere), no user-visible behavior changes. `pagarme-checkout` returns 403 before any remote call; `billing-checkout`'s new 409 branch can only fire on rows with `provider = 'pagarme'`, which cannot exist until pagarme-checkout runs.
- **PT-BR user-facing copy, NUNCA em travessão (em dash `—`)** in any user-facing string. Exact strings are given in the tasks; copy them verbatim.
- **Generic errors to clients, details to logs.** Never return gateway/DB error details in a response body. NEVER log `card_token`, `document`, `phone`, or `billing_address` (PCI + LGPD): log only stage names and error messages, never the request body.
- **Card data never touches our DB.** `card_token` goes straight to Pagar.me; nothing from the card form is persisted locally.
- **CORS via `buildCorsHeaders(req)`** from `_shared/cors.ts`. Never wildcard.
- **DB read errors DENY, never default.** A `{ error }` from a guard-relevant select must throw, not be treated as "no row" (Fase 2 rule; treating it as no-row bypasses the 409).
- **Deno tests** import assert helpers from `./assert.ts` (house pattern). `npm run test:functions` always dirties the root `deno.lock` — run `git checkout -- deno.lock` before committing.
- **Commit messages** end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **Contract changes:** if you change any existing exported shape, grep `apps/**/__tests__` AND `supabase/functions/__tests__` for the old shape and update both suites.
- **No new migration.** Tables `pagarme_checkout_attempts` (partial unique index `one_pending_attempt_per_workspace` on `state='pending'`), `pagarme_webhook_events`, and all provider columns exist since migration `20260812000001`.
- `plans.price_brl_annual` is in **centavos** despite the name (see `platform-admin/index.ts:515` treating it as cents). `numeric` column, arrives as a JS number.

---

### Task 1: `crossProviderCheckoutBlocked` + billing-checkout 409 extension (the Fase 2 blocker)

**Files:**
- Modify: `supabase/functions/_shared/pagarme-logic.ts` (append after `canWebhookWrite`)
- Modify: `supabase/functions/billing-checkout/index.ts` (imports, select at ~line 78-83, new guard after the 409 at ~line 88-90)
- Test: `supabase/functions/__tests__/pagarme-logic_test.ts` (append)

**Interfaces:**
- Consumes: `isInForce(status)`, `isPaidThrough(row, now)` — already exported by `_shared/pagarme-logic.ts`.
- Produces: `crossProviderCheckoutBlocked(requestingProvider: "stripe" | "pagarme", row: { provider?: string | null; status?: string | null; cancel_at_period_end?: boolean | null; current_period_end?: string | null } | null | undefined, now: Date): boolean` — Task 2's `pagarmeCheckoutBlocked` builds on it.

**Why:** recorded in the master plan as a BLOCKER: `billing-checkout` today only refuses `active|trialing`. A pagarme row in `past_due`, or `canceled` but paid-through, would let the client complete a Stripe checkout whose `checkout.session.completed` bind is then DENIED by `canWebhookWrite` (cross-provider in-force/paid-through beats `isAuthorizedBind`) — a paid Stripe subscription bound to nothing.

- [ ] **Step 1: Write the failing tests.** Append to `supabase/functions/__tests__/pagarme-logic_test.ts`:

```ts
// ─── crossProviderCheckoutBlocked ──────────────────────────────────────────

const CO_NOW = new Date("2026-08-12T12:00:00Z");
const FUTURE_END = "2026-12-31T00:00:00Z";
const PAST_END = "2026-01-01T00:00:00Z";

Deno.test("crossProviderCheckoutBlocked: no row never blocks", () => {
  assertEquals(crossProviderCheckoutBlocked("stripe", null, CO_NOW), false);
  assertEquals(crossProviderCheckoutBlocked("pagarme", undefined, CO_NOW), false);
});

Deno.test("crossProviderCheckoutBlocked: same provider never blocks here (own-status 409 is the caller's job)", () => {
  assertEquals(
    crossProviderCheckoutBlocked("stripe", { provider: "stripe", status: "active" }, CO_NOW),
    false,
  );
  assertEquals(
    crossProviderCheckoutBlocked("pagarme", { provider: "pagarme", status: "past_due" }, CO_NOW),
    false,
  );
});

Deno.test("crossProviderCheckoutBlocked: null provider counts as stripe", () => {
  // Legacy rows predate the provider column; they are stripe's.
  assertEquals(
    crossProviderCheckoutBlocked("stripe", { provider: null, status: "past_due" }, CO_NOW),
    false,
  );
  assertEquals(
    crossProviderCheckoutBlocked("pagarme", { provider: null, status: "past_due" }, CO_NOW),
    true,
  );
});

Deno.test("crossProviderCheckoutBlocked: other provider in force blocks (active, trialing, past_due)", () => {
  for (const status of ["active", "trialing", "past_due"]) {
    assertEquals(
      crossProviderCheckoutBlocked("stripe", { provider: "pagarme", status }, CO_NOW),
      true,
      `status=${status}`,
    );
  }
});

Deno.test("crossProviderCheckoutBlocked: other provider canceled but paid through blocks", () => {
  assertEquals(
    crossProviderCheckoutBlocked("stripe", {
      provider: "pagarme",
      status: "canceled",
      cancel_at_period_end: true,
      current_period_end: FUTURE_END,
    }, CO_NOW),
    true,
  );
});

Deno.test("crossProviderCheckoutBlocked: other provider fully churned does not block", () => {
  assertEquals(
    crossProviderCheckoutBlocked("stripe", {
      provider: "pagarme",
      status: "canceled",
      cancel_at_period_end: true,
      current_period_end: PAST_END,
    }, CO_NOW),
    false,
  );
  assertEquals(
    crossProviderCheckoutBlocked("pagarme", {
      provider: "stripe",
      status: "canceled",
      cancel_at_period_end: false,
      current_period_end: null,
    }, CO_NOW),
    false,
  );
});
```

Add `crossProviderCheckoutBlocked` to the existing import from `../_shared/pagarme-logic.ts` at the top of the test file.

- [ ] **Step 2: Run to verify failure.**

Run: `deno test supabase/functions/__tests__/pagarme-logic_test.ts`
Expected: FAIL — `crossProviderCheckoutBlocked` is not exported.

- [ ] **Step 3: Implement.** Append to `supabase/functions/_shared/pagarme-logic.ts` (after `canWebhookWrite`):

```ts
/**
 * Whether an existing subscription row owned by the OTHER provider blocks opening a new
 * checkout with `requestingProvider`. Symmetric guard used by billing-checkout (stripe) and
 * pagarme-checkout (pagarme): while the row's owner is in force (active/trialing/past_due)
 * or canceled-but-paid-through, completing a checkout with the other provider would create a
 * subscription whose webhook bind canWebhookWrite must then DENY (cross-provider in-force or
 * paid-through beats isAuthorizedBind), stranding a paid subscription with no plan granted.
 * Refusing up front is the only safe answer. Rows without a provider predate the column and
 * belong to Stripe. The caller keeps its own same-provider status rules; this function only
 * answers the cross-provider question.
 */
export function crossProviderCheckoutBlocked(
  requestingProvider: "stripe" | "pagarme",
  row:
    | {
      provider?: string | null;
      status?: string | null;
      cancel_at_period_end?: boolean | null;
      current_period_end?: string | null;
    }
    | null
    | undefined,
  now: Date,
): boolean {
  if (!row) return false;
  if ((row.provider ?? "stripe") === requestingProvider) return false;
  return isInForce(row.status) || isPaidThrough(row, now);
}
```

- [ ] **Step 4: Run to verify pass.**

Run: `deno test supabase/functions/__tests__/pagarme-logic_test.ts`
Expected: PASS (all pre-existing tests too).

- [ ] **Step 5: Wire into billing-checkout.** In `supabase/functions/billing-checkout/index.ts`:

(a) Add to the imports:

```ts
import { crossProviderCheckoutBlocked } from "../_shared/pagarme-logic.ts";
```

(b) Extend the subscription-row select (currently `stripe_customer_id, stripe_subscription_id, status, ever_subscribed_at, pagarme_subscription_id`) to ALSO capture the error (today it is silently discarded, and a failed read would skip both 409 guards):

```ts
    const { data: subRow, error: subRowErr } = await svc
      .from("workspace_subscriptions")
      .select(
        "stripe_customer_id, stripe_subscription_id, status, ever_subscribed_at, pagarme_subscription_id, provider, cancel_at_period_end, current_period_end",
      )
      .eq("workspace_id", workspaceId).maybeSingle();

    // A failed read must DENY, not default to "no row": with the row unknown, both 409
    // guards below would silently pass and a duplicate or cross-provider checkout could
    // open against a live subscription. Fail closed with a generic 500.
    if (subRowErr) {
      console.error("[billing-checkout] subscription read failed:", subRowErr.message);
      return json({ error: "Internal server error" }, 500, headers);
    }
```

(No dedicated test: billing-checkout's serve shell has no deno test harness; the check is review-verified, same as the Fase 2 year-guard wiring.)

(c) Immediately AFTER the existing `active|trialing` 409 block (`return json({ error: "Este workspace já tem uma assinatura ativa." }, 409, headers);`), add:

```ts
    // A row owned by Pagar.me that is still in force (past_due) or canceled but paid through
    // must not open a Stripe checkout: the resulting checkout.session.completed bind would be
    // DENIED by canWebhookWrite (cross-provider in-force/paid-through beats isAuthorizedBind),
    // leaving a paid Stripe subscription bound to nothing. Refuse up front. active/trialing/
    // past_due of ANY provider is already refused above; this only adds the cross-provider
    // paid-through case.
    if (crossProviderCheckoutBlocked("stripe", subRow, new Date())) {
      return json(
        { error: "Este workspace tem uma assinatura parcelada vigente. Gerencie o plano atual em Plano e Cobrança." },
        409,
        headers,
      );
    }
```

(d) Post-review amendment: the existing same-provider 409 guard also gains `past_due` AND `unpaid` — a Stripe row mid-dunning (`past_due`) is in force (`statusToPlanId` keeps the plan, `MRR_STATUSES` counts it), and an `unpaid` subscription still exists at Stripe and can reactivate if the customer pays the open invoice, so a second checkout in either state is a duplicate-subscription/double-billing path (and `pagarmeCheckoutBlocked` already blocks both on the 12x side — the two gates must agree). Change the condition to:

```ts
    if (
      subRow?.status === "active" || subRow?.status === "trialing" ||
      subRow?.status === "past_due" || subRow?.status === "unpaid"
    ) {
      return json({ error: "Este workspace já tem uma assinatura ativa." }, 409, headers);
    }
```

Beyond that, do NOT touch the same-provider behavior (a churned Stripe row may re-checkout exactly as today).

- [ ] **Step 6: Verify function typecheck + full deno suite.**

Run: `deno check supabase/functions/billing-checkout/index.ts` (pre-existing supabase-js generic-skew errors in OTHER files are known; this file must not add NEW errors) and `npm run test:functions`.
Expected: billing-checkout checks clean; full suite passes. Then `git checkout -- deno.lock`.

- [ ] **Step 7: Commit.**

```bash
git add supabase/functions/_shared/pagarme-logic.ts supabase/functions/billing-checkout/index.ts supabase/functions/__tests__/pagarme-logic_test.ts
git commit -m "feat(billing): billing-checkout refuses cross-provider in-force or paid-through rows"
```

---

### Task 2: `pagarme-checkout/logic.ts` — pure decisions + tests

**Files:**
- Create: `supabase/functions/pagarme-checkout/logic.ts`
- Test: `supabase/functions/__tests__/pagarme-checkout-logic_test.ts`

**Interfaces:**
- Consumes: `crossProviderCheckoutBlocked`, `isPaidThrough` from `../_shared/pagarme-logic.ts` (Task 1); `PagarmeApiError` from `../_shared/pagarme.ts` (import is env-free; the key is only required inside `pagarmeFetch`).
- Produces (Task 3 and 4 rely on these exact names):
  - `interface PagarmeCheckoutRequest { planId: string; cardToken: string; document: string; documentType: "cpf" | "cnpj"; customerType: "individual" | "company"; phone: { ddd: string; number: string }; billingAddress: { cep: string; line1: string; city: string; state: string } }`
  - `parseCheckoutBody(body: unknown): { ok: true; value: PagarmeCheckoutRequest } | { ok: false; status: 400; error: string; code: "invalid_request" | "invalid_document" }` — accepts `unknown` because `req.json()` may resolve to null/string/array; anything that is not a plain object is an `invalid_request` 400, never a 500
  - `pagarmeCheckoutBlocked(row, now: Date): boolean`
  - `resolveStartAt(trialDays: number | undefined, now: Date): string | undefined`
  - `buildAttemptIdempotencyKey(attemptId: string): string`
  - `installmentAmountCents(annualCents: number): number`
  - `buildPagarmeSubscriptionColumns(args): Record<string, unknown>`
  - `mapGatewayFailure(stage: "customer" | "card" | "subscription", err: unknown): { status: number; body: { error: string; code: string } }`

- [ ] **Step 1: Write the failing tests.** Create `supabase/functions/__tests__/pagarme-checkout-logic_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import {
  buildAttemptIdempotencyKey,
  buildPagarmeSubscriptionColumns,
  installmentAmountCents,
  mapGatewayFailure,
  pagarmeCheckoutBlocked,
  parseCheckoutBody,
  resolveStartAt,
} from "../pagarme-checkout/logic.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");

function validBody(): Record<string, unknown> {
  return {
    plan_id: "start",
    interval: "year",
    installments: 12,
    card_token: "token_abc",
    document: "111.444.777-35",
    phone: { ddd: "11", number: "99999-0000" },
    billing_address: { cep: "01310-100", line_1: "Av. Paulista, 1000", city: "São Paulo", state: "sp" },
    source: "billing",
  };
}

// ─── parseCheckoutBody ─────────────────────────────────────────────────────

Deno.test("parseCheckoutBody: valid CPF body normalizes digits and derives cpf/individual", () => {
  const r = parseCheckoutBody(validBody());
  assert(r.ok);
  assertEquals(r.value, {
    planId: "start",
    cardToken: "token_abc",
    document: "11144477735",
    documentType: "cpf",
    customerType: "individual",
    phone: { ddd: "11", number: "999990000" },
    billingAddress: { cep: "01310100", line1: "Av. Paulista, 1000", city: "São Paulo", state: "SP" },
  });
});

Deno.test("parseCheckoutBody: 14-digit document derives cnpj/company", () => {
  const r = parseCheckoutBody({ ...validBody(), document: "11.222.333/0001-81" });
  assert(r.ok);
  assertEquals(r.value.documentType, "cnpj");
  assertEquals(r.value.customerType, "company");
});

Deno.test("parseCheckoutBody: non-object bodies are a 400, never a crash", () => {
  for (const body of [null, undefined, "plan_id=start", 42, ["start"], true]) {
    const r = parseCheckoutBody(body);
    assertEquals(r.ok, false, String(body));
    if (!r.ok) {
      assertEquals(r.status, 400, String(body));
      assertEquals(r.code, "invalid_request", String(body));
    }
  }
});

Deno.test("parseCheckoutBody: rejections", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...validBody(), plan_id: "free" }, "unknown plan"],
    [{ ...validBody(), plan_id: undefined }, "missing plan"],
    [{ ...validBody(), interval: "month" }, "monthly interval"],
    [{ ...validBody(), installments: 6 }, "wrong installments"],
    [{ ...validBody(), card_token: "  " }, "blank token"],
    [{ ...validBody(), card_token: 42 }, "non-string token"],
    [{ ...validBody(), phone: { ddd: "1", number: "999990000" } }, "short ddd"],
    [{ ...validBody(), phone: { ddd: "11", number: "1234567" } }, "short phone"],
    [{ ...validBody(), phone: undefined }, "missing phone"],
    [{ ...validBody(), billing_address: { ...((validBody().billing_address) as Record<string, unknown>), cep: "0131010" } }, "short cep"],
    [{ ...validBody(), billing_address: { ...((validBody().billing_address) as Record<string, unknown>), line_1: "  " } }, "blank line_1"],
    [{ ...validBody(), billing_address: { ...((validBody().billing_address) as Record<string, unknown>), state: "S1" } }, "bad state"],
    [{ ...validBody(), billing_address: undefined }, "missing address"],
  ];
  for (const [body, label] of cases) {
    const r = parseCheckoutBody(body);
    assertEquals(r.ok, false, label);
    if (!r.ok) assertEquals(r.status, 400, label);
  }
});

Deno.test("parseCheckoutBody: bad document length is invalid_document, not invalid_request", () => {
  const r = parseCheckoutBody({ ...validBody(), document: "123" });
  assert(!r.ok);
  assertEquals(r.code, "invalid_document");
});

// ─── pagarmeCheckoutBlocked ────────────────────────────────────────────────

Deno.test("pagarmeCheckoutBlocked: no row does not block", () => {
  assertEquals(pagarmeCheckoutBlocked(null, NOW), false);
});

Deno.test("pagarmeCheckoutBlocked: active or trialing blocks regardless of provider", () => {
  assertEquals(pagarmeCheckoutBlocked({ provider: "stripe", status: "active" }, NOW), true);
  assertEquals(pagarmeCheckoutBlocked({ provider: "pagarme", status: "trialing" }, NOW), true);
});

Deno.test("pagarmeCheckoutBlocked: past_due blocks for BOTH providers (dunning in progress, the fix is update-card, not a second subscription)", () => {
  assertEquals(pagarmeCheckoutBlocked({ provider: "stripe", status: "past_due" }, NOW), true);
  assertEquals(pagarmeCheckoutBlocked({ provider: "pagarme", status: "past_due" }, NOW), true);
});

Deno.test("pagarmeCheckoutBlocked: stripe unpaid blocks (master-plan rule: unpaid is not churn)", () => {
  assertEquals(pagarmeCheckoutBlocked({ provider: "stripe", status: "unpaid" }, NOW), true);
});

Deno.test("pagarmeCheckoutBlocked: paid-through blocks for BOTH providers", () => {
  const paidThrough = {
    status: "canceled",
    cancel_at_period_end: true,
    current_period_end: "2026-12-31T00:00:00Z",
  };
  assertEquals(pagarmeCheckoutBlocked({ ...paidThrough, provider: "stripe" }, NOW), true);
  assertEquals(pagarmeCheckoutBlocked({ ...paidThrough, provider: "pagarme" }, NOW), true);
});

Deno.test("pagarmeCheckoutBlocked: fully churned row does not block", () => {
  assertEquals(
    pagarmeCheckoutBlocked({
      provider: "stripe",
      status: "canceled",
      cancel_at_period_end: false,
      current_period_end: "2026-01-01T00:00:00Z",
    }, NOW),
    false,
  );
  assertEquals(
    pagarmeCheckoutBlocked({
      provider: "pagarme",
      status: "canceled",
      cancel_at_period_end: true,
      current_period_end: "2026-01-01T00:00:00Z",
    }, NOW),
    false,
  );
});

// ─── small helpers ─────────────────────────────────────────────────────────

Deno.test("resolveStartAt: 30 trial days from NOW is a date-only string", () => {
  assertEquals(resolveStartAt(30, NOW), "2026-09-11");
});

Deno.test("resolveStartAt: no trial means no start_at", () => {
  assertEquals(resolveStartAt(undefined, NOW), undefined);
});

Deno.test("buildAttemptIdempotencyKey derives from the attempt id", () => {
  assertEquals(buildAttemptIdempotencyKey("a1b2"), "pagarme-co-a1b2");
});

Deno.test("installmentAmountCents rounds annual/12 to the nearest centavo", () => {
  assertEquals(installmentAmountCents(95900), 7992);
  assertEquals(installmentAmountCents(120000), 10000);
});

// ─── buildPagarmeSubscriptionColumns ───────────────────────────────────────

Deno.test("buildPagarmeSubscriptionColumns: provider flip and amount mirror in ONE payload", () => {
  const cols = buildPagarmeSubscriptionColumns({
    customerId: "cus_1",
    subscriptionId: "sub_1",
    status: "trialing",
    planId: "start",
    annualPriceCents: 95900,
    currentPeriodEnd: "2026-09-11T00:00:00Z",
    everSubscribedAt: "2026-01-01T00:00:00Z",
    nowIso: "2026-08-12T12:00:00.000Z",
  });
  assertEquals(cols, {
    provider: "pagarme",
    pagarme_customer_id: "cus_1",
    pagarme_subscription_id: "sub_1",
    status: "trialing",
    plan_id: "start",
    billing_interval: "year",
    installments: 12,
    current_period_end: "2026-09-11T00:00:00Z",
    cancel_at_period_end: false,
    ever_subscribed_at: "2026-01-01T00:00:00Z",
    failed_payment_count: 0,
    past_due_since: null,
    next_payment_attempt: null,
    amount_cents: 95900,
    gross_cents: null,
    currency: "brl",
    amount_interval: "year",
    discount_label: null,
    amount_refreshed_at: "2026-08-12T12:00:00.000Z",
    updated_at: "2026-08-12T12:00:00.000Z",
  });
});

// ─── mapGatewayFailure ─────────────────────────────────────────────────────

Deno.test("mapGatewayFailure: 4xx maps per stage with fixed PT-BR copy", () => {
  const e = new PagarmeApiError(400, { message: "raw gateway detail" });
  assertEquals(mapGatewayFailure("customer", e), {
    status: 400,
    body: { error: "Não foi possível validar seus dados. Confira CPF ou CNPJ e telefone.", code: "invalid_document" },
  });
  assertEquals(mapGatewayFailure("card", e), {
    status: 400,
    body: { error: "Cartão recusado. Confira os dados ou tente outro cartão.", code: "invalid_card" },
  });
  assertEquals(mapGatewayFailure("subscription", e), {
    status: 400,
    body: { error: "Plano não configurado para parcelamento. Fale com o suporte.", code: "plan_not_configured" },
  });
});

Deno.test("mapGatewayFailure: 5xx, timeout and unknown errors are a generic 500", () => {
  const expected = {
    status: 500,
    body: { error: "Erro ao processar o pagamento. Tente novamente.", code: "gateway_error" },
  };
  assertEquals(mapGatewayFailure("card", new PagarmeApiError(502, null)), expected);
  assertEquals(mapGatewayFailure("subscription", new Error("timeout")), expected);
});

Deno.test("mapGatewayFailure: 401/403/429 are OUR problem, never user-blame copy", () => {
  const expected = {
    status: 500,
    body: { error: "Erro ao processar o pagamento. Tente novamente.", code: "gateway_error" },
  };
  for (const status of [401, 403, 429]) {
    for (const stage of ["customer", "card", "subscription"] as const) {
      assertEquals(mapGatewayFailure(stage, new PagarmeApiError(status, null)), expected, `${stage} ${status}`);
    }
  }
});

Deno.test("mapGatewayFailure: never leaks the gateway body", () => {
  const r = mapGatewayFailure("card", new PagarmeApiError(400, { message: "SECRET detail" }));
  assertEquals(JSON.stringify(r).includes("SECRET"), false);
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-logic_test.ts`
Expected: FAIL — module `../pagarme-checkout/logic.ts` does not exist.

- [ ] **Step 3: Implement.** Create `supabase/functions/pagarme-checkout/logic.ts`:

```ts
// Pure decisions for the pagarme-checkout flow. No network/env/Supabase access — everything
// here is unit-tested in isolation, mirroring _shared/pagarme-logic.ts. The PagarmeApiError
// import is env-free (the secret key is only required inside pagarmeFetch).

import { PagarmeApiError } from "../_shared/pagarme.ts";
import { isInForce, isPaidThrough } from "../_shared/pagarme-logic.ts";

const PAID_PLANS = ["start", "pro", "max"];

export interface PagarmeCheckoutRequest {
  planId: string;
  cardToken: string;
  /** Digits only, 11 (CPF) or 14 (CNPJ). */
  document: string;
  documentType: "cpf" | "cnpj";
  customerType: "individual" | "company";
  phone: { ddd: string; number: string };
  billingAddress: { cep: string; line1: string; city: string; state: string };
}

export type ParseFailure = {
  ok: false;
  status: 400;
  error: string;
  code: "invalid_request" | "invalid_document";
};

export type ParseResult = { ok: true; value: PagarmeCheckoutRequest } | ParseFailure;

function digits(v: unknown): string {
  return typeof v === "string" ? v.replace(/\D/g, "") : "";
}

function fail(error: string): ParseFailure {
  return { ok: false, status: 400, error, code: "invalid_request" };
}

/**
 * Server-side re-validation of the checkout body. Format-level only: check digits for
 * CPF/CNPJ live in the client (Fase 6 card-validation.ts) and the gateway is the real
 * authority. Nothing validated here is ever persisted locally. Takes `unknown` because
 * req.json() may legally resolve to null, a string, a number or an array — any non-object
 * is an invalid_request 400, never a crash.
 */
export function parseCheckoutBody(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("Requisição inválida.");
  }
  const body = raw as Record<string, unknown>;
  const planId = String(body.plan_id ?? "");
  if (!PAID_PLANS.includes(planId)) return fail("Plano inválido.");
  if (body.interval !== "year") return fail("Intervalo inválido.");
  if (body.installments !== 12) return fail("Parcelamento inválido.");

  const cardToken = typeof body.card_token === "string" ? body.card_token.trim() : "";
  if (!cardToken) return fail("Dados do cartão inválidos.");

  const document = digits(body.document);
  if (document.length !== 11 && document.length !== 14) {
    return { ok: false, status: 400, error: "CPF ou CNPJ inválido.", code: "invalid_document" };
  }

  const phone = (body.phone ?? {}) as Record<string, unknown>;
  const ddd = digits(phone.ddd);
  const phoneNumber = digits(phone.number);
  if (ddd.length !== 2 || phoneNumber.length < 8 || phoneNumber.length > 9) {
    return fail("Telefone inválido.");
  }

  const addr = (body.billing_address ?? {}) as Record<string, unknown>;
  const cep = digits(addr.cep);
  const line1 = typeof addr.line_1 === "string" ? addr.line_1.trim() : "";
  const city = typeof addr.city === "string" ? addr.city.trim() : "";
  const state = typeof addr.state === "string" ? addr.state.trim().toUpperCase() : "";
  if (cep.length !== 8 || !line1 || !city || !/^[A-Z]{2}$/.test(state)) {
    return fail("Endereço de cobrança inválido.");
  }

  const isCpf = document.length === 11;
  return {
    ok: true,
    value: {
      planId,
      cardToken,
      document,
      documentType: isCpf ? "cpf" : "cnpj",
      customerType: isCpf ? "individual" : "company",
      phone: { ddd, number: phoneNumber },
      billingAddress: { cep, line1, city, state },
    },
  };
}

/**
 * 409 gate for pagarme-checkout, provider-agnostic on purpose: any in-force subscription
 * (active/trialing/past_due, per isInForce) blocks regardless of who owns the row — a
 * past_due row is mid-dunning and the fix is update-card, not a second subscription. Stripe
 * `unpaid` also blocks (master-plan rule: unpaid is a still-existing subscription in
 * terminal dunning, not churn — the user cancels via the portal first). A canceled row that
 * is still paid through blocks for BOTH providers: cross-provider, the eventual webhook
 * bind would be denied by canWebhookWrite, stranding a paid subscription; same-provider, a
 * second 12x would double-charge the overlap.
 */
export function pagarmeCheckoutBlocked(
  row:
    | {
      provider?: string | null;
      status?: string | null;
      cancel_at_period_end?: boolean | null;
      current_period_end?: string | null;
    }
    | null
    | undefined,
  now: Date,
): boolean {
  if (!row) return false;
  if (isInForce(row.status) || row.status === "unpaid") return true;
  return isPaidThrough(row, now);
}

/**
 * `start_at` for the trial: date-only string (the spike sent YYYY-MM-DD and the gateway
 * echoed it as midnight UTC). Undefined when there is no trial — the subscription then
 * charges its first installment at creation.
 */
export function resolveStartAt(trialDays: number | undefined, now: Date): string | undefined {
  if (!trialDays) return undefined;
  return new Date(now.getTime() + trialDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Idempotency key for POST /subscriptions, derived from the attempt row id: a network retry
 * of the SAME reservation maps to the same remote subscription (spike criterion 5 proved
 * /subscriptions honors the key), while a new reservation gets a fresh key.
 */
export function buildAttemptIdempotencyKey(attemptId: string): string {
  return `pagarme-co-${attemptId}`;
}

/** Display amount of one of the 12 installments, rounded to the nearest centavo. */
export function installmentAmountCents(annualCents: number): number {
  return Math.round(annualCents / 12);
}

/**
 * The FULL column payload for the workspace_subscriptions bind. INVARIANTE (master plan):
 * the provider flip and the amount mirror land in ONE statement — the admin trusts the
 * mirror for pagarme rows (amount_source 'pagarme', never live-fetched), so a row with
 * provider='pagarme' and a Stripe-era mirror would show the old price under the new label.
 * MRR reports contract value / 12, the same treatment as an annual Stripe subscription.
 * ever_subscribed_at keeps its original value when the workspace subscribed before.
 */
export function buildPagarmeSubscriptionColumns(args: {
  customerId: string;
  subscriptionId: string;
  status: "trialing" | "active";
  planId: string;
  annualPriceCents: number;
  currentPeriodEnd: string | null;
  everSubscribedAt: string;
  nowIso: string;
}): Record<string, unknown> {
  return {
    provider: "pagarme",
    pagarme_customer_id: args.customerId,
    pagarme_subscription_id: args.subscriptionId,
    status: args.status,
    plan_id: args.planId,
    billing_interval: "year",
    installments: 12,
    current_period_end: args.currentPeriodEnd,
    cancel_at_period_end: false,
    ever_subscribed_at: args.everSubscribedAt,
    // Fresh takeover clears ALL dunning state (mirroring buildRecoveryEpisode): a Stripe row
    // that churned mid-dunning must not leak its past_due_since into the first pagarme episode.
    failed_payment_count: 0,
    past_due_since: null,
    next_payment_attempt: null,
    amount_cents: args.annualPriceCents,
    gross_cents: null,
    currency: "brl",
    amount_interval: "year",
    discount_label: null,
    amount_refreshed_at: args.nowIso,
    updated_at: args.nowIso,
  };
}

/**
 * Maps a gateway failure to a client response. Fixed PT-BR strings only: the raw gateway
 * body is NEVER forwarded (generic-error rule). 4xx is attributed by the stage that failed;
 * everything else (5xx, timeout, local errors reaching the catch-all) is a generic 500.
 */
export function mapGatewayFailure(
  stage: "customer" | "card" | "subscription",
  err: unknown,
): { status: number; body: { error: string; code: string } } {
  const apiErr = err instanceof PagarmeApiError ? err : null;
  // 401/403 are OUR credential/config problem and 429 is OUR rate limit at the gateway —
  // never blame the user's document/card for those; they fall through to the generic 500.
  const userAttributable = apiErr !== null &&
    apiErr.status >= 400 && apiErr.status < 500 &&
    apiErr.status !== 401 && apiErr.status !== 403 && apiErr.status !== 429;
  if (userAttributable) {
    if (stage === "customer") {
      return {
        status: 400,
        body: {
          error: "Não foi possível validar seus dados. Confira CPF ou CNPJ e telefone.",
          code: "invalid_document",
        },
      };
    }
    if (stage === "card") {
      return {
        status: 400,
        body: { error: "Cartão recusado. Confira os dados ou tente outro cartão.", code: "invalid_card" },
      };
    }
    // subscription-stage 4xx with a freshly attached card: the plan_id we sent is the only
    // remaining input we own — a misconfigured pagarme_plan_id_annual, not the user's card.
    return {
      status: 400,
      body: { error: "Plano não configurado para parcelamento. Fale com o suporte.", code: "plan_not_configured" },
    };
  }
  return {
    status: 500,
    body: { error: "Erro ao processar o pagamento. Tente novamente.", code: "gateway_error" },
  };
}
```

- [ ] **Step 4: Run to verify pass.**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-logic_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/pagarme-checkout/logic.ts supabase/functions/__tests__/pagarme-checkout-logic_test.ts
git commit -m "feat(billing): pagarme-checkout pure logic (validation, gate, columns, decline mapping)"
```

---

### Task 3: `gateway.ts` + `handler.ts` — orchestration with injected deps + tests

**Files:**
- Create: `supabase/functions/pagarme-checkout/gateway.ts`
- Create: `supabase/functions/pagarme-checkout/handler.ts`
- Modify: `supabase/functions/_shared/plan-writer.ts` (error propagation)
- Test: `supabase/functions/__tests__/pagarme-checkout-handler_test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; from `_shared`: `hasEverSubscribed` (billing-logic.ts), `resolveTrialDays` (trial.ts), `normalizePagarmeStatus` + `mapPagarmeTemporalFields` (pagarme-logic.ts), `writeWorkspacePlan` (plan-writer.ts), `pagarmeFetch` (pagarme.ts).
- Produces (Task 4 relies on):
  - `interface PagarmeGateway { upsertCustomer(input: PagarmeCustomerInput): Promise<{ id: string }>; attachCard(customerId: string, token: string, address: PagarmeCheckoutRequest["billingAddress"]): Promise<{ id: string }>; createSubscription(input: PagarmeSubscriptionInput, idempotencyKey: string): Promise<PagarmeSubscriptionResponse>; cancelSubscription(id: string): Promise<void> }`
  - `createPagarmeGateway(): PagarmeGateway`
  - `interface CheckoutContext { workspaceId: string; userEmail: string; userName: string | null }`
  - `createPagarmeCheckoutHandler(deps: { db: SupabaseClient; gateway: PagarmeGateway; now: () => Date }): (ctx: CheckoutContext, reqData: PagarmeCheckoutRequest) => Promise<{ status: number; body: unknown }>`
  - `writeWorkspacePlan` keeps its signature but now THROWS on read/write errors (previously both were silently discarded). Sole other call site is `stripe-webhook/index.ts:230`, where a throw becomes a 5xx → Stripe redelivery → retried write — the Fase 2 "a failed write must not ack" rule.

**Flow being implemented (master plan, steps 1-9, amended by the external spec review):** gate re-check → 409 gate → expire stale pending attempts (>15 min) → atomic reservation (partial unique index; conflict = 409, ZERO remote calls) → trial resolution → customer upsert (email is the natural key at Pagar.me; a second create UPDATES — spike criterion 6) → card attach WITH billing_address (token billing_address is IGNORED by the gateway; card_token direct on the subscription deduplicates to an address-less card — spike finding) → subscription create with Idempotency-Key derived from the attempt id → record `pagarme_subscription_id` on the attempt row (MANDATORY: a failure here cancels the remote sub and fails the checkout — the pointer is what reconciliation depends on) → `failed`/non-live status gets a compensating remote cancel and grants nothing → **CAS bind** (single statement, provider + mirror together, pinned to the coordinates observed at gate-read; a lost race or insert conflict cancels the remote sub and 409s — mirrors the Fase 2 stripe-webhook CAS, with compensation instead of redelivery) → `writeWorkspacePlan(..., "pagarme")` (post-bind: failure logs CRITICAL but never cancels a live bound subscription) → attempt `succeeded`.

**Post-PR hardening (Codex on-PR P1):** an AMBIGUOUS failure of `createSubscription` (timeout, network error, gateway 5xx — anything that is not a definitive PagarmeApiError 4xx rejection) may have committed remotely without giving us the id; marking the attempt failed there would let a user retry with a NEW attempt (new Idempotency-Key) and mint a second live, charging subscription. The handler therefore retries ONCE with the SAME attempt-derived Idempotency-Key before giving up: if the first request committed, the gateway returns the same subscription (spike criterion 5); if it never arrived, the retry is an ordinary first create. A definitive 4xx rejection never retries. A second consecutive ambiguous failure still falls to the outer catch (attempt failed) — that residual window is what the Fase 5 remote-side sweep (hard requirement in the master plan) exists for.

**Post-PR hardening 2 (Codex on-PR round 2, both P1s):** when the remote outcome is UNRESOLVED, the reservation is NOT released. Two cases: (a) the subscription-stage failure is ambiguous even after the same-key retry (timeout/network/5xx twice) — the outer catch skips `finishAttempt("failed")`; (b) the compensating cancel itself fails (gateway outage) — `failCompensating` marks the attempt failed ONLY when the cancel succeeded, otherwise leaves it pending with the orphan pointer intact. In both cases the attempt stays `pending`, so the partial unique index keeps blocking new checkouts (409) until the 15-minute self-heal expiry — closing the immediate-retry duplicate window with no new mechanism. Indefinite blocking was deliberately rejected: without the Fase 5 reconciler a stuck pending would hard-lock checkout on a transient outage; 15 minutes is the TTL until the Fase 5 remote-side sweep (the durable resolver) lands.

**Post-PR hardening 3 (Codex on-PR round 3, P1, accepted for the known-id half):** the stale-attempt expiry no longer releases a reservation whose attempt RECORDED a `pagarme_subscription_id`: before expiring, the handler cancels that remote subscription; a 4xx from the DELETE means "already canceled/gone" and releases, while a network/5xx failure keeps the reservation blocking (409) — we never knowingly release while a known remote subscription may be live. This is a deliberate exception to the "no remote call before the reservation" rule (the stale pending row blocks the reservation insert via the partial unique index, so the cancel must precede it; it fires only on the rare recovery path and involves no card data). The NO-id half (attempt expired without ever learning the sub id) remains resolvable only by the Fase 5 remote-side sweep — blocking it forever without that reconciler would hard-lock checkout on a transient outage, so the 15-minute TTL stands there.

**Post-review hardening (task review, Important):** the commit window (orphan pointer → non-live check → CAS bind) is additionally wrapped in its OWN try/catch that compensates on a THROWN exception too — the compensation rule must be structural, not an assumption that postgrest-js resolves errors instead of throwing (a `.throwOnError()` or client swap would otherwise silently reopen the gap). The post-bind section (plan grant, attempt succeeded, 200) stays OUTSIDE that inner try: a throw there must never cancel a bound subscription.

**Compensation rule (spec-review P0):** between remote creation and a committed bind, every failure path cancels the remote subscription. Leaving it alive is strictly worse: the idempotency key is per-attempt, so a user retry would mint a SECOND subscription. With the 30-day trial (the overwhelmingly common path) the cancel is free; without it, one charge may need a manual refund — still better than a paid subscription bound to nothing. After a committed bind, failures never cancel.

- [ ] **Step 1: Write the failing tests.** Create `supabase/functions/__tests__/pagarme-checkout-handler_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import { createPagarmeCheckoutHandler } from "../pagarme-checkout/handler.ts";
import { PagarmeGateway } from "../pagarme-checkout/gateway.ts";
import { PagarmeCheckoutRequest } from "../pagarme-checkout/logic.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const WS = "22222222-2222-2222-2222-222222222222";
const ATTEMPT_ID = "at-1";

const CTX = { workspaceId: WS, userEmail: "owner@agencia.com", userName: "Dona Owner" };

const REQ: PagarmeCheckoutRequest = {
  planId: "start",
  cardToken: "token_abc",
  document: "11144477735",
  documentType: "cpf",
  customerType: "individual",
  phone: { ddd: "11", number: "999990000" },
  billingAddress: { cep: "01310100", line1: "Av. Paulista, 1000", city: "São Paulo", state: "SP" },
};

const PLAN = {
  id: "start",
  price_brl_annual: 95900,
  pagarme_12x_enabled: true,
  pagarme_plan_id_annual: "plan_remote_1",
};

type Ev = {
  op: string;
  table: string;
  values?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>; // [method, column, value] for eq/is
};

/**
 * Minimal chainable thenable stub (house pattern: instagram-connect-link-handler_test.ts,
 * extended with a `then` so bare `await chain` update calls settle too). Every operation is
 * appended to `events` in call order — with its eq/is filters — so tests can assert both
 * sequencing and the CAS pins.
 */
function makeDb(fx: {
  plan?: Record<string, unknown> | null;
  subRow?: Record<string, unknown> | null;
  subRowError?: { message: string } | null;
  reserveError?: { code?: string; message: string } | null;
  /** CAS update on workspace_subscriptions matches zero rows (lost race). */
  bindZeroRows?: boolean;
  bindUpdateError?: { message: string } | null;
  bindInsertError?: { code?: string; message: string } | null;
  /** Error injected ONLY on the orphan-pointer update (attempt update carrying
   * pagarme_subscription_id without a state). */
  attemptPointerError?: { message: string } | null;
  /** Error injected on the workspaces plan-grant update (plan-writer). */
  planWriteError?: { message: string } | null;
  events: Ev[];
}): SupabaseClient {
  const from = (table: string) => {
    let op = "read";
    let values: Record<string, unknown> | undefined;
    const filters: Array<[string, string, unknown]> = [];
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    chain.select = () => chain;
    chain.lt = () => chain;
    chain.eq = (col: string, val: unknown) => {
      filters.push(["eq", col, val]);
      return chain;
    };
    chain.is = (col: string, val: unknown) => {
      filters.push(["is", col, val]);
      return chain;
    };
    chain.update = (v: Record<string, unknown>) => {
      op = "update";
      values = v;
      return chain;
    };
    chain.insert = (v: Record<string, unknown>) => {
      op = "insert";
      values = v;
      return chain;
    };
    const settle = () => {
      fx.events.push({ op, table, values, filters });
      if (table === "plans") return { data: fx.plan ?? null, error: null };
      if (table === "workspace_subscriptions" && op === "read") {
        return { data: fx.subRow ?? null, error: fx.subRowError ?? null };
      }
      if (table === "workspace_subscriptions" && op === "update") {
        // CAS bind: update(...).eq(...).select("workspace_id") resolves to matched rows
        return {
          data: fx.bindZeroRows ? [] : [{ workspace_id: WS }],
          error: fx.bindUpdateError ?? null,
        };
      }
      if (table === "workspace_subscriptions" && op === "insert") {
        return { data: null, error: fx.bindInsertError ?? null };
      }
      if (table === "pagarme_checkout_attempts" && op === "insert") {
        if (fx.reserveError) return { data: null, error: fx.reserveError };
        return { data: { id: ATTEMPT_ID }, error: null };
      }
      if (
        table === "pagarme_checkout_attempts" && op === "update" &&
        values?.pagarme_subscription_id !== undefined && values?.state === undefined
      ) {
        return { data: null, error: fx.attemptPointerError ?? null };
      }
      if (table === "workspaces" && op === "read") {
        return { data: { plan_source: "system" }, error: null };
      }
      if (table === "workspaces" && op === "update") {
        return { data: null, error: fx.planWriteError ?? null };
      }
      return { data: null, error: null };
    };
    chain.single = () => Promise.resolve(settle());
    chain.maybeSingle = () => Promise.resolve(settle());
    chain.then = (
      onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(settle()).then(onFulfilled, onRejected);
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

function makeGateway(fx: {
  calls: Array<{ method: string; args: unknown[] }>;
  subStatus?: string;
  subStartAt?: string | null;
  nextBillingAt?: string | null;
  failAt?: "customer" | "card" | "subscription";
  failWith?: unknown;
}): PagarmeGateway {
  const record = (method: string, args: unknown[]) => fx.calls.push({ method, args });
  const maybeFail = (stage: string) => {
    if (fx.failAt === stage) throw fx.failWith ?? new Error("gateway boom");
  };
  return {
    upsertCustomer: (input) => {
      record("upsertCustomer", [input]);
      maybeFail("customer");
      return Promise.resolve({ id: "cus_1" });
    },
    attachCard: (customerId, token, address) => {
      record("attachCard", [customerId, token, address]);
      maybeFail("card");
      return Promise.resolve({ id: "card_1" });
    },
    createSubscription: (input, idempotencyKey) => {
      record("createSubscription", [input, idempotencyKey]);
      maybeFail("subscription");
      return Promise.resolve({
        id: "sub_1",
        status: fx.subStatus ?? "active",
        start_at: fx.subStartAt ?? null,
        next_billing_at: fx.nextBillingAt ?? null,
        current_cycle: null,
      });
    },
    cancelSubscription: (id) => {
      record("cancelSubscription", [id]);
      return Promise.resolve();
    },
  };
}

function run(
  dbFx: Omit<Parameters<typeof makeDb>[0], "events">,
  gwFx: Omit<Parameters<typeof makeGateway>[0], "calls"> = {},
) {
  const events: Ev[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const handle = createPagarmeCheckoutHandler({
    db: makeDb({ ...dbFx, events }),
    gateway: makeGateway({ ...gwFx, calls }),
    now: () => NOW,
  });
  return { events, calls, result: handle(CTX, REQ) };
}

Deno.test("gate off: 403, no reservation, zero gateway calls", async () => {
  const { events, calls, result } = run({ plan: { ...PLAN, pagarme_12x_enabled: false } });
  const r = await result;
  assertEquals(r.status, 403);
  assertEquals(calls.length, 0);
  assertEquals(events.filter((e) => e.table === "pagarme_checkout_attempts").length, 0);
});

Deno.test("unconfigured plan: 400 plan_not_configured before any write", async () => {
  const { calls, result } = run({ plan: { ...PLAN, pagarme_plan_id_annual: null } });
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "plan_not_configured");
  assertEquals(calls.length, 0);
});

Deno.test("blocked row: 409 before reservation", async () => {
  const { events, calls, result } = run({
    plan: PLAN,
    subRow: { provider: "stripe", status: "active" },
  });
  const r = await result;
  assertEquals(r.status, 409);
  assertEquals(calls.length, 0);
  assertEquals(events.filter((e) => e.table === "pagarme_checkout_attempts").length, 0);
});

Deno.test("subscription-row read error DENIES (throws), never treated as no-row", async () => {
  const { result } = run({ plan: PLAN, subRowError: { message: "boom" } });
  let threw = false;
  try {
    await result;
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("concurrent reservation (23505): 409 and ZERO remote calls", async () => {
  const { calls, result } = run({
    plan: PLAN,
    reserveError: { code: "23505", message: "duplicate key" },
  });
  const r = await result;
  assertEquals(r.status, 409);
  assertEquals(calls.length, 0);
});

Deno.test("happy path, no trial: order, idempotency key, single-statement bind, plan write", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: { provider: "stripe", status: "canceled", ever_subscribed_at: "2026-01-01T00:00:00Z" } },
    { subStatus: "active", nextBillingAt: "2027-08-12T00:00:00Z" },
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    status: "active",
    trial_ends_at: null,
    next_charge_at: "2027-08-12T00:00:00Z",
    installment_amount_cents: 7992,
  });

  // Gateway call order and shapes
  assertEquals(calls.map((c) => c.method), ["upsertCustomer", "attachCard", "createSubscription"]);
  const customerInput = calls[0].args[0] as Record<string, unknown>;
  assertEquals(customerInput.email, "owner@agencia.com");
  assertEquals(customerInput.name, "Dona Owner");
  assertEquals(customerInput.document, "11144477735");
  const subInput = calls[2].args[0] as Record<string, unknown>;
  assertEquals(subInput.plan_id, "plan_remote_1");
  assertEquals(subInput.card_id, "card_1");
  assertEquals(subInput.installments, 12);
  assertEquals(subInput.start_at, undefined); // prior subscriber: no trial
  assertEquals(subInput.metadata, { workspace_id: WS, plan_id: "start" });
  assertEquals(calls[2].args[1], "pagarme-co-at-1");

  // Orphan traceability BEFORE the row bind
  const subIdWrite = events.findIndex((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" &&
    e.values?.pagarme_subscription_id === "sub_1"
  );
  const rowBind = events.findIndex((e) => e.table === "workspace_subscriptions" && e.op === "update");
  assert(subIdWrite !== -1, "attempt sub-id write missing");
  assert(rowBind !== -1, "row bind missing");
  assert(subIdWrite < rowBind, "attempt sub-id write must land BEFORE the row bind");

  // Single-statement invariant: provider flip and amount mirror in the SAME payload
  const bind = events[rowBind].values as Record<string, unknown>;
  assertEquals(bind.provider, "pagarme");
  assertEquals(bind.amount_cents, 95900);
  assertEquals(bind.installments, 12);
  assertEquals(bind.ever_subscribed_at, "2026-01-01T00:00:00Z"); // retained, not overwritten

  // CAS: the bind is pinned to the ownership coordinates observed at gate-read time —
  // the row was a churned Stripe row with NO subscription id, so the pin is
  // provider='stripe' AND stripe_subscription_id IS NULL.
  const bindFilters = events[rowBind].filters;
  assert(
    bindFilters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "stripe"),
    "CAS must pin the observed provider",
  );
  assert(
    bindFilters.some(([m, c]) => m === "is" && c === "stripe_subscription_id"),
    "CAS must pin the observed (null) subscription id",
  );

  // Effective plan written with plan_source pagarme
  const planWrite = events.find((e) => e.table === "workspaces" && e.op === "update");
  assertEquals(planWrite?.values, { plan_id: "start", plan_source: "pagarme" });

  // Attempt finishes succeeded
  const succeeded = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "succeeded"
  );
  assert(succeeded !== undefined, "attempt not marked succeeded");
});

Deno.test("trial path: fresh workspace gets start_at now+30d, status future maps to trialing, bind is an INSERT", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null },
    { subStatus: "future", subStartAt: "2026-09-11T00:00:00Z" },
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    status: "trialing",
    trial_ends_at: "2026-09-11T00:00:00Z",
    next_charge_at: "2026-09-11T00:00:00Z",
    installment_amount_cents: 7992,
  });
  const subInput = calls[2].args[0] as Record<string, unknown>;
  assertEquals(subInput.start_at, "2026-09-11");
  // No row observed at gate time → plain INSERT (a concurrent create surfaces as 23505,
  // never as a silent overwrite), carrying provider + mirror in the same payload.
  const ins = events.find((e) => e.table === "workspace_subscriptions" && e.op === "insert");
  assert(ins !== undefined, "insert bind missing");
  assertEquals((ins.values as Record<string, unknown>).provider, "pagarme");
  assertEquals((ins.values as Record<string, unknown>).amount_cents, 95900);
  assertEquals((ins.values as Record<string, unknown>).workspace_id, WS);
});

Deno.test("legacy stripe id alone kills the trial", async () => {
  const { calls, result } = run(
    { plan: PLAN, subRow: { provider: "stripe", status: "canceled", stripe_subscription_id: "sub_old" } },
    { subStatus: "active" },
  );
  await result;
  const subInput = calls[2].args[0] as Record<string, unknown>;
  assertEquals(subInput.start_at, undefined);
});

Deno.test("remote status failed: compensating cancel, attempt failed, NO bind, NO plan write, 400 invalid_card", async () => {
  const { events, calls, result } = run({ plan: PLAN, subRow: null }, { subStatus: "failed" });
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "invalid_card");
  assertEquals(calls.map((c) => c.method).pop(), "cancelSubscription");
  assertEquals(calls[calls.length - 1].args[0], "sub_1");
  const binds = events.filter((e) =>
    e.table === "workspace_subscriptions" && (e.op === "update" || e.op === "insert")
  );
  assertEquals(binds.length, 0);
  assertEquals(events.filter((e) => e.table === "workspaces" && e.op === "update").length, 0);
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
});

Deno.test("card-stage 4xx: 400 invalid_card, no subscription create, attempt failed", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null },
    { failAt: "card", failWith: new PagarmeApiError(400, { any: "detail" }) },
  );
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "invalid_card");
  assertEquals(calls.some((c) => c.method === "createSubscription"), false);
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
});

Deno.test("bind DB error after subscription create: compensating cancel, attempt failed with sub id, 500", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null, bindInsertError: { message: "db down" } },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 500);
  // The remote sub is cancelled: leaving it alive would let a retry (new attempt = new
  // idempotency key) mint a SECOND subscription.
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === "sub_1"));
  // The orphan pointer was written before the bind attempt: reconciliation can find sub_1.
  const subIdWrite = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" &&
    e.values?.pagarme_subscription_id === "sub_1"
  );
  assert(subIdWrite !== undefined, "orphan pointer missing");
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
});

Deno.test("lost CAS race (zero rows matched): compensating cancel, attempt failed, 409", async () => {
  const { events, calls, result } = run(
    {
      plan: PLAN,
      subRow: { provider: "stripe", status: "canceled", ever_subscribed_at: "2026-01-01T00:00:00Z" },
      bindZeroRows: true,
    },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 409);
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === "sub_1"));
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
  assertEquals(events.filter((e) => e.table === "workspaces" && e.op === "update").length, 0);
});

Deno.test("insert conflict (23505, concurrent create): compensating cancel, 409", async () => {
  const { calls, result } = run(
    { plan: PLAN, subRow: null, bindInsertError: { code: "23505", message: "duplicate key" } },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 409);
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === "sub_1"));
});

Deno.test("orphan-pointer write failure: compensating cancel, attempt failed, 500, NO bind", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null, attemptPointerError: { message: "db hiccup" } },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 500);
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === "sub_1"));
  const binds = events.filter((e) =>
    e.table === "workspace_subscriptions" && (e.op === "update" || e.op === "insert")
  );
  assertEquals(binds.length, 0);
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
});

Deno.test("plan-grant failure AFTER a committed bind: no cancel, attempt succeeded, still 200", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null, planWriteError: { message: "workspaces down" } },
    { subStatus: "active", nextBillingAt: "2027-08-12T00:00:00Z" },
  );
  const r = await result;
  // The subscription is live and BOUND; failing the request would tell the user to retry a
  // checkout that can only 409 now. The CRITICAL log is the alert; recovery is support/webhook.
  assertEquals(r.status, 200);
  assertEquals(calls.some((c) => c.method === "cancelSubscription"), false);
  const succeeded = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "succeeded"
  );
  assert(succeeded !== undefined, "attempt not marked succeeded");
});

Deno.test("stale pending attempts are expired before reserving", async () => {
  const { events, result } = run({ plan: PLAN, subRow: null }, { subStatus: "active" });
  await result;
  const expire = events.findIndex((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "expired"
  );
  const reserve = events.findIndex((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert");
  assert(expire !== -1, "expiry sweep missing");
  assert(reserve !== -1, "reservation missing");
  assert(expire < reserve, "expiry must run before the reservation");
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts`
Expected: FAIL — handler/gateway modules do not exist.

- [ ] **Step 3: Implement the gateway.** Create `supabase/functions/pagarme-checkout/gateway.ts`:

```ts
// Thin typed port over the Pagar.me core/v5 API for the checkout flow. All I/O goes through
// _shared/pagarme.ts (Basic auth, 5s timeout, PagarmeApiError). The interface exists so the
// handler can be tested with a fake — keep it free of decisions.

import { pagarmeFetch } from "../_shared/pagarme.ts";
import { PagarmeCheckoutRequest } from "./logic.ts";

export interface PagarmeCustomerInput {
  name: string;
  email: string;
  document: string;
  document_type: "cpf" | "cnpj";
  type: "individual" | "company";
  phones: { mobile_phone: { country_code: "55"; area_code: string; number: string } };
}

export interface PagarmeSubscriptionInput {
  plan_id: string;
  customer_id: string;
  card_id: string;
  installments: 12;
  start_at?: string;
  metadata: { workspace_id: string; plan_id: string };
}

export interface PagarmeSubscriptionResponse {
  id: string;
  status: string;
  start_at?: string | null;
  next_billing_at?: string | null;
  current_cycle?: { end_at?: string | null } | null;
}

export interface PagarmeGateway {
  /** POST /customers. Email is the natural key: a second create with the same email UPDATES
   * and returns the same customer (spike criterion 6), so this is find-or-create. */
  upsertCustomer(input: PagarmeCustomerInput): Promise<{ id: string }>;
  /** POST /customers/{id}/cards with billing_address. The address MUST ride on the attach:
   * the token's own billing_address is ignored by the gateway, and passing card_token
   * straight to the subscription deduplicates to a saved card WITHOUT an address, which the
   * charge then rejects (spike finding). Always use the returned card id. */
  attachCard(
    customerId: string,
    token: string,
    address: PagarmeCheckoutRequest["billingAddress"],
  ): Promise<{ id: string }>;
  /** POST /subscriptions with an Idempotency-Key (honored by the gateway; spike criterion 5). */
  createSubscription(
    input: PagarmeSubscriptionInput,
    idempotencyKey: string,
  ): Promise<PagarmeSubscriptionResponse>;
  /** DELETE /subscriptions/{id} — immediate cancel; used to compensate a failed first charge. */
  cancelSubscription(id: string): Promise<void>;
}

export function createPagarmeGateway(): PagarmeGateway {
  return {
    upsertCustomer: (input) => pagarmeFetch<{ id: string }>("POST", "/customers", input),
    attachCard: (customerId, token, address) =>
      pagarmeFetch<{ id: string }>("POST", `/customers/${customerId}/cards`, {
        token,
        billing_address: {
          line_1: address.line1,
          zip_code: address.cep,
          city: address.city,
          state: address.state,
          country: "BR",
        },
      }),
    createSubscription: (input, idempotencyKey) =>
      pagarmeFetch<PagarmeSubscriptionResponse>(
        "POST",
        "/subscriptions",
        { ...input, payment_method: "credit_card" },
        { idempotencyKey },
      ),
    cancelSubscription: async (id) => {
      await pagarmeFetch("DELETE", `/subscriptions/${id}`);
    },
  };
}
```

- [ ] **Step 3b: Make `writeWorkspacePlan` propagate errors.** Replace the body of `supabase/functions/_shared/plan-writer.ts` with:

```ts
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Effective-plan write, guarded so admin comps (plan_source='manual') are never overridden.
 * Read and write errors THROW (they were silently discarded before): in stripe-webhook a
 * throw becomes a 5xx → Stripe redelivery → retried write (the Fase 2 "a failed write must
 * not ack" rule); in pagarme-checkout the caller decides (post-bind failures log CRITICAL
 * without failing the checkout).
 */
export async function writeWorkspacePlan(
  svc: SupabaseClient,
  workspaceId: string,
  planId: string,
  planSource: "stripe" | "pagarme",
) {
  const { data: ws, error: readErr } = await svc
    .from("workspaces").select("plan_source").eq("id", workspaceId).single();
  if (readErr) {
    throw new Error(`workspace read failed for ${workspaceId}: ${readErr.message}`);
  }
  if (ws?.plan_source === "manual") return;
  const { error: writeErr } = await svc.from("workspaces")
    .update({ plan_id: planId, plan_source: planSource }).eq("id", workspaceId);
  if (writeErr) {
    throw new Error(`plan write failed for ${workspaceId}: ${writeErr.message}`);
  }
}
```

Then grep both test suites for callers/mocks of the old silent behavior (`grep -rn "writeWorkspacePlan" supabase/functions apps --include="*.ts"`): the sole production call site is `stripe-webhook/index.ts:230` (already inside the event handler's throw-to-5xx path — no change needed there); update any test double that returned an error object expecting it to be swallowed.

- [ ] **Step 4: Implement the handler.** Create `supabase/functions/pagarme-checkout/handler.ts`:

```ts
// Orchestration of the 12x checkout. Deps are injected ({db, gateway, now}) so the whole
// flow is unit-testable without network or env — the serve shell in index.ts provides the
// real ones. Auth/CORS/rate-limit live in index.ts; everything after "the caller is the
// owner of workspaceId and the body parsed" lives here.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { hasEverSubscribed } from "../_shared/billing-logic.ts";
import { resolveTrialDays } from "../_shared/trial.ts";
import { mapPagarmeTemporalFields, normalizePagarmeStatus } from "../_shared/pagarme-logic.ts";
import { writeWorkspacePlan } from "../_shared/plan-writer.ts";
import {
  buildAttemptIdempotencyKey,
  buildPagarmeSubscriptionColumns,
  installmentAmountCents,
  mapGatewayFailure,
  PagarmeCheckoutRequest,
  pagarmeCheckoutBlocked,
  resolveStartAt,
} from "./logic.ts";
import { PagarmeGateway } from "./gateway.ts";

const STALE_ATTEMPT_MINUTES = 15;

export interface CheckoutContext {
  workspaceId: string;
  userEmail: string;
  userName: string | null;
}

export interface CheckoutResult {
  status: number;
  body: unknown;
}

export function createPagarmeCheckoutHandler(deps: {
  db: SupabaseClient;
  gateway: PagarmeGateway;
  now: () => Date;
}) {
  return async function handle(
    ctx: CheckoutContext,
    reqData: PagarmeCheckoutRequest,
  ): Promise<CheckoutResult> {
    const { db, gateway } = deps;
    const now = deps.now();
    const nowIso = now.toISOString();

    // (1) Plan + server-side gate re-check: the column is the rollout switch, and the
    // frontend gate is advisory. Off means a generic 403 with no detail.
    const { data: plan, error: planErr } = await db
      .from("plans")
      .select("id, price_brl_annual, pagarme_12x_enabled, pagarme_plan_id_annual")
      .eq("id", reqData.planId)
      .single();
    if (planErr) throw new Error(`plan read failed: ${planErr.message}`);
    if (!plan?.pagarme_12x_enabled) {
      return { status: 403, body: { error: "Indisponível." } };
    }
    if (!plan.pagarme_plan_id_annual || plan.price_brl_annual == null) {
      return {
        status: 400,
        body: {
          error: "Plano não configurado para parcelamento. Fale com o suporte.",
          code: "plan_not_configured",
        },
      };
    }

    // (2) Existing row. A read ERROR must deny, not fall through as "no row": that would
    // skip the 409 and duplicate a live subscription.
    const { data: row, error: rowErr } = await db
      .from("workspace_subscriptions")
      .select(
        "provider, stripe_subscription_id, pagarme_customer_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end, ever_subscribed_at",
      )
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    if (rowErr) throw new Error(`subscription read failed: ${rowErr.message}`);
    if (pagarmeCheckoutBlocked(row, now)) {
      return { status: 409, body: { error: "Este workspace já tem uma assinatura vigente." } };
    }

    // (3) Self-heal stale reservations, then reserve atomically. A crash between reserving
    // and finishing must not lock the workspace out until the cron (Fase 5): any pending
    // attempt older than 15 minutes is expired inline first. The partial unique index
    // one_pending_attempt_per_workspace makes the insert the serialization point — NO remote
    // call happens before it, so a concurrent tab costs nothing at the gateway.
    const staleBefore = new Date(now.getTime() - STALE_ATTEMPT_MINUTES * 60_000).toISOString();
    const { error: expireErr } = await db
      .from("pagarme_checkout_attempts")
      .update({ state: "expired", updated_at: nowIso })
      .eq("workspace_id", ctx.workspaceId)
      .eq("state", "pending")
      .lt("created_at", staleBefore);
    if (expireErr) throw new Error(`attempt expiry failed: ${expireErr.message}`);

    const { data: attempt, error: reserveErr } = await db
      .from("pagarme_checkout_attempts")
      .insert({ workspace_id: ctx.workspaceId })
      .select("id")
      .single();
    if (reserveErr) {
      if (reserveErr.code === "23505") {
        return {
          status: 409,
          body: {
            error: "Outra tentativa de pagamento está em andamento. Aguarde alguns instantes e tente de novo.",
          },
        };
      }
      throw new Error(`attempt reservation failed: ${reserveErr.message}`);
    }
    const attemptId = (attempt as { id: string }).id;

    // Best-effort terminal state for the attempt: a failure to record it only costs an
    // earlier-than-necessary 409 for 15 minutes (the expiry sweep clears it), never money.
    const finishAttempt = async (
      state: "succeeded" | "failed",
      pagarmeSubscriptionId?: string,
    ) => {
      const { error } = await db
        .from("pagarme_checkout_attempts")
        .update({
          state,
          updated_at: new Date().toISOString(),
          ...(pagarmeSubscriptionId ? { pagarme_subscription_id: pagarmeSubscriptionId } : {}),
        })
        .eq("id", attemptId);
      if (error) console.error("[pagarme-checkout] attempt update failed:", error.message);
    };

    const GENERIC_500 = {
      error: "Erro ao processar o pagamento. Tente novamente.",
      code: "gateway_error",
    };
    const ROW_CONFLICT_409 = { error: "Este workspace já tem uma assinatura vigente." };

    let stage: "customer" | "card" | "subscription" = "customer";
    try {
      // (4) Trial: permanent per-workspace eligibility, provider-agnostic. start_at in the
      // future means the card is NOT authorized at creation (spike): a bad card surfaces on
      // day 30 and dunning covers it.
      const trialDays = resolveTrialDays(hasEverSubscribed(row));
      const startAt = resolveStartAt(trialDays, now);

      // (5) Customer upsert: email is unique at Pagar.me, so this is find-or-create. The
      // customer may be shared across this owner's workspaces (1:N by design, never a
      // tenant authority); last-write-wins on the shared profile is accepted.
      const customer = await gateway.upsertCustomer({
        name: ctx.userName?.trim() || ctx.userEmail,
        email: ctx.userEmail,
        document: reqData.document,
        document_type: reqData.documentType,
        type: reqData.customerType,
        phones: {
          mobile_phone: {
            country_code: "55",
            area_code: reqData.phone.ddd,
            number: reqData.phone.number,
          },
        },
      });

      // (6) Card attach WITH billing_address; always use the card id from THIS response,
      // never list/reuse the customer's saved cards (no card crosses workspaces).
      stage = "card";
      const card = await gateway.attachCard(customer.id, reqData.cardToken, reqData.billingAddress);

      // (7) Subscription with the attempt-derived Idempotency-Key: a retry of the same
      // reservation converges on the same remote subscription instead of a duplicate.
      stage = "subscription";
      const sub = await gateway.createSubscription(
        {
          plan_id: plan.pagarme_plan_id_annual as string,
          customer_id: customer.id,
          card_id: card.id,
          installments: 12,
          ...(startAt ? { start_at: startAt } : {}),
          metadata: { workspace_id: ctx.workspaceId, plan_id: reqData.planId },
        },
        buildAttemptIdempotencyKey(attemptId),
      );

      // ── Commit phase. The remote subscription now EXISTS. Every failure path below,
      // up to a committed bind, resolves by CANCELING it (compensation): leaving it alive
      // would let a user retry mint a SECOND subscription, because the idempotency key is
      // per attempt. With the 30-day trial nothing was charged; without it, one charge may
      // need a manual refund — still strictly better than a paid subscription bound to
      // nothing. After a committed bind, failures never cancel. DB failures here RETURN
      // (after compensating) instead of throwing, so the outer catch stays a pure
      // gateway-stage mapper. ──
      const failCompensating = async (status: number, body: unknown): Promise<CheckoutResult> => {
        try {
          await gateway.cancelSubscription(sub.id);
        } catch (e) {
          console.error(
            "[pagarme-checkout] compensating cancel failed:",
            e instanceof Error ? e.message : String(e),
          );
        }
        await finishAttempt("failed", sub.id);
        return { status, body };
      };

      // (8) Orphan pointer — MANDATORY: it is what reconciliation depends on. If it cannot
      // be committed, the only safe outcome is to cancel the remote sub and fail.
      const { error: ptrErr } = await db
        .from("pagarme_checkout_attempts")
        .update({ pagarme_subscription_id: sub.id, updated_at: new Date().toISOString() })
        .eq("id", attemptId);
      if (ptrErr) {
        console.error("[pagarme-checkout] attempt sub-id write failed:", ptrErr.message);
        return await failCompensating(500, GENERIC_500);
      }

      // (9) "failed" is the undocumented fourth status: the first charge was refused, no
      // plan was ever granted, so there is nothing to preserve. Any other non-live status
      // at creation (canceled / unknown) gets the same treatment: nothing was granted.
      const normalized = normalizePagarmeStatus(sub.status);
      if (normalized !== "trialing" && normalized !== "active") {
        console.error(`[pagarme-checkout] subscription born non-live (status=${sub.status})`);
        return await failCompensating(400, {
          error: "Cartão recusado. Confira os dados ou tente outro cartão.",
          code: "invalid_card",
        });
      }

      // (10) CAS bind, single statement: provider flip + full amount mirror together
      // (master-plan INVARIANTE; the admin reads the mirror for pagarme rows and never
      // live-fetches). The write is pinned to the ownership coordinates observed at
      // gate-read time — provider plus that provider's registered subscription id —
      // mirroring the Fase 2 stripe-webhook CAS. If a concurrent writer (e.g. a Stripe
      // checkout.session.completed bind) changed the row in between, zero rows match: we
      // compensate and 409 instead of silently clobbering a freshly bound subscription.
      // With no row observed, a plain INSERT (never upsert) makes the concurrent-create
      // case surface as a 23505 instead of an overwrite.
      const temporal = mapPagarmeTemporalFields(sub);
      const columns = buildPagarmeSubscriptionColumns({
        customerId: customer.id,
        subscriptionId: sub.id,
        status: normalized,
        planId: reqData.planId,
        annualPriceCents: Number(plan.price_brl_annual),
        currentPeriodEnd: temporal.current_period_end,
        everSubscribedAt: (row?.ever_subscribed_at as string | null) ?? nowIso,
        nowIso,
      });
      if (row) {
        const observedProvider = (row.provider as string | null) ?? "stripe";
        const observedIdColumn = observedProvider === "pagarme"
          ? "pagarme_subscription_id"
          : "stripe_subscription_id";
        const observedId = (row as Record<string, unknown>)[observedIdColumn] ?? null;
        let bind = db
          .from("workspace_subscriptions")
          .update(columns)
          .eq("workspace_id", ctx.workspaceId)
          .eq("provider", observedProvider);
        bind = observedId == null
          ? bind.is(observedIdColumn, null)
          : bind.eq(observedIdColumn, observedId);
        const { data: bound, error: bindErr } = await bind.select("workspace_id");
        if (bindErr) {
          console.error("[pagarme-checkout] bind update failed:", bindErr.message);
          return await failCompensating(500, GENERIC_500);
        }
        if (!bound?.length) {
          console.error(
            `[pagarme-checkout] ownership changed under checkout for workspace ${ctx.workspaceId}`,
          );
          return await failCompensating(409, ROW_CONFLICT_409);
        }
      } else {
        const { error: insErr } = await db
          .from("workspace_subscriptions")
          .insert({ workspace_id: ctx.workspaceId, ...columns });
        if (insErr) {
          if (insErr.code === "23505") {
            console.error(
              `[pagarme-checkout] concurrent row create under checkout for workspace ${ctx.workspaceId}`,
            );
            return await failCompensating(409, ROW_CONFLICT_409);
          }
          console.error("[pagarme-checkout] bind insert failed:", insErr.message);
          return await failCompensating(500, GENERIC_500);
        }
      }

      // (11) Effective plan (respects admin comps via plan_source='manual'). POST-BIND: the
      // subscription is live and bound, so a failure here must NOT cancel it, and failing
      // the request would tell the user to retry a checkout that can only 409 now. Log
      // CRITICAL and answer 200; recovery is support/admin (and the Fase 4 webhook).
      try {
        await writeWorkspacePlan(db, ctx.workspaceId, reqData.planId, "pagarme");
      } catch (e) {
        console.error(
          `[pagarme-checkout] CRITICAL: plan grant failed for workspace ${ctx.workspaceId}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
      await finishAttempt("succeeded", sub.id);

      return {
        status: 200,
        body: {
          status: normalized,
          trial_ends_at: normalized === "trialing" ? temporal.current_period_end : null,
          next_charge_at: temporal.current_period_end,
          installment_amount_cents: installmentAmountCents(Number(plan.price_brl_annual)),
        },
      };
    } catch (err) {
      await finishAttempt("failed");
      // Stage name + message only — NEVER the request body (card/document/address).
      console.error(
        `[pagarme-checkout] ${stage} stage failed:`,
        err instanceof Error ? err.message : String(err),
      );
      return mapGatewayFailure(stage, err);
    }
  };
}
```

- [ ] **Step 5: Run to verify pass.**

Run: `deno test supabase/functions/__tests__/pagarme-checkout-handler_test.ts` and `deno test supabase/functions/__tests__/pagarme-checkout-logic_test.ts`, then the full `npm run test:functions` (the plan-writer change touches stripe-webhook's path — the whole suite must stay green). `git checkout -- deno.lock` after.
Expected: PASS.

- [ ] **Step 6: Typecheck the new/changed modules.**

Run: `deno check supabase/functions/pagarme-checkout/handler.ts supabase/functions/pagarme-checkout/gateway.ts supabase/functions/_shared/plan-writer.ts`
Expected: clean (no NEW errors; supabase-js generic-skew noise from other files is pre-existing and not in these modules).

- [ ] **Step 7: Commit.**

```bash
git add supabase/functions/pagarme-checkout/gateway.ts supabase/functions/pagarme-checkout/handler.ts supabase/functions/_shared/plan-writer.ts supabase/functions/__tests__/pagarme-checkout-handler_test.ts
git commit -m "feat(billing): pagarme-checkout handler with CAS bind and compensating cancel"
```

---

### Task 4: `index.ts` serve shell + config.toml + full battery

**Files:**
- Create: `supabase/functions/pagarme-checkout/index.ts`
- Modify: `supabase/config.toml` (add entry next to `[functions.billing-checkout]`)
- Modify: `supabase/functions/__tests__/config-audit_test.ts` (REQUIRED_FUNCTIONS allowlist)

**Interfaces:**
- Consumes: `parseCheckoutBody` (Task 2), `createPagarmeGateway` (Task 3), `createPagarmeCheckoutHandler` (Task 3), `checkRateLimit` + `getClientIP` from `_shared/rate-limit.ts`, `isWorkspaceOwner` from `_shared/workspace-role.ts`, `buildCorsHeaders` from `_shared/cors.ts`.
- Produces: the deployed HTTP contract:
  `POST /functions/v1/pagarme-checkout` with `Authorization: Bearer <supabase token>` and body `{ plan_id, interval: "year", installments: 12, card_token, document, phone: { ddd, number }, billing_address: { cep, line_1, city, state }, source }` → `200 { status: "trialing"|"active", trial_ends_at, next_charge_at, installment_amount_cents }` | `400 { error, code }` | `401` | `403` | `405` | `409` | `429` | `500`.

- [ ] **Step 1: Implement.** Create `supabase/functions/pagarme-checkout/index.ts`:

```ts
// Serve shell for the 12x checkout: CORS, JWT auth, workspace-owner check, rate limit and
// body validation. Everything after that is handler.ts (unit-tested with injected deps).
// Auth is byte-for-byte the billing-checkout pattern: service-role client + getUser(token),
// owner checked against workspace_members for THIS workspace, never profiles.role.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { isWorkspaceOwner } from "../_shared/workspace-role.ts";
import { checkRateLimit, getClientIP } from "../_shared/rate-limit.ts";
import { parseCheckoutBody } from "./logic.ts";
import { createPagarmeGateway } from "./gateway.ts";
import { createPagarmeCheckoutHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const headers = { "Content-Type": "application/json", ...corsHeaders };

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, headers);
    const token = authHeader.replace("Bearer ", "");

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await svc.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401, headers);
    if (!user.email) return json({ error: "Unauthorized" }, 401, headers);

    const { data: profile } = await svc
      .from("profiles").select("conta_id, nome").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "No workspace" }, 400, headers);
    const workspaceId = profile.conta_id as string;

    const { data: membership } = await svc
      .from("workspace_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!isWorkspaceOwner(membership?.role as string | null | undefined)) {
      return json({ error: "Forbidden" }, 403, headers);
    }

    // This endpoint charges a tokenized card — a card-testing target. Tighter than the
    // usual limits: 5/h per workspace, 10/h per IP. checkRateLimit fails open by design.
    const wsAllowed = await checkRateLimit(svc, `pagarme-checkout:ws:${workspaceId}`, 5, 3600);
    const ipAllowed = await checkRateLimit(svc, `pagarme-checkout:ip:${getClientIP(req)}`, 10, 3600);
    if (!wsAllowed || !ipAllowed) {
      return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." }, 429, headers);
    }

    // parseCheckoutBody takes `unknown` and 400s any non-object (null / string / array),
    // so a malformed JSON body can never turn into a 500 here.
    const body: unknown = await req.json().catch(() => null);
    const parsed = parseCheckoutBody(body);
    if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, parsed.status, headers);

    const handle = createPagarmeCheckoutHandler({
      db: svc,
      gateway: createPagarmeGateway(),
      now: () => new Date(),
    });
    const result = await handle(
      {
        workspaceId,
        userEmail: user.email,
        userName: (profile.nome as string | null) ?? null,
      },
      parsed.value,
    );
    return json(result.body, result.status, headers);
  } catch (err) {
    // Message only — the request body carries card_token/document/address and must never
    // reach the logs (PCI/LGPD).
    console.error("[pagarme-checkout] error:", err instanceof Error ? err.message : String(err));
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}
```

- [ ] **Step 2: config.toml.** In `supabase/config.toml`, directly after the `[functions.billing-checkout]` block, add:

```toml
[functions.pagarme-checkout]
verify_jwt = false
```

(The function verifies the JWT itself via `getUser(token)`, same as billing-checkout; the platform-level check would break CORS preflights.)

- [ ] **Step 2b: config-audit coverage.** In `supabase/functions/__tests__/config-audit_test.ts`, the `REQUIRED_FUNCTIONS` allowlist has a billing section ending in:

```ts
  // Billing (manual auth: user-JWT or Stripe signature)
  "billing-checkout",
  "billing-portal",
  "stripe-webhook",
```

Add `"pagarme-checkout",` after `"billing-checkout",`. Without it, accidentally removing the TOML block in the future would not fail the audit. Run `deno test supabase/functions/__tests__/config-audit_test.ts` — both audit tests must pass (the second one also verifies the configured function has a source directory, which Task 3 created).

- [ ] **Step 3: Typecheck + full battery.**

```bash
deno check supabase/functions/pagarme-checkout/index.ts
npm run test:functions
git checkout -- deno.lock
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all green (no frontend files were touched, but the battery is cheap insurance). If prettier flags the new files, run `npm run format` and re-check.

- [ ] **Step 4: Commit.**

```bash
git add supabase/functions/pagarme-checkout/index.ts supabase/config.toml supabase/functions/__tests__/config-audit_test.ts
git commit -m "feat(billing): pagarme-checkout serve shell with owner auth and rate limits"
```

---

## Deploy notes (post-merge, not part of the tasks)

- No migration this phase. Deploy order irrelevant between the two functions.
- `npx supabase functions deploy billing-checkout pagarme-checkout --no-verify-jwt --use-api` on PROD and STAGING (check `supabase/.temp/project-ref` first — the link flips; it was left on STAGING after Fase 2). Deploy pollutes `node_modules` → `npm ci` after.
- Deploying to prod WITHOUT `PAGARME_SECRET_KEY` set is safe: the gate 403s before any Pagar.me call and `_shared/pagarme.ts` reads the key lazily per call. Set the staging secret (sandbox `sk_test_`) when staging E2E starts; the key lives in `~/.pagarme-spike.env`, passed via file redirection, never as a CLI arg.
- `plans.pagarme_plan_id_annual` + `pagarme_12x_enabled` stay unset/false everywhere until Fase 6 (admin checkbox) / Fase 7 (flip). Creating the remote Pagar.me plan objects is part of the staging E2E setup.

## Verification summary

- `pagarme-logic_test.ts`: `crossProviderCheckoutBlocked` matrix (6 named tests).
- `pagarme-checkout-logic_test.ts`: body validation (non-object bodies + accept/normalize + 13 rejection cases + document-code distinction), 409 gate matrix (incl. same-provider past_due and stripe unpaid), start_at, idempotency key, installment rounding, single-payload column builder, decline mapping incl. no-leak test.
- `pagarme-checkout-handler_test.ts`: gate off, unconfigured plan, 409 before reservation, read-error denies, reservation conflict with zero remote calls, happy path (call order, idempotency key, orphan-pointer-before-bind, single-statement CAS bind with pinned coordinates, ever_subscribed_at retention, plan write, attempt succeeded), trial path with INSERT bind, legacy-stripe-id no-trial, failed-status compensating cancel, card-stage 4xx, bind-DB-error compensation, lost-CAS-race compensation + 409, insert-conflict compensation + 409, mandatory orphan-pointer failure compensation, post-bind plan-grant failure (200, no cancel), stale-attempt expiry ordering.
- `config-audit_test.ts`: pagarme-checkout covered by the verify_jwt allowlist.
- Battery: `npm run test:functions`, `npm run test`, 4× tsc, lint, format:check.

## Spec-review amendments (Codex, pre-implementation)

Folded in: billing-checkout select error → fail closed (P0); CAS bind + compensating cancel on every post-create pre-bind failure, mandatory orphan pointer (P0×2); same-provider past_due + stripe unpaid block the pagarme gate (P1); `writeWorkspacePlan` propagates errors (P1); `parseCheckoutBody` takes `unknown` (P2); config-audit allowlist (P3). Rejected: cross-provider serialization via lock/migration/RPC (the CAS + compensation achieves convergence without new infra); branch-precondition point (the branch was created before execution started).
