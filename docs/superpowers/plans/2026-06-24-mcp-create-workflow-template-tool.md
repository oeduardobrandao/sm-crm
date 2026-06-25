# `create_workflow_template` MCP write tool (slice 2c-D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `create_workflow_template` MCP tool, under a new `templates:write` scope, that creates a workflow template (etapas + optional custom-property definitions) and returns it `list_workflow_templates`-shaped.

**Architecture:** Three pure helpers in `mcp/content.ts` (`normalizeTemplateEtapas`, `buildPropertyDefinitions`, `isPlanLimitExceeded`), a `createWorkflowTemplate` query in `mcp/queries.ts` (insert template → insert property defs with best-effort compensating cleanup, friendly plan-cap messages), the tool registered in `mcp/tools.ts` under a new `templates:write` scope added to `_shared/mcp-token.ts` and mirrored in the frontend `mcp-scopes.ts`. No migration.

**Tech Stack:** Deno edge function, supabase-js (service-role client), Zod, Deno test runner (`npm run test:functions`); CRM frontend (Vite/TS, Vitest).

**Spec:** `docs/superpowers/specs/2026-06-24-mcp-create-workflow-template-tool-design.md`

## Global Constraints

- New **`templates:write`** scope: add to `MCP_ALLOWED_SCOPES` (`_shared/mcp-token.ts`, bundled into `mcp`/`mcp-oauth-consent`/`mcp-keys`) and `SCOPE_OPTIONS` (frontend `mcp-scopes.ts`); keep it **out** of both `MCP_AGENT_PRESET` and the frontend `AGENT_PRESET`. Register the tool under `templates:write`. **No migration.**
- Definable property types = `text|url|email|phone|number|date|checkbox|select|status|multiselect` (the Zod enum **excludes** `person`/`created_time`).
- `select`/`status`/`multiselect` require non-empty `options` (labels) → `config = { options: [{ id: genId(), label, color: "#94a3b8" }] }`; other types forbid `options` → `config = {}`. UUIDs from `d.genId?.() ?? crypto.randomUUID()` (inject in tests).
- Reject duplicate property names (exact, post-trim) and duplicate option labels within a property.
- Plan caps: catch `plan_limit_exceeded:<key>` via the **keyed** `isPlanLimitExceeded(error, key)` and map to a friendly `McpInputError` (`max_workflow_templates` → templates message; `max_custom_properties_per_template` → properties message).
- Property-insert failure → **best-effort** compensating delete (`try/catch`, `.eq("id", tpl.id).eq("conta_id", ctx.conta_id)`) that must NOT mask the original error.
- `conta_id`/`user_id` stamped; DB errors re-thrown (generic via `errorResult`) except the keyed cap cases + `buildPropertyDefinitions` validation (both `McpInputError`). Audit redactor: `{ nome, etapa_count, property_count }`.
- Verify with `npm run test:functions` + `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts` (backend) and `npm run build` + `npm run test` (frontend). After any `deno`/`supabase functions` command, restore both lock files (`git checkout deno.lock supabase/functions/deno.lock`) + `npm ci`.

---

## File Structure

- `supabase/functions/mcp/content.ts` — `normalizeTemplateEtapas`, `buildPropertyDefinitions`, `isPlanLimitExceeded` (Task 1).
- `supabase/functions/__tests__/mcp-content_test.ts` — helper unit tests (Task 1).
- `supabase/functions/mcp/queries.ts` — `createWorkflowTemplate`; add `genId?` to `Deps` (Task 2).
- `supabase/functions/__tests__/mcp-writes_test.ts` — query tests (Task 2) + audit wrapper test (Task 3).
- `supabase/functions/_shared/mcp-token.ts` — `templates:write` in `MCP_ALLOWED_SCOPES` (Task 3).
- `supabase/functions/mcp/tools.ts` — register `create_workflow_template` (Task 3).
- `supabase/functions/__tests__/mcp-keys_test.ts` — positive `validateScopes` + comment fix (Task 3).
- `apps/crm/src/lib/mcp-scopes.ts` + a new vitest test — frontend scope mirror (Task 4).

---

