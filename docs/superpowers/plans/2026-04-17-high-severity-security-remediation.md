# High-Severity Security Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 15 HIGH-severity findings (VULN-010 through VULN-024) from the 2026-04-16 cybersecurity audit.

**Architecture:** Fixes span Deno edge functions (constant-time compare, input validation, MIME verification, auth standardization), a new SQL migration (audit_log delete policy), `vercel.json` (security headers), `deno.json` (pinned deps), and `package.json` (dep upgrades). Each task is independent and produces a self-contained commit.

**Tech Stack:** Deno edge functions (TypeScript), Supabase (Postgres/RLS), Vercel, npm

---

## File Map

| File | Task |
|------|------|
| `supabase/functions/_shared/crypto.ts` (create) | Task 1 |
| `supabase/functions/instagram-refresh-cron/index.ts` | Task 1 |
| `supabase/functions/instagram-sync-cron/index.ts` | Task 1 |
| `supabase/functions/post-media-cleanup-cron/index.ts` | Task 1 |
| `supabase/functions/analytics-report-cron/index.ts` | Task 1 |
| `supabase/functions/instagram-report-generator/index.ts` | Task 1, Task 3 |
| `supabase/functions/hub-pages/index.ts` | Task 2 |
| `supabase/functions/invite-user/index.ts` | Task 4 |
| `supabase/functions/post-media-finalize/index.ts` | Task 5 |
| `vercel.json` | Task 7 |
| `supabase/functions/instagram-integration/index.ts` | Task 8 |
| `supabase/functions/instagram-analytics/index.ts` | Task 9 |
| `supabase/functions/deno.json` | Task 10 |
| `package.json` | Task 6 |
| `supabase/migrations/20260417_audit_log_no_delete.sql` (create) | Task 12 |

---

### Task 1: Constant-Time Secret Comparison (VULN-010)

All 5 cron/internal-secret checks use JavaScript `!==` which is vulnerable to timing attacks. Create a shared constant-time compare utility and use it everywhere.

