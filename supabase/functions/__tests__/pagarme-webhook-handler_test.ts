// Handler tests for pagarme-webhook. Fake-db pattern mirrors the house style established by
// pagarme-checkout-handler_test.ts: a thenable chain that records {table, op, filters, values}
// per call, in call order, and resolves per-table/op fixtures.
//
// Two additions beyond that precedent, both needed by this suite's brief:
// - `abortSignal: boolean` on each recorded event, so the bounded-DB-call house rule (global
//   constraint #2) is actually verifiable instead of merely assumed.
// - `seq: number`, a single monotonic counter shared by DB events AND notify calls, so the
//   "write BEFORE notify" ordering required by cases 15/15b/15c can be asserted directly by
//   comparing sequence numbers instead of inferring it from await timing.

import { assert, assertEquals } from "./assert.ts";
import { createPagarmeWebhookHandler } from "../pagarme-webhook/handler.ts";
import type { RemoteSubscription, WebhookGateway } from "../pagarme-webhook/gateway.ts";
import type { DunningStage } from "../_shared/dunning-logic.ts";

const NOW = new Date("2026-08-12T12:00:00Z");
const WS = "ws-1";
const SUB = "sub_1";

const baseRow = {
  workspace_id: WS,
  plan_id: "start",
  provider: "pagarme",
  stripe_subscription_id: null,
  pagarme_subscription_id: SUB,
  status: "active",
  cancel_at_period_end: false,
  current_period_end: "2027-08-10T23:59:59Z",
  past_due_since: null,
  failed_payment_count: 0,
  pagarme_dunning_key: null,
};

const ACTIVE_REMOTE: RemoteSubscription = {
  id: SUB,
  status: "active",
  current_cycle: { end_at: "2027-08-10T23:59:59Z", status: "billed" },
  next_billing_at: "2027-08-11T00:00:00Z",
};

type Ev = {
  op: string;
  table: string;
  values?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
  abortSignal: boolean;
  seq: number;
};

type NotifyEv = { ws: string; stage: DunningStage; seq: number };

interface DbFx {
  subRow?: Record<string, unknown> | null;
  subRowError?: { message: string } | null;
  casZeroRows?: boolean;
  casError?: { message: string } | null;
  defaultPlan?: { id: string } | null;
  defaultPlanError?: { message: string } | null;
  workspacePlanSource?: string | null;
  workspaceReadError?: { message: string } | null;
  workspaceWriteError?: { message: string } | null;
}

/**
 * Thenable chain stub (house pattern from pagarme-checkout-handler_test.ts, extended with the
 * abortSignal/seq tracking documented at the top of this file). Every operation is appended to
 * `events` in call order, with its eq/is filters, so tests can assert both sequencing and the
 * CAS pins.
 */
