import { assert, assertEquals } from "./assert.ts";
import { handleCreatePlan, handleUpdatePlan } from "../platform-admin/plan-mutations.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client (mirrors the pattern in mcp-writes_test.ts).
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "update", "upsert", "delete"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    rec.single = () => { calls.push({ table, method: "single", args: [] }); return Promise.resolve(next()); };
    rec.maybeSingle = () => { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(next()); };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }
  const db = { from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return recorder(t); } };
  return { db, calls };
}

function lastPayload(calls: Call[], table: string, method: string): Record<string, unknown> | undefined {
  const matches = calls.filter((x) => x.table === table && x.method === method);
  return matches.at(-1)?.args[0] as Record<string, unknown> | undefined;
}

// The current-row read (`.select("col, col")`) and the mutation's trailing
// `.select()` (no args, to return the written row) both record method "select".
// Only the former carries a column-list argument, so it's what identifies the
// merge-over-current read specifically.
function currentRowReadCalls(calls: Call[]): Call[] {
  return calls.filter((c) => c.table === "plans" && c.method === "select" && c.args.length > 0);
}

const HEADERS = { "Content-Type": "application/json" };

Deno.test("update-plan persists feature_mcp and max_mcp_keys (not silently dropped)", async () => {
  const { db, calls } = makeFakeDb({
    plans: [{ data: { id: "pro", feature_mcp: true, max_mcp_keys: 3 }, error: null }],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", feature_mcp: true, max_mcp_keys: 3, feature_leads: true },
    HEADERS,
  );

  assertEquals(res.status, 200);
  const payload = lastPayload(calls, "plans", "update");
  assert(payload, "expected an update on the plans table");
  assertEquals(payload.feature_mcp, true); // DROPPED today: key absent from payload
  assertEquals(payload.max_mcp_keys, 3); // DROPPED today: key absent from payload
  // Control: a column that already worked must keep working.
  assertEquals(payload.feature_leads, true);
});

Deno.test("create-plan persists feature_mcp and max_mcp_keys", async () => {
  const { db, calls } = makeFakeDb({
    plans: [{ data: { id: "new", feature_mcp: true, max_mcp_keys: 2 }, error: null }],
  });

  const res = await handleCreatePlan(
    db as unknown as SupabaseClient,
    { action: "create-plan", name: "New", feature_mcp: true, max_mcp_keys: 2, max_clients: 7 },
    HEADERS,
  );

  assertEquals(res.status, 201);
  const payload = lastPayload(calls, "plans", "insert");
  assert(payload, "expected an insert on the plans table");
  assertEquals(payload.feature_mcp, true);
  assertEquals(payload.max_mcp_keys, 2);
  // Control: a column that already worked must keep working.
  assertEquals(payload.max_clients, 7);
});

Deno.test("update-plan with is_default:true persists feature_mcp via the real update, not the demote call", async () => {
  const { db, calls } = makeFakeDb({
    plans: [
      { data: null, error: null }, // demote: update({is_default:false}).eq("is_default", true)
      { data: { id: "pro", feature_mcp: true, is_default: true }, error: null }, // real update .single()
    ],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", is_default: true, feature_mcp: true, max_mcp_keys: 4 },
    HEADERS,
  );

  assertEquals(res.status, 200);
  // Two updates fire on plans: [0] demotes the previous default, [1] is the real edit.
  const planUpdates = calls.filter((c) => c.table === "plans" && c.method === "update");
  assertEquals(planUpdates.length, 2);
  assertEquals(planUpdates[0].args[0], { is_default: false }); // demote carries no plan fields
  const real = lastPayload(calls, "plans", "update");
  assert(real, "expected a real update on the plans table");
  assertEquals(real.feature_mcp, true); // dropped under the drift bug
  assertEquals(real.max_mcp_keys, 4);
  assertEquals(real.is_default, true);
});

// ─── pagarme_12x_enabled / pagarme_plan_id_annual threading + validation ───

Deno.test("update-plan persists pagarme_12x_enabled and pagarme_plan_id_annual", async () => {
  const { db, calls } = makeFakeDb({
    plans: [
      { data: { id: "pro", pagarme_12x_enabled: true, pagarme_plan_id_annual: "plan_123" }, error: null },
    ],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    {
      action: "update-plan",
      plan_id: "pro",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_123",
      price_brl_annual: 134300,
      pagarme_installment_cents: 12990,
      price_brl: 13990,
    },
    HEADERS,
  );

  assertEquals(res.status, 200);
  const payload = lastPayload(calls, "plans", "update");
  assert(payload, "expected an update on the plans table");
  assertEquals(payload.pagarme_12x_enabled, true);
  assertEquals(payload.pagarme_plan_id_annual, "plan_123");
  assertEquals(payload.pagarme_installment_cents, 12990);
});

Deno.test("create-plan persists pagarme_12x_enabled and pagarme_plan_id_annual", async () => {
  const { db, calls } = makeFakeDb({
    plans: [{ data: { id: "new", pagarme_12x_enabled: true, pagarme_plan_id_annual: "plan_abc" }, error: null }],
  });

  const res = await handleCreatePlan(
    db as unknown as SupabaseClient,
    {
      action: "create-plan",
      name: "New",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 100000,
      pagarme_installment_cents: 9490,
      price_brl: 9990,
    },
    HEADERS,
  );

  assertEquals(res.status, 201);
  const payload = lastPayload(calls, "plans", "insert");
  assert(payload, "expected an insert on the plans table");
  assertEquals(payload.pagarme_12x_enabled, true);
  assertEquals(payload.pagarme_plan_id_annual, "plan_abc");
  assertEquals(payload.pagarme_installment_cents, 9490);
});

Deno.test("create-plan rejects enabling 12x without a plan id (400, no insert)", async () => {
  const { db, calls } = makeFakeDb({ plans: [] });

  const res = await handleCreatePlan(
    db as unknown as SupabaseClient,
    { action: "create-plan", name: "New", pagarme_12x_enabled: true, price_brl_annual: 100000 },
    HEADERS,
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(
    body.error,
    "pagarme_12x_enabled requires pagarme_plan_id_annual and a positive price_brl_annual",
  );
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "insert"), false);
});

Deno.test("create-plan rejects enabling 12x without a positive annual price (400, no insert)", async () => {
  const { db, calls } = makeFakeDb({ plans: [] });

  const res = await handleCreatePlan(
    db as unknown as SupabaseClient,
    {
      action: "create-plan",
      name: "New",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 0,
    },
    HEADERS,
  );

  assertEquals(res.status, 400);
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "insert"), false);
});

