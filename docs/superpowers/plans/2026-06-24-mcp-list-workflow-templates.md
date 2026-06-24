# `list_workflow_templates` MCP read tool (slice 2c-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `list_workflow_templates` MCP read tool that exposes the workspace's workflow templates — their steps (etapas) and custom-property schema — to an agent.

**Architecture:** A pure `projectTemplateEtapas` helper in `mcp/content.ts` (fail-closed JSONB projection that drops `responsavel_id`), plus a `listWorkflowTemplates` query in `mcp/queries.ts` (two `conta_id`-scoped reads — templates, then their property definitions filtered by `.in("template_id", …)` — grouped in memory), registered as one tool in `mcp/tools.ts` under the existing `workflows:read` scope. No migration, no new scope, no frontend change.

**Tech Stack:** Deno edge function, supabase-js (service-role client), Zod for the tool shape, Deno test runner (`npm run test:functions`).

**Spec:** `docs/superpowers/specs/2026-06-24-mcp-list-workflow-templates-design.md`

## Global Constraints

- Reuse the existing `workflows:read` scope. **No** migration, **no** `_shared/mcp-token.ts` change, **no** frontend change.
- Both reads are scoped by `.eq("conta_id", ctx.conta_id)` directly (service-role client → these app-level filters are the sole tenant boundary). The property read additionally filters `.in("template_id", templateIds)` where the ids come only from this workspace's templates.
- Deterministic ordering: templates `.order("nome").order("id")`; property definitions `.order("display_order").order("id")`; etapas preserve their JSON array order.
- `projectTemplateEtapas` fails closed (`!Array.isArray` → `[]`), skips non-object elements, drops `responsavel_id`, and applies defaults `tipo_prazo:"corridos"` / `tipo:"padrao"`.
- Property `config` is passed through verbatim **except** a defensive normalization: a non-object config (null / array / scalar) becomes `{}`. Each property keeps its `id`.
- Empty fast-path: zero templates → return `[]` and never query `template_property_definitions`.
- Verify with `npm run test:functions` and `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`. After any `deno`/`supabase functions` command, restore both lock files (`git checkout deno.lock supabase/functions/deno.lock`) and run `npm ci`.

---

## File Structure

- `supabase/functions/mcp/content.ts` — add the pure `projectTemplateEtapas` helper (Task 1).
- `supabase/functions/__tests__/mcp-content_test.ts` — add `projectTemplateEtapas` unit tests (Task 1; this is where all `content.ts` pure-helper tests already live).
- `supabase/functions/mcp/queries.ts` — add `listWorkflowTemplates` (Task 2); import `projectTemplateEtapas`.
- `supabase/functions/mcp/tools.ts` — register `list_workflow_templates` under `workflows:read` (Task 2); import `listWorkflowTemplates`.
- `supabase/functions/__tests__/mcp-templates_test.ts` — new file: `listWorkflowTemplates` tests with a recording fake `db` modeled on `mcp-feedback_test.ts` (Task 2).

---

