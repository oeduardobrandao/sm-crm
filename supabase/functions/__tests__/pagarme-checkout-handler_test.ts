import { assert, assertEquals } from "./assert.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import { createPagarmeCheckoutHandler } from "../pagarme-checkout/handler.ts";
import { PagarmeGateway } from "../pagarme-checkout/gateway.ts";
import { PagarmeCheckoutRequest } from "../pagarme-checkout/logic.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const WS = "22222222-2222-2222-2222-222222222222";
const ATTEMPT_ID = "at-1";

const CTX = { workspaceId: WS, userEmail: "owner@agencia.com", userName: "Dona Owner" };

const REQ: PagarmeCheckoutRequest = {
  planId: "start",
  cardToken: "token_abc",
  document: "11144477735",
  documentType: "cpf",
  customerType: "individual",
  phone: { ddd: "11", number: "999990000" },
  billingAddress: { cep: "01310100", line1: "Av. Paulista, 1000", city: "São Paulo", state: "SP" },
};

const PLAN = {
  id: "start",
  price_brl_annual: 95900,
  pagarme_12x_enabled: true,
  pagarme_plan_id_annual: "plan_remote_1",
};

type Ev = {
  op: string;
  table: string;
  values?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>; // [method, column, value] for eq/is
};

/**
 * Minimal chainable thenable stub (house pattern: instagram-connect-link-handler_test.ts,
 * extended with a `then` so bare `await chain` update calls settle too). Every operation is
 * appended to `events` in call order — with its eq/is filters — so tests can assert both
 * sequencing and the CAS pins.
 */
