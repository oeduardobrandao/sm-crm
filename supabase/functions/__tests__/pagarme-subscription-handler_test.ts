// Handler tests for pagarme-subscription. Fake-db pattern mirrors the house style established
// by pagarme-checkout-handler_test.ts: a thenable chain that records {table, op, filters,
// values, abortSignal} per call, in call order, and resolves per-table/op fixtures. The `rpc`
// recorder shape (for grant_pagarme_plan) is copied from pagarme-webhook-handler_test.ts.

import { assert, assertEquals } from "./assert.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import { StripeSwitchGateway } from "../_shared/stripe-switch.ts";
import { handleSubscriptionAction } from "../pagarme-subscription/handler.ts";
import { PagarmeSubscriptionGateway } from "../pagarme-subscription/gateway.ts";
import { SubscriptionAction } from "../pagarme-subscription/logic.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const WS = "22222222-2222-2222-2222-222222222222";
const SUB = "sub_1";

type Ev = {
  op: string;
  table: string;
  values?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
  abortSignal: boolean;
};

const ADDRESS = { cep: "01310100", line1: "Av. Paulista, 1000", city: "São Paulo", state: "SP" };

interface DbFx {
  subRow?: Record<string, unknown> | null;
  subRowError?: { message: string } | null;
  casZeroRows?: boolean;
  casError?: { message: string } | null;
  defaultPlan?: { id: string } | null;
  rpcResult?: number | null;
  rpcError?: { message: string } | null;
  /** Fallback price rows for the plans-table read WITHOUT an is_default filter (undo's
   * resolvePlanFromPriceId source), distinct from getDefaultPlanId's is_default read above. */
  planPriceRows?: Array<{ id: string; stripe_price_id: string | null; stripe_price_id_annual: string | null }>;
  /** Second read of workspace_subscriptions (the undo's zero-rows re-read). */
  reReadRow?: Record<string, unknown> | null;
  /** Second update of workspace_subscriptions (the undo's retry pinned on status=canceled). */
  secondCasZeroRows?: boolean;
  /** workspaces read for the plan-writer (writeWorkspacePlan's manual-comp guard). */
  workspaceRow?: { plan_source: string };
}

function makeDb(fx: DbFx & { events: Ev[] }): SupabaseClient {
  let subReads = 0;
  let subUpdates = 0;
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
      fx.events.push({ table, op, values, filters, abortSignal: sawAbortSignal });
      if (table === "workspace_subscriptions" && op === "read") {
        subReads++;
        if (subReads === 1) {
          return { data: fx.subRow === undefined ? null : fx.subRow, error: fx.subRowError ?? null };
        }
        return { data: fx.reReadRow === undefined ? null : fx.reReadRow, error: null };
      }
      if (table === "workspace_subscriptions" && op === "update") {
        subUpdates++;
        if (subUpdates === 1) {
          return {
            data: fx.casZeroRows ? [] : [{ workspace_id: WS }],
            error: fx.casError ?? null,
          };
        }
        return {
          data: fx.secondCasZeroRows ? [] : [{ workspace_id: WS }],
          error: null,
        };
      }
      if (table === "plans") {
        if (filters.some(([m, c]) => m === "eq" && c === "is_default")) {
          return { data: fx.defaultPlan === undefined ? { id: "free" } : fx.defaultPlan, error: null };
        }
        return { data: fx.planPriceRows ?? [], error: null };
      }
      if (table === "workspaces" && op === "read") {
        return { data: fx.workspaceRow ?? { plan_source: "system" }, error: null };
      }
      if (table === "workspaces" && op === "update") {
        return { data: null, error: null };
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
      fx.events.push({ table: `rpc:${fn}`, op: "rpc", values: params, filters: [], abortSignal: sawAbortSignal });
      return { data: fx.rpcResult === undefined ? 1 : fx.rpcResult, error: fx.rpcError ?? null };
    };
    rchain.then = (
      onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(rsettle()).then(onFulfilled, onRejected);
    return rchain;
  };
  return { from, rpc } as unknown as SupabaseClient;
}

