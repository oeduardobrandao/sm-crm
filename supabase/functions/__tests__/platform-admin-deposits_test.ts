import { assertEquals } from "./assert.ts";
import {
  buildDepositsResponse,
  handleGetDeposits,
  listPendingTransactions,
  listInFlightTransfers,
  listWaitingPayables,
  nextCursor,
  type DepositsGateways,
  type StripeDepositsClient,
} from "../platform-admin/deposits.ts";
import { businessToday, type PagarmeRaw, type StripeRaw } from "../platform-admin/deposits-logic.ts";

const TODAY = "2026-09-24";
const ts = (day: string) => Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);

const STRIPE_RAW: StripeRaw = {
  balance: { available: [{ amount: 100, currency: "brl" }], pending: [{ amount: 9700, currency: "brl" }] },
  payouts: [],
  pendingTransactions: [
    { id: "txn_fixture", net: 9700, amount: 10000, fee: 300, available_on: ts("2026-09-29"), status: "pending", currency: "brl", type: "charge" },
  ],
  schedule: { interval: "daily", delay_days: 30 },
  truncated: false,
};

const PAGARME_RAW: PagarmeRaw = {
  balance: { available_amount: 0, waiting_funds_amount: 2935 },
  payables: [{ id: 1, status: "waiting_funds", amount: 3090, fee: 155, anticipation_fee: 0, payment_date: "2026-09-25T03:00:00Z" }],
  recipient: { transfer_settings: { transfer_enabled: true, transfer_interval: "daily", transfer_day: null } },
  transfers: [],
  truncated: false,
};

function gateways(over: Partial<DepositsGateways> = {}): DepositsGateways {
  return {
    stripe: { fetchRaw: () => Promise.resolve(STRIPE_RAW) },
    pagarme: { fetchRaw: (_id) => Promise.resolve(PAGARME_RAW) },
    recipientId: "re_test",
    pagarmeSecretPresent: true,
    today: TODAY,
    ...over,
  };
}

Deno.test("buildDepositsResponse: both providers ok, summary picks the earliest deposit, currency is brl", async () => {
  const out = await buildDepositsResponse(gateways());
  assertEquals(out.currency, "brl");
  assertEquals(out.stripe.ok, true);
  assertEquals(out.pagarme.ok, true);
  assertEquals(out.summary, {
    next: { date: "2026-09-25", amount_cents: 2935, provider: "pagarme" },
    next_30d_cents: 9700 + 2935,
    waiting_cents: 9700 + 2935,
    partial: false,
  });
  assertEquals(typeof out.generated_at, "string");
});

Deno.test("buildDepositsResponse: one provider throwing yields ok:false for it only, marks partial, and never leaks the error", async () => {
  const out = await buildDepositsResponse(
    gateways({ stripe: { fetchRaw: () => Promise.reject(new Error("secret sk_live_123 leaked")) } }),
  );
  assertEquals(out.stripe, {
    configured: true,
    ok: false,
    truncated: false,
    balance: null,
    meta: {},
    upcoming: { next30: [], byMonth: [] },
    in_transit: [],
    recent: [],
    error: "unavailable",
  });
  assertEquals(out.pagarme.ok, true);
  assertEquals(JSON.stringify(out).includes("sk_live"), false);
  assertEquals(out.summary.next?.provider, "pagarme");
  assertEquals(out.summary.partial, true);
});

