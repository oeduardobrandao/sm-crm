# PR 1 — Mesaas MCP server (infra + read-only tools)

**Branch:** `claude/mesaas-mcp-agents-vq1l1q`
**Status:** spec for review — not yet built
**Date:** 2026-06-22

## Goal

Stand up a remote MCP server as a single Supabase Edge Function so a Claude agent can
**read** a workspace's clients, posts (with real performance), brand data, workflows and
ideas — authenticated by a **workspace-scoped API key**. First consumer is a content-writing
agent (clients are doctors → LGPD/CFM-sensitive), so PR 1 is **read-only** and the agent key
is born with the narrowest scopes.

### In scope (PR 1)
- `mcp_api_keys` table + RLS + `_shared/mcp-token.ts` resolver
- `feature_mcp` + `max_mcp_keys` entitlements (plan column + override support)
- `supabase/functions/mcp/` Edge Function (Streamable HTTP) with read-only tools
- Seeded `modo` + `anotacao_qualitativa` custom-property definitions
- Deno tests for the resolver + a couple of tool handlers

### Explicitly out of scope (later PRs)
- CRM key-management UI + "Agente de conteúdo" preset → **PR 2**
- Admin gating/observe/revoke panel → **PR 2**
- Write tools (`create_post` draft-only, etc.) → **PR 3**
- `audit_log` viewer in admin → **PR 3**
- Structured `client_brand_profile` table (voice + compliance flags) → **PR 3 / v2**

---

## 1. Auth — workspace-scoped API keys

### 1a. Migration: `mcp_api_keys`

```sql
create table mcp_api_keys (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references workspaces(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  name          text not null,
  token_hash    text not null unique,           -- SHA-256(secret); raw token NEVER stored
  token_suffix  text not null,                  -- last 4 chars, for masked display only
  scopes        text[] not null default '{}',   -- e.g. {clientes:read, posts:read, ...}
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id), -- CRM user OR platform admin
  created_at    timestamptz not null default now()
);

create index mcp_api_keys_token_hash_idx on mcp_api_keys (token_hash);
create index mcp_api_keys_conta_id_idx   on mcp_api_keys (conta_id);

alter table mcp_api_keys enable row level security;

-- Workspace owner/admin can see + manage their own workspace's keys.
-- token_hash is never selected by clients (the CRM lists name/suffix/scopes/usage only).
create policy mcp_keys_select on mcp_api_keys
  for select using (conta_id in (select public.get_my_conta_id()));

create policy mcp_keys_insert on mcp_api_keys
  for insert with check (
    conta_id in (select public.get_my_conta_id())
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('owner','admin')
    )
  );

create policy mcp_keys_update on mcp_api_keys           -- used for revoke
  for update using (
    conta_id in (select public.get_my_conta_id())
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('owner','admin')
    )
  );
-- No delete policy: keys are revoked (revoked_at), never hard-deleted, to preserve audit trail.
-- Service role (MCP function + platform-admin) bypasses RLS.

-- Column-level privilege: RLS grants ROW access but does NOT hide columns. token_hash must
-- never be readable by app clients (PR 2 CRM may query Supabase directly). Restrict the column:
revoke select on mcp_api_keys from authenticated;
grant select (id, conta_id, created_by, name, token_suffix, scopes,
              last_used_at, expires_at, revoked_at, revoked_by, created_at)
  on mcp_api_keys to authenticated;
-- token_hash deliberately omitted → selecting it raises a permission error.
-- Alternative: a token_hash-free view + SECURITY DEFINER RPCs; column grants are simpler.

-- Plan-cap enforcement: limits are enforced by INSERT TRIGGERS (see count_triggers.sql), NOT by
-- effective_plan_limit() alone. Mirror trg_limit_hub_tokens:
drop trigger if exists trg_limit_mcp_keys on mcp_api_keys;
create trigger trg_limit_mcp_keys before insert on mcp_api_keys
  for each row execute function enforce_plan_count_limit('max_mcp_keys', 'direct', 'conta_id', 'conta_id');
```

