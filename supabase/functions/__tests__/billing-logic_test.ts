import { assert, assertEquals } from "./assert.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  aggregateMrr,
  extractInvoiceSubscriptionId,
  getDefaultPlanId,
  hasEverSubscribed,
  isMrrStatus,
  pendingPagarmeAttemptBlocksCheckout,
  quarantinedAttemptBlocksCheckout,
  resolvePlanFromPriceId,
  statusToPlanId,
  toMonthlyCents,
} from "../_shared/billing-logic.ts";

Deno.test("statusToPlanId: active/trialing grant the subscribed plan", () => {
  assertEquals(statusToPlanId("active", "pro", "free"), "pro");
  assertEquals(statusToPlanId("trialing", "starter", "free"), "starter");
});

Deno.test("statusToPlanId: past_due/incomplete leave plan unchanged (null)", () => {
  assertEquals(statusToPlanId("past_due", "pro", "free"), null);
  assertEquals(statusToPlanId("incomplete", "pro", "free"), null);
});

Deno.test("statusToPlanId: terminal statuses downgrade to default", () => {
  for (const s of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
    assertEquals(statusToPlanId(s, "pro", "free"), "free");
  }
});

Deno.test("statusToPlanId: unknown status leaves plan unchanged", () => {
  assertEquals(statusToPlanId("future_status", "pro", "free"), null);
});

Deno.test("resolvePlanFromPriceId: matches monthly and annual prices", () => {
  const plans = [
    { id: "starter", stripe_price_id: "price_s_m", stripe_price_id_annual: "price_s_y" },
    { id: "pro", stripe_price_id: "price_p_m", stripe_price_id_annual: "price_p_y" },
  ];
  assertEquals(resolvePlanFromPriceId("price_p_m", plans), { plan_id: "pro", interval: "month" });
  assertEquals(resolvePlanFromPriceId("price_s_y", plans), { plan_id: "starter", interval: "year" });
  assert(resolvePlanFromPriceId("price_unknown", plans) === null);
});

// ─── hasEverSubscribed ────────────────────────────────────────────────────────

Deno.test("hasEverSubscribed: null/undefined row is false", () => {
  assertEquals(hasEverSubscribed(null), false);
  assertEquals(hasEverSubscribed(undefined), false);
});

Deno.test("hasEverSubscribed: only stripe_subscription_id set is true", () => {
  assertEquals(
    hasEverSubscribed({
      ever_subscribed_at: null,
      stripe_subscription_id: "sub_123",
      pagarme_subscription_id: null,
    }),
    true,
  );
});

Deno.test("hasEverSubscribed: only pagarme_subscription_id set is true", () => {
  assertEquals(
    hasEverSubscribed({
      ever_subscribed_at: null,
      stripe_subscription_id: null,
      pagarme_subscription_id: "sub_pg_123",
    }),
    true,
  );
});

Deno.test("hasEverSubscribed: only ever_subscribed_at set is true", () => {
  assertEquals(
    hasEverSubscribed({
      ever_subscribed_at: "2026-01-01T00:00:00.000Z",
      stripe_subscription_id: null,
      pagarme_subscription_id: null,
    }),
    true,
  );
});

Deno.test("hasEverSubscribed: none set is false", () => {
  assertEquals(
    hasEverSubscribed({
      ever_subscribed_at: null,
      stripe_subscription_id: null,
      pagarme_subscription_id: null,
    }),
    false,
  );
});

// ─── MRR helpers ─────────────────────────────────────────────────────────────

Deno.test("isMrrStatus: only active counts; past_due (failed payment), trialing and terminal states do not", () => {
  assert(isMrrStatus("active"));
  for (
    const s of [
      "past_due",
      "trialing",
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
      null,
      undefined,
      "",
    ]
  ) {
    assert(!isMrrStatus(s), `expected ${String(s)} to be excluded`);
  }
});

Deno.test("toMonthlyCents: monthly passthrough, annual /12 rounded, non-positive → null", () => {
  assertEquals(toMonthlyCents("month", 19990), 19990);
  assertEquals(toMonthlyCents("year", 99000), 8250);
  assertEquals(toMonthlyCents("year", 101900), 8492); // R$1019,00/yr → R$84,92/mo
  assertEquals(toMonthlyCents(null, 12345), 12345); // unknown interval treated as monthly
  assertEquals(toMonthlyCents("month", 0), null);
  assertEquals(toMonthlyCents("month", null), null);
  assertEquals(toMonthlyCents("year", -100), null);
});