function makeDb(fx: {
  plan?: Record<string, unknown> | null;
  subRow?: Record<string, unknown> | null;
  subRowError?: { message: string } | null;
  reserveError?: { code?: string; message: string } | null;
  /** CAS update on workspace_subscriptions matches zero rows (lost race). */
  bindZeroRows?: boolean;
  bindUpdateError?: { message: string } | null;
  bindInsertError?: { code?: string; message: string } | null;
  /** Error injected ONLY on the orphan-pointer update (attempt update carrying
   * pagarme_subscription_id without a state). */
  attemptPointerError?: { message: string } | null;
  /** Error injected on the workspaces plan-grant update (plan-writer). */
  planWriteError?: { message: string } | null;
  /** Rows returned by the stale-pending-attempt read (step 3). Defaults to none. */
  stalePending?: Array<{ id: string; pagarme_subscription_id: string | null }>;
  events: Ev[];
}): SupabaseClient {
  const from = (table: string) => {
    let op = "read";
    let values: Record<string, unknown> | undefined;
    const filters: Array<[string, string, unknown]> = [];
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    chain.select = () => chain;
    chain.lt = () => chain;
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
    chain.insert = (v: Record<string, unknown>) => {
      op = "insert";
      values = v;
      return chain;
    };
    const settle = () => {
      fx.events.push({ op, table, values, filters });
      if (table === "plans") return { data: fx.plan ?? null, error: null };
      if (table === "workspace_subscriptions" && op === "read") {
        return { data: fx.subRow ?? null, error: fx.subRowError ?? null };
      }
      if (table === "workspace_subscriptions" && op === "update") {
        // CAS bind: update(...).eq(...).select("workspace_id") resolves to matched rows
        return {
          data: fx.bindZeroRows ? [] : [{ workspace_id: WS }],
          error: fx.bindUpdateError ?? null,
        };
      }
      if (table === "workspace_subscriptions" && op === "insert") {
        return { data: null, error: fx.bindInsertError ?? null };
      }
      if (table === "pagarme_checkout_attempts" && op === "read") {
        return { data: fx.stalePending ?? [], error: null };
      }
      if (table === "pagarme_checkout_attempts" && op === "insert") {
        if (fx.reserveError) return { data: null, error: fx.reserveError };
        return { data: { id: ATTEMPT_ID }, error: null };
      }
      if (
        table === "pagarme_checkout_attempts" && op === "update" &&
        values?.pagarme_subscription_id !== undefined && values?.state === undefined
      ) {
        return { data: null, error: fx.attemptPointerError ?? null };
      }
      if (table === "workspaces" && op === "read") {
        return { data: { plan_source: "system" }, error: null };
      }
      if (table === "workspaces" && op === "update") {
        return { data: null, error: fx.planWriteError ?? null };
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
  return { from } as unknown as SupabaseClient;
}

function makeGateway(fx: {
  calls: Array<{ method: string; args: unknown[] }>;
  subStatus?: string;
  subStartAt?: string | null;
  nextBillingAt?: string | null;
  failAt?: "customer" | "card" | "subscription";
  failWith?: unknown;
  /** Number of leading createSubscription calls that should fail when failAt === "subscription".
   * Defaults to Infinity (fail on every call), preserving prior tests' "always fails" behavior. */
  failSubscriptionTimes?: number;
  /** When true, cancelSubscription records the call but throws (gateway outage during
   * compensation). Defaults to false (cancel always succeeds). */
  failCancel?: boolean;
  /** Error thrown by cancelSubscription when failCancel is true. Defaults to a generic Error. */
  failCancelWith?: unknown;
}): PagarmeGateway {
  const record = (method: string, args: unknown[]) => fx.calls.push({ method, args });
  const maybeFail = (stage: string) => {
    if (fx.failAt === stage) throw fx.failWith ?? new Error("gateway boom");
  };
  let subscriptionCalls = 0;
  return {
    upsertCustomer: (input) => {
      record("upsertCustomer", [input]);
      maybeFail("customer");
      return Promise.resolve({ id: "cus_1" });
    },
    attachCard: (customerId, token, address) => {
      record("attachCard", [customerId, token, address]);
      maybeFail("card");
      return Promise.resolve({ id: "card_1" });
    },
    createSubscription: (input, idempotencyKey) => {
      record("createSubscription", [input, idempotencyKey]);
      if (fx.failAt === "subscription") {
        subscriptionCalls++;
        if (subscriptionCalls <= (fx.failSubscriptionTimes ?? Infinity)) {
          throw fx.failWith ?? new Error("gateway boom");
        }
      }
      return Promise.resolve({
        id: "sub_1",
        status: fx.subStatus ?? "active",
        start_at: fx.subStartAt ?? null,
        next_billing_at: fx.nextBillingAt ?? null,
        current_cycle: null,
      });
    },
    cancelSubscription: (id) => {
      record("cancelSubscription", [id]);
      if (fx.failCancel) throw fx.failCancelWith ?? new Error("cancel boom");
      return Promise.resolve();
    },
  };
}

function run(
  dbFx: Omit<Parameters<typeof makeDb>[0], "events">,
  gwFx: Omit<Parameters<typeof makeGateway>[0], "calls"> = {},
) {
  const events: Ev[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const handle = createPagarmeCheckoutHandler({
    db: makeDb({ ...dbFx, events }),
    gateway: makeGateway({ ...gwFx, calls }),
    now: () => NOW,
  });
  return { events, calls, result: handle(CTX, REQ) };
}

Deno.test("gate off: 403, no reservation, zero gateway calls", async () => {
  const { events, calls, result } = run({ plan: { ...PLAN, pagarme_12x_enabled: false } });
  const r = await result;
  assertEquals(r.status, 403);
  assertEquals(calls.length, 0);
  assertEquals(events.filter((e) => e.table === "pagarme_checkout_attempts").length, 0);
});

Deno.test("unconfigured plan: 400 plan_not_configured before any write", async () => {
  const { calls, result } = run({ plan: { ...PLAN, pagarme_plan_id_annual: null } });
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "plan_not_configured");
  assertEquals(calls.length, 0);
});

Deno.test("blocked row: 409 before reservation", async () => {
  const { events, calls, result } = run({
    plan: PLAN,
    subRow: { provider: "stripe", status: "active" },
  });
  const r = await result;
  assertEquals(r.status, 409);
  assertEquals(calls.length, 0);
  assertEquals(events.filter((e) => e.table === "pagarme_checkout_attempts").length, 0);
});

Deno.test("subscription-row read error DENIES (throws), never treated as no-row", async () => {
  const { result } = run({ plan: PLAN, subRowError: { message: "boom" } });
  let threw = false;
  try {
    await result;
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("concurrent reservation (23505): 409 and ZERO remote calls", async () => {
  const { calls, result } = run({
    plan: PLAN,
    reserveError: { code: "23505", message: "duplicate key" },
  });
  const r = await result;
  assertEquals(r.status, 409);
  assertEquals(calls.length, 0);
});

Deno.test("happy path, no trial: order, idempotency key, single-statement bind, plan write", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: { provider: "stripe", status: "canceled", ever_subscribed_at: "2026-01-01T00:00:00Z" } },
    { subStatus: "active", nextBillingAt: "2027-08-12T00:00:00Z" },
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    status: "active",
    trial_ends_at: null,
    next_charge_at: "2027-08-12T00:00:00Z",
    installment_amount_cents: 7992,
  });

  // Gateway call order and shapes
  assertEquals(calls.map((c) => c.method), ["upsertCustomer", "attachCard", "createSubscription"]);
  const customerInput = calls[0].args[0] as Record<string, unknown>;
  assertEquals(customerInput.email, "owner@agencia.com");
  assertEquals(customerInput.name, "Dona Owner");
  assertEquals(customerInput.document, "11144477735");
  const subInput = calls[2].args[0] as Record<string, unknown>;
  assertEquals(subInput.plan_id, "plan_remote_1");
  assertEquals(subInput.card_id, "card_1");
  assertEquals(subInput.installments, 12);
  assertEquals(subInput.start_at, undefined); // prior subscriber: no trial
  assertEquals(subInput.metadata, { workspace_id: WS, plan_id: "start" });
  assertEquals(calls[2].args[1], "pagarme-co-at-1");

  // Orphan traceability BEFORE the row bind
  const subIdWrite = events.findIndex((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" &&
    e.values?.pagarme_subscription_id === "sub_1"
  );
  const rowBind = events.findIndex((e) => e.table === "workspace_subscriptions" && e.op === "update");
  assert(subIdWrite !== -1, "attempt sub-id write missing");
  assert(rowBind !== -1, "row bind missing");
  assert(subIdWrite < rowBind, "attempt sub-id write must land BEFORE the row bind");

  // Single-statement invariant: provider flip and amount mirror in the SAME payload
  const bind = events[rowBind].values as Record<string, unknown>;
  assertEquals(bind.provider, "pagarme");
  assertEquals(bind.amount_cents, 95900);
  assertEquals(bind.installments, 12);
  assertEquals(bind.ever_subscribed_at, "2026-01-01T00:00:00Z"); // retained, not overwritten

  // CAS: the bind is pinned to the ownership coordinates observed at gate-read time —
  // the row was a churned Stripe row with NO subscription id, so the pin is
  // provider='stripe' AND stripe_subscription_id IS NULL.
  const bindFilters = events[rowBind].filters;
  assert(
    bindFilters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "stripe"),
    "CAS must pin the observed provider",
  );
  assert(
    bindFilters.some(([m, c]) => m === "is" && c === "stripe_subscription_id"),
    "CAS must pin the observed (null) subscription id",
  );

  // Effective plan written with plan_source pagarme
  const planWrite = events.find((e) => e.table === "workspaces" && e.op === "update");
  assertEquals(planWrite?.values, { plan_id: "start", plan_source: "pagarme" });

  // Attempt finishes succeeded
  const succeeded = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "succeeded"
  );
  assert(succeeded !== undefined, "attempt not marked succeeded");
});

Deno.test("churned pagarme row retrying checkout: CAS pins provider=pagarme and the old pagarme_subscription_id", async () => {
  const { events, result } = run(
    {
      plan: PLAN,
      subRow: {
        provider: "pagarme",
        status: "canceled",
        cancel_at_period_end: true,
        current_period_end: "2026-01-01T00:00:00Z",
        pagarme_subscription_id: "sub_old",
        ever_subscribed_at: "2025-08-12T00:00:00Z",
      },
    },
    { subStatus: "active", nextBillingAt: "2027-08-12T00:00:00Z" },
  );
  const r = await result;
  assertEquals(r.status, 200);
  const rowBind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update");
  assert(rowBind !== undefined, "update bind missing");
  assert(
    rowBind.filters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "pagarme"),
    "CAS must pin the observed pagarme provider",
  );
  assert(
    rowBind.filters.some(([m, c, v]) => m === "eq" && c === "pagarme_subscription_id" && v === "sub_old"),
    "CAS must pin the observed pagarme subscription id",
  );
});

