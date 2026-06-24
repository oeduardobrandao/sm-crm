# Design: `create_workflow` + `create_post` MCP write tools (posts-write slice)

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Branch:** `feat/mcp-posts-write`

## Goal

Give MCP agents their first **write** capability: draft Instagram posts into the
CRM, draft-only. This is the slice that turns the agent from "reads and describes"
into "produces" — the copywriter's output. It deliberately establishes the **write
plumbing** (a new write scope end-to-end, the first mutating tools, write-side
tenant checks, audit redaction, provenance) on posts, which is the real target.

Two tools, both gated by a single new `posts:write` scope:

- `create_workflow({ client_id, titulo })` — creates a production fluxo (a post
  needs one; `workflow_posts.workflow_id` is `NOT NULL`).
- `create_post({ workflow_id, titulo, tipo?, body?, ig_caption? })` — creates a
  **draft** post (`status` hardcoded `'rascunho'`).

Scope is intentionally narrow: **create-only**. Because a created post is always
`rascunho`, the draft-only guarantee is one hardcoded value — no status-allowlist
machinery (that lives in the next slice, with `update_post`).

## Out of scope (YAGNI)

- `update_post` / any status change → next slice (where the status allowlist lives).
- `set_post_property`, media upload/attach, scheduling.
- A separate `workflows:write` scope — `create_workflow` rides on `posts:write`
  (the fluxo is scaffolding for the post). Split later if finer granularity is wanted.
- Atomicity across the workflow+etapa inserts (see Default etapa).

## Data model (existing, + one migration)

- **`workflows`** (`20260301_baseline_schema.sql`): `id`, `conta_id`, `user_id`,
  `cliente_id` (→ `clientes`), `titulo`, `status` (`ativo|concluido|arquivado`),
  `etapa_atual` (int), `recorrente` (bool), `modo_prazo`, …
- **`workflow_etapas`** (`20260301` + `tipo` via `20260325_portal_approvals.sql`):
  `id`, `workflow_id`, `ordem` (NN), `nome` (NN), `prazo_dias` (NN),
  `tipo_prazo` (`uteis|corridos`, default `corridos`), `tipo` (default `padrao`),
  `status` (`pendente|ativo|concluido`, default `pendente`), `iniciado_em`,
  `responsavel_id`, `concluido_em`, `data_limite`.
- **`workflow_posts`** (`20260402_workflow_posts.sql` + `ig_caption` via
  `20260427000001_instagram_publishing.sql`): `id`, `workflow_id` (NN →
  `workflows`), `conta_id` (NN), `titulo`, `conteudo` (jsonb, TipTap), `conteudo_plain`
  (text), `tipo` (`feed|reels|stories|carrossel`, default `feed`), `ordem` (int),
  `status` (`rascunho|…`, default `rascunho`), `ig_caption` (text), `responsavel_id`, …

### Migration (provenance)
New migration adds to **both** tables:
```sql
ALTER TABLE workflows      ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human'
  CHECK (created_via IN ('human','agent'));
ALTER TABLE workflow_posts ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human'
  CHECK (created_via IN ('human','agent'));
```
Default `'human'` keeps all existing rows + the CRM/Express-Post insert paths correct
with no code change; the MCP tools set `'agent'`.

## Tool contracts

### `create_workflow`
```
create_workflow({ client_id: int>0, titulo: string(trim,1..200) }) →
  { id, cliente_id, titulo, status: "ativo", etapa_atual: 0, created_via: "agent", created_at }
```
1. **Ownership check:** `clientes` where `id=client_id AND conta_id=ctx.conta_id`
   (`maybeSingle`); if absent → `McpInputError("Cliente não encontrado neste workspace.")`.
2. Insert `workflows`: `{ conta_id: ctx.conta_id, user_id: ctx.created_by, cliente_id,
   titulo, status:'ativo', etapa_atual:0, recorrente:false, modo_prazo:'padrao',
   created_via:'agent' }` → `select().single()`.
3. Insert one default etapa (mirrors the template path's first etapa,
   `workflows.ts:467-468`): `{ workflow_id, ordem:0, nome:'Conteúdo', prazo_dias:0,
   tipo_prazo:'corridos', tipo:'padrao', status:'ativo', iniciado_em:now,
   responsavel_id:null, concluido_em:null, data_limite:null }`. **Required** — the
   entregas UI does `etapas[etapa_atual] || etapas[0]` (`useEntregasData.ts:304`), so a
   fluxo with zero etapas renders broken.