Deno.test("create-plan allows enabling 12x with both a plan id and a positive annual price", async () => {
  const { db } = makeFakeDb({
    plans: [{ data: { id: "new", pagarme_12x_enabled: true }, error: null }],
  });

  const res = await handleCreatePlan(
    db as unknown as SupabaseClient,
    {
      action: "create-plan",
      name: "New",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 100000,
      pagarme_installment_cents: 9490,
      price_brl: 9990,
    },
    HEADERS,
  );

  assertEquals(res.status, 201);
});

Deno.test("update-plan rejects enabling 12x without a plan id (400, no update, no read needed)", async () => {
  const { db, calls } = makeFakeDb({ plans: [] });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", pagarme_12x_enabled: true, price_brl_annual: 100000 },
    HEADERS,
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(
    body.error,
    "pagarme_12x_enabled requires pagarme_plan_id_annual and a positive price_brl_annual",
  );
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "update"), false);
});

Deno.test("update-plan rejects enabling 12x without a positive annual price (400, no update)", async () => {
  const { db, calls } = makeFakeDb({ plans: [] });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    {
      action: "update-plan",
      plan_id: "pro",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 0,
    },
    HEADERS,
  );

  assertEquals(res.status, 400);
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "update"), false);
});

Deno.test("update-plan allows enabling 12x when the payload supplies both id and positive price", async () => {
  const { db } = makeFakeDb({
    plans: [{ data: { id: "pro", pagarme_12x_enabled: true }, error: null }],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    {
      action: "update-plan",
      plan_id: "pro",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 100000,
      pagarme_installment_cents: 9490,
      price_brl: 9990,
    },
    HEADERS,
  );

  assertEquals(res.status, 200);
});

Deno.test("update-plan: boolean-only flip on an already-configured row reads current row and allows it (merge-over-current)", async () => {
  const { db, calls } = makeFakeDb({
    plans: [
      // First call: the current-row read triggered by the boolean-only flip.
      {
        data: {
          pagarme_12x_enabled: false,
          pagarme_plan_id_annual: "plan_existing",
          price_brl_annual: 134300,
          pagarme_installment_cents: 12990,
          price_brl: 13990,
        },
        error: null,
      },
      // Second call: the real update.
      { data: { id: "pro", pagarme_12x_enabled: true, pagarme_plan_id_annual: "plan_existing" }, error: null },
    ],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", pagarme_12x_enabled: true },
    HEADERS,
  );

  assertEquals(res.status, 200);
  assertEquals(currentRowReadCalls(calls).length, 1); // proves the current-row read happened
  const payload = lastPayload(calls, "plans", "update");
  assert(payload, "expected an update on the plans table");
  assertEquals(payload.pagarme_12x_enabled, true);
});

Deno.test("update-plan: boolean-only flip on a misconfigured row is rejected (merge-over-current)", async () => {
  const { db, calls } = makeFakeDb({
    plans: [
      { data: { pagarme_12x_enabled: false, pagarme_plan_id_annual: null, price_brl_annual: null }, error: null },
    ],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", pagarme_12x_enabled: true },
    HEADERS,
  );

  assertEquals(res.status, 400);
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "update"), false);
});

Deno.test("update-plan: disabling 12x never validates, even with no id or price", async () => {
  const { db, calls } = makeFakeDb({
    plans: [{ data: { id: "pro", pagarme_12x_enabled: false }, error: null }],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", pagarme_12x_enabled: false },
    HEADERS,
  );

  assertEquals(res.status, 200);
  // Disabling must skip the current-row read entirely.
  assertEquals(currentRowReadCalls(calls).length, 0);
  const payload = lastPayload(calls, "plans", "update");
  assert(payload, "expected an update on the plans table");
  assertEquals(payload.pagarme_12x_enabled, false);
});

Deno.test("update-plan rejects enabling 12x on a plan id pagarme-checkout doesn't accept (400, no update)", async () => {
  // pagarme-checkout's own PAID_PLANS allowlist (now PAGARME_PAID_PLAN_IDS in
  // _shared/billing-logic.ts) only accepts start/pro/max. Enabling the flag on any other
  // plan id — e.g. a comp/enterprise row — would otherwise pass this validation and then
  // 400 "Plano inválido." at every checkout attempt for that plan.
  const { db, calls } = makeFakeDb({ plans: [] });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    {
      action: "update-plan",
      plan_id: "enterprise",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 100000,
      pagarme_installment_cents: 9490,
      price_brl: 9990,
    },
    HEADERS,
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "pagarme_12x_enabled is only supported for plans: start, pro, max");
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "update"), false);
});

