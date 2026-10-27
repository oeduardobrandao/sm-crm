import { assert, assertEquals } from "./assert.ts";
import { getGoogleAccessToken, parseServiceAccount } from "../_shared/google-sa.ts";

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function makeKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const body = btoa(bin).replace(/(.{64})/g, "$1\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
  return { pair, pem };
}

Deno.test("getGoogleAccessToken signs an RS256 JWT and exchanges it", async () => {
  const { pair, pem } = await makeKey();
  const sa = { client_email: "bot@proj.iam.gserviceaccount.com", private_key: pem };
  const now = new Date("2026-10-27T12:00:00Z");
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fakeFetch = (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init;
    return Promise.resolve(new Response(JSON.stringify({ access_token: "tok-123", expires_in: 3600 }), { status: 200 }));
  };
  const token = await getGoogleAccessToken(sa, "https://www.googleapis.com/auth/webmasters.readonly", {
    fetch: fakeFetch as typeof fetch,
    now: () => now,
  });
  assertEquals(token, "tok-123");
  assertEquals(seenUrl, "https://oauth2.googleapis.com/token");
  assertEquals(seenInit?.method, "POST");
  assert(seenInit?.signal instanceof AbortSignal, "token request must carry a timeout signal");
  const form = new URLSearchParams(String(seenInit?.body));
  assertEquals(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const jwt = form.get("assertion")!;
  const [h, c, s] = jwt.split(".");
  assert(!jwt.includes("="), "base64url must be unpadded");
  const dec = new TextDecoder();
  assertEquals(JSON.parse(dec.decode(b64urlToBytes(h))), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(dec.decode(b64urlToBytes(c)));
  assertEquals(claims.iss, "bot@proj.iam.gserviceaccount.com");
  assertEquals(claims.scope, "https://www.googleapis.com/auth/webmasters.readonly");
  assertEquals(claims.aud, "https://oauth2.googleapis.com/token");
  assertEquals(claims.iat, Math.floor(now.getTime() / 1000));
  assertEquals(claims.exp - claims.iat, 3600);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    pair.publicKey,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${c}`),
  );
  assert(ok, "signature must verify with the public key");
});

Deno.test("getGoogleAccessToken honours a custom token_uri", async () => {
  const { pem } = await makeKey();
  let seenUrl = "";
  let aud = "";
  const fakeFetch = (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    const jwt = new URLSearchParams(String(init?.body)).get("assertion")!;
    aud = JSON.parse(new TextDecoder().decode(b64urlToBytes(jwt.split(".")[1]))).aud;
    return Promise.resolve(new Response(JSON.stringify({ access_token: "t" }), { status: 200 }));
  };
  await getGoogleAccessToken(
    { client_email: "a@b", private_key: pem, token_uri: "https://example.test/token" },
    "scope",
    { fetch: fakeFetch as typeof fetch },
  );
  assertEquals(seenUrl, "https://example.test/token");
  assertEquals(aud, "https://example.test/token");
});

Deno.test("getGoogleAccessToken failure never echoes the response body, key or JWT", async () => {
  const { pem } = await makeKey();
  const fakeFetch = () => Promise.resolve(new Response('{"error":"SECRET-BODY-MARKER"}', { status: 400 }));
  let msg = "";
  try {
    await getGoogleAccessToken({ client_email: "a@b", private_key: pem }, "scope", { fetch: fakeFetch as typeof fetch });
  } catch (e) {
    msg = (e as Error).message;
  }
  assertEquals(msg, "google token exchange failed: 400");
});

Deno.test("getGoogleAccessToken network error and bad body are generic", async () => {
  const { pem } = await makeKey();
  const sa = { client_email: "a@b", private_key: pem };
  const boom = () => Promise.reject(new Error("connect ECONNREFUSED https://secret.example"));
  let m1 = "";
  try {
    await getGoogleAccessToken(sa, "s", { fetch: boom as typeof fetch });
  } catch (e) {
    m1 = (e as Error).message;
  }
  assert(m1.startsWith("google token exchange failed"), m1);
  assert(!m1.includes("secret.example"), m1);

  const noToken = () => Promise.resolve(new Response('{"nope":1}', { status: 200 }));
  let m2 = "";
  try {
    await getGoogleAccessToken(sa, "s", { fetch: noToken as typeof fetch });
  } catch (e) {
    m2 = (e as Error).message;
  }
  assert(m2.startsWith("google token exchange failed"), m2);
});

Deno.test("getGoogleAccessToken with an unusable private key throws without echoing it", async () => {
  let msg = "";
  try {
    await getGoogleAccessToken(
      { client_email: "a@b", private_key: "-----BEGIN PRIVATE KEY-----\nTOP-SECRET-KEY\n-----END PRIVATE KEY-----" },
      "s",
      { fetch: (() => Promise.reject(new Error("must not be called"))) as typeof fetch },
    );
  } catch (e) {
    msg = (e as Error).message;
  }
  assert(msg.length > 0 && !msg.includes("TOP-SECRET-KEY"), msg);
});

Deno.test("getGoogleAccessToken imports a double-escaped PEM (literal backslash-n)", async () => {
  const { pem } = await makeKey();
  const escaped = pem.trimEnd().replace(/\n/g, "\\n");
  assert(escaped.includes("\\n") && !escaped.includes("\n"), "fixture must use literal backslash-n");
  const fakeFetch = () => Promise.resolve(new Response(JSON.stringify({ access_token: "ok" }), { status: 200 }));
  const token = await getGoogleAccessToken({ client_email: "a@b", private_key: escaped }, "s", {
    fetch: fakeFetch as typeof fetch,
  });
  assertEquals(token, "ok");
});

Deno.test("parseServiceAccount", () => {
  const sa = parseServiceAccount(
    JSON.stringify({ client_email: "a@b", private_key: "k", token_uri: "https://t", extra: "ignored" }),
  );
  assertEquals(sa, { client_email: "a@b", private_key: "k", token_uri: "https://t" });
  assertEquals(parseServiceAccount(JSON.stringify({ client_email: "a@b", private_key: "k" })), {
    client_email: "a@b",
    private_key: "k",
  });
  for (const bad of [
    JSON.stringify({ client_email: "a@b", private_key: "k", token_uri: "http://t.example/token" }),
    JSON.stringify({ client_email: "a@b", private_key: "k", token_uri: "not a url" }),
    JSON.stringify({ client_email: "a@b", private_key: "k", token_uri: 5 }),
    "{}", "not json", "null", "[]", JSON.stringify({ client_email: "a@b" }), JSON.stringify({ client_email: 1, private_key: "k" })]) {
    let msg = "";
    try {
      parseServiceAccount(bad);
    } catch (e) {
      msg = (e as Error).message;
    }
    assertEquals(msg, "invalid service account");
  }
});
