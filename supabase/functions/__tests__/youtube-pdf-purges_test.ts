// _shared/youtube-pdf-purges.ts: drains the youtube_pdf_purges queue (PDF objects of report
// snapshots whose YouTube data was purged) from the analytics-reports bucket.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { drainYoutubePdfPurges, type StorageLike } from "../_shared/youtube-pdf-purges.ts";

function storageStub(result: (path: string) => { error: { message: string } | null }) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const storage: StorageLike = {
    from: (bucket: string) => ({
      remove: (paths: string[]) => {
        removed.push({ bucket, paths });
        return Promise.resolve(result(paths[0]));
      },
    }),
  };
  return { storage, removed };
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const orig = console.error;
  const lines: string[] = [];
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.error = orig;
  }
};

Deno.test("drainYoutubePdfPurges: removes from analytics-reports and deletes the row on success", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", {
    data: [{ id: "p1", conta_id: "c1", client_id: 7, storage_path: "docs/c1/a.pdf", attempts: 0 }],
  });
  const { storage, removed } = storageStub(() => ({ error: null }));
  const out = await drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10 });
  assertEquals(out, { removed: 1, failed: 0, gaveUp: 0 });
  assertEquals(removed, [{ bucket: "analytics-reports", paths: ["docs/c1/a.pdf"] }]);
  const del = db.calls.find((c) => c.operation === "delete")!;
  assertEquals(del.table, "youtube_pdf_purges");
  assert(del.modifiers.some((m) => m.method === "eq" && m.args[0] === "id" && m.args[1] === "p1"));
  assert(del.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "c1"));
});

Deno.test("drainYoutubePdfPurges: filters the listing by conta_id when one is given, and orders by created_at", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", { data: [] });
  const { storage } = storageStub(() => ({ error: null }));
  await drainYoutubePdfPurges(db as never, { storage, contaId: "conta-9", limit: 5, maxAttempts: 10 });
  const list = db.calls[0];
  assert(list.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-9"));
  assert(list.modifiers.some((m) => m.method === "lt" && m.args[0] === "attempts" && m.args[1] === 10));
  assert(list.modifiers.some((m) => m.method === "order" && m.args[0] === "created_at"));
  assert(list.modifiers.some((m) => m.method === "limit" && m.args[0] === 5));

  const all = createSupabaseQueryMock();
  all.queue("youtube_pdf_purges", "select", { data: [] });
  await drainYoutubePdfPurges(all as never, { storage, limit: 5, maxAttempts: 10 });
  assertEquals(all.calls[0].modifiers.filter((m) => m.args[0] === "conta_id").length, 0);
});

Deno.test("drainYoutubePdfPurges: an absent object (remove resolves with no error and empty data) counts as success", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", {
    data: [{ id: "p1", conta_id: "c1", client_id: 7, storage_path: "gone.pdf", attempts: 4 }],
  });
  const storage: StorageLike = {
    from: () => ({ remove: () => Promise.resolve({ data: [], error: null } as never) }),
  };
  const out = await drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10 });
  assertEquals(out, { removed: 1, failed: 0, gaveUp: 0 });
  assertEquals(db.calls.filter((c) => c.operation === "delete").length, 1);
});

Deno.test("drainYoutubePdfPurges: any storage error is a failure, even one that reads like not found (Bucket not found, gateway 404)", async () => {
  for (const message of ["Bucket not found", "<html>404 Not Found</html>", "Object not found"]) {
    const db = createSupabaseQueryMock();
    db.queue("youtube_pdf_purges", "select", {
      data: [{ id: "p1", conta_id: "c1", client_id: 7, storage_path: "a.pdf", attempts: 0 }],
    });
    const { storage } = storageStub(() => ({ error: { message } }));
    const out = await drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10 });
    assertEquals(out, { removed: 0, failed: 1, gaveUp: 0 }, message);
    assertEquals(db.calls.filter((c) => c.operation === "delete").length, 0, message);
    const upd = db.calls.find((c) => c.operation === "update")!;
    assertEquals((upd.payload as Record<string, unknown>).attempts, 1);
  }
});

