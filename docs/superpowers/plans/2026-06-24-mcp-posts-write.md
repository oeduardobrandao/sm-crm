# MCP posts-write slice Implementation Plan (`create_workflow` + `create_post`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MCP agents their first write capability — draft Instagram posts into the CRM, draft-only — via `create_workflow` + `create_post` under a new opt-in `posts:write` scope, with write-side tenant checks, `created_via` provenance, and audit redaction.

**Architecture:** A pure `buildTiptapDoc` helper (content.ts) turns plain text into a safe TipTap doc; `createWorkflow`/`createPost` query functions (queries.ts) do `conta_id`-scoped ownership checks then insert, forcing `status='rascunho'` and `created_via='agent'`; the `register()` wrapper gains an `auditArgs` redactor so payloads never hit the audit log; a migration adds `created_via` to both tables and the CRM shows an "IA" badge.

**Tech Stack:** Deno edge function (Supabase), `npm:zod@3`, `npm:@supabase/supabase-js@2`, Deno test runner; React/Vite CRM; Postgres migration.

## Global Constraints

- **Deno, not Node** for `supabase/functions/**`; `npm:` specifiers. `queries.ts`/`tools.ts` carry `// deno-lint-ignore-file no-explicit-any` (so `any` is fine there); `content.ts` is lint-clean (no `any`).
- **Draft-only:** `create_post` hardcodes `status='rascunho'` — never an input. `create_workflow` hardcodes `status='ativo'`.
- **Write-side tenant isolation:** before any insert, verify ownership with a `conta_id`-scoped lookup (FK ≠ ownership). `create_workflow` → client in workspace; `create_post` → workflow in workspace AND `status='ativo'`. On failure throw `McpInputError` (its message is returned; all other errors stay generic "Internal error.").
- **Provenance:** both tools set `created_via='agent'`. Migration adds `created_via text NOT NULL DEFAULT 'human' CHECK (created_via IN ('human','agent'))` to `workflows` and `workflow_posts`.
- **Audit redaction:** write tools log only ids + `titulo` + payload presence/length — never `body`/`ig_caption` content.
- **Scope:** new `posts:write` in `MCP_ALLOWED_SCOPES` only (NOT `MCP_AGENT_PRESET`); frontend `AGENT_PRESET` becomes an explicit read-only list so write isn't silently granted.
- **`buildTiptapDoc`** uses only core `doc/paragraph/text` nodes (missing node type silently blanks the Hub body); never store a raw string in `conteudo`.
- **Input bounds (zod):** `titulo` `.trim().min(1).max(200)`, `body` `.max(10000)`, `ig_caption` `.max(2200)`, ids `.int().positive()`.
- **Deno-lock gotcha:** `deno test`/`deno check` can touch `deno.lock` AND `supabase/functions/deno.lock`; leave unstaged, restore both if `npm run build` later breaks (`git checkout deno.lock supabase/functions/deno.lock && npm ci`).
- **Branch:** `feat/mcp-posts-write`, off `main`.

---

### Task 1: `buildTiptapDoc` pure helper

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (append)
- Test: `supabase/functions/__tests__/mcp-content_test.ts` (import + one `Deno.test`)

**Interfaces:**
- Produces: `buildTiptapDoc(plain: string | undefined | null): { type: "doc"; content: {...}[] }`

- [ ] **Step 1: Write the failing test**

Add `buildTiptapDoc` to the existing import from `../mcp/content.ts` in
`supabase/functions/__tests__/mcp-content_test.ts` (alphabetical — after `buildPostFeedback`
if present, else slot it in alphabetically). Then append:

```ts
Deno.test("buildTiptapDoc builds core-node paragraphs", () => {
  assertEquals(buildTiptapDoc("Olá mundo"), {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Olá mundo" }] }],
  });
  // one paragraph per line; a blank line -> empty paragraph
  assertEquals(buildTiptapDoc("linha 1\n\nlinha 3"), {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "linha 1" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "linha 3" }] },
    ],
  });
  // empty / undefined -> a doc with a single empty paragraph
  assertEquals(buildTiptapDoc(""), { type: "doc", content: [{ type: "paragraph" }] });
  assertEquals(buildTiptapDoc(undefined), { type: "doc", content: [{ type: "paragraph" }] });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-content_test.ts
```
Expected: FAIL to load — `does not provide an export named 'buildTiptapDoc'`.

