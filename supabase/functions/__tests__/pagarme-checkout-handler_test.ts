import { assert, assertEquals } from "./assert.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import { createPagarmeCheckoutHandler } from "../pagarme-checkout/handler.ts";
import { PagarmeGateway, PagarmeSubscriptionResponse } from "../pagarme-checkout/gateway.ts";
import { PagarmeCheckoutRequest } from "../pagarme-checkout/logic.ts";
import { StripeSwitchGateway } from "../_shared/stripe-switch.ts";

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
  isSwitch: false,
};

const PLAN = {
  id: "start",
  price_brl_annual: 95900,
  pagarme_12x_enabled: true,
  pagarme_plan_id_annual: "plan_remote_1",
  // The parcela has its own (higher, financing-inclusive) price: 9490 * 12 = 113880, not the
  // à vista annual total (95900). This is the whole point of Fase 8.
  pagarme_installment_cents: 9490,
};

const SWITCH_REQ: PagarmeCheckoutRequest = { ...REQ, isSwitch: true };
const STRIPE_ROW = {
  provider: "stripe",
  stripe_subscription_id: "sub_s1",
  pagarme_customer_id: null,
  pagarme_subscription_id: null,
  status: "active",
  cancel_at_period_end: false,
  current_period_end: "2026-09-15T14:23:11Z",
  ever_subscribed_at: "2026-01-01T00:00:00Z",
  billing_interval: "month",
  plan_id: "start",
};
const WS_ROW = { plan_id: "start", plan_source: "system" };

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
  /** Linha devolvida pelo read de workspaces do PASSO 3b do switch (plan_id + plan_source)
   * e pelo read do plan-writer (que so olha plan_source). */
  workspaceRow?: { plan_id?: string | null; plan_source: string };
  /** True = existe attempt quarantined para o workspace (gate amigavel da decisao 10). */
  quarantinedAttempt?: boolean;
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
    chain.limit = () => chain;
    chain.abortSignal = () => chain;
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
        if (filters.some(([m, c, v]) => m === "eq" && c === "state" && v === "quarantined")) {
          return { data: fx.quarantinedAttempt ? { id: "at-q" } : null, error: null };
        }
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
        return { data: fx.workspaceRow ?? { plan_source: "system" }, error: null };
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
  /** `items` on the createSubscription response (truthful-mirror rule). Omitted by default,
   * matching a response with no usable observed price -> the fallback path. `price` is
   * loosely typed so malformed-payload tests can pass a non-numeric value on purpose. */
  subItems?: Array<{ pricing_scheme?: { price?: unknown } | null } | null>;
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
        ...(fx.subItems !== undefined
          ? { items: fx.subItems as unknown as PagarmeSubscriptionResponse["items"] }
          : {}),
      });
    },
    cancelSubscription: (id) => {
      record("cancelSubscription", [id]);
      if (fx.failCancel) throw fx.failCancelWith ?? new Error("cancel boom");
      return Promise.resolve();
    },
  };
}

// Fronteira do mensal de teste: 2026-09-15T14:23:11Z -> ceil = "2026-09-16".
const STRIPE_BOUNDARY_UNIX = Math.floor(Date.parse("2026-09-15T14:23:11Z") / 1000);
const STRIPE_SUB_MONTHLY = {
  status: "active",
  cancel_at_period_end: false,
  current_period_end: STRIPE_BOUNDARY_UNIX,
  items: { data: [{ price: { id: "price_m1", recurring: { interval: "month" } } }] },
};

