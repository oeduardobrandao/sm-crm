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

Deno.test("mapGatewayFailure: never leaks the gateway body", () => {
  const r = mapGatewayFailure("card", new PagarmeApiError(400, { message: "SECRET detail" }));
  assertEquals(JSON.stringify(r).includes("SECRET"), false);
});