function makeGateway(fx: {
  calls: Array<{ method: string; args: unknown[] }>;
  cancelResult?: { current_cycle?: { end_at?: string | null } | null } | null;
  cancelThrows?: unknown;
  attachThrows?: unknown;
  swapThrows?: unknown;
}): PagarmeSubscriptionGateway {
  const record = (method: string, args: unknown[]) => fx.calls.push({ method, args });
  return {
    cancelSubscription: (subId) => {
      record("cancelSubscription", [subId]);
      if (fx.cancelThrows) return Promise.reject(fx.cancelThrows);
      return Promise.resolve(fx.cancelResult === undefined ? null : fx.cancelResult);
    },
    attachCard: (customerId, token, address) => {
      record("attachCard", [customerId, token, address]);
      if (fx.attachThrows) return Promise.reject(fx.attachThrows);
      return Promise.resolve({ id: "card_new" });
    },
    updateSubscriptionCard: (subId, cardId) => {
      record("updateSubscriptionCard", [subId, cardId]);
      if (fx.swapThrows) return Promise.reject(fx.swapThrows);
      return Promise.resolve({});
    },
  };
}

// Fronteira do mensal de teste: 2026-09-15T14:23:11Z -> ceil = "2026-09-16" (mesmo fixture da
// Task 5, copiado -- os arquivos de teste Deno nao compartilham helpers entre si neste repo).
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
  /** Lanca em setCancelAtPeriodEnd(id, true) (o rearme). */
  setCancelTrueThrows?: unknown;
  /** Lanca em setCancelAtPeriodEnd(id, false) (a reativacao). */
  setCancelFalseThrows?: unknown;
  amountThrows?: unknown;
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
      if (fx.amountThrows) return Promise.reject(fx.amountThrows);
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
  gwFx: Omit<Parameters<typeof makeGateway>[0], "calls">,
  action: SubscriptionAction,
  swFx?: Omit<Parameters<typeof makeStripeSwitch>[0], "calls"> | null,
) {
  const events: Ev[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stripeCalls: Array<{ method: string; args: unknown[] }> = [];
  const result = handleSubscriptionAction(
    {
      db: makeDb({ ...dbFx, events }),
      gateway: makeGateway({ ...gwFx, calls }),
      // 3-arg calls (existing tests) never wire a Stripe gateway: they must never reach a
      // real undo path. Only a 4th arg (even `{}`) wires the fake; an explicit `null` also
      // stays null (the dedicated "no gateway configured" test says so with intent).
      stripeSwitch: swFx == null ? null : makeStripeSwitch({ ...swFx, calls: stripeCalls }),
      now: () => NOW,
    },
    { workspaceId: WS },
    action,
  );
  return { events, calls, stripeCalls, result };
}

function findCasUpdate(events: Ev[]): Ev | undefined {
  return events.find((e) => e.table === "workspace_subscriptions" && e.op === "update");
}

function findPlanGrant(events: Ev[]): Ev | undefined {
  return events.find((e) => e.table === "rpc:grant_pagarme_plan" && e.op === "rpc");
}

const CANCEL: SubscriptionAction = { action: "cancel" };
const UPDATE_CARD: SubscriptionAction = {
  action: "update_card",
  cardToken: "tok_1",
  billingAddress: ADDRESS,
};

// Janela de switch (marker + trialing): a linha local que o undo opera em cima.
const SWITCH_WINDOW_ROW = {
  provider: "pagarme",
  pagarme_customer_id: "cus_1",
  pagarme_subscription_id: SUB,
  status: "trialing",
  cancel_at_period_end: false,
  current_period_end: "2026-09-16T00:00:00Z",
  switched_from_stripe_subscription_id: "sub_s1",
  switched_from_plan_id: "start",
  // Codex P1-2: cap_end observado da fonte no momento do switch. false = fonte NAO estava em
  // churn, entao o undo reativa (comportamento pre-existente de todos os testes abaixo que
  // usam esta fixture sem sobrescrever o campo).
  switched_from_cancel_at_period_end: false,
};

// ─── cancel ──────────────────────────────────────────────────────────────

Deno.test("cancel trialing: gateway DELETE called, CAS pinned on provider/sub_id/status=trialing, columns and 200 with null access_until", async () => {
  const { events, calls, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "trialing", current_period_end: null } },
    {},
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "canceled", access_until: null });
  assertEquals(calls.map((c) => c.method), ["cancelSubscription"]);
  assertEquals(calls[0].args[0], SUB);

  const cas = findCasUpdate(events);
  assert(cas !== undefined, "CAS update missing");
  assertEquals(cas.values, { status: "canceled", cancel_at_period_end: false, updated_at: NOW.toISOString() });
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "pagarme"));
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "pagarme_subscription_id" && v === SUB));
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "status" && v === "trialing"));

  const grant = findPlanGrant(events);
  assert(grant !== undefined, "plan grant missing");
  assertEquals(grant.values, { p_workspace: WS, p_plan: "free", p_sub: SUB, p_status: "canceled" });
});