function makeStripeSwitch(fx: {
  calls: Array<{ method: string; args: unknown[] }>;
  retrieveResult?: unknown;
  retrieveThrows?: unknown;
  /** Lanca em setCancelAtPeriodEnd(id, true) (a perna do switch). */
  setCancelTrueThrows?: unknown;
  /** Lanca em setCancelAtPeriodEnd(id, false). */
  setCancelFalseThrows?: unknown;
}): StripeSwitchGateway {
  const record = (method: string, args: unknown[]) => fx.calls.push({ method, args });
  return {
    retrieveSubscription: (id) => {
      record("retrieveSubscription", [id]);
      if (fx.retrieveThrows) return Promise.reject(fx.retrieveThrows);
      return Promise.resolve(fx.retrieveResult ?? STRIPE_SUB_MONTHLY);
    },
    setCancelAtPeriodEnd: (id, value) => {
      record("setCancelAtPeriodEnd", [id, value]);
      if (value === true && fx.setCancelTrueThrows) return Promise.reject(fx.setCancelTrueThrows);
      if (value === false && fx.setCancelFalseThrows) return Promise.reject(fx.setCancelFalseThrows);
      return Promise.resolve();
    },
    cancelNow: (id) => {
      record("cancelNow", [id]);
      return Promise.resolve();
    },
    fetchAmount: (id) => {
      record("fetchAmount", [id]);
      return Promise.resolve({
        amount_cents: 9990,
        gross_cents: null,
        currency: "brl",
        interval: "month",
        discount_label: null,
        livemode: false,
      });
    },
  };
}

function run(
  dbFx: Omit<Parameters<typeof makeDb>[0], "events">,
  gwFx: Omit<Parameters<typeof makeGateway>[0], "calls"> = {},
  swFx?: Omit<Parameters<typeof makeStripeSwitch>[0], "calls"> | null,
  req: PagarmeCheckoutRequest = REQ,
) {
  const events: Ev[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stripeCalls: Array<{ method: string; args: unknown[] }> = [];
  const handle = createPagarmeCheckoutHandler({
    db: makeDb({ ...dbFx, events }),
    gateway: makeGateway({ ...gwFx, calls }),
    now: () => NOW,
    stripeSwitch: swFx === null ? null : makeStripeSwitch({ ...(swFx ?? {}), calls: stripeCalls }),
  });
  return { events, calls, stripeCalls, result: handle(CTX, req) };
}

/** Patches console.error/warn for the duration of `fn`, capturing every call as a joined
 * string (house pattern, see pagarme-webhook-handler_test.ts's withConsoleErrorSpy). */
async function withConsoleSpies<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; errors: string[]; warnings: string[] }> {
  const originalError = console.error;
  const originalWarn = console.warn;
  const errors: string[] = [];
  const warnings: string[] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const result = await fn();
    return { result, errors, warnings };
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
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

Deno.test("unconfigured parcela (null pagarme_installment_cents): 400 plan_not_configured before any remote call", async () => {
  const { events, calls, result } = run({ plan: { ...PLAN, pagarme_installment_cents: null } });
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "plan_not_configured");
  assertEquals(calls.length, 0);
  assertEquals(events.filter((e) => e.table === "pagarme_checkout_attempts").length, 0);
});

Deno.test("unconfigured parcela (<=0 pagarme_installment_cents): 400 plan_not_configured before any remote call", async () => {
  for (const badValue of [0, -1]) {
    const { calls, result } = run({ plan: { ...PLAN, pagarme_installment_cents: badValue } });
    const r = await result;
    assertEquals(r.status, 400, `parcela ${badValue}`);
    assertEquals((r.body as { code: string }).code, "plan_not_configured", `parcela ${badValue}`);
    assertEquals(calls.length, 0, `parcela ${badValue}`);
  }
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
    installment_amount_cents: 9490,
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

  // Single-statement invariant: provider flip and amount mirror in the SAME payload. No
  // observed price on this fixture's response -> the mirror falls back to the configured
  // parcela * 12 (9490 * 12 = 113880), NOT price_brl_annual (the à vista price).
  const bind = events[rowBind].values as Record<string, unknown>;
  assertEquals(bind.provider, "pagarme");
  assertEquals(bind.amount_cents, 113880);
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

Deno.test("trial path: fresh workspace gets start_at ceiled to the next UTC midnight, status future maps to trialing, bind is an INSERT", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: null },
    { subStatus: "future", subStartAt: "2026-09-12T00:00:00Z" },
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    status: "trialing",
    trial_ends_at: "2026-09-12T00:00:00Z",
    next_charge_at: "2026-09-12T00:00:00Z",
    installment_amount_cents: 9490,
  });
  const subInput = calls[2].args[0] as Record<string, unknown>;
  // NOW is 12:00Z: +30d rounds UP, never a short trial
  assertEquals(subInput.start_at, "2026-09-12");
  // No row observed at gate time → plain INSERT (a concurrent create surfaces as 23505,
  // never as a silent overwrite), carrying provider + mirror in the same payload.
  const ins = events.find((e) => e.table === "workspace_subscriptions" && e.op === "insert");
  assert(ins !== undefined, "insert bind missing");
  assertEquals((ins.values as Record<string, unknown>).provider, "pagarme");
  assertEquals((ins.values as Record<string, unknown>).amount_cents, 113880);
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

