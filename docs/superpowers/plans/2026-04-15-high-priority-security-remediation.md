# High-Priority Security Remediation (VULN-005 to VULN-016) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all HIGH-severity security findings from the 2026-04-15 audit — 12 issues spanning CORS lockdown, rate-limiting/token expiry, IDOR workspace isolation, API secret header migration, cron auth, audit logging, dependency upgrades, and frontend hardening.

**Architecture:** Changes are spread across 8 edge functions, 1 frontend utility (`security.ts`), 1 frontend store (`store.ts`), 1 new SQL migration, and `package.json`. Each task is scoped to a single file or closely related file group; tasks are independent and can be committed separately.

**Tech Stack:** Deno/TypeScript edge functions, Supabase JS client v2, React + TypeScript frontend, Vite 6, PostgreSQL migrations (SQL).

---

## File Map

| File | Tasks |
|------|-------|
| All `supabase/functions/*/index.ts` with `corsHeaders` | Task 1 (VULN-005) |
| `supabase/functions/portal-data/index.ts` | Task 2 (VULN-006, VULN-017) |
| `supabase/functions/portal-approve/index.ts` | Task 2 (VULN-006, VULN-017) |
| `supabase/functions/hub-bootstrap/index.ts` | Task 2 (VULN-006, VULN-017) |
| `supabase/functions/hub-posts/index.ts` | Task 3 (VULN-008) |
| `supabase/functions/hub-brand/index.ts` | Task 3 (VULN-008) |
| `supabase/functions/hub-pages/index.ts` | Task 3 (VULN-008) |
| `supabase/functions/instagram-integration/index.ts` | Task 4 (VULN-007) |
| `supabase/functions/manage-workspace-user/index.ts` | Task 5 (VULN-015) |
| `supabase/functions/post-media-cleanup-cron/index.ts` | Task 6 (VULN-012) |
| `supabase/functions/analytics-report-cron/index.ts` | Task 6 (VULN-012) |
| `supabase/functions/post-media-finalize/index.ts` | Task 7 (VULN-018) |
| `supabase/functions/instagram-analytics/index.ts` | Task 8 (VULN-023) |
| `supabase/functions/manage-workspace-user/index.ts`, `portal-approve/index.ts`, `instagram-integration/index.ts` | Task 9 (VULN-013) |
| New migration `supabase/migrations/20260415_audit_log.sql` | Task 9 (VULN-013) |
| `package.json` | Task 10 (VULN-014, VULN-016) |
| `apps/crm/src/utils/security.ts` | Task 11 (VULN-021) |
| `apps/crm/src/store.ts` | Task 12 (VULN-022) |

---

## Task 1: Replace Wildcard CORS with Origin Allowlist (VULN-005)

**Files:**
- Modify: `supabase/functions/portal-data/index.ts`
- Modify: `supabase/functions/portal-approve/index.ts`
- Modify: `supabase/functions/hub-bootstrap/index.ts`
- Modify: `supabase/functions/hub-posts/index.ts`
- Modify: `supabase/functions/hub-brand/index.ts`
- Modify: `supabase/functions/hub-pages/index.ts`
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts`
- Modify: `supabase/functions/analytics-report-cron/index.ts`
- Modify: `supabase/functions/post-media-finalize/index.ts`
- Modify: `supabase/functions/manage-workspace-user/index.ts`
- Modify: `supabase/functions/instagram-analytics/index.ts`
- Modify: `supabase/functions/instagram-report-generator/index.ts`
- Create: `supabase/functions/_shared/cors.ts`

**Context:** Every edge function currently has `'Access-Control-Allow-Origin': '*'`. Combined with disabled JWT (already fixed), any page a logged-in user visits can silently call authenticated endpoints. The fix is to centralize CORS logic in a shared helper that reads `ALLOWED_ORIGINS` env var and echoes back only the matched origin.

- [ ] **Step 1: Create shared CORS helper**

Create `supabase/functions/_shared/cors.ts`:

```typescript
/**
 * Returns CORS headers that only echo back the request origin when it is in the
 * ALLOWED_ORIGINS allowlist. Falls back to the first allowed origin for non-browser
 * requests (no Origin header).
 *
 * Set env var: ALLOWED_ORIGINS=https://app.yourdomain.com,https://hub.yourdomain.com
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const requestOrigin = req.headers.get('origin') || '';
  const corsOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };
}
```

- [ ] **Step 2: Update `portal-data/index.ts`**

Replace the static `corsHeaders` object at the top of the file and add `req` parameter to the `buildCorsHeaders` call. The function signature `Deno.serve(async (req) =>` already receives `req`.

Find this block near the top:
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
```

Replace with:
```typescript
import { buildCorsHeaders } from "../_shared/cors.ts";
```

Then inside `Deno.serve(async (req) => {`, replace every occurrence of `corsHeaders` with `buildCorsHeaders(req)`. In `portal-data/index.ts` the `json` helper is:
```typescript
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```
Because `json` is defined outside `Deno.serve`, pass cors headers as a parameter or move `json` inside. The cleanest fix is to move the `json` helper inside the handler and capture `buildCorsHeaders(req)` once per request:

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  // ... rest of handler unchanged
```

- [ ] **Step 3: Update `portal-approve/index.ts`**

Same pattern as Step 2. The file has a top-level `corsHeaders` and `json` helper. Move both inside the handler:

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// completeEtapa stays as-is (no CORS dependency)
async function completeEtapa(db: any, workflowId: number, etapaId: number) { /* ... */ }

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // ... rest unchanged
```

- [ ] **Step 4: Update `hub-bootstrap/index.ts`**

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  // ... rest unchanged
```

