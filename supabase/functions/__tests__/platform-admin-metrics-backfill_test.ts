import { assertEquals } from "./assert.ts";
import {
  type BackfillDeps,
  defaultBackfillDeps,
  handleBackfillMetrics,
  listPagarmeSubscriptions,
  PAGARME_MAX_PAGES,
  toPagarmeSubLite,
  toStripeSubLite,
} from "../platform-admin/metrics-backfill.ts";

const H = { "Content-Type": "application/json" };

function deps(over: Partial<BackfillDeps> = {}) {
  const calls: string[] = [];
  const d: BackfillDeps = {
    allowed: true,
    now: () => new Date("2026-09-25T12:00:00Z"),
    loadLocal: () => {
      calls.push("loadLocal");
      return Promise.resolve({
        customerToWorkspace: new Map([["cus_1", "w1"]]),
        pagarmeSubToWorkspace: new Map(),
        workspaceIds: new Set(["w1"]),
        plans: [{ id: "pro", name: "Pro", stripe_price_id: "price_m", stripe_price_id_annual: null, price_brl_annual: null }],
      });
    },
    loadInternalIds: () => {
      calls.push("loadInternalIds");
      return Promise.resolve(new Set());
    },
    listStripeSubs: () => {
      calls.push("stripe");
      return Promise.resolve([{
        id: "sub_1", customer: "cus_1", status: "active", start_date: Math.floor(Date.parse("2026-07-10T00:00:00Z") / 1000),
        trial_start: null, trial_end: null, ended_at: null, price_id: "price_m", amount_cents: 9900, interval: "month",
      }]);
    },
    listPagarmeSubs: () => {
      calls.push("pagarme");
      return Promise.resolve([]);
    },
    write: (date) => {
      calls.push(`write:${date}`);
      return Promise.resolve(date === "2026-08-31" ? { written: 0, skipped: true } : { written: 1, skipped: false });
    },
    ...over,
  };
  return { d, calls };
}

Deno.test("backfill-metrics refuses with 403 and touches nothing when not allowed", async () => {
  const { d, calls } = deps({ allowed: false });
  const res = await handleBackfillMetrics(H, d);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "backfill_not_allowed" });
  assertEquals(calls, []);
});

Deno.test("backfill-metrics writes each month and reports kept cron months", async () => {
  const { d, calls } = deps();
  const res = await handleBackfillMetrics(H, d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    months_written: 1,
    months_kept_cron: 1,
    rows_written: 1,
    skipped: { stripe_unmapped: 0, pagarme_unmapped: 0, pagarme_divergent: 0 },
  });
  assertEquals(calls.filter((c) => c.startsWith("write:")), ["write:2026-07-31", "write:2026-08-31"]);
});

Deno.test("backfill-metrics: a provider failure returns a generic 500 and writes nothing", async () => {
  const { d, calls } = deps({ listPagarmeSubs: () => Promise.reject(new Error("pagarme 401 {secret body}")) });
  const res = await handleBackfillMetrics(H, d);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "backfill_failed" });
  assertEquals(calls.some((c) => c.startsWith("write:")), false);
});

Deno.test("toStripeSubLite reads ids, timestamps and the coupon-net amount", () => {
  const lite = toStripeSubLite({
    id: "sub_1", customer: { id: "cus_1" }, status: "canceled", start_date: 100, trial_start: null, trial_end: null, ended_at: 200,
    items: { data: [{ quantity: 1, price: { id: "price_m", unit_amount: 10000, currency: "brl", recurring: { interval: "month" } } }] },
    discounts: [{ coupon: { id: "c", percent_off: 10 } }],
  });
  assertEquals(lite, {
    id: "sub_1", customer: "cus_1", status: "canceled", start_date: 100, trial_start: null, trial_end: null, ended_at: 200,
    price_id: "price_m", amount_cents: 9000, interval: "month",
  });
});

Deno.test("toPagarmeSubLite reads price, interval and metadata", () => {
  assertEquals(
    toPagarmeSubLite({
      id: "sub_pg", status: "future", created_at: "2026-09-01T00:00:00Z", start_at: "2026-09-26T00:00:00Z",
      canceled_at: null, interval: "year", items: [{ pricing_scheme: { price: 120000 } }],
      metadata: { workspace_id: "w1", plan_id: "max" },
    }),
    {
      id: "sub_pg", status: "future", created_at: "2026-09-01T00:00:00Z", start_at: "2026-09-26T00:00:00Z",
      canceled_at: null, interval: "year", price_cents: 120000, metadata_workspace_id: "w1", metadata_plan_id: "max",
    },
  );
});

const pgRaw = (id: string) => ({ id, status: "active", interval: "month", items: [{ pricing_scheme: { price: 9900 } }] });

Deno.test("listPagarmeSubscriptions keeps paging through short pages until an empty one", async () => {
  // A server-side clamp of `size` returns short but non-empty pages: they are not the end.
  const pages: unknown[][] = [[pgRaw("a"), pgRaw("b"), pgRaw("c")], [pgRaw("d"), pgRaw("e")], []];
  const asked: Array<[number, number]> = [];
  const subs = await listPagarmeSubscriptions((page, size) => {
    asked.push([page, size]);
    return Promise.resolve({ data: pages[page - 1] ?? [] });
  });
  assertEquals(subs.map((s) => s.id), ["a", "b", "c", "d", "e"]);
  assertEquals(asked.map(([page]) => page), [1, 2, 3]);
});

Deno.test("listPagarmeSubscriptions throws at the page cap instead of returning a partial list", async () => {
  let calls = 0;
  let threw = false;
  try {
    await listPagarmeSubscriptions(() => {
      calls++;
      return Promise.resolve({ data: [pgRaw(`s${calls}`)] });
    });
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "pagarme subscriptions list exceeded the page cap");
  }
  assertEquals(threw, true);
  assertEquals(calls, PAGARME_MAX_PAGES);
});

Deno.test("defaultBackfillDeps: the 403 guard runs before any client or network call", async () => {
  const prevAllowed = Deno.env.get("METRICS_BACKFILL_ALLOWED");
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched++;
    return Promise.reject(new Error("no network in this test"));
  }) as typeof fetch;
  try {
    Deno.env.delete("METRICS_BACKFILL_ALLOWED");
    const res = await handleBackfillMetrics(H, defaultBackfillDeps());
    assertEquals(res.status, 403);
    assertEquals(fetched, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (prevAllowed !== undefined) Deno.env.set("METRICS_BACKFILL_ALLOWED", prevAllowed);
  }
});
