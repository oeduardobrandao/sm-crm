import { assert, assertEquals } from "./assert.ts";
import { listWorkflowTemplates } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client (read chains): chainable methods record their
// args; `await` pulls the next canned response from that table's queue.
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  function recorder(table: string) {
    const rec: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    // deno-lint-ignore no-explicit-any
    (rec as any).then = (resolve: (r: Resp) => unknown) => {
      const r = (queues[table] ?? []).shift() ?? { data: [], error: null };
      return Promise.resolve(resolve(r));
    };
    return rec;
  }
  const db = {
    from: (table: string) => { calls.push({ table, method: "from", args: [table] }); return recorder(table); },
  };
  return { db, calls };
}

const CTX: McpKeyContext = {
  conta_id: "workspace-A", scopes: ["workflows:read"], key_id: "k1", created_by: "u1",
};

function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some((c) => c.table === table && c.method === method &&
    JSON.stringify(c.args) === JSON.stringify(args));
}

Deno.test("listWorkflowTemplates: tenant-scoped reads, grouped props, projected etapas", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [{ data: [
      { id: 1, nome: "A", modo_prazo: "padrao", etapas: [{ nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao", responsavel_id: 9 }] },
      { id: 2, nome: "B", modo_prazo: null, etapas: [] },
    ], error: null }],
    template_property_definitions: [{ data: [
      { id: 45, template_id: 1, name: "modo", type: "select", config: { options: ["x"] }, portal_visible: true, display_order: 0 },
      { id: 46, template_id: 1, name: "anotacao", type: "text", config: {}, portal_visible: false, display_order: 1 },
    ], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listWorkflowTemplates(deps, {});

  assert(has(calls, "workflow_templates", "eq", ["conta_id", "workspace-A"]), "templates tenant-scoped");
  assert(has(calls, "template_property_definitions", "eq", ["conta_id", "workspace-A"]), "props tenant-scoped");
  assert(has(calls, "template_property_definitions", "in", ["template_id", [1, 2]]), "props grouped by exact template ids");

  assertEquals(out.length, 2);
  assertEquals(out[0].id, 1);
  assertEquals(out[0].etapas, [{ nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" }]); // responsavel_id dropped
  assertEquals(out[0].properties.length, 2);
  assertEquals(out[0].properties[0], { id: 45, name: "modo", type: "select", config: { options: ["x"] }, portal_visible: true, display_order: 0 });
  assertEquals(out[1].id, 2);
  assertEquals(out[1].modo_prazo, null);
  assertEquals(out[1].properties, []);
});

Deno.test("listWorkflowTemplates: config normalized to {} for non-object", async () => {
  const { db } = makeFakeDb({
    workflow_templates: [{ data: [{ id: 1, nome: "A", modo_prazo: "padrao", etapas: [] }], error: null }],
    template_property_definitions: [{ data: [
      { id: 45, template_id: 1, name: "p", type: "text", config: null, portal_visible: false, display_order: 0 },
      { id: 46, template_id: 1, name: "q", type: "text", config: ["bad"], portal_visible: false, display_order: 1 },
    ], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listWorkflowTemplates(deps, {});
  assertEquals(out[0].properties[0].config, {});
  assertEquals(out[0].properties[1].config, {});
});

Deno.test("listWorkflowTemplates: no templates -> [] and never queries property definitions", async () => {
  const { db, calls } = makeFakeDb({ workflow_templates: [{ data: [], error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listWorkflowTemplates(deps, {});
  assertEquals(out, []);
  assert(!calls.some((c) => c.table === "template_property_definitions"), "property definitions never queried");
});
