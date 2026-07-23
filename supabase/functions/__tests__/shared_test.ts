import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { decryptText, encryptText, timingSafeEqual } from "../_shared/crypto.ts";
import { checkRateLimit, getClientIP } from "../_shared/rate-limit.ts";

Deno.test("buildCorsHeaders echoes allowlisted origins and falls back for non-browser requests", () => {
  Deno.env.set("ALLOWED_ORIGINS", "https://app.mesaas.com,https://hub.mesaas.com");

  const allowed = buildCorsHeaders(new Request("https://example.test", {
    headers: { origin: "https://hub.mesaas.com" },
  }));
  const fallback = buildCorsHeaders(new Request("https://example.test"));

  assertEquals(allowed["Access-Control-Allow-Origin"], "https://hub.mesaas.com");
  assertEquals(fallback["Access-Control-Allow-Origin"], "https://app.mesaas.com");
  assert(allowed["Access-Control-Allow-Methods"].includes("OPTIONS"));
  // PUT is kept allowlisted DEFENSIVELY, not because a caller is known to need it here.
  // The original justification (design-manage's browser-issued PUT for Estúdio autosave) died
  // with the Estúdio retirement, and no surviving edge function handles PUT. The browser PUTs
  // that do exist go straight to R2 presigned URLs on *.r2.cloudflarestorage.com
  // (apps/crm/src/services/{inlineImage,fileService,postMedia,ideiaMedia}.ts,
  // apps/hub/src/services/ideiaMedia.ts) — those preflights are governed by R2's own bucket
  // CORS config, which buildCorsHeaders does not affect. Removing PUT here is therefore
  // probably safe but unverified, and a wrong call breaks uploads at runtime with no test
  // to catch it — so it stays until someone confirms against the live bucket config.
  assert(allowed["Access-Control-Allow-Methods"].includes("PUT"));
});

Deno.test("checkRateLimit delegates to the rate-limit RPC and fails open on errors", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("check_rate_limit", { data: false, error: null });

  const blocked = await checkRateLimit(db as never, "hub:127.0.0.1", 20, 60);
  assertEquals(blocked, false);

  db.queueRpc("check_rate_limit", {
    data: null,
    error: { message: "rpc offline" },
  });
  const allowed = await checkRateLimit(db as never, "hub:127.0.0.1", 20, 60);
  assertEquals(allowed, true);
});

Deno.test("getClientIP prefers forwarded headers before falling back to unknown", () => {
  assertEquals(
    getClientIP(new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } })),
    "203.0.113.5",
  );
  assertEquals(
    getClientIP(new Request("https://example.test", { headers: { "x-real-ip": "198.51.100.9" } })),
    "198.51.100.9",
  );
  assertEquals(getClientIP(new Request("https://example.test")), "unknown");
});

Deno.test("shared crypto helpers perform a round trip and preserve timing-safe equality semantics", async () => {
  const secret = "segredo-super-forte-para-testes";
  const purpose = "instagram-access-token";
  const plainText = "igq1v1.token-da-clinica-aurora";

  const cipherText = await encryptText(plainText, secret, purpose);
  const decrypted = await decryptText(cipherText, secret, purpose);

  assert(cipherText !== plainText, "ciphertext should not equal plaintext");
  assertEquals(decrypted, plainText);
  assertEquals(timingSafeEqual("mesaas", "mesaas"), true);
  assertEquals(timingSafeEqual("mesaas", "mesaas-hub"), false);
});