**Token format:** `mesaas_sk_<32 random bytes, base62>`. Generated server-side, hashed with
SHA-256, stored as `token_hash`; only `token_suffix` (last 4) is retained for display. Raw
token shown to the user exactly once (PR 2 UI).

### 1b. Resolver: `supabase/functions/_shared/mcp-token.ts`

Mirrors `_shared/hub-token.ts`. Signature:

```ts
export interface McpKeyContext {
  conta_id: string;
  scopes: string[];
  key_id: string;
  created_by: string;
}

export async function resolveMcpKey(
  db: SupabaseClient, rawToken: string, now: string,
): Promise<McpKeyContext | null>;
```

Behavior:
1. Hash `rawToken` (SHA-256), look up by `token_hash` (`maybeSingle`).
2. Return `null` if: not found, `revoked_at` set, or `expires_at <= now`.
3. Return `null` if `effectivePlanFeature(db, conta_id, 'feature_mcp')` is false
   (reuses `_shared/entitlements-rpc.ts`).
4. Best-effort bump `last_used_at` (don't block the request on it).
5. Else return `{ conta_id, scopes, key_id, created_by }`.

Constant-time-safe lookup (hash compare in SQL is fine; do not branch on partial matches).

### 1c. Scope helper

```ts
function requireScope(ctx: McpKeyContext, scope: string): void; // throws McpScopeError → 403-ish tool error
```

Scope strings: `clientes:read`, `posts:read`, `ideias:read`, `workflows:read`
(+ their `:write` forms reserved for PR 3). PR 1 tools only check `:read`.

---

## 2. Entitlements — fold into existing machinery

- Add column `feature_mcp boolean not null default false` to `plans`; then `update plans set
  feature_mcp = true` on the **top-tier plan only** (identify by price/tier — confirm at build).
- Add column `max_mcp_keys integer` to `plans`, **default 5** (overridable per plan/override).
- Add `'feature_mcp'` to `FEATURE_COLUMNS` in `supabase/functions/_shared/entitlements.ts`
  and `max_mcp_keys` to the resource-limit list.
- **Feature toggle is free** — `effective_plan_feature()` + per-workspace override JSON already
  cover turning MCP on/off per plan or per workspace. (Surfacing labels in the admin
  Plans/WorkspaceDetail editors is PR 2.)
- **The `max_mcp_keys` cap is NOT free** — limits are enforced by `before insert` triggers
  (`enforce_plan_count_limit`, see `count_triggers.sql`), not by `effective_plan_limit()` alone.
  PR 1 must add `trg_limit_mcp_keys` (in the migration above) or key creation can exceed the plan.

---

## 3. The Edge Function — `supabase/functions/mcp/`

### Setup
- **Transport (RESOLVED — see Appendix A):** use the SDK's **web-standard** transport
  `WebStandardStreamableHTTPServerTransport` (NOT the Node `StreamableHTTPServerTransport`, which
  is an `http` wrapper). Build the `McpServer` + transport **per request** — the tools close over
  the request's `ctx` (conta_id/scopes), so per-request construction is required anyway and is
  naturally **stateless**, which is correct for scale-to-zero serverless.
- Imports (pin the version — the web-standard transport needs SDK ≥ 1.25):
  - `npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js` → `McpServer`
  - `npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js` → `WebStandardStreamableHTTPServerTransport`
  - `npm:@supabase/supabase-js@2`, `npm:zod`
- Reuses `buildCorsHeaders(req)`, `createJsonResponder`, `signGetUrl` (`_shared/r2.ts`),
  `insertAuditLog` (`_shared/audit.ts`), `resolveMcpKey`.
- Deployed with `--no-verify-jwt` (does its own auth, like hub/cron).
- Per request: read `Authorization: Bearer mesaas_sk_…` → `resolveMcpKey` → build a
  **service-role** client. Service role **bypasses RLS**, so each tool scopes to `ctx.conta_id`
  via the **per-table scope chains** below — there is no blanket rule. A `conta_id`/`client_id`/
  `account_id` is NEVER trusted from tool input; it is derived from the key or verified against
  the workspace first.
- **Audit (PR 1, not deferred):** every tool calls `insertAuditLog` with
  `{ conta_id, actor_user_id: ctx.created_by, action: 'mcp.<tool>', resource_type, resource_id,
  metadata: { key_id } }` — **no raw payload**. A remote key reading sensitive client/briefing
  data needs a trail now, even though the admin *viewer* is PR 3.

### Workspace scoping — per table (service role bypasses RLS)

Each tool MUST scope explicitly; tables do **not** all carry `conta_id`. Three scope chains:

| Table | Scope path |
|-------|-----------|
| `clientes`, `workflows`, `workflow_posts`, `leads` | **direct** `.eq('conta_id', ctx.conta_id)` |
| `ideias` | **direct**, but the column is `workspace_id` (= the conta_id value) |
| `hub_brand`, `briefings`, `hub_briefing_questions` | **direct** `conta_id` (confirm per migration) |
| `post_property_values` | **via** `post_id` → `workflow_posts.conta_id` (no own `conta_id`) |
| `instagram_posts` | **via** `instagram_account_id` → `instagram_accounts.client_id` → `clientes.conta_id` (no own `conta_id`) |

Implement small per-table scoping helpers (or nested-select filters), e.g.:
- `post_property_values`: `post_id in (select id from workflow_posts where conta_id = ctx)`.
- `instagram_posts` / `get_performance_baseline`: first verify the client belongs to the
  workspace (`select 1 from clientes where id = :client_id and conta_id = ctx`), resolve its
  `instagram_accounts.id`s, then query `instagram_posts` by those account ids.

Do **not** rely on a blanket `.eq('conta_id', …)` — on the chained tables it silently returns
nothing (or errors) and gives a false sense of safety.

### Two post surfaces (key design note)
- `workflow_posts` = production pipeline (draft → published), holds `conteudo` (ProseMirror
  JSON), `modo` + annotation (custom props), slide text. The agent's **output target**.
- `instagram_posts` = published reality **with metrics** (`reach, saved, shares, comments,
  likes`). The agent's **learning corpus**.
- They join **loosely** on `workflow_posts.instagram_media_id` → `instagram_posts` (no FK;
  fallback `permalink`). Overlap is partial — drafts have no metrics; posts published outside
  the workflow have metrics but no `modo`. Tools state this explicitly.

### Tools (all read-only, all `conta_id`-scoped)

| Tool | Scope | Returns |
|------|-------|---------|
| `list_clients` | `clientes:read` | clients (filter `status`) |
| `get_client` | `clientes:read` | **allowlisted** fields only: `id, nome, sigla, especialidade, cor, status`. Sensitive columns (`email, telefone, valor_mensal, data_pagamento, notion_page_url`) excluded by default — opt-in only if a use case needs them |
| `get_brand_profile(client_id)` | `clientes:read` | **assembled from existing tables** (see §4) |
| `list_posts` | `posts:read` | joined posts + metrics + tier; filters `period/modo/formato`, `sort_by_metric` |
| `get_post(post_id)` | `posts:read` | full single post (see shape below) |
| `get_performance_baseline(client_id)` | `posts:read` | medians per metric **and per format**, computed live from `instagram_posts` |
| `list_workflows` | `workflows:read` | workflows (filter by client) |
| `list_ideas` | `ideias:read` | pauta backlog (filter by client/status) |

**`get_post` / `list_posts` item shape:**
```jsonc
{
  "id", "titulo", "tipo", "ig_caption",        // hashtags live inside ig_caption (not structured)
  "modo": "autoridade",                         // normalized from post_property_values
  "anotacao": "...",                            // normalized from post_property_values
  "num_slides": 7,                              // derived from conteudo JSON (server-side walk)
  "slide_1_text": "...",                        // derived from conteudo JSON
  "media": [{ "url": "<signed 1h>", "thumbnail_url": "<signed>", "kind", "width", "height" }],
  "published": true,
  "metrics": { "reach", "saved", "shares", "comments", "likes" } | null,
  "performance_tier": "top_quartile" | "median" | "below" | null
}
```

Notes:
- **Media** is always **signed, 1h R2 URLs** via `signGetUrl` over `files` + `post_file_links`
  — never embedded. (Tables are `files`/`post_file_links`, not "post_media".)
- `num_slides` / `slide_1_text` derived by walking the ProseMirror `conteudo` JSON (same
  pattern as `hub-posts`' `extractR2Keys`).
- `performance_tier` computed on the fly by comparing the post's metric to
  `get_performance_baseline` for its client+format — not stored.

---

## 4. `get_brand_profile` — assembled from existing DB (middle-path decision)

No new schema in PR 1. Returns:
```jsonc
{
  "especialidade": "...",        // clientes.especialidade
  "cor": "#...",                 // clientes.cor
  "visual": {                    // hub_brand
    "logo_url", "primary_color", "secondary_color", "font_primary", "font_secondary"
  },
  "briefing": [                  // briefings + hub_briefing_questions
    { "section": "...", "question": "...", "answer": "..." }
  ]
}
```
Nuanced voice/hooks live in the agent's **Project knowledge base** for now. A structured
`client_brand_profile` (voice fields + **compliance flags** — which do NOT exist in schema
today) is deferred to **PR 3 / v2**. Until then compliance is enforced by the human approval
gate (agent is read-only in PR 1, draft-only in PR 3).

> Briefing answers can contain sensitive client info — `get_brand_profile` should return only
> marketing-relevant / `portal_visible` sections (a curated subset), not the raw briefing dump.

---

## 5. Seed `modo` + annotation custom properties

Reuse the existing custom-properties system (`template_property_definitions` /
`post_property_values`) — **zero migration to the posts schema**:
- `modo` → `type='select'`, `config.options = [storytelling, autoridade, objecao, pauta_quente]`
- `anotacao_qualitativa` → `type='text'` ("por que funcionou / por que não")

**Guarded auto-seed** (locked): on enablement, add both defs to each of the workspace's content
`workflow_templates`, but FIRST check `max_custom_properties_per_template` — **skip and log** any
template already at its cap, because `trg_limit_custom_props` is a `BEFORE INSERT` trigger that
will otherwise block the seed. The MCP normalizes these out of `post_property_values` so the
agent reads them as first-class `modo` / `anotacao` fields. (A CRM affordance for the team to
fill the annotation is PR 2 — it's the single best training signal.)

---

## 6. Security checklist

- [ ] `conta_id` always from resolved key, never from tool input
- [ ] Per-table scope chains used (no blanket `.eq('conta_id')`); `client_id`/`account_id` from
      input verified against the workspace before use
- [ ] `token_hash` protected by column-level grant (not just the RLS row policy)
- [ ] `max_mcp_keys` enforced by the `trg_limit_mcp_keys` INSERT trigger
- [ ] Every tool writes `insertAuditLog` (no raw payload)
- [ ] `get_client` returns allowlisted fields only; `get_brand_profile` returns a curated subset
- [ ] Service-role client; auth/authorization enforced in code (not RLS) inside the function
- [ ] `buildCorsHeaders(req)` — never wildcard `*`
- [ ] No raw error details returned to the client; generic messages, log internally
- [ ] `token_hash` never returned to any client; only `token_suffix` for display
- [ ] Scope check on every tool; reserved `:write` scopes unused in PR 1
- [ ] `feature_mcp` gate enforced in `resolveMcpKey`
- [ ] Deploy `--no-verify-jwt`

---

## 7. Tests & verification

- `npm run test:functions` (deno with the repo's required flags) — `resolveMcpKey`: valid /
  revoked / expired / feature-off; the `trg_limit_mcp_keys` cap; the `token_hash` column grant;
  `get_post` metrics-join with and without an `instagram_posts` match; `num_slides`/`slide_1`
  extraction from a sample `conteudo`; per-table scoping on `post_property_values` /
  `instagram_posts` (cross-workspace leakage returns nothing).
- `npm run build` — typecheck CRM + Hub unaffected (PR 1 has no app changes).
- Manual: create a key row via SQL, hit `/functions/v1/mcp` with `Authorization: Bearer …`,
  confirm tool list + a `list_clients` / `get_post` round-trip scoped to one workspace.
- Run `npm run test` + `npm run test:functions` per the repo's CI gates before pushing.

---

## 8. File checklist

**New**
- `supabase/migrations/<ts>_mcp_api_keys.sql`
- `supabase/migrations/<ts>_plans_feature_mcp.sql` (feature_mcp + max_mcp_keys)
- `supabase/functions/_shared/mcp-token.ts`
- `supabase/functions/mcp/index.ts` (Deno.serve + CORS + auth, per Appendix A)
- `supabase/functions/mcp/tools.ts` (`registerTools(server, { db, ctx })` — ctx-bound, testable)
- `supabase/functions/mcp/scoping.ts` (per-table scope helpers — see §3 scope chains)
- `supabase/functions/__tests__/mcp-token.test.ts`
- `supabase/functions/__tests__/mcp-tools.test.ts`

**Modified**
- `supabase/functions/_shared/entitlements.ts` (add `feature_mcp`, `max_mcp_keys`)
- seed migration or script for the two custom-property definitions

---

## 9. Decisions (locked 2026-06-22)

1. **Scope granularity** — per-domain scopes; keep the `:read`/`:write` split.
2. **`max_mcp_keys`** — **5 per workspace** (plan-column default; overridable per plan/override).
3. **`feature_mcp` default** — **on for the top-tier plan(s) only**, off elsewhere. Build step:
   `update plans set feature_mcp = true` on the highest plan (identify by price/tier in `plans`).
4. **Seed placement** — **guarded auto-seed** of `modo` + `anotacao_qualitativa` on the
   workspace's content `workflow_templates`, skipping (and logging) any template already at its
   `max_custom_properties_per_template` cap (the `trg_limit_custom_props` trigger blocks otherwise).
5. **`token_hash` protection** — **column-level grants** (revoke select; grant select on all
   columns except `token_hash`), as in the migration in §1a.
6. ~~**Transport spike**~~ — **RESOLVED**: `WebStandardStreamableHTTPServerTransport` (SDK ≥1.25),
   server+transport built per request, stateless. See Appendix A. Fallback: `mcp-lite@0.8.2`.

---

## Appendix A — Transport, pinned (resolved 2026-06-22)

Both official Supabase MCP guides confirm the approach. Use the SDK's **web-standard** transport;
build server + tools **per request** so each request is bound to its workspace `ctx` and is
stateless (no session store — correct for serverless scale-to-zero).

```ts
// supabase/functions/mcp/index.ts (skeleton)
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport }
  from "npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveMcpKey } from "../_shared/mcp-token.ts";
import { registerTools } from "./tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Authorization passes through because the fn is deployed --no-verify-jwt.
  const raw = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const ctx = await resolveMcpKey(db, raw, new Date().toISOString());
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // Per-request server: tools are bound to THIS key's workspace + scopes (stateless).
  const server = new McpServer({ name: "mesaas", version: "0.1.0" });
  registerTools(server, { db, ctx });

  const transport = new WebStandardStreamableHTTPServerTransport(); // no sessionId => stateless
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v); // merge CORS
  return res;
});
```

**Gotchas / notes:**
- **Accept header:** MCP Streamable HTTP requires the client to send
  `Accept: application/json, text/event-stream`. Claude clients do this automatically.
- **Path prefix:** Supabase routes all traffic for a function under its name, so the whole
  function *is* the MCP endpoint — users configure `https://<ref>.functions.supabase.co/mcp`
  (a.k.a. `/functions/v1/mcp`). Every POST goes straight to `handleRequest`; no internal
  sub-path router (no Hono) needed — matches the repo's other raw `Deno.serve` functions.
- **Auth layering:** both Supabase guides assume *no auth* + `--no-verify-jwt`; we layer the
  API-key check (`resolveMcpKey`) inside the handler, which is exactly what they recommend for
  production ("implement auth at the MCP server level").
- **If `res.headers` is immutable** in the runtime, reconstruct: `new Response(res.body, res)`
  then set CORS on the copy.
- **Fallback:** `mcp-lite@0.8.2` (zero-dep, web-standard, `transport.bind(mcp)` → `(Request)=>Response`,
  stateless by default) if SDK bundle/cold-start on Edge proves problematic. Same architecture.
