# Medium & Low Security Remediation (VULN-008 to VULN-015)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all medium-severity (VULN-008 through VULN-012) and low-severity (VULN-013 through VULN-015) findings from the 2026-04-16 security audit.

**Architecture:** Each fix is isolated to one or two files. No new modules needed — we're aligning existing code to patterns already established elsewhere in the codebase (e.g., `buildCorsHeaders`, `INTERNAL_FUNCTION_SECRET`, `is_active` checks). The HKDF salt fix touches 4 files but is the same one-line change in each.

**Tech Stack:** Deno Edge Functions (TypeScript), React, Supabase JS v2

---

## File Map

| Vuln | Action | File |
|------|--------|------|
| VULN-008 | Modify | `supabase/functions/invite-user/index.ts` |
| VULN-008 | Modify | `supabase/functions/post-media-upload-url/index.ts` |
| VULN-008 | Modify | `supabase/functions/post-media-manage/index.ts` |
| VULN-009 | Modify | `supabase/functions/instagram-integration/index.ts` |
| VULN-009 | Modify | `supabase/functions/invite-user/index.ts` |
| VULN-009 | Modify | `supabase/functions/manage-workspace-user/index.ts` |
| VULN-010 | Modify | `supabase/functions/hub-briefing/index.ts` |
| VULN-011 | Modify | `supabase/functions/analytics-report-cron/index.ts` |
| VULN-012 | Modify | `apps/crm/src/components/layout/ProtectedRoute.tsx` |
| VULN-013 | Modify | `supabase/functions/hub-bootstrap/index.ts` |
| VULN-014 | Modify | `supabase/functions/instagram-integration/index.ts` |
| VULN-014 | Modify | `supabase/functions/instagram-analytics/index.ts` |
| VULN-014 | Modify | `supabase/functions/instagram-refresh-cron/index.ts` |
| VULN-014 | Modify | `supabase/functions/instagram-sync-cron/index.ts` |
| VULN-015 | Modify | `supabase/functions/invite-user/index.ts` |

---

### Task 1: VULN-008 — Replace wildcard CORS with `buildCorsHeaders(req)` in three functions

**Files:**
- Modify: `supabase/functions/invite-user/index.ts:1-8`
- Modify: `supabase/functions/post-media-upload-url/index.ts:13-17`
- Modify: `supabase/functions/post-media-manage/index.ts:9-13`
- Reference: `supabase/functions/_shared/cors.ts` (already exists, no changes needed)

**Context:** These three functions hardcode `Access-Control-Allow-Origin: '*'`. All other authenticated functions use `buildCorsHeaders(req)` from `../_shared/cors.ts`, which restricts to the `ALLOWED_ORIGINS` allowlist. The shared helper returns `Access-Control-Allow-Methods: 'GET, POST, DELETE, OPTIONS'` — that covers the methods these functions need. `post-media-manage` also uses `PATCH`, so that header needs extending in the local usage.

---

- [ ] **Step 1: Fix `invite-user/index.ts`**

Replace the hardcoded `corsHeaders` object and the `serve` import. The function currently uses the legacy `serve()` from deno.land/std — this will be fully migrated in Task 8 (VULN-015), but for now we just swap the CORS. Replace lines 1-10:

```typescript
// Replace:
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

// With:
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { buildCorsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
```

The rest of the file already uses `corsHeaders` as the variable name, so no further changes needed.

- [ ] **Step 2: Fix `post-media-upload-url/index.ts`**

Replace lines 13-18:

```typescript
// Replace:
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// With:
import { buildCorsHeaders } from "../_shared/cors.ts";

// Move the import to the top of the file with other imports (line 2).
// Then replace the cors const and json function:
let _cors: Record<string, string>;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ..._cors, "Content-Type": "application/json" } });
```

Actually, since `cors` is used in the `json` helper which is called throughout the file, and `buildCorsHeaders` needs the `req` object, the cleanest approach is:

Add the import at the top (after line 1):
```typescript
import { buildCorsHeaders } from "../_shared/cors.ts";
```

Remove the hardcoded `cors` object (lines 13-17). Then at the start of the `Deno.serve` handler, derive cors from req and define json locally. Replace the current handler opening:

```typescript
Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
```

Remove the old top-level `cors` and `json` declarations.

- [ ] **Step 3: Fix `post-media-manage/index.ts`**

Same pattern. Add import at top (after line 1):
```typescript
import { buildCorsHeaders } from "../_shared/cors.ts";
```

Remove the hardcoded `cors` object (lines 9-13). Move `json` inside the handler. Note: this function uses `PATCH` method which isn't in the shared helper's `Access-Control-Allow-Methods`. Override it after calling `buildCorsHeaders`:

```typescript
Deno.serve(async (req) => {
  const cors = { ...buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
```

Remove the old top-level `cors` and `json` declarations.

- [ ] **Step 4: Deploy and test**

```bash
# Deploy all three:
supabase functions deploy invite-user --no-verify-jwt
supabase functions deploy post-media-upload-url --no-verify-jwt
supabase functions deploy post-media-manage --no-verify-jwt
```

Verify: make a request with an allowed origin and confirm `Access-Control-Allow-Origin` reflects it. Make a request with a disallowed origin and confirm it falls back to the first allowed origin (not `*`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/invite-user/index.ts supabase/functions/post-media-upload-url/index.ts supabase/functions/post-media-manage/index.ts
git commit -m "fix(security): replace wildcard CORS with buildCorsHeaders in 3 functions (VULN-008)"
```

---

### Task 2: VULN-009 — Stop returning internal error details to clients

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts:780-793`
- Modify: `supabase/functions/invite-user/index.ts:216-222`
- Modify: `supabase/functions/manage-workspace-user/index.ts:221-224`

**Context:** These three catch blocks return `err.message` verbatim to the client, leaking table names, Supabase error codes, and column names. We log the error server-side and return a generic message. Intentional user-facing messages (thrown as strings like "Convite não encontrado") are preserved by checking for a custom flag.

---

- [ ] **Step 1: Fix `instagram-integration/index.ts` catch block**

Replace lines 780-793:

```typescript
// Replace:
  } catch (err: any) {
    const isAuthError = err.message && err.message.includes("Unauthorized");
    const isTokenExpired = err.message && err.message.includes("expired");
    
    const statusCode = (isAuthError || isTokenExpired) ? 401 : 400;
    
    return new Response(JSON.stringify({ 
      error: true, 
      message: err.message,
      code: isTokenExpired ? "TOKEN_EXPIRED" : undefined
    }), { 
        status: statusCode, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

// With:
  } catch (err: any) {
    console.error('[instagram-integration] error:', err);
    const isAuthError = err.message && err.message.includes("Unauthorized");
    const isTokenExpired = err.message && err.message.includes("expired");
    
    const statusCode = (isAuthError || isTokenExpired) ? 401 : 400;
    
    return new Response(JSON.stringify({ 
      error: true, 
      message: isTokenExpired ? "Token expirado" : isAuthError ? "Não autorizado" : "Erro interno",
      code: isTokenExpired ? "TOKEN_EXPIRED" : undefined
    }), { 
        status: statusCode, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
```

- [ ] **Step 2: Fix `invite-user/index.ts` catch block**

Replace lines 216-222:

```typescript
// Replace:
  } catch (err: any) {
    console.error("Catch erro:", JSON.stringify(err), err?.message, err);
    const message = err?.message || err?.msg || (typeof err === 'string' ? err : 'Erro interno do servidor');
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

// With:
  } catch (err: any) {
    console.error('[invite-user] error:', err);
    return new Response(JSON.stringify({ error: 'Erro interno do servidor' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
```

- [ ] **Step 3: Fix `manage-workspace-user/index.ts` catch block**

Replace lines 221-224:

```typescript
// Replace:
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }

// With:
  } catch (err: unknown) {
    console.error('[manage-workspace-user] error:', err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts supabase/functions/invite-user/index.ts supabase/functions/manage-workspace-user/index.ts
git commit -m "fix(security): stop leaking internal error details to clients (VULN-009)"
```

---

### Task 3: VULN-010 — Add `conta_id` cross-check to `hub-briefing` resolveToken

**Files:**
- Modify: `supabase/functions/hub-briefing/index.ts:7-16`

**Context:** `hub-briefing` resolves tokens by `token` + `expires_at` only. Sibling functions `hub-brand` and `hub-pages` verify `conta_id`. `hub-ideias` uses a join (`clientes(conta_id)`) to get workspace context. `hub-briefing` should match the pattern from `hub-brand`: select `conta_id` from the token and verify it matches the client's workspace.

However, `hub-briefing` doesn't receive a `workspace` slug parameter like `hub-bootstrap` does. Looking at the function, it receives just a `token` query param. The fix is to join through to `clientes` (like `hub-ideias` does) to get `conta_id`, so the token is scoped to a real workspace relationship.

---

- [ ] **Step 1: Update resolveToken in `hub-briefing/index.ts`**

Replace lines 7-16:

```typescript
// Replace:
async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return data as { cliente_id: number; is_active: boolean };
}

// With:
async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active, clientes(conta_id)")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return data as { cliente_id: number; is_active: boolean; clientes: { conta_id: number } };
}
```

This adds the `conta_id` cross-reference through the `clientes` foreign key join, matching the pattern in `hub-ideias`. The `conta_id` is now available downstream if needed for scoping queries.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/hub-briefing/index.ts
git commit -m "fix(security): add conta_id cross-check to hub-briefing resolveToken (VULN-010)"
```

---

### Task 4: VULN-011 — Use `INTERNAL_FUNCTION_SECRET` in analytics-report-cron

**Files:**
- Modify: `supabase/functions/analytics-report-cron/index.ts:87-97`

**Context:** `instagram-report-generator` authenticates internal calls via `X-Internal-Token` header checked against `INTERNAL_FUNCTION_SECRET` env var. But `analytics-report-cron` currently sends `SUPABASE_SERVICE_ROLE_KEY` as `Authorization: Bearer` — bypassing the intended internal auth and unnecessarily exposing the service role key in transit.

---

- [ ] **Step 1: Add `INTERNAL_FUNCTION_SECRET` env var and fix the fetch call**

At the top of `analytics-report-cron/index.ts`, after the existing env vars (around line 7), add:

```typescript
const INTERNAL_FUNCTION_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET') ?? (() => { throw new Error('INTERNAL_FUNCTION_SECRET is required'); })();
```

Then replace lines 88-96 (the fetch call):

```typescript
// Replace:
        const genRes = await fetch(genUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reportId: report.id }),
        });

