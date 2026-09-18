import { assert, assertEquals } from "./assert.ts";
// Imported from sign.ts, not index.ts: index.ts reads CRISP_IDENTITY_SECRET at
// module top level and throws if it is missing (required, no fallback -- see
// task-7-brief.md). No env var is set for the edge-function-tests CI job, so
// importing index.ts here would abort the whole `deno test` run on collection.
// sign.ts holds the pure, parameter-driven HMAC logic with no env access.
import { signEmail } from "../crisp-identity/sign.ts";
import { getOrCreateCrispToken } from "../crisp-identity/session.ts";

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

type UpsertCall = { table: string; values: unknown; options: unknown; columns: string };

/**
 * Fake of the ONE chain session.ts is allowed to use:
 *   from(table).upsert(values, options).select(columns).single()
 * Records every call so tests can assert the exact PostgREST shape, and
 * resolves `.single()` with whatever `result` the test provides (or rejects
 * with `throwWith`, standing in for a network/AbortSignal failure).
 */
function makeFakeDb(
  result: { data: unknown; error: { message: string } | null },
  throwWith?: Error,
) {
  const calls: UpsertCall[] = [];
  const db = {
    from: (table: string) => ({
      upsert: (values: unknown, options: unknown) => ({
        select: (columns: string) => ({
          single: () => {
            calls.push({ table, values, options, columns });
            if (throwWith) return Promise.reject(throwWith);
            return Promise.resolve(result);
          },
        }),
      }),
    }),
  };
  return { db, calls };
}

Deno.test("getOrCreateCrispToken returns the row's token via a user_id-keyed upsert", async () => {
  const { db, calls } = makeFakeDb({
    data: { token: "11111111-2222-4333-8444-555555555555" },
    error: null,
  });
  const token = await getOrCreateCrispToken(db, "user-1");
  assertEquals(token, "11111111-2222-4333-8444-555555555555");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, "crisp_sessions");
  assertEquals(calls[0].values, { user_id: "user-1" });
  assertEquals(calls[0].columns, "token");
});

Deno.test("getOrCreateCrispToken upserts on user_id and never sets ignoreDuplicates", async () => {
  // ignoreDuplicates: true compiles to ON CONFLICT DO NOTHING, which returns
  // no row on the conflicting call -- a second call for the same user would
  // then get null instead of the existing token. The option must stay at its
  // default (absent or false).
  const { db, calls } = makeFakeDb({ data: { token: "t" }, error: null });
  await getOrCreateCrispToken(db, "user-1");
  const options = calls[0].options as Record<string, unknown>;
  assertEquals(options.onConflict, "user_id");
  assert(
    !("ignoreDuplicates" in options) || options.ignoreDuplicates === false,
    "ignoreDuplicates must not be true",
  );
});

Deno.test("getOrCreateCrispToken returns null on a PostgREST error", async () => {
  const { db } = makeFakeDb({ data: null, error: { message: "relation does not exist" } });
  assertEquals(await getOrCreateCrispToken(db, "user-1"), null);
});

Deno.test("getOrCreateCrispToken returns null when the chain throws", async () => {
  const { db } = makeFakeDb({ data: null, error: null }, new Error("aborted"));
  assertEquals(await getOrCreateCrispToken(db, "user-1"), null);
});

Deno.test("getOrCreateCrispToken returns null when the row carries no string token", async () => {
  const { db: noRow } = makeFakeDb({ data: null, error: null });
  assertEquals(await getOrCreateCrispToken(noRow, "user-1"), null);
  const { db: emptyToken } = makeFakeDb({ data: { token: "" }, error: null });
  assertEquals(await getOrCreateCrispToken(emptyToken, "user-1"), null);
  const { db: wrongType } = makeFakeDb({ data: { token: 42 }, error: null });
  assertEquals(await getOrCreateCrispToken(wrongType, "user-1"), null);
});