Deno.test("trial path: fresh workspace gets start_at now+30d, status future maps to trialing, bind is an INSERT", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null },
    { subStatus: "future", subStartAt: "2026-09-11T00:00:00Z" },
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    status: "trialing",
    trial_ends_at: "2026-09-11T00:00:00Z",
    next_charge_at: "2026-09-11T00:00:00Z",
    installment_amount_cents: 7992,
  });
  const subInput = calls[2].args[0] as Record<string, unknown>;
  assertEquals(subInput.start_at, "2026-09-11");
  // No row observed at gate time → plain INSERT (a concurrent create surfaces as 23505,
  // never as a silent overwrite), carrying provider + mirror in the same payload.
  const ins = events.find((e) => e.table === "workspace_subscriptions" && e.op === "insert");
  assert(ins !== undefined, "insert bind missing");
  assertEquals((ins.values as Record<string, unknown>).provider, "pagarme");
  assertEquals((ins.values as Record<string, unknown>).amount_cents, 95900);
  assertEquals((ins.values as Record<string, unknown>).workspace_id, WS);
});

Deno.test("legacy stripe id alone kills the trial", async () => {
  const { calls, result } = run(
    { plan: PLAN, subRow: { provider: "stripe", status: "canceled", stripe_subscription_id: "sub_old" } },
    { subStatus: "active" },
  );
  await result;
  const subInput = calls[2].args[0] as Record<string, unknown>;
  assertEquals(subInput.start_at, undefined);
});

