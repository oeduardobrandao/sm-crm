// supabase/functions/__tests__/tiktok-media_test.ts
//
// tiktok-media (fast-follow to the TikTok integration): puts TikTok-bound R2 media behind our
// own function host so PULL_FROM_URL's TikTok-verifiable URL-prefix requirement is satisfiable
// (raw R2 presigned URLs are *.r2.cloudflarestorage.com — not our domain, can't be verified).
// Two halves get coverage here:
//   (a) _shared/tiktok-media-url.ts's buildTikTokMediaUrl/verifyTikTokMediaToken token
//       round-trip, tamper detection, and expiry — pure crypto, no DI needed.
//   (b) tiktok-media/handler.ts's DI'd route handler (mirrors tiktok-webhook_test.ts's style):
//       the verify-file route (TikTok's own URL-prefix verification fetch) and the /m/{token}
//       proxy route (token check -> signGetUrl -> server-side fetch -> stream back, Range
//       forwarded, never leaking the r2 key or R2's own error body).
import { assert, assertEquals } from "./assert.ts";
import { buildTikTokMediaUrl, verifyTikTokMediaToken } from "../_shared/tiktok-media-url.ts";
import { createTikTokMediaHandler, type TikTokMediaDeps } from "../tiktok-media/handler.ts";

const TEST_KEY = "test-tiktok-media-encryption-key";

Deno.env.set("TOKEN_ENCRYPTION_KEY", TEST_KEY);
Deno.env.set("SUPABASE_URL", "https://supabase.example");

const MEDIA_URL_PREFIX = "https://supabase.example/functions/v1/tiktok-media/m/";

function tokenFromUrl(url: string): string {
  assert(url.startsWith(MEDIA_URL_PREFIX), `expected ${url} to start with ${MEDIA_URL_PREFIX}`);
  return url.slice(MEDIA_URL_PREFIX.length);
}

/** Flips a single base64url character at `index` to a different valid one — enough to change
 * the underlying bytes without needing a full decode/re-encode round trip. */
function flipChar(s: string, index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const original = s[index];
  const replacement = alphabet.split("").find((c) => c !== original)!;
  return s.slice(0, index) + replacement + s.slice(index + 1);
}

function unreachable(label: string) {
  return () => {
    throw new Error(`must not be called: ${label}`);
  };
}

// ── (a) buildTikTokMediaUrl / verifyTikTokMediaToken ────────────────────────────

Deno.test("tiktok-media-url: build then verify round-trips back to the same r2Key", async () => {
  const url = await buildTikTokMediaUrl("contas/1/videos/reel.mp4", 600);
  const token = tokenFromUrl(url);
  const resolved = await verifyTikTokMediaToken(token);
  assertEquals(resolved, "contas/1/videos/reel.mp4");
});

Deno.test("tiktok-media-url: tampering with the payload invalidates the signature", async () => {
  const url = await buildTikTokMediaUrl("contas/1/videos/reel.mp4", 600);
  const token = tokenFromUrl(url);
  const [payloadB64, sig] = token.split(".");
  const tamperedPayload = flipChar(payloadB64, 5);

  const resolved = await verifyTikTokMediaToken(`${tamperedPayload}.${sig}`);
  assertEquals(resolved, null);
});

Deno.test("tiktok-media-url: tampering with the signature invalidates the token", async () => {
  const url = await buildTikTokMediaUrl("contas/1/videos/reel.mp4", 600);
  const token = tokenFromUrl(url);
  const [payloadB64, sig] = token.split(".");
  const tamperedSig = flipChar(sig, 0);

  const resolved = await verifyTikTokMediaToken(`${payloadB64}.${tamperedSig}`);
  assertEquals(resolved, null);
});

Deno.test("tiktok-media-url: an already-expired ttl verifies the signature but fails the exp check", async () => {
  const url = await buildTikTokMediaUrl("contas/1/videos/reel.mp4", -10);
  const token = tokenFromUrl(url);

  const resolved = await verifyTikTokMediaToken(token);
  assertEquals(resolved, null);
});

// ── (b) tiktok-media/handler.ts: verify-file route ──────────────────────────────

function mediaRequest(path: string, opts?: { range?: string }): Request {
  const headers: Record<string, string> = {};
  if (opts?.range) headers["Range"] = opts.range;
  return new Request(`https://example.test${path}`, { headers });
}

function baseDeps(overrides: Partial<TikTokMediaDeps> = {}): TikTokMediaDeps {
  return {
    verifyTikTokMediaToken: (unreachable("verifyTikTokMediaToken") as unknown) as TikTokMediaDeps["verifyTikTokMediaToken"],
    signGetUrl: (unreachable("signGetUrl") as unknown) as TikTokMediaDeps["signGetUrl"],
    fetchR2: (unreachable("fetchR2") as unknown) as TikTokMediaDeps["fetchR2"],
    urlVerifyFilename: undefined,
    urlVerifyContent: undefined,
    ...overrides,
  };
}

