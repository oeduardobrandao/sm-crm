# Critical Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 critical security vulnerabilities identified in the 2026-04-15 security audit: disabled JWT verification, hardcoded credentials in SQL migration, weak AES-GCM key derivation, unsigned OAuth state, Gemini API key in URL params, and service role key in inter-function headers.

**Architecture:** Each fix is isolated to specific files with no shared state between tasks. The HKDF key derivation change (Task 3) uses a dual-scheme decoder so old and new tokens coexist during rollout — no maintenance window required. A re-encryption script migrates existing tokens after deployment.

**Tech Stack:** Deno edge functions (TypeScript), Supabase (pg_cron, pg_net, Vault), Web Crypto API (HKDF, AES-GCM, HMAC-SHA256)

---

> ⚠️ **MANUAL PREREQUISITES — do these before running any tasks:**
>
> 1. **Rotate the Supabase anon key:** Supabase Console → Settings → API → Regenerate anon key. Copy the new key.
> 2. **Set Supabase secrets** (replace values with real ones):
>    ```bash
>    supabase secrets set SUPABASE_ANON_KEY=<new-rotated-anon-key>
>    supabase secrets set INTERNAL_FUNCTION_SECRET=$(uuidgen | tr '[:upper:]' '[:lower:]')
>    ```
>    Save the value of `INTERNAL_FUNCTION_SECRET` — you'll need it in Task 6.

---

## File Map

| File | Task | Action |
|------|------|--------|
| `supabase/config.toml` | 1 | Remove 7 `verify_jwt = false` lines |
| `supabase/migrations/20260415_rotate_anon_key_vault.sql` | 2 | New migration — reschedule cron via vault |
| `supabase/functions/instagram-integration/index.ts` | 3, 4 | HKDF + signed OAuth state |
| `supabase/functions/instagram-analytics/index.ts` | 3, 5, 6 | HKDF + Gemini header + X-Internal-Token |
| `supabase/functions/instagram-sync-cron/index.ts` | 3 | HKDF |
| `supabase/functions/instagram-refresh-cron/index.ts` | 3 | HKDF |
| `supabase/functions/instagram-report-generator/index.ts` | 6 | Add X-Internal-Token verification |
| `scripts/reencrypt-tokens.ts` | 7 | New: one-time re-encryption script |

---

## Task 1: Re-enable JWT Verification (VULN-001)

**Files:**
- Modify: `supabase/config.toml`

- [ ] **Step 1: Remove all `verify_jwt = false` lines**

The entire file currently is just those 14 lines. Replace it with an empty file (Supabase defaults `verify_jwt` to `true` when the key is absent):

```toml
```

That is: the file should be completely empty after this change. All 7 `[functions.*]` blocks with `verify_jwt = false` are removed.

- [ ] **Step 2: Verify the change**

```bash
cat supabase/config.toml
```

Expected: empty output (no content).

- [ ] **Step 3: Commit**

```bash
git add supabase/config.toml
git commit -m "security: re-enable JWT verification on all edge functions (VULN-001)"
```

---

## Task 2: Replace Hardcoded Cron Credentials with Vault References (VULN-002)

**Files:**
- Create: `supabase/migrations/20260415_rotate_anon_key_vault.sql`

> ⚠️ This task requires the anon key rotation from the manual prerequisites to be complete first.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260415_rotate_anon_key_vault.sql` with this exact content:

```sql
-- Reschedule instagram-sync cron to read credentials from Vault.
-- The old migration (20260324) hardcoded plaintext credentials; this replaces it.
-- Prerequisite: vault secrets 'project_url' and 'anon_key' must exist
-- (created by the original migration). After rotating the anon key, update
-- the vault secret by running:
--   SELECT vault.update_secret('anon_key', '<new-rotated-key>');
-- in the Supabase SQL editor.

select cron.unschedule('instagram-sync-cron-daily');

select cron.schedule(
  'instagram-sync-cron-daily',
  '0 6 * * *',
  $$
  select
    net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/instagram-sync-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
      ),
      body := concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);