Deno.test("cancel active with stored current_period_end: paid-through, no current_period_end in payload, no rpc, access_until = stored", async () => {
  const { events, result } = run(
    {
      subRow: {
        provider: "pagarme",
        pagarme_subscription_id: SUB,
        status: "active",
        current_period_end: "2027-01-01T00:00:00.000Z",
      },
    },
    {},
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "canceled", access_until: "2027-01-01T00:00:00.000Z" });
  const cas = findCasUpdate(events);
  assert(cas !== undefined);
  assertEquals(cas.values, { status: "canceled", cancel_at_period_end: true, updated_at: NOW.toISOString() });
  assert(!("current_period_end" in (cas.values ?? {})), "current_period_end must not be written when stored already had it");
  assertEquals(findPlanGrant(events), undefined, "paid-through cancel must not grant a plan");
});

Deno.test("cancel active with an ELAPSED stored current_period_end: no provable paid window, grant RPC IS called, access_until null", async () => {
  const { events, result } = run(
    {
      subRow: {
        provider: "pagarme",
        pagarme_subscription_id: SUB,
        status: "active",
        current_period_end: "2026-01-01T00:00:00.000Z", // before NOW (2026-08-13)
      },
    },
    {},
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "canceled", access_until: null });
  assertEquals(findPlanGrant(events)?.values, { p_workspace: WS, p_plan: "free", p_sub: SUB, p_status: "canceled" });
});

Deno.test("cancel active with NULL stored end + DELETE response carrying current_cycle.end_at: paid-through, FILLS current_period_end, no rpc", async () => {
  const { events, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "active", current_period_end: null } },
    { cancelResult: { current_cycle: { end_at: "2027-03-01T00:00:00.000Z" } } },
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "canceled", access_until: "2027-03-01T00:00:00.000Z" });
  const cas = findCasUpdate(events);
  assert(cas !== undefined);
  assertEquals(cas.values, {
    status: "canceled",
    cancel_at_period_end: true,
    updated_at: NOW.toISOString(),
    current_period_end: "2027-03-01T00:00:00.000Z",
  });
  assertEquals(findPlanGrant(events), undefined);
});

Deno.test("cancel active with NULL stored end + DELETE response without a cycle end: immediate downgrade, rpc called, access_until null", async () => {
  const { events, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "active", current_period_end: null } },
    { cancelResult: null },
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "canceled", access_until: null });
  assertEquals(findPlanGrant(events)?.values, { p_workspace: WS, p_plan: "free", p_sub: SUB, p_status: "canceled" });
});

Deno.test("cancel past_due: immediate downgrade, rpc called", async () => {
  const { events, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "past_due", current_period_end: "2027-01-01T00:00:00.000Z" } },
    {},
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "canceled", access_until: null });
  assertEquals(findPlanGrant(events)?.values, { p_workspace: WS, p_plan: "free", p_sub: SUB, p_status: "canceled" });
});

Deno.test("remote DELETE throws definitive 404: proceeds with local write, success", async () => {
  const { events, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "trialing", current_period_end: null } },
    { cancelThrows: new PagarmeApiError(404, null) },
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "canceled", access_until: null });
  assert(findCasUpdate(events) !== undefined, "local write must still happen");
});

Deno.test("remote DELETE throws 500: returns 500, NO local write events", async () => {
  const { events, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "trialing", current_period_end: null } },
    { cancelThrows: new PagarmeApiError(500, null) },
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 500);
  assertEquals((r.body as { code: string }).code, "gateway_error");
  assertEquals(events.filter((e) => e.table === "workspace_subscriptions" && e.op === "update").length, 0);
  assertEquals(findPlanGrant(events), undefined);
});

Deno.test("CAS zero rows: warn path, no rpc, still 200", async () => {
  const { events, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "trialing", current_period_end: null }, casZeroRows: true },
    {},
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { status: "canceled", access_until: null });
  assertEquals(findPlanGrant(events), undefined);
});

