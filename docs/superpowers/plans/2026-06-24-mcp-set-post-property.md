# `set_post_property` MCP write tool (slice 2c-C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `set_post_property` MCP tool that writes a custom property value on a post, validated against the post's template's real property definition (type + options), confined to the agent's internal-editable statuses.

**Architecture:** Two pure validators in `mcp/content.ts` (`extractTemplateOptionIds`, `validatePropertyValue`), a `setPostProperty` query in `mcp/queries.ts` (tenant-scoped post+template prefetch → template-constrained definition check → option-aware value validation → status-first-for-correcao_cliente write → `post_property_values` upsert), registered as one tool in `mcp/tools.ts` under the existing `posts:write` scope with an audit redactor. No migration, no new scope, no frontend change.

**Tech Stack:** Deno edge function, supabase-js (service-role client), Zod, Deno test runner (`npm run test:functions`).

**Spec:** `docs/superpowers/specs/2026-06-24-mcp-set-post-property-design.md`

## Global Constraints

- Reuse the existing `posts:write` scope. **No** migration, **no** `_shared/mcp-token.ts` change, **no** frontend change.
- **Template-constrained:** the definition's `template_id` must equal the post's workflow's `template_id`; if the workflow has no template, reject.
- **Status boundary:** reuse `EDITABLE_STATUSES` (`["rascunho","revisao_interna","correcao_cliente"]`, already a module const in `queries.ts` from slice 2b). For `correcao_cliente`: do the guarded status move to `revisao_interna` **first** (abort with `McpInputError` if it returns no row), **then** upsert. For `rascunho`/`revisao_interna`: upsert directly.
- **Value validation per type** via `validatePropertyValue`; `null` clears any *settable* type; `person`/`created_time`/unknown are rejected (cannot be set or cleared).
- `select`/`status`/`multiselect` value = option id(s) drawn from `config.options[].id` ∪ the post's `workflow_select_options` (scoped `conta_id` + `workflow_id` + `property_definition_id`).
- All reads/writes `conta_id`-scoped; the post fetch also filters the embedded `workflows.conta_id`. **Re-throw every DB `error`**; only app-level guard failures throw `McpInputError`.
- `post_property_values.upsert` uses `onConflict: "post_id,property_definition_id"` and `updated_at: d.now?.() ?? new Date().toISOString()`.
- Audit redactor logs `value_kind` (null/array-aware), `value_len` (strings), `value_count` (arrays) — **never** the raw value.
- Verify with `npm run test:functions` and `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`. After any `deno`/`supabase functions` command, restore both lock files (`git checkout deno.lock supabase/functions/deno.lock`) and run `npm ci`.

---

## File Structure

- `supabase/functions/mcp/content.ts` — `extractTemplateOptionIds`, `validatePropertyValue` (pure) — Task 1.
- `supabase/functions/__tests__/mcp-content_test.ts` — unit tests for both — Task 1.
- `supabase/functions/mcp/queries.ts` — `setPostProperty` (+ `OPTION_TYPES` const); import the two helpers — Task 2.
- `supabase/functions/__tests__/mcp-writes_test.ts` — extend the fake `db` with `upsert` + an `upsertPayload` helper; add `setPostProperty` query tests (Task 2) and the audit-redaction wrapper test (Task 3).
- `supabase/functions/mcp/tools.ts` — register `set_post_property` under `posts:write` with the redactor; import `setPostProperty` — Task 3.

---

## Task 1: Pure validators (`extractTemplateOptionIds`, `validatePropertyValue`)

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (add both helpers after `projectTemplateEtapas`, end of file)
- Test: `supabase/functions/__tests__/mcp-content_test.ts` (add imports + two tests)

**Interfaces:**
- Produces: `export function extractTemplateOptionIds(config: unknown): string[]` and `export function validatePropertyValue(type: string, value: unknown, allowedOptionIds: Set<string>): string | null` (returns a caller-safe error message, or `null` if valid).

- [ ] **Step 1: Write the failing tests**

Add to the existing import block from `../mcp/content.ts` in `mcp-content_test.ts` (alphabetical):

```ts
  buildTiptapDoc,
  deriveFormatMeta,
  extractTemplateOptionIds,
  firstLine,
```
and
```ts
  topDistinctPostIds,
  validatePropertyValue,
```

Append these tests:

