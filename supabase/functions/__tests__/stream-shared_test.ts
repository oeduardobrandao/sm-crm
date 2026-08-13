import { assert, assertEquals } from "./assert.ts";
import {
  copyToStream,
  deleteStreamVideo,
  getStreamVideoStatus,
  isStreamCleanupEnabled,
  isStreamEnabled,
  listStreamVideos,
  signPlaybackUrl,
  verifyStreamWebhookSignature,
} from "../_shared/stream.ts";

function setStreamEnv() {
  Deno.env.set("STREAM_ACCOUNT_ID", "acct1");
  Deno.env.set("STREAM_API_TOKEN", "tok1");
  Deno.env.set("STREAM_CUSTOMER_CODE", "custcode");
  Deno.env.set("STREAM_SIGNING_KEY_ID", "key1");
  Deno.env.set("STREAM_WEBHOOK_SECRET", "whsec");
  // STREAM_SIGNING_KEY_JWK set per-test (needs a generated key)
}
function clearStreamEnv() {
  for (
    const k of [
      "STREAM_ACCOUNT_ID",
      "STREAM_API_TOKEN",
      "STREAM_CUSTOMER_CODE",
      "STREAM_SIGNING_KEY_ID",
      "STREAM_SIGNING_KEY_JWK",
      "STREAM_WEBHOOK_SECRET",
    ]
  ) Deno.env.delete(k);
}

function base64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  return atob(padded);
}

function jsonPart(token: string, index: number): any {
  return JSON.parse(base64UrlDecode(token.split(".")[index]));
}

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

Deno.test("stream-shared: gating — all unset => both disabled", () => {
  clearStreamEnv();
  assertEquals(isStreamCleanupEnabled(), false);
  assertEquals(isStreamEnabled(), false);
});

Deno.test("stream-shared: gating — only ACCOUNT_ID+API_TOKEN => cleanup on, full off", () => {
  clearStreamEnv();
  Deno.env.set("STREAM_ACCOUNT_ID", "acct1");
  Deno.env.set("STREAM_API_TOKEN", "tok1");
  assertEquals(isStreamCleanupEnabled(), true);
  assertEquals(isStreamEnabled(), false);
  clearStreamEnv();
});

Deno.test("stream-shared: gating — all vars set => both enabled", () => {
  clearStreamEnv();
  setStreamEnv();
  Deno.env.set("STREAM_SIGNING_KEY_JWK", btoa(JSON.stringify({ dummy: true })));
  assertEquals(isStreamCleanupEnabled(), true);
  assertEquals(isStreamEnabled(), true);
  clearStreamEnv();
});

// ---------------------------------------------------------------------------
// copyToStream
// ---------------------------------------------------------------------------

Deno.test("stream-shared: copyToStream posts to the accounts/{id}/stream/copy endpoint and returns uid", async () => {
  clearStreamEnv();
  setStreamEnv();
  const cap: { req?: Request; body?: unknown } = {};
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    cap.req = new Request(input as string, init);
    cap.body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ success: true, result: { uid: "video-uid-1" } }), {
      status: 200,
    });
  }) as typeof fetch;

  const uid = await copyToStream("https://example.com/source.mp4", { postId: "p1" }, fetchFn);

  assertEquals(uid, "video-uid-1");
  assertEquals(cap.req!.url, "https://api.cloudflare.com/client/v4/accounts/acct1/stream/copy");
  assertEquals(cap.req!.method, "POST");
  assertEquals(cap.req!.headers.get("Authorization"), "Bearer tok1");
  assertEquals(cap.body, {
    url: "https://example.com/source.mp4",
    meta: { postId: "p1" },
    requireSignedURLs: true,
  });
  clearStreamEnv();
});

Deno.test("stream-shared: copyToStream throws on success:false", async () => {
  clearStreamEnv();
  setStreamEnv();
  const fetchFn = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ success: false, errors: [{ message: "nope" }] }), { status: 200 }),
    )) as typeof fetch;

  let threw = false;
  try {
    await copyToStream("https://example.com/source.mp4", {}, fetchFn);
  } catch (_e) {
    threw = true;
  }
  assert(threw, "expected copyToStream to throw on success:false");
  clearStreamEnv();
});

