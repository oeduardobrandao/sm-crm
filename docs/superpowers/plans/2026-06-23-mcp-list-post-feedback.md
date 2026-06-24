# `list_post_feedback` MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only MCP tool `list_post_feedback` exposing the client feedback loop (`post_approvals` + `post_status_events`) as post-grouped feedback with a status timeline, so agents learn a client's revealed preferences.

**Architecture:** Two pure helpers in `mcp/content.ts` (`topDistinctPostIds`, `buildPostFeedback`) do all shaping; a `listPostFeedback` query in `mcp/queries.ts` does a two-phase tenant-scoped read (capped scan picks post ids → uncapped re-fetch pulls complete feedback for those posts → timeline fetch) and feeds the helpers; one `register()` call in `mcp/tools.ts` wires it under the existing `posts:read` scope. A dedicated mocked-db test proves tenant scoping.

**Tech Stack:** Deno edge function (Supabase), `npm:zod@3`, `npm:@supabase/supabase-js@2`, Deno test runner.

## Global Constraints

- **Deno, not Node.** `npm:` specifiers or relative `.ts` paths.
- **Tenant isolation (security-critical):** `post_approvals` has no `conta_id` — read it **only** through `workflow_posts!inner(...)` with `.eq("workflow_posts.conta_id", d.ctx.conta_id)`, **never** by bare `post_id`. `post_status_events` has `conta_id` directly → `.eq("conta_id", d.ctx.conta_id)`.
- **Scope:** existing `posts:read`. NO new scope, no `MCP_ALLOWED_SCOPES`/key-UI/admin/OAuth changes.
- **`limit`** clamped in `queries.ts`: `Math.min(Math.max(1, args.limit ?? 25), 100)` (max distinct posts).
- **`since`** passed directly to `.gte("created_at", since)` (no strict parsing).
- **`SCAN_CAP = 2000`** applied ONLY to the phase-1 scan; phase-2a is uncapped so `feedback[]` is never truncated. `console.warn` when the scan returns exactly `SCAN_CAP` rows.
- **`author`** is the only derived field: `is_workspace_user === true ? "workspace" : "client"`. Every other field keeps its raw column name (`titulo`, `comentario`, `from_status`, `cliente_id`).
- **`cliente_id` map miss** → drop that row + `console.warn` (`cliente_id` always non-null in output).
- **No raw error to clients** — the `register()` wrapper returns generic messages.
- **Deno-lock gotcha:** `deno test`/`deno check` can modify `deno.lock`/`node_modules`. Leave `deno.lock` unstaged; if a later `npm run build` breaks, `git checkout deno.lock && npm ci`.
- **Branch:** `feat/mcp-list-post-feedback`, off `main`. Independent of the open `list_pages` PR; both touch `content.ts`/`queries.ts`/`tools.ts`, so a rebase may be needed after `list_pages` merges.

---

### Task 1: Pure helpers `topDistinctPostIds` + `buildPostFeedback`

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (append types + two functions)
- Test: `supabase/functions/__tests__/mcp-content_test.ts` (add import + three `Deno.test` blocks)

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `topDistinctPostIds(rows: { post_id: number }[], limit: number): number[]`
  - `buildPostFeedback(feedbackRows: FeedbackRow[], statusEvents: StatusEventRow[]): PostFeedbackItem[]`
  - exported types `FeedbackRow`, `StatusEventRow`, `PostFeedbackItem`

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/__tests__/mcp-content_test.ts`, add the two functions to the existing import from `../mcp/content.ts` (keep alphabetical order — they slot in as `buildPostFeedback` near the top and `topDistinctPostIds` near the end). The current import is:

```ts
import {
  allowlistClient,
  deriveFormatMeta,
  firstLine,
  pageContentToMarkdown,
  performanceTier,
  quartiles,
} from "../mcp/content.ts";
```

Make it:

```ts
import {
  allowlistClient,
  buildPostFeedback,
  deriveFormatMeta,
  firstLine,
  pageContentToMarkdown,
  performanceTier,
  quartiles,
  topDistinctPostIds,
} from "../mcp/content.ts";
```

(If `pageContentToMarkdown` is not present on this branch, just add `buildPostFeedback` and `topDistinctPostIds` alphabetically to whatever import list exists.)

Append these three test blocks at the end of the file:

```ts
Deno.test("topDistinctPostIds: distinct in first-seen order; dups don't consume limit", () => {
  assertEquals(
    topDistinctPostIds(
      [{ post_id: 1 }, { post_id: 1 }, { post_id: 1 }, { post_id: 2 }, { post_id: 3 }],
      2,
    ),
    [1, 2], // the three "1" rows do not crowd out 2
  );
  assertEquals(topDistinctPostIds([{ post_id: 5 }, { post_id: 6 }], 10), [5, 6]); // fewer than limit
  assertEquals(topDistinctPostIds([], 5), []); // empty
});