Deno.test("rpc error: throws", async () => {
  const { result } = run(
    {
      subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "trialing", current_period_end: null },
      rpcError: { message: "deadlock detected" },
    },
    {},
    CANCEL,
  );
  let threw = false;
  try {
    await result;
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("no row / provider stripe / null sub id: 404, no gateway calls", async () => {
  const cases: Array<[string, Record<string, unknown> | null]> = [
    ["no row", null],
    // status "canceled" (not in-force): keeps this a genuine "no pagarme subscription" 404,
    // distinct from the decision-9 idempotency no-op (200 reverted) covered separately below,
    // which owns the in-force stripe-without-pagarme-id case.
    ["provider stripe", { provider: "stripe", pagarme_subscription_id: null, status: "canceled" }],
    ["null sub id", { provider: "pagarme", pagarme_subscription_id: null, status: "active" }],
  ];
  for (const [label, subRow] of cases) {
    const { calls, result } = run({ subRow }, {}, CANCEL);
    const r = await result;
    assertEquals(r.status, 404, label);
    assertEquals(calls.length, 0, label);
  }
});

Deno.test("status canceled: 409, no gateway calls", async () => {
  const { calls, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "canceled", current_period_end: null } },
    {},
    CANCEL,
  );
  const r = await result;
  assertEquals(r.status, 409);
  assertEquals(calls.length, 0);
});

// ─── decisao 9: idempotencia do undo + roteamento ──────────────────────────

