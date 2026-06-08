import { assert, assertEquals } from "./assert.ts";
import { computeSignature } from "../_shared/triage.ts";

Deno.test("computeSignature collapses volatile IDs to one signature+hash", () => {
  const a = computeSignature(
    "instagram-sync-cron",
    "Token expired for account 7f3a1c2b-1111-2222-3333-444455556666 at 2026-06-08T10:00:00Z (attempt 3)",
  );
  const b = computeSignature(
    "instagram-sync-cron",
    "Token expired for account 0a0a0a0a-9999-8888-7777-666655554444 at 2026-06-08T11:30:12Z (attempt 7)",
  );
  assertEquals(a.signature, b.signature);
  assertEquals(a.hash, b.hash);
});

Deno.test("computeSignature distinguishes genuinely different errors", () => {
  const a = computeSignature("instagram-sync-cron", "Token expired");
  const b = computeSignature("instagram-sync-cron", "Rate limit exceeded");
  assert(a.signature !== b.signature);
  assert(a.hash !== b.hash);
});

Deno.test("computeSignature hash is short and label-safe", () => {
  const { hash } = computeSignature("c", "some error 123");
  assert(/^[a-z0-9]+$/.test(hash), `hash not label-safe: ${hash}`);
  assert(hash.length <= 12, `hash too long: ${hash.length}`);
  assert(("cron-triage:" + hash).length <= 50);
});
