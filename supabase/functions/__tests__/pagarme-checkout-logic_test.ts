import { assert, assertEquals } from "./assert.ts";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import {
  buildAttemptIdempotencyKey,
  buildPagarmeSubscriptionColumns,
  ceilToUtcMidnightDate,
  mapGatewayFailure,
  pagarmeCheckoutBlocked,
  parseCheckoutBody,
  resolveAmountMirror,
  resolveStartAt,
  stripeSwitchSourceEligible,
} from "../pagarme-checkout/logic.ts";
import type { PagarmeSubscriptionResponse } from "../pagarme-checkout/gateway.ts";

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
    isSwitch: false,
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

Deno.test("parseCheckoutBody: switch true e aceito e vira isSwitch", () => {
  const r = parseCheckoutBody({ ...validBody(), switch: true });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.isSwitch, true);
});

Deno.test("parseCheckoutBody: switch ausente -> isSwitch false", () => {
  const r = parseCheckoutBody(validBody());
  assert(r.ok);
  if (r.ok) assertEquals(r.value.isSwitch, false);
});

Deno.test("parseCheckoutBody: switch presente e nao-boolean-true -> 400", () => {
  for (const bad of [false, "true", 1, null]) {
    const r = parseCheckoutBody({ ...validBody(), switch: bad });
    assert(!r.ok, `switch=${String(bad)}`);
  }
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

// ─── small helpers ─────────────────────────────────────────────────────────

Deno.test("resolveStartAt: 30 trial days round UP to the next UTC midnight (never a short trial)", () => {
  // NOW is 12:00 UTC; +30d lands at 2026-09-11T12:00Z — the gateway reads a date as
  // midnight UTC, so releasing on 09-11 would grant only 29.5 days. Ceil to 09-12.
  assertEquals(resolveStartAt(30, NOW), "2026-09-12");
});

Deno.test("resolveStartAt: an exact-midnight now needs no rounding", () => {
  assertEquals(resolveStartAt(30, new Date("2026-08-12T00:00:00.000Z")), "2026-09-11");
});

Deno.test("resolveStartAt: no trial means no start_at", () => {
  assertEquals(resolveStartAt(undefined, NOW), undefined);
});

Deno.test("buildAttemptIdempotencyKey derives from the attempt id", () => {
  assertEquals(buildAttemptIdempotencyKey("a1b2"), "pagarme-co-a1b2");
});

// ─── resolveAmountMirror (TRUTHFUL-MIRROR RULE) ─────────────────────────────

function subWithItems(price: unknown): PagarmeSubscriptionResponse {
  return {
    id: "sub_1",
    status: "active",
    // deno-lint-ignore no-explicit-any
    items: [{ pricing_scheme: { price } }] as any,
  };
}

Deno.test("resolveAmountMirror: observed total present and matching -> uses it, no drift", () => {
  const r = resolveAmountMirror(subWithItems(113880), 9490);
  assertEquals(r, {
    amountCents: 113880,
    installmentAmountCents: 9490,
    source: "observed",
    driftDetected: false,
  });
});

Deno.test("resolveAmountMirror: observed total present and DIFFERS from configured*12 -> uses the observed total, flags drift", () => {
  const r = resolveAmountMirror(subWithItems(155880), 9490);
  assertEquals(r.amountCents, 155880);
  assertEquals(r.installmentAmountCents, 12990); // round(155880/12)
  assertEquals(r.source, "observed");
  assertEquals(r.driftDetected, true);
});

Deno.test("resolveAmountMirror: rounds the per-installment display amount to the nearest centavo", () => {
  const r = resolveAmountMirror(subWithItems(95900), 9490);
  assertEquals(r.installmentAmountCents, 7992); // round(95900/12)
});

Deno.test("resolveAmountMirror: no items on the response -> fallback to configured*12, never drift", () => {
  const r = resolveAmountMirror({ id: "sub_1", status: "active" }, 9490);
  assertEquals(r, {
    amountCents: 113880,
    installmentAmountCents: 9490,
    source: "fallback",
    driftDetected: false,
  });
});

Deno.test("resolveAmountMirror: empty items array -> fallback", () => {
  const r = resolveAmountMirror({ id: "sub_1", status: "active", items: [] }, 9490);
  assertEquals(r.source, "fallback");
});

Deno.test("resolveAmountMirror: non-numeric price -> fallback", () => {
  const r = resolveAmountMirror(subWithItems("113880"), 9490);
  assertEquals(r.source, "fallback");
});

Deno.test("resolveAmountMirror: zero or negative price is malformed -> fallback", () => {
  assertEquals(resolveAmountMirror(subWithItems(0), 9490).source, "fallback");
  assertEquals(resolveAmountMirror(subWithItems(-100), 9490).source, "fallback");
});

Deno.test("resolveAmountMirror: non-integer price is malformed -> fallback", () => {
  assertEquals(resolveAmountMirror(subWithItems(113880.5), 9490).source, "fallback");
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
    switched_from_stripe_subscription_id: null,
    switched_from_plan_id: null,
    switch_checked_at: null,
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

Deno.test("mapGatewayFailure: never leaks the gateway body", () => {
  const r = mapGatewayFailure("card", new PagarmeApiError(400, { message: "SECRET detail" }));
  assertEquals(JSON.stringify(r).includes("SECRET"), false);
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
