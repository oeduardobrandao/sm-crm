# `create_workflow` gains `template_id` (slice 2c-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `template_id` to the existing `create_workflow` MCP tool so an agent-created workflow records that template and instantiates its etapa structure (instead of the single default step).

**Architecture:** A pure `instantiateTemplateEtapas` helper in `mcp/content.ts` (template etapas JSONB → workflow_etapa rows, integer-guarded, `responsavel_id` kept, no `workflow_id`), plus changes to `createWorkflow` in `mcp/queries.ts` (tenant-scoped template fetch → instantiate-or-default → one batch `workflow_etapas` insert → record `template_id`), with the `create_workflow` tool's Zod shape + audit redactor extended in `mcp/tools.ts`. No migration, no new scope, no frontend change.

**Tech Stack:** Deno edge function, supabase-js (service-role client), Zod, Deno test runner (`npm run test:functions`).

**Spec:** `docs/superpowers/specs/2026-06-24-mcp-create-workflow-template-design.md`

## Global Constraints

- Reuse the existing `posts:write` scope. **No** migration, **no** `_shared/mcp-token.ts` change, **no** frontend change.
- `template_id` is **optional**; omit → today's behavior (single default "Conteúdo" etapa). `template_id` is always present in the response (the value, or explicit `null`).
- Agent-created workflows stay `modo_prazo: "padrao"`, `created_via: "agent"`, all etapas `data_limite: null` — **regardless of the template's mode** (deadlines deferred / human-owned).
- Template fetch is `conta_id`-scoped; re-throw its DB `error` **before** the not-found `McpInputError`. The compensating workflow delete is also `conta_id`-scoped.
- `instantiateTemplateEtapas` fails closed (`!Array.isArray` → `[]`), skips non-object elements (contiguous `ordem`), keeps `responsavel_id`, and uses `Number.isInteger` for `prazo_dias` (→ `0`) and `responsavel_id` (→ `null`). It returns rows **without** `workflow_id`.
- Etapas are inserted in one batch (array) for **both** the template and default paths; an empty/malformed template etapa list falls back to the single default etapa.
- Verify with `npm run test:functions` and `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`. After any `deno`/`supabase functions` command, restore both lock files (`git checkout deno.lock supabase/functions/deno.lock`) and run `npm ci`.

---

## File Structure

- `supabase/functions/mcp/content.ts` — add `instantiateTemplateEtapas` (pure) — Task 1.
- `supabase/functions/__tests__/mcp-content_test.ts` — unit tests — Task 1.
- `supabase/functions/mcp/queries.ts` — modify `createWorkflow`; add a `defaultEtapa` builder; import `instantiateTemplateEtapas` — Task 2.
- `supabase/functions/mcp/tools.ts` — `create_workflow` Zod gains `template_id`; redactor adds `template_id` — Task 2.
- `supabase/functions/__tests__/mcp-writes_test.ts` — update the existing default-etapa test (array insert) + add template-path tests — Task 2.

---

## Task 1: `instantiateTemplateEtapas` pure helper

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (add the helper, end of file)
- Test: `supabase/functions/__tests__/mcp-content_test.ts` (import + two tests)

**Interfaces:**
- Produces: `export function instantiateTemplateEtapas(rawEtapas: unknown, now: string): { ordem: number; nome: string; prazo_dias: number; tipo_prazo: "uteis"|"corridos"; tipo: "padrao"|"aprovacao_cliente"; responsavel_id: number | null; status: "ativo"|"pendente"; iniciado_em: string | null; concluido_em: null; data_limite: null }[]` — workflow_etapa rows **without** `workflow_id`.

- [ ] **Step 1: Write the failing tests**

Add `instantiateTemplateEtapas` to the existing import block from `../mcp/content.ts` in `mcp-content_test.ts` (alphabetical, after `firstLine`):

```ts
  firstLine,
  instantiateTemplateEtapas,
  pageContentToMarkdown,
```

Append these tests:

