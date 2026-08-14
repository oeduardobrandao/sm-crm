// Pure decisions for the pagarme-checkout flow. No network/env/Supabase access — everything
// here is unit-tested in isolation, mirroring _shared/pagarme-logic.ts. The PagarmeApiError
// import is env-free (the secret key is only required inside pagarmeFetch).

import { PagarmeApiError } from "../_shared/pagarme.ts";
import { isInForce, isPaidThrough } from "../_shared/pagarme-logic.ts";
import { PAGARME_PAID_PLAN_IDS } from "../_shared/billing-logic.ts";
import type { PagarmeSubscriptionResponse } from "./gateway.ts";

// Re-exported for callers that imported the old local name; the list itself now lives in
// _shared/billing-logic.ts so plan-mutations' admin-side validation can share it.
const PAID_PLANS: readonly string[] = PAGARME_PAID_PLAN_IDS;

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
 * charges its first installment at creation. Because the gateway reads the date as
 * MIDNIGHT UTC, a plain truncation would shorten the advertised trial (a checkout at noon
 * would grant 29.5 days): the boundary is rounded UP to the next UTC midnight, so the
 * trial is never shorter than advertised (30.0 to 30.99 days).
 */
export function resolveStartAt(trialDays: number | undefined, now: Date): string | undefined {
  if (!trialDays) return undefined;
  const end = new Date(now.getTime() + trialDays * 24 * 3600 * 1000);
  if (
    end.getUTCHours() !== 0 || end.getUTCMinutes() !== 0 ||
    end.getUTCSeconds() !== 0 || end.getUTCMilliseconds() !== 0
  ) {
    end.setUTCHours(24, 0, 0, 0); // ceil to the next UTC midnight
  }
  return end.toISOString().slice(0, 10);
}

/**
 * Idempotency key for POST /subscriptions, derived from the attempt row id: a network retry
 * of the SAME reservation maps to the same remote subscription (spike criterion 5 proved
 * /subscriptions honors the key), while a new reservation gets a fresh key.
 */
export function buildAttemptIdempotencyKey(attemptId: string): string {
  return `pagarme-co-${attemptId}`;
}

/**
 * TRUTHFUL-MIRROR RULE (Fase 8 adjudication): the admin treats `amount_cents` as
 * authoritative for pagarme rows and never live-fetches, so recording the CONFIGURED price
 * while the gateway actually charged a different one (a stale/hand-edited Pagar.me plan
 * object) corrupts billing/MRR. The gateway-observed total from the create response
 * (`items[0].pricing_scheme.price`) wins whenever it is present and a positive integer;
 * `pagarme_installment_cents * 12` is only the fallback when the response is missing or
 * malformed. A drift between the observed total and the configured one is logged CRITICAL
 * by the caller but never fails the checkout: the gateway already charged, and reversing a
 * completed charge is strictly worse than an accurate mirror of what happened.
 */
export interface AmountMirrorResult {
  /** What actually got charged (or the best fallback) — goes straight into `amount_cents`. */
  amountCents: number;
  /** Per-installment display amount for the checkout response. */
  installmentAmountCents: number;
  source: "observed" | "fallback";
  /** True when the observed total disagrees with `pagarme_installment_cents * 12` — the
   * caller logs CRITICAL when this is true. Always false on the fallback path (nothing to
   * compare against). */
  driftDetected: boolean;
}

/** The gateway-observed total, or null when the response has no usable price (absent
 * `items`, non-numeric, zero/negative). Zero/negative is treated as malformed, not "free":
 * a real Pagar.me plan object is never priced at zero. */
function extractObservedTotalCents(sub: PagarmeSubscriptionResponse): number | null {
  const price = sub.items?.[0]?.pricing_scheme?.price;
  if (typeof price !== "number" || !Number.isInteger(price) || price <= 0) return null;
  return price;
}

export function resolveAmountMirror(
  sub: PagarmeSubscriptionResponse,
  configuredInstallmentCents: number,
): AmountMirrorResult {
  const observed = extractObservedTotalCents(sub);
  if (observed !== null) {
    const configuredTotal = configuredInstallmentCents * 12;
    return {
      amountCents: observed,
      installmentAmountCents: Math.round(observed / 12),
      source: "observed",
      driftDetected: observed !== configuredTotal,
    };
  }
  return {
    amountCents: configuredInstallmentCents * 12,
    installmentAmountCents: configuredInstallmentCents,
    source: "fallback",
    driftDetected: false,
  };
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
