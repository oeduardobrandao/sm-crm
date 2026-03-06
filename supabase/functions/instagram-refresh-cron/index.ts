import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY")! || "default_encryption_key_32_chars_!!";

// --- Token Encryption Utility (Duplicated for standalone function) ---
async function encryptToken(token: string): Promise<string> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(token)
  );

  const encryptedArray = new Uint8Array(encryptedBuf);
  const combined = new Uint8Array(iv.length + encryptedArray.length);
  combined.set(iv);
  combined.set(encryptedArray, iv.length);
  return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

async function decryptToken(encryptedBase64: string): Promise<string> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  return new TextDecoder().decode(decryptedBuf);
}

// --- Cron Handler ---
serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find tokens expiring within the next 10 days
    // 10 days = 10 * 24 * 60 * 60 * 1000 ms
    const tenDaysFromNow = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    const { data: accounts, error } = await supabase
      .from('instagram_accounts')
      .select('id, encrypted_access_token')
      .lte('token_expires_at', tenDaysFromNow);

    if (error) throw error;
    if (!accounts || accounts.length === 0) {
      return new Response("No tokens need refreshing", { status: 200 });
    }

    let refreshedCount = 0;
    let failedCount = 0;

    for (const account of accounts) {
      try {
        const currentToken = await decryptToken(account.encrypted_access_token);
        
        // Refresh token via Meta API
        const refreshUrl = \`https://graph.instagram.com/refresh_access_token\u003Fgrant_type=ig_refresh_token&access_token=\${currentToken}\`;
        const res = await fetch(refreshUrl);
        const data = await res.json();

        if (data.error) {
            console.error(\`Error refreshing token for account \${account.id}:\`, data.error);
            failedCount++;
            continue;
        }

        const newLongLivedToken = data.access_token;
        const expiresInSeconds = data.expires_in || (60 * 60 * 24 * 60); // Default 60 days
        const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        
        const newEncryptedToken = await encryptToken(newLongLivedToken);

        const { error: updateError } = await supabase
          .from('instagram_accounts')
          .update({
            encrypted_access_token: newEncryptedToken,
            token_expires_at: newExpiresAt
          })
          .eq('id', account.id);

        if (updateError) throw updateError;
        refreshedCount++;
      } catch (err) {
         console.error(\`Failed to process account \${account.id}\`, err);
         failedCount++;
      }
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
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
});