```ts
Deno.test("instantiateTemplateEtapas: contiguous ordem, responsavel_id kept, lifecycle fields, no workflow_id", () => {
  const rows = instantiateTemplateEtapas([
    { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao", responsavel_id: 8 },
    { nome: "Aprovação", prazo_dias: 1, tipo_prazo: "corridos", tipo: "aprovacao_cliente" },
  ], "T");
  assertEquals(rows, [
    { ordem: 0, nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao", responsavel_id: 8, status: "ativo", iniciado_em: "T", concluido_em: null, data_limite: null },
    { ordem: 1, nome: "Aprovação", prazo_dias: 1, tipo_prazo: "corridos", tipo: "aprovacao_cliente", responsavel_id: null, status: "pendente", iniciado_em: null, concluido_em: null, data_limite: null },
  ]);
  assert(!Object.hasOwn(rows[0], "workflow_id"), "no workflow_id key");
});

Deno.test("instantiateTemplateEtapas: fail-closed, skip non-objects, integer guards, defaults", () => {
  assertEquals(instantiateTemplateEtapas(null, "T"), []);
  assertEquals(instantiateTemplateEtapas({}, "T"), []);
  assertEquals(instantiateTemplateEtapas("x", "T"), []);
  const rows = instantiateTemplateEtapas(
    [null, "nope", { prazo_dias: 1.5, responsavel_id: 2.7 }, ["arr"], { nome: "ok" }],
    "T",
  );
  assertEquals(rows.length, 2);                  // 2 object elements survive
  assertEquals(rows[0].ordem, 0);
  assertEquals(rows[0].prazo_dias, 0);           // 1.5 (non-integer) -> 0
  assertEquals(rows[0].responsavel_id, null);    // 2.7 (non-integer) -> null
  assertEquals(rows[0].nome, "");                // missing -> ""
  assertEquals(rows[0].tipo_prazo, "corridos");  // default
  assertEquals(rows[0].tipo, "padrao");          // default
  assertEquals(rows[1].ordem, 1);                // contiguous after skips
  assertEquals(rows[1].nome, "ok");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `instantiateTemplateEtapas` is not exported from `content.ts`.

- [ ] **Step 3: Implement the helper in `content.ts`**

Append to the end of `supabase/functions/mcp/content.ts`:

```ts
/** Instantiate a workflow template's `etapas` JSONB into workflow_etapa rows
 *  (WITHOUT workflow_id — the caller attaches it). Fail-closed on malformed JSONB,
 *  skips non-object elements (contiguous ordem), keeps responsavel_id, and uses
 *  Number.isInteger for the integer/bigint columns. First step is ativo+iniciado_em. */