- [ ] **Step 5: Update `hub-posts/index.ts`, `hub-brand/index.ts`, `hub-pages/index.ts`**

Same pattern for all three. Remove the static `cors` object at the top, add the import, and capture `buildCorsHeaders(req)` inside the handler. Each of these functions uses `json` as a top-level helper — move it inside the handler closure.

For `hub-posts/index.ts`:
```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  // ... rest unchanged
```

For `hub-brand/index.ts`:
```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  // ... rest unchanged
```

For `hub-pages/index.ts`:
```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  // ... rest unchanged
```

- [ ] **Step 6: Update remaining functions**

`post-media-cleanup-cron/index.ts` — this cron accepts any HTTP request (Deno.serve signature is `async ()`). Change to `async (req: Request)` and apply the pattern:
```typescript
import { buildCorsHeaders } from "../_shared/cors.ts";
// ...
Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  // ... rest unchanged
```

`analytics-report-cron/index.ts` — it has no CORS headers at all currently. Add the import and set headers on all responses:
```typescript
import { buildCorsHeaders } from "../_shared/cors.ts";
// ...
Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  // ... wrap all `return new Response(...)` calls to use `json()`
```

`post-media-finalize/index.ts` — replace the top-level `cors` object:
```typescript
import { buildCorsHeaders } from "../_shared/cors.ts";
// remove: const cors = { "Access-Control-Allow-Origin": "*", ... };
// inside handler, add:
Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  // ...
```

`manage-workspace-user/index.ts` — this file has inline header objects instead of a `cors` variable. Replace the static CORS header values in `headers` objects inside the handler. The simplest approach: add `import { buildCorsHeaders } from "../_shared/cors.ts";`, then at the start of the handler add `const cors = buildCorsHeaders(req);`, and replace all occurrences of:
```typescript
"Access-Control-Allow-Origin": "*",
```
with `...cors,` spreading into the headers object. Also update the OPTIONS response.

`instagram-analytics/index.ts` — has an inline `corsHeaders` object defined inside the handler. Replace its definition:
```typescript
// Remove:
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};
// Replace with:
const corsHeaders = buildCorsHeaders(req);
```
Add import at top: `import { buildCorsHeaders } from "../_shared/cors.ts";`

`instagram-report-generator/index.ts` — same as analytics: replace the inline `corsHeaders` object with `buildCorsHeaders(req)`.

- [ ] **Step 7: Add `ALLOWED_ORIGINS` to Supabase secrets**