Deno.test("remote status failed: compensating cancel, attempt failed, NO bind, NO plan write, 400 invalid_card", async () => {
  const { events, calls, result } = run({ plan: PLAN, subRow: null }, { subStatus: "failed" });
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "invalid_card");
  assertEquals(calls.map((c) => c.method).pop(), "cancelSubscription");
  assertEquals(calls[calls.length - 1].args[0], "sub_1");
  const binds = events.filter((e) =>
    e.table === "workspace_subscriptions" && (e.op === "update" || e.op === "insert")
  );
  assertEquals(binds.length, 0);
  assertEquals(events.filter((e) => e.table === "workspaces" && e.op === "update").length, 0);
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
});

Deno.test("card-stage 4xx: 400 invalid_card, no subscription create, attempt failed", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null },
    { failAt: "card", failWith: new PagarmeApiError(400, { any: "detail" }) },
  );
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "invalid_card");
  assertEquals(calls.some((c) => c.method === "createSubscription"), false);
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
});

Deno.test("ambiguous create failure retries ONCE with the SAME idempotency key and completes", async () => {
  const { calls, result } = run(
    { plan: PLAN, subRow: null },
    {
      subStatus: "future",
      subStartAt: "2026-09-11T00:00:00Z",
      failAt: "subscription",
      failSubscriptionTimes: 1,
      failWith: new Error("timeout"),
    },
  );
  const r = await result;
  assertEquals(r.status, 200);
  const createCalls = calls.filter((c) => c.method === "createSubscription");
  assertEquals(createCalls.length, 2);
  assertEquals(createCalls[0].args[1], "pagarme-co-at-1");
  assertEquals(createCalls[1].args[1], "pagarme-co-at-1"); // SAME key, never a new one
});

Deno.test("definitive 4xx rejection at the subscription stage never retries", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null },
    { failAt: "subscription", failWith: new PagarmeApiError(400, { any: "detail" }) },
  );
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "plan_not_configured");
  assertEquals(calls.filter((c) => c.method === "createSubscription").length, 1);
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "definitive rejection releases the reservation");
});

Deno.test("double ambiguous create failure leaves the reservation PENDING", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: null },
    { failAt: "subscription", failWith: new Error("timeout") },
  );
  const r = await result;
  assertEquals(r.status, 500);
  // Excludes the unconditional stale-attempt expiry sweep (step 3), which writes
  // state: "expired" on every request regardless of outcome and is unrelated to this
  // attempt's own disposition. Only a terminal failed/succeeded write on THIS attempt would
  // release the reservation.
  const stateWrites = events.filter((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" &&
    (e.values?.state === "failed" || e.values?.state === "succeeded")
  );
  assertEquals(stateWrites.length, 0, "no state transition: the reservation must stay pending");
});

Deno.test("compensating cancel failure leaves the reservation PENDING with the orphan pointer intact", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null, bindInsertError: { message: "db down" } },
    { subStatus: "active", failCancel: true },
  );
  const r = await result;
  assertEquals(r.status, 500);
  assert(calls.some((c) => c.method === "cancelSubscription"), "cancel must be attempted");
  const pointer = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" &&
    e.values?.pagarme_subscription_id === "sub_1" && e.values?.state === undefined
  );
  assert(pointer !== undefined, "orphan pointer must be recorded");
  // Excludes the unconditional stale-attempt expiry sweep (step 3), which writes
  // state: "expired" on every request regardless of outcome and is unrelated to this
  // attempt's own disposition. Only a terminal failed/succeeded write on THIS attempt would
  // release the reservation.
  const stateWrites = events.filter((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" &&
    (e.values?.state === "failed" || e.values?.state === "succeeded")
  );
  assertEquals(stateWrites.length, 0, "no state transition: the reservation must stay pending");
});

Deno.test("successful compensating cancel still releases the reservation as failed", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: null, bindInsertError: { message: "db down" } },
    { subStatus: "active" },
  );
  await result;
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "cancel succeeded: attempt must be released as failed");
});