Deno.test("update-plan: unrelated field changes on an already-enabled plan skip the read (no relevant fields touched)", async () => {
  const { db, calls } = makeFakeDb({
    plans: [{ data: { id: "pro", name: "Renamed" }, error: null }],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", name: "Renamed" },
    HEADERS,
  );

  assertEquals(res.status, 200);
  assertEquals(currentRowReadCalls(calls).length, 0);
});

// ─── pagarme_installment_cents ceiling rule (0 < installment < price_brl mensal) ───

Deno.test("update-plan rejects enabling 12x with pagarme_installment_cents 0 (400, no update)", async () => {
  const { db, calls } = makeFakeDb({ plans: [] });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    {
      action: "update-plan",
      plan_id: "pro",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 134300,
      pagarme_installment_cents: 0,
      price_brl: 13990,
    },
    HEADERS,
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(
    body.error,
    "pagarme_12x_enabled requires 0 < pagarme_installment_cents < price_brl (mensal)",
  );
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "update"), false);
});

Deno.test("update-plan rejects enabling 12x when pagarme_installment_cents equals price_brl (strict less-than)", async () => {
  const { db, calls } = makeFakeDb({ plans: [] });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    {
      action: "update-plan",
      plan_id: "pro",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 134300,
      pagarme_installment_cents: 13990,
      price_brl: 13990,
    },
    HEADERS,
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(
    body.error,
    "pagarme_12x_enabled requires 0 < pagarme_installment_cents < price_brl (mensal)",
  );
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "update"), false);
});

Deno.test("update-plan allows enabling 12x when pagarme_installment_cents is positive and strictly under price_brl", async () => {
  const { db } = makeFakeDb({
    plans: [{ data: { id: "pro", pagarme_12x_enabled: true, pagarme_installment_cents: 12990 }, error: null }],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    {
      action: "update-plan",
      plan_id: "pro",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 134300,
      pagarme_installment_cents: 12990,
      price_brl: 13990,
    },
    HEADERS,
  );

  assertEquals(res.status, 200);
});

Deno.test("create-plan rejects enabling 12x with pagarme_installment_cents 0 (400, no insert)", async () => {
  const { db, calls } = makeFakeDb({ plans: [] });

  const res = await handleCreatePlan(
    db as unknown as SupabaseClient,
    {
      action: "create-plan",
      name: "New",
      pagarme_12x_enabled: true,
      pagarme_plan_id_annual: "plan_abc",
      price_brl_annual: 134300,
      pagarme_installment_cents: 0,
      price_brl: 13990,
    },
    HEADERS,
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(
    body.error,
    "pagarme_12x_enabled requires 0 < pagarme_installment_cents < price_brl (mensal)",
  );
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "insert"), false);
});

Deno.test("update-plan: boolean-only flip on a fully-configured row (incl. installment) allows via merge-over-current", async () => {
  const { db, calls } = makeFakeDb({
    plans: [
      {
        data: {
          pagarme_12x_enabled: false,
          pagarme_plan_id_annual: "plan_existing",
          price_brl_annual: 134300,
          pagarme_installment_cents: 12990,
          price_brl: 13990,
        },
        error: null,
      },
      { data: { id: "pro", pagarme_12x_enabled: true }, error: null },
    ],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", pagarme_12x_enabled: true },
    HEADERS,
  );

  assertEquals(res.status, 200);
  assertEquals(currentRowReadCalls(calls).length, 1);
  const payload = lastPayload(calls, "plans", "update");
  assert(payload, "expected an update on the plans table");
  assertEquals(payload.pagarme_12x_enabled, true);
});

Deno.test("update-plan: boolean-only flip is rejected when installment is configured but >= price_brl", async () => {
  const { db, calls } = makeFakeDb({
    plans: [
      {
        data: {
          pagarme_12x_enabled: false,
          pagarme_plan_id_annual: "plan_existing",
          price_brl_annual: 134300,
          pagarme_installment_cents: 13990,
          price_brl: 13990,
        },
        error: null,
      },
    ],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", pagarme_12x_enabled: true },
    HEADERS,
  );

  assertEquals(res.status, 400);
  assertEquals(calls.some((c) => c.table === "plans" && c.method === "update"), false);
});