export function instantiateTemplateEtapas(
  rawEtapas: unknown,
  now: string,
): {
  ordem: number; nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos";
  tipo: "padrao" | "aprovacao_cliente"; responsavel_id: number | null;
  status: "ativo" | "pendente"; iniciado_em: string | null;
  concluido_em: null; data_limite: null;
}[] {
  if (!Array.isArray(rawEtapas)) return [];
  const objs = rawEtapas.filter(
    (e) => e && typeof e === "object" && !Array.isArray(e),
  ) as Record<string, unknown>[];
  return objs.map((o, i) => ({
    ordem: i,
    nome: typeof o.nome === "string" ? o.nome : "",
    prazo_dias: Number.isInteger(o.prazo_dias) ? (o.prazo_dias as number) : 0,
    tipo_prazo: o.tipo_prazo === "uteis" ? "uteis" : "corridos",
    tipo: o.tipo === "aprovacao_cliente" ? "aprovacao_cliente" : "padrao",
    responsavel_id: Number.isInteger(o.responsavel_id) ? (o.responsavel_id as number) : null,
    status: i === 0 ? "ativo" : "pendente",
    iniciado_em: i === 0 ? now : null,
    concluido_em: null,
    data_limite: null,
  }));
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
git commit -m "feat(mcp): instantiateTemplateEtapas helper (slice 2c-B)"
```

---

## Task 2: `createWorkflow` template support + tool delta + test updates

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (`createWorkflow` + `defaultEtapa`; import `instantiateTemplateEtapas`)
- Modify: `supabase/functions/mcp/tools.ts` (`create_workflow` Zod `template_id` + redactor field)
- Test: `supabase/functions/__tests__/mcp-writes_test.ts` (update the existing default-etapa test; add template-path tests)

**Interfaces:**
- Consumes: `instantiateTemplateEtapas` (Task 1); the existing `Deps`, `McpInputError`, `verifyClient`.
- Produces: `createWorkflow(d, args: { client_id: number; titulo: string; template_id?: number })` returning the workflow row including `template_id`; the `create_workflow` tool accepting an optional `template_id`.

- [ ] **Step 1: Write the failing tests**

In `mcp-writes_test.ts`, add `createWorkflow` is already imported (it is, from slice 2a). **Replace** the existing test named `"createWorkflow: ownership-checked, agent-stamped, with default etapa"` with this updated version (array-insert shape + `template_id: null`):

```ts
Deno.test("createWorkflow: ownership-checked, agent-stamped, default etapa (no template)", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, template_id: null, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const out = await createWorkflow(deps, { client_id: 5, titulo: "X" });

  assert(has(calls, "clientes", "eq", ["conta_id", "workspace-A"]), "client ownership scoped");
  assert(has(calls, "clientes", "eq", ["id", 5]), "client ownership checks the id");
  assert(!calls.some((c) => c.table === "workflow_templates"), "no template fetch when template_id omitted");
  const wf = insertPayload(calls, "workflows")!;
  assertEquals(wf.created_via, "agent");
  assertEquals(wf.status, "ativo");
  assertEquals(wf.conta_id, "workspace-A");
  assertEquals(wf.user_id, "user-1");
  assertEquals(wf.template_id, null);                 // explicit null for the old path
  const rows = insertPayload(calls, "workflow_etapas") as Record<string, unknown>[];
  assert(Array.isArray(rows), "etapas inserted as an array");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].ordem, 0);
  assertEquals(rows[0].nome, "Conteúdo");
  assertEquals(rows[0].status, "ativo");
  assertEquals(rows[0].workflow_id, 99);
  assertEquals(out.id, 99);
});
```

Then append these template-path tests:

```ts
Deno.test("createWorkflow: with template instantiates its etapas + records template_id", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflow_templates: [{ data: { id: 12, etapas: [
      { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao", responsavel_id: 8 },
      { nome: "Aprovação", prazo_dias: 1, tipo_prazo: "corridos", tipo: "aprovacao_cliente" },
    ] }, error: null }],
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, template_id: 12, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const out = await createWorkflow(deps, { client_id: 5, titulo: "X", template_id: 12 });

  assert(has(calls, "workflow_templates", "eq", ["conta_id", "workspace-A"]), "template tenant-scoped");
  assert(has(calls, "workflow_templates", "eq", ["id", 12]), "template id checked");
  const wf = insertPayload(calls, "workflows")!;
  assertEquals(wf.template_id, 12);
  const rows = insertPayload(calls, "workflow_etapas") as Record<string, unknown>[];
  assertEquals(rows.length, 2);
  assertEquals(rows[0].nome, "Roteiro");
  assertEquals(rows[0].responsavel_id, 8);            // preserved
  assertEquals(rows[0].status, "ativo");
  assertEquals(rows[0].workflow_id, 99);
  assertEquals(rows[1].nome, "Aprovação");
  assertEquals(rows[1].status, "pendente");
  assertEquals(rows[1].workflow_id, 99);
  assertEquals(out.id, 99);
});

Deno.test("createWorkflow: template not found -> McpInputError, no workflow insert", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflow_templates: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createWorkflow(deps, { client_id: 5, titulo: "X", template_id: 12 }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflows" && c.method === "insert"), "no workflow insert");
});

Deno.test("createWorkflow: template with empty etapas falls back to the default step", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflow_templates: [{ data: { id: 12, etapas: [] }, error: null }],
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, template_id: 12, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  await createWorkflow(deps, { client_id: 5, titulo: "X", template_id: 12 });
  const rows = insertPayload(calls, "workflow_etapas") as Record<string, unknown>[];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].nome, "Conteúdo");
  assertEquals(rows[0].workflow_id, 99);
});