function makeDb(fx: DbFx & { events: Ev[] }, seq: { n: number }) {
  const from = (table: string) => {
    let op = "read";
    let values: Record<string, unknown> | undefined;
    let sawAbortSignal = false;
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
    chain.update = (v: Record<string, unknown>) => {
      op = "update";
      values = v;
      return chain;
    };
    const settle = () => {
      fx.events.push({ table, op, values, filters, abortSignal: sawAbortSignal, seq: seq.n++ });
      if (table === "workspace_subscriptions" && op === "read") {
        return { data: fx.subRow === undefined ? null : fx.subRow, error: fx.subRowError ?? null };
      }
      if (table === "workspace_subscriptions" && op === "update") {
        // CAS: update(...).eq(...)[.is/.eq pins].select("workspace_id") resolves to matched rows.
        return {
          data: fx.casZeroRows ? [] : [{ workspace_id: WS }],
          error: fx.casError ?? null,
        };
      }
      if (table === "plans") {
        return {
          data: fx.defaultPlan === undefined ? { id: "free" } : fx.defaultPlan,
          error: fx.defaultPlanError ?? null,
        };
      }
      if (table === "workspaces" && op === "read") {
        return {
          data: { plan_source: fx.workspacePlanSource ?? "system" },
          error: fx.workspaceReadError ?? null,
        };
      }
      if (table === "workspaces" && op === "update") {
        return { data: null, error: fx.workspaceWriteError ?? null };
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
  return { from };
}

function makeGateway(
  fx: { remote?: RemoteSubscription; throws?: unknown },
  calls: Array<{ subId: string }>,
): WebhookGateway {
  return {
    fetchSubscription: (subId: string) => {
      calls.push({ subId });
      if (fx.throws) return Promise.reject(fx.throws);
      return Promise.resolve(fx.remote ?? ACTIVE_REMOTE);
    },
  };
}

function makeNotify(notified: NotifyEv[], seq: { n: number }) {
  return (ws: string, stage: DunningStage): Promise<void> => {
    notified.push({ ws, stage, seq: seq.n++ });
    return Promise.resolve();
  };
}

function run(
  type: string,
  data: Record<string, unknown>,
  dbFx: DbFx,
  gwFx: { remote?: RemoteSubscription; throws?: unknown } = {},
) {
  const events: Ev[] = [];
  const notified: NotifyEv[] = [];
  const gwCalls: Array<{ subId: string }> = [];
  const seq = { n: 0 };
  const handle = createPagarmeWebhookHandler({
    db: makeDb({ ...dbFx, events }, seq),
    gateway: makeGateway(gwFx, gwCalls),
    notify: makeNotify(notified, seq),
    now: () => NOW,
  });
  const result = handle({ id: "hook_1", type, data });
  return { events, notified, gwCalls, result };
}

/** Patches console.error for the duration of `fn`, capturing every call as a joined string. */
async function withConsoleErrorSpy<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; messages: string[] }> {
  const original = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => {
    messages.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const result = await fn();
    return { result, messages };
  } finally {
    console.error = original;
  }
}

function filterHas(
  filters: Array<[string, string, unknown]>,
  method: "eq" | "is",
  col: string,
  val: unknown,
) {
  return filters.some(([m, c, v]) => m === method && c === col && v === val);
}

/** The three coordinates that MUST pin every write (global constraint #6). */
function assertCasCoordinates(filters: Array<[string, string, unknown]>) {
  assert(filterHas(filters, "eq", "workspace_id", WS), "CAS must pin workspace_id");
  assert(filterHas(filters, "eq", "provider", "pagarme"), "CAS must pin provider=pagarme");
  assert(
    filterHas(filters, "eq", "pagarme_subscription_id", SUB),
    "CAS must pin pagarme_subscription_id",
  );
}

function findCasUpdate(events: Ev[]): Ev | undefined {
  return events.find((e) => e.table === "workspace_subscriptions" && e.op === "update");
}

function findPlanWrite(events: Ev[]): Ev | undefined {
  return events.find((e) => e.table === "workspaces" && e.op === "update");
}

async function assertThrows(p: Promise<unknown>, needle: string) {
  let threw = false;
  try {
    await p;
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && e.message.includes(needle),
      `expected error to include "${needle}", got: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  assert(threw, `expected a throw containing "${needle}"`);
}

// ─── subscription.* / charge.paid / charge.refunded: the reconcile() path ─────────────────

Deno.test("1. subscription.updated: active row + active remote -> CAS'd update, plan write target 'start', reconciled", async () => {
  const { events, gwCalls, result } = run("subscription.updated", { id: SUB }, { subRow: baseRow });
  assertEquals(await result, "reconciled");
  assertEquals(gwCalls, [{ subId: SUB }]);

  const cas = findCasUpdate(events);
  assert(cas, "CAS update missing");
  assertCasCoordinates(cas.filters);
  assertEquals(cas.filters.length, 4, "reconcile() must pin the observed status on top of the 3 CAS coordinates");
  assert(
    filterHas(cas.filters, "eq", "status", "active"),
    "must pin the observed status with .eq(), not .is()",
  );
  assert(cas.abortSignal, "CAS write must be bounded by abortSignal");
  assertEquals(cas.values?.status, "active");

  const rowRead = events.find((e) => e.table === "workspace_subscriptions" && e.op === "read");
  assert(rowRead?.abortSignal, "row read must be bounded by abortSignal");

  const planWrite = findPlanWrite(events);
  assertEquals(planWrite?.values, { plan_id: "start", plan_source: "pagarme" });
});

Deno.test("2. subscription.updated: no local row -> throws 'no local row'", async () => {
  const { result } = run("subscription.updated", { id: SUB }, { subRow: null });
  await assertThrows(result, "no local row");
});

Deno.test("3. subscription-row read error DENIES (throws), never treated as no-row", async () => {
  const { result } = run(
    "subscription.updated",
    { id: SUB },
    { subRow: null, subRowError: { message: "boom" } },
  );
  await assertThrows(result, "row read failed");
});

Deno.test("4. row claimed by stripe and in force: canWebhookWrite denies, zero update, fetchSubscription NOT called", async () => {
  const { events, gwCalls, result } = run(
    "subscription.updated",
    { id: SUB },
    { subRow: { ...baseRow, provider: "stripe", status: "active", pagarme_subscription_id: SUB } },
  );
  assertEquals(await result, "ignored:ownership");
  assertEquals(events.filter((e) => e.op === "update").length, 0);
  assertEquals(gwCalls.length, 0, "authorize must deny BEFORE the remote fetch");
});

Deno.test("5. metadata divergence: remote workspace_id differs -> ignored:ownership (null = ack without write), zero updates, divergence logged", async () => {
  const { events, result } = run(
    "subscription.updated",
    { id: SUB },
    { subRow: baseRow },
    { remote: { ...ACTIVE_REMOTE, metadata: { workspace_id: "ws-OUTRO" } } },
  );
  const { result: outcome, messages } = await withConsoleErrorSpy(() => result);
  assertEquals(outcome, "ignored:ownership");
  assertEquals(events.filter((e) => e.op === "update").length, 0);
  assert(
    messages.some((m) => m.includes("metadata divergence")),
    "expected a metadata divergence log",
  );
});

Deno.test("6. subscription.canceled: paid-through cancel retains current_period_end, sets cancel_at_period_end, plan write does NOT happen", async () => {
  const { events, result } = run(
    "subscription.canceled",
    { id: SUB },
    { subRow: baseRow },
    {
      remote: {
        id: SUB,
        status: "canceled",
        current_cycle: { status: "billed", end_at: "2027-08-10T23:59:59Z" },
      },
    },
  );
  assertEquals(await result, "reconciled");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(filterHas(cas.filters, "eq", "status", "active"), "must pin the observed status");
  assertEquals(cas.values?.status, "canceled");
  assertEquals(cas.values?.cancel_at_period_end, true);
  assertEquals(cas.values?.current_period_end, "2027-08-10T23:59:59Z");
  assertEquals(findPlanWrite(events), undefined, "paid-through cancel must not write a plan target");
});

Deno.test("7. subscription.canceled from trial (no cycle, cape stays false): plan write downgrades to DEFAULT ('free')", async () => {
  const { events, result } = run(
    "subscription.canceled",
    { id: SUB },
    { subRow: { ...baseRow, status: "trialing", current_period_end: "2026-09-11T00:00:00Z" } },
    { remote: { id: SUB, status: "canceled" } },
  );
  assertEquals(await result, "reconciled");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(filterHas(cas.filters, "eq", "status", "trialing"), "must pin the observed status");
  assertEquals(cas.values?.cancel_at_period_end, false);
  assertEquals(cas.values?.current_period_end, "2026-09-11T00:00:00Z", "retained even though FUTURE");
  const planWrite = findPlanWrite(events);
  assertEquals(planWrite?.values, { plan_id: "free", plan_source: "pagarme" });
});

Deno.test("8. CAS matches zero rows -> throws 'concurrent ownership change'", async () => {
  const { result } = run("subscription.updated", { id: SUB }, { subRow: baseRow, casZeroRows: true });
  await assertThrows(result, "concurrent ownership change");
});

Deno.test("9. unknown remote status ('paused') -> ignored:unknown-status, zero updates", async () => {
  const { events, result } = run(
    "subscription.updated",
    { id: SUB },
    { subRow: baseRow },
    { remote: { id: SUB, status: "paused" } },
  );
  assertEquals(await result, "ignored:unknown-status");
  assertEquals(events.filter((e) => e.op === "update").length, 0);
});

Deno.test("10. charge.paid recovers a past_due row: recovery columns + status active, reconciled:recovered", async () => {
  const { events, result } = run(
    "charge.paid",
    { invoice: { subscription_id: SUB } },
    {
      subRow: {
        ...baseRow,
        status: "past_due",
        past_due_since: "2026-08-11T00:00:00Z",
        failed_payment_count: 2,
        pagarme_dunning_key: "ch_1:2",
      },
    },
  );
  assertEquals(await result, "reconciled:recovered");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(filterHas(cas.filters, "eq", "status", "past_due"), "must pin the observed status");
  assertEquals(cas.values?.status, "active");
  assertEquals(cas.values?.past_due_since, null);
  assertEquals(cas.values?.failed_payment_count, 0);
  assertEquals("pagarme_dunning_key" in (cas.values ?? {}), false, "recovery write must retain the stored key, not clear it");
});

Deno.test("11. subscription.updated observing active while row is past_due holds the episode: no status field, no recovery fields, no plan write, reconciled:dunning-held", async () => {
  const { events, result } = run(
    "subscription.updated",
    { id: SUB },
    {
      subRow: {
        ...baseRow,
        status: "past_due",
        past_due_since: "2026-08-11T00:00:00Z",
        failed_payment_count: 1,
        pagarme_dunning_key: "ch_1:1",
      },
    },
  );
  assertEquals(await result, "reconciled:dunning-held");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(
    filterHas(cas.filters, "eq", "status", "past_due"),
    "must pin the observed status even though the write itself does not touch the status column",
  );
  const values = cas.values ?? {};
  assert(!("status" in values), "hold-dunning write must not touch status");
  assert(!("past_due_since" in values), "hold-dunning write must not touch the episode");
  assertEquals(findPlanWrite(events), undefined);
});

// ─── charge.payment_failed, non-terminal (dunning advance) ─────────────────────────────────

Deno.test("12. charge.payment_failed, first failure (remote still active): past_due write pinned on the observed (null) dunning key, notify first", async () => {
  const { events, notified, result } = run(
    "charge.payment_failed",
    { id: "ch_1", invoice: { subscription_id: SUB }, last_transaction: { attempt_count: 1 } },
    { subRow: baseRow },
  );
  assertEquals(await result, "dunning:first");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assertEquals(cas.filters.length, 4, "must carry the observedDunningKey pin on top of the 3 CAS coordinates");
  assert(cas.abortSignal, "CAS write must be bounded by abortSignal");
  assertEquals(cas.values?.status, "past_due");
  assertEquals(cas.values?.failed_payment_count, 1);
  assertEquals(cas.values?.pagarme_dunning_key, "ch_1:1");
  assertEquals(cas.values?.past_due_since, NOW.toISOString());
  assert(
    filterHas(cas.filters, "is", "pagarme_dunning_key", null),
    "must pin the observed (null) dunning key with .is(), not .eq()",
  );
  assertEquals(notified.length, 1);
  assertEquals(notified[0].ws, WS);
  assertEquals(notified[0].stage, "first");
});

Deno.test("13. charge.payment_failed, exact same charge+attempt redelivered -> ignored:duplicate-failure, zero updates, zero notify", async () => {
  const { events, notified, result } = run(
    "charge.payment_failed",
    { id: "ch_1", invoice: { subscription_id: SUB }, last_transaction: { attempt_count: 1 } },
    {
      subRow: {
        ...baseRow,
        status: "past_due",
        past_due_since: "2026-08-12T12:00:00.000Z",
        failed_payment_count: 1,
        pagarme_dunning_key: "ch_1:1",
      },
    },
  );
  assertEquals(await result, "ignored:duplicate-failure");
  assertEquals(events.filter((e) => e.table === "workspace_subscriptions" && e.op === "update").length, 0);
  assertEquals(notified.length, 0);
});

Deno.test("14. charge.payment_failed, second real failure: count/key advance, past_due_since PRESERVED, CAS pinned on the prior key, notify retry", async () => {
  const { events, notified, result } = run(
    "charge.payment_failed",
    { id: "ch_1", invoice: { subscription_id: SUB }, last_transaction: { attempt_count: 2 } },
    {
      subRow: {
        ...baseRow,
        status: "past_due",
        past_due_since: "2026-08-11T00:00:00Z",
        failed_payment_count: 1,
        pagarme_dunning_key: "ch_1:1",
      },
    },
  );
  assertEquals(await result, "dunning:retry");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assertEquals(cas.values?.failed_payment_count, 2);
  assertEquals(cas.values?.pagarme_dunning_key, "ch_1:2");
  assertEquals(cas.values?.past_due_since, "2026-08-11T00:00:00Z", "existing episode start must be preserved");
  assert(
    filterHas(cas.filters, "eq", "pagarme_dunning_key", "ch_1:1"),
    "must pin the previously observed key",
  );
  assertEquals(notified.length, 1);
  assertEquals(notified[0].ws, WS);
  assertEquals(notified[0].stage, "retry");
});

Deno.test("14b. charge.payment_failed out of order (attempt 1 delivered after attempt 2 already recorded): ignored:duplicate-failure (monotonic rule), zero updates, zero notify", async () => {
  const { events, notified, result } = run(
    "charge.payment_failed",
    { id: "ch_1", invoice: { subscription_id: SUB }, last_transaction: { attempt_count: 1 } },
    {
      subRow: {
        ...baseRow,
        status: "past_due",
        past_due_since: "2026-08-11T00:00:00Z",
        failed_payment_count: 2,
        pagarme_dunning_key: "ch_1:2",
      },
    },
  );
  assertEquals(await result, "ignored:duplicate-failure");
  assertEquals(events.filter((e) => e.table === "workspace_subscriptions" && e.op === "update").length, 0);
  assertEquals(notified.length, 0);
});

// ─── charge.payment_failed, terminal (the only path that may send "final") ────────────────

Deno.test("15. charge.payment_failed, terminal (remote failed), open past_due episode: canceled write pinned on the observed status, DEFAULT plan, notify final AFTER the write", async () => {
  const { events, notified, result } = run(
    "charge.payment_failed",
    { invoice: { subscription_id: SUB } },
    {
      subRow: {
        ...baseRow,
        status: "past_due",
        past_due_since: "2026-08-11T00:00:00Z",
        failed_payment_count: 2,
        pagarme_dunning_key: "ch_1:2",
        current_period_end: "2026-08-01T00:00:00Z", // in the past
      },
    },
    { remote: { id: SUB, status: "failed" } },
  );
  assertEquals(await result, "dunning:final");

  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(
    filterHas(cas.filters, "eq", "status", "past_due"),
    "must pin the observed status with .eq(), not .is()",
  );
  assertEquals(cas.values?.status, "canceled");

  const planWrite = findPlanWrite(events);
  assertEquals(planWrite?.values, { plan_id: "free", plan_source: "pagarme" });

  assertEquals(notified.length, 1);
  assertEquals(notified[0].ws, WS);
  assertEquals(notified[0].stage, "final");
  assert(cas.seq < notified[0].seq, "the write must land BEFORE the e-mail");
});

Deno.test("15b. charge.payment_failed, terminal (remote canceled, paid-through), healthy row (no open episode): write happens (pinned on the observed status) but ZERO notify — voluntary cancel racing a late failure", async () => {
  const { events, notified, result } = run(
    "charge.payment_failed",
    { invoice: { subscription_id: SUB } },
    { subRow: { ...baseRow, status: "active", past_due_since: null } },
    {
      remote: {
        id: SUB,
        status: "canceled",
        current_cycle: { status: "billed", end_at: "2027-08-10T23:59:59Z" },
      },
    },
  );
  assertEquals(await result, "reconciled:terminal");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(filterHas(cas.filters, "eq", "status", "active"), "must pin the observed status");
  assertEquals(cas.values?.status, "canceled");
  assertEquals(notified.length, 0);
});

Deno.test("15c. charge.payment_failed, terminal, idempotent redelivery on an already-canceled row: CAS pins the canceled status, write succeeds, ZERO notify", async () => {
  const { events, notified, result } = run(
    "charge.payment_failed",
    { invoice: { subscription_id: SUB } },
    {
      subRow: {
        ...baseRow,
        status: "canceled",
        past_due_since: "2026-08-11T00:00:00Z",
        cancel_at_period_end: false,
        current_period_end: "2026-08-01T00:00:00Z",
      },
    },
    { remote: { id: SUB, status: "failed" } },
  );
  assertEquals(await result, "reconciled:terminal");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(
    filterHas(cas.filters, "eq", "status", "canceled"),
    "must pin the observed (already-canceled) status",
  );
  assertEquals(notified.length, 0, "a row already canceled was either already notified or voluntary");
});

Deno.test("15d. default plan read errors -> handler throws 'default plan read failed' (the CAS write had already landed)", async () => {
  const { events, result } = run(
    "subscription.updated",
    { id: SUB },
    { subRow: baseRow, defaultPlanError: { message: "boom" } },
  );
  await assertThrows(result, "default plan read failed");
  const cas = findCasUpdate(events);
  assert(cas, "CAS update missing");
  assert(filterHas(cas.filters, "eq", "status", "active"), "must pin the observed status");
  assertEquals(
    events.filter((e) => e.table === "workspace_subscriptions" && e.op === "update").length,
    1,
    "the subscription write must not be blocked by a later plan-read failure",
  );
});

// ─── routing / edge cases ───────────────────────────────────────────────────────────────────

Deno.test("16. charge.payment_failed with no resolvable subscription id -> ignored:no-subscription-id, zero DB", async () => {
  const { events, gwCalls, result } = run("charge.payment_failed", { id: "ch_9" }, { subRow: baseRow });
  assertEquals(await result, "ignored:no-subscription-id");
  assertEquals(events.length, 0);
  assertEquals(gwCalls.length, 0);
});

Deno.test("17. charge.payment_failed with no charge id -> ignored:no-charge-id, zero updates (but authorize ran)", async () => {
  const { events, gwCalls, result } = run(
    "charge.payment_failed",
    { invoice: { subscription_id: SUB } },
    { subRow: baseRow },
  );
  assertEquals(await result, "ignored:no-charge-id");
  assertEquals(events.filter((e) => e.op === "update").length, 0);
  assertEquals(gwCalls.length, 1, "authorize (row read + remote fetch) must have run");
});

Deno.test("18. charge.refunded reconciles the real status and never notifies", async () => {
  const { events, notified, result } = run(
    "charge.refunded",
    { invoice: { subscription_id: SUB } },
    { subRow: baseRow },
  );
  assertEquals(await result, "reconciled");
  assertEquals(notified.length, 0);
  const cas = findCasUpdate(events);
  assert(cas, "CAS update missing");
  assert(filterHas(cas.filters, "eq", "status", "active"), "must pin the observed status");
});

Deno.test("19. invoice.paid and charge.created are unhandled types -> ignored:unhandled-type, ZERO DB calls", async () => {
  for (const type of ["invoice.paid", "charge.created"]) {
    const { events, gwCalls, result } = run(type, { id: "x" }, { subRow: baseRow });
    assertEquals(await result, "ignored:unhandled-type", type);
    assertEquals(events.length, 0, `${type}: zero DB calls`);
    assertEquals(gwCalls.length, 0, `${type}: zero gateway calls`);
  }
});

Deno.test("20. gateway throws (timeout) -> handler throws, propagating for a 5xx redelivery", async () => {
  const { events, result } = run(
    "subscription.updated",
    { id: SUB },
    { subRow: baseRow },
    { throws: new Error("timeout") },
  );
  await assertThrows(result, "timeout");
  assertEquals(events.filter((e) => e.op === "update").length, 0);
});

// ─── plan-writer integration ────────────────────────────────────────────────────────────────

Deno.test("21. plan-writer: workspaces.plan_source 'manual' preserves the comp, no plan_id write, still reconciled", async () => {
  const { events, result } = run(
    "subscription.updated",
    { id: SUB },
    { subRow: baseRow, workspacePlanSource: "manual" },
  );
  assertEquals(await result, "reconciled");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(filterHas(cas.filters, "eq", "status", "active"), "must pin the observed status");
  assertEquals(findPlanWrite(events), undefined, "manual comp must never be overridden");
  const wsRead = events.find((e) => e.table === "workspaces" && e.op === "read");
  assert(wsRead, "writeWorkspacePlan must still read plan_source to check the comp");
});

Deno.test("22. row with plan_id null: CRITICAL logged, no plans/workspaces write, reconcile still completes", async () => {
  const { events, result } = run(
    "subscription.updated",
    { id: SUB },
    { subRow: { ...baseRow, plan_id: null } },
  );
  const { result: outcome, messages } = await withConsoleErrorSpy(() => result);
  assertEquals(outcome, "reconciled");
  const cas = findCasUpdate(events);
  assert(cas);
  assertCasCoordinates(cas.filters);
  assert(filterHas(cas.filters, "eq", "status", "active"), "must pin the observed status");
  assertEquals(events.filter((e) => e.table === "workspaces").length, 0, "no plan_id -> grantPlan must not even read the default plan's workspace");
  assertEquals(events.filter((e) => e.table === "plans").length, 0, "no plan_id -> getDefaultPlanId must never run");
  assert(messages.some((m) => m.includes("CRITICAL")), "expected a CRITICAL log for the missing plan_id");
});
