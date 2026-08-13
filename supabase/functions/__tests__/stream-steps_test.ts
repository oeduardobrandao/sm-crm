// stream-steps — DI-factory tests against the shared supabaseMock (mirrors stream-webhook_test.ts's
// convention). The mock's query builder records modifiers but never actually applies them, so the
// age-gate assertions below rely on stream-steps.ts's own JS-side created_at/created re-check —
// see the comment at the top of stream-steps.ts for why that re-check exists.
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { REAP_PAGE_SIZE, runStreamSweeps } from "../post-media-cleanup-cron/stream-steps.ts";
import type { StreamStepsDeps } from "../post-media-cleanup-cron/stream-steps.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function unreachable(label: string) {
  return () => {
    throw new Error(`must not be called: ${label}`);
  };
}

const NOW = new Date("2026-08-13T12:00:00.000Z").getTime();
function minutesAgoIso(minutes: number): string {
  return new Date(NOW - minutes * 60 * 1000).toISOString();
}
function hoursAgoIso(hours: number): string {
  return new Date(NOW - hours * 60 * 60 * 1000).toISOString();
}

function baseDeps(db: Db, overrides: Partial<StreamStepsDeps> = {}): StreamStepsDeps {
  return {
    db: db as never,
    deleteStreamVideo: (unreachable("deleteStreamVideo") as unknown) as StreamStepsDeps["deleteStreamVideo"],
    listStreamVideos: (unreachable("listStreamVideos") as unknown) as StreamStepsDeps["listStreamVideos"],
    nowMs: () => NOW,
    ...overrides,
  };
}

// ── ingest catch-up ──────────────────────────────────────────────────────────

Deno.test("stream-steps: ingest catch-up copies a 15-minute-old video and saves the uid, but skips a 5-minute-old one in the same batch", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", {
    data: [
      { id: 1, r2_key: "contas/a/videos/old.mp4", conta_id: "conta-1", created_at: minutesAgoIso(15) },
      { id: 2, r2_key: "contas/a/videos/young.mp4", conta_id: "conta-1", created_at: minutesAgoIso(5) },
    ],
  });
  db.queue("files", "update", { data: null, error: null }); // id:1 stream_status=pending
  db.queue("files", "update", { data: null, error: null }); // id:1 stream_uid=uid
  db.queue("files", "select", { data: [] }); // reap: files.stream_uid known set
  db.queue("file_deletions", "select", { data: [] }); // reap: queued set

  const copyCalls: Array<{ sourceUrl: string; meta: Record<string, string> }> = [];
  const result = await runStreamSweeps(baseDeps(db, {
    copyToStream: async (sourceUrl, meta) => {
      copyCalls.push({ sourceUrl, meta });
      return "new-stream-uid";
    },
    signSourceUrl: async (r2Key) => `https://signed.example/${r2Key}`,
    listStreamVideos: async () => [],
    deleteStreamVideo: unreachable("deleteStreamVideo") as unknown as StreamStepsDeps["deleteStreamVideo"],
  }));

  assertEquals(result.ingested, 1);
  assertEquals(result.errors, 0);
  assertEquals(copyCalls.length, 1, "only the 15-minute-old row should be copied");
  assertEquals(copyCalls[0].sourceUrl, "https://signed.example/contas/a/videos/old.mp4");
  assertEquals(copyCalls[0].meta, { file_id: "1", conta_id: "conta-1" });

  const updates = callsFor(db, "files", "update");
  assertEquals(updates.length, 2, "pending flip + uid save, both for row 1 only");
  assertEquals(updates[0].payload, { stream_status: "pending" });
  assertEquals(updates[0].modifiers, [{ method: "eq", args: ["id", 1] }]);
  assertEquals(updates[1].payload, { stream_uid: "new-stream-uid" });
  assertEquals(updates[1].modifiers, [{ method: "eq", args: ["id", 1] }]);
});

Deno.test("stream-steps: ingest and settle are both skipped when copyToStream is absent (kill-switch mode), reap still runs", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: [] }); // reap: files.stream_uid known set
  db.queue("file_deletions", "select", { data: [] }); // reap: queued set

  const deleted: string[] = [];
  const result = await runStreamSweeps(baseDeps(db, {
    // copyToStream / signSourceUrl / getStreamVideoStatus all omitted — the "cleanup only" trio absence.
    listStreamVideos: async () => [{ uid: "orphan-old", created: hoursAgoIso(2) }],
    deleteStreamVideo: async (uid) => {
      deleted.push(uid);
    },
  }));

  assertEquals(result.ingested, 0);
  assertEquals(result.settled, 0);
  assertEquals(result.reaped, 1);
  assertEquals(result.errors, 0);
  assertEquals(deleted, ["orphan-old"]);

  // No ingest/settle-shaped select should have run against files — only reap's known-set page.
  const fileSelects = callsFor(db, "files", "select");
  assertEquals(fileSelects.length, 1);
  assertEquals(fileSelects[0].selectArgs, [["id, stream_uid"]]);
});

