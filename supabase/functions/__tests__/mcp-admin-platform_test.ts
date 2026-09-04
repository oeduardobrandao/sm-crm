import { assert, assertEquals } from "./assert.ts";
import { getDashboard, getWorkspace, listPlans, listWorkspaces } from "../mcp-admin/queries.ts";
import { makeDeps, makeFakeDb } from "./mcp-admin-helpers.ts";

// Formato real do RPC admin_list_workspaces (migration 20260825000010): owner é um objeto
// aninhado {name, email, telefone, marketing_opt_in}, não chaves owner_* no topo -- ver
// também WorkspaceSummary em apps/admin/src/lib/api.ts.
const WS = {
  id: "w1",
  name: "Agência X",
  plan_id: "max",
  owner: { name: "Ana", email: "ana@x.y", telefone: "+55", marketing_opt_in: true },
  member_count: 3,
  client_count: 7,
};

Deno.test("listWorkspaces: usa o RPC admin_list_workspaces e remove telefone/opt-in do dono aninhado", async () => {
  const { db, calls } = makeFakeDb({}, { admin_list_workspaces: [{ data: { workspaces: [WS], total: 1, total_members: 3, total_clients: 7, total_with_overrides: 0 }, error: null }] });
  const r = await listWorkspaces(makeDeps(db), { search: "Agência", limit: 500 });
  assertEquals(r.total, 1);
  assertEquals(r.workspaces[0], {
    id: "w1",
    name: "Agência X",
    plan_id: "max",
    owner: { name: "Ana", email: "ana@x.y" },
    member_count: 3,
    client_count: 7,
  });
  assert(!JSON.stringify(r).includes("telefone"));
  assert(!JSON.stringify(r).includes("marketing_opt_in"));
  const rpcArgs = calls.find((c) => c.table === "rpc:admin_list_workspaces")!.args[0] as Record<string, unknown>;
  assertEquals(rpcArgs.p_search, "Agência");
  assertEquals(rpcArgs.p_limit, 100); // teto
});

Deno.test("getWorkspace: reutiliza handleGetWorkspace e remove telefone/opt-in de owner e members", async () => {
  const { db } = makeFakeDb({
    workspaces: [{ data: { id: "w1", name: "X", logo_url: null, created_at: "t", plan_id: "max", plan_source: "manual" }, error: null }],
    workspace_members: [{ data: [{ user_id: "u1", role: "owner", joined_at: "t" }], error: null }],
    profiles: [{ data: { nome: "Ana", telefone: "+55", marketing_opt_in: true }, error: null }],
    clientes: [{ data: null, error: null, count: 2 } as never],
    integracoes_status: [{ data: null, error: null, count: 0 } as never],
    workspace_plan_overrides: [{ data: null, error: null }],
    plans: [{ data: { id: "max", name: "Max" }, error: null }],
    workspace_subscriptions: [{ data: null, error: null }],
  });
  db.auth.admin = { getUserById: async () => ({ data: { user: { email: "ana@x.y" } } }) } as never;
  const r = await getWorkspace(makeDeps(db), { workspace_id: "w1" });
  assertEquals(r.owner, { user_id: "u1", name: "Ana", email: "ana@x.y", role: "owner", joined_at: "t" });
  assertEquals(r.members.length, 1);
  assert(!("telefone" in r.members[0]) && !("marketing_opt_in" in r.members[0]));
  assertEquals(r.plan, { id: "max", name: "Max" });
  assert(!JSON.stringify(r).includes("telefone"));
  assert(!JSON.stringify(r).includes("marketing_opt_in"));
});

Deno.test("getWorkspace: 404 do handler vira McpInputError", async () => {
  const { expectInputError } = await import("./mcp-admin-helpers.ts");
  const { db } = makeFakeDb({ workspaces: [{ data: null, error: { message: "no rows" } }] });
  await expectInputError(() => getWorkspace(makeDeps(db), { workspace_id: "zz" }), "não encontrado");
});

Deno.test("listPlans: reutiliza handleListPlans", async () => {
  const { db } = makeFakeDb({ plans: [{ data: [{ id: "max", name: "Max", sort_order: 1 }], error: null }], workspaces: [{ data: null, error: null, count: 4 } as never] });
  const r = await listPlans(makeDeps(db));
  assertEquals(r.plans[0].id, "max");
  assertEquals(r.plans[0].workspace_count, 4);
});

Deno.test("getDashboard: só agregados — nenhuma chave owner_* ou lista de workspaces sai", async () => {
  const { db } = makeFakeDb(
    { plans: [{ data: [{ id: "a" }, { id: "b" }], error: null }], workspaces: [{ data: null, error: null, count: 1 } as never, { data: null, error: null, count: 1 } as never],
      workspace_subscriptions: [{ data: [], error: null }, { data: [], error: null }] },
    { admin_list_workspaces: [{ data: { workspaces: [WS], total: 12, total_members: 30, total_clients: 70, total_with_overrides: 2 }, error: null }] },
  );
  const r = await getDashboard(makeDeps(db));
  assertEquals(r, { totals: { workspaces: 12, members: 30, clients: 70, with_overrides: 2, active_plans: 2 }, mrr: { mrr_cents: 0, paying_count: 0 }, trials: { trial_mrr_cents: 0, trial_count: 0 } });
  assert(!JSON.stringify(r).includes("owner_"));
});
