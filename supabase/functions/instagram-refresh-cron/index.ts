import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createInstagramRefreshCronHandler } from "./handler.ts";
import { shouldRevokeOnError } from "./utils.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { fetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";
import { contaIdOf } from "../instagram-sync-cron/select.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();

// The candidates select and the batch attempt-stamp update below are awaited state-relevant
// PostgREST calls with no bound otherwise — a stalled request hangs until the isolate is
// killed, bypassing both the non-fatal stamp-failure log branch and the outer catch below.
// Matches billing-downgrade-cron/handler.ts's DB_TIMEOUT_MS pattern.
const DB_TIMEOUT_MS = 10_000;

// --- Token Encryption Utility (Duplicated for standalone function) ---
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

// --- Cron Handler ---
Deno.serve(createInstagramRefreshCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // This cron does slow serial network work per row (Instagram token refresh + avatar
      // re-cache, one round-trip per account) — draining every eligible row in one isolate
      // trades silent truncation for a wall-clock death. A cap with token_expires_at ordering
      // turns overflow into a safe backlog: the soonest-to-expire accounts always go first, and
      // the cadence (well inside the 30-day window) retries whatever didn't fit. This is why
      // this select deliberately does NOT use fetchAllRows.
      //
      // A cap alone starves, though: an account that fails refresh with a transient error (or
      // is in an internal workspace and gets filtered below) never advances token_expires_at,
      // so it keeps sorting at the head of this window and re-consumes the whole batch every
      // run forever — exactly the failure mode instagram-sync-cron/select.ts documents and
      // fixes with attempt stamping. last_refresh_attempt_at is the primary sort key for the
      // same reason: it's stamped for the WHOLE selected batch (see below) regardless of
      // outcome, so a persistently failing — or internal, or filtered-for-any-reason — account
      // rotates to the back on the very next run instead of pinning the head.
      const REFRESH_BATCH_LIMIT = Math.max(1, parseInt(Deno.env.get('REFRESH_BATCH_LIMIT') || '200', 10) || 200);

      const { data: candidates, error } = await supabase
        .from('instagram_accounts')
        .select('id, encrypted_access_token, last_refresh_attempt_at, clientes!inner(conta_id)')
        .eq('authorization_status', 'active')
        .not('encrypted_access_token', 'is', null)
        .neq('encrypted_access_token', '')
        .lte('token_expires_at', thirtyDaysFromNow)
        .order('last_refresh_attempt_at', { ascending: true, nullsFirst: true })
        .order('token_expires_at', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .limit(REFRESH_BATCH_LIMIT)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));

      if (error) throw error;
      if (!candidates || candidates.length === 0) {
        return new Response("No tokens need refreshing", { status: 200 });
      }

      // Stamp the attempt for the WHOLE selected batch BEFORE any refresh work or the internal-
      // workspace filter below — mirrors instagram-sync-cron/index.ts's "stamp before syncing"
      // fix for the same starvation mode (see the rationale comment on REFRESH_BATCH_LIMIT
      // above). Stamping before, not after, means an account whose refresh kills the invocation
      // still rotates to the back on the next run. Stamping BEFORE the internal filter is
      // deliberate too: an internal-workspace account that gets skipped below is just as
      // capable of pinning the head of this ordering forever as a transient-failure account is,
      // so it must rotate exactly the same way. A stamp failure is logged but not fatal — the
      // next run re-reads the real ordering either way.
      const { error: stampError } = await supabase
        .from('instagram_accounts')
        .update({ last_refresh_attempt_at: new Date().toISOString() })
        .in('id', candidates.map((a: any) => a.id))
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (stampError) {
        console.error(`[IG-REFRESH-CRON] Failed to stamp last_refresh_attempt_at: ${stampError.message}`);
      }

      // Internal/seed workspaces hold placeholder tokens that can never decrypt;
      // refreshing them only produces a recurring alert. Fails open (see helper).
      const internalWorkspaces = await fetchInternalWorkspaceIds(supabase);
      const accounts = candidates.filter(
        (a: any) => !internalWorkspaces.has(contaIdOf(a))
      );
      const skippedInternal = candidates.length - accounts.length;
      if (skippedInternal > 0) {
        console.log(`[IG-REFRESH-CRON] Skipped ${skippedInternal} account(s) in internal workspaces`);
      }
      if (accounts.length === 0) {
        return new Response("No tokens need refreshing", { status: 200 });
      }

      let refreshedCount = 0;
      let failedCount = 0;
      const errors: Array<{ accountId: string; error: string }> = [];

      for (const account of accounts) {
        try {
          const currentToken = await decryptToken(account.encrypted_access_token);

        // Refresh token via Instagram API (new Instagram Login flow)
        const refreshUrl = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`;
        const res = await fetch(refreshUrl);
        const data = await res.json();

        if (data.error) {
            const errorCode = data.error.code;
            console.error(`Error refreshing token for account ${account.id}:`, data.error);
            if (shouldRevokeOnError(errorCode)) {
              const newStatus = errorCode === 190 ? 'expired' : 'revoked';
              await supabase
                .from('instagram_accounts')
                .update({ authorization_status: newStatus })
                .eq('id', account.id);
            }
            failedCount++;
            errors.push({ accountId: account.id, error: `Code ${errorCode}: ${data.error.message || 'Unknown'}` });
            continue;
        }

        const newLongLivedToken = data.access_token;
        const expiresInSeconds = data.expires_in || (60 * 60 * 24 * 60); // Default 60 days
        const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        
        const newEncryptedToken = await encryptToken(newLongLivedToken);

        // Refresh and cache profile picture while we have a fresh token
        let storedAvatarUrl: string | undefined;
        try {
          const profileRes = await fetch(`https://graph.instagram.com/me?fields=profile_picture_url&access_token=${newLongLivedToken}`);
          const profileData = await profileRes.json();
          if (profileData.profile_picture_url) {
            const imgRes = await fetch(profileData.profile_picture_url);
            if (imgRes.ok) {
              const imgBytes = await imgRes.arrayBuffer();
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
              const storagePath = `instagram/${account.id}.jpg`;
              const BUCKET = 'avatars';
              let { error: uploadError } = await supabase.storage
                .from(BUCKET).upload(storagePath, imgBytes, { contentType, upsert: true });
              if (uploadError?.message?.includes('Bucket not found')) {
                await supabase.storage.createBucket(BUCKET, { public: true });
                ({ error: uploadError } = await supabase.storage
                  .from(BUCKET).upload(storagePath, imgBytes, { contentType, upsert: true }));
              }
              if (!uploadError) {
                const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
                storedAvatarUrl = pub.publicUrl;
              }
            }
          }
        } catch (e) { /* non-fatal */ }

        const { error: updateError } = await supabase
          .from('instagram_accounts')
          .update({
            encrypted_access_token: newEncryptedToken,
            token_expires_at: newExpiresAt,
            authorization_status: 'active',
            ...(storedAvatarUrl ? { profile_picture_url: storedAvatarUrl } : {})
          })
          .eq('id', account.id);

        if (updateError) throw updateError;
          refreshedCount++;
        } catch (err: any) {
           console.error(`Failed to process account ${account.id}`, err);
           failedCount++;
           errors.push({ accountId: account.id, error: err.message || 'Unknown' });
        }
      }

      if (failedCount > 0) {
        await reportCronFailure(supabase, 'instagram-refresh-cron', { total: accounts.length, failed: failedCount, errors });
      }

      return new Response(JSON.stringify({
        success: true,
        refreshed: refreshedCount,
        failed: failedCount
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err: any) {
      console.error("Cron Job Failed", err);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
}));