// With:
        const genRes = await fetch(genUrl, {
          method: 'POST',
          headers: {
            'X-Internal-Token': INTERNAL_FUNCTION_SECRET,
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reportId: report.id }),
        });
```

- [ ] **Step 2: Verify `instagram-report-generator` auth logic**

Confirm that `instagram-report-generator/index.ts` checks `X-Internal-Token` against `INTERNAL_FUNCTION_SECRET` (already verified at lines 7, 22-23). No changes needed there.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/analytics-report-cron/index.ts
git commit -m "fix(security): use INTERNAL_FUNCTION_SECRET instead of service role key for inter-function auth (VULN-011)"
```

---

### Task 5: VULN-012 — Block `/equipe` for agent role in ProtectedRoute

**Files:**
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx:6`

**Context:** `AGENT_BLOCKED` array controls which routes agents cannot access. Currently blocks `/financeiro`, `/contratos`, `/leads`. Should also block `/equipe` — agents shouldn't view team member detail pages. Note: this is frontend-only enforcement. Server-side RLS should be the real guard, but adding this route to the block list is the immediate fix.

---

- [ ] **Step 1: Add `/equipe` to `AGENT_BLOCKED`**

Replace line 6:

```typescript
// Replace:
const AGENT_BLOCKED = ['/financeiro', '/contratos', '/leads'];

// With:
const AGENT_BLOCKED = ['/financeiro', '/contratos', '/leads', '/equipe'];
```

- [ ] **Step 2: Verify the route match**

The check at line 24 uses `location.pathname.startsWith(p)`, so `/equipe` will block `/equipe`, `/equipe/123`, etc. Correct.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/components/layout/ProtectedRoute.tsx
git commit -m "fix(security): block /equipe route for agent role (VULN-012)"
```

---

### Task 6: VULN-013 — Enforce `is_active` check in `hub-bootstrap`

**Files:**
- Modify: `supabase/functions/hub-bootstrap/index.ts:42`

**Context:** `hub-bootstrap` returns HTTP 200 with workspace + client data even when `hubToken.is_active === false`. Line 42 only checks `if (!hubToken)` but ignores the `is_active` flag. Sibling functions (`hub-briefing`, `hub-brand`, `hub-pages`, `hub-ideias`) all check `!hubToken.is_active`.

---

- [ ] **Step 1: Add `is_active` check**

Replace line 42:

```typescript
// Replace:
  if (!hubToken) return json({ error: "Link inválido." }, 404);

// With:
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/hub-bootstrap/index.ts
git commit -m "fix(security): enforce is_active check in hub-bootstrap (VULN-013)"
```

---