Deno.test("stream-shared: copyToStream throws on non-2xx", async () => {
  clearStreamEnv();
  setStreamEnv();
  const fetchFn = (() => Promise.resolve(new Response("server error", { status: 500 }))) as typeof fetch;

  let message = "";
  try {
    await copyToStream("https://example.com/source.mp4", {}, fetchFn);
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert(message.includes("500"), `expected the status in: ${message}`);
  clearStreamEnv();
});

// ---------------------------------------------------------------------------
// signPlaybackUrl
// ---------------------------------------------------------------------------

Deno.test("stream-shared: signPlaybackUrl builds a verifiable RS256 JWT and correct HLS url", async () => {
  clearStreamEnv();
  setStreamEnv();

  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  Deno.env.set("STREAM_SIGNING_KEY_JWK", btoa(JSON.stringify(jwk)));

  const before = Math.floor(Date.now() / 1000);
  const { hls, expires_at } = await signPlaybackUrl("video-uid-1");
  const after = Math.floor(Date.now() / 1000);

  const match = hls.match(
    /^https:\/\/customer-custcode\.cloudflarestream\.com\/([^/]+)\/manifest\/video\.m3u8$/,
  );
  assert(match, `unexpected hls url shape: ${hls}`);
  const token = match![1];

  const header = jsonPart(token, 0);
  const payload = jsonPart(token, 1);
  assertEquals(header.alg, "RS256");
  assertEquals(header.kid, "key1");
  assertEquals(payload.sub, "video-uid-1");
  assertEquals(payload.kid, "key1");
  assert(payload.exp >= before + 43_200 && payload.exp <= after + 43_200, `unexpected exp: ${payload.exp}`);
  assertEquals(expires_at, new Date(payload.exp * 1000).toISOString());

  const [headerB64, payloadB64, sigB64] = token.split(".");
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBytes = Uint8Array.from(base64UrlDecode(sigB64), (c) => c.charCodeAt(0));
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    pair.publicKey,
    sigBytes,
    new TextEncoder().encode(signingInput),
  );
  assert(verified, "signature did not verify against the generated public key");

  clearStreamEnv();
});

Deno.test("stream-shared: signPlaybackUrl honors a custom expSeconds", async () => {
  clearStreamEnv();
  setStreamEnv();
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  Deno.env.set("STREAM_SIGNING_KEY_JWK", btoa(JSON.stringify(jwk)));

  const before = Math.floor(Date.now() / 1000);
  const { hls } = await signPlaybackUrl("uid-2", 60);
  const token = hls.split("/")[3];
  const payload = jsonPart(token, 1);
  assert(payload.exp <= before + 61 && payload.exp >= before + 59, `unexpected exp: ${payload.exp}`);

  clearStreamEnv();
});

// ---------------------------------------------------------------------------
// verifyStreamWebhookSignature
// ---------------------------------------------------------------------------

async function hmacHex(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("stream-shared: verifyStreamWebhookSignature accepts a valid signature", async () => {
  clearStreamEnv();
  setStreamEnv();
  const body = JSON.stringify({ uid: "video-uid-1", status: { state: "ready" } });
  const time = Math.floor(Date.now() / 1000);
  const sig = await hmacHex("whsec", `${time}.${body}`);
  const header = `time=${time},sig1=${sig}`;

  assertEquals(await verifyStreamWebhookSignature(body, header, time), true);
  clearStreamEnv();
});

Deno.test("stream-shared: verifyStreamWebhookSignature rejects a tampered body", async () => {
  clearStreamEnv();
  setStreamEnv();
  const body = JSON.stringify({ uid: "video-uid-1", status: { state: "ready" } });
  const time = Math.floor(Date.now() / 1000);
  const sig = await hmacHex("whsec", `${time}.${body}`);
  const header = `time=${time},sig1=${sig}`;
  const tamperedBody = JSON.stringify({ uid: "video-uid-1", status: { state: "error" } });

  assertEquals(await verifyStreamWebhookSignature(tamperedBody, header, time), false);
  clearStreamEnv();
});

Deno.test("stream-shared: verifyStreamWebhookSignature rejects a stale timestamp (10 min old)", async () => {
  clearStreamEnv();
  setStreamEnv();
  const body = JSON.stringify({ uid: "video-uid-1" });
  const now = Math.floor(Date.now() / 1000);
  const time = now - 600;
  const sig = await hmacHex("whsec", `${time}.${body}`);
  const header = `time=${time},sig1=${sig}`;

  assertEquals(await verifyStreamWebhookSignature(body, header, now), false);
  clearStreamEnv();
});

Deno.test("stream-shared: verifyStreamWebhookSignature rejects missing/garbage headers", async () => {
  clearStreamEnv();
  setStreamEnv();
  const body = JSON.stringify({ uid: "video-uid-1" });

  assertEquals(await verifyStreamWebhookSignature(body, null), false);
  assertEquals(await verifyStreamWebhookSignature(body, "not a real header"), false);
  assertEquals(await verifyStreamWebhookSignature(body, "time=abc,sig1=zz"), false);
  clearStreamEnv();
});

// ---------------------------------------------------------------------------
// deleteStreamVideo
// ---------------------------------------------------------------------------

Deno.test("stream-shared: deleteStreamVideo resolves on 404 (already gone = success)", async () => {
  clearStreamEnv();
  setStreamEnv();
  const fetchFn = (() => Promise.resolve(new Response("not found", { status: 404 }))) as typeof fetch;
  await deleteStreamVideo("video-uid-1", fetchFn);
  clearStreamEnv();
});

Deno.test("stream-shared: deleteStreamVideo resolves on 200", async () => {
  clearStreamEnv();
  setStreamEnv();
  const cap: { req?: Request } = {};
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
    cap.req = new Request(input as string, init);
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }) as typeof fetch;
  await deleteStreamVideo("video-uid-1", fetchFn);
  assertEquals(cap.req!.url, "https://api.cloudflare.com/client/v4/accounts/acct1/stream/video-uid-1");
  assertEquals(cap.req!.method, "DELETE");
  clearStreamEnv();
});