Deno.test("idempotencia (decisao 9): linha stripe in-force sem pagarme id -> 200 reverted", async () => {
  const { result } = run(
    {
      subRow: {
        provider: "stripe",
        pagarme_customer_id: null,
        pagarme_subscription_id: null,
        status: "active",
        cancel_at_period_end: false,
        current_period_end: "2026-09-15T14:23:11Z",
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals(res.body, { status: "reverted", access_until: "2026-09-15T14:23:11Z" });
});

Deno.test("idempotencia: assinatura Stripe comum que NUNCA fez switch tambem recebe o no-op 200 (amplitude deliberada, antes 404)", async () => {
  const { events, result } = run(
    {
      subRow: {
        provider: null, // legado = stripe
        pagarme_customer_id: null,
        pagarme_subscription_id: null,
        status: "trialing",
        cancel_at_period_end: false,
        current_period_end: null,
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
  // no-op de verdade: nenhum write
  assert(!events.some((e) => e.op === "update"));
});

Deno.test("idempotencia NAO se aplica a update_card nem a linha stripe fora de vigor", async () => {
  const deadRow = {
    provider: "stripe",
    pagarme_customer_id: null,
    pagarme_subscription_id: null,
    status: "canceled",
    cancel_at_period_end: false,
    current_period_end: null,
    switched_from_stripe_subscription_id: null,
    switched_from_plan_id: null,
  };
  const r1 = await run({ subRow: deadRow }, {}, { action: "cancel" }).result;
  assertEquals(r1.status, 404);
  const r2 = await run(
    { subRow: { ...deadRow, status: "active" } },
    {},
    { action: "update_card", cardToken: "t", billingAddress: ADDRESS },
  ).result;
  assertEquals(r2.status, 404);
});

Deno.test("roteamento: marker + trialing vai para o undo, nunca para buildCancelColumns", async () => {
  const { calls, result } = run(
    {
      subRow: {
        provider: "pagarme",
        pagarme_customer_id: "cus_1",
        pagarme_subscription_id: SUB,
        status: "trialing",
        cancel_at_period_end: false,
        current_period_end: "2026-09-16T00:00:00Z",
        switched_from_stripe_subscription_id: "sub_s1",
        switched_from_plan_id: "start",
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  // Sem o 4o arg, run() nao arma um stripeSwitch (existing-test default = null), entao o
  // undo real recusa de partida (UNDO_500 = 500). O pin aqui continua sendo o ROTEAMENTO:
  // o cancel comum (que chamaria cancelSubscription) NAO rodou.
  assertEquals(res.status, 500);
  assert(!calls.some((c) => c.method === "cancelSubscription"));
});

Deno.test("regressao: cancel sem marker segue o fluxo comum (trialing = downgrade imediato)", async () => {
  const { calls, result } = run(
    {
      subRow: {
        provider: "pagarme",
        pagarme_customer_id: "cus_1",
        pagarme_subscription_id: SUB,
        status: "trialing",
        cancel_at_period_end: false,
        current_period_end: null,
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "canceled");
  assert(calls.some((c) => c.method === "cancelSubscription"));
});

Deno.test("regressao: marker + ACTIVE segue o cancel comum paid-through (undo so na janela)", async () => {
  const { result } = run(
    {
      subRow: {
        provider: "pagarme",
        pagarme_customer_id: "cus_1",
        pagarme_subscription_id: SUB,
        status: "active",
        cancel_at_period_end: false,
        current_period_end: "2027-09-16T00:00:00Z",
        switched_from_stripe_subscription_id: "sub_s1",
        switched_from_plan_id: "start",
      },
    },
    {},
    { action: "cancel" },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "canceled");
});

// ─── undo do switch ─────────────────────────────────────────────────────

Deno.test("undo happy path: leituras -> cap_end=false -> CAS restaurando plan_id -> grant stripe -> DELETE -> reverted", async () => {
  const { events, calls, stripeCalls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals(res.body, { status: "reverted", access_until: "2026-09-15T14:23:11.000Z" });

  // ordem: retrieve e fetchAmount ANTES do setCancelAtPeriodEnd(false)
  const methods = stripeCalls.map((c) => c.method);
  const reactivateIdx = methods.indexOf("setCancelAtPeriodEnd");
  assert(methods.indexOf("retrieveSubscription") < reactivateIdx);
  assert(methods.indexOf("fetchAmount") < reactivateIdx);
  assertEquals(stripeCalls[reactivateIdx].args, ["sub_s1", false]);
  // toda chamada Stripe usa o MARKER (sub_s1), nunca o id da assinatura pagarme (SUB)
  assertEquals(stripeCalls.find((c) => c.method === "retrieveSubscription")?.args, ["sub_s1"]);
  assertEquals(stripeCalls.find((c) => c.method === "fetchAmount")?.args, ["sub_s1"]);

  // CAS: pins pagarme + sub + trialing; colunas restauram plan_id do marker e limpam tudo
  const cas = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "provider" && v === "pagarme"));
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "pagarme_subscription_id" && v === SUB));
  assert(cas.filters.some(([m, c, v]) => m === "eq" && c === "status" && v === "trialing"));
  assertEquals(cas.values?.provider, "stripe");
  assertEquals(cas.values?.plan_id, "start");
  assertEquals(cas.values?.pagarme_subscription_id, null);
  assertEquals(cas.values?.switched_from_stripe_subscription_id, null);
  assertEquals(cas.values?.switched_from_plan_id, null);
  assertEquals(cas.values?.switched_from_cancel_at_period_end, null);
  assertEquals(cas.values?.cancel_at_period_end, false);
  // mirror restaurado do fetchAmount (amount_cents 9990 no fake)
  assertEquals(cas.values?.amount_cents, 9990);

  // grant do plano-fonte via workspaces (plan-writer), plan_source stripe
  const planWrite = events.find((e) => e.table === "workspaces" && e.op === "update")!;
  assertEquals(planWrite.values?.plan_id, "start");
  assertEquals(planWrite.values?.plan_source, "stripe");

  // DELETE da future sub por ultimo
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === SUB));
});

// Codex P1-2: o undo restaura o cancel_at_period_end OBSERVADO da fonte, nao sempre false.
// Uma fonte ja em churn (decisao 7: switch a partir de um mensal com cancelamento agendado e
// permitido) volta EXATAMENTE como estava, ainda agendada para cancelar.
Deno.test("undo com fonte em churn (marker column true): restaura cancel_at_period_end=true em vez de reativar", async () => {
  const { events, stripeCalls, result } = run(
    { subRow: { ...SWITCH_WINDOW_ROW, switched_from_cancel_at_period_end: true } },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals(res.body, { status: "reverted", access_until: "2026-09-15T14:23:11.000Z" });

  const methods = stripeCalls.map((c) => c.method);
  const reactivateIdx = methods.indexOf("setCancelAtPeriodEnd");
  assertEquals(stripeCalls[reactivateIdx].args, ["sub_s1", true]);

  const cas = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(cas.values?.cancel_at_period_end, true);
  assertEquals(cas.values?.switched_from_cancel_at_period_end, null);
});

Deno.test("undo: stripeSwitch null -> 500 sem nada remoto/local", async () => {
  const { events, calls, result } = run({ subRow: SWITCH_WINDOW_ROW }, {}, { action: "cancel" }, null);
  const res = await result;
  assertEquals(res.status, 500);
  assertEquals(calls.length, 0);
  assert(!events.some((e) => e.op === "update"));
});

Deno.test("undo: cap_end=false falha -> rearme imediato cap_end=true + 500 sem writes locais", async () => {
  const { events, stripeCalls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { setCancelFalseThrows: new Error("timeout ambiguo") },
  );
  const res = await result;
  assertEquals(res.status, 500);
  const sets = stripeCalls.filter((c) => c.method === "setCancelAtPeriodEnd");
  assertEquals(sets.map((c) => c.args[1]), [false, true]); // tentativa + rearme
  assert(!events.some((e) => e.table === "workspace_subscriptions" && e.op === "update"));
});

Deno.test("undo: erro de DB no CAS -> compensacao cap_end=true + 500", async () => {
  const { stripeCalls, result } = run(
    { subRow: SWITCH_WINDOW_ROW, casError: { message: "db down" } },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 500);
  const sets = stripeCalls.filter((c) => c.method === "setCancelAtPeriodEnd");
  assertEquals(sets[sets.length - 1]?.args, ["sub_s1", true]);
});

// review rodada 2, achado IMPORTANTE 2: o erro de CAS e ambiguo (o UPDATE pode ter
// COMMITADO antes do timeout). Rearmar as cegas re-cancelaria o mensal que o usuario
// acabou de recuperar. Um re-read decide.
Deno.test("undo: erro no CAS mas re-read mostra flip ja commitado (provider stripe) -> 200 reverted, SEM rearme, grant e DELETE seguem", async () => {
  const { events, calls, stripeCalls, result } = run(
    {
      subRow: SWITCH_WINDOW_ROW,
      casError: { message: "timeout ambiguo pos-commit" },
      reReadRow: { provider: "stripe", status: "active", pagarme_subscription_id: null },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
  assert(
    !stripeCalls.some((c) => c.method === "setCancelAtPeriodEnd" && c.args[1] === true),
    "rearme (cap_end=true) nao pode rodar quando o re-read confirma que o flip ja commitou",
  );
  const planWrite = events.find((e) => e.table === "workspaces" && e.op === "update");
  assert(planWrite !== undefined, "o grant do plano-fonte deve rodar mesmo com o erro de CAS");
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === SUB));
});

// gap de teste (a): a variante em que o proprio rearme tambem falha (dupla falha remota):
// 500 de qualquer forma, mas as DUAS tentativas de setCancelAtPeriodEnd ficam registradas
// (a segunda e o rearme que vira CRITICAL no log, backstop pelo leg D).
Deno.test("undo: cap_end=false falha E o rearme tambem falha -> 500, tentativa + rearme registrados", async () => {
  const { stripeCalls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { setCancelFalseThrows: new Error("timeout ambiguo"), setCancelTrueThrows: new Error("rearme tambem falhou") },
  );
  const res = await result;
  assertEquals(res.status, 500);
  const sets = stripeCalls.filter((c) => c.method === "setCancelAtPeriodEnd");
  assertEquals(sets.map((c) => c.args[1]), [false, true]);
});

Deno.test("undo: fetchAmount falha -> mirror CLEARED no mesmo statement, fluxo segue", async () => {
  const { events, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { amountThrows: new Error("stripe amount down") },
  );
  const res = await result;
  assertEquals(res.status, 200);
  const cas = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(cas.values?.amount_cents, null);
  assertEquals(cas.values?.amount_refreshed_at, null);
});

Deno.test("undo: marker de plano null usa resolvePlanFromPriceId; ambos null -> grant pulado + CRITICAL", async () => {
  const row = { ...SWITCH_WINDOW_ROW, switched_from_plan_id: null };
  // fallback resolve pelo price do assess (price_m1 -> start)
  const r1 = run(
    { subRow: row, planPriceRows: [{ id: "start", stripe_price_id: "price_m1", stripe_price_id_annual: null }] },
    {},
    { action: "cancel" },
    {},
  );
  const res1 = await r1.result;
  assertEquals(res1.status, 200);
  const cas = r1.events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(cas.values?.plan_id, "start");
  // ambos null: sem plan_id no CAS e sem write em workspaces
  const r2 = run({ subRow: row, planPriceRows: [] }, {}, { action: "cancel" }, {});
  const res2 = await r2.result;
  assertEquals(res2.status, 200);
  const cas2 = r2.events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assert(!("plan_id" in (cas2.values ?? {})));
  assert(!r2.events.some((e) => e.table === "workspaces" && e.op === "update"));
});

Deno.test("undo: remota terminal (canceled) -> fallback cancel comum limpando os DOIS markers no mesmo CAS", async () => {
  const { events, calls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { retrieveResult: { ...STRIPE_SUB_MONTHLY, status: "canceled" } },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "canceled");
  assert(calls.some((c) => c.method === "cancelSubscription")); // cancel comum cancela a pagarme
  const cas = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(cas.values?.switched_from_stripe_subscription_id, null);
  assertEquals(cas.values?.switched_from_plan_id, null);
  assertEquals(cas.values?.switched_from_cancel_at_period_end, null);
  assertEquals(cas.values?.status, "canceled");
});

// gap de teste (c): o retrieve pode LANCAR um 404-shaped error (em vez de retornar um sub com
// status terminal) -- mesmo fallback da decisao 4, so que pelo branch do catch.
Deno.test("undo: retrieveSubscription lanca 404 -> fallback decisao 4 (cancel comum, ambos markers limpos)", async () => {
  const { events, calls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { retrieveThrows: { statusCode: 404 } },
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "canceled");
  assert(calls.some((c) => c.method === "cancelSubscription"));
  const cas = events.find((e) => e.table === "workspace_subscriptions" && e.op === "update")!;
  assertEquals(cas.values?.switched_from_stripe_subscription_id, null);
  assertEquals(cas.values?.switched_from_plan_id, null);
  assertEquals(cas.values?.switched_from_cancel_at_period_end, null);
  assertEquals(cas.values?.status, "canceled");
});

// review rodada 2, achado IMPORTANTE 1: assessStripeSourceSub("not_in_force") cobre QUALQUER
// status fora de active/trialing -- past_due/unpaid/incomplete/paused NAO sao terminais. Cair
// no fallback (decisao 4) para um desses derrubaria o plano e apagaria o 12x enquanto o
// mensal Stripe ainda esta vivo (so nao em force agora) e ainda vai morrer na fronteira
// (cap_end=true do bind original). Isso tem que 500 sem mutar nada, nunca cair no fallback.
Deno.test("undo: remoto past_due (nao terminal) -> 500, ZERO mutacoes remotas ou locais (nao cai no fallback)", async () => {
  const { events, stripeCalls, result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    {},
    { action: "cancel" },
    { retrieveResult: { ...STRIPE_SUB_MONTHLY, status: "past_due" } },
  );
  const res = await result;
  assertEquals(res.status, 500);
  assert(!stripeCalls.some((c) => c.method === "setCancelAtPeriodEnd"));
  assert(!events.some((e) => e.op === "update"));
});

Deno.test("undo zero-rows -> re-read ACTIVE (fronteira cruzou): consolidacao cancelNow + 409", async () => {
  const { stripeCalls, result } = run(
    {
      subRow: SWITCH_WINDOW_ROW,
      casZeroRows: true,
      reReadRow: { provider: "pagarme", status: "active", pagarme_subscription_id: SUB },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals(
    (res.body as { error?: string }).error,
    "A troca já foi concluída e a primeira parcela foi cobrada.",
  );
  // consolidacao cancela na STRIPE via o marker (sub_s1), nunca o id pagarme (SUB)
  assertEquals(stripeCalls.find((c) => c.method === "cancelNow")?.args, ["sub_s1"]);
});

Deno.test("undo zero-rows -> re-read PAST_DUE: consolidacao com copy de cobranca pendente", async () => {
  const { result } = run(
    {
      subRow: SWITCH_WINDOW_ROW,
      casZeroRows: true,
      reReadRow: { provider: "pagarme", status: "past_due", pagarme_subscription_id: SUB },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 409);
  assertEquals(
    (res.body as { error?: string }).error,
    "A troca já foi concluída e a primeira cobrança está pendente. Atualize o cartão ou cancele a assinatura.",
  );
});

// gap de teste (b): 12x morre em voo (re-read acha status canceled); o retry CAS pinado em
// 'canceled' tem sucesso -> segue para o grant + DELETE normalmente, 200 reverted.
Deno.test("undo zero-rows -> re-read CANCELED: retry CAS pinado com sucesso -> grant + DELETE + 200 reverted", async () => {
  const { events, calls, result } = run(
    {
      subRow: SWITCH_WINDOW_ROW,
      casZeroRows: true,
      reReadRow: { provider: "pagarme", status: "canceled", pagarme_subscription_id: SUB },
      // secondCasZeroRows fica false (default): o retry CAS acha a linha e escreve.
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
  const planWrite = events.find((e) => e.table === "workspaces" && e.op === "update");
  assert(planWrite !== undefined, "o grant do plano-fonte deve rodar apos o retry CAS ter sucesso");
  assert(calls.some((c) => c.method === "cancelSubscription" && c.args[0] === SUB));
});

Deno.test("undo zero-rows -> re-read provider stripe: 200 reverted idempotente", async () => {
  const { result } = run(
    {
      subRow: SWITCH_WINDOW_ROW,
      casZeroRows: true,
      reReadRow: { provider: "stripe", status: "active", pagarme_subscription_id: null },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
});

Deno.test("undo: DELETE da pagarme falha -> ainda 200 reverted (leg C e o backstop)", async () => {
  const { result } = run(
    { subRow: SWITCH_WINDOW_ROW },
    { cancelThrows: new Error("gateway down") },
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
});

Deno.test("undo: retry pos-undo com resposta perdida PARTE do estado final -> 200 reverted (decisao 9)", async () => {
  // Estado FINAL do undo: provider stripe, sem pagarme id, markers limpos, active.
  const { result } = run(
    {
      subRow: {
        provider: "stripe",
        pagarme_customer_id: "cus_1",
        pagarme_subscription_id: null,
        status: "active",
        cancel_at_period_end: false,
        current_period_end: "2026-09-15T14:23:11Z",
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      },
    },
    {},
    { action: "cancel" },
    {},
  );
  const res = await result;
  assertEquals(res.status, 200);
  assertEquals((res.body as { status?: string }).status, "reverted");
});

// ─── update_card ─────────────────────────────────────────────────────────

Deno.test("update_card happy: attachCard then updateSubscriptionCard with the attached card id, no workspace_subscriptions writes, 200", async () => {
  const { events, calls, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, pagarme_customer_id: "cus_1", status: "active" } },
    {},
    UPDATE_CARD,
  );
  const r = await result;
  assertEquals(r.status, 200);
  assertEquals(r.body, { ok: true });
  assertEquals(calls.map((c) => c.method), ["attachCard", "updateSubscriptionCard"]);
  assertEquals(calls[0].args, ["cus_1", "tok_1", ADDRESS]);
  assertEquals(calls[1].args, [SUB, "card_new"]);
  assertEquals(events.filter((e) => e.table === "workspace_subscriptions" && e.op === "update").length, 0);
});

Deno.test("attach 422: 400 invalid_card, swap never called", async () => {
  const { calls, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, pagarme_customer_id: "cus_1", status: "active" } },
    { attachThrows: new PagarmeApiError(422, null) },
    UPDATE_CARD,
  );
  const r = await result;
  assertEquals(r.status, 400);
  assertEquals((r.body as { code: string }).code, "invalid_card");
  assertEquals(calls.some((c) => c.method === "updateSubscriptionCard"), false);
});

Deno.test("swap 500: 500 gateway_error", async () => {
  const { result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, pagarme_customer_id: "cus_1", status: "active" } },
    { swapThrows: new PagarmeApiError(500, null) },
    UPDATE_CARD,
  );
  const r = await result;
  assertEquals(r.status, 500);
  assertEquals((r.body as { code: string }).code, "gateway_error");
});

Deno.test("swap 422 (definitive 4xx, freshly attached card): ALSO 500 gateway_error, never the card's fault", async () => {
  const { result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, pagarme_customer_id: "cus_1", status: "active" } },
    { swapThrows: new PagarmeApiError(422, null) },
    UPDATE_CARD,
  );
  const r = await result;
  assertEquals(r.status, 500);
  assertEquals((r.body as { code: string }).code, "gateway_error");
});

Deno.test("update_card with null pagarme_customer_id: 404", async () => {
  const { calls, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, pagarme_customer_id: null, status: "active" } },
    {},
    UPDATE_CARD,
  );
  const r = await result;
  assertEquals(r.status, 404);
  assertEquals(calls.length, 0);
});

// ─── abortSignal coverage ───────────────────────────────────────────────

Deno.test("every workspace_subscriptions op carries an abortSignal", async () => {
  const { events, result } = run(
    { subRow: { provider: "pagarme", pagarme_subscription_id: SUB, status: "trialing", current_period_end: null } },
    {},
    CANCEL,
  );
  await result;
  const subEvents = events.filter((e) => e.table === "workspace_subscriptions");
  assert(subEvents.length >= 2, "expected a read and a CAS update");
  for (const e of subEvents) {
    assert(e.abortSignal, `${e.table} ${e.op} missing abortSignal`);
  }
  const grant = findPlanGrant(events);
  assert(grant !== undefined && grant.abortSignal, "rpc missing abortSignal");
});
