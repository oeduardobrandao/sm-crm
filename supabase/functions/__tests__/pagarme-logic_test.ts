import { assert, assertEquals } from "./assert.ts";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import {
  buildChargeDunningKey,
  buildRestoreStripeColumns,
  canWebhookWrite,
  crossProviderCheckoutBlocked,
  isDefinitiveGatewayReject,
  isInForce,
  isPaidThrough,
  mapPagarmeTemporalFields,
  normalizePagarmeStatus,
  resolvePagarmePlanTarget,
  shouldAdvanceDunning,
  shouldCancelDeniedCheckoutSub,
  shouldSweepRemoteSubscription,
  stripePortalBlocked,
  SWEEP_MIN_AGE_MS,
} from "../_shared/pagarme-logic.ts";

const NOW = new Date("2026-08-11T00:00:00Z");

// ─── normalizePagarmeStatus ─────────────────────────────────────────────────

Deno.test("normalizePagarmeStatus: future maps to trialing (never persisted as future)", () => {
  assertEquals(normalizePagarmeStatus("future"), "trialing");
});

Deno.test("normalizePagarmeStatus: active and canceled pass through", () => {
  assertEquals(normalizePagarmeStatus("active"), "active");
  assertEquals(normalizePagarmeStatus("canceled"), "canceled");
});

Deno.test("normalizePagarmeStatus: undocumented failed maps to canceled", () => {
  assertEquals(normalizePagarmeStatus("failed"), "canceled");
});

Deno.test('normalizePagarmeStatus("weird") is null', () => {
  assertEquals(normalizePagarmeStatus("weird"), null);
});

// ─── isInForce ───────────────────────────────────────────────────────────────

Deno.test("isInForce: active, trialing and past_due are in force", () => {
  assertEquals(isInForce("active"), true);
  assertEquals(isInForce("trialing"), true);
  assertEquals(isInForce("past_due"), true);
});

Deno.test("isInForce: canceled, unknown, null and undefined are not in force", () => {
  assertEquals(isInForce("canceled"), false);
  assertEquals(isInForce("weird"), false);
  assertEquals(isInForce(null), false);
  assertEquals(isInForce(undefined), false);
});

// ─── isPaidThrough ───────────────────────────────────────────────────────────

Deno.test("isPaidThrough: canceled + cancel_at_period_end + future period end is true", () => {
  const row = {
    status: "canceled",
    cancel_at_period_end: true,
    current_period_end: "2026-12-01T00:00:00Z",
  };
  assertEquals(isPaidThrough(row, NOW), true);
});

Deno.test("isPaidThrough: current_period_end in the past is false", () => {
  const row = {
    status: "canceled",
    cancel_at_period_end: true,
    current_period_end: "2026-01-01T00:00:00Z",
  };
  assertEquals(isPaidThrough(row, NOW), false);
});

Deno.test("isPaidThrough: not canceled is false even with a future period end", () => {
  const row = {
    status: "active",
    cancel_at_period_end: true,
    current_period_end: "2026-12-01T00:00:00Z",
  };
  assertEquals(isPaidThrough(row, NOW), false);
});

Deno.test("isPaidThrough: canceled without cancel_at_period_end is false", () => {
  const row = {
    status: "canceled",
    cancel_at_period_end: false,
    current_period_end: "2026-12-01T00:00:00Z",
  };
  assertEquals(isPaidThrough(row, NOW), false);
});

Deno.test("isPaidThrough: canceled + cancel_at_period_end without a period end is false", () => {
  const row = { status: "canceled", cancel_at_period_end: true, current_period_end: null };
  assertEquals(isPaidThrough(row, NOW), false);
});

// ─── canWebhookWrite ─────────────────────────────────────────────────────────

Deno.test("canWebhookWrite: unknown row, authorized Stripe checkout bind writes", () => {
  const incoming = { provider: "stripe" as const, subscriptionId: "sub_1", isAuthorizedBind: true };
  assertEquals(canWebhookWrite(null, incoming, NOW), true);
});

Deno.test("canWebhookWrite: unknown row, unauthorized Stripe event does not write", () => {
  const incoming = { provider: "stripe" as const, subscriptionId: "sub_1" };
  assertEquals(canWebhookWrite(null, incoming, NOW), false);
});

