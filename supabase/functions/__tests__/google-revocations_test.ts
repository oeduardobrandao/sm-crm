// _shared/google-revocations.ts: the revocation queue processor extracted from google-integration
// (processRevocation), the cron-side retry loop and the RPC-data wrapper.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { encryptGoogleToken } from "../_shared/google.ts";
import {
  processRevocation,
  processUnlinkDecisionData,
  retryPendingRevocations,
} from "../_shared/google-revocations.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-google-encryption-key-32chr");

async function row(id: string, attempts = 0) {
  return {
    id,
    encrypted_token: await encryptGoogleToken(`token-${id}`, "refresh"),
    token_kind: "refresh",
    attempts,
  };
}

function revokeStub(ok: boolean) {
  const tokens: string[] = [];
  return {
    tokens,
    revoke: (token: string) => {
      tokens.push(token);
      return Promise.resolve(ok);
    },
  };
}

Deno.test("processRevocation: success revokes the decrypted token and deletes the row", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_revocations", "select", { data: await row("rev-1") });
  const stub = revokeStub(true);
  const out = await processRevocation(db as never, "rev-1", { revoke: stub.revoke });
  assertEquals(out, "revoked");
  assertEquals(stub.tokens, ["token-rev-1"]);
  const del = db.calls.find((c) => c.table === "google_revocations" && c.operation === "delete")!;
  assert(del.modifiers.some((m) => m.method === "eq" && m.args[0] === "id" && m.args[1] === "rev-1"));
});

Deno.test("processRevocation: failure bumps attempts, records last_error, keeps the row", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_revocations", "select", { data: await row("rev-2", 3) });
  const out = await processRevocation(db as never, "rev-2", { revoke: revokeStub(false).revoke });
  assertEquals(out, "failed");
  assertEquals(db.calls.filter((c) => c.operation === "delete").length, 0);
  const upd = db.calls.find((c) => c.table === "google_revocations" && c.operation === "update")!;
  const payload = upd.payload as Record<string, unknown>;
  assertEquals(payload.attempts, 4);
  assertEquals(payload.last_error, "revoke_failed");
});

Deno.test("processRevocation: an undecryptable token counts as a failure with decrypt_failed", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_revocations", "select", { data: { ...(await row("rev-3")), encrypted_token: "garbage" } });
  const stub = revokeStub(true);
  const out = await processRevocation(db as never, "rev-3", { revoke: stub.revoke });
  assertEquals(out, "failed");
  assertEquals(stub.tokens.length, 0);
  const upd = db.calls.find((c) => c.operation === "update")!;
  assertEquals((upd.payload as Record<string, unknown>).last_error, "decrypt_failed");
});

Deno.test("processRevocation: an unknown id returns missing and writes nothing", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_revocations", "select", { data: null });
  const stub = revokeStub(true);
  const out = await processRevocation(db as never, "nope", { revoke: stub.revoke });
  assertEquals(out, "missing");
  assertEquals(stub.tokens.length, 0);
  assertEquals(db.calls.filter((c) => c.operation !== "select").length, 0);
});

Deno.test("processRevocation: never throws (read error and thrown revoke both come back as failed)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_revocations", "select", { data: null, error: { message: "db down" } });
  assertEquals(await processRevocation(db as never, "x", { revoke: revokeStub(true).revoke }), "failed");

  const db2 = createSupabaseQueryMock();
  db2.queue("google_revocations", "select", { data: await row("rev-4") });
  const out = await processRevocation(db2 as never, "rev-4", {
    revoke: () => Promise.reject(new Error("boom")),
  });
  assertEquals(out, "failed");
});

