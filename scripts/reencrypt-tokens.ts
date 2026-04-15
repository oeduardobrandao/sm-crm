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
