# Security Remediation — Critical Findings (VULN-001 to VULN-004, VULN-009, VULN-010)

**Date:** 2026-04-15
**Scope:** 6 critical findings from the 2026-04-15 security audit (`markdowns/cybersecurity_analysis.md`)
**Overall audit grade:** C (54/100) — capped by auto-critical gate on disabled JWT verification

---

## 1. VULN-001 — Re-enable JWT Verification

**File:** `supabase/config.toml`

All 7 functions currently have `verify_jwt = false`. Remove every such line (Supabase defaults to `true`). The functions already perform manual token validation internally, so re-enabling the Supabase JWT gate adds defense-in-depth at zero cost.

Functions affected: `instagram-analytics`, `hub-bootstrap`, `hub-posts`, `hub-approve`, `hub-brand`, `hub-pages`, `hub-briefing`.

---

## 2. VULN-002 — Hardcoded Production Credentials in SQL Migration

**File:** `supabase/migrations/20260324_schedule_instagram_sync_cron.sql`

The production Supabase URL and anon JWT are hardcoded in plaintext. The migration has already been applied to prod; rewriting it would break idempotency. The correct remediation is:

1. **Rotate the key** (manual step): Supabase Console → Settings → API → Regenerate anon key.
2. **Set via Supabase Vault, not in code:** After rotating, run:
   ```
   supabase secrets set SUPABASE_ANON_KEY=<new-rotated-key>
   ```
3. **Create a replacement migration** that reads from the vault secret rather than embedding a literal value. The migration uses `vault.decrypted_secret('anon_key')` so no key ever appears in a tracked file:
   ```sql
   -- Update the cron to use the vault-stored key (no literal value here)
   select cron.unschedule('instagram-sync-cron-daily');
   select cron.schedule(
     'instagram-sync-cron-daily',
     '0 6 * * *',
     $$
     select net.http_post(
       url := vault.decrypted_secret('project_url') || '/functions/v1/instagram-sync-cron',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || vault.decrypted_secret('anon_key')
       ),
       body := concat('{"time": "', now(), '"}')::jsonb
     ) as request_id;
     $$
   );
   ```
   This migration is safe to commit — it contains no secrets.

The spec plan must include a prominent manual step notice for the key rotation before running this migration.

---

## 3. VULN-003 — Weak AES-GCM Key Derivation

**Files (4):**
- `supabase/functions/instagram-integration/index.ts`
- `supabase/functions/instagram-analytics/index.ts`
- `supabase/functions/instagram-sync-cron/index.ts`
- `supabase/functions/instagram-refresh-cron/index.ts`

**Problem:** `TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)` zero-pads the key instead of using a proper KDF. If the key is shorter than 32 chars, effective entropy is reduced to the key length.

**Fix:** Replace the raw key import with HKDF-derived key in all four files:

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

All `encryptToken` / `decryptToken` calls replace the inline `rawKey` derivation with `await getEncryptionKey('instagram-access-token', ['encrypt'])` / `['decrypt']`.

**Migration constraint:** HKDF changes the derived key bytes. Existing rows in `instagram_accounts` with `encrypted_access_token IS NOT NULL` will fail to decrypt after deployment.

**Approach: dual-scheme decoder (no maintenance window needed)**

The new `decryptToken` will try HKDF first; if it throws (e.g. authentication tag mismatch), it falls back to the old `padEnd` scheme. This means old and new tokens coexist safely during the rollout window. Once all rows are re-encrypted, the fallback can be removed in a follow-up.

The one-time re-encryption script (`scripts/reencrypt-tokens.ts`) runs after the new functions are deployed (not before), so the running functions always have a working decoder:

1. Deploy new function code (with dual-scheme decoder).
2. Run `scripts/reencrypt-tokens.ts` to re-encrypt all rows to HKDF.
3. (Future) Remove the `padEnd` fallback path.

**Re-encryption script requirements:**

