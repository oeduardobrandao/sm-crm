# `update_post` MCP write tool (slice 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `update_post` MCP tool that lets an agent revise an existing draft post's content and advance its status within an internal-only boundary, never reaching anything the client sees or that is published.

**Architecture:** A single `updatePost` query helper in `mcp/queries.ts` (tenant-scoped prefetch for friendly errors + an atomic guarded `.update()` that re-checks tenant and editability), registered as one tool in `mcp/tools.ts` under the existing `posts:write` scope with an audit redactor. No migration, no new scope, no frontend change — reuses the `created_via` column, the `posts:write` scope, `buildTiptapDoc`, and the `register()`/`auditArgs` plumbing all shipped in slice 2a (#146).

**Tech Stack:** Deno edge function, supabase-js (service-role client), Zod for the tool shape, Deno test runner (`npm run test:functions`).

**Spec:** `docs/superpowers/specs/2026-06-24-mcp-update-post-design.md`

## Global Constraints

- Reuse the existing `posts:write` scope. **No** migration, **no** `_shared/mcp-token.ts` change, **no** frontend change.
- `EDITABLE_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente"]` (source statuses the agent may edit) and `AGENT_SETTABLE_STATUSES = ["rascunho", "revisao_interna"]` (statuses the agent may set) — verbatim.
- Hard boundary: the agent can never **set** a client-facing/publish status, and can never **edit** a post currently in `enviado_cliente`, `aprovado_cliente`, `agendado`, `postado`, or `falha_publicacao`.
- `correcao_cliente` is client-visible: editing such a post with **no explicit `status`** auto-moves it to `revisao_interna` (pull out of client view). An explicit `status` is honored as-is.
- Build payload and audit redactor with presence checks (`Object.hasOwn`), **not** truthiness — `body: ""` and `ig_caption: ""` must clear those fields.
- The guarded `.update()` must re-include `.eq("conta_id", …)`, `.eq("id", …)`, and `.in("status", EDITABLE_STATUSES)` (TOCTOU protection).
- Audit log must record ids + presence/length only — **never** the raw `body`/`ig_caption` content.
- `created_via` is **creation** provenance — never flipped on edit.
- All validation failures throw `McpInputError` (caller-safe message); raw DB errors never leak (generic `"Internal error."`).
- Verify with `npm run test:functions` and `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`. After any `deno`/`supabase functions` command, restore both lock files (`git checkout deno.lock supabase/functions/deno.lock`) and run `npm ci`.

---

## File Structure

- `supabase/functions/mcp/queries.ts` — add `EDITABLE_STATUSES` + `AGENT_SETTABLE_STATUSES` constants and the `updatePost(d, args)` helper (Task 1).
- `supabase/functions/mcp/tools.ts` — register the `update_post` tool with its Zod shape + audit redactor (Task 2).
- `supabase/functions/__tests__/mcp-writes_test.ts` — extend the recording fake `db` with `update` + an `updatePayload` helper, add the `updatePost` data-layer tests (Task 1) and the audit-redaction wrapper test (Task 2).

---

## Task 1: `updatePost` query helper + data-layer tests

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (add constants + `updatePost`, after `createPost` at the end of the `// ---- writes ----` section, ~line 638)
- Test: `supabase/functions/__tests__/mcp-writes_test.ts` (extend fake db + add tests)

**Interfaces:**
- Consumes (already in `queries.ts`): `Deps` (`{ db, ctx, signUrl?, now? }`), `buildTiptapDoc` (imported from `./content.ts`), `McpInputError` (imported from `../_shared/mcp-token.ts`). All three are already imported at the top of `queries.ts` — no new imports needed.
- Produces: `export async function updatePost(d: Deps, args: { post_id: number; titulo?: string; tipo?: string; body?: string; ig_caption?: string; status?: string }): Promise<any>` — returns the updated post row `{ id, workflow_id, titulo, tipo, status, ig_caption, created_via, updated_at }`. Throws `McpInputError` on: no updatable field, status outside `AGENT_SETTABLE_STATUSES`, post not found, post not in an editable status, or a guarded-update miss (race).

- [ ] **Step 1: Write the failing tests**

First, extend the recording fake `db` so it records `update` calls. In `supabase/functions/__tests__/mcp-writes_test.ts`, add `"update"` to the chainable-method list (line ~20):

```ts
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "update", "delete"]) {
```

Update the import at the top of the file (line 2) to include `updatePost`:

```ts
import { createPost, createWorkflow, updatePost } from "../mcp/queries.ts";
```

Add an `updatePayload` helper next to the existing `insertPayload` helper (after line 38):

```ts
function updatePayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "update");
  return c?.args[0] as Record<string, unknown> | undefined;
}
```

Append the following tests to the end of the file:

```ts
Deno.test("updatePost: ownership-scoped prefetch + guarded update, TipTap body", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null }, // prefetch
      { data: { id: 7, workflow_id: 1, titulo: "T", tipo: "feed", status: "rascunho", ig_caption: null, created_via: "human", updated_at: "t" }, error: null }, // guarded update
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await updatePost(deps, { post_id: 7, body: "nova linha" });

  assert(has(calls, "workflow_posts", "eq", ["conta_id", "workspace-A"]), "tenant-scoped");
  assert(has(calls, "workflow_posts", "eq", ["id", 7]), "checks the id");
  assert(
    has(calls, "workflow_posts", "in", ["status", ["rascunho", "revisao_interna", "correcao_cliente"]]),
    "guarded update re-checks editable status",
  );
  const payload = updatePayload(calls, "workflow_posts")!;
  assertEquals((payload.conteudo as { type: string }).type, "doc"); // not a raw string
  assertEquals(payload.conteudo_plain, "nova linha");
  assertEquals(out.id, 7);
});

Deno.test("updatePost: missing post -> McpInputError, no update", async () => {
  const { db, calls } = makeFakeDb({ workflow_posts: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7, body: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts" && c.method === "update"), "no update");
});

Deno.test("updatePost: non-editable status -> McpInputError, no update", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "enviado_cliente" }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7, body: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts" && c.method === "update"), "no update");
});

Deno.test("updatePost: guarded update returns null (race) -> McpInputError", async () => {
  const { db } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null }, // prefetch ok
      { data: null, error: null },                          // guarded update matched nothing
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7, titulo: "T" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError on race");
});

Deno.test("updatePost: presence semantics — empty string clears, omitted untouched", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null },
      { data: { id: 7, status: "rascunho" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, ig_caption: "" }); // clear caption, no other field
  const payload = updatePayload(calls, "workflow_posts")!;
  assert(Object.hasOwn(payload, "ig_caption"), "ig_caption present (cleared)");
  assertEquals(payload.ig_caption, "");
  assert(!Object.hasOwn(payload, "titulo"), "titulo untouched");
  assert(!Object.hasOwn(payload, "conteudo"), "body untouched");
});

Deno.test("updatePost: body '' produces an empty TipTap doc", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null },
      { data: { id: 7, status: "rascunho" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, body: "" });
  const payload = updatePayload(calls, "workflow_posts")!;
  assertEquals((payload.conteudo as { type: string }).type, "doc");
  assertEquals(payload.conteudo_plain, "");
});

Deno.test("updatePost: no updatable field -> McpInputError, no db access", async () => {
  const { db, calls } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7 }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts"), "no db access");
});

Deno.test("updatePost: status outside allowlist -> McpInputError, no db access", async () => {
  const { db, calls } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7, status: "enviado_cliente" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts"), "rejected before any db access");
});

Deno.test("updatePost: editing a correcao_cliente post auto-moves it to revisao_interna", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "correcao_cliente" }, error: null },
      { data: { id: 7, status: "revisao_interna" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, body: "revisado" });
  const payload = updatePayload(calls, "workflow_posts")!;
  assertEquals(payload.status, "revisao_interna");
});

Deno.test("updatePost: explicit status on a correcao_cliente post is honored", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "correcao_cliente" }, error: null },
      { data: { id: 7, status: "rascunho" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, body: "revisado", status: "rascunho" });
  const payload = updatePayload(calls, "workflow_posts")!;
  assertEquals(payload.status, "rascunho");
});

Deno.test("updatePost: editing a rascunho post does not auto-set status", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null },
      { data: { id: 7, status: "rascunho" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, body: "x" });
  const payload = updatePayload(calls, "workflow_posts")!;
  assert(!Object.hasOwn(payload, "status"), "status not auto-set for rascunho");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL — the `updatePost` import is unresolved / `updatePost is not a function` (the helper does not exist yet). The pre-existing `createWorkflow`/`createPost` tests should still be present.

- [ ] **Step 3: Implement `updatePost` in `queries.ts`**

At the end of the `// ---- writes ----` section (after `createPost`, ~line 638), add the constants and helper:

```ts
const EDITABLE_STATUSES: string[] = ["rascunho", "revisao_interna", "correcao_cliente"];
const AGENT_SETTABLE_STATUSES: string[] = ["rascunho", "revisao_interna"];

export async function updatePost(
  d: Deps,
  args: { post_id: number; titulo?: string; tipo?: string; body?: string; ig_caption?: string; status?: string },
): Promise<any> {
  // At least one updatable field.
  const FIELDS = ["titulo", "tipo", "body", "ig_caption", "status"];
  if (!FIELDS.some((f) => Object.hasOwn(args, f))) {
    throw new McpInputError("Informe ao menos um campo para atualizar.");
  }

  // Defensive destination-status validation (the zod enum is the first line; this guards
  // any caller that bypasses it, e.g. tests).
  if (Object.hasOwn(args, "status") && !AGENT_SETTABLE_STATUSES.includes(args.status as string)) {
    throw new McpInputError("Status inválido para edição pelo agente.");
  }

  // Prefetch for granular errors (distinguish not-found from not-editable).
  const { data: existing } = await d.db
    .from("workflow_posts")
    .select("id, status")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.post_id)
    .maybeSingle();
  if (!existing) {
    throw new McpInputError("Post não encontrado neste workspace.");
  }
  const currentStatus = (existing as any).status as string;
  if (!EDITABLE_STATUSES.includes(currentStatus)) {
    throw new McpInputError(`Post em estado '${currentStatus}' não pode ser editado pelo agente.`);
  }

  // Build payload with presence checks so "" clears (never ignored).
  const payload: Record<string, unknown> = {};
  if (Object.hasOwn(args, "titulo")) payload.titulo = args.titulo;
  if (Object.hasOwn(args, "tipo")) payload.tipo = args.tipo;
  if (Object.hasOwn(args, "body")) {
    payload.conteudo = buildTiptapDoc(args.body); // "" -> valid empty doc
    payload.conteudo_plain = args.body ?? "";
  }
  if (Object.hasOwn(args, "ig_caption")) payload.ig_caption = args.ig_caption;
  if (Object.hasOwn(args, "status")) payload.status = args.status;

  // correcao_cliente is live in the client portal — an edit with no explicit status
  // must pull the post out of the client's view.
  if (currentStatus === "correcao_cliente" && !Object.hasOwn(args, "status")) {
    payload.status = "revisao_interna";
  }

  // Atomic guarded update: re-check tenant + editability so a status race between
  // the prefetch and the write cannot slip a now-client-facing post through.
  const { data, error } = await d.db
    .from("workflow_posts")
    .update(payload)
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.post_id)
    .in("status", EDITABLE_STATUSES)
    .select("id, workflow_id, titulo, tipo, status, ig_caption, created_via, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new McpInputError("Post não pôde ser atualizado (estado alterado). Tente novamente.");
  }
  return data;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS — all `updatePost: …` tests pass, plus the pre-existing `createWorkflow`/`createPost` tests.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors.
Then restore lock files: `git checkout deno.lock supabase/functions/deno.lock` and run `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-writes_test.ts
git commit -m "feat(mcp): updatePost query helper (guarded, draft-only, slice 2b)"
```

---

## Task 2: Register the `update_post` tool + audit-redaction test

**Files:**
- Modify: `supabase/functions/mcp/tools.ts` (import `updatePost`; register the tool — after the `create_post` registration, ~line 160)
- Test: `supabase/functions/__tests__/mcp-writes_test.ts` (append the audit-redaction wrapper test)

**Interfaces:**
- Consumes: `updatePost` from `./queries.ts` (Task 1); the existing `register(server, deps, name, scope, description, shape, run, auditArgs?)` and `z` already in `tools.ts`.
- Produces: an MCP tool named `update_post` under the `posts:write` scope, with a redactor that logs `{ post_id, has_titulo, tipo, status, has_body, body_len, has_ig_caption, ig_caption_len }`.

- [ ] **Step 1: Write the failing test**

Append to the end of `supabase/functions/__tests__/mcp-writes_test.ts`:

```ts
Deno.test("update_post tool redacts body/ig_caption from the audit log", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null }, // prefetch
      { data: { id: 7, status: "rascunho" }, error: null }, // guarded update
    ],
    audit_log: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const server = {
    handlers: {} as Record<string, (a: unknown) => Promise<unknown>>,
    // deno-lint-ignore no-explicit-any
    tool(name: string, _d: any, _s: any, h: any) { this.handlers[name] = h; },
  };
  // deno-lint-ignore no-explicit-any
  registerTools(server as any, deps);
  await server.handlers["update_post"]({
    post_id: 7, titulo: "T",
    body: "ROTEIRO_SECRETO", ig_caption: "CAPTION_SECRETO",
  });
  const auditInsert = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(auditInsert, "audit_log insert happened");
  const meta = JSON.stringify(auditInsert!.args[0]);
  assert(!meta.includes("ROTEIRO_SECRETO"), "raw body must not be logged");
  assert(!meta.includes("CAPTION_SECRETO"), "raw ig_caption must not be logged");
  assert(meta.includes("body_len"), "logs body_len instead");
  assertEquals((auditInsert!.args[0] as Record<string, unknown>).resource_id, "7");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:functions`
Expected: FAIL — `server.handlers["update_post"]` is `undefined` (the tool is not registered yet), so calling it throws a `TypeError`.

- [ ] **Step 3: Register the tool in `tools.ts`**

Add `updatePost` to the import block from `./queries.ts` (alongside `createPost`, `createWorkflow`, etc.):

```ts
  createPost,
  createWorkflow,
  updatePost,