Deno.test("buildPostFeedback groups, derives author, orders feedback/timeline/posts", () => {
  const feedback = [
    { post_id: 10, titulo: "A", status: "correcao_cliente", cliente_id: 1,
      action: "mensagem", comentario: "oi", is_workspace_user: true, created_at: "2026-06-01T10:00:00Z" },
    { post_id: 10, titulo: "A", status: "correcao_cliente", cliente_id: 1,
      action: "correcao", comentario: "muito clínico", is_workspace_user: false, created_at: "2026-06-02T10:00:00Z" },
    { post_id: 20, titulo: "B", status: "aprovado_cliente", cliente_id: 2,
      action: "aprovado", comentario: null, is_workspace_user: false, created_at: "2026-06-03T10:00:00Z" },
  ];
  const events = [
    { post_id: 10, from_status: "enviado_cliente", to_status: "correcao_cliente",
      source: "client", actor_name: null, created_at: "2026-06-02T10:00:00Z" },
    { post_id: 10, from_status: "rascunho", to_status: "enviado_cliente",
      source: "workspace_user", actor_name: "Ana", created_at: "2026-06-01T09:00:00Z" },
  ];
  const out = buildPostFeedback(feedback, events);

  // post 20 first: its latest feedback (06-03) is newer than post 10's (06-02)
  assertEquals(out.map((p) => p.post_id), [20, 10]);

  // post 20: aprovado w/ null comment, author client, no events -> timeline []
  assertEquals(out[0], {
    post_id: 20, titulo: "B", cliente_id: 2, status: "aprovado_cliente",
    latest_feedback_at: "2026-06-03T10:00:00Z",
    feedback: [{ action: "aprovado", comentario: null, author: "client", created_at: "2026-06-03T10:00:00Z" }],
    timeline: [],
  });

  // post 10: feedback newest-first; author derived; timeline oldest->newest
  assertEquals(out[1].latest_feedback_at, "2026-06-02T10:00:00Z");
  assertEquals(out[1].feedback, [
    { action: "correcao", comentario: "muito clínico", author: "client", created_at: "2026-06-02T10:00:00Z" },
    { action: "mensagem", comentario: "oi", author: "workspace", created_at: "2026-06-01T10:00:00Z" },
  ]);
  assertEquals(out[1].timeline, [
    { from_status: "rascunho", to_status: "enviado_cliente", source: "workspace_user", actor_name: "Ana", created_at: "2026-06-01T09:00:00Z" },
    { from_status: "enviado_cliente", to_status: "correcao_cliente", source: "client", actor_name: null, created_at: "2026-06-02T10:00:00Z" },
  ]);
});

