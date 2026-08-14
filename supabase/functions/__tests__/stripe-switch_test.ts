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