- [ ] **Step 3: Implement the helper**

Append to `supabase/functions/mcp/content.ts`:

```ts
// ---- post body (create_post) ------------------------------------------------

/**
 * Build a minimal TipTap/ProseMirror doc from plain text for `workflow_posts.conteudo`.
 * Uses ONLY core doc/paragraph/text nodes — a missing node/mark type silently blanks
 * the whole post body in the Hub. One paragraph per line; a blank line becomes an
 * empty paragraph; empty/undefined input becomes a doc with one empty paragraph.
 * `body` is plain text (markdown syntax would appear literally).
 */
export function buildTiptapDoc(
  plain: string | undefined | null,
): { type: "doc"; content: ({ type: "paragraph"; content?: { type: "text"; text: string }[] })[] } {
  const text = typeof plain === "string" ? plain : "";
  const content = text.split("\n").map((line) =>
    line.length > 0
      ? { type: "paragraph" as const, content: [{ type: "text" as const, text: line }] }
      : { type: "paragraph" as const }
  );
  return { type: "doc", content };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-content_test.ts
```
Expected: PASS (new test + pre-existing content tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/content.ts supabase/functions/__tests__/mcp-content_test.ts
git commit -m "feat(mcp): buildTiptapDoc helper for create_post body"
```

---

### Task 2: MCP write tools (`create_workflow` + `create_post`)

**Files:**
- Modify: `supabase/functions/_shared/mcp-token.ts` (add `posts:write` scope + `McpInputError`)
- Modify: `supabase/functions/mcp/tools.ts` (`auditArgs` param, `McpInputError` branch, register 2 tools)
- Modify: `supabase/functions/mcp/queries.ts` (`createWorkflow`, `createPost`, `verifyActiveWorkflow`; `created_via` in read projections)
- Create: `supabase/functions/__tests__/mcp-writes_test.ts` (recording fake-`db` scoping/behavior + audit-redaction tests)

**Interfaces:**
- Consumes: `buildTiptapDoc` (Task 1); `Deps`/`verifyClient` (`queries.ts`); `register`/`registerTools`/`errorResult`/`audit` (`tools.ts`); `McpScopeError`/`McpKeyContext` (`mcp-token.ts`); `insertAuditLog`→`audit_log` table (`_shared/audit.ts`).
- Produces: `createWorkflow(d, { client_id, titulo })`, `createPost(d, { workflow_id, titulo, tipo?, body?, ig_caption? })`; `McpInputError`; tools `create_workflow`/`create_post`.

- [ ] **Step 1: Add the scope + error class**

In `supabase/functions/_shared/mcp-token.ts`, add `"posts:write"` to `MCP_ALLOWED_SCOPES` (leave `MCP_AGENT_PRESET` unchanged):

```ts
export const MCP_ALLOWED_SCOPES = [
  "clientes:read", "posts:read", "workflows:read", "ideias:read", "posts:write",
] as const;
```

And add, next to `McpScopeError`:

```ts
/**
 * A safe, caller-facing validation error. Its message IS returned to the client
 * (it only describes the caller's own workspace) — unlike internal errors, which
 * stay generic.
 */
export class McpInputError extends Error {}
```

- [ ] **Step 2: Write the failing tests**

Create `supabase/functions/__tests__/mcp-writes_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { createPost, createWorkflow } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import { registerTools } from "../mcp/tools.ts";
import { McpInputError, type McpKeyContext } from "../_shared/mcp-token.ts";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client supporting read + write chains. `await` / single /
// maybeSingle pull the next canned response from the table's queue.
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "delete"]) {
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

const CTX: McpKeyContext = {
  conta_id: "workspace-A", scopes: ["posts:write"], key_id: "k1", created_by: "user-1",
};
function insertPayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "insert");
  return c?.args[0] as Record<string, unknown> | undefined;
}
function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some((c) => c.table === table && c.method === method &&
    JSON.stringify(c.args) === JSON.stringify(args));
}