```
supabase secrets set ALLOWED_ORIGINS="https://app.yourdomain.com,https://hub.yourdomain.com"
```
(Replace with actual production domains. For local dev, the default `http://localhost:5173,http://localhost:5174` in the helper handles it.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/cors.ts \
  supabase/functions/portal-data/index.ts \
  supabase/functions/portal-approve/index.ts \
  supabase/functions/hub-bootstrap/index.ts \
  supabase/functions/hub-posts/index.ts \
  supabase/functions/hub-brand/index.ts \
  supabase/functions/hub-pages/index.ts \
  supabase/functions/post-media-cleanup-cron/index.ts \
  supabase/functions/analytics-report-cron/index.ts \
  supabase/functions/post-media-finalize/index.ts \
  supabase/functions/manage-workspace-user/index.ts \
  supabase/functions/instagram-analytics/index.ts \
  supabase/functions/instagram-report-generator/index.ts
git commit -m "security: replace wildcard CORS with origin allowlist (VULN-005)"
```

---

## Task 2: Token Expiry Enforcement on Portal and Hub Token Endpoints (VULN-006, VULN-017)

**Files:**
- Modify: `supabase/functions/portal-data/index.ts`
- Modify: `supabase/functions/portal-approve/index.ts`
- Modify: `supabase/functions/hub-bootstrap/index.ts`

**Context:** Portal tokens and hub tokens are validated but never checked for expiry. Any token, no matter how old, remains valid forever. Fix: add `expires_at > now()` to every token validation query. Also `portal_tokens` and `client_hub_tokens` must have an `expires_at` column — add it via migration if it doesn't exist.

- [ ] **Step 1: Check if `expires_at` column exists on the token tables**

```bash
grep -r "expires_at" supabase/migrations/
```

If no migration creates it, create one now (Step 2). If it exists, skip to Step 3.

- [ ] **Step 2: Create migration to add `expires_at` columns**

Create `supabase/migrations/20260415_token_expiry.sql`:

```sql
-- Add expires_at to portal_tokens (default: 90 days from creation for existing rows)
ALTER TABLE portal_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE portal_tokens
  SET expires_at = created_at + interval '90 days'
  WHERE expires_at IS NULL;

ALTER TABLE portal_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days'),
  ALTER COLUMN expires_at SET NOT NULL;

-- Add expires_at to client_hub_tokens (default: never — set to year 2100 for existing rows)
ALTER TABLE client_hub_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE client_hub_tokens
  SET expires_at = '2100-01-01'::timestamptz
  WHERE expires_at IS NULL;

ALTER TABLE client_hub_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '365 days'),
  ALTER COLUMN expires_at SET NOT NULL;
```

- [ ] **Step 3: Update `portal-data/index.ts` — add expiry check**

Find the token validation query (around line 39–43):
```typescript
const { data: tokenRow, error: tokenErr } = await db
  .from("portal_tokens")
  .select("workflow_id")
  .eq("token", token)
  .maybeSingle();
```

Replace with:
```typescript
const { data: tokenRow, error: tokenErr } = await db
  .from("portal_tokens")
  .select("workflow_id")
  .eq("token", token)
  .gt("expires_at", new Date().toISOString())
  .maybeSingle();
```

- [ ] **Step 4: Update `portal-approve/index.ts` — add expiry check**

Find the token validation query (around line 78–83):
```typescript
const { data: tokenRow, error: tokenErr } = await db
  .from("portal_tokens")
  .select("workflow_id")
  .eq("token", token)
  .maybeSingle();
```

Replace with:
```typescript
const { data: tokenRow, error: tokenErr } = await db
  .from("portal_tokens")
  .select("workflow_id")
  .eq("token", token)
  .gt("expires_at", new Date().toISOString())
  .maybeSingle();
```

- [ ] **Step 5: Update `hub-bootstrap/index.ts` — add expiry check**

Find the hub token query (around line 42–47):
```typescript
const { data: hubToken } = await db
  .from("client_hub_tokens")
  .select("cliente_id, is_active")
  .eq("token", token)
  .eq("conta_id", conta.id)
  .maybeSingle();
```

Replace with:
```typescript
const { data: hubToken } = await db
  .from("client_hub_tokens")
  .select("cliente_id, is_active")
  .eq("token", token)
  .eq("conta_id", conta.id)
  .gt("expires_at", new Date().toISOString())
  .maybeSingle();
```

Also update `hub-posts/index.ts` `resolveToken` function (around line 20–26):
```typescript
async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data;
}
```

And `hub-brand/index.ts` (around line 23):
```typescript
const { data: hubToken } = await db
  .from("client_hub_tokens")
  .select("cliente_id, is_active")
  .eq("token", token)
  .gt("expires_at", new Date().toISOString())
  .maybeSingle();
```

And `hub-pages/index.ts` (around line 26):
```typescript
const { data: hubToken } = await db
  .from("client_hub_tokens")
  .select("cliente_id, is_active")
  .eq("token", token)
  .gt("expires_at", new Date().toISOString())
  .maybeSingle();
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260415_token_expiry.sql \
  supabase/functions/portal-data/index.ts \
  supabase/functions/portal-approve/index.ts \
  supabase/functions/hub-bootstrap/index.ts \
  supabase/functions/hub-posts/index.ts \
  supabase/functions/hub-brand/index.ts \
  supabase/functions/hub-pages/index.ts