// ─── TRUTHFUL-MIRROR RULE (Fase 8) ──────────────────────────────────────────

Deno.test("observed gateway total wins and differs from configured: mirror + response use the OBSERVED total, CRITICAL logged, still 200", async () => {
  const { errors, warnings, result } = await withConsoleSpies(async () => {
    const { events, result } = run(
      { plan: PLAN, subRow: null },
      // Configured parcela*12 = 9490*12 = 113880; the gateway's plan object actually charges
      // 155880 (as if it were mistakenly left at the "pro" total) -> drift.
      { subStatus: "active", nextBillingAt: "2027-08-12T00:00:00Z", subItems: [{ pricing_scheme: { price: 155880 } }] },
    );
    const r = await result;
    return { r, events };
  });
  const { r, events } = result;
  assertEquals(r.status, 200);
  assertEquals((r.body as { installment_amount_cents: number }).installment_amount_cents, 12990); // round(155880/12)
  const bind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "insert");
  assert(bind !== undefined, "insert bind missing");
  assertEquals((bind.values as Record<string, unknown>).amount_cents, 155880);
  assert(
    errors.some((m) => m.includes("CRITICAL") && m.includes("price drift")),
    "drift must be logged CRITICAL",
  );
  assertEquals(warnings.length, 0, "no fallback WARN when the observed price is usable");
});

Deno.test("observed gateway total present but matches configured: no drift log, mirror uses it anyway", async () => {
  const { errors, result } = await withConsoleSpies(async () => {
    const { events, result } = run(
      { plan: PLAN, subRow: null },
      { subStatus: "active", subItems: [{ pricing_scheme: { price: 113880 } }] }, // == 9490 * 12
    );
    const r = await result;
    return { r, events };
  });
  const { r, events } = result;
  assertEquals(r.status, 200);
  assertEquals((r.body as { installment_amount_cents: number }).installment_amount_cents, 9490);
  const bind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "insert");
  assertEquals((bind?.values as Record<string, unknown>).amount_cents, 113880);
  assertEquals(errors.some((m) => m.includes("CRITICAL")), false, "no drift, no CRITICAL log");
});

Deno.test("observed price missing (no items on the response): fallback to parcela*12, WARN logged", async () => {
  const { warnings, result } = await withConsoleSpies(async () => {
    const { events, result } = run(
      { plan: PLAN, subRow: null },
      { subStatus: "active" }, // no subItems -> no items key on the response at all
    );
    const r = await result;
    return { r, events };
  });
  const { r, events } = result;
  assertEquals(r.status, 200);
  assertEquals((r.body as { installment_amount_cents: number }).installment_amount_cents, 9490);
  const bind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "insert");
  assertEquals((bind?.values as Record<string, unknown>).amount_cents, 113880);
  assert(
    warnings.some((m) => m.includes("observed price")),
    "the fallback path must WARN",
  );
});

Deno.test("observed price malformed (non-numeric): fallback to parcela*12, WARN logged", async () => {
  const { warnings, result } = await withConsoleSpies(async () => {
    const { events, result } = run(
      { plan: PLAN, subRow: null },
      { subStatus: "active", subItems: [{ pricing_scheme: { price: "not-a-number" } }] },
    );
    const r = await result;
    return { r, events };
  });
  const { r, events } = result;
  assertEquals(r.status, 200);
  assertEquals((r.body as { installment_amount_cents: number }).installment_amount_cents, 9490);
  const bind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "insert");
  assertEquals((bind?.values as Record<string, unknown>).amount_cents, 113880);
  assert(warnings.some((m) => m.includes("observed price")), "the fallback path must WARN");
});