Deno.test("canWebhookWrite: unknown row, authorized Pagar.me bind still does not write", () => {
  const incoming = {
    provider: "pagarme" as const,
    subscriptionId: "sub_pm_1",
    isAuthorizedBind: true,
  };
  assertEquals(canWebhookWrite(null, incoming, NOW), false);
});

Deno.test("late Stripe deleted after switch does not write", () => {
  const existing = {
    provider: "pagarme",
    pagarme_subscription_id: "sub_pm_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: null,
  };
  const incoming = { provider: "stripe" as const, subscriptionId: "sub_stripe_old" };
  assertEquals(canWebhookWrite(existing, incoming, NOW), false);
});

Deno.test("late Stripe deleted does not write during pagarme paid-through", () => {
  const existing = {
    provider: "pagarme",
    pagarme_subscription_id: "sub_pm_1",
    status: "canceled",
    cancel_at_period_end: true,
    current_period_end: "2026-12-01T00:00:00Z",
  };
  const incoming = { provider: "stripe" as const, subscriptionId: "sub_stripe_old" };
  assertEquals(canWebhookWrite(existing, incoming, NOW), false);
});

Deno.test("webhook never switches provider", () => {
  const existing = {
    provider: "pagarme",
    pagarme_subscription_id: "sub_pm_1",
    status: "canceled",
    cancel_at_period_end: false,
    current_period_end: null,
  };
  const incoming = { provider: "stripe" as const, subscriptionId: "sub_stripe_new" };
  assertEquals(canWebhookWrite(existing, incoming, NOW), false);
});

Deno.test("canWebhookWrite: churned owner not in force, authorized Stripe checkout reclaims the row", () => {
  const existing = {
    provider: "pagarme",
    pagarme_subscription_id: "sub_pm_1",
    status: "canceled",
    cancel_at_period_end: false,
    current_period_end: null,
  };
  const incoming = {
    provider: "stripe" as const,
    subscriptionId: "sub_stripe_new",
    isAuthorizedBind: true,
  };
  assertEquals(canWebhookWrite(existing, incoming, NOW), true);
});

Deno.test("canWebhookWrite: same provider, matching registered id writes", () => {
  const existing = {
    provider: "pagarme",
    pagarme_subscription_id: "sub_pm_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: null,
  };
  const incoming = { provider: "pagarme" as const, subscriptionId: "sub_pm_1" };
  assertEquals(canWebhookWrite(existing, incoming, NOW), true);
});

Deno.test("canWebhookWrite: same provider, no registered id yet, authorized bind writes", () => {
  const existing = {
    provider: "stripe",
    stripe_subscription_id: null,
    status: null,
    cancel_at_period_end: false,
    current_period_end: null,
  };
  const incoming = {
    provider: "stripe" as const,
    subscriptionId: "sub_stripe_1",
    isAuthorizedBind: true,
  };
  assertEquals(canWebhookWrite(existing, incoming, NOW), true);
});

Deno.test("canWebhookWrite: same provider, no registered id yet, unauthorized event does not write", () => {
  const existing = {
    provider: "stripe",
    stripe_subscription_id: null,
    status: null,
    cancel_at_period_end: false,
    current_period_end: null,
  };
  const incoming = { provider: "stripe" as const, subscriptionId: "sub_stripe_1" };
  assertEquals(canWebhookWrite(existing, incoming, NOW), false);
});

Deno.test("payment_failed for an unregistered subscription does not write", () => {
  const existing = {
    provider: "stripe",
    stripe_subscription_id: "sub_stripe_registered",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: null,
  };
  const incoming = { provider: "stripe" as const, subscriptionId: "sub_stripe_other" };
  assertEquals(canWebhookWrite(existing, incoming, NOW), false);
});

Deno.test("canWebhookWrite: same provider, different id, authorized rebind writes", () => {
  const existing = {
    provider: "stripe",
    stripe_subscription_id: "sub_stripe_old",
    status: "canceled",
    cancel_at_period_end: false,
    current_period_end: null,
  };
  const incoming = {
    provider: "stripe" as const,
    subscriptionId: "sub_stripe_new",
    isAuthorizedBind: true,
  };
  assertEquals(canWebhookWrite(existing, incoming, NOW), true);
});

