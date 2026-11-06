import { assert, assertEquals } from "./assert.ts";
import { signSendNonce, verifySendNonce } from "../_shared/mcp-send-nonce.ts";

const SECRET = "test-secret-key-for-send-nonce-32chars!";
const P = { conta_id: "workspace-A", user_id: "user-1", post_id: 42 };
const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;

function b64urlDecode(s: string): string {
  const n = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(n + "=".repeat((4 - (n.length % 4)) % 4));
}

Deno.test("send nonce: round trip verifies; base64url without padding; exp in ms, 30 min", async () => {
  const nonce = await signSendNonce(SECRET, P, NOW);
  assert(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(nonce), `shape: ${nonce}`);
  const payload = JSON.parse(b64urlDecode(nonce.split(".")[0]));
  assertEquals(payload, { ...P, exp: NOW + 30 * MIN });
  assertEquals(await verifySendNonce(SECRET, nonce, P, NOW), true);
  assertEquals(await verifySendNonce(SECRET, nonce, P, NOW + 29 * MIN), true);
  assertEquals(await verifySendNonce(SECRET, nonce, P, NOW + 30 * MIN), true);
});

Deno.test("send nonce: another post, user or workspace -> false", async () => {
  const nonce = await signSendNonce(SECRET, P, NOW);
  assertEquals(await verifySendNonce(SECRET, nonce, { ...P, post_id: 43 }, NOW), false);
  assertEquals(await verifySendNonce(SECRET, nonce, { ...P, user_id: "user-2" }, NOW), false);
  assertEquals(await verifySendNonce(SECRET, nonce, { ...P, conta_id: "workspace-B" }, NOW), false);
});

Deno.test("send nonce: expired (now + 31 min) -> false", async () => {
  const nonce = await signSendNonce(SECRET, P, NOW);
  assertEquals(await verifySendNonce(SECRET, nonce, P, NOW + 31 * MIN), false);
  assertEquals(await verifySendNonce(SECRET, nonce, P, NOW + 30 * MIN + 1), false);
});

Deno.test("send nonce: another secret -> false", async () => {
  const nonce = await signSendNonce(SECRET, P, NOW);
  assertEquals(await verifySendNonce("another-secret-key-of-32-chars-plus!!", nonce, P, NOW), false);
});

Deno.test("send nonce: flipped payload byte or forged payload -> false", async () => {
  const nonce = await signSendNonce(SECRET, P, NOW);
  const [payload, mac] = nonce.split(".");
  const flipped = (payload[3] === "A" ? "B" : "A");
  const tampered = payload.slice(0, 3) + flipped + payload.slice(4);
  assertEquals(await verifySendNonce(SECRET, `${tampered}.${mac}`, P, NOW), false);
  // A payload re-signed for post 43 by someone without the key keeps the old MAC.
  const forged = btoa(JSON.stringify({ ...P, post_id: 43, exp: NOW + 30 * MIN }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(await verifySendNonce(SECRET, `${forged}.${mac}`, { ...P, post_id: 43 }, NOW), false);
  const macFlipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
  assertEquals(await verifySendNonce(SECRET, `${payload}.${macFlipped}`, P, NOW), false);
});

Deno.test("send nonce: garbage, missing dot, extra parts, bad JSON, non-numeric exp -> false", async () => {
  const nonce = await signSendNonce(SECRET, P, NOW);
  for (const bad of ["", "garbage", "a.b", "!!!.???", nonce.replace(".", ""), `${nonce}.x`, ".", `${nonce.split(".")[0]}.`]) {
    assertEquals(await verifySendNonce(SECRET, bad, P, NOW), false, `rejects ${JSON.stringify(bad)}`);
  }
  // Valid MAC over a payload that is not JSON / has a string exp: signed with the real key.
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("mcp-send-nonce") },
    await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), "HKDF", false, ["deriveKey"]),
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  const b64 = (s: string | Uint8Array) => {
    const bin = typeof s === "string" ? s : String.fromCharCode(...s);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const signed = async (payload: string) => {
    const p = b64(payload);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(p)));
    return `${p}.${b64(mac)}`;
  };
  // Sanity: the test's own signer matches the module (same derivation, MAC over the payload string).
  assertEquals(await verifySendNonce(SECRET, await signed(JSON.stringify({ ...P, exp: NOW + MIN })), P, NOW), true);
  assertEquals(await verifySendNonce(SECRET, await signed("not json"), P, NOW), false);
  assertEquals(await verifySendNonce(SECRET, await signed(JSON.stringify({ ...P, exp: String(NOW + MIN) })), P, NOW), false);
  assertEquals(await verifySendNonce(SECRET, await signed(JSON.stringify({ ...P, post_id: "42", exp: NOW + MIN })), P, NOW), false);
  assertEquals(await verifySendNonce(SECRET, await signed(JSON.stringify({ ...P })), P, NOW), false);
});