Deno.test("aggregateMrr: sums monthly-normalized paying rows; total reconciles with breakdown", () => {
  const rows = [
    { workspace_id: "a", status: "active", interval: "month", amount_cents: 19990 }, // 199,90
    { workspace_id: "b", status: "active", interval: "year", amount_cents: 101900 }, // → 84,92
    { workspace_id: "c", status: "active", interval: "month", amount_cents: 9990 }, //   99,90
    { workspace_id: "d", status: "past_due", interval: "month", amount_cents: 11892 }, // excluded (failed payment)
    { workspace_id: "e", status: "trialing", interval: "month", amount_cents: 9990 }, // excluded
    { workspace_id: "f", status: "active", interval: "month", amount_cents: 0 }, // excluded ($0)
  ];
  const r = aggregateMrr(rows);
  assertEquals(r.mrr_cents, 38472); // R$384,72
  assertEquals(r.paying_count, 3);
  assertEquals(r.priced.map((p) => p.monthly_cents), [19990, 8492, 9990]);
  assertEquals(r.priced.reduce((s, p) => s + p.monthly_cents, 0), r.mrr_cents);
});

Deno.test("aggregateMrr: comps and empty input are R$0 (no subscription rows exist)", () => {
  assertEquals(aggregateMrr([]), { mrr_cents: 0, paying_count: 0, priced: [] });
});

Deno.test("aggregateMrr: rows that cannot be priced are dropped, not counted", () => {
  const rows = [
    { status: "active", interval: "month", amount_cents: null }, // unpriced
    { status: "active", interval: "year", amount_cents: 0 }, // $0
    { status: "active", interval: "month", amount_cents: 5000 }, // kept
  ];
  const r = aggregateMrr(rows);
  assertEquals(r.mrr_cents, 5000);
  assertEquals(r.paying_count, 1);
});

// ─── extractInvoiceSubscriptionId ─────────────────────────────────────────────

Deno.test("extractInvoiceSubscriptionId reads the root string shape (acacia)", () => {
  assertEquals(extractInvoiceSubscriptionId({ subscription: "sub_123" }), "sub_123");
});

Deno.test("extractInvoiceSubscriptionId reads an expanded subscription object", () => {
  assertEquals(extractInvoiceSubscriptionId({ subscription: { id: "sub_123" } }), "sub_123");
});

Deno.test("extractInvoiceSubscriptionId reads the basil parent shape", () => {
  assertEquals(
    extractInvoiceSubscriptionId({
      parent: { subscription_details: { subscription: "sub_456" } },
    }),
    "sub_456",
  );
});

Deno.test("extractInvoiceSubscriptionId prefers the root shape over parent", () => {
  assertEquals(
    extractInvoiceSubscriptionId({
      subscription: "sub_root",
      parent: { subscription_details: { subscription: "sub_parent" } },
    }),
    "sub_root",
  );
});

Deno.test("extractInvoiceSubscriptionId returns null for a non-subscription invoice", () => {
  assertEquals(extractInvoiceSubscriptionId({}), null);
  assertEquals(extractInvoiceSubscriptionId({ subscription: null }), null);
  assertEquals(extractInvoiceSubscriptionId({ subscription: {} }), null);
});

// ─── pendingPagarmeAttemptBlocksCheckout ────────────────────────────────────

Deno.test("pendingPagarmeAttemptBlocksCheckout: blocks only when a pending attempt was actually found", () => {
  assertEquals(pendingPagarmeAttemptBlocksCheckout(true, null), true);
  assertEquals(pendingPagarmeAttemptBlocksCheckout(false, null), false);
  assertEquals(pendingPagarmeAttemptBlocksCheckout(false, undefined), false);
});

Deno.test("pendingPagarmeAttemptBlocksCheckout: a read ERROR fails OPEN (never blocks), even with a pending attempt", () => {
  assertEquals(pendingPagarmeAttemptBlocksCheckout(true, { message: "timeout" }), false);
  assertEquals(pendingPagarmeAttemptBlocksCheckout(false, { message: "timeout" }), false);
});

// ─── quarantinedAttemptBlocksCheckout ──────────────────────────────────────

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

// ─── getDefaultPlanId ──────────────────────────────────────────────────────

/** Minimal chainable thenable fake for a single `.from("plans").select(...).eq(...).maybeSingle()`
 * read (house pattern, see pagarme-checkout-handler_test.ts's makeDb). */