git commit -m "security: enforce token expiry on portal and hub endpoints (VULN-006, VULN-017)"
```

---

## Task 3: Hub IDOR — Add `conta_id` Filter to All Hub Workflow Queries (VULN-008)

**Files:**
- Modify: `supabase/functions/hub-posts/index.ts`
- Modify: `supabase/functions/hub-brand/index.ts`
- Modify: `supabase/functions/hub-pages/index.ts`

**Context:** Hub functions look up data by `cliente_id` derived from the hub token but never verify the `conta_id`. A token from workspace A could, if `cliente_id` values collide across workspaces, expose data from workspace B. Fix: the token validation already returns `cliente_id`; fetch `conta_id` from the same token row and include it in downstream queries.

- [ ] **Step 1: Update `hub-posts/index.ts` — include `conta_id` in token + workflow queries**

The `resolveToken` function currently returns `{ cliente_id, is_active }`. Extend it to also return `conta_id`:

```typescript
async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, conta_id, is_active")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data;
}
```

Then add `conta_id` filter to the workflows query (around line 41–45):
```typescript
// Before:
const { data: workflows } = await db
  .from("workflows")
  .select("id")
  .eq("cliente_id", hubToken.cliente_id);

// After:
const { data: workflows } = await db
  .from("workflows")
  .select("id")
  .eq("cliente_id", hubToken.cliente_id)
  .eq("conta_id", hubToken.conta_id);
```

- [ ] **Step 2: Update `hub-brand/index.ts` — scope brand queries to `conta_id`**

The `client_hub_tokens` query already exists; extend it to also return `conta_id`:
```typescript
const { data: hubToken } = await db
  .from("client_hub_tokens")
  .select("cliente_id, conta_id, is_active")
  .eq("token", token)
  .gt("expires_at", new Date().toISOString())
  .maybeSingle();
```

Then scope the brand queries:
```typescript
const { data: brand } = await db
  .from("hub_brand")
  .select("*")
  .eq("cliente_id", hubToken.cliente_id)
  .eq("conta_id", hubToken.conta_id)
  .maybeSingle();

const { data: files } = await db
  .from("hub_brand_files")
  .select("*")
  .eq("cliente_id", hubToken.cliente_id)
  .eq("conta_id", hubToken.conta_id)
  .order("display_order");
```

Note: if `hub_brand` and `hub_brand_files` don't have a `conta_id` column yet, remove those `.eq("conta_id", ...)` calls but still confirm the token's `conta_id` by checking the `clientes` table:
```typescript
// After validating hubToken, verify client belongs to this workspace:
const { data: clientCheck } = await db
  .from("clientes")
  .select("id")
  .eq("id", hubToken.cliente_id)
  .eq("conta_id", hubToken.conta_id)
  .maybeSingle();
if (!clientCheck) return json({ error: "Link inválido." }, 404);
```
Use the `clientes` approach for all three hub files as the safe fallback.

- [ ] **Step 3: Update `hub-pages/index.ts` — scope pages to `conta_id`**

Extend the token query to return `conta_id`:
```typescript
const { data: hubToken } = await db
  .from("client_hub_tokens")
  .select("cliente_id, conta_id, is_active")
  .eq("token", token)
  .gt("expires_at", new Date().toISOString())
  .maybeSingle();
```

Add the client ownership verification (same pattern as Step 2):
```typescript
const { data: clientCheck } = await db
  .from("clientes")
  .select("id")
  .eq("id", hubToken.cliente_id)
  .eq("conta_id", hubToken.conta_id)
  .maybeSingle();
if (!clientCheck) return json({ error: "Link inválido." }, 404);
```

The `hub_pages` query already scopes by `cliente_id`:
```typescript
const { data: pages } = await db
  .from("hub_pages")
  .select("id, title, display_order, created_at")
  .eq("cliente_id", hubToken.cliente_id)
  .order("display_order");
```
This is safe once client ownership is verified via `clientes`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-posts/index.ts \
  supabase/functions/hub-brand/index.ts \
  supabase/functions/hub-pages/index.ts
git commit -m "security: add conta_id workspace isolation to hub endpoints (VULN-008)"
```

---