4. Return the workflow row (so the agent gets `id` to chain into `create_post`).

`now = d.now?.() ?? new Date().toISOString()`. The two inserts are **non-atomic**
(no cross-statement transaction; matches Express Post). Documented limitation.

### `create_post`
```
create_post({
  workflow_id: int>0,
  titulo:  string(trim,1..200),
  tipo?:   "feed"|"reels"|"stories"|"carrossel"   // default "feed"
  body?:   string(max 10000),      // plain text → conteudo + conteudo_plain
  ig_caption?: string(max 2200),   // Instagram's caption limit
}) → { id, workflow_id, titulo, tipo, status: "rascunho", ig_caption, created_via: "agent", created_at }
```
1. **Ownership check:** `workflows` where `id=workflow_id AND conta_id=ctx.conta_id`
   (`maybeSingle`); if absent → `McpInputError("Fluxo não encontrado neste workspace.")`.
2. `ordem` = `max(ordem)+1` over the fluxo's posts (`0` if none). Race-duplicate
   `ordem` acceptable for v1 (no RPC) — documented.
3. Insert `workflow_posts`: `{ workflow_id, conta_id: ctx.conta_id, titulo,
   tipo: tipo ?? 'feed', conteudo: buildTiptapDoc(body), conteudo_plain: body ?? '',
   ig_caption: ig_caption ?? null, ordem, status:'rascunho', created_via:'agent' }`
   → `select().single()`.
4. Return the post row.

**`status` is hardcoded `'rascunho'`** — never an input. This is the whole
draft-only boundary; the agent cannot reach any client-facing or publish state.

## `buildTiptapDoc` (pure helper, content.ts)

```ts
buildTiptapDoc(plain: string | undefined): { type: "doc"; content: ... }
```
- `body` is **plain text** (not markdown; markdown syntax would appear literally).
- Splits on `\n`. Each non-empty line → `{type:"paragraph", content:[{type:"text", text:line}]}`;
  a blank line → `{type:"paragraph"}` (no content). Empty/undefined `body` →
  `{type:"doc", content:[{type:"paragraph"}]}` (a valid empty doc).
- Uses **only core `doc`/`paragraph`/`text` nodes** — guards against the known
  "missing node/mark type silently blanks the whole Hub post body" failure. Never
  store a raw string in `conteudo`.
- `conteudo_plain` is `body` verbatim (the plain mirror the CRM uses).

## Write-side tenant security

The FK only proves the referenced row exists, not that it belongs to the caller's
workspace. So **before any insert**, both tools run an explicit
`conta_id`-scoped ownership check (above). The `mcp` function uses a service-role
client (RLS bypassed), so these app-level checks are the sole write boundary —
identical posture to the read tools' `conta_id` filters.

## Provenance surfacing

- `created_via` flows back in both create responses.
- **MCP read outputs updated too:** add `created_via` to the projections **and**
  output shapes of `list_posts` (`POST_COLS`), `get_post`, and `list_workflows` —
  otherwise an agent re-reading its own drafts wouldn't see provenance (those tools
  use explicit projections, not `select('*')`).
- **CRM badge:** add `created_via` to the `Workflow`/`WorkflowPost` TS types (CRM
  reads use `select('*')`, so the column arrives automatically) and render a small
  **"IA" badge** on the entregas post card and `WorkflowCard` when `created_via==='agent'`.

## Audit redaction (write tools must not log payload)

The `register()` wrapper logs `metadata.args` verbatim, on the existing "ids/filters
only, no payload" assumption (`tools.ts:30-39`). Writes carry `body`/`ig_caption`
payload, so:

- `register()` gains an optional trailing `auditArgs?: (args) => Record<string, unknown>`.
  Reads omit it (identity → unchanged behavior). The audit call becomes
  `audit(deps, name, (auditArgs ?? ((a)=>a))(args ?? {}))`.
- `create_post` redactor: `{ workflow_id, tipo, titulo, has_body: !!body,
  body_len: body?.length ?? 0, has_ig_caption: !!ig_caption, ig_caption_len: ig_caption?.length ?? 0 }`
  — IDs + the short `titulo` label + payload presence/length, **never** the
  `body`/`ig_caption` content.
- `create_workflow` redactor: `{ client_id, titulo }`.

