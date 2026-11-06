import { assert, assertEquals } from "./assert.ts";
import { buildApnsPayload, createApnsClient, signApnsJwt } from "../_shared/apns.ts";

async function makeKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const body = btoa(bin).match(/.{1,64}/g)!.join("\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.test("signApnsJwt produces an ES256 JWT that verifies with the key's public half", async () => {
  const { pem, publicKey } = await makeKey();
  const jwt = await signApnsJwt({ keyId: "KEY123", teamId: "TEAM456", privateKeyPem: pem, bundleId: "x" }, 1_800_000_000);
  const [h, c, sig] = jwt.split(".");
  assertEquals(JSON.parse(new TextDecoder().decode(b64urlDecode(h))), { alg: "ES256", kid: "KEY123" });
  assertEquals(JSON.parse(new TextDecoder().decode(b64urlDecode(c))), { iss: "TEAM456", iat: 1_800_000_000 });
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    b64urlDecode(sig),
    new TextEncoder().encode(`${h}.${c}`),
  );
  assert(ok, "signature must verify");
});

Deno.test("signApnsJwt accepts a key whose newlines were pasted as literal \\n", async () => {
  const { pem } = await makeKey();
  const flattened = pem.replace(/\n/g, "\\n");
  const jwt = await signApnsJwt({ keyId: "K", teamId: "T", privateKeyPem: flattened, bundleId: "x" }, 1);
  assertEquals(jwt.split(".").length, 3);
});

Deno.test("buildApnsPayload omits empty alert fields and puts app data next to aps", () => {
  assertEquals(
    buildApnsPayload({ alert: { title: "Oi" }, data: { link: "/x", notification_id: "n1" } }),
    { aps: { alert: { title: "Oi" }, sound: "default" }, link: "/x", notification_id: "n1" },
  );
  assertEquals(
    buildApnsPayload({ alert: { title: "T", subtitle: "S", body: "B" }, badge: 3, threadId: "post_message" }),
    { aps: { alert: { title: "T", subtitle: "S", body: "B" }, sound: "default", badge: 3, "thread-id": "post_message" } },
  );
});

interface Call { url: string; headers: Record<string, string>; body: unknown }

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fn = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Promise.resolve(
      new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status }),
    );
  };
  return { fn: fn as typeof fetch, calls };
}

async function client(responses: Array<{ status: number; body?: unknown }>, nowMs = () => 1_800_000_000_000) {
  const { pem } = await makeKey();
  const f = fakeFetch(responses);
  const c = createApnsClient(
    { keyId: "K", teamId: "T", privateKeyPem: pem, bundleId: "br.com.mesaas.app" },
    { fetch: f.fn, nowMs },
  );
  return { c, calls: f.calls };
}

const MSG = { alert: { title: "Oi" } };

Deno.test("send posts to the environment's host with the APNs headers", async () => {
  const { c, calls } = await client([{ status: 200 }]);
  assertEquals(await c.send("abc", "production", MSG), { ok: true });
  await c.send("def", "sandbox", MSG);
  assertEquals(calls[0].url, "https://api.push.apple.com/3/device/abc");
  assertEquals(calls[1].url, "https://api.sandbox.push.apple.com/3/device/def");
  assertEquals(calls[0].headers["apns-topic"], "br.com.mesaas.app");
  assertEquals(calls[0].headers["apns-push-type"], "alert");
  assertEquals(calls[0].headers["apns-priority"], "10");
  assertEquals(calls[0].headers["apns-expiration"], String(1_800_000_000 + 3600));
  assert(calls[0].headers.authorization.startsWith("bearer "), "bearer token");
});

Deno.test("send classifies dead tokens as unregistered and other errors as not", async () => {
  for (const [status, reason, dead] of [
    [410, "Unregistered", true],
    [400, "BadDeviceToken", true],
    [400, "DeviceTokenNotForTopic", true],
    [400, "PayloadTooLarge", false],
    [429, "TooManyRequests", false],
    [500, "InternalServerError", false],
  ] as const) {
    const { c } = await client([{ status, body: { reason } }]);
    assertEquals(await c.send("t", "production", MSG), { ok: false, status, reason, unregistered: dead });
  }
});

Deno.test("send reuses the provider token for 50 minutes, then mints a new one", async () => {
  let now = 1_800_000_000_000;
  const { c, calls } = await client([{ status: 200 }], () => now);
  await c.send("a", "production", MSG);
  now += 49 * 60 * 1000;
  await c.send("b", "production", MSG);
  now += 2 * 60 * 1000;
  await c.send("c", "production", MSG);
  assertEquals(calls[0].headers.authorization, calls[1].headers.authorization);
  assert(calls[2].headers.authorization !== calls[0].headers.authorization, "re-minted after 50 min");
});

Deno.test("a 403 drops the cached provider token so the next send re-mints", async () => {
  let now = 1_800_000_000_000;
  const { c, calls } = await client([{ status: 403, body: { reason: "ExpiredProviderToken" } }, { status: 200 }], () => now);
  const first = await c.send("a", "production", MSG);
  assertEquals(first, { ok: false, status: 403, reason: "ExpiredProviderToken", unregistered: false });
  now += 1000; // a new iat makes the new JWT observably different
  await c.send("a", "production", MSG);
  assert(calls[1].headers.authorization !== calls[0].headers.authorization, "token re-minted after 403");
});