## Task 4: Instagram IDOR — Add Workspace Ownership Check (VULN-007)

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts`

**Context:** Routes `/sync/:clientId`, `/disconnect/:clientId`, `/summary/:clientId`, `/posts/:clientId` validate the caller's JWT but never verify the `clientId` belongs to the caller's workspace. An authenticated user from workspace A can operate on workspace B's clients.

- [ ] **Step 1: Read the relevant section of the file**

Read `supabase/functions/instagram-integration/index.ts` lines 1–50 to find where `clientId` is extracted from the path and where the auth check happens, and lines around the `/sync`, `/disconnect`, `/summary`, `/posts` route branches.

- [ ] **Step 2: Add ownership verification helper**

Find the section where `clientId` is extracted from the URL path (typically in the route handlers). Add a workspace ownership check immediately after extracting `clientId`, before any data is returned. This pattern should be applied to every route branch that takes a `clientId` path parameter.

The check to add (after user auth is confirmed and `serviceClient` is available):
```typescript
// Verify clientId belongs to caller's workspace
async function verifyClientOwnership(
  svc: ReturnType<typeof createClient>,
  clientId: string,
  contaId: string
): Promise<boolean> {
  const { data: client } = await svc
    .from('clientes')
    .select('conta_id')
    .eq('id', parseInt(clientId, 10))
    .single();
  return client?.conta_id === contaId;
}
```

Add this function near the top of the file (outside `Deno.serve`).

- [ ] **Step 3: Call ownership check in each authenticated route**

For every route branch that reads `clientId` from the URL path (sync, disconnect, summary, posts), add immediately after the `contaId` is known:

```typescript
if (!await verifyClientOwnership(serviceClient, clientId, contaId)) {
  return json({ error: "Unauthorized" }, 403);
}
```

The `contaId` is obtained earlier in the handler from the user profile. Use it here.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts
git commit -m "security: add workspace ownership check to Instagram routes (VULN-007)"
```

---

## Task 5: Cross-Workspace `accept-invite` IDOR (VULN-015)

**Files:**
- Modify: `supabase/functions/manage-workspace-user/index.ts`

**Context:** The `accept-invite` action (line 60–75) updates all pending invites matching the given email without scoping to the caller's `conta_id`. An owner/admin from workspace A can accept invites belonging to workspace B.

- [ ] **Step 1: Add `conta_id` filter to the accept-invite update query**

Find this block in `manage-workspace-user/index.ts` (around line 65–70):
```typescript
const { error: acceptError } = await serviceClient
  .from("invites")
  .update({ status: "accepted", accepted_at: new Date().toISOString() })
  .eq("email", email.toLowerCase())
  .eq("status", "pending");
```

Replace with:
```typescript
const { error: acceptError } = await serviceClient
  .from("invites")
  .update({ status: "accepted", accepted_at: new Date().toISOString() })
  .eq("email", email.toLowerCase())
  .eq("status", "pending")
  .eq("conta_id", callerProfile.conta_id);
```

`callerProfile.conta_id` is already available at this point in the handler (fetched at line 42–46).

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/manage-workspace-user/index.ts
git commit -m "security: scope accept-invite to caller's workspace (VULN-015)"
```

---

## Task 6: Cron Functions — Add `X-Cron-Secret` Authentication (VULN-012)

**Files:**
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts`
- Modify: `supabase/functions/analytics-report-cron/index.ts`

**Context:** Both cron functions respond to any HTTP request without verifying it came from the Supabase scheduler. Anyone with the function URL can trigger media deletions or report generation.

- [ ] **Step 1: Set `CRON_SECRET` in Supabase secrets**

```bash
# Generate a random secret and set it
supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
```

Note: copy this value — you will also need to set it as the `x-cron-secret` header in Supabase's cron job configuration (via `pg_cron` SQL or Supabase Dashboard → Cron).

- [ ] **Step 2: Add secret check to `post-media-cleanup-cron/index.ts`**

Add a `CRON_SECRET` constant and validation at the top of the handler (after the Task 1 CORS change adds `req` parameter):

```typescript
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();
```

Then at the start of `Deno.serve(async (req: Request) => {`, before any logic:
```typescript
Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // ... rest unchanged
```

- [ ] **Step 3: Add secret check to `analytics-report-cron/index.ts`**

Add `CRON_SECRET` constant:
```typescript
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();
```

Then in the handler:
```typescript
Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // ... rest unchanged
```

- [ ] **Step 4: Update cron schedule SQL to include the secret header**

If the cron is scheduled via `pg_cron` with `net.http_post`, update the migration or a new migration to pass the header:

Create `supabase/migrations/20260415_cron_secret_header.sql`:
```sql
-- Re-schedule cleanup cron with authentication header
SELECT cron.unschedule('post-media-cleanup');
SELECT cron.schedule(
  'post-media-cleanup',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/post-media-cleanup-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Re-schedule analytics report cron with authentication header
SELECT cron.unschedule('analytics-report-cron-monthly');
SELECT cron.schedule(
  'analytics-report-cron-monthly',
  '0 6 1 * *',
  $$
  SELECT net.http_post(
    url := vault.decrypted_secret('project_url') || '/functions/v1/analytics-report-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', vault.decrypted_secret('cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

Add `cron_secret` to vault before running this migration:
```bash
supabase secrets set CRON_SECRET_VAULT="<same value as CRON_SECRET above>"
# Then in SQL console: SELECT vault.create_secret('<value>', 'cron_secret');
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/post-media-cleanup-cron/index.ts \
  supabase/functions/analytics-report-cron/index.ts \
  supabase/migrations/20260415_cron_secret_header.sql
git commit -m "security: add X-Cron-Secret authentication to cron functions (VULN-012)"
```

---

## Task 7: Validate Upload MIME Type at Finalization Step (VULN-018)

**Files:**
- Modify: `supabase/functions/post-media-finalize/index.ts`

**Context:** The function validates MIME type at presigned URL generation but not at finalization. A caller can request a presigned URL for `image/jpeg`, upload an SVG with embedded scripts, then finalize. At finalization we have access to the R2 object's `Content-Type` via `headObject`; we should verify it matches the declared type.

- [ ] **Step 1: Add MIME type validation after `headObject` call**

The file already calls `headObject(body.r2_key)` (around line 52–54). After confirming the object exists, add:

```typescript
const head = await headObject(body.r2_key);
if (!head) return json({ error: "object not found" }, 400);
if (head.contentLength !== body.size_bytes) return json({ error: "size mismatch" }, 400);

// Verify the actual Content-Type stored in R2 matches what was declared
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
];
if (head.contentType && !ALLOWED_MIME_TYPES.includes(head.contentType.split(';')[0].trim())) {
  return json({ error: "unsupported file type" }, 415);
}
if (head.contentType && !head.contentType.startsWith(body.mime_type.split('/')[0])) {
  return json({ error: "content type mismatch" }, 400);
}
```

Note: this requires `headObject` to return `contentType`. Read `supabase/functions/_shared/r2.ts` to check if `headObject` already returns `contentType`. If it doesn't, you may need to extend it or skip the contentType check and rely solely on the allowlist check against `body.mime_type`.

If `headObject` does not return `contentType`, add an allowlist check on `body.mime_type` alone:
```typescript
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
];
if (!ALLOWED_MIME_TYPES.includes(body.mime_type)) {
  return json({ error: "unsupported file type" }, 415);
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/post-media-finalize/index.ts
git commit -m "security: validate MIME type allowlist at media finalization (VULN-018)"
```

---

## Task 8: Validate `sortDir` Query Parameter in Instagram Analytics (VULN-023)

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts`

**Context:** The `/posts-analytics/:clientId` route validates `sortBy` against a whitelist but does not validate `sortDir`. An unvalidated sort direction is passed directly into sort logic.

- [ ] **Step 1: Add `sortDir` whitelist validation**

Find this block (around line 459–460):
```typescript
const sortBy = url.searchParams.get('sort') || 'posted_at';
const sortDir = url.searchParams.get('dir') || 'desc';
```

Replace with:
```typescript
const sortBy = url.searchParams.get('sort') || 'posted_at';
const rawDir = url.searchParams.get('dir') || 'desc';
const sortDir = ['asc', 'desc'].includes(rawDir) ? rawDir : 'desc';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts
git commit -m "security: whitelist-validate sortDir parameter in instagram-analytics (VULN-023)"
```

---

## Task 9: Add Audit Logging for Critical Operations (VULN-013)

**Files:**
- Create: `supabase/migrations/20260415_audit_log.sql`
- Modify: `supabase/functions/manage-workspace-user/index.ts`
- Modify: `supabase/functions/portal-approve/index.ts`
- Modify: `supabase/functions/instagram-integration/index.ts`

**Context:** Role changes, user removals, invite acceptance, Instagram account linkage, and portal approvals are not logged. Add an `audit_log` table and insert a record after each sensitive operation.

- [ ] **Step 1: Create `audit_log` migration**

Create `supabase/migrations/20260415_audit_log.sql`:

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  conta_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb
);

-- Only service role can insert; no one can update or delete
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert" ON audit_log
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "owner_admin_select" ON audit_log
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM profiles
      WHERE conta_id = audit_log.conta_id
      AND role IN ('owner', 'admin')
    )
  );