// ── settle pending ───────────────────────────────────────────────────────────

Deno.test("stream-steps: settle flips a ready video to stream_status=ready and leaves an inprogress one untouched", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: [] }); // ingest: none due
  db.queue("files", "select", {
    data: [
      { id: 10, stream_uid: "uid-ready", created_at: hoursAgoIso(2) },
      { id: 11, stream_uid: "uid-inprogress", created_at: hoursAgoIso(2) },
    ],
  }); // settle candidates
  db.queue("files", "update", { data: null, error: null }); // id:10 -> ready
  db.queue("files", "select", { data: [] }); // reap: files known set
  db.queue("file_deletions", "select", { data: [] }); // reap: queued set

  const statusCalls: string[] = [];
  const result = await runStreamSweeps(baseDeps(db, {
    copyToStream: unreachable("copyToStream") as unknown as StreamStepsDeps["copyToStream"],
    signSourceUrl: unreachable("signSourceUrl") as unknown as StreamStepsDeps["signSourceUrl"],
    getStreamVideoStatus: async (uid) => {
      statusCalls.push(uid);
      return uid === "uid-ready" ? "ready" : "inprogress";
    },
    listStreamVideos: async () => [],
  }));

  assertEquals(result.settled, 1);
  assertEquals(result.errors, 0);
  assertEquals(statusCalls, ["uid-ready", "uid-inprogress"], "both candidates are checked");

  const updates = callsFor(db, "files", "update");
  assertEquals(updates.length, 1, "the inprogress row must not be updated");
  assertEquals(updates[0].payload, { stream_status: "ready" });
  assertEquals(updates[0].modifiers, [{ method: "eq", args: ["id", 10] }]);
});

Deno.test("stream-steps: settle maps a terminal error state to stream_status=error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: [] }); // ingest: none due
  db.queue("files", "select", { data: [{ id: 20, stream_uid: "uid-error", created_at: hoursAgoIso(2) }] });
  db.queue("files", "update", { data: null, error: null });
  db.queue("files", "select", { data: [] }); // reap known set
  db.queue("file_deletions", "select", { data: [] });

  const result = await runStreamSweeps(baseDeps(db, {
    // Present-but-unreachable: keeps ingest's dep-gate satisfied so it actually issues its
    // (empty) select and consumes the "ingest: none due" queue slot above, same as the
    // "settle flips..." test — otherwise that slot would be consumed by settle's select instead.
    copyToStream: unreachable("copyToStream") as unknown as StreamStepsDeps["copyToStream"],
    signSourceUrl: unreachable("signSourceUrl") as unknown as StreamStepsDeps["signSourceUrl"],
    getStreamVideoStatus: async () => "error",
    listStreamVideos: async () => [],
  }));

  assertEquals(result.settled, 1);
  const updates = callsFor(db, "files", "update");
  assertEquals(updates[0].payload, { stream_status: "error" });
});

Deno.test("stream-steps: settle does not credit a row when the status-settling write resolves with an error, and the loop continues", async () => {
  // supabase-js update() RESOLVES with { error } instead of throwing -- an unchecked
  // failure here used to still increment `settled` and log nothing, hiding a row that's
  // actually still stuck `pending` in the DB (it's retried next run either way, since
  // nothing here undoes anything -- the bug was purely the false credit + silent log).
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: [] }); // ingest: none due
  db.queue("files", "select", {
    data: [
      { id: 30, stream_uid: "uid-write-fails", created_at: hoursAgoIso(2) },
      { id: 31, stream_uid: "uid-write-ok", created_at: hoursAgoIso(2) },
    ],
  }); // settle candidates
  db.queue("files", "update", { data: null, error: { message: "connection reset" } }); // id:30 write FAILS
  db.queue("files", "update", { data: null, error: null }); // id:31 write ok
  db.queue("files", "select", { data: [] }); // reap known set
  db.queue("file_deletions", "select", { data: [] }); // reap queued set

  const result = await runStreamSweeps(baseDeps(db, {
    copyToStream: unreachable("copyToStream") as unknown as StreamStepsDeps["copyToStream"],
    signSourceUrl: unreachable("signSourceUrl") as unknown as StreamStepsDeps["signSourceUrl"],
    getStreamVideoStatus: async () => "ready",
    listStreamVideos: async () => [],
  }));

  assertEquals(result.settled, 1, "row 30's failed write must not be credited; row 31 still is");
  assertEquals(result.errors, 0, "a per-row failure is not a step failure");
  const updates = callsFor(db, "files", "update");
  assertEquals(updates.length, 2, "both rows were attempted despite row 30 failing");
});