```

After the `create_post` registration (ends ~line 160, before the closing `}` of `registerTools`), add:

```ts
  register(server, deps, "update_post", "posts:write",
    "Edita um post existente (título, formato, corpo, legenda) e pode avançar o status apenas para rascunho ou revisão interna. O agente nunca envia ao cliente nem publica.",
    {
      post_id: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(200).optional(),
      tipo: z.enum(["feed", "reels", "stories", "carrossel"]).optional(),
      body: z.string().max(10000).optional(),
      ig_caption: z.string().max(2200).optional(),
      status: z.enum(["rascunho", "revisao_interna"]).optional(),
    },
    (a) => updatePost(deps, a),
    (a) => ({
      post_id: a.post_id,
      has_titulo: Object.hasOwn(a, "titulo"),
      tipo: a.tipo,
      status: a.status,
      has_body: Object.hasOwn(a, "body"),
      body_len: a.body?.length ?? 0,
      has_ig_caption: Object.hasOwn(a, "ig_caption"),
      ig_caption_len: a.ig_caption?.length ?? 0,
    }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:functions`
Expected: PASS — the audit-redaction test passes, and all Task 1 tests still pass.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`
Expected: no errors.
Then restore lock files: `git checkout deno.lock supabase/functions/deno.lock` and run `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-writes_test.ts
git commit -m "feat(mcp): register update_post tool with audit redaction (slice 2b)"
```

---

## Rollout (gated — requires explicit user go-ahead, NOT part of subagent execution)

No migration (the `created_via` column already exists on prod from slice 2a).

1. Deploy the function: `npx supabase functions deploy mcp --no-verify-jwt --project-ref skjzpekeqefvlojenfsw` (prod). Because 2b adds no scope, only `mcp` is redeployed — not `mcp-oauth-consent`/`mcp-keys`, and no Vercel redeploy. Then `git checkout deno.lock supabase/functions/deno.lock && npm ci`.
2. Staging (`wlyzhyfondykzpsiqsce`): staging still lacks the `created_via` column (slice 2a's migration was never applied there). Apply via the staging SQL editor first:
   ```sql
   ALTER TABLE workflows      ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human' CHECK (created_via IN ('human','agent'));
   ALTER TABLE workflow_posts ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human' CHECK (created_via IN ('human','agent'));
   ```
   Then deploy `mcp` to staging and restore lock files.
3. Smoke test: a `posts:write` key runs `create_post` → `update_post` (edit body, set `status: "revisao_interna"`); confirm the draft changes in entregas and a `system` status event appears in the timeline; confirm editing a `correcao_cliente` post (no status arg) moves it to `revisao_interna` and it disappears from the client Hub; confirm `update_post` on an `enviado_cliente`/`postado` post returns the `McpInputError`; confirm a `posts:read`-only key gets permission-denied.