(`audit()`'s `resource_id` derivation may be empty for `create_post` since the new
id isn't known pre-insert; acceptable — the redacted args still record the call.)

## Scope plumbing

- **Backend** `_shared/mcp-token.ts`: add `'posts:write'` to `MCP_ALLOWED_SCOPES`
  **only** — NOT to `MCP_AGENT_PRESET` (stays read-only / least-privilege).
  `validateScopes` auto-accepts it. Add the `McpInputError` class here (next to
  `McpScopeError`).
- **Frontend** `apps/crm/src/lib/mcp-scopes.ts`: add
  `{ value: 'posts:write', label: 'Posts (escrita)' }` to `SCOPE_OPTIONS`, **and**
  change `AGENT_PRESET` from `SCOPE_OPTIONS.map((s) => s.value)` to an explicit
  read-only list, so adding a write option doesn't silently grant it. The
  key-creation UI and OAuth consent page read `SCOPE_OPTIONS`, so the new (opt-in)
  option appears automatically.

## Error handling

`errorResult` (`tools.ts`) special-cases:
- `McpScopeError` → `"Permission denied: missing scope 'posts:write'."` (existing).
- `McpInputError` → **its own message** (safe: describes the caller's own workspace,
  e.g. "Fluxo não encontrado neste workspace."), `isError: true`.
- **Everything else stays generic** `"Internal error."` + `console.error` internally
  (raw DB errors never leak).

## Components / files

- **Migration:** `supabase/migrations/<ts>_created_via.sql` (both tables).
- **`mcp/content.ts`** — `buildTiptapDoc` (pure).
- **`mcp/queries.ts`** — `createWorkflow`, `createPost` (+ ownership checks, `ordem`,
  default etapa); add `created_via` to `POST_COLS`/`get_post`/`listWorkflows`
  projections + output shapes.
- **`mcp/tools.ts`** — register `create_workflow`/`create_post` under `posts:write`
  with audit redactors; extend `register()` with `auditArgs`; add the `McpInputError`
  branch to `errorResult`.
- **`_shared/mcp-token.ts`** — `'posts:write'` scope + `McpInputError` class.
- **`apps/crm/src/lib/mcp-scopes.ts`** — `posts:write` option + explicit read-only
  `AGENT_PRESET`.
- **CRM** — `created_via` on `Workflow`/`WorkflowPost` types + "IA" badge on the
  entregas post card and `WorkflowCard`.

## Testing

- **Unit (`mcp-content_test.ts`)** — `buildTiptapDoc`: single line → one paragraph;
  multi-line → paragraph per line; blank line → empty paragraph; empty/undefined →
  `{doc,[{paragraph}]}`; verifies only `doc/paragraph/text` node types appear.
- **Write behavior + scoping (`mcp-feedback`-style recording fake `db`, new file
  `mcp-writes_test.ts`)** — extend the fake recorder with `insert`, `single`,
  `maybeSingle` (in addition to `select/eq/in/order/limit`). Assert:
  - `create_workflow`: ownership check queries `clientes` with
    `.eq("conta_id","workspace-A")`; missing client → `McpInputError` (no insert);
    workflow insert payload has `created_via:'agent'`, `status:'ativo'`,
    `conta_id:'workspace-A'`, `user_id` = `ctx.created_by`; a default etapa is inserted
    with `ordem:0`, `status:'ativo'`.
  - `create_post`: ownership check queries `workflows` with `.eq("conta_id","workspace-A")`;
    missing workflow → `McpInputError` (no insert); post insert payload has
    `status:'rascunho'`, `created_via:'agent'`, `conta_id:'workspace-A'`,
    `conteudo` is a TipTap doc (not a raw string); `ordem` = max+1.
- Run: `npm run test:functions`. Typecheck: `deno check --node-modules-dir=auto
  supabase/functions/mcp/index.ts`. Frontend: `npm run build` (CRM badge/types).

## Rollout (gated — explicit go-ahead required)

1. Apply the `created_via` migration to **prod + staging** via the Supabase SQL
   editor (the `db push` to staging is flaky per project notes; the `ADD COLUMN IF
   NOT EXISTS … DEFAULT` is safe/idempotent).
2. Deploy the function: `npx supabase functions deploy mcp --no-verify-jwt
   --project-ref <prod>` (and staging), then restore `deno.lock` + `npm ci`.
3. Deploy the CRM (Vercel) for the badge.
4. Smoke-test: a key/connection with `posts:write` runs `create_workflow` →
   `create_post`; confirm the draft appears in entregas as `rascunho` with an "IA"
   badge; confirm a `posts:read`-only key gets permission-denied; confirm a foreign
   `client_id`/`workflow_id` returns the `McpInputError` message, not a generic error.