// ── orphan reap ───────────────────────────────────────────────────────────────

Deno.test("stream-steps: reap deletes an unknown 2h-old uid but spares a known uid, a queued file_deletions uid, and a young 5-minute-old unknown uid", async () => {
  const db = createSupabaseQueryMock();
  // No copyToStream/signSourceUrl/getStreamVideoStatus below -> ingest and settle both skip
  // without querying the db at all, so reap's two selects are the only "files"/"file_deletions"
  // calls made — no placeholder slots needed for the skipped steps.
  db.queue("files", "select", { data: [{ stream_uid: "known-in-files" }] }); // reap known set
  db.queue("file_deletions", "select", { data: [{ stream_uid: "queued-for-delete" }] }); // reap queued set

  const deleted: string[] = [];
  const result = await runStreamSweeps(baseDeps(db, {
    listStreamVideos: async () => [
      { uid: "known-in-files", created: hoursAgoIso(3) },
      { uid: "queued-for-delete", created: hoursAgoIso(3) },
      { uid: "orphan-old", created: hoursAgoIso(2) },
      { uid: "orphan-young", created: minutesAgoIso(5) },
    ],
    deleteStreamVideo: async (uid) => {
      deleted.push(uid);
    },
  }));

  assertEquals(result.reaped, 1);
  assertEquals(result.errors, 0);
  assertEquals(deleted, ["orphan-old"]);
});

Deno.test("stream-steps: reap paginates the files known-set query past PostgREST's silent 1000-row cap, so a uid that only appears on the second page is still spared", async () => {
  const db = createSupabaseQueryMock();

  // PostgREST silently truncates any single response at 1000 rows regardless of `.limit()` —
  // page 1 here is exactly that boundary, so the pagination loop must fetch a second page to
  // see "known-only-on-page-2" at all. Before the fix, only page 1 was ever fetched: that uid
  // would never make it into `known`, and the reap below would have deleted a real, still-
  // referenced video.
  const page1 = Array.from({ length: REAP_PAGE_SIZE }, (_, i) => ({
    id: i + 1,
    stream_uid: `filler-uid-${i + 1}`,
  }));
  const page2 = [{ id: REAP_PAGE_SIZE + 1, stream_uid: "known-only-on-page-2" }];

  db.queue("files", "select", { data: page1 }); // reap known set, page 1 (full — must not be the last page fetched)
  db.queue("files", "select", { data: page2 }); // reap known set, page 2 (short — loop must stop here)
  db.queue("file_deletions", "select", { data: [] }); // reap queued set

  const deleted: string[] = [];
  const result = await runStreamSweeps(baseDeps(db, {
    listStreamVideos: async () => [
      { uid: "known-only-on-page-2", created: hoursAgoIso(2) }, // must be spared: known via page 2
      { uid: "genuinely-orphaned", created: hoursAgoIso(2) }, // must be reaped: known nowhere
    ],
    deleteStreamVideo: async (uid) => {
      deleted.push(uid);
    },
  }));

  assertEquals(result.reaped, 1);
  assertEquals(result.errors, 0);
  assertEquals(
    deleted,
    ["genuinely-orphaned"],
    "the uid that only appeared on page 2 must be spared, not deleted",
  );

  const fileSelects = callsFor(db, "files", "select");
  assertEquals(
    fileSelects.length,
    2,
    "the loop must stop right after the short second page — no spurious third page fetched",
  );

  const page1Gt = fileSelects[0].modifiers.find((m) => m.method === "gt");
  const page2Gt = fileSelects[1].modifiers.find((m) => m.method === "gt");
  assertEquals(page1Gt?.args, ["id", 0], "first page starts the id cursor at 0");
  assertEquals(
    page2Gt?.args,
    ["id", REAP_PAGE_SIZE],
    "second page's cursor is the last id of the full first page",
  );

  for (const call of fileSelects) {
    const limitMod = call.modifiers.find((m) => m.method === "limit");
    assertEquals(limitMod?.args, [REAP_PAGE_SIZE], "every page is capped at REAP_PAGE_SIZE");
    const orderMod = call.modifiers.find((m) => m.method === "order");
    assertEquals(orderMod?.args, ["id", { ascending: true }]);
  }
});

// ── step isolation ───────────────────────────────────────────────────────────