```ts
Deno.test("extractTemplateOptionIds pulls string ids from config.options, defensive", () => {
  assertEquals(extractTemplateOptionIds({ options: [{ id: "a", label: "A" }, { id: "b" }] }), ["a", "b"]);
  assertEquals(extractTemplateOptionIds({ options: [{ label: "no id" }, { id: 5 }, "x", null] }), []);
  assertEquals(extractTemplateOptionIds({}), []);
  assertEquals(extractTemplateOptionIds(null), []);
  assertEquals(extractTemplateOptionIds([{ id: "a" }]), []); // array config, not object-with-options
  assertEquals(extractTemplateOptionIds("x"), []);
});

Deno.test("validatePropertyValue: settable types, null clear, non-settable rejection, options", () => {
  const opts = new Set(["o1", "o2"]);
  // null clears any settable type
  assertEquals(validatePropertyValue("text", null, opts), null);
  assertEquals(validatePropertyValue("select", null, opts), null);
  // non-settable rejected even for null
  assert(validatePropertyValue("person", null, opts) !== null);
  assert(validatePropertyValue("created_time", "2026-01-01", opts) !== null);
  assert(validatePropertyValue("bogus", "x", opts) !== null);
  // scalars: happy + mismatch
  assertEquals(validatePropertyValue("text", "hi", opts), null);
  assert(validatePropertyValue("text", 5, opts) !== null);
  assertEquals(validatePropertyValue("number", 5, opts), null);
  assert(validatePropertyValue("number", "5", opts) !== null);
  assertEquals(validatePropertyValue("checkbox", true, opts), null);
  assert(validatePropertyValue("checkbox", "true", opts) !== null);
  assertEquals(validatePropertyValue("date", "2026-06-24", opts), null);
  assert(validatePropertyValue("date", "24/06/2026", opts) !== null);
  // select/status option membership
  assertEquals(validatePropertyValue("select", "o1", opts), null);
  assert(validatePropertyValue("select", "nope", opts) !== null);
  assertEquals(validatePropertyValue("status", "o2", opts), null);
  // multiselect
  assertEquals(validatePropertyValue("multiselect", ["o1", "o2"], opts), null);
  assert(validatePropertyValue("multiselect", ["o1", "nope"], opts) !== null);
  assert(validatePropertyValue("multiselect", "o1", opts) !== null); // not an array
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `extractTemplateOptionIds` / `validatePropertyValue` are not exported from `content.ts`.

- [ ] **Step 3: Implement both helpers in `content.ts`**

Append to the end of `supabase/functions/mcp/content.ts`:

```ts
/** Pull the string `id`s out of a select/status/multiselect definition's `config.options`.
 *  Fully defensive: config / options / element / id may be malformed. */