Deno.test("bind DB error after subscription create: compensating cancel, attempt failed with sub id, 500", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null, bindInsertError: { message: "db down" } },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 500);
  // The remote sub is cancelled: leaving it alive would let a retry (new attempt = new
  // idempotency key) mint a SECOND subscription.
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === "sub_1"));
  // The orphan pointer was written before the bind attempt: reconciliation can find sub_1.
  const subIdWrite = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" &&
    e.values?.pagarme_subscription_id === "sub_1"
  );
  assert(subIdWrite !== undefined, "orphan pointer missing");
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
});

Deno.test("lost CAS race (zero rows matched): compensating cancel, attempt failed, 409", async () => {
  const { events, calls, result } = run(
    {
      plan: PLAN,
      subRow: { provider: "stripe", status: "canceled", ever_subscribed_at: "2026-01-01T00:00:00Z" },
      bindZeroRows: true,
    },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 409);
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === "sub_1"));
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
  assertEquals(events.filter((e) => e.table === "workspaces" && e.op === "update").length, 0);
});

Deno.test("insert conflict (23505, concurrent create): compensating cancel, 409", async () => {
  const { calls, result } = run(
    { plan: PLAN, subRow: null, bindInsertError: { code: "23505", message: "duplicate key" } },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 409);
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === "sub_1"));
});

Deno.test("orphan-pointer write failure: compensating cancel, attempt failed, 500, NO bind", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null, attemptPointerError: { message: "db hiccup" } },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 500);
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === "sub_1"));
  const binds = events.filter((e) =>
    e.table === "workspace_subscriptions" && (e.op === "update" || e.op === "insert")
  );
  assertEquals(binds.length, 0);
  const failed = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed"
  );
  assert(failed !== undefined, "attempt not marked failed");
});

Deno.test("plan-grant failure AFTER a committed bind: no cancel, attempt succeeded, still 200", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null, planWriteError: { message: "workspaces down" } },
    { subStatus: "active", nextBillingAt: "2027-08-12T00:00:00Z" },
  );
  const r = await result;
  // The subscription is live and BOUND; failing the request would tell the user to retry a
  // checkout that can only 409 now. The CRITICAL log is the alert; recovery is support/webhook.
  assertEquals(r.status, 200);
  assertEquals(calls.some((c) => c.method === "cancelSubscription"), false);
  const succeeded = events.find((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "succeeded"
  );
  assert(succeeded !== undefined, "attempt not marked succeeded");
});

Deno.test("stale pending attempts are expired before reserving", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: null, stalePending: [{ id: "stale-1", pagarme_subscription_id: null }] },
    { subStatus: "active" },
  );
  await result;
  const expire = events.findIndex((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "expired"
  );
  const reserve = events.findIndex((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert");
  assert(expire !== -1, "expiry sweep missing");
  assert(reserve !== -1, "reservation missing");
  assert(expire < reserve, "expiry must run before the reservation");
  const expireEv = events[expire];
  assert(
    expireEv.filters.some(([m, c, v]) => m === "eq" && c === "state" && v === "pending"),
    "expire update must be pinned to state='pending'",
  );
});

Deno.test("stale attempt WITH a recorded sub id: cancel the orphan, then expire, then proceed", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null, stalePending: [{ id: "stale-1", pagarme_subscription_id: "sub_orphan" }] },
    { subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(calls[0].method, "cancelSubscription");
  assertEquals(calls[0].args[0], "sub_orphan");
  const expire = events.findIndex((e) =>
    e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "expired"
  );
  const reserve = events.findIndex((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert");
  assert(expire !== -1 && reserve !== -1 && expire < reserve);
});

Deno.test("stale orphan cancel fails with network error: 409, reservation kept, nothing else runs", async () => {
  const { events, calls, result } = run(
    {
      plan: PLAN,
      subRow: null,
      stalePending: [{ id: "stale-1", pagarme_subscription_id: "sub_orphan" }],
    },
    { failCancel: true, failCancelWith: new Error("timeout") },
  );
  const r = await result;
  assertEquals(r.status, 409);
  assertEquals(calls.filter((c) => c.method !== "cancelSubscription").length, 0, "no create-side gateway calls");
  assertEquals(events.filter((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert").length, 0, "no new reservation");
  assertEquals(
    events.filter((e) => e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "expired").length,
    0,
    "stale attempt must remain pending",
  );
});

Deno.test("stale orphan cancel 4xx (already canceled or gone): treated as settled, expire and proceed", async () => {
  const { result } = run(
    { plan: PLAN, subRow: null, stalePending: [{ id: "stale-1", pagarme_subscription_id: "sub_orphan" }] },
    { failCancel: true, failCancelWith: new PagarmeApiError(404, null), subStatus: "active" },
  );
  const r = await result;
  assertEquals(r.status, 200);
});