## Task 1: Pure helpers (`normalizeTemplateEtapas`, `buildPropertyDefinitions`, `isPlanLimitExceeded`)

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (append the three helpers)
- Test: `supabase/functions/__tests__/mcp-content_test.ts` (imports + tests)

**Interfaces:**
- Produces:
  - `export function normalizeTemplateEtapas(etapas: unknown): { nome: string; prazo_dias: number; tipo_prazo: "uteis"|"corridos"; tipo: "padrao"|"aprovacao_cliente" }[]`
  - `export function buildPropertyDefinitions(properties: Array<{ name: string; type: string; portal_visible?: boolean; options?: string[] }>, genId: () => string): { error: string } | { defs: { name: string; type: string; config: Record<string, unknown>; portal_visible: boolean; display_order: number }[] }`
  - `export function isPlanLimitExceeded(error: unknown, limitKey: string): boolean`

- [ ] **Step 1: Write the failing tests**

Add to the `../mcp/content.ts` import block in `mcp-content_test.ts` (alphabetical):
```ts
  buildPropertyDefinitions,
  buildTiptapDoc,
```
```ts
  instantiateTemplateEtapas,
  isPlanLimitExceeded,
  normalizeTemplateEtapas,
  pageContentToMarkdown,
```

Append:
```ts
Deno.test("normalizeTemplateEtapas: defaults, integer guard, skip non-objects, no extra fields", () => {
  assertEquals(normalizeTemplateEtapas([
    { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "aprovacao_cliente" },
    { nome: "Sem campos" },
  ]), [
    { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "aprovacao_cliente" },
    { nome: "Sem campos", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
  ]);
  assertEquals(normalizeTemplateEtapas(null), []);
  assertEquals(normalizeTemplateEtapas([null, "x", { prazo_dias: 1.5, nome: "ok" }]), [
    { nome: "ok", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao" },
  ]);
});

Deno.test("buildPropertyDefinitions: select options get generated ids, defaults, display_order", () => {
  let n = 0;
  const genId = () => "opt-" + (++n);
  const out = buildPropertyDefinitions(
    [
      { name: "modo", type: "select", options: ["A", "B"], portal_visible: true },
      { name: "nota", type: "text" },
    ],
    genId,
  );
  assertEquals("defs" in out, true);
  if ("defs" in out) {
    assertEquals(out.defs[0], {
      name: "modo", type: "select",
      config: { options: [{ id: "opt-1", label: "A", color: "#94a3b8" }, { id: "opt-2", label: "B", color: "#94a3b8" }] },
      portal_visible: true, display_order: 0,
    });
    assertEquals(out.defs[1], { name: "nota", type: "text", config: {}, portal_visible: false, display_order: 1 });
  }
});

Deno.test("buildPropertyDefinitions: validation errors", () => {
  const g = () => "x";
  assertEquals("error" in buildPropertyDefinitions([{ name: "a", type: "select" }], g), true);            // option type w/o options
  assertEquals("error" in buildPropertyDefinitions([{ name: "a", type: "text", options: ["x"] }], g), true); // non-option w/ options
  assertEquals("error" in buildPropertyDefinitions([{ name: "a", type: "text" }, { name: "a", type: "text" }], g), true); // dup names
  assertEquals("error" in buildPropertyDefinitions([{ name: "a", type: "select", options: ["x", "x"] }], g), true); // dup options
});

Deno.test("isPlanLimitExceeded: keyed match only", () => {
  const err = { message: "plan_limit_exceeded:max_workflow_templates" };
  assertEquals(isPlanLimitExceeded(err, "max_workflow_templates"), true);
  assertEquals(isPlanLimitExceeded(err, "max_custom_properties_per_template"), false);
  assertEquals(isPlanLimitExceeded({ message: "other" }, "max_workflow_templates"), false);
  assertEquals(isPlanLimitExceeded(null, "max_workflow_templates"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — the three helpers are not exported from `content.ts`.

- [ ] **Step 3: Implement the helpers in `content.ts`**

Append:
```ts
/** Normalize agent-supplied template etapas into the template etapas JSONB shape
 *  (no ordem, no responsavel_id). Fail-closed; integer-guarded prazo_dias. */