export function extractTemplateOptionIds(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const options = (config as Record<string, unknown>).options;
  if (!Array.isArray(options)) return [];
  const ids: string[] = [];
  for (const opt of options) {
    if (opt && typeof opt === "object" && !Array.isArray(opt)) {
      const id = (opt as Record<string, unknown>).id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

const SETTABLE_PROPERTY_TYPES = new Set([
  "text", "url", "email", "phone", "number", "date", "checkbox", "select", "status", "multiselect",
]);

/** Validate a property value against its definition type. Returns a caller-safe
 *  error message, or null if valid. `null` clears any settable type. */
export function validatePropertyValue(
  type: string,
  value: unknown,
  allowedOptionIds: Set<string>,
): string | null {
  if (!SETTABLE_PROPERTY_TYPES.has(type)) {
    return `Tipo de propriedade '${type}' não pode ser definido pelo agente.`;
  }
  if (value === null) return null; // clear
  switch (type) {
    case "text":
    case "url":
    case "email":
    case "phone":
      return typeof value === "string" ? null : "O valor deve ser um texto.";
    case "number":
      return typeof value === "number" ? null : "O valor deve ser um número.";
    case "checkbox":
      return typeof value === "boolean" ? null : "O valor deve ser booleano (true/false).";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? null
        : "O valor deve ser uma data no formato AAAA-MM-DD.";
    case "select":
    case "status":
      return typeof value === "string" && allowedOptionIds.has(value)
        ? null
        : "Opção inválida para esta propriedade.";
    case "multiselect":
      return Array.isArray(value) && value.every((v) => typeof v === "string" && allowedOptionIds.has(v))
        ? null
        : "Uma ou mais opções são inválidas para esta propriedade.";
    default:
      return `Tipo de propriedade '${type}' não pode ser definido pelo agente.`;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS — both new tests plus all pre-existing `mcp-content_test.ts` tests.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors. Then `git checkout deno.lock supabase/functions/deno.lock` and `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/content.ts supabase/functions/__tests__/mcp-content_test.ts
git commit -m "feat(mcp): property-value validators (slice 2c-C)"
```

---

## Task 2: `setPostProperty` query + query tests

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (add `OPTION_TYPES` + `setPostProperty`; import the two helpers from `./content.ts`)
- Test: `supabase/functions/__tests__/mcp-writes_test.ts` (extend fake `db` with `upsert` + `upsertPayload` helper; add the query tests)

**Interfaces:**
- Consumes: `extractTemplateOptionIds`, `validatePropertyValue` (Task 1); the existing `Deps`, `McpInputError`, and the module-private `EDITABLE_STATUSES` const (slice 2b) already in `queries.ts`.
- Produces: `export async function setPostProperty(d: Deps, args: { post_id: number; property_id: number; value: unknown }): Promise<{ post_id: number; property_id: number; value: unknown; status: string }>`.

- [ ] **Step 1: Write the failing tests**

In `mcp-writes_test.ts`, add `"upsert"` to the fake-db chainable-method list (the `for (const m of [...])` line):

```ts
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "update", "upsert", "delete"]) {
```

Add `setPostProperty` to the import from `../mcp/queries.ts`:

```ts
import { createPost, createWorkflow, setPostProperty, updatePost } from "../mcp/queries.ts";
```

Add an `upsertPayload` helper next to `updatePayload`:

```ts
function upsertPayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "upsert");
  return c?.args[0] as Record<string, unknown> | undefined;
}
```

Append these tests:

```ts
Deno.test("setPostProperty: tenant+template scoped, select option, upsert with d.now", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "modo", type: "select", config: { options: [{ id: "t1" }] } }, error: null }],
    workflow_select_options: [{ data: [{ option_id: "w1" }], error: null }],
    post_property_values: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const out = await setPostProperty(deps, { post_id: 7, property_id: 45, value: "w1" });

  assert(has(calls, "workflow_posts", "eq", ["conta_id", "workspace-A"]), "post tenant-scoped");
  assert(has(calls, "workflow_posts", "eq", ["workflows.conta_id", "workspace-A"]), "embedded workflow tenant-scoped");
  assert(has(calls, "template_property_definitions", "eq", ["conta_id", "workspace-A"]), "def tenant-scoped");
  assert(has(calls, "workflow_select_options", "eq", ["workflow_id", 3]), "options workflow-scoped");
  assert(has(calls, "workflow_select_options", "eq", ["property_definition_id", 45]), "options def-scoped");
  const payload = upsertPayload(calls, "post_property_values")!;
  assertEquals(payload.post_id, 7);
  assertEquals(payload.property_definition_id, 45);
  assertEquals(payload.value, "w1");                 // valid workflow option
  assertEquals(payload.updated_at, "T");             // d.now injected
  assertEquals(out.status, "rascunho");
});

Deno.test("setPostProperty: missing post -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({ workflow_posts: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: non-editable status -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "postado", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: workflow without template -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: null, conta_id: "workspace-A" } }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: property from another template -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
    template_property_definitions: [{ data: { id: 45, template_id: 99, name: "x", type: "text", config: {} }, error: null }], // 99 != 9
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: invalid select option -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "modo", type: "select", config: { options: [{ id: "t1" }] } }, error: null }],
    workflow_select_options: [{ data: [{ option_id: "w1" }], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "nope" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: correcao_cliente moves to revisao_interna BEFORE the upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "correcao_cliente", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }, // fetch
      { data: { id: 7 }, error: null }, // guarded move result
    ],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "anot", type: "text", config: {} }, error: null }],
    post_property_values: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const out = await setPostProperty(deps, { post_id: 7, property_id: 45, value: "nota" });

  assert(has(calls, "workflow_posts", "update", [{ status: "revisao_interna" }]), "moves to revisao_interna");
  assert(has(calls, "workflow_posts", "eq", ["status", "correcao_cliente"]), "guarded on correcao_cliente");
  const moveIdx = calls.findIndex((c) => c.table === "workflow_posts" && c.method === "update");
  const upsertIdx = calls.findIndex((c) => c.table === "post_property_values" && c.method === "upsert");
  assert(moveIdx >= 0 && upsertIdx >= 0 && moveIdx < upsertIdx, "status move happens before the upsert");
  assertEquals(out.status, "revisao_interna");
});

Deno.test("setPostProperty: correcao_cliente move returns null (race) -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "correcao_cliente", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null },
      { data: null, error: null }, // guarded move matched nothing
    ],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "anot", type: "text", config: {} }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "nota" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert after a failed move");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `setPostProperty` is not exported from `queries.ts`.

- [ ] **Step 3: Implement `setPostProperty` in `queries.ts`**

Add the two helpers to the existing `./content.ts` import block (alphabetical):

```ts
  deriveFormatMeta,
  extractTemplateOptionIds,
  FeedbackRow,
```
and
```ts
  topDistinctPostIds,
  validatePropertyValue,
```

Add the function (after `updatePost`, end of the `// ---- writes ----` section):

```ts
const OPTION_TYPES = ["select", "status", "multiselect"];

export async function setPostProperty(
  d: Deps,
  args: { post_id: number; property_id: number; value: unknown },
): Promise<{ post_id: number; property_id: number; value: unknown; status: string }> {
  // 1. Fetch post + its template (tenant-scoped, + embedded workflow tenant check).
  const { data: post, error: postErr } = await d.db
    .from("workflow_posts")
    .select("id, status, workflow_id, workflows!inner(template_id, conta_id)")
    .eq("conta_id", d.ctx.conta_id)
    .eq("workflows.conta_id", d.ctx.conta_id)
    .eq("id", args.post_id)
    .maybeSingle();
  if (postErr) throw postErr;
  if (!post) throw new McpInputError("Post não encontrado neste workspace.");
  const p = post as any;
  if (!EDITABLE_STATUSES.includes(p.status)) {
    throw new McpInputError(`Post em estado '${p.status}' não pode ser editado pelo agente.`);
  }
  const templateId = p.workflows?.template_id ?? null;
  if (templateId === null) {
    throw new McpInputError("O fluxo deste post não usa um modelo, então não há propriedades para definir.");
  }

  // 2. Fetch the definition + verify it belongs to the post's template.
  const { data: def, error: defErr } = await d.db
    .from("template_property_definitions")
    .select("id, template_id, name, type, config")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.property_id)
    .maybeSingle();
  if (defErr) throw defErr;
  if (!def) throw new McpInputError("Propriedade não encontrada neste workspace.");
  const dfn = def as any;
  if (dfn.template_id !== templateId) {
    throw new McpInputError("Esta propriedade não pertence ao modelo do fluxo deste post.");
  }

  // 3. Build allowed option ids (only for option types).
  const allowed = new Set(extractTemplateOptionIds(dfn.config));
  if (OPTION_TYPES.includes(dfn.type)) {
    const { data: wso, error: wsoErr } = await d.db
      .from("workflow_select_options")
      .select("option_id")
      .eq("conta_id", d.ctx.conta_id)
      .eq("workflow_id", p.workflow_id)
      .eq("property_definition_id", args.property_id);
    if (wsoErr) throw wsoErr;
    for (const o of (wso ?? []) as any[]) allowed.add(o.option_id);
  }

  // 4. Validate the value against the definition type.
  const verr = validatePropertyValue(dfn.type, args.value, allowed);
  if (verr) throw new McpInputError(verr);

  // 5. Write — status-first for correcao_cliente (pull out of client view), then upsert.
  let status = p.status as string;
  if (status === "correcao_cliente") {
    const { data: moved, error: moveErr } = await d.db
      .from("workflow_posts")
      .update({ status: "revisao_interna" })
      .eq("conta_id", d.ctx.conta_id)
      .eq("id", args.post_id)
      .eq("status", "correcao_cliente")
      .select("id")
      .maybeSingle();
    if (moveErr) throw moveErr;
    if (!moved) throw new McpInputError("O status do post mudou; tente novamente.");
    status = "revisao_interna";
  }

  const { error: upErr } = await d.db
    .from("post_property_values")
    .upsert(
      {
        post_id: args.post_id,
        property_definition_id: args.property_id,
        value: args.value,
        updated_at: d.now?.() ?? new Date().toISOString(),
      },
      { onConflict: "post_id,property_definition_id" },
    );
  if (upErr) throw upErr;

  return { post_id: args.post_id, property_id: args.property_id, value: args.value, status };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS — all `setPostProperty` query tests, plus Task 1 and pre-existing tests.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors. Then `git checkout deno.lock supabase/functions/deno.lock` and `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-writes_test.ts
git commit -m "feat(mcp): setPostProperty query (template-constrained, guarded, slice 2c-C)"
```

---

## Task 3: Register the `set_post_property` tool + audit-redaction test

**Files:**
- Modify: `supabase/functions/mcp/tools.ts` (import `setPostProperty`; register the tool after the `update_post` registration)
- Test: `supabase/functions/__tests__/mcp-writes_test.ts` (append the audit-redaction wrapper test)

**Interfaces:**
- Consumes: `setPostProperty` (Task 2); the existing `register(...)` helper and `z`.
- Produces: an MCP tool `set_post_property` under `posts:write` with a redactor logging `{ post_id, property_id, value_kind, value_len?, value_count? }`.

- [ ] **Step 1: Write the failing test**

Append to `mcp-writes_test.ts`:

```ts
Deno.test("set_post_property tool redacts the raw value from the audit log", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "anot", type: "text", config: {} }, error: null }],
    post_property_values: [{ data: null, error: null }],
    audit_log: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const server = {
    handlers: {} as Record<string, (a: unknown) => Promise<unknown>>,
    // deno-lint-ignore no-explicit-any
    tool(name: string, _d: any, _s: any, h: any) { this.handlers[name] = h; },
  };
  // deno-lint-ignore no-explicit-any
  registerTools(server as any, deps);
  await server.handlers["set_post_property"]({ post_id: 7, property_id: 45, value: "ANOTACAO_SECRETA" });
  const auditInsert = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(auditInsert, "audit_log insert happened");
  const meta = JSON.stringify(auditInsert!.args[0]);
  assert(!meta.includes("ANOTACAO_SECRETA"), "raw value must not be logged");
  assert(meta.includes("value_kind"), "logs value_kind instead");
  assertEquals((auditInsert!.args[0] as Record<string, unknown>).resource_id, "7");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:functions`
Expected: FAIL — `server.handlers["set_post_property"]` is `undefined` (tool not registered), so calling it throws a `TypeError`.

- [ ] **Step 3: Register the tool in `tools.ts`**

Add `setPostProperty` to the import block from `./queries.ts` (alongside `listPosts`, `updatePost`, etc.):

```ts
  setPostProperty,
  updatePost,
```

After the `update_post` registration (end of `registerTools`), add:

```ts
  register(server, deps, "set_post_property", "posts:write",
    "Define o valor de uma propriedade personalizada de um post (ex.: modo, anotação). A propriedade deve pertencer ao modelo do fluxo do post; status, mídia e publicação não são afetados.",
    {
      post_id: z.number().int().positive(),
      property_id: z.number().int().positive(),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
    },
    (a) => setPostProperty(deps, a),
    (a) => {
      const v = a.value;
      return {
        post_id: a.post_id,
        property_id: a.property_id,
        value_kind: v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
        value_len: typeof v === "string" ? v.length : undefined,
        value_count: Array.isArray(v) ? v.length : undefined,
      };
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:functions`
Expected: PASS — the audit-redaction test passes, and all Task 1/2 + pre-existing tests still pass.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors. Then `git checkout deno.lock supabase/functions/deno.lock` and `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-writes_test.ts
git commit -m "feat(mcp): register set_post_property tool with audit redaction (slice 2c-C)"
```

---

## Rollout (gated — requires explicit user go-ahead, NOT part of subagent execution)

No migration, no scope change.

1. Deploy: `npx supabase functions deploy mcp --no-verify-jwt --project-ref skjzpekeqefvlojenfsw` (prod) and `--project-ref wlyzhyfondykzpsiqsce` (staging). Only `mcp` is redeployed (no scope change). After each, `git checkout deno.lock supabase/functions/deno.lock && npm ci`.
2. Smoke test: a `posts:write` connection reads `list_workflow_templates`, picks a template-based post in `rascunho`, sets a `select` (`modo`) + a `text` (`anotação`); confirm an out-of-template `property_id`, a non-editable post, and an invalid option each return the `McpInputError`; confirm setting a property on a `correcao_cliente` post moves it to `revisao_interna`.
