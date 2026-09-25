import { assertEquals } from "./assert.ts";
import {
  type BackfillLocal,
  buildBackfill,
  mapPagarmeWorkspace,
  type PagarmeSubLite,
  pagarmeStatusAt,
  type StripeSubLite,
  stripeStatusAt,
} from "../platform-admin/metrics-backfill-logic.ts";

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const T_JUN = new Date("2026-07-01T02:44:00Z"); // close of 2026-06-30

const stripeSub = (over: Partial<StripeSubLite> = {}): StripeSubLite => ({
  id: "sub_1", customer: "cus_1", status: "active",
  start_date: sec("2026-06-12T10:00:00Z"), trial_start: null, trial_end: null, ended_at: null,
  price_id: "price_pro_m", amount_cents: 9900, interval: "month", ...over,
});

const pagarmeSub = (over: Partial<PagarmeSubLite> = {}): PagarmeSubLite => ({
  id: "sub_pg1", status: "active", created_at: "2026-08-10T12:00:00Z", start_at: "2026-08-10T12:00:00Z",
  canceled_at: null, interval: "year", price_cents: 120000, metadata_workspace_id: "w2", metadata_plan_id: "max", ...over,
});

const local = (over: Partial<BackfillLocal> = {}): BackfillLocal => ({
  customerToWorkspace: new Map([["cus_1", "w1"]]),
  pagarmeSubToWorkspace: new Map([["sub_pg1", "w2"]]),
  workspaceIds: new Set(["w1", "w2", "w3"]),
  plans: [
    { id: "pro", name: "Pro", stripe_price_id: "price_pro_m", stripe_price_id_annual: "price_pro_y", price_brl_annual: 99000 },
    { id: "max", name: "Max", stripe_price_id: null, stripe_price_id_annual: null, price_brl_annual: 120000 },
  ],
  ...over,
});

Deno.test("stripeStatusAt compares timestamps with the 23:44 close instant", () => {
  // starts at noon on the last day of June: in force at the June close
  assertEquals(stripeStatusAt(stripeSub({ start_date: sec("2026-06-30T15:00:00Z") }), T_JUN), "active");
  assertEquals(stripeStatusAt(stripeSub({ start_date: sec("2026-07-02T00:00:00Z") }), T_JUN), null);
  // trial ending before 23:44 of the last day already counts as active
  assertEquals(
    stripeStatusAt(stripeSub({ trial_start: sec("2026-06-15T00:00:00Z"), trial_end: sec("2026-06-30T20:00:00Z") }), T_JUN),
    "active",
  );
  assertEquals(
    stripeStatusAt(stripeSub({ trial_start: sec("2026-06-15T00:00:00Z"), trial_end: sec("2026-07-15T00:00:00Z") }), T_JUN),
    "trialing",
  );
  assertEquals(stripeStatusAt(stripeSub({ ended_at: sec("2026-06-20T00:00:00Z") }), T_JUN), null);
});

Deno.test("pagarmeStatusAt: future start is trialing, canceled is gone", () => {
  const t = new Date("2026-09-01T02:44:00Z");
  assertEquals(pagarmeStatusAt(pagarmeSub({ created_at: "2026-08-20T00:00:00Z", start_at: "2026-09-10T00:00:00Z" }), t), "trialing");
  assertEquals(pagarmeStatusAt(pagarmeSub(), t), "active");
  assertEquals(pagarmeStatusAt(pagarmeSub({ canceled_at: "2026-08-25T00:00:00Z" }), t), null);
  assertEquals(pagarmeStatusAt(pagarmeSub({ created_at: "2026-09-05T00:00:00Z", start_at: "2026-09-05T00:00:00Z" }), t), null);
});

Deno.test("mapPagarmeWorkspace: mirror id wins, metadata fallback, divergence and unmapped", () => {
  assertEquals(mapPagarmeWorkspace(pagarmeSub(), local()), { workspace_id: "w2" });
  assertEquals(mapPagarmeWorkspace(pagarmeSub({ metadata_workspace_id: null }), local()), { workspace_id: "w2" });
  assertEquals(mapPagarmeWorkspace(pagarmeSub({ metadata_workspace_id: "w3" }), local()), { skip: "divergent" });
  assertEquals(mapPagarmeWorkspace(pagarmeSub({ id: "old_sub", metadata_workspace_id: "w3" }), local()), { workspace_id: "w3" });
  assertEquals(mapPagarmeWorkspace(pagarmeSub({ id: "old_sub", metadata_workspace_id: "gone" }), local()), { skip: "unmapped" });
});

Deno.test("buildBackfill: month-end rows from first start through the last closed month", () => {
  const plan = buildBackfill({
    stripe: [stripeSub({ ended_at: sec("2026-08-15T00:00:00Z") })],
    pagarme: [],
    local: local(),
    internalIds: new Set(),
    todaySP: "2026-09-25",
  });
  assertEquals(plan.dates.map((d) => d.date), ["2026-06-30", "2026-07-31", "2026-08-31"]);
  assertEquals(plan.dates[0].rows, [{
    workspace_id: "w1", provider: "stripe", plan_id: "pro", plan_name: "Pro", status: "active",
    billing_interval: "month", monthly_cents: 9900, amount_source: "backfill", provider_switch: false,
  }]);
  assertEquals(plan.dates[2].rows, []); // ended in August: empty close, still written
});

Deno.test("buildBackfill: Stripe and Pagar.me both in force -> Pagar.me with provider_switch, in either input order", () => {
  const stripe = [stripeSub({ customer: "cus_1" })];
  const pg = [pagarmeSub({ metadata_workspace_id: "w1", id: "sub_pgx", created_at: "2026-08-20T00:00:00Z", start_at: "2026-09-10T00:00:00Z" })];
  const l = local({ pagarmeSubToWorkspace: new Map([["sub_pgx", "w1"]]) });
  for (const [s, p] of [[stripe, pg], [[...stripe].reverse(), [...pg].reverse()]] as const) {
    const plan = buildBackfill({ stripe: [...s], pagarme: [...p], local: l, internalIds: new Set(), todaySP: "2026-09-25" });
    const aug = plan.dates.find((d) => d.date === "2026-08-31")!;
    assertEquals(aug.rows.length, 1);
    assertEquals(aug.rows[0].provider, "pagarme");
    assertEquals(aug.rows[0].status, "trialing");
    assertEquals(aug.rows[0].provider_switch, true);
    assertEquals(aug.rows[0].monthly_cents, 10000);
  }
});

Deno.test("buildBackfill: skips incomplete Stripe subs, internal workspaces, and counts unmapped", () => {
  const plan = buildBackfill({
    stripe: [
      stripeSub({ status: "incomplete_expired" }),
      stripeSub({ id: "sub_x", customer: "cus_unknown" }),
      stripeSub({ id: "sub_int", customer: "cus_int" }),
    ],
    pagarme: [pagarmeSub({ id: "orphan", metadata_workspace_id: null }), pagarmeSub({ metadata_workspace_id: "w3" })],
    local: local({ customerToWorkspace: new Map([["cus_1", "w1"], ["cus_int", "w-int"]]) }),
    internalIds: new Set(["w-int"]),
    todaySP: "2026-09-25",
  });
  assertEquals(plan.skipped, { stripe_unmapped: 1, pagarme_unmapped: 1, pagarme_divergent: 1 });
  assertEquals(plan.dates.flatMap((d) => d.rows).length, 0);
});