export function normalizeTemplateEtapas(
  etapas: unknown,
): { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[] {
  if (!Array.isArray(etapas)) return [];
  const out: { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[] = [];
  for (const e of etapas) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    out.push({
      nome: typeof o.nome === "string" ? o.nome : "",
      prazo_dias: Number.isInteger(o.prazo_dias) ? (o.prazo_dias as number) : 0,
      tipo_prazo: o.tipo_prazo === "uteis" ? "uteis" : "corridos",
      tipo: o.tipo === "aprovacao_cliente" ? "aprovacao_cliente" : "padrao",
    });
  }
  return out;
}

const OPTION_PROPERTY_TYPES = ["select", "status", "multiselect"];

/** Build template_property_definitions rows (without template_id/conta_id) from
 *  agent input. Generates {id,label,color} option configs; rejects dup names,
 *  dup option labels, and options-vs-type mismatches. Returns {error} or {defs}. */
export function buildPropertyDefinitions(
  properties: Array<{ name: string; type: string; portal_visible?: boolean; options?: string[] }>,
  genId: () => string,
):
  | { error: string }
  | { defs: { name: string; type: string; config: Record<string, unknown>; portal_visible: boolean; display_order: number }[] } {
  const seenNames = new Set<string>();
  const defs: { name: string; type: string; config: Record<string, unknown>; portal_visible: boolean; display_order: number }[] = [];
  for (let i = 0; i < properties.length; i++) {
    const p = properties[i];
    const name = p.name.trim();
    if (seenNames.has(name)) return { error: `Nomes de propriedade duplicados: '${name}'.` };
    seenNames.add(name);

    let config: Record<string, unknown> = {};
    if (OPTION_PROPERTY_TYPES.includes(p.type)) {
      const opts = p.options ?? [];
      if (opts.length === 0) return { error: `A propriedade '${name}' (${p.type}) exige 'options'.` };
      const seenOpt = new Set<string>();
      const options: { id: string; label: string; color: string }[] = [];
      for (const raw of opts) {
        const label = raw.trim();
        if (seenOpt.has(label)) return { error: `Opções duplicadas na propriedade '${name}'.` };
        seenOpt.add(label);
        options.push({ id: genId(), label, color: "#94a3b8" });
      }
      config = { options };
    } else if (p.options && p.options.length > 0) {
      return { error: `A propriedade '${name}' (${p.type}) não aceita 'options'.` };
    }
    defs.push({ name, type: p.type, config, portal_visible: p.portal_visible ?? false, display_order: i });
  }
  return { defs };
}

/** True if a DB error is the plan-count trigger raising for THIS limit key. */
export function isPlanLimitExceeded(error: unknown, limitKey: string): boolean {
  const msg = (error as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg.includes("plan_limit_exceeded:" + limitKey);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS — all four new tests plus the pre-existing `mcp-content_test.ts` tests.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors. Then `git checkout deno.lock supabase/functions/deno.lock` and `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/content.ts supabase/functions/__tests__/mcp-content_test.ts
git commit -m "feat(mcp): template-creation helpers (slice 2c-D)"
```

---

## Task 2: `createWorkflowTemplate` query + query tests

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (add `createWorkflowTemplate`; add `genId?` to `Deps`; import the three helpers)
- Test: `supabase/functions/__tests__/mcp-writes_test.ts` (query tests)

**Interfaces:**
- Consumes: `normalizeTemplateEtapas`, `buildPropertyDefinitions`, `isPlanLimitExceeded` (Task 1); `Deps`, `McpInputError`.
- Produces: `createWorkflowTemplate(d, args: { nome: string; modo_prazo?: string; etapas: Array<{nome:string;prazo_dias?:number;tipo_prazo?:string;tipo?:string}>; properties?: Array<{name:string;type:string;portal_visible?:boolean;options?:string[]}> }): Promise<{ id; nome; modo_prazo; etapas; properties }>`; `Deps.genId?: () => string`.

- [ ] **Step 1: Write the failing tests**

In `mcp-writes_test.ts`, add `createWorkflowTemplate` to the `../mcp/queries.ts` import (alphabetical):
```ts
import { createPost, createWorkflow, createWorkflowTemplate, setPostProperty, updatePost } from "../mcp/queries.ts";
```

Append:
```ts
Deno.test("createWorkflowTemplate: inserts template + property defs with generated option ids", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [{ data: { id: 50, nome: "Modelo", modo_prazo: "padrao" }, error: null }],
    template_property_definitions: [{ data: [
      { id: 77, name: "modo", type: "select", config: { options: [{ id: "opt-1", label: "A", color: "#94a3b8" }] }, portal_visible: false, display_order: 0 },
    ], error: null }],
  });
  let n = 0;
  const deps = { db, ctx: CTX, genId: () => "opt-" + (++n) } as unknown as Deps;
  const out = await createWorkflowTemplate(deps, {
    nome: "Modelo",
    etapas: [{ nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao" }],
    properties: [{ name: "modo", type: "select", options: ["A"] }],
  });

  const tpl = insertPayload(calls, "workflow_templates")!;
  assertEquals(tpl.conta_id, "workspace-A");
  assertEquals(tpl.user_id, "user-1");
  assertEquals(tpl.nome, "Modelo");
  assertEquals(tpl.modo_prazo, "padrao");
  assertEquals((tpl.etapas as any[])[0], { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao" });
  const defRows = insertPayload(calls, "template_property_definitions") as Record<string, unknown>[];
  assertEquals(defRows[0].template_id, 50);
  assertEquals(defRows[0].conta_id, "workspace-A");
  assertEquals((defRows[0].config as any).options[0].id, "opt-1");
  assertEquals(out.id, 50);
  assertEquals(out.properties[0].id, 77);
});

Deno.test("createWorkflowTemplate: modo_prazo honored; no properties -> no defs insert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [{ data: { id: 50, nome: "M", modo_prazo: "data_fixa" }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createWorkflowTemplate(deps, { nome: "M", modo_prazo: "data_fixa", etapas: [{ nome: "E1" }] });
  assertEquals(insertPayload(calls, "workflow_templates")!.modo_prazo, "data_fixa");
  assert(!calls.some((c) => c.table === "template_property_definitions"), "no property defs insert");
  assertEquals(out.properties, []);
});

Deno.test("createWorkflowTemplate: template cap -> friendly McpInputError, no defs insert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [{ data: null, error: { message: "plan_limit_exceeded:max_workflow_templates" } }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createWorkflowTemplate(deps, { nome: "M", etapas: [{ nome: "E1" }], properties: [{ name: "p", type: "text" }] }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "friendly cap error");
  assert(!calls.some((c) => c.table === "template_property_definitions"), "no property defs insert");
});

Deno.test("createWorkflowTemplate: property cap -> compensating delete + friendly McpInputError", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [
      { data: { id: 50, nome: "M", modo_prazo: "padrao" }, error: null },  // template insert
      { data: null, error: null },                                          // compensating delete result
    ],
    template_property_definitions: [{ data: null, error: { message: "plan_limit_exceeded:max_custom_properties_per_template" } }],
  });
  const deps = { db, ctx: CTX, genId: () => "o" } as unknown as Deps;
  let err: unknown;
  try { await createWorkflowTemplate(deps, { nome: "M", etapas: [{ nome: "E1" }], properties: [{ name: "p", type: "select", options: ["A"] }] }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "friendly cap error");
  assert(has(calls, "workflow_templates", "eq", ["id", 50]) && has(calls, "workflow_templates", "eq", ["conta_id", "workspace-A"]), "compensating delete scoped to id+conta");
  assert(calls.some((c) => c.table === "workflow_templates" && c.method === "delete"), "compensating delete happened");
});

Deno.test("createWorkflowTemplate: cleanup best-effort — delete error does not mask the original error", async () => {
  const { db } = makeFakeDb({
    workflow_templates: [
      { data: { id: 50, nome: "M", modo_prazo: "padrao" }, error: null },          // template insert
      { data: null, error: { message: "delete blew up" } },                         // delete returns its own error
    ],
    template_property_definitions: [{ data: null, error: { message: "plan_limit_exceeded:max_custom_properties_per_template" } }],
  });
  const deps = { db, ctx: CTX, genId: () => "o" } as unknown as Deps;
  let err: unknown;
  try { await createWorkflowTemplate(deps, { nome: "M", etapas: [{ nome: "E1" }], properties: [{ name: "p", type: "select", options: ["A"] }] }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "original friendly cap error still thrown, not the delete error");
});

Deno.test("createWorkflowTemplate: duplicate property names -> McpInputError, no template insert", async () => {
  const { db, calls } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createWorkflowTemplate(deps, { nome: "M", etapas: [{ nome: "E1" }], properties: [{ name: "x", type: "text" }, { name: "x", type: "text" }] }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "validation error");
  assert(!calls.some((c) => c.table === "workflow_templates"), "no template insert");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `createWorkflowTemplate` is not exported from `queries.ts`.

- [ ] **Step 3: Implement in `queries.ts`**

Add `genId?: () => string;` to the `Deps` interface (after `now?`):
```ts
export interface Deps {
  db: SupabaseClient;
  ctx: McpKeyContext;
  signUrl?: (key: string) => Promise<string>;
  now?: () => string;
  genId?: () => string;
}
```

Add the three helpers to the `./content.ts` import block (alphabetical), e.g.:
```ts
  buildPostFeedback,
  buildPropertyDefinitions,
  buildTiptapDoc,
```
```ts
  instantiateTemplateEtapas,
  isPlanLimitExceeded,
  normalizeTemplateEtapas,
  pageContentToMarkdown,
```

Add the function (end of the `// ---- writes ----` section):
```ts
export async function createWorkflowTemplate(
  d: Deps,
  args: {
    nome: string;
    modo_prazo?: string;
    etapas: Array<{ nome: string; prazo_dias?: number; tipo_prazo?: string; tipo?: string }>;
    properties?: Array<{ name: string; type: string; portal_visible?: boolean; options?: string[] }>;
  },
): Promise<any> {
  const etapas = normalizeTemplateEtapas(args.etapas);

  let defs: { name: string; type: string; config: Record<string, unknown>; portal_visible: boolean; display_order: number }[] = [];
  if (args.properties && args.properties.length > 0) {
    const genId = d.genId ?? (() => crypto.randomUUID());
    const built = buildPropertyDefinitions(args.properties, genId);
    if ("error" in built) throw new McpInputError(built.error);
    defs = built.defs;
  }

  const { data: tpl, error: tErr } = await d.db
    .from("workflow_templates")
    .insert({
      conta_id: d.ctx.conta_id,
      user_id: d.ctx.created_by,
      nome: args.nome,
      etapas,
      modo_prazo: args.modo_prazo ?? "padrao",
    })
    .select("id, nome, modo_prazo")
    .single();
  if (tErr) {
    if (isPlanLimitExceeded(tErr, "max_workflow_templates")) {
      throw new McpInputError("Limite de modelos (templates) do plano foi atingido.");
    }
    throw tErr;
  }

  let properties: any[] = [];
  if (defs.length > 0) {
    const rows = defs.map((p) => ({ ...p, template_id: tpl.id, conta_id: d.ctx.conta_id }));
    const { data: inserted, error: pErr } = await d.db
      .from("template_property_definitions")
      .insert(rows)
      .select("id, name, type, config, portal_visible, display_order");
    if (pErr) {
      // Best-effort compensating cleanup — must NOT mask the original insert error.
      try {
        await d.db.from("workflow_templates").delete().eq("id", tpl.id).eq("conta_id", d.ctx.conta_id);
      } catch (_) { /* swallow: the original pErr is the response */ }
      if (isPlanLimitExceeded(pErr, "max_custom_properties_per_template")) {
        throw new McpInputError("Limite de propriedades personalizadas do plano foi atingido.");
      }
      throw pErr;
    }
    properties = ((inserted ?? []) as any[]).sort((a, b) => a.display_order - b.display_order);
  }

  return { id: tpl.id, nome: tpl.nome, modo_prazo: tpl.modo_prazo ?? null, etapas, properties };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS — all `createWorkflowTemplate` tests + Task 1 + pre-existing.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors. Then `git checkout deno.lock supabase/functions/deno.lock` and `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-writes_test.ts
git commit -m "feat(mcp): createWorkflowTemplate query (slice 2c-D)"
```

---

## Task 3: `templates:write` scope + register the tool + audit/scope tests

**Files:**
- Modify: `supabase/functions/_shared/mcp-token.ts` (add `templates:write` to `MCP_ALLOWED_SCOPES`)
- Modify: `supabase/functions/mcp/tools.ts` (import `createWorkflowTemplate`; register the tool)
- Test: `supabase/functions/__tests__/mcp-writes_test.ts` (audit wrapper test); `supabase/functions/__tests__/mcp-keys_test.ts` (positive `validateScopes` + comment fix)

**Interfaces:**
- Consumes: `createWorkflowTemplate` (Task 2); `register`, `z`.
- Produces: the `create_workflow_template` tool under `templates:write`; `templates:write` is now an allowlisted scope.

- [ ] **Step 1: Write the failing tests**

In `mcp-writes_test.ts`, append the audit wrapper test:
```ts
Deno.test("create_workflow_template tool redacts etapa/option detail from the audit log", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [{ data: { id: 50, nome: "Modelo", modo_prazo: "padrao" }, error: null }],
    audit_log: [{ data: null, error: null }],
  });
  const deps = { db, ctx: { ...CTX, scopes: ["templates:write"] }, genId: () => "o" } as unknown as Deps;
  const server = {
    handlers: {} as Record<string, (a: unknown) => Promise<unknown>>,
    // deno-lint-ignore no-explicit-any
    tool(name: string, _d: any, _s: any, h: any) { this.handlers[name] = h; },
  };
  // deno-lint-ignore no-explicit-any
  registerTools(server as any, deps);
  await server.handlers["create_workflow_template"]({ nome: "Modelo", etapas: [{ nome: "ETAPA_SECRETA" }] });
  const auditInsert = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(auditInsert, "audit_log insert happened");
  const meta = JSON.stringify(auditInsert!.args[0]);
  assert(!meta.includes("ETAPA_SECRETA"), "etapa detail must not be logged");
  assert(meta.includes("etapa_count"), "logs etapa_count instead");
  assertEquals((auditInsert!.args[0] as Record<string, unknown>).resource_id, "");
});
```

In `mcp-keys_test.ts`: add a positive assertion to the "accepts" test and fix the stale comment.
- In `Deno.test("validateScopes accepts non-empty allowlisted scopes", …)` add:
  ```ts
  assertEquals(validateScopes(["templates:write"]), true);
  ```
- Change the line-11 comment from `// write reserved for PR 3` to `// clientes:write is not a granted scope`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `validateScopes(["templates:write"])` is `false` (not yet allowlisted) and `server.handlers["create_workflow_template"]` is `undefined` (tool not registered).

