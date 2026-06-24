# Design: `list_post_feedback` MCP tool

**Date:** 2026-06-23
**Status:** Approved (pending spec review)
**Branch:** `feat/mcp-list-post-feedback`

## Goal

Expose the **client feedback loop** to MCP agents: the approve / request-correction /
message decisions a client leaves on posts (`post_approvals`) plus the
status-transition trail (`post_status_events`). This lets a content agent learn a
client's *revealed* preferences ("rejected these captions as 'too clinical'"),
not just the stated briefing — the single highest-leverage read for an agent that
will draft Instagram content.

This is slice #1 of the broader agent-tooling roadmap. It extends the existing
read surface (`list_clients`, `get_client`, `get_brand_profile`, `list_posts`,
`get_post`, `get_performance_baseline`, `list_workflows`, `list_ideas`,
`list_pages`) with one more read tool. No behavioural change to existing tools.

## Data model (existing)

### `post_approvals` — per-post client feedback (the live table)
`portal_approvals` is a legacy/dead table (zero references in `apps/`/`functions/`);
the live writers are `hub-approve` and the `record_client_approval` RPC, both
targeting `post_approvals`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `post_id` | bigint | FK → `workflow_posts(id)` ON DELETE CASCADE |
| `token` | text | hub token, **nullable** (made nullable for workspace replies — migration `20260429000002`); NOT exposed by this tool |
| `action` | text | `aprovado` \| `correcao` \| `mensagem` |
| `comentario` | text | the client's words (nullable) |
| `is_workspace_user` | boolean | `false` = client, `true` = agency reply |
| `created_at` | timestamptz | |

**No `conta_id` column** — scoping is only possible by joining
`workflow_posts.conta_id`. This tool therefore NEVER reads `post_approvals` by
bare `post_id`; it always goes through the inner join (see Scoping).

### `post_status_events` — per-post status transition audit
| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `post_id` | bigint | FK → `workflow_posts(id)` |
| `conta_id` | uuid | **present directly** — second independent tenant check |
| `from_status` | text | nullable (first event) |
| `to_status` | text | not null |
| `source` | text | `workspace_user` \| `client` \| `system` |
| `actor_user_id` | uuid | nullable |
| `actor_name` | text | nullable (resolved from `profiles`) |
| `post_approval_id` | bigint | FK → `post_approvals(id)` (nullable) |
| `created_at` | timestamptz | |

### `workflow_posts` (relevant columns)
`id`, `conta_id`, `workflow_id` (→ `workflows`), `titulo`, `status`. Has **no
`cliente_id`** — the client is on `workflows.cliente_id`. The MCP already has a
helper `clientWorkflowIds(d, clientId)` returning a client's workflow ids scoped
by `conta_id`.

## Tool contract

```
list_post_feedback({ post_id?, client_id?, action?, since?, limit? }) → PostFeedbackItem[]
```

- **Scope:** `posts:read` (feedback is about posts; same scope as
  `list_posts` / `get_post`). No new scope, no UI/consent changes.