function makePlansDb(fx: { data?: { id: string } | null; error?: { message: string } | null }): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    abortSignal: () => chain,
    maybeSingle: () => Promise.resolve({ data: fx.data ?? null, error: fx.error ?? null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

Deno.test("getDefaultPlanId: returns the default plan id when present", async () => {
  const db = makePlansDb({ data: { id: "starter" } });
  assertEquals(await getDefaultPlanId(db), "starter");
});

Deno.test('getDefaultPlanId: returns "free" when no default plan row exists', async () => {
  const db = makePlansDb({ data: null });
  assertEquals(await getDefaultPlanId(db), "free");
});

Deno.test("getDefaultPlanId: throws on a read error (never silently downgrades to free)", async () => {
  const db = makePlansDb({ error: { message: "connection reset" } });
  let threw = false;
  try {
    await getDefaultPlanId(db);
  } catch (e) {
    threw = true;
    assert(e instanceof Error && e.message.includes("connection reset"));
  }
  assert(threw, "expected getDefaultPlanId to throw");
});

Deno.test("hasEverSubscribed is true for a never-subscribed workspace with demo_created_at", () => {
  assertEquals(hasEverSubscribed(null, { demo_created_at: "2026-10-01T00:00:00Z" }), true);
});

Deno.test("hasEverSubscribed is false with no row and no demo marker", () => {
  assertEquals(hasEverSubscribed(null, { demo_created_at: null }), false);
  assertEquals(hasEverSubscribed(null, null), false);
});

// ---- teste reverso: datas do checkout ------------------------------------------------------
Deno.test("reverse_trial_uses_trial_end", async () => {
  const { resolveCheckoutTrial } = await import("../_shared/billing-logic.ts");
  const now = new Date("2026-12-01T12:00:00Z");
  const ends = "2026-12-10T15:00:00Z";
  const r = resolveCheckoutTrial(
    { plan_source: "trial", reverse_trial_ends_at: ends, reverse_trial_started_at: "2026-11-26T15:00:00Z" },
    null,
    now,
  );
  assertEquals(r, { kind: "reverse", trialEnd: new Date(ends) });
});

Deno.test("trial_end_floor_48h (ends in 2h -> now + 48h, plus the request margin)", async () => {
  const { resolveCheckoutTrial, STRIPE_MIN_TRIAL_END_MS } = await import("../_shared/billing-logic.ts");
  const now = new Date("2026-12-01T12:00:00Z");
  const r = resolveCheckoutTrial(
    {
      plan_source: "trial",
      reverse_trial_ends_at: "2026-12-01T14:00:00Z",
      reverse_trial_started_at: "2026-11-17T14:00:00Z",
    },
    null,
    now,
  );
  assert(r.kind === "reverse");
  const H = 3_600_000;
  assert(STRIPE_MIN_TRIAL_END_MS > 48 * H, "strictly above Stripe's 48h minimum");
  // end of the current hour + the floor: >= now + 48h10m, <= now + 49h10m
  assertEquals(r.trialEnd.toISOString(), "2026-12-03T13:10:00.000Z");
  // stable inside the hour (billing-checkout's idempotency key is bucketed per hour)
  const later = resolveCheckoutTrial(
    {
      plan_source: "trial",
      reverse_trial_ends_at: "2026-12-01T14:00:00Z",
      reverse_trial_started_at: "2026-11-17T14:00:00Z",
    },
    null,
    new Date("2026-12-01T12:59:59Z"),
  );
  assert(later.kind === "reverse" && later.trialEnd.getTime() === r.trialEnd.getTime());
  assert(later.trialEnd.getTime() - new Date("2026-12-01T12:59:59Z").getTime() >= 48 * H + 10 * 60_000);
  // already past (sweep not run yet): still the floor, never the past
  const past = resolveCheckoutTrial(
    { plan_source: "trial", reverse_trial_ends_at: "2026-12-01T11:00:00Z", reverse_trial_started_at: "x" },
    null,
    now,
  );
  assert(past.kind === "reverse" && past.trialEnd.getTime() === r.trialEnd.getTime());
});

Deno.test("after_reverse_trial_no_trial", async () => {
  const { resolveCheckoutTrial, hasEverSubscribed } = await import("../_shared/billing-logic.ts");
  const ws = {
    plan_source: "system",
    reverse_trial_ends_at: "2026-11-20T12:00:00Z",
    reverse_trial_started_at: "2026-11-06T12:00:00Z",
  };
  assertEquals(resolveCheckoutTrial(ws, null, new Date("2026-12-01T12:00:00Z")), { kind: "none" });
  assertEquals(hasEverSubscribed(null, ws), true);
});

Deno.test("never_trialed_gets_30_days", async () => {
  const { resolveCheckoutTrial } = await import("../_shared/billing-logic.ts");
  const ws = { plan_source: "system", reverse_trial_ends_at: null, reverse_trial_started_at: null };
  assertEquals(resolveCheckoutTrial(ws, null, new Date()), { kind: "days", days: 30 });
  // a past subscription still blocks the card trial
  assertEquals(
    resolveCheckoutTrial(ws, { stripe_subscription_id: "sub_1" }, new Date()),
    { kind: "none" },
  );
  assertEquals(
    resolveCheckoutTrial({ ...ws, demo_created_at: "2026-01-01" }, null, new Date()),
    { kind: "none" },
  );
});