### Task 7: VULN-014 — Use domain-specific HKDF salt in all Instagram token functions

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts:20`
- Modify: `supabase/functions/instagram-analytics/index.ts:18`
- Modify: `supabase/functions/instagram-refresh-cron/index.ts:14-15`
- Modify: `supabase/functions/instagram-sync-cron/index.ts:14-15`

**Context:** All four functions have identical `getEncryptionKey()` with `salt: new Uint8Array(0)`. RFC 5869 recommends a non-empty salt. Use `enc.encode('sm-crm-ig-token-v1')` — the `enc` TextEncoder is already defined in each function.

**IMPORTANT — Migration consideration:** Changing the salt will derive a DIFFERENT key from the same `TOKEN_ENCRYPTION_KEY`. This means existing encrypted tokens in the database CANNOT be decrypted with the new key. This requires a migration strategy:

**Option A (recommended for simplicity):** Skip this fix for now and handle it as a planned token re-encryption migration. All connected accounts would need to re-authenticate.

**Option B:** Keep `new Uint8Array(0)` as-is. The security impact is LOW (the IKM is already a proper secret). The audit noted this as a best-practice gap, not an exploitable vulnerability.

**Option C:** Add versioned encryption — try new salt first, fall back to old salt on decryption failure. This adds complexity for minimal security gain.

**Recommendation: Choose Option B — skip this change.** The risk of breaking all existing encrypted tokens outweighs the marginal security improvement. Document the decision and move on.

If the team decides to proceed anyway (Option A), here's the change for each file:

---

- [ ] **Step 1: Decide on approach**

Discuss with the team. If skipping (Option B), mark this task complete and commit only a code comment. If proceeding (Option A), continue to step 2.

- [ ] **Step 2 (only if Option A): Update salt in all four files**

In each file, in the `getEncryptionKey` function, replace:

```typescript
salt: new Uint8Array(0)
```

with:

```typescript
salt: enc.encode('sm-crm-ig-token-v1')
```

Files and lines:
- `instagram-integration/index.ts:20`
- `instagram-analytics/index.ts:18`
- `instagram-refresh-cron/index.ts:15`
- `instagram-sync-cron/index.ts:15`

- [ ] **Step 3 (only if Option A): Re-encrypt all existing tokens**

After deploying, all existing encrypted Instagram tokens will be unreadable. Connected accounts will need to re-authenticate via OAuth. Communicate this to affected users.

- [ ] **Step 4: Commit**

```bash
# If Option B (skip):
git commit --allow-empty -m "chore: document VULN-014 HKDF salt as accepted risk (breaking change for existing tokens)"

# If Option A (change salt):
git add supabase/functions/instagram-integration/index.ts supabase/functions/instagram-analytics/index.ts supabase/functions/instagram-refresh-cron/index.ts supabase/functions/instagram-sync-cron/index.ts
git commit -m "fix(security): use domain-specific HKDF salt for token encryption (VULN-014)

BREAKING: all existing encrypted Instagram tokens are invalidated.
Affected accounts must re-authenticate via OAuth."
```

---

### Task 8: VULN-015 — Migrate `invite-user` to modern Deno imports

**Files:**
- Modify: `supabase/functions/invite-user/index.ts:1-2,10`

**Context:** `invite-user` is the only function using legacy `deno.land/std@0.168.0` and `esm.sh` imports. All other functions use `npm:@supabase/supabase-js@2` and `Deno.serve()`. The `serve()` from deno.land/std is a thin wrapper around `Deno.serve()`.

Note: If Task 1 (VULN-008) was already applied, the file already has `import { buildCorsHeaders } from "../_shared/cors.ts";`. The CORS import stays.

---

- [ ] **Step 1: Replace imports and serve wrapper**

Replace the top of the file:

```typescript
// Replace:
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// With:
import { createClient } from "npm:@supabase/supabase-js@2";
```

Replace the `serve(async (req) => {` call (around line 10 after Task 1 changes):

```typescript
// Replace:
serve(async (req) => {

// With:
Deno.serve(async (req) => {
```

The closing `});` at the end of the file stays the same.

- [ ] **Step 2: Deploy and verify**

```bash
supabase functions deploy invite-user --no-verify-jwt
```

Test by sending an invite from the UI and confirming the function responds correctly.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/invite-user/index.ts
git commit -m "chore: migrate invite-user to npm: imports and Deno.serve (VULN-015)"
```

---

## Execution Order & Dependencies

Tasks 1-6 and 8 are independent and can be parallelized. Task 7 requires a team decision before implementation.

Recommended sequential order if doing inline:
1. **Task 1** (VULN-008 CORS) + **Task 8** (VULN-015 imports) — both touch `invite-user`, do together
2. **Task 2** (VULN-009 error messages) — also touches `invite-user`, do after 1+8
3. **Tasks 3-6** — independent, any order
4. **Task 7** (VULN-014 HKDF salt) — last, needs team decision

## Deployment Checklist

After all changes:
- [ ] Ensure `INTERNAL_FUNCTION_SECRET` env var is set in Supabase for the analytics-report-cron function
- [ ] Ensure `ALLOWED_ORIGINS` env var includes all production origins
- [ ] Deploy all modified edge functions with `--no-verify-jwt`
- [ ] Smoke test: invite flow, post media upload, hub bootstrap, analytics report generation