Deno.test("stream-steps: a failing ingest select does not block settle or reap, and counts one error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", { data: null, error: { message: "connection reset" } }); // ingest fails
  db.queue("files", "select", { data: [] }); // settle: none due
  db.queue("files", "select", { data: [] }); // reap known set
  db.queue("file_deletions", "select", { data: [] }); // reap queued set

  const result = await runStreamSweeps(baseDeps(db, {
    copyToStream: unreachable("copyToStream") as unknown as StreamStepsDeps["copyToStream"],
    signSourceUrl: unreachable("signSourceUrl") as unknown as StreamStepsDeps["signSourceUrl"],
    getStreamVideoStatus: async () => "ready",
    listStreamVideos: async () => [],
  }));

  assertEquals(result.ingested, 0);
  assertEquals(result.settled, 0);
  assertEquals(result.reaped, 0);
  assertEquals(result.errors, 1);
});

Deno.test("stream-steps: a single bad row in ingest (copyToStream throws) does not stop the rest of the batch", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", {
    data: [
      { id: 1, r2_key: "contas/a/bad.mp4", conta_id: "conta-1", created_at: hoursAgoIso(1) },
      { id: 2, r2_key: "contas/a/good.mp4", conta_id: "conta-1", created_at: hoursAgoIso(1) },
    ],
  });
  db.queue("files", "update", { data: null, error: null }); // row 1 pending flip
  db.queue("files", "update", { data: null, error: null }); // row 2 pending flip
  db.queue("files", "update", { data: null, error: null }); // row 2 uid save
  db.queue("files", "select", { data: [] }); // reap known set
  db.queue("file_deletions", "select", { data: [] }); // reap queued set

  const result = await runStreamSweeps(baseDeps(db, {
    copyToStream: async (_url, meta) => {
      if (meta.file_id === "1") throw new Error("stream copy failed: 500");
      return "uid-2";
    },
    signSourceUrl: async (r2Key) => `https://signed.example/${r2Key}`,
    listStreamVideos: async () => [],
  }));

  assertEquals(result.ingested, 1, "row 2 still succeeds despite row 1 failing");
  assertEquals(result.errors, 0, "a per-row failure is not a step failure");
});

Deno.test("stream-steps: ingest row skips copyToStream when the pending-status write resolves with an error, and the loop continues to the next row", async () => {
  // supabase-js update() RESOLVES with { error } instead of throwing -- an unchecked
  // failure here used to let copyToStream run anyway, and the eventual stream_uid write
  // would leave the row with stream_uid set but stream_status still null: a state no
  // sweep (webhook/settle require stream_status='pending', this same catch-up sweep
  // requires stream_uid is null) can ever repair again.
  const db = createSupabaseQueryMock();
  db.queue("files", "select", {
    data: [
      { id: 1, r2_key: "contas/a/pending-fails.mp4", conta_id: "conta-1", created_at: hoursAgoIso(1) },
      { id: 2, r2_key: "contas/a/good.mp4", conta_id: "conta-1", created_at: hoursAgoIso(1) },
    ],
  });
  db.queue("files", "update", { data: null, error: { message: "connection reset" } }); // row 1 pending flip FAILS
  db.queue("files", "update", { data: null, error: null }); // row 2 pending flip
  db.queue("files", "update", { data: null, error: null }); // row 2 uid save
  db.queue("files", "select", { data: [] }); // reap known set
  db.queue("file_deletions", "select", { data: [] }); // reap queued set

  const copyCalls: string[] = [];
  const result = await runStreamSweeps(baseDeps(db, {
    copyToStream: async (_url, meta) => {
      copyCalls.push(meta.file_id);
      return `uid-${meta.file_id}`;
    },
    signSourceUrl: async (r2Key) => `https://signed.example/${r2Key}`,
    listStreamVideos: async () => [],
  }));

  assertEquals(copyCalls, ["2"], "row 1's failed pending-status write must not let copyToStream run for it");
  assertEquals(result.ingested, 1, "row 1 is not counted as ingested; row 2 still is");
  assertEquals(result.errors, 0, "a per-row failure is not a step failure");
});

Deno.test("stream-steps: ingest row is not counted as ingested when the uid-save write resolves with an error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "select", {
    data: [
      { id: 1, r2_key: "contas/a/uid-save-fails.mp4", conta_id: "conta-1", created_at: hoursAgoIso(1) },
    ],
  });
  db.queue("files", "update", { data: null, error: null }); // pending flip ok
  db.queue("files", "update", { data: null, error: { message: "connection reset" } }); // uid save FAILS
  db.queue("files", "select", { data: [] }); // reap known set
  db.queue("file_deletions", "select", { data: [] }); // reap queued set

  const result = await runStreamSweeps(baseDeps(db, {
    copyToStream: async () => "new-uid",
    signSourceUrl: async (r2Key) => `https://signed.example/${r2Key}`,
    listStreamVideos: async () => [],
  }));

  assertEquals(result.ingested, 0, "row must not be credited when the uid was never durably saved");
  assertEquals(result.errors, 0, "a per-row failure is not a step failure");
});