Deno.test("buildDepositsResponse: recipient id set but PAGARME_SECRET_KEY absent → configured:false, gateway not called", async () => {
  let called = 0;
  const out = await buildDepositsResponse(
    gateways({
      pagarmeSecretPresent: false,
      pagarme: {
        fetchRaw: () => {
          called += 1;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(out.pagarme.configured, false);
  assertEquals(called, 0);
  assertEquals(out.summary.partial, false);
});

Deno.test("buildDepositsResponse: no Stripe gateway → configured:false; no recipient id → Pagar.me configured:false and gateway not called", async () => {
  let called = 0;
  const out = await buildDepositsResponse(
    gateways({
      stripe: null,
      recipientId: null,
      pagarme: {
        fetchRaw: () => {
          called += 1;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(out.stripe.configured, false);
  assertEquals(out.pagarme.configured, false);
  assertEquals(called, 0);
  assertEquals(out.summary, { next: null, next_30d_cents: 0, waiting_cents: 0, partial: false });
});

Deno.test("buildDepositsResponse: the recipient id is passed to the Pagar.me gateway", async () => {
  let seen: string | null = null;
  await buildDepositsResponse(
    gateways({
      pagarme: {
        fetchRaw: (id) => {
          seen = id;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(seen, "re_test");
});

Deno.test("handleGetDeposits: 200 JSON with the response body", async () => {
  const res = await handleGetDeposits({ "Content-Type": "application/json" }, gateways());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.stripe.ok, true);
  assertEquals(body.pagarme.ok, true);
  assertEquals(body.summary.next.provider, "pagarme");
});

Deno.test("buildDepositsResponse: today omitted falls back to businessToday(), so a Pagar.me payable due today (BRT) isn't dropped as overdue", async () => {
  const todayBRT = businessToday();
  const payload: PagarmeRaw = {
    ...PAGARME_RAW,
    payables: [
      { id: 99, status: "waiting_funds", amount: 5000, fee: 0, anticipation_fee: 0, payment_date: `${todayBRT}T03:00:00Z` },
    ],
  };
  const out = await buildDepositsResponse(
    gateways({
      stripe: null,
      today: undefined,
      pagarme: { fetchRaw: () => Promise.resolve(payload) },
    }),
  );
  const found = out.pagarme.upcoming.next30.some((r) => r.date === todayBRT);
  assertEquals(found, true);
});

// ─── nextCursor ─────────────────────────────────────────────────────────────

Deno.test("nextCursor: null/undefined paging → null", () => {
  assertEquals(nextCursor(null), null);
  assertEquals(nextCursor(undefined), null);
});

Deno.test("nextCursor: bare paging.next", () => {
  assertEquals(nextCursor({ next: "abc" }), "abc");
});

Deno.test("nextCursor: paging.cursors.next", () => {
  assertEquals(nextCursor({ cursors: { next: "xyz" } }), "xyz");
});

Deno.test("nextCursor: full URL with forward_cursor param extracts the param", () => {
  assertEquals(
    nextCursor({ next: "https://api.pagar.me/core/v5/payables?forward_cursor=c123&size=100" }),
    "c123",
  );
});

Deno.test("nextCursor: full URL without forward_cursor param → null", () => {
  assertEquals(nextCursor({ next: "https://api.pagar.me/core/v5/payables?size=100" }), null);
});

// ─── listPendingTransactions ────────────────────────────────────────────────

const NOW_SEC = 1758700800; // fixed epoch so filter params are deterministic

function stripeTxn(over: Partial<StripeRaw["pendingTransactions"][number]> = {}) {
  return {
    id: "txn_default",
    net: 100,
    amount: 100,
    fee: 0,
    available_on: NOW_SEC,
    status: "pending",
    currency: "brl",
    type: "charge",
    ...over,
  };
}

Deno.test("listPendingTransactions: happy path filters to pending rows and uses the start-of-day available_on filter", async () => {
  const calls: Record<string, unknown>[] = [];
  // Deliberately not a midnight value, so the test actually proves the day-start rounding
  // (2026-09-25T13:00:00Z) rather than passing by coincidence.
  const nowSec = 1790341200;
  const pendingRow = stripeTxn({ id: "txn_1", status: "pending" });
  const availableRow = stripeTxn({ id: "txn_2", status: "available" });
  const stripe = {
    balanceTransactions: {
      list: (params: Record<string, unknown>) => {
        calls.push(params);
        return Promise.resolve({ data: [pendingRow, availableRow], has_more: false });
      },
    },
  } as unknown as StripeDepositsClient;

  const { rows, truncated } = await listPendingTransactions(stripe, nowSec);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].id, "txn_1");
  assertEquals(truncated, false);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].available_on, { gte: nowSec - (nowSec % 86400) });
  const gte = (calls[0].available_on as { gte: number }).gte;
  assertEquals(gte % 86400, 0);
  assertEquals(gte <= nowSec, true);
  assertEquals(calls[0].limit, 100);
});

Deno.test("listPendingTransactions: a 400 on the first attempt falls back to the created filter", async () => {
  const calls: Record<string, unknown>[] = [];
  let attempt = 0;
  const stripe = {
    balanceTransactions: {
      list: (params: Record<string, unknown>) => {
        calls.push(params);
        if (attempt++ === 0) {
          return Promise.reject({ statusCode: 400 });
        }
        return Promise.resolve({ data: [stripeTxn({ id: "txn_fallback" })], has_more: false });
      },
    },
  } as unknown as StripeDepositsClient;

  const { rows } = await listPendingTransactions(stripe, NOW_SEC);
  assertEquals(calls.length, 2);
  assertEquals(calls[1].created, { gte: NOW_SEC - 40 * 24 * 3600 });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].id, "txn_fallback");
});

Deno.test("listPendingTransactions: a non-400 error rethrows without falling back", async () => {
  let calls = 0;
  const stripe = {
    balanceTransactions: {
      list: () => {
        calls++;
        return Promise.reject({ statusCode: 500, message: "boom" });
      },
    },
  } as unknown as StripeDepositsClient;

  let threw = false;
  try {
    await listPendingTransactions(stripe, NOW_SEC);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  assertEquals(calls, 1);
});

Deno.test("listPendingTransactions: hits the page cap, marks truncated, and chains starting_after", async () => {
  const calls: Record<string, unknown>[] = [];
  let callCount = 0;
  const stripe = {
    balanceTransactions: {
      list: (params: Record<string, unknown>) => {
        calls.push(params);
        const page = callCount++;
        const data = Array.from({ length: 100 }, (_, i) => stripeTxn({ id: `txn_p${page}_${i}` }));
        return Promise.resolve({ data, has_more: true });
      },
    },
  } as unknown as StripeDepositsClient;

  const { truncated } = await listPendingTransactions(stripe, NOW_SEC);
  assertEquals(truncated, true);
  assertEquals(calls.length, 5);
  for (let i = 1; i < 5; i++) {
    assertEquals(calls[i].starting_after, `txn_p${i - 1}_99`);
  }
});

Deno.test("listPendingTransactions: has_more false on the 2nd page stops before the cap, not truncated", async () => {
  const calls: Record<string, unknown>[] = [];
  let callCount = 0;
  const stripe = {
    balanceTransactions: {
      list: (params: Record<string, unknown>) => {
        calls.push(params);
        const page = callCount++;
        const data = [stripeTxn({ id: `txn_p${page}_0` })];
        return Promise.resolve({ data, has_more: page === 0 });
      },
    },
  } as unknown as StripeDepositsClient;

  const { truncated } = await listPendingTransactions(stripe, NOW_SEC);
  assertEquals(truncated, false);
  assertEquals(calls.length, 2);
});

// ─── listWaitingPayables ─────────────────────────────────────────────────────

function pagarmePayable(over: Partial<PagarmeRaw["payables"][number]> = {}) {
  return {
    id: 1,
    status: "waiting_funds",
    amount: 100,
    fee: 1,
    anticipation_fee: 0,
    payment_date: "2026-09-25T00:00:00Z",
    ...over,
  };
}

Deno.test("listWaitingPayables: paginates via the injected fetchPage until there is no next cursor", async () => {
  const paths: string[] = [];
  const p1 = pagarmePayable({ id: 1 });
  const p2 = pagarmePayable({ id: 2 });
  const fetchPage = (path: string) => {
    paths.push(path);
    if (!path.includes("forward_cursor")) {
      return Promise.resolve({ data: [p1], paging: { next: "c2" } });
    }
    return Promise.resolve({ data: [p2], paging: {} });
  };

  const { rows, truncated } = await listWaitingPayables("re_test", fetchPage);
  assertEquals(rows, [p1, p2]);
  assertEquals(truncated, false);
  assertEquals(paths.length, 2);
  assertEquals(paths[0].includes("recipient_id=re_test"), true);
  assertEquals(paths[0].includes("status=waiting_funds"), true);
  assertEquals(paths[0].includes("size=100"), true);
  assertEquals(paths[1].includes("forward_cursor=c2"), true);
});

Deno.test("listWaitingPayables: an empty first page stops immediately", async () => {
  let calls = 0;
  const fetchPage = () => {
    calls++;
    return Promise.resolve({ data: [], paging: { next: "c2" } });
  };

  const { rows, truncated } = await listWaitingPayables("re_test", fetchPage);
  assertEquals(rows, []);
  assertEquals(truncated, false);
  assertEquals(calls, 1);
});

Deno.test("listWaitingPayables: hits the page cap when every page has more, marking truncated", async () => {
  let calls = 0;
  const fetchPage = () => {
    calls++;
    const data = Array.from({ length: 100 }, (_, i) => pagarmePayable({ id: calls * 1000 + i }));
    return Promise.resolve({ data, paging: { next: `c${calls}` } });
  };

  const { truncated } = await listWaitingPayables("re_test", fetchPage);
  assertEquals(truncated, true);
  assertEquals(calls, 5);
});

Deno.test("listWaitingPayables: a FULL page whose paging.next carries no extractable forward_cursor is truncated, not silently ended", async () => {
  const data = Array.from({ length: 100 }, (_, i) => pagarmePayable({ id: i }));
  const fetchPage = () =>
    Promise.resolve({ data, paging: { next: "https://api.pagar.me/core/v5/payables?page=2" } });

  const { rows, truncated } = await listWaitingPayables("re_test", fetchPage);
  assertEquals(truncated, true);
  assertEquals(rows.length, 100);
});

Deno.test("listWaitingPayables: a SHORT page with the same unextractable paging.next is just the last page, not truncated", async () => {
  const data = [pagarmePayable({ id: 1 }), pagarmePayable({ id: 2 })];
  const fetchPage = () =>
    Promise.resolve({ data, paging: { next: "https://api.pagar.me/core/v5/payables?page=2" } });

  const { rows, truncated } = await listWaitingPayables("re_test", fetchPage);
  assertEquals(truncated, false);
  assertEquals(rows.length, 2);
});

// ─── listInFlightTransfers ───────────────────────────────────────────────────

function pagarmeTransfer(over: Partial<PagarmeRaw["transfers"][number]> = {}) {
  return { id: "tr_1", amount: 100, status: "transferred", funding_estimated_date: null, ...over };
}

Deno.test("listInFlightTransfers: sends only recipient_id + size and follows the cursor, so an old in-flight transfer on page 2 is still returned", async () => {
  const paths: string[] = [];
  const recent = pagarmeTransfer({ id: "tr_new", status: "transferred" });
  const oldPending = pagarmeTransfer({ id: "tr_old", status: "pending_transfer" });
  const fetchPage = (path: string) => {
    paths.push(path);
    if (!path.includes("forward_cursor")) {
      return Promise.resolve({ data: [recent], paging: { next: "c2" } });
    }
    return Promise.resolve({ data: [oldPending], paging: {} });
  };

  const { rows, truncated } = await listInFlightTransfers("re_test", fetchPage);
  assertEquals(rows, [recent, oldPending]);
  assertEquals(truncated, false);
  assertEquals(paths[0].startsWith("/transfers?"), true);
  assertEquals(paths[0].includes("recipient_id=re_test"), true);
  assertEquals(paths[0].includes("size=100"), true);
  assertEquals(paths[0].includes("status="), false);
  assertEquals(paths[1].includes("forward_cursor=c2"), true);
});

Deno.test("listInFlightTransfers: hits the page cap, marking truncated", async () => {
  let calls = 0;
  const fetchPage = () => {
    calls++;
    const data = Array.from({ length: 100 }, (_, i) => pagarmeTransfer({ id: `tr_${calls}_${i}` }));
    return Promise.resolve({ data, paging: { next: `c${calls}` } });
  };

  const { truncated } = await listInFlightTransfers("re_test", fetchPage);
  assertEquals(truncated, true);
  assertEquals(calls, 5);
});