Deno.test("tiktok-media verify-file route: env set + matching filename returns 200 with the content", async () => {
  const handler = createTikTokMediaHandler(baseDeps({
    urlVerifyFilename: "tiktokABC123.txt",
    urlVerifyContent: "tiktok-developers-site-verification=abc123",
  }));

  const res = await handler(mediaRequest("/tiktok-media/tiktokABC123.txt"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/plain");
  assertEquals(await res.text(), "tiktok-developers-site-verification=abc123");
});

Deno.test("tiktok-media verify-file route: wrong filename returns 404", async () => {
  const handler = createTikTokMediaHandler(baseDeps({
    urlVerifyFilename: "tiktokABC123.txt",
    urlVerifyContent: "content",
  }));

  const res = await handler(mediaRequest("/tiktok-media/tiktokZZZ999.txt"));
  assertEquals(res.status, 404);
  assertEquals(await res.text(), "");
});

Deno.test("tiktok-media verify-file route: env unset returns 404 even for a well-formed filename", async () => {
  const handler = createTikTokMediaHandler(baseDeps());

  const res = await handler(mediaRequest("/tiktok-media/tiktokABC123.txt"));
  assertEquals(res.status, 404);
});

Deno.test("tiktok-media verify-file route: non-matching filename pattern returns 404 regardless of env", async () => {
  const handler = createTikTokMediaHandler(baseDeps({
    urlVerifyFilename: "not-a-tiktok-file.txt",
    urlVerifyContent: "content",
  }));

  const res = await handler(mediaRequest("/tiktok-media/not-a-tiktok-file.txt"));
  assertEquals(res.status, 404, "filename must match ^tiktok[A-Za-z0-9_-]*\\.txt$ regardless of env");
});

// ── (c) tiktok-media/handler.ts: /m/{token} proxy route ─────────────────────────

Deno.test("tiktok-media proxy route: invalid/expired token returns 403 with an empty body, R2 never touched", async () => {
  let signCalled = false;
  const handler = createTikTokMediaHandler(baseDeps({
    verifyTikTokMediaToken: async () => null,
    signGetUrl: async () => {
      signCalled = true;
      return "";
    },
  }));

  const res = await handler(mediaRequest("/tiktok-media/m/bad-token"));
  assertEquals(res.status, 403);
  assertEquals(await res.text(), "");
  assertEquals(signCalled, false, "an invalid token must never reach signGetUrl");
});

Deno.test("tiktok-media proxy route: happy path streams the R2 body with Content-Type passed through, status 200", async () => {
  const handler = createTikTokMediaHandler(baseDeps({
    verifyTikTokMediaToken: async (token) => (token === "good-token" ? "contas/1/videos/reel.mp4" : null),
    signGetUrl: async (key, ttl) => {
      assertEquals(key, "contas/1/videos/reel.mp4");
      assertEquals(ttl, 600);
      return "https://r2.example.com/signed?key=reel";
    },
    fetchR2: (async (url: string, init?: RequestInit) => {
      assertEquals(url, "https://r2.example.com/signed?key=reel");
      assertEquals((init?.headers as Record<string, string> | undefined)?.Range, undefined);
      return new Response(new Blob([new Uint8Array([1, 2, 3, 4])]), {
        status: 200,
        headers: { "Content-Type": "video/mp4", "Content-Length": "4", "Accept-Ranges": "bytes" },
      });
    }) as typeof fetch,
  }));

  const res = await handler(mediaRequest("/tiktok-media/m/good-token"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "video/mp4");
  assertEquals(res.headers.get("Content-Length"), "4");
  assertEquals(res.headers.get("Accept-Ranges"), "bytes");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assertEquals(Array.from(bytes), [1, 2, 3, 4]);
});

Deno.test("tiktok-media proxy route: incoming Range header is forwarded to R2 and the 206 + Content-Range pass through", async () => {
  const handler = createTikTokMediaHandler(baseDeps({
    verifyTikTokMediaToken: async () => "contas/1/videos/reel.mp4",
    signGetUrl: async () => "https://r2.example.com/signed?key=reel",
    fetchR2: (async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      assertEquals(headers?.Range, "bytes=0-3");
      return new Response(new Blob([new Uint8Array([9, 9, 9, 9])]), {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-3/1000",
          "Accept-Ranges": "bytes",
        },
      });
    }) as typeof fetch,
  }));

  const res = await handler(mediaRequest("/tiktok-media/m/good-token", { range: "bytes=0-3" }));
  assertEquals(res.status, 206);
  assertEquals(res.headers.get("Content-Range"), "bytes 0-3/1000");
});

Deno.test("tiktok-media proxy route: R2 404 maps to a bare 404, never echoing the r2 key or R2's error body", async () => {
  const handler = createTikTokMediaHandler(baseDeps({
    verifyTikTokMediaToken: async () => "contas/1/videos/reel.mp4",
    signGetUrl: async () => "https://r2.example.com/signed?key=reel",
    fetchR2: (async () => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 })) as typeof fetch,
  }));

  const res = await handler(mediaRequest("/tiktok-media/m/good-token"));
  assertEquals(res.status, 404);
  assertEquals(await res.text(), "");
});