- [ ] **Step 3: Add the scope to `_shared/mcp-token.ts`**

```ts
export const MCP_ALLOWED_SCOPES = [
  "clientes:read", "posts:read", "workflows:read", "ideias:read", "posts:write", "templates:write",
] as const;
```
(Leave `MCP_AGENT_PRESET` unchanged — read-only.)

- [ ] **Step 4: Register the tool in `tools.ts`**

Add `createWorkflowTemplate` to the `./queries.ts` import block (alphabetical, near `createWorkflow`). Add a `PROPERTY_TYPE` enum next to the other `z.enum` consts (`STATUS_CLIENTE`/`FORMATO`/`METRIC`):
```ts
const PROPERTY_TYPE = z.enum([
  "text", "url", "email", "phone", "number", "date", "checkbox", "select", "status", "multiselect",
]);
```
Register after the `set_post_property` registration:
```ts
  register(server, deps, "create_workflow_template", "templates:write",
    "Cria um modelo de fluxo (template): etapas e, opcionalmente, o esquema de propriedades personalizadas. Retorna o modelo criado.",
    {
      nome: z.string().trim().min(1).max(120),
      modo_prazo: z.enum(["padrao", "data_fixa", "data_entrega"]).optional(),
      etapas: z.array(z.object({
        nome: z.string().trim().min(1).max(120),
        prazo_dias: z.number().int().min(0).optional(),
        tipo_prazo: z.enum(["uteis", "corridos"]).optional(),
        tipo: z.enum(["padrao", "aprovacao_cliente"]).optional(),
      })).min(1).max(50),
      properties: z.array(z.object({
        name: z.string().trim().min(1).max(120),
        type: PROPERTY_TYPE,
        portal_visible: z.boolean().optional(),
        options: z.array(z.string().trim().min(1).max(120)).min(1).max(50).optional(),
      })).max(50).optional(),
    },
    (a) => createWorkflowTemplate(deps, a),
    (a) => ({ nome: a.nome, etapa_count: a.etapas?.length ?? 0, property_count: a.properties?.length ?? 0 }));
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test:functions`
Expected: PASS — the audit wrapper test, the positive `validateScopes` assertion, and all pre-existing tests (including `mcp-oauth_test.ts`, whose bad-scope example `admin:delete` is still invalid → no change needed there).

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors. Then `git checkout deno.lock supabase/functions/deno.lock` and `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/mcp-token.ts supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-writes_test.ts supabase/functions/__tests__/mcp-keys_test.ts
git commit -m "feat(mcp): register create_workflow_template under templates:write scope (slice 2c-D)"
```