```

- [ ] **Step 2: Update the vault secret with the rotated key**

In the Supabase SQL editor (Dashboard → SQL Editor), run:

```sql
SELECT vault.update_secret('anon_key', '<paste-your-new-rotated-anon-key-here>');
```

This updates the in-database vault secret without putting the key in any tracked file.

- [ ] **Step 3: Push the migration**

```bash
npx supabase db push --linked
```

Expected output: migration applied successfully, no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260415_rotate_anon_key_vault.sql
git commit -m "security: replace hardcoded cron credentials with vault references (VULN-002)"
```

---

## Task 3: Replace Weak Key Derivation with HKDF (VULN-003)

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts`
- Modify: `supabase/functions/instagram-analytics/index.ts`
- Modify: `supabase/functions/instagram-sync-cron/index.ts`
- Modify: `supabase/functions/instagram-refresh-cron/index.ts`

> The dual-scheme decoder tries HKDF first; falls back to old `padEnd` scheme if HKDF decryption fails (authentication tag mismatch). This allows both old and new encrypted tokens to coexist until the re-encryption script (Task 7) is run.

**The HKDF helper function** (identical in all 4 files):

```typescript
async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(TOKEN_ENCRYPTION_KEY), { name: 'HKDF' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}
```

**The legacy key helper** (for fallback decryption — identical in all files that have `decryptToken`):

```typescript
async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    usage
  );
}
```

- [ ] **Step 1: Update `supabase/functions/instagram-integration/index.ts`**

Replace lines 11–59 (the existing `encryptToken` and `decryptToken` functions) with:

```typescript
// --- Token Encryption Utility ---
async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(TOKEN_ENCRYPTION_KEY), { name: 'HKDF' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    usage
  );
}

async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey('instagram-access-token', ['encrypt']);
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  const encryptedArray = new Uint8Array(encryptedBuf);
  const combined = new Uint8Array(iv.length + encryptedArray.length);
  combined.set(iv);
  combined.set(encryptedArray, iv.length);
  return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