Deno.test("pagarme authorized bind never reclaims a churned row via webhook", () => {
  // only a Stripe checkout event may reclaim a churned row; Pagar.me binds happen synchronously in checkout, never via webhook
  const existing = {
    provider: "stripe",
    stripe_subscription_id: "sub_old",
    status: "canceled",
    cancel_at_period_end: false,
    current_period_end: "2026-01-01T00:00:00Z",
  };
  const incoming = {
    provider: "pagarme" as const,
    subscriptionId: "sub_pg_new",
    isAuthorizedBind: true,
  };
  assertEquals(canWebhookWrite(existing, incoming, NOW), false);
});

// ─── resolvePagarmePlanTarget ────────────────────────────────────────────────

Deno.test("resolvePagarmePlanTarget: trialing and active grant the subscribed plan", () => {
  const row = { cancel_at_period_end: false, current_period_end: null };
  assertEquals(resolvePagarmePlanTarget("trialing", "pro", "free", row, NOW), "pro");
  assertEquals(resolvePagarmePlanTarget("active", "pro", "free", row, NOW), "pro");
});

Deno.test("resolvePagarmePlanTarget: past_due leaves plan unchanged (null, grace)", () => {
  const row = { cancel_at_period_end: false, current_period_end: null };
  assertEquals(resolvePagarmePlanTarget("past_due", "pro", "free", row, NOW), null);
});

Deno.test("resolvePagarmePlanTarget: canceled but paid-through keeps access (null)", () => {
  const row = { cancel_at_period_end: true, current_period_end: "2026-12-01T00:00:00Z" };
  assertEquals(resolvePagarmePlanTarget("canceled", "pro", "free", row, NOW), null);
});

Deno.test("resolvePagarmePlanTarget: canceled without paid-through downgrades to default", () => {
  const row = { cancel_at_period_end: false, current_period_end: null };
  assertEquals(resolvePagarmePlanTarget("canceled", "pro", "free", row, NOW), "free");
});

// ─── mapPagarmeTemporalFields ────────────────────────────────────────────────

Deno.test("mapPagarmeTemporalFields: future uses start_at as the trial boundary", () => {
  const sub = { status: "future", start_at: "2026-09-01T00:00:00Z" };
  assertEquals(mapPagarmeTemporalFields(sub), { current_period_end: "2026-09-01T00:00:00Z" });
});

Deno.test("mapPagarmeTemporalFields: active prefers current_cycle.end_at over next_billing_at", () => {
  const sub = {
    status: "active",
    next_billing_at: "2026-09-15T00:00:00Z",
    current_cycle: { end_at: "2026-09-10T00:00:00Z" },
  };
  assertEquals(mapPagarmeTemporalFields(sub), { current_period_end: "2026-09-10T00:00:00Z" });
});

Deno.test("mapPagarmeTemporalFields: active without current_cycle falls back to next_billing_at", () => {
  const sub = { status: "active", next_billing_at: "2026-09-15T00:00:00Z", current_cycle: null };
  assertEquals(mapPagarmeTemporalFields(sub), { current_period_end: "2026-09-15T00:00:00Z" });
});

Deno.test("mapPagarmeTemporalFields: active with neither field is null", () => {
  const sub = { status: "active" };
  assertEquals(mapPagarmeTemporalFields(sub), { current_period_end: null });
});

Deno.test("mapPagarmeTemporalFields: canceled and other statuses are null", () => {
  assertEquals(mapPagarmeTemporalFields({ status: "canceled" }), { current_period_end: null });
  assertEquals(mapPagarmeTemporalFields({ status: "failed" }), { current_period_end: null });
});

// ─── buildChargeDunningKey / shouldAdvanceDunning ────────────────────────────

Deno.test("buildChargeDunningKey: joins charge id and attempt", () => {
  assertEquals(buildChargeDunningKey("ch_1", 2), "ch_1:2");
});

Deno.test('buildChargeDunningKey: a missing attempt falls back to "na"', () => {
  assertEquals(buildChargeDunningKey("ch_1", null), "ch_1:na");
  assertEquals(buildChargeDunningKey("ch_1", undefined), "ch_1:na");
});

Deno.test("shouldAdvanceDunning: a new charge+attempt key advances", () => {
  assertEquals(shouldAdvanceDunning("ch_1:1", "ch_1:2"), true);
});

Deno.test("shouldAdvanceDunning: a redelivered charge+attempt key does not advance", () => {
  assertEquals(shouldAdvanceDunning("ch_1:2", "ch_1:2"), false);
});