Deno.test("createWorkflow: template with malformed (non-array) etapas falls back to default", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflow_templates: [{ data: { id: 12, etapas: null }, error: null }],
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, template_id: 12, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  await createWorkflow(deps, { client_id: 5, titulo: "X", template_id: 12 });
  const rows = insertPayload(calls, "workflow_etapas") as Record<string, unknown>[];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].nome, "Conteúdo");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — `createWorkflow` doesn't accept `template_id` / doesn't fetch the template / still inserts a single etapa object (the updated default test's `Array.isArray(rows)` and the template-path tests fail).

- [ ] **Step 3: Modify `createWorkflow` in `queries.ts`**

Add `instantiateTemplateEtapas` to the existing `./content.ts` import block (alphabetical, near `firstLine`/`pageContentToMarkdown`):

```ts
  firstLine,
  instantiateTemplateEtapas,
  pageContentToMarkdown,
```

Replace the existing `createWorkflow` function with this version, and add the `defaultEtapa` builder just above it:

```ts
function defaultEtapa(now: string) {
  return {
    ordem: 0, nome: "Conteúdo", prazo_dias: 0, tipo_prazo: "corridos", tipo: "padrao",
    status: "ativo", iniciado_em: now, responsavel_id: null, concluido_em: null, data_limite: null,
  };
}

export async function createWorkflow(
  d: Deps,
  args: { client_id: number; titulo: string; template_id?: number },
): Promise<any> {
  const client = await verifyClient(d, args.client_id);
  if (!client) throw new McpInputError("Cliente não encontrado neste workspace.");

  // Optional template (tenant-scoped); DB error re-thrown before the not-found check.
  let template: any = null;
  if (args.template_id !== undefined) {
    const { data, error } = await d.db
      .from("workflow_templates")
      .select("id, etapas")
      .eq("conta_id", d.ctx.conta_id)
      .eq("id", args.template_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new McpInputError("Modelo (template) não encontrado neste workspace.");
    template = data;
  }

  const { data: wf, error: wfErr } = await d.db
    .from("workflows")
    .insert({
      conta_id: d.ctx.conta_id,
      user_id: d.ctx.created_by,
      cliente_id: args.client_id,
      titulo: args.titulo,
      status: "ativo",
      etapa_atual: 0,
      recorrente: false,
      modo_prazo: "padrao",
      created_via: "agent",
      template_id: args.template_id ?? null,
    })
    .select("id, cliente_id, titulo, status, etapa_atual, template_id, created_via, created_at")
    .single();
  if (wfErr) throw wfErr;

  const now = d.now?.() ?? new Date().toISOString();
  const base = template ? instantiateTemplateEtapas(template.etapas, now) : [];
  const source = base.length > 0 ? base : [defaultEtapa(now)];
  const rows = source.map((e) => ({ ...e, workflow_id: wf.id }));
  const { error: etErr } = await d.db.from("workflow_etapas").insert(rows);
  if (etErr) {
    // Compensating cleanup: a zero-etapa fluxo renders broken on the board.
    await d.db.from("workflows").delete().eq("conta_id", d.ctx.conta_id).eq("id", wf.id);
    throw etErr;
  }
  return wf;
}
```

- [ ] **Step 4: Update the tool in `tools.ts`**

In the `create_workflow` registration, add the `template_id` Zod field and the redactor field:

```ts
  register(server, deps, "create_workflow", "posts:write",
    "Cria um fluxo de produção (necessário para criar posts). Opcionalmente instancia um modelo (template) com suas etapas. Retorna o fluxo criado.",
    {
      client_id: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(200),
      template_id: z.number().int().positive().optional(),
    },
    (a) => createWorkflow(deps, a),
    (a) => ({ client_id: a.client_id, titulo: a.titulo, template_id: a.template_id }));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS — the updated default-etapa test, all four template-path tests, and all pre-existing tests (incl. Task 1 + the `createPost`/`updatePost`/`setPostProperty` tests).

- [ ] **Step 6: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors. Then `git checkout deno.lock supabase/functions/deno.lock` and `npm ci`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-writes_test.ts
git commit -m "feat(mcp): create_workflow template_id instantiates template etapas (slice 2c-B)"
```

---

## Rollout (gated — requires explicit user go-ahead, NOT part of subagent execution)

No migration, no scope change.

1. Deploy: `npx supabase functions deploy mcp --no-verify-jwt --project-ref skjzpekeqefvlojenfsw` (prod) and `--project-ref wlyzhyfondykzpsiqsce` (staging). After each, `git checkout deno.lock supabase/functions/deno.lock && npm ci`.
2. Smoke test: `list_workflow_templates` → `create_workflow({ client_id, titulo, template_id })`; confirm the new fluxo appears in entregas with the template's etapas (first step active) and the "IA" badge; `create_post` into it; then `set_post_property` on that post succeeds (the workflow now has a template). Confirm a foreign/unknown `template_id` returns the `McpInputError`, and `create_workflow` without `template_id` still produces the single default etapa.