- **Input shape** (zod):
  - `post_id?: number` (int)
  - `client_id?: number` (int)
  - `action?: enum("aprovado","correcao","mensagem")`
  - `since?: string` — passed directly to `.gte("created_at", since)` (no strict
    parsing; matches `list_posts`' `published_since`)
  - `limit?: number` (int)
- **Output:** array of posts (one item per post that has matching feedback),
  ordered by `latest_feedback_at` **desc**:

  ```jsonc
  {
    "post_id": 123,
    "titulo": "Carrossel sobre acne",
    "cliente_id": 7,
    "status": "aprovado_cliente",            // current post status
    "latest_feedback_at": "2026-06-20T14:00:00Z",  // max feedback created_at — the exposed ordering key
    "feedback": [                            // post_approvals — newest first
      { "action": "correcao", "comentario": "muito clínico",
        "author": "client", "created_at": "2026-06-20T14:00:00Z" }
    ],
    "timeline": [                            // post_status_events — oldest→newest
      { "from_status": "enviado_cliente", "to_status": "correcao_cliente",
        "source": "client", "actor_name": null, "created_at": "…" }
    ]
  }
  ```

### Filter & selection semantics (pinned down)
- `action` and `since` filter the **feedback selection**: a post is included iff
  it has ≥1 approval row passing the filters, and its `feedback[]` contains only
  the passing rows.
- `timeline[]` is the **full** status history for a selected post — it is NOT
  filtered by `action`/`since`.
- `post_id` + `client_id` are **conjunctive**: when both are given, a post is
  returned only if it is that post AND it belongs to that client; otherwise `[]`.
- `limit` = **max distinct posts** (not feedback rows). Default 25, max 100,
  clamped in `queries.ts` (`Math.min(Math.max(1, args.limit ?? 25), 100)`), not
  only in the zod shape.
- `author` is derived: `is_workspace_user === true ? "workspace" : "client"`.
  This is the one derived field (an LLM misreads `is_workspace_user: false`);
  every other field keeps its raw column name to match `list_posts`/`list_ideas`.
- `comentario` may be `null` (e.g. an `aprovado` with no note) — passed through
  as-is.

## Scoping & query approach (security-critical)

`post_approvals` has no `conta_id`; it is read **only** through the inner join on
`workflow_posts.conta_id` — never by bare `post_id`. The read is **two-phase** so
SCAN_CAP can only affect *which posts* are picked, never the completeness of a
selected post's `feedback[]`:

**Phase 1 — pick the post ids** (lightweight capped scan):
```
post_approvals
  .select("post_id, created_at, workflow_posts!inner(conta_id)")
  .eq("workflow_posts.conta_id", d.ctx.conta_id)
```
Conditional filters (all **conjunctive**):
- `post_id` given → `.eq("post_id", post_id)`
- `client_id` given → `wfIds = await clientWorkflowIds(d, client_id)`; if
  `wfIds.length === 0` return `[]` (no `post_approvals` query); else
  `.in("workflow_posts.workflow_id", wfIds)`
- `action` given → `.eq("action", action)`
- `since` given → `.gte("created_at", since)`

Then `.order("created_at", { ascending: false }).limit(SCAN_CAP)`, and
`chosenIds = topDistinctPostIds(rows, limit)` (distinct `post_id`s in first-seen
desc order, capped at `limit`). If `chosenIds` is empty, return `[]`.

**Phase 2a — fetch the complete feedback for the chosen posts** (re-scoped, same
content filters, **uncapped**):
```
post_approvals
  .select("post_id, action, comentario, is_workspace_user, created_at,
           workflow_posts!inner(workflow_id, titulo, status, conta_id)")
  .eq("workflow_posts.conta_id", d.ctx.conta_id)   // re-asserted — never bare post_id
  .in("post_id", chosenIds)
```
plus the same `action` / `since` filters as Phase 1. No cap is needed (bounded by
≤ `limit` posts), and **this is what guarantees `feedback[]` is never truncated**:
every matching approval row for each chosen post is returned.

**`cliente_id` resolution:** Phase 2a yields `workflow_id` per row, not
`cliente_id`. Resolve via one query over the distinct workflow ids present:
`workflows.select("id, cliente_id").eq("conta_id", d.ctx.conta_id).in("id", ids)`,
build a `workflow_id → cliente_id` map, and stamp each normalized row. **On a map
miss** (anomalous — inconsistent data or a race): **drop that row and
`console.warn`** (never surfaced to the client). `cliente_id` is therefore always
non-null in the contract; a post left with zero feedback after drops is omitted.

Normalize Phase 2a rows into the explicit shape the helper consumes:
`FeedbackRow = { post_id, titulo, status, cliente_id, action, comentario,
is_workspace_user, created_at }`.

**Phase 2b — timeline fetch** for the chosen post ids (may run in parallel with
2a via `Promise.all`):
```
post_status_events
  .select("post_id, from_status, to_status, source, actor_name, created_at")
  .eq("conta_id", d.ctx.conta_id)          // direct, independent tenant check
  .in("post_id", chosenIds)
  .order("created_at", { ascending: true })
```
Normalize into `StatusEventRow = { post_id, from_status, to_status, source,
actor_name, created_at }`.

**Shape** — `buildPostFeedback(feedbackRows, statusEventRows)` groups by post,
derives `author`, keeps `feedback` newest-first, attaches the full `timeline`
oldest→newest, computes `latest_feedback_at` (max feedback `created_at`), and
orders posts by `latest_feedback_at` desc.

### SCAN_CAP — bounded overfetch (known limitation)
`SCAN_CAP = 2000`, applied **only to the Phase-1 post-id scan**. Because Phase 2a
re-fetches feedback for the chosen posts uncapped, a selected post's `feedback[]`
is always complete — SCAN_CAP can only affect *which posts* are picked. That
selection is therefore **best-effort**: if a single post had more than `SCAN_CAP`
Phase-1 rows newer than the limit-th post's latest feedback, tail posts could be
crowded out of the selection. This is effectively unreachable at agency scale (a
post receives a handful of correction rounds, not thousands of rows), so slice 1
accepts it as a documented trade-off:

- **Log when the cap is hit** (`console.warn` with `conta_id` + count) for
  observability — never returned to the client.
- **Upgrade path** (only if a real workspace ever trips the warning): replace the
  scan+JS-distinct with a phase-1 SQL/RPC
  (`SELECT post_id FROM post_approvals JOIN workflow_posts … WHERE <filters>
  GROUP BY post_id ORDER BY max(created_at) DESC LIMIT n`), which selects the
  correct top-`limit` posts independent of per-post row counts, then fetch all
  feedback + timelines for those ids. PostgREST can't express the `GROUP BY`
  aggregate in its JS builder, hence the RPC.

## Components / files

- **`mcp/content.ts`** — two pure, side-effect-free helpers (testable without a DB,
  alongside `deriveFormatMeta` / `pageContentToMarkdown`):
  - `topDistinctPostIds(rows: { post_id: number }[], limit: number): number[]`
  - `buildPostFeedback(feedbackRows: FeedbackRow[], statusEvents: StatusEventRow[]): PostFeedbackItem[]`
    (plus the `FeedbackRow`, `StatusEventRow`, `PostFeedbackItem` types).
- **`mcp/queries.ts`** — `listPostFeedback(d, args)`: the phased scoped reads
  (Phase 1 id scan, Phase 2a feedback fetch, Phase 2b timeline fetch) + the
  `workflow_id → cliente_id` map (drop+warn on miss) + `limit` clamp + SCAN_CAP
  log, wired into the helpers. Reuses `clientWorkflowIds`. Destructures
  `{ data, error }` and throws on error.
- **`supabase/functions/__tests__/mcp-feedback_test.ts`** — new file: the
  mocked-db scoping test for `listPostFeedback` (see Testing).
- **`mcp/tools.ts`** — register `list_post_feedback` under `posts:read`, Portuguese
  description ("Lista o feedback dos clientes nos posts (aprovações, correções,
  mensagens) com a linha do tempo de status."), shape
  `{ post_id?, client_id?, action?, since?, limit? }`. Audit logging automatic.

## Error handling

Inherited from the `register()` wrapper: `requireScope(ctx, "posts:read")` →
`McpScopeError` → `errorResult`; any thrown query error → caught → generic
`"Internal error."` (logged internally, never leaked). Double tenant isolation:
the inner-join `conta_id` filter on the feedback scan, and the direct `conta_id`
filter on the timeline fetch. A key for workspace A can never read workspace B's
feedback.

## Testing

Unit tests for the pure helpers in `supabase/functions/__tests__/mcp-content_test.ts`:

`buildPostFeedback`:
1. groups multiple approvals under one post; `feedback` newest-first
2. derives `author` (`is_workspace_user` false→`client`, true→`workspace`)
3. attaches `timeline` sorted oldest→newest
4. `latest_feedback_at` = max feedback `created_at`; posts ordered by it desc
5. a selected post with no status events → `timeline: []`
6. `comentario: null` passed through
7. empty input → `[]`

`topDistinctPostIds`:
8. **crowd-out**: many events from one post (appearing first) do NOT displace
   other posts — returns distinct post ids in first-seen order, capped at `limit`
9. fewer distinct posts than `limit` → returns all
10. empty input → `[]`

### Security / scoping test for `listPostFeedback` (mocked db)

This tool's core risk is **tenant scoping**, not grouping, so — unlike the other
query helpers — `listPostFeedback` gets a dedicated test in a new file
`supabase/functions/__tests__/mcp-feedback_test.ts`. Use a small **recording fake
`db`**: a chainable stub whose `.from/.select/.eq/.in/.gte/.order/.limit` record
their arguments and whose `await` resolves to canned `{ data, error }` from a
per-table queue (handles the multiple `workflows` and `post_approvals` reads in
order). No real Supabase. Build `Deps` with `ctx.conta_id = "workspace-A"` and a
matching `ctx.scopes`. Assert:

11. **Every `post_approvals` read (Phase 1 and Phase 2a)** uses a `select`
    containing `workflow_posts!inner` AND an
    `.eq("workflow_posts.conta_id", "workspace-A")` — no `post_approvals` query
    ever omits the conta_id join filter (the load-bearing tenant boundary).
12. **Conjunctive `post_id` + `client_id`:** both `.eq("post_id", X)` and
    `.in("workflow_posts.workflow_id", wfIds)` are applied on Phase 1.
13. **`client_id` whose `clientWorkflowIds` → `[]`** returns `[]` and issues **no**
    `post_approvals` query at all.
14. **Timeline fetch** calls `.from("post_status_events")` with both
    `.eq("conta_id", "workspace-A")` and `.in("post_id", chosenIds)`.
15. **`since` / `action`** are applied on the feedback reads
    (`.gte("created_at", since)`, `.eq("action", action)`).

Only the one-line `tools.ts` `register(...)` wiring remains untested, consistent
with the other tools.

Run with `npm run test:functions`
(`deno test --no-check --node-modules-dir=auto --allow-env --allow-read
--allow-net --allow-sys supabase/functions/`). Typecheck the module graph with
`deno check --node-modules-dir=auto supabase/functions/mcp/index.ts`.

## Out of scope (YAGNI)

- No write tools (later slices).
- No full caption body in output — the agent has `post_id` and calls `get_post`
  for detail.
- No `author` filter (the `action` filter is the high-value one for slice 1).
- No new scope, no key-UI / admin-UI / OAuth-consent changes.
- Legacy `portal_approvals` ignored.
- No phase-1 SQL/RPC for exact distinct-post selection (documented upgrade path
  above; not built until a workspace trips the SCAN_CAP warning).