Deno.test("processUnlinkDecisionData: reads the RPC shape (array or object) and only acts on should_revoke", async () => {
  const f1 = createSupabaseQueryMock();
  await processUnlinkDecisionData(f1 as never, [{ should_revoke: false, revocation_id: null }]);
  await processUnlinkDecisionData(f1 as never, null);
  await processUnlinkDecisionData(f1 as never, { should_revoke: true, revocation_id: null });
  assertEquals(f1.calls.length, 0);

  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((url: string | URL) => {
    urls.push(String(url));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    const db = createSupabaseQueryMock();
    db.queue("google_revocations", "select", { data: await row("rev-5") });
    await processUnlinkDecisionData(db as never, [{ should_revoke: true, revocation_id: "rev-5" }]);
    assertEquals(urls, ["https://oauth2.googleapis.com/revoke"]);
    assertEquals(db.calls.filter((c) => c.operation === "delete").length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("retryPendingRevocations: selects attempts < maxAttempts by created_at; counts revoked, failed and gaveUp", async () => {
  const db = createSupabaseQueryMock();
  // Listing, then one read per row inside processRevocation.
  db.queue(
    "google_revocations",
    "select",
    { data: [{ id: "a", attempts: 0 }, { id: "b", attempts: 2 }, { id: "c", attempts: 9 }] },
    { data: await row("a", 0) },
    { data: await row("b", 2) },
    { data: await row("c", 9) },
  );
  const calls: string[] = [];
  const revoke = (token: string) => {
    calls.push(token);
    return Promise.resolve(token === "token-a"); // a succeeds; b, c fail
  };
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
  let out;
  try {
    out = await retryPendingRevocations(db as never, { limit: 20, maxAttempts: 10, revoke });
  } finally {
    console.error = origError;
  }
  assertEquals(out, { revoked: 1, failed: 1, gaveUp: 1 });
  const list = db.calls[0];
  assert(list.modifiers.some((m) => m.method === "lt" && m.args[0] === "attempts" && m.args[1] === 10));
  assert(list.modifiers.some((m) => m.method === "order" && m.args[0] === "created_at"));
  assert(list.modifiers.some((m) => m.method === "limit" && m.args[0] === 20));
  assertEquals(errors.filter((e) => e.includes("c")).length >= 1, true, "one error line for the row that hit the cap");
  assertEquals(errors.length, 1);
});

Deno.test("retryPendingRevocations: defensively skips rows already at maxAttempts and counts them as gaveUp without a network call", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_revocations", "select", { data: [{ id: "z", attempts: 10 }] });
  const stub = revokeStub(true);
  const origError = console.error;
  console.error = () => {};
  let out;
  try {
    out = await retryPendingRevocations(db as never, { limit: 5, maxAttempts: 10, revoke: stub.revoke });
  } finally {
    console.error = origError;
  }
  assertEquals(out, { revoked: 0, failed: 0, gaveUp: 1 });
  assertEquals(stub.tokens.length, 0);
});

Deno.test("retryPendingRevocations: a list error returns zeros instead of throwing", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_revocations", "select", { data: null, error: { message: "down" } });
  const origError = console.error;
  console.error = () => {};
  try {
    assertEquals(await retryPendingRevocations(db as never, { limit: 5, maxAttempts: 10 }), {
      revoked: 0,
      failed: 0,
      gaveUp: 0,
    });
  } finally {
    console.error = origError;
  }
});

Deno.test("retryPendingRevocations: gaveUp is counted and logged only when the attempts write succeeded", async () => {
  const db = createSupabaseQueryMock();
  db.queue(
    "google_revocations",
    "select",
    { data: [{ id: "c", attempts: 9 }] },
    { data: await row("c", 9) },
  );
  db.queue("google_revocations", "update", { error: { message: "db down" } });
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
  let out;
  try {
    out = await retryPendingRevocations(db as never, { limit: 5, maxAttempts: 10, revoke: revokeStub(false).revoke });
  } finally {
    console.error = origError;
  }
  assertEquals(out, { revoked: 0, failed: 1, gaveUp: 0 });
  assert(!errors.some((e) => e.includes("gave up")), "no give-up line while the bump is unsaved");
});