Deno.test("buildPostFeedback empty input -> []", () => {
  assertEquals(buildPostFeedback([], []), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-content_test.ts
```
Expected: FAIL to load — `The requested module '../mcp/content.ts' does not provide an export named 'buildPostFeedback'`.

- [ ] **Step 3: Implement the helpers**

Append to `supabase/functions/mcp/content.ts`:

```ts
// ---- post feedback (list_post_feedback) -------------------------------------

/** Normalized feedback row (one post_approvals row joined to its post). */
export interface FeedbackRow {
  post_id: number;
  titulo: string;
  status: string;
  cliente_id: number;
  action: string;
  comentario: string | null;
  is_workspace_user: boolean;
  created_at: string;
}

/** Normalized status-transition row (one post_status_events row). */
export interface StatusEventRow {
  post_id: number;
  from_status: string | null;
  to_status: string;
  source: string;
  actor_name: string | null;
  created_at: string;
}

export interface PostFeedbackItem {
  post_id: number;
  titulo: string;
  cliente_id: number;
  status: string;
  latest_feedback_at: string;
  feedback: {
    action: string;
    comentario: string | null;
    author: "client" | "workspace";
    created_at: string;
  }[];
  timeline: {
    from_status: string | null;
    to_status: string;
    source: string;
    actor_name: string | null;
    created_at: string;
  }[];
}

/**
 * Distinct post_ids in first-seen order, capped at `limit`. Input is expected in
 * the desired order (newest-first). Duplicate post_ids do NOT consume a slot, so
 * one chatty post cannot crowd out other posts within the in-memory list.
 */
export function topDistinctPostIds(rows: { post_id: number }[], limit: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of rows) {
    if (seen.has(r.post_id)) continue;
    seen.add(r.post_id);
    out.push(r.post_id);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Group feedback rows by post into PostFeedbackItem[]: feedback newest-first,
 * timeline oldest->newest, `author` derived from is_workspace_user, and posts
 * ordered by latest_feedback_at desc. ISO-8601 timestamps compare lexicographically.
 */
export function buildPostFeedback(
  feedbackRows: FeedbackRow[],
  statusEvents: StatusEventRow[],
): PostFeedbackItem[] {
  const eventsByPost = new Map<number, StatusEventRow[]>();
  for (const e of statusEvents) {
    const arr = eventsByPost.get(e.post_id) ?? [];
    arr.push(e);
    eventsByPost.set(e.post_id, arr);
  }

  const byPost = new Map<number, { meta: FeedbackRow; rows: FeedbackRow[] }>();
  for (const r of feedbackRows) {
    const g = byPost.get(r.post_id);
    if (g) g.rows.push(r);
    else byPost.set(r.post_id, { meta: r, rows: [r] });
  }

  const items: PostFeedbackItem[] = [];
  for (const { meta, rows } of byPost.values()) {
    const feedback = rows
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .map((r) => ({
        action: r.action,
        comentario: r.comentario,
        author: (r.is_workspace_user ? "workspace" : "client") as "client" | "workspace",
        created_at: r.created_at,
      }));
    const timeline = (eventsByPost.get(meta.post_id) ?? [])
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
      .map((e) => ({
        from_status: e.from_status,
        to_status: e.to_status,
        source: e.source,
        actor_name: e.actor_name,
        created_at: e.created_at,
      }));
    items.push({
      post_id: meta.post_id,
      titulo: meta.titulo,
      cliente_id: meta.cliente_id,
      status: meta.status,
      latest_feedback_at: feedback[0]?.created_at ?? meta.created_at,
      feedback,
      timeline,
    });
  }

  items.sort((a, b) =>
    a.latest_feedback_at < b.latest_feedback_at ? 1 : a.latest_feedback_at > b.latest_feedback_at ? -1 : 0
  );
  return items;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-content_test.ts
```
Expected: PASS (all three new tests `... ok`, plus the pre-existing content tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/content.ts supabase/functions/__tests__/mcp-content_test.ts
git commit -m "feat(mcp): pure helpers for list_post_feedback (grouping + distinct post ids)"
```

---

### Task 2: `listPostFeedback` query + scoping test + `list_post_feedback` registration

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (add `buildPostFeedback`/`topDistinctPostIds`/types to the `./content.ts` import; append `listPostFeedback` + `FEEDBACK_SCAN_CAP`)
- Create: `supabase/functions/__tests__/mcp-feedback_test.ts` (recording fake-db scoping test)
- Modify: `supabase/functions/mcp/tools.ts` (add `listPostFeedback` to the `./queries.ts` import; add one `register()` call)

**Interfaces:**
- Consumes: `buildPostFeedback`, `topDistinctPostIds`, `FeedbackRow`, `StatusEventRow` (Task 1); `Deps` (`queries.ts:20`), `clientWorkflowIds` (`queries.ts:208`), `register` (`tools.ts:42`), `McpKeyContext` (`_shared/mcp-token.ts:32`)
- Produces: `listPostFeedback(d: Deps, args: { post_id?: number; client_id?: number; action?: string; since?: string; limit?: number }): Promise<any[]>`; MCP tool `list_post_feedback`

- [ ] **Step 1: Write the failing scoping test**

Create `supabase/functions/__tests__/mcp-feedback_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { listPostFeedback } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client: chainable methods record their args; `await`
// pulls the next canned response from that table's queue.
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];

  function recorder(table: string) {
    const rec: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) {
      rec[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return rec;
      };
    }
    // deno-lint-ignore no-explicit-any
    (rec as any).then = (resolve: (r: Resp) => unknown) => {
      const r = (queues[table] ?? []).shift() ?? { data: [], error: null };
      return Promise.resolve(resolve(r));
    };
    return rec;
  }

  const db = {
    from: (table: string) => {
      calls.push({ table, method: "from", args: [table] });
      return recorder(table);
    },
  };
  return { db, calls };
}

const CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["posts:read"],
  key_id: "k1",
  created_by: "u1",
};

function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some(
    (c) => c.table === table && c.method === method &&
      JSON.stringify(c.args) === JSON.stringify(args),
  );
}

Deno.test("listPostFeedback scopes every read to the workspace", async () => {
  const { db, calls } = makeFakeDb({
    // clientWorkflowIds, then the cliente_id map
    workflows: [
      { data: [{ id: 55 }], error: null },
      { data: [{ id: 55, cliente_id: 7 }], error: null },
    ],
    // phase 1 scan, then phase 2a full feedback
    post_approvals: [
      { data: [{ post_id: 123, created_at: "2026-06-02T10:00:00Z" }], error: null },
      {
        data: [{
          post_id: 123, action: "correcao", comentario: "x", is_workspace_user: false,
          created_at: "2026-06-02T10:00:00Z",
          workflow_posts: { workflow_id: 55, titulo: "T", status: "correcao_cliente", conta_id: "workspace-A" },
        }],
        error: null,
      },
    ],
    post_status_events: [{ data: [], error: null }],
  });

  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listPostFeedback(deps, {
    post_id: 123, client_id: 9, action: "correcao", since: "2026-06-01T00:00:00Z", limit: 10,
  });

  // (11) every post_approvals read carries the inner join + conta_id filter
  const paFroms = calls.filter((c) => c.table === "post_approvals" && c.method === "from").length;
  assertEquals(paFroms, 2, "post_approvals read in both phase 1 and phase 2a");
  const paConta = calls.filter(
    (c) => c.table === "post_approvals" && c.method === "eq" &&
      JSON.stringify(c.args) === JSON.stringify(["workflow_posts.conta_id", "workspace-A"]),
  ).length;
  assertEquals(paConta, 2, "both post_approvals reads filter workflow_posts.conta_id");
  for (const c of calls) {
    if (c.table === "post_approvals" && c.method === "select") {
      assert(String(c.args[0]).includes("workflow_posts!inner"), "select uses inner join");
    }
  }

  // (12) conjunctive post_id + client_id on the feedback reads
  assert(has(calls, "post_approvals", "eq", ["post_id", 123]), "post_id filter applied");
  assert(has(calls, "post_approvals", "in", ["workflow_posts.workflow_id", [55]]), "client workflow filter applied");

  // (14) timeline fetch scoped by conta_id + chosen post ids
  assert(has(calls, "post_status_events", "eq", ["conta_id", "workspace-A"]), "timeline conta filter");
  assert(has(calls, "post_status_events", "in", ["post_id", [123]]), "timeline post filter");

  // (15) since + action applied
  assert(has(calls, "post_approvals", "gte", ["created_at", "2026-06-01T00:00:00Z"]), "since filter");
  assert(has(calls, "post_approvals", "eq", ["action", "correcao"]), "action filter");

  // sanity: shaped output
  assertEquals(out.length, 1);
  assertEquals(out[0].post_id, 123);
  assertEquals(out[0].cliente_id, 7);
});

Deno.test("listPostFeedback short-circuits when client has no workflows", async () => {
  const { db, calls } = makeFakeDb({
    workflows: [{ data: [], error: null }], // clientWorkflowIds -> []
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listPostFeedback(deps, { client_id: 9 });

  assertEquals(out, []); // (13) returns [] ...
  assertEquals(calls.some((c) => c.table === "post_approvals"), false); // ... and never queries post_approvals
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-feedback_test.ts
```
Expected: FAIL to load — `The requested module '../mcp/queries.ts' does not provide an export named 'listPostFeedback'`.

- [ ] **Step 3: Implement the query**

In `supabase/functions/mcp/queries.ts`, add the Task-1 exports to the existing import from `./content.ts` (keep alphabetical):

```ts
import {
  allowlistClient,
  buildPostFeedback,
  CLIENT_PUBLIC_FIELDS,
  deriveFormatMeta,
  FeedbackRow,
  firstLine,
  performanceTier,
  quartiles,
  Quartiles,
  StatusEventRow,
  topDistinctPostIds,
} from "./content.ts";
```

(Keep any other existing members of that import, e.g. `pageContentToMarkdown` if present on this branch.)

Append at the end of `supabase/functions/mcp/queries.ts`:

```ts
// ---- post feedback -----------------------------------------------------------

const FEEDBACK_SCAN_CAP = 2000;

export async function listPostFeedback(
  d: Deps,
  args: { post_id?: number; client_id?: number; action?: string; since?: string; limit?: number },
): Promise<any[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 25), 100);

  let wfIds: number[] | null = null;
  if (args.client_id !== undefined) {
    wfIds = await clientWorkflowIds(d, args.client_id);
    if (wfIds.length === 0) return [];
  }

  // Shared tenant + content filters, applied to BOTH post_approvals reads.
  const applyFilters = (q: any) => {
    q = q.eq("workflow_posts.conta_id", d.ctx.conta_id); // never read post_approvals by bare post_id
    if (args.post_id !== undefined) q = q.eq("post_id", args.post_id);
    if (wfIds) q = q.in("workflow_posts.workflow_id", wfIds);
    if (args.action) q = q.eq("action", args.action);
    if (args.since) q = q.gte("created_at", args.since);
    return q;
  };

  // Phase 1 — pick post ids (capped scan).
  const { data: scanData, error: scanErr } = await applyFilters(
    d.db.from("post_approvals").select("post_id, created_at, workflow_posts!inner(conta_id)"),
  ).order("created_at", { ascending: false }).limit(FEEDBACK_SCAN_CAP);
  if (scanErr) throw scanErr;
  const scanRows = (scanData ?? []) as any[];
  if (scanRows.length === FEEDBACK_SCAN_CAP) {
    console.warn(`[mcp] list_post_feedback hit SCAN_CAP=${FEEDBACK_SCAN_CAP} for conta ${d.ctx.conta_id}`);
  }
  const chosenIds = topDistinctPostIds(scanRows, limit);
  if (chosenIds.length === 0) return [];

  // Phase 2a (feedback) + 2b (timeline), in parallel.
  const feedbackP = applyFilters(
    d.db.from("post_approvals").select(
      "post_id, action, comentario, is_workspace_user, created_at, " +
      "workflow_posts!inner(workflow_id, titulo, status, conta_id)",
    ),
  ).in("post_id", chosenIds);
  const eventsP = d.db.from("post_status_events")
    .select("post_id, from_status, to_status, source, actor_name, created_at")
    .eq("conta_id", d.ctx.conta_id)
    .in("post_id", chosenIds)
    .order("created_at", { ascending: true });
  const [{ data: fbData, error: fbErr }, { data: evData, error: evErr }] = await Promise.all([feedbackP, eventsP]);
  if (fbErr) throw fbErr;
  if (evErr) throw evErr;

  // Resolve cliente_id via workflow_id -> cliente_id.
  const fbRaw = (fbData ?? []) as any[];
  const wfPresent = [...new Set(fbRaw.map((r) => r.workflow_posts.workflow_id))];
  const clienteByWf = new Map<number, number>();
  if (wfPresent.length > 0) {
    const { data: wfData, error: wfErr } = await d.db
      .from("workflows").select("id, cliente_id")
      .eq("conta_id", d.ctx.conta_id).in("id", wfPresent);
    if (wfErr) throw wfErr;
    for (const w of (wfData ?? []) as any[]) clienteByWf.set(w.id, w.cliente_id);
  }

  const feedbackRows: FeedbackRow[] = [];
  for (const r of fbRaw) {
    const wfId = r.workflow_posts.workflow_id;
    const cliente_id = clienteByWf.get(wfId);
    if (cliente_id === undefined) {
      console.warn(`[mcp] list_post_feedback: workflow ${wfId} missing cliente_id (conta ${d.ctx.conta_id}); dropping row`);
      continue;
    }
    feedbackRows.push({
      post_id: r.post_id,
      titulo: r.workflow_posts.titulo,
      status: r.workflow_posts.status,
      cliente_id,
      action: r.action,
      comentario: r.comentario ?? null,
      is_workspace_user: r.is_workspace_user,
      created_at: r.created_at,
    });
  }

  const statusEvents: StatusEventRow[] = ((evData ?? []) as any[]).map((e) => ({
    post_id: e.post_id,
    from_status: e.from_status ?? null,
    to_status: e.to_status,
    source: e.source,
    actor_name: e.actor_name ?? null,
    created_at: e.created_at,
  }));

  return buildPostFeedback(feedbackRows, statusEvents);
}
```

- [ ] **Step 4: Register the tool**

In `supabase/functions/mcp/tools.ts`, add `listPostFeedback` to the existing import from `./queries.ts` (keep alphabetical — between `listIdeas` and `listPosts`):

```ts
import {
  Deps,
  getBrandProfile,
  getClient,
  getPerformanceBaseline,
  getPost,
  listClients,
  listIdeas,
  listPostFeedback,
  listPosts,
  listWorkflows,
} from "./queries.ts";
```

(Preserve any other existing members, e.g. `listPages` if present on this branch.)

Inside `registerTools`, after the `list_ideas` registration and before the closing `}`, add:

```ts
  register(server, deps, "list_post_feedback", "posts:read",
    "Lista o feedback dos clientes nos posts (aprovações, correções, mensagens) com a linha do tempo de status.",
    {
      post_id: z.number().int().optional(),
      client_id: z.number().int().optional(),
      action: z.enum(["aprovado", "correcao", "mensagem"]).optional(),
      since: z.string().optional(),
      limit: z.number().int().optional(),
    },
    (a) => listPostFeedback(deps, a));
```

- [ ] **Step 5: Run the scoping test to verify it passes**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-feedback_test.ts
```
Expected: PASS (both tests `... ok`).

- [ ] **Step 6: Typecheck the MCP module graph**

Run:
```bash
deno check --node-modules-dir=auto supabase/functions/mcp/index.ts
```
(The `--node-modules-dir=auto` flag is required — plain `deno check` fails resolving `npm:@modelcontextprotocol/sdk`, a pre-existing environment quirk.)
Expected: no output / exit 0.

- [ ] **Step 7: Run the full edge-function suite**

Run:
```bash
npm run test:functions
```
Expected: PASS — all existing tests plus Task 1's helper tests and this task's scoping tests. No failures.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-feedback_test.ts
git commit -m "feat(mcp): add list_post_feedback tool exposing the client feedback loop"
```

---

### Task 3: Rollout (deploy) — requires explicit go-ahead

**Files:** none (operational step)

> ⚠️ Outward-facing/prod change. Do NOT run without the user's explicit confirmation and the target project (prod ref `skjzpekeqefvlojenfsw`). The `mcp` function handles its own auth, so it MUST be deployed with `--no-verify-jwt`.

- [ ] **Step 1: Deploy the function**

```bash
npx supabase functions deploy mcp --no-verify-jwt
```
Expected: deploy succeeds for the `mcp` function.

- [ ] **Step 2: Restore deno.lock if polluted**

```bash
git status --short deno.lock supabase/functions/deno.lock
# if modified:
git checkout deno.lock supabase/functions/deno.lock && npm ci
```

- [ ] **Step 3: Smoke-test live**

From an MCP client authenticated to a workspace with at least one post that has client feedback (key with `posts:read`), call `list_post_feedback` (try `action: "correcao"`, and a `client_id`) and confirm it returns post-grouped feedback with `author` and a `timeline`. Confirm a key WITHOUT `posts:read` gets a permission-denied error.

---

## Notes / out of scope

- No write tools; no new scope; no full caption body in output; no `author` filter; legacy `portal_approvals` ignored; no phase-1 SQL/RPC (documented SCAN_CAP upgrade path in the spec).
- If a user-facing MCP tool list exists (e.g. the Claude connector docs page), adding `list_post_feedback` there is a separate, optional follow-up.

## Self-Review

- **Spec coverage:** tool contract + filters/clamp/scope (Task 2 query + registration) ✓; two-phase scoped read incl. uncapped phase-2a, SCAN_CAP log, cliente_id drop+warn (Task 2 query) ✓; `topDistinctPostIds` + `buildPostFeedback` incl. author/ordering/empty (Task 1) ✓; tenant-scoping mocked-db test incl. conta_id-on-every-read, conjunctive post_id/client_id, empty-workflows short-circuit, timeline conta_id, since/action (Task 2 test, assertions 11–15) ✓; helper tests 1–10 (Task 1) ✓; error handling inherited from `register()` ✓; correct test + typecheck commands ✓.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `FeedbackRow`/`StatusEventRow`/`PostFeedbackItem` defined in Task 1, imported and used identically in Task 2; `topDistinctPostIds(rows, limit)` and `buildPostFeedback(feedbackRows, statusEvents)` signatures match across tasks; `listPostFeedback(d, args)` produced in Task 2 step 3, consumed by the test (step 1) and registration (step 4); `clientWorkflowIds`/`Deps`/`McpKeyContext` referenced at their real locations.
