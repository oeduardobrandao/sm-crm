import { assertEquals } from "./assert.ts";
import { verifySvixSignature } from "../_shared/svix-verify.ts";

const KEY_BYTES = new Uint8Array(24).map((_, i) => i + 1);
const SECRET = "whsec_" + btoa(String.fromCharCode(...KEY_BYTES));
const ID = "msg_abc";
const NOW = 1_800_000_000;
const BODY = '{"type":"email.sent"}';

async function sign(id: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    KEY_BYTES,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)),
  );
  return btoa(String.fromCharCode(...mac));
}

function args(over: Record<string, unknown> = {}) {
  return { secret: SECRET, id: ID, timestamp: String(NOW), signature: "", body: BODY, nowSeconds: NOW, ...over };
}

Deno.test("accepts a valid signature", async () => {
  const sig = "v1," + await sign(ID, String(NOW), BODY);
  assertEquals(await verifySvixSignature(args({ signature: sig })), true);
});

Deno.test("accepts when the valid one is second of two", async () => {
  const good = "v1," + await sign(ID, String(NOW), BODY);
  assertEquals(await verifySvixSignature(args({ signature: `v1,AAAA ${good}` })), true);
});

Deno.test("rejects a tampered body", async () => {
  const sig = "v1," + await sign(ID, String(NOW), BODY);
  assertEquals(await verifySvixSignature(args({ signature: sig, body: BODY + " " })), false);
});

Deno.test("rejects timestamps 301s in the past and future, accepts 300s", async () => {
  for (const delta of [-301, 301]) {
    const ts = String(NOW + delta);
    const sig = "v1," + await sign(ID, ts, BODY);
    assertEquals(await verifySvixSignature(args({ signature: sig, timestamp: ts })), false);
  }
  const ts = String(NOW - 300);
  const sig = "v1," + await sign(ID, ts, BODY);
  assertEquals(await verifySvixSignature(args({ signature: sig, timestamp: ts })), true);
});

Deno.test("rejects missing headers", async () => {
  const sig = "v1," + await sign(ID, String(NOW), BODY);
  assertEquals(await verifySvixSignature(args({ signature: sig, id: null })), false);
  assertEquals(await verifySvixSignature(args({ signature: sig, timestamp: null })), false);
  assertEquals(await verifySvixSignature(args({ signature: null })), false);
});

Deno.test("rejects non-v1 version with the same signature", async () => {
  const sig = "v2," + await sign(ID, String(NOW), BODY);
  assertEquals(await verifySvixSignature(args({ signature: sig })), false);
});

Deno.test("rejects non-numeric timestamp", async () => {
  const sig = "v1," + await sign(ID, "abc", BODY);
  assertEquals(await verifySvixSignature(args({ signature: sig, timestamp: "abc" })), false);
});