Deno.test("shouldAdvanceDunning: no prior key always advances (first failure)", () => {
  assertEquals(shouldAdvanceDunning(null, "ch_1:1"), true);
  assertEquals(shouldAdvanceDunning(undefined, "ch_1:1"), true);
});

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

// ─── shouldAdvanceDunning: monotonic rule ───────────────────────────────────

Deno.test("shouldAdvanceDunning: same charge, higher attempt advances", () => {
  assertEquals(shouldAdvanceDunning("ch_1:1", "ch_1:2"), true);
});

Deno.test("shouldAdvanceDunning: same charge, lower attempt is a blocked regression", () => {
  assertEquals(shouldAdvanceDunning("ch_1:2", "ch_1:1"), false);
});

Deno.test("shouldAdvanceDunning: identical key never advances", () => {
  assertEquals(shouldAdvanceDunning("ch_1:1", "ch_1:1"), false);
});

Deno.test("shouldAdvanceDunning: no prior key always advances", () => {
  assertEquals(shouldAdvanceDunning(null, "ch_1:1"), true);
});

Deno.test("shouldAdvanceDunning: non-numeric last attempt cannot be ordered, advances", () => {
  assertEquals(shouldAdvanceDunning("ch_1:na", "ch_1:1"), true);
});

Deno.test("shouldAdvanceDunning: non-numeric incoming attempt cannot be ordered, advances", () => {
  assertEquals(shouldAdvanceDunning("ch_1:1", "ch_1:na"), true);
});

Deno.test("shouldAdvanceDunning: different charge ids cannot be ordered, advances", () => {
  assertEquals(shouldAdvanceDunning("ch_1:2", "ch_2:1"), true);
});

// ─── shouldCancelDeniedCheckoutSub ──────────────────────────────────────────

Deno.test("shouldCancelDeniedCheckoutSub: denied checkout bind cancels regardless of remote status", () => {
  assertEquals(shouldCancelDeniedCheckoutSub(true, "active"), true);
  assertEquals(shouldCancelDeniedCheckoutSub(true, "trialing"), true);
  assertEquals(shouldCancelDeniedCheckoutSub(true, "incomplete"), true);
});

Deno.test("shouldCancelDeniedCheckoutSub: non-checkout denial never cancels", () => {
  assertEquals(shouldCancelDeniedCheckoutSub(false, "active"), false);
});

Deno.test("shouldCancelDeniedCheckoutSub: terminal remote status is already resolved, acks", () => {
  assertEquals(shouldCancelDeniedCheckoutSub(true, "canceled"), false);
  assertEquals(shouldCancelDeniedCheckoutSub(true, "incomplete_expired"), false);
});

// ─── isDefinitiveGatewayReject ──────────────────────────────────────────────

Deno.test("isDefinitiveGatewayReject: definitive 4xx (404, 422) are true", () => {
  assertEquals(isDefinitiveGatewayReject(new PagarmeApiError(404, {})), true);
  assertEquals(isDefinitiveGatewayReject(new PagarmeApiError(422, {})), true);
});

Deno.test("isDefinitiveGatewayReject: credential/throttle statuses (401, 403, 429) are false", () => {
  assertEquals(isDefinitiveGatewayReject(new PagarmeApiError(401, {})), false);
  assertEquals(isDefinitiveGatewayReject(new PagarmeApiError(403, {})), false);
  assertEquals(isDefinitiveGatewayReject(new PagarmeApiError(429, {})), false);
});

Deno.test("isDefinitiveGatewayReject: 5xx is false", () => {
  assertEquals(isDefinitiveGatewayReject(new PagarmeApiError(500, {})), false);
});

Deno.test("isDefinitiveGatewayReject: non-gateway errors (network, timeout) are false", () => {
  assertEquals(isDefinitiveGatewayReject(new Error("network")), false);
  assertEquals(isDefinitiveGatewayReject(new DOMException("timeout", "TimeoutError")), false);
});

// ─── shouldSweepRemoteSubscription ──────────────────────────────────────────

const SWEEP_NOW = new Date("2026-08-13T00:00:00Z");
const OLD_ENOUGH = new Date(SWEEP_NOW.getTime() - SWEEP_MIN_AGE_MS - 60_000).toISOString(); // 61 min old
const TOO_YOUNG = new Date(SWEEP_NOW.getTime() - SWEEP_MIN_AGE_MS + 60_000).toISOString(); // 59 min old