CREATE INDEX idx_audit_log_conta_id ON audit_log (conta_id);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_user_id);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at);
```

- [ ] **Step 2: Add audit helper function**

Add a shared helper for audit logging. Add to `supabase/functions/_shared/audit.ts`:

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";

export async function insertAuditLog(
  svc: ReturnType<typeof createClient>,
  entry: {
    conta_id?: string;
    actor_user_id?: string;
    action: string;
    resource_type: string;
    resource_id?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await svc.from('audit_log').insert(entry);
  } catch (e) {
    // Audit log failure must never break the primary operation
    console.error('[audit] Failed to write audit log:', e);
  }
}
```

- [ ] **Step 3: Instrument `manage-workspace-user/index.ts`**

Add the import at the top:
```typescript
import { insertAuditLog } from "../_shared/audit.ts";
```

After a successful `update-role` operation (after line 160, inside the `if (action === "update-role")` block):
```typescript
await insertAuditLog(serviceClient, {
  conta_id: callerProfile.conta_id,
  actor_user_id: user.id,
  action: 'update-role',
  resource_type: 'workspace_member',
  resource_id: targetUserId,
  metadata: { new_role: role, workspace_id: callerProfile.conta_id },
});
```

After a successful `remove` operation (after line 190):
```typescript
await insertAuditLog(serviceClient, {
  conta_id: callerProfile.conta_id,
  actor_user_id: user.id,
  action: 'remove-user',
  resource_type: 'workspace_member',
  resource_id: targetUserId,
  metadata: { workspace_id: callerProfile.conta_id },
});
```

After a successful `accept-invite` (after line 72):
```typescript
await insertAuditLog(serviceClient, {
  conta_id: callerProfile.conta_id,
  actor_user_id: user.id,
  action: 'accept-invite',
  resource_type: 'invite',
  metadata: { email: (body as any).email },
});
```

- [ ] **Step 4: Instrument `portal-approve/index.ts`**

Add the import:
```typescript
import { insertAuditLog } from "../_shared/audit.ts";
```

After the `post_approvals` insert (around line 115, per-post approval path):
```typescript
await insertAuditLog(db, {
  action: `portal-${action}`,
  resource_type: 'workflow_post',
  resource_id: String(post_id),
  metadata: { workflow_id: workflowId, token_hash: token.slice(0, 8) },
});
```

After the `portal_approvals` insert (around line 194, per-etapa path):
```typescript
await insertAuditLog(db, {
  action: `portal-etapa-${action}`,
  resource_type: 'workflow_etapa',
  resource_id: String(etapa_id),
  metadata: { workflow_id: workflowId, token_hash: token.slice(0, 8) },
});
```

- [ ] **Step 5: Instrument `instagram-integration/index.ts` — OAuth callback**

Find the OAuth callback handler where the Instagram account is linked (the section that upserts `instagram_accounts`). Add after the successful upsert:
```typescript
import { insertAuditLog } from "../_shared/audit.ts";
// ...
await insertAuditLog(serviceClient, {
  actor_user_id: userId,
  action: 'instagram-link',
  resource_type: 'instagram_account',
  resource_id: String(clientId),
  metadata: { ig_username: igUsername },
});
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260415_audit_log.sql \
  supabase/functions/_shared/audit.ts \
  supabase/functions/manage-workspace-user/index.ts \
  supabase/functions/portal-approve/index.ts \
  supabase/functions/instagram-integration/index.ts
git commit -m "security: add audit_log table and instrument critical operations (VULN-013)"
```

---

## Task 10: Upgrade Vulnerable Dependencies (VULN-014, VULN-016)

**Files:**
- Modify: `package.json` (via `npm install` / `npm update`)

**Context:**
- VULN-014: Vite 6.4.1 has an arbitrary file read via dev server WebSocket. Fix: upgrade to `vite@^6.5.0`.
- VULN-016: `path-to-regexp` 8.0.0–8.3.0 and `picomatch` 2.0.0–2.3.1 have ReDoS vulnerabilities. Fix: `npm update path-to-regexp picomatch`.

- [ ] **Step 1: Upgrade Vite**

```bash
npm install vite@^6.5.0
```

Expected output: `package.json` devDependencies shows `"vite": "^6.5.x"` and `package-lock.json` is updated.

- [ ] **Step 2: Update ReDoS-vulnerable transitive dependencies**

```bash
npm update path-to-regexp picomatch
```

