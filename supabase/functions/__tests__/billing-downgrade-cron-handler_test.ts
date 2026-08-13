// Handler tests for billing-downgrade-cron. Fake-db pattern mirrors the house style
// established by pagarme-checkout-handler_test.ts / pagarme-webhook-handler_test.ts: a
// thenable chain that records {table, op, filters, values} per call, in call order, plus an
// rpc recorder for grant_pagarme_plan. A separate gateway-call recorder (list order and
// cancel order visible via the same array) verifies leg C's fetch-then-cancel discipline.

import { assert, assertEquals } from "./assert.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import { runBillingDowngradeCron, type CronResult, type DowngradeCronDeps } from "../billing-downgrade-cron/handler.ts";
import type { DowngradeCronGateway, RemoteSubListItem } from "../billing-downgrade-cron/gateway.ts";

const NOW = new Date("2026-08-13T13:00:00Z");
// Well past SWEEP_MIN_AGE_MS (1h) relative to NOW -- never "young".
const OLD_ISO = "2026-08-01T00:00:00Z";
// Inside SWEEP_MIN_AGE_MS relative to NOW -- always "young".
const YOUNG_ISO = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();

type Ev = {
  op: string;
  table: string;
  values?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
  sawNot: boolean;
  sawIn: boolean;
  abortSignal: boolean;
  seq: number;
};

interface DbFx {
  // Leg A: due-rows read (workspace_subscriptions, no `.not`/`.in`) and the flag-flip update.
  dueRows?: Array<{ workspace_id: string; pagarme_subscription_id: string | null }>;
  dueReadError?: { message: string } | null;
  defaultPlan?: { id: string } | null;
  defaultPlanError?: { message: string } | null;
  rpc?: (
    params: Record<string, unknown>,
  ) => { data: number | null; error: { message: string } | null };
  flip?: (
    filters: Array<[string, string, unknown]>,
  ) => { data: unknown; error: { message: string } | null };
  // Leg B: stale-attempts read (pagarme_checkout_attempts, no `.not`), the bound-subscription
  // guard's `.in()` read on workspace_subscriptions, the succeeded-CAS, and the expiry update.
  staleRows?: Array<{ id: string; workspace_id: string; pagarme_subscription_id: string | null }>;
  staleReadError?: { message: string } | null;
  legBLinkedRows?: Array<{ pagarme_subscription_id: string | null }>;
  legBLinkedReadError?: { message: string } | null;
  reconcile?: (
    filters: Array<[string, string, unknown]>,
  ) => { data: unknown; error: { message: string } | null };
  expire?: (
    filters: Array<[string, string, unknown]>,
  ) => { data: unknown; error: { message: string } | null };
  // Leg C: local link-set reads (both use `.not`, count:"exact"). `linkedCount`/`pendingCount`
  // default to the fixture rows' own length (no truncation); set higher to simulate PostgREST
  // silently truncating an unbounded select at db-max-rows.
  linkedRows?: Array<{ pagarme_subscription_id: string | null }>;
  linkedReadError?: { message: string } | null;
  linkedCount?: number;
  pendingRows?: Array<{ pagarme_subscription_id: string | null }>;
  pendingReadError?: { message: string } | null;
  pendingCount?: number;
}

/**
 * Thenable chain stub (house pattern from pagarme-webhook-handler_test.ts). Every operation is
 * appended to `events` in call order, with its eq/is/not/in filters and whether `.not`/`.in`
 * was used -- the only way to tell apart the THREE distinct read shapes that land on
 * `workspace_subscriptions`: leg A's due-read (plain), leg B's bound-subscription-guard read
 * (`.in`), and leg C's linked-set read (`.not`) -- so tests can assert sequencing, CAS pins,
 * and which query fixture to serve.
 */