Deno.test("createWorkflow: ownership-checked, agent-stamped, with default etapa", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],                       // verifyClient
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createWorkflow(deps, { client_id: 5, titulo: "X" });

  assert(has(calls, "clientes", "eq", ["conta_id", "workspace-A"]), "client ownership scoped");
  const wf = insertPayload(calls, "workflows")!;
  assertEquals(wf.created_via, "agent");
  assertEquals(wf.status, "ativo");
  assertEquals(wf.conta_id, "workspace-A");
  assertEquals(wf.user_id, "user-1");
  const et = insertPayload(calls, "workflow_etapas")!;
  assertEquals(et.ordem, 0);
  assertEquals(et.status, "ativo");
  assertEquals(out.id, 99);
});

Deno.test("createWorkflow: missing client -> McpInputError, no insert", async () => {
  const { db, calls } = makeFakeDb({ clientes: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createWorkflow(deps, { client_id: 5, titulo: "X" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflows" && c.method === "insert"), "no workflow insert");
});

Deno.test("createPost: active-fluxo ownership, rascunho, agent, ordem max+1, TipTap conteudo", async () => {
  const { db, calls } = makeFakeDb({
    workflows: [{ data: { id: 99 }, error: null }],                    // verifyActiveWorkflow
    workflow_posts: [
      { data: { ordem: 2 }, error: null },                            // ordem query
      { data: { id: 500, status: "rascunho", created_via: "agent" }, error: null }, // insert
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createPost(deps, { workflow_id: 99, titulo: "T", tipo: "feed", body: "linha", ig_caption: "cap" });

  assert(has(calls, "workflows", "eq", ["conta_id", "workspace-A"]), "workflow ownership scoped");
  assert(has(calls, "workflows", "eq", ["status", "ativo"]), "workflow must be ativo");
  const post = insertPayload(calls, "workflow_posts")!;
  assertEquals(post.status, "rascunho");
  assertEquals(post.created_via, "agent");
  assertEquals(post.conta_id, "workspace-A");
  assertEquals(post.ordem, 3);
  assertEquals((post.conteudo as { type: string }).type, "doc"); // not a raw string
  assertEquals(out.id, 500);
});

Deno.test("createPost: missing/inactive fluxo -> McpInputError, no insert", async () => {
  const { db, calls } = makeFakeDb({ workflows: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createPost(deps, { workflow_id: 99, titulo: "T" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts" && c.method === "insert"), "no post insert");
});

Deno.test("create_post tool redacts body/ig_caption from the audit log", async () => {
  const { db, calls } = makeFakeDb({
    workflows: [{ data: { id: 99 }, error: null }],
    workflow_posts: [
      { data: { ordem: 0 }, error: null },
      { data: { id: 1, status: "rascunho" }, error: null },
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
  await server.handlers["create_post"]({
    workflow_id: 99, titulo: "T", tipo: "feed",
    body: "ROTEIRO_SECRETO", ig_caption: "CAPTION_SECRETO",
  });
  const auditInsert = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(auditInsert, "audit_log insert happened");
  const meta = JSON.stringify(auditInsert!.args[0]);
  assert(!meta.includes("ROTEIRO_SECRETO"), "raw body must not be logged");
  assert(!meta.includes("CAPTION_SECRETO"), "raw ig_caption must not be logged");
  assert(meta.includes("body_len"), "logs body_len instead");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-writes_test.ts
```
Expected: FAIL to load — `does not provide an export named 'createPost'` (and `createWorkflow`).

- [ ] **Step 4: Implement the queries**

In `supabase/functions/mcp/queries.ts`, add `buildTiptapDoc` to the `./content.ts` import (alphabetical) and `McpInputError` to the `./_shared/mcp-token.ts` import:

```ts
import { McpKeyContext, McpInputError } from "../_shared/mcp-token.ts";
```

Update `POST_COLS` to include `created_via`:

```ts
const POST_COLS =
  "id, workflow_id, titulo, tipo, status, ig_caption, conteudo_plain, created_via, " +
  "instagram_media_id, instagram_permalink, scheduled_at, published_at, created_at";
```

In `listPosts`' result map add `created_via: p.created_via,` and in `getPost`'s
returned object add `created_via: p.created_via,`. In `listWorkflows` add `created_via`
to the `.select(...)` string (it returns rows directly, so output updates automatically):

```ts
    .select("id, cliente_id, titulo, status, etapa_atual, created_via, created_at")
```

Append at the end of `supabase/functions/mcp/queries.ts`:

```ts
// ---- writes ------------------------------------------------------------------

async function verifyActiveWorkflow(d: Deps, workflowId: number): Promise<any | null> {
  const { data } = await d.db
    .from("workflows")
    .select("id")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", workflowId)
    .eq("status", "ativo")
    .maybeSingle();
  return data ?? null;
}

export async function createWorkflow(
  d: Deps,
  args: { client_id: number; titulo: string },
): Promise<any> {
  const client = await verifyClient(d, args.client_id);
  if (!client) throw new McpInputError("Cliente não encontrado neste workspace.");

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
    })
    .select("id, cliente_id, titulo, status, etapa_atual, created_via, created_at")
    .single();
  if (wfErr) throw wfErr;

  const now = d.now?.() ?? new Date().toISOString();
  const { error: etErr } = await d.db.from("workflow_etapas").insert({
    workflow_id: wf.id,
    ordem: 0,
    nome: "Conteúdo",
    prazo_dias: 0,
    tipo_prazo: "corridos",
    tipo: "padrao",
    status: "ativo",
    iniciado_em: now,
    responsavel_id: null,
    concluido_em: null,
    data_limite: null,
  });
  if (etErr) {
    // Compensating cleanup: a zero-etapa fluxo renders broken on the board.
    await d.db.from("workflows").delete().eq("id", wf.id);
    throw etErr;
  }
  return wf;
}

export async function createPost(
  d: Deps,
  args: { workflow_id: number; titulo: string; tipo?: string; body?: string; ig_caption?: string },
): Promise<any> {
  const wf = await verifyActiveWorkflow(d, args.workflow_id);
  if (!wf) throw new McpInputError("Fluxo não encontrado, ou inativo, neste workspace.");

  const { data: last } = await d.db
    .from("workflow_posts")
    .select("ordem")
    .eq("conta_id", d.ctx.conta_id)
    .eq("workflow_id", args.workflow_id)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ordem = ((last?.ordem as number | undefined) ?? -1) + 1;

  const { data: post, error } = await d.db
    .from("workflow_posts")
    .insert({
      workflow_id: args.workflow_id,
      conta_id: d.ctx.conta_id,
      titulo: args.titulo,
      tipo: args.tipo ?? "feed",
      conteudo: buildTiptapDoc(args.body),
      conteudo_plain: args.body ?? "",
      ig_caption: args.ig_caption ?? null,
      ordem,
      status: "rascunho",
      created_via: "agent",
    })
    .select("id, workflow_id, titulo, tipo, status, ig_caption, created_via, created_at")
    .single();
  if (error) throw error;
  return post;
}
```

- [ ] **Step 5: Wire the tools wrapper + registration**

In `supabase/functions/mcp/tools.ts`: import `McpInputError` (from `../_shared/mcp-token.ts`)
and `createPost`, `createWorkflow` (from `./queries.ts`).

Add the `McpInputError` branch to `errorResult`:

```ts
function errorResult(e: unknown) {
  const message = e instanceof McpScopeError
    ? `Permission denied: missing scope '${e.scope}'.`
    : e instanceof McpInputError
    ? e.message
    : "Internal error.";
  // Never leak raw error details (logged internally instead).
  if (!(e instanceof McpScopeError) && !(e instanceof McpInputError)) {
    console.error("[mcp] tool error:", e);
  }
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}
```

Give `register()` an optional `auditArgs` redactor (reads keep current behavior):

```ts
function register(
  server: any,
  deps: Deps,
  name: string,
  scope: string,
  description: string,
  shape: z.ZodRawShape,
  run: (args: any) => Promise<unknown>,
  auditArgs?: (args: any) => Record<string, unknown>,
) {
  server.tool(name, description, shape, async (args: any) => {
    try {
      requireScope(deps.ctx, scope);
      const data = await run(args ?? {});
      await audit(deps, name, (auditArgs ?? ((a: any) => a))(args ?? {}));
      return jsonResult(data);
    } catch (e) {
      return errorResult(e);
    }
  });
}
```

In `registerTools`, after the existing read registrations, add:

```ts
  register(server, deps, "create_workflow", "posts:write",
    "Cria um fluxo de produção (necessário para criar posts). Retorna o fluxo criado.",
    { client_id: z.number().int().positive(), titulo: z.string().trim().min(1).max(200) },
    (a) => createWorkflow(deps, a),
    (a) => ({ client_id: a.client_id, titulo: a.titulo }));

  register(server, deps, "create_post", "posts:write",
    "Cria um post em rascunho dentro de um fluxo ativo. O agente nunca publica nem envia ao cliente.",
    {
      workflow_id: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(200),
      tipo: z.enum(["feed", "reels", "stories", "carrossel"]).optional(),
      body: z.string().max(10000).optional(),
      ig_caption: z.string().max(2200).optional(),
    },
    (a) => createPost(deps, a),
    (a) => ({
      workflow_id: a.workflow_id, tipo: a.tipo, titulo: a.titulo,
      has_body: !!a.body, body_len: a.body?.length ?? 0,
      has_ig_caption: !!a.ig_caption, ig_caption_len: a.ig_caption?.length ?? 0,
    }));
```

- [ ] **Step 6: Run the writes tests to verify they pass**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-writes_test.ts
```
Expected: PASS (all 5 tests `... ok`).

- [ ] **Step 7: Typecheck + full suite**

```bash
deno check --node-modules-dir=auto supabase/functions/mcp/index.ts
npm run test:functions
```
Expected: `deno check` exit 0; suite all pass (incl. Task 1 + the 5 writes tests).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/mcp-token.ts supabase/functions/mcp/tools.ts supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-writes_test.ts
git commit -m "feat(mcp): create_workflow + create_post write tools (draft-only, posts:write)"
```

---

### Task 3: Migration + frontend scope + CRM "IA" badge

**Files:**
- Create: `supabase/migrations/20260624000001_mcp_created_via.sql`
- Modify: `apps/crm/src/lib/mcp-scopes.ts`
- Modify: `apps/crm/src/store/workflows.ts` (`Workflow` type), `apps/crm/src/store/posts.ts` (`WorkflowPost` type)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCard.tsx` (badge)

**Interfaces:**
- Consumes: nothing from earlier tasks (independent; `created_via` arrives via `select('*')` in CRM reads).
- Produces: the `created_via` column; the read-only `AGENT_PRESET`; the badge.

- [ ] **Step 1: Migration**

Create `supabase/migrations/20260624000001_mcp_created_via.sql`:

```sql
-- Provenance for MCP agent-created rows. Default 'human' keeps every existing row
-- and the CRM/Express-Post insert paths correct with no code change; MCP sets 'agent'.
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human'
  CHECK (created_via IN ('human', 'agent'));

ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human'
  CHECK (created_via IN ('human', 'agent'));
```

- [ ] **Step 2: Frontend scope option + read-only preset**

Replace the body of `apps/crm/src/lib/mcp-scopes.ts` with:

```ts
// MCP permission scopes shown in the CRM — single source of truth for both the API-key page
// (/configuracao/mcp) and the OAuth consent page (/oauth/consent). Mirror of MCP_ALLOWED_SCOPES
// in supabase/functions/_shared/mcp-token.ts (can't import across the Deno/Vite boundary).
export const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)' },
  { value: 'posts:read', label: 'Posts (leitura)' },
  { value: 'workflows:read', label: 'Fluxos (leitura)' },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)' },
  { value: 'posts:write', label: 'Posts (escrita)' },
] as const;

/** Least-privilege preset for a content agent — read scopes only. Write is opt-in. */
export const AGENT_PRESET: string[] = [
  'clientes:read', 'posts:read', 'workflows:read', 'ideias:read',
];
```

- [ ] **Step 3: Add `created_via` to the CRM types**

In `apps/crm/src/store/workflows.ts`, inside `export interface Workflow {`, add:

```ts
  created_via?: 'human' | 'agent';
```

In `apps/crm/src/store/posts.ts`, inside `export interface WorkflowPost {`, add:

```ts
  created_via?: 'human' | 'agent';
```

- [ ] **Step 4: Render the "IA" badge on the board card**

In `apps/crm/src/pages/entregas/components/WorkflowCard.tsx`, find the title render
(`{card.workflow.titulo}`, ~line 279) and render a badge immediately after it:

```tsx
        {card.workflow.titulo}
        {card.workflow.created_via === 'agent' && (
          <span
            title="Criado por agente de IA"
            style={{
              marginLeft: '0.4rem',
              padding: '0.05rem 0.35rem',
              borderRadius: '4px',
              fontSize: '0.6rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              background: 'rgba(234, 179, 8, 0.15)',
              color: 'var(--primary-color)',
              verticalAlign: 'middle',
            }}
          >
            IA
          </span>
        )}
```

(`BoardCard.workflow` is the full `Workflow`, so `card.workflow.created_via` is already available once the type carries it — no `useEntregasData` change.)

- [ ] **Step 5: Typecheck the frontend**

```bash
npm run build
```
Expected: `tsc` + `vite build` succeed (covers the type additions + WorkflowCard). If it fails citing `deno.lock`/tiptap pollution, run `git checkout deno.lock supabase/functions/deno.lock && npm ci` and retry.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260624000001_mcp_created_via.sql apps/crm/src/lib/mcp-scopes.ts apps/crm/src/store/workflows.ts apps/crm/src/store/posts.ts apps/crm/src/pages/entregas/components/WorkflowCard.tsx
git commit -m "feat(mcp): created_via migration + posts:write scope option + IA badge"
```

---

### Task 4: Rollout — requires explicit go-ahead

**Files:** none (operational).

> ⚠️ Outward-facing/prod change. Do NOT run without the user's explicit confirmation. **Apply the migration BEFORE deploying the function** — the new read projections select `created_via`, which errors if the column is absent.

- [ ] **Step 1: Apply the migration to prod + staging**

Run the `20260624000001_mcp_created_via.sql` statements in the Supabase SQL editor for
prod (`skjzpekeqefvlojenfsw`) and staging (`wlyzhyfondykzpsiqsce`) — `db push` to staging
is flaky; the `ADD COLUMN IF NOT EXISTS … DEFAULT` is idempotent/safe.

- [ ] **Step 2: Deploy the function (both projects)**

```bash
npx supabase functions deploy mcp --no-verify-jwt --project-ref skjzpekeqefvlojenfsw
npx supabase functions deploy mcp --no-verify-jwt --project-ref wlyzhyfondykzpsiqsce
git checkout deno.lock supabase/functions/deno.lock 2>/dev/null; npm ci
```

- [ ] **Step 3: CRM deploy + smoke test**

CRM deploys via Vercel on merge to `main` (the `created_via` field is optional, so the
CRM is safe before/after the migration). Then, from an MCP client whose key/connection
has `posts:write`: `create_workflow` → `create_post`; confirm the draft appears in
entregas as `rascunho` with an "IA" badge on its fluxo card; confirm a `posts:read`-only
key gets permission-denied; confirm a foreign/inactive `workflow_id` returns the
`McpInputError` message, not a generic "Internal error."

---

## Notes / out of scope
- `update_post`/status changes (next slice, with the status allowlist), `set_post_property`, media, scheduling, `workflows:write` granularity.
- Per-post "IA" badge inside the WorkflowDrawer — fast-follow (this slice badges the board card the user referenced).
- DB transaction/RPC for the workflow+etapa pair — handled by compensating cleanup instead.

## Self-Review
- **Spec coverage:** `create_workflow`/`create_post` contracts + zod bounds + draft-only `rascunho` (Task 2 step 5) ✓; write-side ownership checks incl. `status='ativo'` + `McpInputError` (Task 2 step 4) ✓; compensating etapa cleanup (Task 2 step 4) ✓; default etapa (Task 2 step 4) ✓; `buildTiptapDoc` core-node-only (Task 1) ✓; provenance migration both tables (Task 3 step 1) + `created_via` in read projections (Task 2 step 4) + badge (Task 3 step 4) + CRM types (Task 3 step 3) ✓; audit redaction via `auditArgs` + tool-wrapper test (Task 2 steps 5 + 2) ✓; scope `posts:write` not in preset + frontend `AGENT_PRESET` fix (Task 2 step 1, Task 3 step 2) ✓; tests + commands ✓; rollout migration-before-deploy + both lockfiles (Task 4) ✓.
- **Placeholder scan:** none — every step has concrete code/commands (migration timestamp is concrete).
- **Type consistency:** `buildTiptapDoc(plain)` defined Task 1, imported/used Task 2; `createWorkflow(d,{client_id,titulo})` / `createPost(d,{workflow_id,titulo,tipo?,body?,ig_caption?})` produced Task 2 step 4, consumed by the writes test (step 2) + registration (step 5); `McpInputError` defined Task 2 step 1, used in queries + `errorResult`; `created_via` literal `'agent'`/`'human'` consistent across migration, queries, types, badge.