**Files:**
- Create: `supabase/functions/_shared/crypto.ts`
- Modify: `supabase/functions/instagram-refresh-cron/index.ts:63`
- Modify: `supabase/functions/instagram-sync-cron/index.ts:225`
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts:14`
- Modify: `supabase/functions/analytics-report-cron/index.ts:17`
- Modify: `supabase/functions/instagram-report-generator/index.ts:23`

- [ ] **Step 1: Create `_shared/crypto.ts` with constant-time compare**

Create `supabase/functions/_shared/crypto.ts`:

```typescript
/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses XOR accumulator so execution time is independent of where strings differ.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);

  if (aBuf.length !== bBuf.length) {
    // Compare against self to burn the same amount of time,
    // then return false.
    let _ = 0;
    for (let i = 0; i < aBuf.length; i++) {
      _ |= aBuf[i] ^ aBuf[i];
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}
```

- [ ] **Step 2: Update `instagram-refresh-cron/index.ts`**

Add import at line 1 (after existing import):

```typescript
import { timingSafeEqual } from "../_shared/crypto.ts";
```

Replace line 63:

```typescript
// Before:
if (req.headers.get('x-cron-secret') !== CRON_SECRET) {

// After:
if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
```

- [ ] **Step 3: Update `instagram-sync-cron/index.ts`**

Add import at the top:

```typescript
import { timingSafeEqual } from "../_shared/crypto.ts";
```

Replace line 225:

```typescript
// Before:
if (req.headers.get('x-cron-secret') !== CRON_SECRET) {

// After:
if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
```

- [ ] **Step 4: Update `post-media-cleanup-cron/index.ts`**

Add import at line 3 (after existing imports):

```typescript
import { timingSafeEqual } from "../_shared/crypto.ts";
```

Replace line 14:

```typescript
// Before:
if (req.headers.get('x-cron-secret') !== CRON_SECRET) {

// After:
if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
```

- [ ] **Step 5: Update `analytics-report-cron/index.ts`**

Add import at line 3 (after existing imports):

```typescript
import { timingSafeEqual } from "../_shared/crypto.ts";
```

Replace line 17:

```typescript
// Before:
if (req.headers.get('x-cron-secret') !== CRON_SECRET) {

// After:
if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
```

- [ ] **Step 6: Update `instagram-report-generator/index.ts`**

Add import at the top:

```typescript
import { timingSafeEqual } from "../_shared/crypto.ts";
```

Replace line 23:

```typescript
// Before:
if (internalToken !== INTERNAL_FUNCTION_SECRET) {

// After:
if (!timingSafeEqual(internalToken ?? '', INTERNAL_FUNCTION_SECRET)) {
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/crypto.ts supabase/functions/instagram-refresh-cron/index.ts supabase/functions/instagram-sync-cron/index.ts supabase/functions/post-media-cleanup-cron/index.ts supabase/functions/analytics-report-cron/index.ts supabase/functions/instagram-report-generator/index.ts
git commit -m "fix(security): use constant-time comparison for all cron/internal secrets (VULN-010)"
```

---

### Task 2: Add `conta_id` Filter to hub-pages (VULN-011)

`hub-pages/index.ts` filters by `cliente_id` but not `conta_id`. If `hub_pages` rows exist for the same `cliente_id` across workspaces, a token holder could access pages from another workspace.

**Files:**
- Modify: `supabase/functions/hub-pages/index.ts:33-39`

- [ ] **Step 1: Add `conta_id` filter to single-page query**

In `supabase/functions/hub-pages/index.ts`, replace lines 33-36:

```typescript
// Before:
if (pageId) {
    const { data: page } = await db.from("hub_pages").select("*").eq("id", pageId).eq("cliente_id", hubToken.cliente_id).maybeSingle();
    if (!page) return json({ error: "Página não encontrada." }, 404);
    return json({ page });
  }
```

With:

```typescript
if (pageId) {
    const { data: page } = await db.from("hub_pages").select("*").eq("id", pageId).eq("cliente_id", hubToken.cliente_id).eq("conta_id", hubToken.conta_id).maybeSingle();
    if (!page) return json({ error: "Página não encontrada." }, 404);
    return json({ page });
  }
```

- [ ] **Step 2: Add `conta_id` filter to page listing query**

Replace line 39:

```typescript
// Before:
const { data: pages } = await db.from("hub_pages").select("id, title, display_order, created_at").eq("cliente_id", hubToken.cliente_id).order("display_order");

// After:
const { data: pages } = await db.from("hub_pages").select("id, title, display_order, created_at").eq("cliente_id", hubToken.cliente_id).eq("conta_id", hubToken.conta_id).order("display_order");
```

**Note:** This assumes `hub_pages` has a `conta_id` column. If it does not, the query needs to join through `clientes` to verify workspace ownership. Check the table schema — if `conta_id` is missing, use a subquery:

```typescript
// Alternative if hub_pages has no conta_id column:
const { data: page } = await db.from("hub_pages").select("*, clientes!inner(conta_id)").eq("id", pageId).eq("cliente_id", hubToken.cliente_id).eq("clientes.conta_id", hubToken.conta_id).maybeSingle();
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hub-pages/index.ts
git commit -m "fix(security): add conta_id filter to hub-pages queries (VULN-011)"
```

---

### Task 3: Standardize Cron Auth on instagram-report-generator (VULN-012)

`instagram-report-generator` checks `X-Internal-Token` but not `x-cron-secret`, creating a cron auth parity gap. It should also accept `x-cron-secret` as a valid auth mechanism.

**Files:**
- Modify: `supabase/functions/instagram-report-generator/index.ts:7,21-28`

- [ ] **Step 1: Add CRON_SECRET env var and dual-auth check**

In `supabase/functions/instagram-report-generator/index.ts`, after line 7 (`INTERNAL_FUNCTION_SECRET`), add:

```typescript
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();
```

Replace lines 21-28 (the auth block):

```typescript
// Before:
  // Verify internal call token
  const internalToken = req.headers.get('X-Internal-Token');
  if (internalToken !== INTERNAL_FUNCTION_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

// After:
  // Verify internal call token OR cron secret
  const internalToken = req.headers.get('X-Internal-Token') ?? '';
  const cronSecret = req.headers.get('x-cron-secret') ?? '';
  if (!timingSafeEqual(internalToken, INTERNAL_FUNCTION_SECRET) && !timingSafeEqual(cronSecret, CRON_SECRET)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
```

This requires the `timingSafeEqual` import from Task 1. Ensure this import is present:

```typescript
import { timingSafeEqual } from "../_shared/crypto.ts";
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/instagram-report-generator/index.ts
git commit -m "fix(security): add x-cron-secret auth to instagram-report-generator (VULN-012)"
```

---

### Task 4: Re-validate Role in invite-user Re-invite Path (VULN-013)

The re-invite path (lines 148-155) inserts into `workspace_members` using the `role` from the request body without checking that the caller is authorized to assign that role. The initial invite path checks this at lines 86-88, but the re-invite path skips it.

**Files:**
- Modify: `supabase/functions/invite-user/index.ts:118-119`

- [ ] **Step 1: Add role escalation check before re-invite insert**

In `supabase/functions/invite-user/index.ts`, find the block at line 119 (`if (error.message?.includes('already been registered'))`). Add the role validation right after that line, before any database operations:

```typescript
      if (error.message?.includes('already been registered')) {
        // Re-validate role escalation for re-invite path (same check as initial invite)
        if (profile.role === 'admin' && role === 'owner') {
          throw new Error('Administradores não podem convidar novos donos.');
        }

        // Look up existing user by email (paginate to handle large user bases)
```

This duplicates the check from line 86 intentionally — the re-invite path is a separate code branch and must enforce the same constraint.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/invite-user/index.ts
git commit -m "fix(security): re-validate role escalation in invite-user re-invite path (VULN-013)"
```

---

### Task 5: Verify R2 Content-Type Matches Declared MIME (VULN-014)

`post-media-finalize` validates the declared `mime_type` from the request body against an allowlist but does not verify the actual R2 object's Content-Type matches. An attacker could upload an SVG (with embedded JavaScript) and declare it as `image/jpeg`.

**Files:**
- Modify: `supabase/functions/post-media-finalize/index.ts:57-60`

- [ ] **Step 1: Add Content-Type verification after R2 HEAD check**

In `supabase/functions/post-media-finalize/index.ts`, after line 60 (`if (head.contentLength !== body.size_bytes)`), add:

```typescript
  // Verify R2 object Content-Type matches the declared MIME type
  if (head.contentType && head.contentType !== body.mime_type) {
    return json({ error: "content-type mismatch" }, 400);
  }
```

This requires the `headObject` function in `_shared/r2.ts` to return `contentType`. Check the return type — if `headObject` currently only returns `contentLength`, it needs to also return `contentType`.

- [ ] **Step 2: Update `_shared/r2.ts` headObject to return contentType**

Read `supabase/functions/_shared/r2.ts` and find the `headObject` function. It likely does an HTTP HEAD request to R2. Ensure the return type includes `contentType`:

```typescript
// If headObject currently returns { contentLength: number }
// Update to return { contentLength: number; contentType: string | null }
```

In the HEAD response parsing, add:

```typescript
contentType: response.headers.get('content-type'),
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/post-media-finalize/index.ts supabase/functions/_shared/r2.ts
git commit -m "fix(security): verify R2 Content-Type matches declared MIME type (VULN-014)"
```

---

### Task 6: Upgrade Vulnerable Dependencies (VULN-015)

`shadcn@4.0.8` (devDep) pulls in `hono` with 6 known CVEs including path traversal and middleware bypass. `brace-expansion` has a known ReDoS vulnerability.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check current vulnerability status**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npm audit 2>&1 | head -60
```

- [ ] **Step 2: Upgrade shadcn and run audit fix**

```bash
npm install shadcn@latest --save-dev
npm audit fix
```

If `npm audit fix` does not resolve all issues, check which packages are still vulnerable:

```bash
npm audit 2>&1 | head -60
```

If hono CVEs persist because shadcn pins an old version, the fix is to upgrade shadcn to a version that uses a patched hono, or add an override in `package.json`:

```json
{
  "overrides": {
    "hono": ">=4.12.14"
  }
}
```

- [ ] **Step 3: Verify build still works**

```bash
npm run build && npm run build:hub
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(security): upgrade shadcn and patch vulnerable transitive deps (VULN-015)"
```

---

### Task 7: Add Security Headers to vercel.json (VULN-016)

No security headers are configured. Missing: CSP, X-Frame-Options, HSTS, Referrer-Policy, X-Content-Type-Options.

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add headers configuration**

Replace the entire `vercel.json` with:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-XSS-Protection", "value": "0" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ],
  "rewrites": [
    {
      "source": "/:workspace/hub/:token/(.*)",
      "destination": "/hub/index.html"
    },
    {
      "source": "/:workspace/hub/:token",
      "destination": "/hub/index.html"
    },
    {
      "source": "/((?!hub/|crm/|assets/)(?!.*\\.[a-zA-Z0-9]+$).*)",
      "destination": "/index.html"
    }
  ],
  "buildCommand": "npm run build && npm run build:hub",
  "outputDirectory": "dist"
}
```

**Notes:**
- `X-XSS-Protection: 0` is intentional — the header is deprecated and can introduce vulnerabilities in older browsers. Modern CSP is the replacement.
- CSP is excluded for now because it requires an audit of all inline scripts, external resources, and CDN usage. Adding a wrong CSP will break the app. It should be added as a separate, carefully tested task.
- HSTS `max-age=63072000` is 2 years with preload — only enable `preload` if you intend to submit to the HSTS preload list. Remove `preload` if not.

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "fix(security): add security headers to vercel.json (VULN-016)"
```

---

### Task 8: Regex-Validate Path Segments in instagram-integration (VULN-017)

Path segments are extracted via `path.split('/')[2]` without validation in the `/sync/`, `/disconnect/`, and `/auth/` routes. Only the `/callback` route validates with `/^\d+$/.test()`.

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts:174,464,652`

- [ ] **Step 1: Add clientId validation to `/auth/` route**

In `supabase/functions/instagram-integration/index.ts`, after line 174-175:

```typescript
// Current:
const clientId = path.split('/')[2];
if (!clientId) throw new Error("Client ID required");
```

Replace with:

```typescript
const clientId = path.split('/')[2];
if (!clientId || !/^\d+$/.test(clientId)) throw new Error("Client ID required");
```

- [ ] **Step 2: Add clientId validation to `/sync/` route**

After line 464:

```typescript
// Current:
const clientId = path.split('/')[2];

// Replace with:
const clientId = path.split('/')[2];
if (!clientId || !/^\d+$/.test(clientId)) {
    return new Response(JSON.stringify({ error: true, message: 'Invalid client ID' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
}
```

- [ ] **Step 3: Add clientId validation to `/disconnect/` route**

After line 652:

```typescript
// Current:
const clientId = path.split('/')[2];

// Replace with:
const clientId = path.split('/')[2];
if (!clientId || !/^\d+$/.test(clientId)) {
    return new Response(JSON.stringify({ error: true, message: 'Invalid client ID' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts
git commit -m "fix(security): regex-validate clientId path segments in instagram-integration (VULN-017)"
```

---

### Task 9: Bound `?days=` Query Parameter (VULN-018)

`instagram-analytics` parses `?days=` with `parseInt()` but no upper bound. A value like `?days=999999999` causes massive DB queries and potential DoS.

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts:229,483,555`

- [ ] **Step 1: Bound `days` in `/overview/` endpoint (line 229)**

Replace:

```typescript
const days = parseInt(url.searchParams.get('days') || '30') || 30;
```

With:

```typescript
const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30') || 30));
```

- [ ] **Step 2: Bound `days` in `/posts-analytics/` endpoint (line 483)**

Same replacement:

```typescript
// Before:
const days = parseInt(url.searchParams.get('days') || '30') || 30;

// After:
const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30') || 30));
```

- [ ] **Step 3: Bound `days` in `/follower-history/` endpoint (line 555)**

Same replacement:

```typescript
// Before:
const days = parseInt(url.searchParams.get('days') || '90') || 90;

// After:
const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '90') || 90));
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts
git commit -m "fix(security): bound days query param to [1, 365] in instagram-analytics (VULN-018)"
```

---

### Task 10: Pin Deno Dependencies (VULN-021, VULN-022)

`deno.json` uses `npm:@supabase/supabase-js@2` (floating) and `instagram-report-generator` uses `npm:jspdf@2` (floating). These should be pinned to exact versions.

**Files:**
- Modify: `supabase/functions/deno.json`
- Modify: `supabase/functions/instagram-report-generator/index.ts:2`

- [ ] **Step 1: Pin supabase-js in deno.json**

Replace `supabase/functions/deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.98.0"
  },
  "compilerOptions": {
    "lib": ["deno.ns", "deno.unstable", "dom"]
  }
}
```

Check the currently installed version first:

```bash
grep -r "supabase-js" /Users/eduardosouza/Projects/sm-crm/node_modules/@supabase/supabase-js/package.json 2>/dev/null | head -5
```

Use whatever version is currently resolved to avoid breaking changes.

- [ ] **Step 2: Pin jspdf in instagram-report-generator**

In `supabase/functions/instagram-report-generator/index.ts`, line 2:

```typescript
// Before:
import { jsPDF } from "npm:jspdf@2";

// After:
import { jsPDF } from "npm:jspdf@2.5.2";
```

Check the actual latest 2.x version:

```bash
npm view jspdf versions --json 2>/dev/null | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/deno.json supabase/functions/instagram-report-generator/index.ts
git commit -m "fix(security): pin floating Deno deps to exact versions (VULN-021, VULN-022)"
```

---

### Task 11: Add Per-IP Rate Limiting Note (VULN-020)

Rate limiting cannot be implemented in Deno edge functions alone — Supabase Edge Functions run on a shared Deno Deploy infrastructure without persistent state between invocations. Real rate limiting requires either:

1. **Vercel Edge Middleware** (for the CRM/Hub frontend)
2. **Supabase Database** rate-limit table with RPC
3. **External service** (e.g., Upstash Redis)

This task documents the architecture decision and implements a lightweight DB-backed rate limiter for the most critical endpoints.

**Files:**
- Create: `supabase/migrations/20260417_rate_limit.sql`
- Create: `supabase/functions/_shared/rate-limit.ts`

- [ ] **Step 1: Create rate-limit table and RPC**

Create `supabase/migrations/20260417_rate_limit.sql`:

```sql
-- Rate-limit tracking table
CREATE TABLE IF NOT EXISTS rate_limit_log (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rate_limit_key_created ON rate_limit_log (key, created_at);

-- Auto-cleanup: drop entries older than 1 hour
CREATE OR REPLACE FUNCTION cleanup_rate_limit_log()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM rate_limit_log WHERE created_at < now() - interval '1 hour';
$$;

-- Rate-limit check RPC: returns true if under the limit
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max_requests int,
  p_window_seconds int
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  request_count int;
BEGIN
  -- Count recent requests
  SELECT count(*) INTO request_count
  FROM rate_limit_log
  WHERE key = p_key
  AND created_at > now() - (p_window_seconds || ' seconds')::interval;

  IF request_count >= p_max_requests THEN
    RETURN false;
  END IF;

  -- Log this request
  INSERT INTO rate_limit_log (key) VALUES (p_key);
  RETURN true;
END;
$$;

ALTER TABLE rate_limit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON rate_limit_log FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Create shared rate-limit helper**

Create `supabase/functions/_shared/rate-limit.ts`:

```typescript
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Check rate limit using DB-backed counter.
 * Returns true if request is allowed, false if rate-limited.
 */
export async function checkRateLimit(
  db: SupabaseClient,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await db.rpc('check_rate_limit', {
    p_key: key,
    p_max_requests: maxRequests,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('[rate-limit] RPC error:', error.message);
    return true; // fail open to avoid blocking legitimate traffic
  }
  return data === true;
}

/**
 * Extract client IP from request headers (works behind Vercel/Cloudflare proxy).
 */
export function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417_rate_limit.sql supabase/functions/_shared/rate-limit.ts
git commit -m "feat(security): add DB-backed rate-limiting infrastructure (VULN-020)"
```

**Note:** Integrating `checkRateLimit()` into individual endpoints (hub-*, invite-user, login) should be done per-endpoint as a follow-up. This task provides the infrastructure.

---

### Task 12: Explicit FOR DELETE USING (false) on audit_log (VULN-024)

RLS is enabled on `audit_log` with INSERT and SELECT policies, but no explicit DELETE or UPDATE policy. While Postgres default-deny is secure, an explicit policy makes the intent clear and prevents accidental policy additions that could allow deletion.

**Files:**
- Create: `supabase/migrations/20260417_audit_log_no_delete.sql`

- [ ] **Step 1: Create migration**

Create `supabase/migrations/20260417_audit_log_no_delete.sql`:

```sql
-- Explicitly deny DELETE and UPDATE on audit_log for all roles.
-- Postgres RLS default-deny already prevents this, but explicit policies
-- make the intent clear and prevent accidental future policy additions.
DO $$ BEGIN
  DROP POLICY IF EXISTS "no_delete" ON audit_log;
  CREATE POLICY "no_delete" ON audit_log
    FOR DELETE USING (false);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "no_update" ON audit_log;
  CREATE POLICY "no_update" ON audit_log
    FOR UPDATE USING (false);
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260417_audit_log_no_delete.sql
git commit -m "fix(security): add explicit no-delete and no-update policies on audit_log (VULN-024)"
```

---

### Task 13: Pin npm Caret Ranges and Add Dependabot (VULN-023)

All 45 direct deps in `package.json` use `^` caret ranges. While not immediately dangerous, `npm update` can silently pull in broken or compromised minor versions. Add a Dependabot config for automated PR-based dep updates.

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create Dependabot configuration**

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
    groups:
      minor-and-patch:
        update-types:
          - "minor"
          - "patch"
```

- [ ] **Step 2: Commit**

```bash
mkdir -p .github && git add .github/dependabot.yml
git commit -m "chore(security): add Dependabot for automated dependency updates (VULN-023)"
```

---

### Task 14: Standardize ideias RLS to `get_my_conta_id()` (VULN-019)

This is listed as HIGH but is a defense-in-depth / performance concern. The `ideias` table RLS uses an inline `SELECT conta_id FROM membros WHERE user_id=auth.uid()` instead of the established `get_my_conta_id()` helper function. The inline subquery is fragile (depends on `membros` table) and slower.

**Files:**
- Create: `supabase/migrations/20260417_ideias_rls_standardize.sql`

- [ ] **Step 1: Check if `get_my_conta_id()` function exists**

```bash
grep -r "get_my_conta_id" /Users/eduardosouza/Projects/sm-crm/supabase/migrations/ | head -10
```

If it exists, proceed. If not, this task needs to create it first.

- [ ] **Step 2: Create migration to update ideias RLS**

Create `supabase/migrations/20260417_ideias_rls_standardize.sql`:

```sql
-- Standardize ideias RLS to use get_my_conta_id() instead of inline subquery.
-- First, drop existing policies and recreate with the helper function.

-- Check existing policies first:
-- SELECT policyname FROM pg_policies WHERE tablename = 'ideias';

DO $$ BEGIN
  -- Drop and recreate SELECT policy
  DROP POLICY IF EXISTS "ideias_select" ON ideias;
  CREATE POLICY "ideias_select" ON ideias
    FOR SELECT USING (conta_id = get_my_conta_id());

  -- Drop and recreate INSERT policy
  DROP POLICY IF EXISTS "ideias_insert" ON ideias;
  CREATE POLICY "ideias_insert" ON ideias
    FOR INSERT WITH CHECK (conta_id = get_my_conta_id());

  -- Drop and recreate UPDATE policy
  DROP POLICY IF EXISTS "ideias_update" ON ideias;
  CREATE POLICY "ideias_update" ON ideias
    FOR UPDATE USING (conta_id = get_my_conta_id());

  -- Drop and recreate DELETE policy
  DROP POLICY IF EXISTS "ideias_delete" ON ideias;
  CREATE POLICY "ideias_delete" ON ideias
    FOR DELETE USING (conta_id = get_my_conta_id());
END $$;
```

**Important:** Before running this migration, verify the exact policy names on the `ideias` table by querying `pg_policies`. The policy names above are examples — use the actual names from the database.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260417_ideias_rls_standardize.sql
git commit -m "fix(security): standardize ideias RLS to use get_my_conta_id() (VULN-019)"
```

---

## Verification

After all tasks are complete, run a full typecheck to verify nothing is broken:

```bash
npm run build && npm run build:hub
```

Then push the migrations to staging:

```bash
npx supabase db push --linked
```

Deploy affected edge functions:

```bash
npx supabase functions deploy instagram-refresh-cron --no-verify-jwt
npx supabase functions deploy instagram-sync-cron --no-verify-jwt
npx supabase functions deploy post-media-cleanup-cron --no-verify-jwt
npx supabase functions deploy analytics-report-cron --no-verify-jwt
npx supabase functions deploy instagram-report-generator --no-verify-jwt
npx supabase functions deploy hub-pages --no-verify-jwt
npx supabase functions deploy invite-user --no-verify-jwt
npx supabase functions deploy post-media-finalize --no-verify-jwt
npx supabase functions deploy instagram-integration --no-verify-jwt
npx supabase functions deploy instagram-analytics --no-verify-jwt
```
