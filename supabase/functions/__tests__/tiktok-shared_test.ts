// Shared TikTok wire constants, token crypto (AES-256-GCM via HKDF from TOKEN_ENCRYPTION_KEY),
// and the authenticated API fetch wrapper. Mirrors the stubbed-fetch pattern used by
// image-gen-openrouter_test.ts / instagram-publish-cover_test.ts.
import { assert, assertEquals } from "./assert.ts";
import {
  encryptTikTokToken,
  decryptTikTokToken,
  tiktokFetch,
  TikTokApiError,
  EVENT_NO_LONGER_PUBLICALY_AVAILABLE,
} from "../_shared/tiktok.ts";

/** Local stand-in for std's assertRejects — ./assert.ts deliberately stays tiny. */
// deno-lint-ignore no-explicit-any
async function assertRejects(fn: () => Promise<unknown>, ErrClass?: new (...a: any[]) => Error): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    if (ErrClass) {
      assert(e instanceof ErrClass, `expected ${ErrClass.name}, got ${(e as Error)?.constructor?.name}`);
    }
    return e as Error;
  }
  throw new Error("expected the function to throw, but it did not");
}

function stubFetch(response: () => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => response()) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const TEST_KEY = "test-tiktok-encryption-key-32ch";

Deno.test("tiktok-shared: constants preserve TikTok's misspellings verbatim (sic)", () => {
  assertEquals(EVENT_NO_LONGER_PUBLICALY_AVAILABLE, "post.publish.no_longer_publicaly_available");
});

Deno.test("tiktok-shared: encryptTikTokToken/decryptTikTokToken round-trips for access tokens", async () => {
  Deno.env.set("TOKEN_ENCRYPTION_KEY", TEST_KEY);
  const enc = await encryptTikTokToken("access-secret-value", "access");
  const dec = await decryptTikTokToken(enc, "access");
  assertEquals(dec, "access-secret-value");
});

Deno.test("tiktok-shared: encryptTikTokToken/decryptTikTokToken round-trips for refresh tokens", async () => {
  Deno.env.set("TOKEN_ENCRYPTION_KEY", TEST_KEY);
  const enc = await encryptTikTokToken("refresh-secret-value", "refresh");
  const dec = await decryptTikTokToken(enc, "refresh");
  assertEquals(dec, "refresh-secret-value");
});

Deno.test("tiktok-shared: decrypting an access token as refresh kind throws (different HKDF info)", async () => {
  Deno.env.set("TOKEN_ENCRYPTION_KEY", TEST_KEY);
  const enc = await encryptTikTokToken("access-secret-value", "access");
  await assertRejects(() => decryptTikTokToken(enc, "refresh"));
});

Deno.test("tiktok-shared: missing TOKEN_ENCRYPTION_KEY throws", async () => {
  const previous = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  Deno.env.delete("TOKEN_ENCRYPTION_KEY");
  try {
    await assertRejects(() => encryptTikTokToken("x", "access"));
  } finally {
    if (previous !== undefined) Deno.env.set("TOKEN_ENCRYPTION_KEY", previous);
  }
});

Deno.test("tiktok-shared: tiktokFetch throws TikTokApiError code TOKEN_INVALID on access_token_invalid", async () => {
  const restore = stubFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ data: {}, error: { code: "access_token_invalid", message: "token expired", log_id: "1" } }),
        { status: 200 },
      ),
    )
  );
  try {
    const err = await assertRejects(() => tiktokFetch("/user/info/", { accessToken: "tok" }), TikTokApiError);
    assertEquals((err as TikTokApiError).code, "TOKEN_INVALID");
    assertEquals((err as TikTokApiError).retryable, false);
  } finally {
    restore();
  }
});

Deno.test("tiktok-shared: tiktokFetch maps scope errors to code REVOKED", async () => {
  const restore = stubFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ data: {}, error: { code: "scope_not_authorized", message: "missing scope", log_id: "2" } }),
        { status: 200 },
      ),
    )
  );
  try {
    const err = await assertRejects(() => tiktokFetch("/video/list/", { accessToken: "tok" }), TikTokApiError);
    assertEquals((err as TikTokApiError).code, "REVOKED");
  } finally {
    restore();
  }
});

Deno.test("tiktok-shared: tiktokFetch maps HTTP 429 to retryable code RATE_LIMITED", async () => {
  const restore = stubFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 429 })));
  try {
    const err = await assertRejects(() => tiktokFetch("/post/publish/status/fetch/", { accessToken: "tok" }), TikTokApiError);
    assertEquals((err as TikTokApiError).code, "RATE_LIMITED");
    assertEquals((err as TikTokApiError).retryable, true);
  } finally {
    restore();
  }
});

Deno.test("tiktok-shared: tiktokFetch returns the data envelope on code ok", async () => {
  const restore = stubFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ data: { open_id: "abc" }, error: { code: "ok", message: "", log_id: "3" } }),
        { status: 200 },
      ),
    )
  );
  try {
    const result = await tiktokFetch("/user/info/", { accessToken: "tok" });
    assertEquals(result, { open_id: "abc" });
  } finally {
    restore();
  }
});