Deno.test("stream-shared: deleteStreamVideo throws on 500", async () => {
  clearStreamEnv();
  setStreamEnv();
  const fetchFn = (() => Promise.resolve(new Response("server error", { status: 500 }))) as typeof fetch;

  let threw = false;
  try {
    await deleteStreamVideo("video-uid-1", fetchFn);
  } catch (_e) {
    threw = true;
  }
  assert(threw, "expected deleteStreamVideo to throw on 500");
  clearStreamEnv();
});

// ---------------------------------------------------------------------------
// getStreamVideoStatus
// ---------------------------------------------------------------------------

Deno.test("stream-shared: getStreamVideoStatus maps ready/error and defaults to inprogress", async () => {
  clearStreamEnv();
  setStreamEnv();

  const stateFetch = (state: string) =>
    (() =>
      Promise.resolve(
        new Response(JSON.stringify({ result: { status: { state } } }), { status: 200 }),
      )) as typeof fetch;

  assertEquals(await getStreamVideoStatus("uid-1", stateFetch("ready")), "ready");
  assertEquals(await getStreamVideoStatus("uid-1", stateFetch("error")), "error");
  assertEquals(await getStreamVideoStatus("uid-1", stateFetch("queued")), "inprogress");
  assertEquals(await getStreamVideoStatus("uid-1", stateFetch("downloading")), "inprogress");

  clearStreamEnv();
});

// ---------------------------------------------------------------------------
// listStreamVideos
// ---------------------------------------------------------------------------

Deno.test("stream-shared: listStreamVideos paginates until a short page, carrying after=", async () => {
  clearStreamEnv();
  setStreamEnv();

  const page1 = Array.from({ length: 1000 }, (_, i) => ({
    uid: `uid-${i}`,
    created: `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00Z-${i}`,
  }));
  const page2 = [
    { uid: "uid-1000", created: "2026-01-02T00:00:00Z" },
    { uid: "uid-1001", created: "2026-01-02T00:01:00Z" },
    { uid: "uid-1002", created: "2026-01-02T00:02:00Z" },
  ];

  const calls: string[] = [];
  const fetchFn = ((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) {
      return Promise.resolve(new Response(JSON.stringify({ result: page1 }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ result: page2 }), { status: 200 }));
  }) as typeof fetch;

  const videos = await listStreamVideos(fetchFn);

  assertEquals(videos.length, 1003);
  assertEquals(calls.length, 2);
  assert(calls[0].includes("asc=true") && !calls[0].includes("after="), `first call: ${calls[0]}`);
  assert(
    calls[1].includes(`after=${encodeURIComponent(page1[999].created)}`),
    `second call missing after=: ${calls[1]}`,
  );
  assertEquals(videos[0], { uid: "uid-0", created: page1[0].created });
  assertEquals(videos[1002], { uid: "uid-1002", created: "2026-01-02T00:02:00Z" });

  clearStreamEnv();
});
