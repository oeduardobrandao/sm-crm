// Handler tests for pagarme-subscription. Fake-db pattern mirrors the house style established
// by pagarme-checkout-handler_test.ts: a thenable chain that records {table, op, filters,
// values, abortSignal} per call, in call order, and resolves per-table/op fixtures. The `rpc`
// recorder shape (for grant_pagarme_plan) is copied from pagarme-webhook-handler_test.ts.

import { assert, assertEquals } from "./assert.ts";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PagarmeApiError } from "../_shared/pagarme.ts";
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
}

function makeDb(fx: DbFx & { events: Ev[] }): SupabaseClient {
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
        return { data: fx.subRow === undefined ? null : fx.subRow, error: fx.subRowError ?? null };
      }
      if (table === "workspace_subscriptions" && op === "update") {
        return {
          data: fx.casZeroRows ? [] : [{ workspace_id: WS }],
          error: fx.casError ?? null,
        };
      }
      if (table === "plans") {
        return {
          data: fx.defaultPlan === undefined ? { id: "free" } : fx.defaultPlan,
          error: null,
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

function run(
  dbFx: Omit<Parameters<typeof makeDb>[0], "events">,
  gwFx: Omit<Parameters<typeof makeGateway>[0], "calls">,
  action: SubscriptionAction,
) {
  const events: Ev[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const result = handleSubscriptionAction(
    { db: makeDb({ ...dbFx, events }), gateway: makeGateway({ ...gwFx, calls }), now: () => NOW },
    { workspaceId: WS },
    action,
  );
  return { events, calls, result };
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
    ["provider stripe", { provider: "stripe", pagarme_subscription_id: null, status: "active" }],
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