Deno.test("drainYoutubePdfPurges: a remove() that never resolves times out and counts as a failed attempt", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", {
    data: [{ id: "p1", conta_id: "c1", client_id: 7, storage_path: "hang.pdf", attempts: 1 }],
  });
  const storage: StorageLike = { from: () => ({ remove: () => new Promise(() => {}) }) };
  const out = await drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10, timeoutMs: 20 });
  assertEquals(out, { removed: 0, failed: 1, gaveUp: 0 });
  assertEquals(db.calls.filter((c) => c.operation === "delete").length, 0);
  const upd = db.calls.find((c) => c.operation === "update")!;
  assertEquals((upd.payload as Record<string, unknown>).attempts, 2);
});

Deno.test("drainYoutubePdfPurges: gaveUp is counted and logged only when the attempts write succeeded", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", {
    data: [{ id: "p1", conta_id: "c1", client_id: 7, storage_path: "a.pdf", attempts: 9 }],
  });
  db.queue("youtube_pdf_purges", "update", { error: { message: "db down" } });
  const { storage } = storageStub(() => ({ error: { message: "storage unavailable" } }));
  const { value, lines } = await quiet(() =>
    drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10 }),
  );
  assertEquals(value, { removed: 0, failed: 1, gaveUp: 0 });
  assert(!lines.some((l) => l.includes("gave up")), "no give-up line while the row can still be retried");
});

Deno.test("drainYoutubePdfPurges: a storage failure increments attempts (scoped by conta_id) and keeps the row", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", {
    data: [{ id: "p1", conta_id: "c1", client_id: 7, storage_path: "x.pdf", attempts: 2 }],
  });
  const { storage } = storageStub(() => ({ error: { message: "storage unavailable" } }));
  const out = await drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10 });
  assertEquals(out, { removed: 0, failed: 1, gaveUp: 0 });
  assertEquals(db.calls.filter((c) => c.operation === "delete").length, 0);
  const upd = db.calls.find((c) => c.operation === "update")!;
  assertEquals((upd.payload as Record<string, unknown>).attempts, 3);
  assert(upd.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "c1"));
});

Deno.test("drainYoutubePdfPurges: a thrown storage call is a failure; hitting maxAttempts logs once and counts gaveUp", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", {
    data: [
      { id: "p1", conta_id: "c1", client_id: 7, storage_path: "a.pdf", attempts: 9 },
      { id: "p2", conta_id: "c1", client_id: 7, storage_path: "b.pdf", attempts: 1 },
    ],
  });
  const storage: StorageLike = {
    from: () => ({ remove: () => Promise.reject(new Error("network")) }),
  };
  const { value, lines } = await quiet(() =>
    drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10 }),
  );
  assertEquals(value, { removed: 0, failed: 1, gaveUp: 1 });
  assertEquals(lines.length, 1);
  assert(lines[0].includes("p1"));
});

Deno.test("drainYoutubePdfPurges: rows already at maxAttempts are skipped without a storage call", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", {
    data: [{ id: "p1", conta_id: "c1", client_id: 7, storage_path: "a.pdf", attempts: 10 }],
  });
  const { storage, removed } = storageStub(() => ({ error: null }));
  const { value } = await quiet(() => drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10 }));
  assertEquals(value, { removed: 0, failed: 0, gaveUp: 1 });
  assertEquals(removed.length, 0);
});

Deno.test("drainYoutubePdfPurges: a list error returns zeros instead of throwing", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_pdf_purges", "select", { data: null, error: { message: "down" } });
  const { storage } = storageStub(() => ({ error: null }));
  const { value } = await quiet(() => drainYoutubePdfPurges(db as never, { storage, limit: 10, maxAttempts: 10 }));
  assertEquals(value, { removed: 0, failed: 0, gaveUp: 0 });
});