Deno.test("stale orphan cancel 401/403/429: reservation kept (says nothing about the subscription)", async () => {
  for (const status of [401, 403, 429]) {
    const { events, result } = run(
      { plan: PLAN, subRow: null, stalePending: [{ id: "stale-1", pagarme_subscription_id: "sub_orphan" }] },
      { failCancel: true, failCancelWith: new PagarmeApiError(status, null) },
    );
    const r = await result;
    assertEquals(r.status, 409, `status ${status}`);
    assertEquals(
      events.filter((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert").length,
      0,
      `no new reservation for ${status}`,
    );
  }
});

// ─── Switch mensal Stripe -> 12x: gates pre-reserva (Fase 5) ───────────────

Deno.test("switch: linha stripe active elegivel passa do gate e chega na reserva", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 200);
  assert(events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: linha inelegivel (past_due) -> 409 switch_not_eligible, zero remoto, zero reserva", async () => {
  const { events, calls, stripeCalls, result } = run(
    { plan: PLAN, subRow: { ...STRIPE_ROW, status: "past_due" }, workspaceRow: WS_ROW },
    {},
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals((res.body as { code?: string }).code, "switch_not_eligible");
  assertEquals(calls.length, 0);
  assertEquals(stripeCalls.length, 0);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: stripeSwitch null (env dark) -> 500, zero reserva", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    {},
    null,
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 500);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: verify remoto diz anual -> 409 antes da reserva", async () => {
  const annual = {
    ...STRIPE_SUB_MONTHLY,
    items: { data: [{ price: { id: "p_y", recurring: { interval: "year" } } }] },
  };
  const { events, calls, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    {},
    { retrieveResult: annual },
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals(calls.length, 0);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: fronteira remota ja passada -> 409 com copy de renovacao", async () => {
  const elapsed = { ...STRIPE_SUB_MONTHLY, current_period_end: Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000) };
  const { result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    {},
    { retrieveResult: elapsed },
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals(
    (res.body as { error?: string }).error,
    "Sua renovação está em processamento. Tente novamente em alguns minutos.",
  );
});

Deno.test("switch: retrieve remoto lanca -> 500, zero reserva", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    {},
    { retrieveThrows: new Error("stripe down") },
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 500);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("switch: plan_source manual -> 409 pre-reserva (decisao 11)", async () => {
  const { result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: { plan_id: "pro", plan_source: "manual" } },
    {},
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
});

Deno.test("switch: plano-fonte prefere workspaces.plan_id; row.plan_id e fallback", async () => {
  // workspaces.plan_id=pro, row.plan_id=start -> marker de plano deve ser pro (Task 6 asserta
  // o bind; aqui so garante que NAO 409a e diverge com log)
  const { result } = await (async () => {
    const r = run(
      { plan: PLAN, subRow: { ...STRIPE_ROW, plan_id: "start" }, workspaceRow: { plan_id: "pro", plan_source: "system" } },
      { subStatus: "future", subStartAt: "2026-09-16" },
      {},
      SWITCH_REQ,
    );
    return { result: await r.result };
  })();
  assertEquals(result.status, 200);
});

Deno.test("switch: ambos os planos-fonte null -> 409 pre-reserva", async () => {
  const { events, result } = run(
    { plan: PLAN, subRow: { ...STRIPE_ROW, plan_id: null }, workspaceRow: { plan_id: null, plan_source: "system" } },
    {},
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("quarentena existente -> 409 antes da reserva (qualquer request, nao so switch)", async () => {
  const { events, result } = run({ plan: PLAN, subRow: null, quarantinedAttempt: true });
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals((res.body as { code?: string }).code, "quarantined");
  assert(!events.some((e) => e.table === "pagarme_checkout_attempts" && e.op === "insert"));
});

Deno.test("regressao: nao-switch continua 409 em linha stripe in-force", async () => {
  const { result } = run({ plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW });
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals((res.body as { error?: string }).error, "Este workspace já tem uma assinatura vigente.");
});

// ─── Switch mensal Stripe -> 12x: criacao (Task 6) ─────────────────────────

Deno.test("switch happy path: start_at da fronteira, CAS com pin de status + markers, response switched", async () => {
  const { events, calls, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 200);
  const body = res.body as Record<string, unknown>;
  assertEquals(body.status, "trialing");
  assertEquals(body.trial_ends_at, null); // switch nunca fala de trial
  assertEquals(body.switched, true);
  assertEquals(body.first_charge_at, "2026-09-16");
  assertEquals(body.next_charge_at, "2026-09-16");

  // start_at enviado ao gateway = ceil da fronteira Stripe (14:23Z -> dia seguinte)
  const createCall = calls.find((c) => c.method === "createSubscription")!;
  const subInput = createCall.args[0] as Record<string, unknown>;
  assertEquals(subInput.start_at, "2026-09-16");

  // CAS: pins existentes + pin extra de status + markers no MESMO payload
  const bind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assert(bind.filters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "stripe"));
  assert(
    bind.filters.some(([m, c, v]) => m === "eq" && c === "stripe_subscription_id" && v === "sub_s1"),
  );
  assert(bind.filters.some(([m, c, v]) => m === "eq" && c === "status" && v === "active"));
  assertEquals(bind.values?.switched_from_stripe_subscription_id, "sub_s1");
  assertEquals(bind.values?.switched_from_plan_id, "start");
  assertEquals(bind.values?.switch_checked_at, null);
});

Deno.test("switch: nunca chama resolveTrialDays (sem start_at de trial mesmo se nunca assinou)", async () => {
  // Linha stripe sem ever_subscribed_at nao existe na pratica (o id ja implica), mas o pin
  // aqui e: o start_at do switch vem SEMPRE da fronteira, nunca de now+30d.
  const { calls, result } = run(
    { plan: PLAN, subRow: { ...STRIPE_ROW, ever_subscribed_at: null }, workspaceRow: WS_ROW },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  await result;
  const subInput = calls.find((c) => c.method === "createSubscription")!.args[0] as Record<string, unknown>;
  assertEquals(subInput.start_at, "2026-09-16"); // e nao "2026-09-11" (now+30d)
});

Deno.test("switch born-active: cancel remoto + attempt QUARANTINED + 500", async () => {
  const { result } = await withConsoleSpies(async () => {
    const { events, calls, result } = run(
      { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW },
      { subStatus: "active" },
      {},
      SWITCH_REQ,
    );
    const r = await result;
    return { r, events, calls };
  });
  const { r, events, calls } = result;
  assertEquals(r.status, 500);
  assert(calls.some((c) => c.method === "cancelSubscription"));
  const quarantineWrite = events.find(
    (e) => e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "quarantined",
  );
  assert(quarantineWrite, "attempt deve virar quarantined, nunca failed");
  assert(!events.some(
    (e) => e.table === "pagarme_checkout_attempts" && e.op === "update" && e.values?.state === "failed",
  ));
});

Deno.test("switch: CAS zero rows (webhook concorrente mudou status) -> compensa + 409", async () => {
  const { calls, result } = run(
    { plan: PLAN, subRow: STRIPE_ROW, workspaceRow: WS_ROW, bindZeroRows: true },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 409);
  assert(calls.some((c) => c.method === "cancelSubscription"));
});

Deno.test("switch com price legado: billing_interval null passa e o marker persiste o plano-fonte", async () => {
  const { events, result } = run(
    {
      plan: PLAN,
      subRow: { ...STRIPE_ROW, billing_interval: null, plan_id: null },
      workspaceRow: { plan_id: "start", plan_source: "system" },
    },
    { subStatus: "future", subStartAt: "2026-09-16" },
    {},
    SWITCH_REQ,
  );
  const res = await result;
  assertEquals(res.status, 200);
  const bind = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(bind.values?.switched_from_plan_id, "start");
});