Deno.test("shouldSweepRemoteSubscription: linked wins over everything (pending, young, unrecognized)", () => {
  const sub = { id: "sub_1", created_at: TOO_YOUNG, metadata: null };
  assertEquals(
    shouldSweepRemoteSubscription(sub, new Set(["sub_1"]), new Set(["sub_1"]), SWEEP_NOW),
    "skip_linked",
  );
});

Deno.test("shouldSweepRemoteSubscription: pending-attempt wins over young and unrecognized", () => {
  const sub = { id: "sub_2", created_at: TOO_YOUNG, metadata: null };
  assertEquals(
    shouldSweepRemoteSubscription(sub, new Set(), new Set(["sub_2"]), SWEEP_NOW),
    "skip_pending_attempt",
  );
  const oldUnrecognized = { id: "sub_2", created_at: OLD_ENOUGH, metadata: null };
  assertEquals(
    shouldSweepRemoteSubscription(oldUnrecognized, new Set(), new Set(["sub_2"]), SWEEP_NOW),
    "skip_pending_attempt",
  );
});

Deno.test("shouldSweepRemoteSubscription: 59 minutes old is skip_young, 61 minutes old is not", () => {
  const young = { id: "sub_3", created_at: TOO_YOUNG, metadata: { workspace_id: "ws_1" } };
  assertEquals(shouldSweepRemoteSubscription(young, new Set(), new Set(), SWEEP_NOW), "skip_young");
  const old = { id: "sub_3", created_at: OLD_ENOUGH, metadata: { workspace_id: "ws_1" } };
  assertEquals(shouldSweepRemoteSubscription(old, new Set(), new Set(), SWEEP_NOW), "cancel");
});

Deno.test("shouldSweepRemoteSubscription: missing or unparseable created_at is skip_young", () => {
  const missing = { id: "sub_4", created_at: null, metadata: { workspace_id: "ws_1" } };
  assertEquals(shouldSweepRemoteSubscription(missing, new Set(), new Set(), SWEEP_NOW), "skip_young");
  const unparseable = { id: "sub_4", created_at: "not-a-date", metadata: { workspace_id: "ws_1" } };
  assertEquals(
    shouldSweepRemoteSubscription(unparseable, new Set(), new Set(), SWEEP_NOW),
    "skip_young",
  );
});

Deno.test("shouldSweepRemoteSubscription: missing metadata or empty workspace_id is skip_unrecognized", () => {
  const noMetadata = { id: "sub_5", created_at: OLD_ENOUGH, metadata: null };
  assertEquals(
    shouldSweepRemoteSubscription(noMetadata, new Set(), new Set(), SWEEP_NOW),
    "skip_unrecognized",
  );
  const emptyWorkspaceId = { id: "sub_5", created_at: OLD_ENOUGH, metadata: { workspace_id: "" } };
  assertEquals(
    shouldSweepRemoteSubscription(emptyWorkspaceId, new Set(), new Set(), SWEEP_NOW),
    "skip_unrecognized",
  );
});

Deno.test("shouldSweepRemoteSubscription: full orphan (old, unlinked, recognized) is cancel", () => {
  const sub = { id: "sub_6", created_at: OLD_ENOUGH, metadata: { workspace_id: "ws_1" } };
  assertEquals(shouldSweepRemoteSubscription(sub, new Set(), new Set(), SWEEP_NOW), "cancel");
});

// ─── buildRestoreStripeColumns ───────────────────────────────────────────────

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

// ─── stripePortalBlocked ────────────────────────────────────────────────────

Deno.test("stripePortalBlocked: linha pagarme in force ou com marker bloqueia; stripe nunca", () => {
  assert(stripePortalBlocked({ provider: "pagarme", status: "active", switched_from_stripe_subscription_id: null }));
  assert(stripePortalBlocked({ provider: "pagarme", status: "trialing", switched_from_stripe_subscription_id: "sub_s1" }));
  assert(stripePortalBlocked({ provider: "pagarme", status: "canceled", switched_from_stripe_subscription_id: "sub_s1" }));
  assert(!stripePortalBlocked({ provider: "pagarme", status: "canceled", switched_from_stripe_subscription_id: null }));
  assert(!stripePortalBlocked({ provider: "stripe", status: "active", switched_from_stripe_subscription_id: null }));
  assert(!stripePortalBlocked(null));
});
