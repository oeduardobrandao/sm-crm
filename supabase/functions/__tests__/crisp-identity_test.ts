import { assert, assertEquals } from "./assert.ts";
// Imported from sign.ts, not index.ts: index.ts reads CRISP_IDENTITY_SECRET at
// module top level and throws if it is missing (required, no fallback -- see
// task-7-brief.md). No env var is set for the edge-function-tests CI job, so
// importing index.ts here would abort the whole `deno test` run on collection.
// sign.ts holds the pure, parameter-driven HMAC logic with no env access.
import { signEmail } from "../crisp-identity/sign.ts";

Deno.test("signEmail matches a known-answer HMAC-SHA256 vector", async () => {
  // Independently reproducible:
  //   printf 'ana@example.com' | openssl dgst -sha256 -hmac 'test-secret' -hex
  const sig = await signEmail("ana@example.com", "test-secret");
  assertEquals(sig, "37793c34fcf781813a1db62b9a30caca06e81a94daa9856be47f28f8870bc0d4");
  assertEquals(sig.length, 64);
  assert(/^[0-9a-f]+$/.test(sig), `expected lowercase hex, got ${sig}`);
});

Deno.test("signEmail is deterministic and email-specific", async () => {
  const a = await signEmail("ana@example.com", "s");
  const b = await signEmail("ana@example.com", "s");
  const c = await signEmail("bruno@example.com", "s");
  assertEquals(a, b);
  assert(a !== c, "different emails must not share a signature");
});