---

## Task 4: Frontend scope mirror (`mcp-scopes.ts`)

**Files:**
- Modify: `apps/crm/src/lib/mcp-scopes.ts` (add the `templates:write` option)
- Test: `apps/crm/src/lib/__tests__/mcp-scopes.test.ts` (new)

**Interfaces:**
- Consumes: `SCOPE_OPTIONS`, `AGENT_PRESET` from `../mcp-scopes`.
- Produces: `templates:write` present in `SCOPE_OPTIONS`, absent from `AGENT_PRESET`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/mcp-scopes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SCOPE_OPTIONS, AGENT_PRESET } from '../mcp-scopes';

describe('mcp-scopes', () => {
  it('offers templates:write as a selectable scope', () => {
    expect(SCOPE_OPTIONS.some((s) => s.value === 'templates:write')).toBe(true);
  });
  it('keeps writes out of the read-only AGENT_PRESET', () => {
    expect(AGENT_PRESET).not.toContain('templates:write');
    expect(AGENT_PRESET).not.toContain('posts:write');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- mcp-scopes`
Expected: FAIL — `templates:write` is not yet in `SCOPE_OPTIONS`.

- [ ] **Step 3: Add the option in `mcp-scopes.ts`**

```ts
export const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)' },
  { value: 'posts:read', label: 'Posts (leitura)' },
  { value: 'workflows:read', label: 'Fluxos (leitura)' },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)' },
  { value: 'posts:write', label: 'Posts (escrita)' },
  { value: 'templates:write', label: 'Modelos (escrita)' },
] as const;
```
(Leave `AGENT_PRESET` unchanged — read-only.)

- [ ] **Step 4: Run the test + build to verify**

Run: `npm run test -- mcp-scopes`
Expected: PASS.

Run: `npm run build`
Expected: tsc + vite build succeed (no type errors).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/mcp-scopes.ts apps/crm/src/lib/__tests__/mcp-scopes.test.ts
git commit -m "feat(mcp): add templates:write to CRM scope options (slice 2c-D)"
```

---

## Rollout (gated — the heavier one; scope change)

**No migration.** A scope was added → deploy all three functions + the CRM:

1. `npx supabase functions deploy mcp --no-verify-jwt --project-ref skjzpekeqefvlojenfsw` then `mcp-oauth-consent` and `mcp-keys` (JWT-on, no flag), then the same three for `--project-ref wlyzhyfondykzpsiqsce` (staging). After each batch, `git checkout deno.lock supabase/functions/deno.lock && npm ci`.
2. Deploy the CRM (Vercel) for the `mcp-scopes.ts` mirror.
3. Smoke test: a `templates:write` key/connection runs `create_workflow_template` (etapas + a select property); confirm it appears in `list_workflow_templates` with the etapas + property (option ids present); `create_workflow({ template_id })` instantiates it; a `posts:write`-only key is permission-denied; a duplicate-option-label call returns the `McpInputError`; a workspace at its template cap returns the friendly limit message.