## Task 1: `projectTemplateEtapas` pure helper + unit tests

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (add the helper; place it after `buildTiptapDoc`, the last export, ~end of file)
- Test: `supabase/functions/__tests__/mcp-content_test.ts` (add the import + two tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function projectTemplateEtapas(raw: unknown): { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[]`

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/__tests__/mcp-content_test.ts`, add `projectTemplateEtapas` to the existing import block from `../mcp/content.ts` (keep the list alphabetical-ish, matching the file):

```ts
  pageContentToMarkdown,
  performanceTier,
  projectTemplateEtapas,
  quartiles,
```

Append these two tests to the end of the file:

```ts
Deno.test("projectTemplateEtapas projects, drops responsavel_id, applies defaults", () => {
  const raw = [
    { nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao", responsavel_id: 9 },
    { nome: "Aprovação", prazo_dias: 2, tipo_prazo: "uteis", tipo: "aprovacao_cliente" },
    { nome: "Sem tipo" }, // missing prazo_dias/tipo_prazo/tipo -> defaults
  ];
  assertEquals(projectTemplateEtapas(raw), [
    { nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
    { nome: "Aprovação", prazo_dias: 2, tipo_prazo: "uteis", tipo: "aprovacao_cliente" },
    { nome: "Sem tipo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
  ]);
});

Deno.test("projectTemplateEtapas fails closed on non-array and skips non-objects", () => {
  assertEquals(projectTemplateEtapas(null), []);
  assertEquals(projectTemplateEtapas({}), []);
  assertEquals(projectTemplateEtapas("x"), []);
  assertEquals(projectTemplateEtapas([null, "nope", 3, { nome: "ok" }]), [
    { nome: "ok", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
  ]);
});
```

(The first test's expected output omits `responsavel_id`; `assertEquals` is a deep equality check, so an un-dropped `responsavel_id` would fail the test.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `projectTemplateEtapas` is not exported from `content.ts` (unresolved import / not a function).

- [ ] **Step 3: Implement the helper in `content.ts`**

At the end of `supabase/functions/mcp/content.ts` add:

```ts
/**
 * Project a workflow template's `etapas` JSONB array into the agent-facing shape.
 * Fails closed on malformed JSONB, skips non-object elements, drops the internal
 * `responsavel_id`, and applies the system defaults for tipo_prazo/tipo.
 */
export function projectTemplateEtapas(
  raw: unknown,
): { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[] {
  if (!Array.isArray(raw)) return [];
  const out: { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    out.push({
      nome: typeof o.nome === "string" ? o.nome : "",
      prazo_dias: typeof o.prazo_dias === "number" ? o.prazo_dias : 0,
      tipo_prazo: o.tipo_prazo === "uteis" ? "uteis" : "corridos",
      tipo: o.tipo === "aprovacao_cliente" ? "aprovacao_cliente" : "padrao",
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS — both `projectTemplateEtapas` tests pass, plus all pre-existing `mcp-content_test.ts` tests.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors.
Then restore lock files: `git checkout deno.lock supabase/functions/deno.lock` and run `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/content.ts supabase/functions/__tests__/mcp-content_test.ts
git commit -m "feat(mcp): projectTemplateEtapas helper (slice 2c-1)"
```

---

## Task 2: `listWorkflowTemplates` query + `list_workflow_templates` tool + integration tests

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (add `listWorkflowTemplates`; import `projectTemplateEtapas` from `./content.ts`)
- Modify: `supabase/functions/mcp/tools.ts` (import `listWorkflowTemplates`; register the tool after the existing `list_pages` / read-tool registrations)
- Test: `supabase/functions/__tests__/mcp-templates_test.ts` (new file)

**Interfaces:**
- Consumes: `projectTemplateEtapas` (Task 1); the existing `Deps` type and `register(server, deps, name, scope, description, shape, run, auditArgs?)` helper.
- Produces: `export async function listWorkflowTemplates(d: Deps, _args: Record<string, never>): Promise<any[]>` returning `[{ id, nome, modo_prazo, etapas, properties }]`; an MCP tool `list_workflow_templates` under `workflows:read`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/mcp-templates_test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `listWorkflowTemplates` is not exported from `queries.ts` (unresolved import / not a function).

- [ ] **Step 3: Implement `listWorkflowTemplates` in `queries.ts`**

Add `projectTemplateEtapas` to the existing import block from `./content.ts` at the top of `queries.ts` (keep it with the other content imports):

```ts
  pageContentToMarkdown,
  performanceTier,
  projectTemplateEtapas,
  quartiles,
```

Add the function (place it after `listPages`, near the other list readers, ~line 444):

```ts
// ---- workflow templates ------------------------------------------------------

export async function listWorkflowTemplates(d: Deps, _args: Record<string, never>): Promise<any[]> {
  const { data: templates, error } = await d.db
    .from("workflow_templates")
    .select("id, nome, modo_prazo, etapas")
    .eq("conta_id", d.ctx.conta_id)
    .order("nome", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  const rows = (templates ?? []) as any[];
  if (rows.length === 0) return [];

  const templateIds = rows.map((t) => t.id);
  const { data: defs, error: defErr } = await d.db
    .from("template_property_definitions")
    .select("id, template_id, name, type, config, portal_visible, display_order")
    .eq("conta_id", d.ctx.conta_id)
    .in("template_id", templateIds)
    .order("display_order", { ascending: true })
    .order("id", { ascending: true });
  if (defErr) throw defErr;

  const propsByTemplate = new Map<number, any[]>();
  for (const def of (defs ?? []) as any[]) {
    const list = propsByTemplate.get(def.template_id) ?? [];
    list.push({
      id: def.id,
      name: def.name,
      type: def.type,
      config: def.config && typeof def.config === "object" && !Array.isArray(def.config) ? def.config : {},
      portal_visible: def.portal_visible,
      display_order: def.display_order,
    });
    propsByTemplate.set(def.template_id, list);
  }

  return rows.map((t) => ({
    id: t.id,
    nome: t.nome,
    modo_prazo: t.modo_prazo ?? null,
    etapas: projectTemplateEtapas(t.etapas),
    properties: propsByTemplate.get(t.id) ?? [],
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS — all three `listWorkflowTemplates` tests pass, plus the Task 1 and pre-existing tests.

- [ ] **Step 5: Register the tool in `tools.ts`**

Add `listWorkflowTemplates` to the import block from `./queries.ts` (alongside `listWorkflows`, `listPages`, etc.):

```ts
  listWorkflowTemplates,
  listWorkflows,
```

After the `list_pages` registration (~line 138, inside `registerTools`), add:

```ts
  register(server, deps, "list_workflow_templates", "workflows:read",
    "Lista os modelos de fluxo (workflow templates) do workspace: etapas e o esquema de propriedades personalizadas de cada um.",
    {},
    () => listWorkflowTemplates(deps, {}));
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test:functions`
Expected: PASS (registering the tool does not change any test's behavior; all green).

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors.
Then restore lock files: `git checkout deno.lock supabase/functions/deno.lock` and run `npm ci`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-templates_test.ts
git commit -m "feat(mcp): list_workflow_templates read tool (slice 2c-1)"
```

---

## Rollout (gated — requires explicit user go-ahead, NOT part of subagent execution)

No migration, no scope change.

1. Deploy the function: `npx supabase functions deploy mcp --no-verify-jwt --project-ref skjzpekeqefvlojenfsw` (prod) and `--project-ref wlyzhyfondykzpsiqsce` (staging). Only `mcp` is redeployed (no scope change → no `mcp-oauth-consent`/`mcp-keys`, no Vercel). After each, `git checkout deno.lock supabase/functions/deno.lock && npm ci`.
2. Smoke test: a `workflows:read` key/connection runs `list_workflow_templates` and gets the workspace's templates with their etapas + properties; a connection without `workflows:read` is denied.