async function decryptToken(encryptedBase64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  // Try HKDF-derived key first (new scheme)
  try {
    const key = await getEncryptionKey('instagram-access-token', ['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    // Fall back to legacy padEnd key (old scheme — tokens not yet re-encrypted)
    const legacyKey = await getLegacyKey(['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, data);
    return new TextDecoder().decode(decryptedBuf);
  }
}
```

- [ ] **Step 2: Update `supabase/functions/instagram-analytics/index.ts`**

Replace lines 9–19 (the existing `decryptToken` function) with:

```typescript
// --- Token Decryption ---
async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(TOKEN_ENCRYPTION_KEY), { name: 'HKDF' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    usage
  );
}

async function decryptToken(encryptedBase64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  try {
    const key = await getEncryptionKey('instagram-access-token', ['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    const legacyKey = await getLegacyKey(['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, data);
    return new TextDecoder().decode(decryptedBuf);
  }
}
```

- [ ] **Step 3: Update `supabase/functions/instagram-sync-cron/index.ts`**

Replace lines 7–29 (the existing `decryptToken` function) with:

```typescript
// --- Token Decryption Utility ---
async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(TOKEN_ENCRYPTION_KEY), { name: 'HKDF' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    usage
  );
}

async function decryptToken(encryptedBase64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  try {
    const key = await getEncryptionKey('instagram-access-token', ['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    const legacyKey = await getLegacyKey(['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, data);
    return new TextDecoder().decode(decryptedBuf);
  }
}
```

- [ ] **Step 4: Update `supabase/functions/instagram-refresh-cron/index.ts`**

Replace lines 7–54 (the existing `encryptToken` and `decryptToken` functions) with:

```typescript
// --- Token Encryption Utility ---
async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(TOKEN_ENCRYPTION_KEY), { name: 'HKDF' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    usage
  );
}

async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey('instagram-access-token', ['encrypt']);
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  const encryptedArray = new Uint8Array(encryptedBuf);
  const combined = new Uint8Array(iv.length + encryptedArray.length);
  combined.set(iv);
  combined.set(encryptedArray, iv.length);
  return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

async function decryptToken(encryptedBase64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  try {
    const key = await getEncryptionKey('instagram-access-token', ['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    const legacyKey = await getLegacyKey(['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, data);
    return new TextDecoder().decode(decryptedBuf);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts \
        supabase/functions/instagram-analytics/index.ts \
        supabase/functions/instagram-sync-cron/index.ts \
        supabase/functions/instagram-refresh-cron/index.ts
git commit -m "security: replace padEnd key derivation with HKDF + dual-scheme fallback decoder (VULN-003)"
```

---

## Task 4: Sign OAuth State with HMAC-SHA256 (VULN-004)

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts`

- [ ] **Step 1: Add HMAC state helpers after the `decryptToken` function**

After the closing `}` of the `decryptToken` function (around line 60 after Task 3's changes), add:

```typescript
// --- Signed OAuth State ---
async function getHmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(TOKEN_ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createSignedState(clientId: string): Promise<string> {
  const payload = JSON.stringify({ clientId, nonce: crypto.randomUUID(), iat: Date.now() });
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return btoa(payload) + '.' + sig;
}

async function verifySignedState(state: string): Promise<{ clientId: string }> {
  const dotIdx = state.indexOf('.');
  if (dotIdx === -1) throw new Error('Invalid state format');
  const payloadB64 = state.slice(0, dotIdx);
  const sigB64 = state.slice(dotIdx + 1);
  const payload = atob(payloadB64);
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
  if (!valid) throw new Error('State signature invalid');
  const parsed = JSON.parse(payload);
  if (Date.now() - parsed.iat > 10 * 60 * 1000) throw new Error('State expired');
  return { clientId: parsed.clientId };
}
```

- [ ] **Step 2: Update the `/auth/:clientId` route to use `createSignedState`**

Find this block in the handler (around line 111–118 after prior changes):

```typescript
        // Pass clientId in state
        const state = btoa(JSON.stringify({ clientId }));
```

Replace it with:

```typescript
        // Pass clientId in signed state (HMAC-SHA256)
        const state = await createSignedState(clientId);
```

- [ ] **Step 3: Update the `/callback` handler to use `verifySignedState`**

Find this block in the callback handler (around line 128–130 after prior changes):

```typescript
        const decodedState = JSON.parse(atob(state || ''));
        const clientId = decodedState.clientId;
        if (!clientId || !/^\d+$/.test(String(clientId))) throw new Error("Invalid client ID in state parameter");
```

Replace it with:

```typescript
        const { clientId } = await verifySignedState(state || '');
        if (!clientId || !/^\d+$/.test(String(clientId))) throw new Error("Invalid client ID in state parameter");
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts
git commit -m "security: sign OAuth state parameter with HMAC-SHA256 to prevent CSRF/account-linkage takeover (VULN-004)"
```

---

## Task 5: Move Gemini API Key to Header (VULN-009)

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts`

- [ ] **Step 1: Fix the first Gemini fetch call (around line 968)**

Find:

```typescript
      const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
```

Replace with:

```typescript
      const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
```

- [ ] **Step 2: Fix the second Gemini fetch call (around line 1129)**

Find:

```typescript
      const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
```

Replace with:

```typescript
      const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
```

- [ ] **Step 3: Verify no `?key=` remains**

```bash
grep -n "key=\${GEMINI" supabase/functions/instagram-analytics/index.ts
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts
git commit -m "security: move Gemini API key from URL query param to x-goog-api-key header (VULN-009)"
```

---

## Task 6: Replace Service Role Key in Inter-Function Header (VULN-010)

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts`
- Modify: `supabase/functions/instagram-report-generator/index.ts`

> Requires `INTERNAL_FUNCTION_SECRET` to be set in Supabase secrets (from manual prerequisites).

- [ ] **Step 1: Add `INTERNAL_FUNCTION_SECRET` env var read in `instagram-analytics/index.ts`**

At the top of the file, after the existing env var declarations (after `const GEMINI_API_KEY = ...`), add:

```typescript
const INTERNAL_FUNCTION_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET') ?? (() => { throw new Error('INTERNAL_FUNCTION_SECRET is required'); })();
```

- [ ] **Step 2: Update the inter-function fetch call (around line 810)**

Find:

```typescript
      const genRes = await fetch(reportGenUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
```

Replace with:

```typescript
      const genRes = await fetch(reportGenUrl, {
        method: 'POST',
        headers: {
          'X-Internal-Token': INTERNAL_FUNCTION_SECRET,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
```

- [ ] **Step 3: Add `INTERNAL_FUNCTION_SECRET` verification to `instagram-report-generator/index.ts`**

At the top of the file, after the existing const declarations (after `const SUPABASE_ANON_KEY = ...`), add:

```typescript
const INTERNAL_FUNCTION_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET') ?? (() => { throw new Error('INTERNAL_FUNCTION_SECRET is required'); })();
```

Then, in the `Deno.serve` handler, after the `OPTIONS` check (after line 21 `if (req.method === 'OPTIONS') ...`), add:

```typescript
  // Verify internal call token
  const internalToken = req.headers.get('X-Internal-Token');
  if (internalToken !== INTERNAL_FUNCTION_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
```

- [ ] **Step 4: Verify no `SERVICE_ROLE_KEY` appears in the inter-function call**

```bash
grep -n "SERVICE_ROLE_KEY" supabase/functions/instagram-analytics/index.ts | grep -i "authorization\|Bearer\|genRes\|reportGen"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts \
        supabase/functions/instagram-report-generator/index.ts
git commit -m "security: replace service role key in inter-function header with X-Internal-Token (VULN-010)"
```

---

## Task 7: Write and Run the Token Re-encryption Script

**Files:**
- Create: `scripts/reencrypt-tokens.ts`

> Run this after deploying the edge functions (Task 3 must be deployed to prod first).

- [ ] **Step 1: Create `scripts/reencrypt-tokens.ts`**

```typescript
/**
 * One-time re-encryption script: migrates instagram_accounts tokens
 * from the old padEnd(32,'0') AES-GCM key to the new HKDF-derived key.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TOKEN_ENCRYPTION_KEY=... \
 *     deno run --allow-env --allow-net scripts/reencrypt-tokens.ts
 *
 * Dry run (no writes):
 *   DRY_RUN=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TOKEN_ENCRYPTION_KEY=... \
 *     deno run --allow-env --allow-net scripts/reencrypt-tokens.ts
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? (() => { throw new Error("SUPABASE_URL required"); })();
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY required"); })();
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY required"); })();
const DRY_RUN = Deno.env.get("DRY_RUN") === "true";

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Old scheme: padEnd ---
async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    usage
  );
}

// --- New scheme: HKDF ---
async function getHkdfKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(TOKEN_ENCRYPTION_KEY), { name: "HKDF" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("instagram-access-token") },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
}

async function decryptLegacy(encryptedBase64: string): Promise<string> {
  const key = await getLegacyKey(["decrypt"]);
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decryptedBuf);
}

async function encryptHkdf(plaintext: string): Promise<string> {
  const key = await getHkdfKey(["encrypt"]);
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const encryptedArray = new Uint8Array(encryptedBuf);
  const combined = new Uint8Array(iv.length + encryptedArray.length);
  combined.set(iv);
  combined.set(encryptedArray, iv.length);
  return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

async function tryDecryptHkdf(encryptedBase64: string): Promise<string | null> {
  try {
    const key = await getHkdfKey(["decrypt"]);
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    return null; // Not yet encrypted with HKDF
  }
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no writes will occur" : "LIVE RUN — tokens will be re-encrypted");

  const { data: accounts, error } = await db
    .from("instagram_accounts")
    .select("id, encrypted_access_token")
    .not("encrypted_access_token", "is", null);

  if (error) {
    console.error("Failed to fetch accounts:", error.message);
    Deno.exit(1);
  }

  console.log(`Found ${accounts?.length ?? 0} accounts with tokens`);

  let skipped = 0;
  let reencrypted = 0;
  let failed = 0;

  for (const account of accounts ?? []) {
    // Check if already HKDF-encrypted
    const alreadyHkdf = await tryDecryptHkdf(account.encrypted_access_token);
    if (alreadyHkdf !== null) {
      console.log(`[SKIP] account ${account.id} — already HKDF-encrypted`);
      skipped++;
      continue;
    }

    // Decrypt with old scheme
    let plaintext: string;
    try {
      plaintext = await decryptLegacy(account.encrypted_access_token);
    } catch (e: any) {
      console.error(`[FAIL] account ${account.id} — failed to decrypt with legacy key: ${e.message}`);
      failed++;
      continue;
    }

    // Re-encrypt with HKDF
    let newEncrypted: string;
    try {
      newEncrypted = await encryptHkdf(plaintext);
    } catch (e: any) {
      console.error(`[FAIL] account ${account.id} — failed to encrypt with HKDF: ${e.message}`);
      failed++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`[DRY] account ${account.id} — would re-encrypt`);
      reencrypted++;
      continue;
    }

    const { error: updateError } = await db
      .from("instagram_accounts")
      .update({ encrypted_access_token: newEncrypted })
      .eq("id", account.id);

    if (updateError) {
      console.error(`[FAIL] account ${account.id} — update failed: ${updateError.message}`);
      failed++;
    } else {
      console.log(`[OK] account ${account.id} — re-encrypted`);
      reencrypted++;
    }
  }

  console.log(`\nDone. re-encrypted=${reencrypted} skipped=${skipped} failed=${failed}`);
  if (failed > 0) Deno.exit(1);
}

await main();
```

- [ ] **Step 2: Dry-run the script against production to verify row count**

```bash
DRY_RUN=true \
SUPABASE_URL=<your-supabase-url> \
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
TOKEN_ENCRYPTION_KEY=<your-token-encryption-key> \
deno run --allow-env --allow-net scripts/reencrypt-tokens.ts
```

Expected output: lists each account as `[DRY] account N — would re-encrypt` or `[SKIP]`, then a summary line like `Done. re-encrypted=X skipped=0 failed=0`.

- [ ] **Step 3: Run the live re-encryption**

```bash
SUPABASE_URL=<your-supabase-url> \
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
TOKEN_ENCRYPTION_KEY=<your-token-encryption-key> \
deno run --allow-env --allow-net scripts/reencrypt-tokens.ts
```

Expected: all accounts show `[OK]`, exit code 0. If any `[FAIL]`, investigate before proceeding.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/reencrypt-tokens.ts
git commit -m "security: add one-time token re-encryption script for HKDF migration (VULN-003)"
```

---

## Task 8: Deploy All Functions

- [ ] **Step 1: Deploy the modified edge functions**

```bash
npx supabase functions deploy instagram-integration --no-verify-jwt
npx supabase functions deploy instagram-analytics
npx supabase functions deploy instagram-sync-cron
npx supabase functions deploy instagram-refresh-cron
npx supabase functions deploy instagram-report-generator
npx supabase functions deploy hub-bootstrap
npx supabase functions deploy hub-posts
npx supabase functions deploy hub-approve
npx supabase functions deploy hub-brand
npx supabase functions deploy hub-pages
npx supabase functions deploy hub-briefing
```

> `instagram-integration` still uses `--no-verify-jwt` because it handles the public OAuth callback route (`/callback`) which does not carry a JWT. All other functions now have JWT verification re-enabled via `config.toml` (Task 1). Hub functions have JWT enabled, so do NOT use `--no-verify-jwt` for them.

- [ ] **Step 2: Run the re-encryption script** (Task 7, Step 3 above — if not already done)

- [ ] **Step 3: Verify**

Test each of these manually:
- Instagram OAuth: initiate connect flow from CRM → should redirect and complete without errors
- Hub link: open a hub URL in a browser (no auth) → should load posts and brand data
- Analytics: load Instagram analytics for a client → should display data
- Report generation: trigger a report → should succeed without 401

- [ ] **Step 4: Final commit tag**

```bash
git tag security/critical-remediation-2026-04-15
git push origin main --tags
```