- [ ] **Step 3: Verify the build still works**

```bash
npm run build
```

Expected: exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "security: upgrade Vite to 6.5+ and update path-to-regexp/picomatch (VULN-014, VULN-016)"
```

---

## Task 11: Fix `sanitizeUrl()` — Replace Blocklist with URL Scheme Allowlist (VULN-021)

**Files:**
- Modify: `apps/crm/src/utils/security.ts`

**Context:** Current implementation blocks only `javascript:` and `data:` but allows `vbscript:`, `file://`, and protocol-relative (`//evil.com`) URLs. Replace with a strict allowlist: only `http:` and `https:` pass.

- [ ] **Step 1: Rewrite `sanitizeUrl` with allowlist**

Replace the entire contents of `apps/crm/src/utils/security.ts`:

```typescript
/**
 * Sanitize a URL to prevent URI injection attacks.
 * Only allows http: and https: schemes. Returns '#' for anything else.
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return '#';
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url.trim();
    }
    return '#';
  } catch {
    // URL constructor throws for relative paths like "/foo" and "//evil.com"
    // Relative paths starting with / or . are safe to pass through
    const trimmed = url.trim();
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
    if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed;
    if (trimmed.startsWith('#')) return trimmed;
    return '#';
  }
}
```

- [ ] **Step 2: Verify no existing callers rely on non-http/https URLs being passed through**

```bash
grep -r "sanitizeUrl" apps/crm/src/ --include="*.ts" --include="*.tsx"
```

Review each call site to confirm none intentionally passes `vbscript:`, `file://`, or protocol-relative URLs.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/utils/security.ts
git commit -m "security: replace sanitizeUrl blocklist with https/http allowlist (VULN-021)"
```

---

## Task 12: Fix `initStoreRole()` — Default to `agent` on Error (VULN-022)

**Files:**
- Modify: `apps/crm/src/store.ts`

**Context:** `initStoreRole()` starts with `currentUserRole = 'owner'` as the module-level default. If `getCurrentProfile()` fails (network error, missing row), the `catch` silently swallows the error and leaves the role as `'owner'`. Any agent would then appear to have owner permissions in the frontend cache. Fix: default to `'agent'` (least privilege) on error.

- [ ] **Step 1: Change the default role and error fallback**

In `apps/crm/src/store.ts`, line 73:
```typescript
// Before:
export let currentUserRole: 'owner' | 'admin' | 'agent' = 'owner';
```
Replace with:
```typescript
export let currentUserRole: 'owner' | 'admin' | 'agent' = 'agent';
```

Then fix the `initStoreRole` catch block (lines 75–82):
```typescript
// Before:
export async function initStoreRole() {
  try {
    const profile = await getCurrentProfile();
    if (profile) {
      currentUserRole = profile.role || 'owner';
    }
  } catch(e) {}
}

// After:
export async function initStoreRole() {
  try {
    const profile = await getCurrentProfile();
    if (profile) {
      currentUserRole = profile.role || 'agent';
    } else {
      currentUserRole = 'agent';
    }
  } catch (e) {
    console.error('[store] initStoreRole failed, defaulting to agent:', e);
    currentUserRole = 'agent';
  }
}
```

- [ ] **Step 2: Verify no code path assumes `currentUserRole` starts as `'owner'`**

```bash
grep -n "currentUserRole" apps/crm/src/store.ts apps/crm/src/App.tsx apps/crm/src/components 2>/dev/null | head -40
```

Review usages to confirm the `'agent'` default does not break any feature that legitimately requires the role to be initialized before the profile fetch resolves. The app should call `initStoreRole()` on startup and await it before rendering protected routes. Confirm `App.tsx` does this.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/store.ts
git commit -m "security: default initStoreRole to agent on error (least-privilege) (VULN-022)"
```

---

## Deployment Checklist

After all tasks are committed:

- [ ] Set env vars: `supabase secrets set ALLOWED_ORIGINS="..." CRON_SECRET="..."`
- [ ] Deploy all modified edge functions: `supabase functions deploy`
- [ ] Run new migrations: `supabase db push` (or apply via Supabase Dashboard)
- [ ] Verify portal flow: load a portal link, confirm approval works
- [ ] Verify hub flow: load a hub link, confirm posts/brand/pages load
- [ ] Verify Instagram OAuth flow: connect an Instagram account
- [ ] Verify cron authentication: manually POST to a cron function without the header (expect 401), then with the header (expect 200)
- [ ] Run `npm run build` — confirm 0 errors with new Vite version