- Runtime: Deno (`deno run --allow-env --allow-net scripts/reencrypt-tokens.ts`)
- Env vars required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`
- Logic:
  1. Query all rows in `instagram_accounts` where `encrypted_access_token IS NOT NULL`.
  2. For each row: decrypt with old `padEnd` scheme → re-encrypt with HKDF → update row.
  3. Log success/failure per row; never silently skip.
  4. Dry-run mode (`DRY_RUN=true`): log what would change without writing.
- Safety: process rows one at a time (not bulk update) so a single failure doesn't corrupt others.

---

## 4. VULN-004 — Unsigned OAuth State Parameter

**File:** `supabase/functions/instagram-integration/index.ts`

**Problem:** `const state = btoa(JSON.stringify({ clientId }))` — trivially forgeable. Attacker can forge state with a victim's `clientId` and link their Instagram account to the victim.

**Fix:** Sign the state with HMAC-SHA256 using `TOKEN_ENCRYPTION_KEY`.

- `/auth/:clientId` route: build `{ clientId, nonce: crypto.randomUUID(), iat: Date.now() }`, sign with HMAC, encode as `base64(payload).base64(sig)`.
- `/callback` handler: split on `.`, verify HMAC signature before using `clientId`. Reject if signature invalid or `iat` is older than 10 minutes.

---

## 5. VULN-009 — Gemini API Key in URL Query Parameter

**File:** `supabase/functions/instagram-analytics/index.ts` (lines 968, 1129)

**Problem:** `?key=${GEMINI_API_KEY}` appended to fetch URL — leaks key into Supabase function logs and proxy caches.

**Fix:** Remove `?key=...` from both URLs; add `'x-goog-api-key': GEMINI_API_KEY` to the `headers` object in both fetch calls.

---

## 6. VULN-010 — Service Role Key in Inter-Function HTTP Header

**Files:**
- `supabase/functions/instagram-analytics/index.ts` (line 810, caller)
- `supabase/functions/instagram-report-generator/index.ts` (receiver — currently no auth)

**Problem:** `Authorization: Bearer <SERVICE_ROLE_KEY>` is sent over the network between edge functions. Service role key bypasses all RLS.

**Fix:** Replace with a dedicated `X-Internal-Token` header containing a new env var `INTERNAL_FUNCTION_SECRET`.

- **Caller (`instagram-analytics`):** Replace `Authorization: Bearer ${SERVICE_ROLE_KEY}` with `X-Internal-Token: ${INTERNAL_FUNCTION_SECRET}`. Keep `apikey` header with `SUPABASE_ANON_KEY`.
- **Receiver (`instagram-report-generator`):** Add auth check at the top of the handler: read `X-Internal-Token`, compare with `INTERNAL_FUNCTION_SECRET`, return 401 if mismatch.
- **New env var:** `INTERNAL_FUNCTION_SECRET` — must be added to Supabase secrets (`supabase secrets set INTERNAL_FUNCTION_SECRET=<random-uuid>`).

---

## Deployment Order

1. **Manual:** Rotate anon key in Supabase Console → Settings → API → Regenerate.
2. **Set secrets:**
   ```
   supabase secrets set SUPABASE_ANON_KEY=<rotated-key>
   supabase secrets set INTERNAL_FUNCTION_SECRET=<random-uuid>
   ```
3. **Run migration** `20260415_rotate_anon_key_vault.sql` to reschedule the cron using vault references.
4. **Deploy** all modified edge functions together (dual-scheme decoder is live from this point).
5. **Run re-encryption script** (tokens now safe to re-encrypt — old decoder still present as fallback):
   ```
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TOKEN_ENCRYPTION_KEY=... deno run --allow-env --allow-net scripts/reencrypt-tokens.ts
   ```
   Run with `DRY_RUN=true` first to verify row count.
6. **Verify:** Test Instagram OAuth flow, hub token access, analytics endpoint, report generation.
7. **(Future PR):** Remove `padEnd` fallback from `decryptToken` once all tokens confirmed re-encrypted.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `supabase/config.toml` | Remove 7 `verify_jwt = false` lines |
| `supabase/migrations/20260324_schedule_instagram_sync_cron.sql` | No change (already applied); new migration to rotate vault secret |
| `supabase/functions/instagram-integration/index.ts` | HKDF key derivation + signed OAuth state |
| `supabase/functions/instagram-analytics/index.ts` | HKDF key derivation + Gemini key to header + X-Internal-Token caller |
| `supabase/functions/instagram-sync-cron/index.ts` | HKDF key derivation |
| `supabase/functions/instagram-refresh-cron/index.ts` | HKDF key derivation |
| `supabase/functions/instagram-report-generator/index.ts` | Add X-Internal-Token verification |
| `scripts/reencrypt-tokens.ts` | New: one-time re-encryption script |
| New migration `20260415_rotate_anon_key_vault.sql` | Update vault secret with rotated anon key (placeholder for manual fill-in after rotation) |