function makeDb(fx: DbFx & { events: Ev[] }, seq: { n: number }) {
  const from = (table: string) => {
    let op = "read";
    let values: Record<string, unknown> | undefined;
    let sawAbortSignal = false;
    let sawNot = false;
    let sawIn = false;
    let sawLte = false;
    const filters: Array<[string, string, unknown]> = [];
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    chain.select = () => chain;
    chain.abortSignal = () => {
      sawAbortSignal = true;
      return chain;
    };
    chain.eq = (col: string, val: unknown) => {
      filters.push(["eq", col, val]);
      return chain;
    };
    chain.is = (col: string, val: unknown) => {
      filters.push(["is", col, val]);
      return chain;
    };
    chain.not = (col: string, _op2: string, val: unknown) => {
      sawNot = true;
      filters.push(["not", col, val]);
      return chain;
    };
    chain.in = (col: string, vals: unknown) => {
      sawIn = true;
      filters.push(["in", col, vals]);
      return chain;
    };
    chain.lte = (col: string, val: unknown) => {
      sawLte = true;
      filters.push(["lte", col, val]);
      return chain;
    };
    chain.lt = (col: string, val: unknown) => {
      filters.push(["lt", col, val]);
      return chain;
    };
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.update = (v: Record<string, unknown>) => {
      op = "update";
      values = v;
      return chain;
    };
    const settle = () => {
      fx.events.push({
        table,
        op,
        values,
        filters,
        sawNot,
        sawIn,
        abortSignal: sawAbortSignal,
        seq: seq.n++,
      });
      if (table === "workspace_subscriptions" && op === "read") {
        // Leg A's due-read now ALSO carries `.not()` (finding #3), so `.lte` (only leg A
        // uses it, to bound current_period_end) must be checked FIRST to tell it apart from
        // leg C's linked-set read (`.not`, no `.lte`).
        if (sawLte) {
          return { data: fx.dueRows ?? [], error: fx.dueReadError ?? null };
        }
        if (sawIn) {
          return {
            data: fx.legBLinkedRows ?? [],
            error: fx.legBLinkedReadError ?? null,
          };
        }
        const data = fx.linkedRows ?? [];
        const count = fx.linkedCount !== undefined ? fx.linkedCount : data.length;
        return { data, error: fx.linkedReadError ?? null, count };
      }
      if (table === "workspace_subscriptions" && op === "update") {
        return fx.flip ? fx.flip(filters) : { data: [{ workspace_id: "ws" }], error: null };
      }
      if (table === "pagarme_checkout_attempts" && op === "read") {
        if (sawNot) {
          const data = fx.pendingRows ?? [];
          const count = fx.pendingCount !== undefined ? fx.pendingCount : data.length;
          return { data, error: fx.pendingReadError ?? null, count };
        }
        return { data: fx.staleRows ?? [], error: fx.staleReadError ?? null };
      }
      if (table === "pagarme_checkout_attempts" && op === "update") {
        if (values?.state === "succeeded") {
          return fx.reconcile ? fx.reconcile(filters) : { data: [{ id: "at" }], error: null };
        }
        return fx.expire ? fx.expire(filters) : { data: [{ id: "at" }], error: null };
      }
      if (table === "plans") {
        return {
          data: fx.defaultPlan === undefined ? { id: "free" } : fx.defaultPlan,
          error: fx.defaultPlanError ?? null,
        };
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
  const rpc = (fn: string, params: Record<string, unknown>) => {
    let sawAbortSignal = false;
    // deno-lint-ignore no-explicit-any
    const rchain: any = {};
    rchain.abortSignal = () => {
      sawAbortSignal = true;
      return rchain;
    };
    const rsettle = () => {
      fx.events.push({
        table: `rpc:${fn}`,
        op: "rpc",
        values: params,
        filters: [],
        sawNot: false,
        sawIn: false,
        abortSignal: sawAbortSignal,
        seq: seq.n++,
      });
      return fx.rpc ? fx.rpc(params) : { data: 1, error: null };
    };
    rchain.then = (
      onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(rsettle()).then(onFulfilled, onRejected);
    return rchain;
  };
  return { from, rpc };
}

type GwCall = { method: string; args: unknown[] };

function makeGateway(
  impl: {
    listSubscriptions?: (
      status: "active" | "future",
      page: number,
      size: number,
    ) => { data: RemoteSubListItem[]; paging?: { total_pages?: number } };
    /** Called for every cancelSubscription; throw to simulate a gateway failure. */
    cancelSubscription?: (subId: string) => void;
  },
  calls: GwCall[],
): DowngradeCronGateway {
  return {
    listSubscriptions: async (status, page, size) => {
      calls.push({ method: "listSubscriptions", args: [status, page, size] });
      return impl.listSubscriptions ? impl.listSubscriptions(status, page, size) : { data: [] };
    },
    cancelSubscription: async (subId) => {
      calls.push({ method: "cancelSubscription", args: [subId] });
      if (impl.cancelSubscription) impl.cancelSubscription(subId);
      return null;
    },
  };
}

async function run(
  dbFx: DbFx,
  gwImpl: Parameters<typeof makeGateway>[0] | null,
  now: Date = NOW,
): Promise<{ result: CronResult; events: Ev[]; gwCalls: GwCall[] }> {
  const events: Ev[] = [];
  const gwCalls: GwCall[] = [];
  const seq = { n: 0 };
  const deps: DowngradeCronDeps = {
    db: makeDb({ ...dbFx, events }, seq) as unknown as SupabaseClient,
    gateway: gwImpl === null ? null : makeGateway(gwImpl, gwCalls),
    now: () => now,
  };
  const result = await runBillingDowngradeCron(deps);
  return { result, events, gwCalls };
}

function filterHas(
  filters: Array<[string, string, unknown]>,
  method: "eq" | "is" | "not" | "lte" | "lt",
  col: string,
  val: unknown,
) {
  return filters.some(([m, c, v]) => m === method && c === col && v === val);
}

function findEvents(events: Ev[], table: string, op: string): Ev[] {
  return events.filter((e) => e.table === table && e.op === op);
}

/** Leg A's due-rows read: the only workspace_subscriptions read carrying `.lte`. */
function findDueRead(events: Ev[]): Ev | undefined {
  return events.find(
    (e) =>
      e.table === "workspace_subscriptions" && e.op === "read" &&
      e.filters.some(([m]) => m === "lte"),
  );
}

// ─── Leg A: paid-through downgrade ─────────────────────────────────────────

Deno.test("1. leg A: two due rows -> default plan resolved once, rpc per row, CAS'd flip, downgraded:2", async () => {
  const { result, events } = await run({
    dueRows: [
      { workspace_id: "ws-1", pagarme_subscription_id: "sub-1" },
      { workspace_id: "ws-2", pagarme_subscription_id: "sub-2" },
    ],
    defaultPlan: { id: "free" },
  }, { listSubscriptions: () => ({ data: [] }) });

  assertEquals(result.downgraded, 2);
  assertEquals(result.errors, []);

  const dueRead = findDueRead(events);
  assert(dueRead, "expected leg A's due-rows read");
  assert(
    filterHas(dueRead!.filters, "not", "pagarme_subscription_id", null),
    "due-rows read must exclude null sub ids (a null-sub-id row would warn-loop forever)",
  );

  const planReads = findEvents(events, "plans", "read");
  assertEquals(planReads.length, 1, "default plan must be resolved exactly once, before the loop");

  const rpcCalls = events.filter((e) => e.table === "rpc:grant_pagarme_plan");
  assertEquals(rpcCalls.length, 2);
  assertEquals(rpcCalls[0].values, {
    p_workspace: "ws-1",
    p_plan: "free",
    p_sub: "sub-1",
    p_status: "canceled",
  });
  assert(rpcCalls[0].abortSignal, "rpc call must be bounded");

  const flips = findEvents(events, "workspace_subscriptions", "update");
  assertEquals(flips.length, 2);
  for (const flip of flips) {
    assert(flip.abortSignal, "flip update must be bounded");
    assertEquals(flip.values?.cancel_at_period_end, false);
    assert(filterHas(flip.filters, "eq", "provider", "pagarme"));
    assert(filterHas(flip.filters, "eq", "status", "canceled"));
    assert(filterHas(flip.filters, "eq", "cancel_at_period_end", true));
  }
  assert(filterHas(flips[0].filters, "eq", "workspace_id", "ws-1"));
  assert(filterHas(flips[0].filters, "eq", "pagarme_subscription_id", "sub-1"));
});

Deno.test("2. leg A: rpc written:0 -> not counted, flip STILL attempted, no error", async () => {
  const { result, events } = await run({
    dueRows: [{ workspace_id: "ws-1", pagarme_subscription_id: "sub-1" }],
    rpc: () => ({ data: 0, error: null }),
  }, { listSubscriptions: () => ({ data: [] }) });

  assertEquals(result.downgraded, 0);
  assertEquals(result.errors, []);
  assertEquals(findEvents(events, "workspace_subscriptions", "update").length, 1);
});

Deno.test("3. leg A: rpc error on row 1 -> error collected, row 2 still processed", async () => {
  const { result, events } = await run({
    dueRows: [
      { workspace_id: "ws-1", pagarme_subscription_id: "sub-1" },
      { workspace_id: "ws-2", pagarme_subscription_id: "sub-2" },
    ],
    rpc: (params) =>
      params.p_workspace === "ws-1"
        ? { data: null, error: { message: "grant boom" } }
        : { data: 1, error: null },
  }, { listSubscriptions: () => ({ data: [] }) });

  assertEquals(result.downgraded, 1);
  assertEquals(result.errors.length, 1);
  assert(result.errors[0].includes("ws-1"));

  // No flip for the row whose grant errored; only row 2 flips.
  const flips = findEvents(events, "workspace_subscriptions", "update");
  assertEquals(flips.length, 1);
  assert(filterHas(flips[0].filters, "eq", "workspace_id", "ws-2"));
});

Deno.test("4. leg A: flip zero rows -> error-free continue", async () => {
  const { result } = await run({
    dueRows: [{ workspace_id: "ws-1", pagarme_subscription_id: "sub-1" }],
    flip: () => ({ data: [], error: null }),
  }, { listSubscriptions: () => ({ data: [] }) });

  assertEquals(result.downgraded, 1);
  assertEquals(result.errors, []);
});

// ─── Leg B: stale checkout attempts ────────────────────────────────────────

Deno.test("5. leg B: sub-id attempt -> gateway DELETE then expiry CAS; no-sub-id attempt -> expiry only", async () => {
  const { result, events, gwCalls } = await run({
    staleRows: [
      { id: "at-1", workspace_id: "ws-1", pagarme_subscription_id: "sub-1" },
      { id: "at-2", workspace_id: "ws-2", pagarme_subscription_id: null },
    ],
  }, { listSubscriptions: () => ({ data: [] }) });

  assertEquals(result.attemptsExpired, 2);
  assertEquals(result.errors, []);
  assertEquals(gwCalls.filter((c) => c.method === "cancelSubscription"), [
    { method: "cancelSubscription", args: ["sub-1"] },
  ]);

  const expires = findEvents(events, "pagarme_checkout_attempts", "update");
  assertEquals(expires.length, 2);
  for (const e of expires) {
    assertEquals(e.values?.state, "expired");
    assert(filterHas(e.filters, "eq", "state", "pending"), "expiry must be CAS-pinned on state=pending");
  }
  assert(filterHas(expires[0].filters, "eq", "id", "at-1"));
  assert(filterHas(expires[1].filters, "eq", "id", "at-2"));
});

Deno.test("6. leg B: non-definitive cancel failure (500) -> NO expiry, error collected", async () => {
  const { result, events } = await run({
    staleRows: [{ id: "at-1", workspace_id: "ws-1", pagarme_subscription_id: "sub-1" }],
  }, {
    listSubscriptions: () => ({ data: [] }),
    cancelSubscription: () => {
      throw new PagarmeApiError(500, {});
    },
  });

  assertEquals(result.attemptsExpired, 0);
  assertEquals(result.errors.length, 1);
  assertEquals(findEvents(events, "pagarme_checkout_attempts", "update").length, 0);
});

Deno.test("7. leg B: definitive 404 -> expiry proceeds", async () => {
  const { result } = await run({
    staleRows: [{ id: "at-1", workspace_id: "ws-1", pagarme_subscription_id: "sub-1" }],
  }, {
    listSubscriptions: () => ({ data: [] }),
    cancelSubscription: () => {
      throw new PagarmeApiError(404, {});
    },
  });

  assertEquals(result.attemptsExpired, 1);
  assertEquals(result.errors, []);
});

Deno.test("8. gateway: null -> leg B expires only no-sub-id attempts, leg C skipped, remoteSkipped:true, leg A still runs", async () => {
  const { result, events } = await run({
    dueRows: [{ workspace_id: "ws-1", pagarme_subscription_id: "sub-1" }],
    staleRows: [
      { id: "at-1", workspace_id: "ws-1", pagarme_subscription_id: "sub-1" },
      { id: "at-2", workspace_id: "ws-2", pagarme_subscription_id: null },
    ],
  }, null);

  assertEquals(result.downgraded, 1, "leg A must still run with a null gateway");
  assertEquals(result.attemptsExpired, 1, "only the no-sub-id attempt expires");
  assertEquals(result.remoteSkipped, true);
  assertEquals(result.orphansCanceled, 0);
  assertEquals(result.orphansUnrecognized, 0);
  assertEquals(result.sweepTruncated, false);

  // Leg C never even reads its local link sets. (Leg A's own due-read also carries `.not()`
  // now -- finding #3 -- so a leg-C read is `.not()` WITHOUT the `.lte()` that only leg A's
  // due-read carries.)
  const legCReads = events.filter((e) => e.sawNot && !e.filters.some(([m]) => m === "lte"));
  assertEquals(legCReads.length, 0, "leg C must not run at all when the gateway is null");
});

Deno.test("13. leg B: pending attempt whose sub id IS linked -> reconciled to succeeded, no gateway call", async () => {
  const { result, events, gwCalls } = await run({
    staleRows: [
      { id: "at-1", workspace_id: "ws-1", pagarme_subscription_id: "sub-1" },
      { id: "at-2", workspace_id: "ws-2", pagarme_subscription_id: null },
    ],
    legBLinkedRows: [{ pagarme_subscription_id: "sub-1" }],
  }, { listSubscriptions: () => ({ data: [] }) });

  assertEquals(result.attemptsReconciled, 1);
  assertEquals(result.attemptsExpired, 1, "the unrelated no-sub-id attempt still expires normally");
  assertEquals(result.errors, []);
  assertEquals(
    gwCalls.filter((c) => c.method === "cancelSubscription").length,
    0,
    "a linked (bound, paid) subscription must never be canceled",
  );

  const reconciled = events.find(
    (e) =>
      e.table === "pagarme_checkout_attempts" && e.op === "update" &&
      e.values?.state === "succeeded",
  );
  assert(reconciled, "expected a succeeded-state CAS update for the linked attempt");
  assert(filterHas(reconciled!.filters, "eq", "id", "at-1"));
  assert(filterHas(reconciled!.filters, "eq", "state", "pending"), "reconcile must be CAS-pinned on state=pending");
  assert(reconciled!.abortSignal, "reconcile update must be bounded");

  const inRead = events.find((e) => e.sawIn);
  assert(inRead, "expected the bound-subscription-guard read");
  const inFilter = inRead!.filters.find(([m, c]) => m === "in" && c === "pagarme_subscription_id");
  assert(inFilter, "expected an .in() filter on pagarme_subscription_id");
  assertEquals(inFilter![2], ["sub-1"]);
  assert(inRead!.abortSignal, "bound-subscription-guard read must be bounded");
});

Deno.test("14. leg B: bound-subscription-guard read error -> leg B aborts, zero cancels/expiries, legs A/C unaffected", async () => {
  const { result, gwCalls } = await run({
    dueRows: [{ workspace_id: "ws-x", pagarme_subscription_id: "sub-x" }],
    staleRows: [{ id: "at-1", workspace_id: "ws-1", pagarme_subscription_id: "sub-1" }],
    legBLinkedReadError: { message: "db down" },
  }, { listSubscriptions: () => ({ data: [] }) });

  assertEquals(result.downgraded, 1, "leg A must still run after leg B's crash");
  assertEquals(result.attemptsExpired, 0);
  assertEquals(result.attemptsReconciled, 0);
  assertEquals(result.remoteSkipped, false, "leg C must still run after leg B's crash");
  assertEquals(result.errors.length, 1);
  assert(result.errors[0].includes("leg B linked read failed") || result.errors[0].includes("leg B failed"));
  assertEquals(
    gwCalls.filter((c) => c.method === "cancelSubscription").length,
    0,
    "never cancel without the linked picture",
  );
});

// ─── Leg C: remote orphan sweep ────────────────────────────────────────────

Deno.test("9. leg C: linked/pending/young/unrecognized skipped, true orphan canceled", async () => {
  const linkedSub: RemoteSubListItem = { id: "sub-linked", created_at: OLD_ISO, metadata: { workspace_id: "ws-a" } };
  const pendingSub: RemoteSubListItem = { id: "sub-pending", created_at: OLD_ISO, metadata: { workspace_id: "ws-b" } };
  const youngSub: RemoteSubListItem = { id: "sub-young", created_at: YOUNG_ISO, metadata: { workspace_id: "ws-c" } };
  const noMetaSub: RemoteSubListItem = { id: "sub-nometa", created_at: OLD_ISO, metadata: null };
  const orphanSub: RemoteSubListItem = { id: "sub-orphan", created_at: OLD_ISO, metadata: { workspace_id: "ws-d" } };

  const { result, gwCalls } = await run({
    linkedRows: [{ pagarme_subscription_id: "sub-linked" }],
    pendingRows: [{ pagarme_subscription_id: "sub-pending" }],
  }, {
    listSubscriptions: (status) =>
      status === "active"
        ? { data: [linkedSub, pendingSub, youngSub, noMetaSub, orphanSub] }
        : { data: [] },
  });

  assertEquals(result.orphansCanceled, 1);
  assertEquals(result.orphansUnrecognized, 1);
  assertEquals(result.errors, []);
  assertEquals(gwCalls.filter((c) => c.method === "cancelSubscription"), [
    { method: "cancelSubscription", args: ["sub-orphan"] },
  ]);
});

Deno.test("10a. leg C pagination: full page then short page ends the loop (no truncation)", async () => {
  // YOUNG_ISO keeps every filler item at verdict skip_young (silent) -- this test only cares
  // about the pagination call sequence, not the per-item verdicts.
  const page1 = Array.from({ length: 50 }, (_, i) => ({
    id: `sub-a1-${i}`,
    created_at: YOUNG_ISO,
    metadata: null,
  }));
  const page2 = Array.from({ length: 10 }, (_, i) => ({
    id: `sub-a2-${i}`,
    created_at: YOUNG_ISO,
    metadata: null,
  }));

  const { result, gwCalls } = await run({}, {
    listSubscriptions: (status, page) => {
      if (status === "future") return { data: [] };
      return { data: page === 1 ? page1 : page2 };
    },
  });

  assertEquals(result.sweepTruncated, false);
  assertEquals(
    gwCalls.filter((c) => c.method === "listSubscriptions").map((c) => c.args),
    [["active", 1, 50], ["active", 2, 50], ["future", 1, 50]],
  );
});

Deno.test("10b. leg C pagination: SWEEP_MAX_PAGES exceeded -> sweepTruncated + error entry, fetch-then-cancel order held", async () => {
  const { result, gwCalls } = await run({}, {
    listSubscriptions: (status, page, size) => {
      if (status === "future") return { data: [] };
      // Active never naturally stops: every page is full, forcing SWEEP_MAX_PAGES truncation.
      // Filler items use YOUNG_ISO (verdict skip_young, silent); only the one designated
      // orphan is old enough to be evaluated for a cancel.
      const items: RemoteSubListItem[] = [];
      for (let i = 0; i < size; i++) {
        if (page === 1 && i === 0) {
          items.push({ id: "sub-orphan-trunc", created_at: OLD_ISO, metadata: { workspace_id: "ws-9" } });
        } else {
          items.push({ id: `sub-noise-${page}-${i}`, created_at: YOUNG_ISO, metadata: null });
        }
      }
      return { data: items };
    },
  });

  assertEquals(result.sweepTruncated, true);
  assert(result.errors.includes("sweep truncated at SWEEP_MAX_PAGES pages"));
  assertEquals(
    gwCalls.filter((c) => c.method === "listSubscriptions" && c.args[0] === "active").length,
    20,
    "must stop calling list at SWEEP_MAX_PAGES, never exceed it",
  );
  assertEquals(result.orphansCanceled, 1);

  const methods = gwCalls.map((c) => c.method);
  const lastList = methods.lastIndexOf("listSubscriptions");
  const firstCancel = methods.indexOf("cancelSubscription");
  assert(firstCancel > lastList, "no cancelSubscription call may happen before listing finishes");
});

Deno.test("10c (P0). leg C linked-set read error -> leg aborts, error collected, ZERO cancelSubscription calls", async () => {
  const { result, gwCalls } = await run({
    linkedReadError: { message: "db down" },
  }, {
    listSubscriptions: () => ({
      data: [{ id: "sub-would-be-orphan", created_at: OLD_ISO, metadata: { workspace_id: "ws-1" } }],
    }),
  });

  assertEquals(result.errors.length, 1);
  assert(result.errors[0].includes("sweep linked read failed"));
  assertEquals(gwCalls.length, 0, "a failed local read must never make everything look orphaned");
  assertEquals(result.orphansCanceled, 0);
});

Deno.test("10d. leg C: linked read truncated by PostgREST's row cap (count > returned rows) -> aborts, zero cancels", async () => {
  const { result, gwCalls } = await run({
    linkedRows: [{ pagarme_subscription_id: "sub-a" }],
    // PostgREST silently truncated an unbounded select at db-max-rows: only 1 row came back
    // but the exact count says there were really 5 -- must be treated as a failure, not 4
    // "extra" orphans.
    linkedCount: 5,
  }, {
    listSubscriptions: () => ({
      data: [{ id: "sub-would-be-orphan", created_at: OLD_ISO, metadata: { workspace_id: "ws-1" } }],
    }),
  });

  assertEquals(result.errors.length, 1);
  assert(result.errors[0].includes("sweep linked read truncated"));
  assertEquals(gwCalls.length, 0, "truncation must abort before any list/cancel call");
  assertEquals(result.orphansCanceled, 0);
});

Deno.test("10e. leg C: pending-attempt read truncated by PostgREST's row cap -> aborts, zero cancels", async () => {
  const { result, gwCalls } = await run({
    pendingRows: [{ pagarme_subscription_id: "sub-p" }],
    pendingCount: 3,
  }, {
    listSubscriptions: () => ({
      data: [{ id: "sub-would-be-orphan", created_at: OLD_ISO, metadata: { workspace_id: "ws-1" } }],
    }),
  });

  assertEquals(result.errors.length, 1);
  assert(result.errors[0].includes("sweep pending read truncated"));
  assertEquals(gwCalls.length, 0, "truncation must abort before any list/cancel call");
  assertEquals(result.orphansCanceled, 0);
});

Deno.test("11. leg C: list failure on 'active' -> error collected, 'future' still listed", async () => {
  const { result, gwCalls } = await run({}, {
    listSubscriptions: (status) => {
      if (status === "active") throw new PagarmeApiError(500, {});
      return { data: [] };
    },
  });

  assertEquals(result.errors.length, 1);
  assert(result.errors[0].includes("active"));
  assert(
    gwCalls.some((c) => c.method === "listSubscriptions" && c.args[0] === "future"),
    "future must still be listed after active's failure",
  );
});

Deno.test("12. leg order and isolation: leg A read error -> error collected, legs B/C still run", async () => {
  const { result } = await run({
    dueReadError: { message: "due read boom" },
    staleRows: [{ id: "at-1", workspace_id: "ws-1", pagarme_subscription_id: null }],
  }, { listSubscriptions: () => ({ data: [] }) });

  assertEquals(result.downgraded, 0);
  assertEquals(result.attemptsExpired, 1, "leg B must still run after leg A's crash");
  assertEquals(result.remoteSkipped, false, "leg C must still run after leg A's crash");
  assertEquals(result.errors.length, 1);
  assert(result.errors[0].includes("due read boom") || result.errors[0].includes("leg A"));
});
