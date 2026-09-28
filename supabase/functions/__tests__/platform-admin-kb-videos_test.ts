import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import {
  handleCancelKbVideoUpload,
  handleCreateKbVideoUpload,
  handleDeleteKbVideoSeries,
  handleRefreshKbVideo,
  handleReorderKbVideos,
  handleUpsertKbVideo,
  type KbVideoStreamDeps,
} from "../platform-admin/kb-videos.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;
const H = { "Content-Type": "application/json" };
const NOW = new Date("2026-09-28T12:00:00.000Z").getTime();

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, series_id: "s1", title: "Primeiro acesso", slug: "primeiro-acesso", description: null,
    article_id: null, display_order: 10, status: "draft", stream_uid: null, stream_status: "pending",
    stream_upload_expires_at: null, duration_seconds: null, hls_url: null, thumbnail_url: null,
    created_at: "2026-09-28T10:00:00.000Z", updated_at: "2026-09-28T10:00:00.000Z",
    ...overrides,
  };
}

function fakeStream(overrides: Partial<KbVideoStreamDeps> = {}) {
  const deleted: string[] = [];
  const uploads: Array<{ maxDurationSeconds: number; expiry: string; meta: Record<string, string> }> = [];
  const deps: KbVideoStreamDeps = {
    enabled: () => true,
    createDirectUpload: async (opts) => {
      uploads.push(opts);
      return { uid: "new-uid", uploadURL: "https://upload.example/new" };
    },
    getVideo: () => Promise.reject(new Error("unexpected getVideo")),
    deleteVideo: async (uid) => {
      deleted.push(uid);
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, deleted, uploads };
}

Deno.test("create-kb-video-upload: persists uid + expiry before answering and deletes the replaced uid", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", { data: row({ stream_uid: "old-uid", stream_status: "ready", hls_url: "h" }) });
  db.queue("kb_videos", "update", { data: row({ stream_uid: "new-uid" }) });
  const { deps, deleted, uploads } = fakeStream();

  const res = await handleCreateKbVideoUpload(db as never, { video_id: 7 }, deps, H);

  assertEquals(res.status, 200);
  const body = await readJson(res) as { uploadURL: string };
  assertEquals(body.uploadURL, "https://upload.example/new");
  const expiry = new Date(NOW + 2 * 60 * 60 * 1000).toISOString();
  assertEquals(uploads, [{ maxDurationSeconds: 900, expiry, meta: { kind: "kb-video", video_id: "7" } }]);
  assertEquals(callsFor(db, "kb_videos", "update")[0].payload, {
    stream_uid: "new-uid",
    stream_status: "pending",
    stream_upload_expires_at: expiry,
    duration_seconds: null,
    hls_url: null,
    thumbnail_url: null,
  });
  assertEquals(deleted, ["old-uid"]);
});

Deno.test("create-kb-video-upload: 503 without Stream, and the new uid is released if the row write fails", async () => {
  const off = fakeStream({ enabled: () => false });
  const res = await handleCreateKbVideoUpload(createSupabaseQueryMock() as never, { video_id: 7 }, off.deps, H);
  assertEquals(res.status, 503);
  assertEquals((await readJson(res) as { error: string }).error, "stream_not_configured");

  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", { data: row() });
  db.queue("kb_videos", "update", { data: null, error: { message: "boom" } });
  const { deps, deleted } = fakeStream();
  let threw = false;
  try {
    await handleCreateKbVideoUpload(db as never, { video_id: 7 }, deps, H);
  } catch {
    threw = true;
  }
  assert(threw, "a failed row write must throw (generic 500 upstream)");
  assertEquals(deleted, ["new-uid"]);
});

Deno.test("upsert-kb-video: rejects Stream-owned columns from the client", async () => {
  const res = await handleUpsertKbVideo(
    createSupabaseQueryMock() as never,
    { title: "x", slug: "x", series_id: "s1", hls_url: "https://evil" },
    H,
  );
  assertEquals(res.status, 400);
});

Deno.test("upsert-kb-video: publishing a video that is not ready is refused", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", { data: row({ stream_status: "pending", stream_uid: "u1" }) });
  const res = await handleUpsertKbVideo(db as never, { video_id: 7, status: "published" }, H);
  assertEquals(res.status, 400);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);
});

Deno.test("upsert-kb-video: a related article must be published", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_video_series", "select", { data: { id: "s1" } });
  db.queue("kb_articles", "select", { data: { id: "a1", status: "draft" } });
  const res = await handleUpsertKbVideo(
    db as never,
    { title: "Primeiro acesso", slug: "primeiro-acesso", series_id: "s1", article_id: "a1" },
    H,
  );
  assertEquals(res.status, 400);
  assertEquals(callsFor(db, "kb_videos", "insert").length, 0);
});

Deno.test("upsert-kb-video: creates a draft video with only allowlisted columns", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_video_series", "select", { data: { id: "s1" } });
  db.queue("kb_videos", "insert", { data: row() });
  const res = await handleUpsertKbVideo(
    db as never,
    { action: "upsert-kb-video", title: " Primeiro acesso ", slug: "primeiro-acesso", series_id: "s1", display_order: 10 },
    H,
  );
  assertEquals(res.status, 201);
  assertEquals(callsFor(db, "kb_videos", "insert")[0].payload, {
    title: "Primeiro acesso",
    slug: "primeiro-acesso",
    series_id: "s1",
    display_order: 10,
  });
});

Deno.test("upsert-kb-video: duplicate slug is a 409", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_video_series", "select", { data: { id: "s1" } });
  db.queue("kb_videos", "insert", { data: null, error: { code: "23505", message: "dup" } });
  const res = await handleUpsertKbVideo(
    db as never,
    { title: "Primeiro acesso", slug: "primeiro-acesso", series_id: "s1" },
    H,
  );
  assertEquals(res.status, 409);
});

Deno.test("refresh-kb-video: an expired upload that never arrived is cleared and its uid released", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", {
    data: row({ stream_uid: "u1", stream_upload_expires_at: new Date(NOW - 60_000).toISOString() }),
  });
  db.queue("kb_videos", "update", { data: row({ stream_uid: null, stream_status: "error" }) });
  const { deps, deleted } = fakeStream({
    getVideo: async () => ({ state: "pendingupload", duration: null, hls: null, thumbnail: null }),
  });

  const res = await handleRefreshKbVideo(db as never, { video_id: 7 }, deps, H);

  assertEquals(res.status, 200);
  const upd = callsFor(db, "kb_videos", "update")[0];
  assertEquals(upd.payload, { stream_uid: null, stream_status: "error", stream_upload_expires_at: null });
  // The mock also records .maybeSingle() as a modifier; the guard is the three eq filters.
  assertEquals(upd.modifiers.filter((m) => m.method === "eq"), [
    { method: "eq", args: ["id", 7] },
    { method: "eq", args: ["stream_uid", "u1"] },
    { method: "eq", args: ["stream_status", "pending"] },
  ]);
  assertEquals(deleted, ["u1"]);
});

Deno.test("refresh-kb-video: an upload still within its window is left alone", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", {
    data: row({ stream_uid: "u1", stream_upload_expires_at: new Date(NOW + 60_000).toISOString() }),
  });
  const { deps, deleted } = fakeStream({
    getVideo: async () => ({ state: "pendingupload", duration: null, hls: null, thumbnail: null }),
  });

  const res = await handleRefreshKbVideo(db as never, { video_id: 7 }, deps, H);

  assertEquals(res.status, 200);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);
  assertEquals(deleted, []);
});

Deno.test("refresh-kb-video: a ready video is settled with its playback fields", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "select", { data: row({ stream_uid: "u1" }) });
  db.queue("kb_videos", "update", { data: row({ stream_uid: "u1", stream_status: "ready" }) });
  const { deps } = fakeStream({
    getVideo: async () => ({ state: "ready", duration: 58, hls: "https://h/u1.m3u8", thumbnail: "https://h/u1.jpg" }),
  });

  await handleRefreshKbVideo(db as never, { video_id: 7 }, deps, H);

  assertEquals(callsFor(db, "kb_videos", "update")[0].payload, {
    stream_status: "ready",
    duration_seconds: 58,
    hls_url: "https://h/u1.m3u8",
    thumbnail_url: "https://h/u1.jpg",
    stream_upload_expires_at: null,
  });
});

Deno.test("cancel-kb-video-upload: clears at once, but ignores a uid that is no longer current", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_videos", "update", { data: row({ stream_uid: null, stream_status: "error" }) });
  const { deps, deleted } = fakeStream();
  const res = await handleCancelKbVideoUpload(db as never, { video_id: 7, stream_uid: "u1" }, deps, H);
  assertEquals(res.status, 200);
  assertEquals(deleted, ["u1"]);

  const stale = createSupabaseQueryMock();
  stale.queue("kb_videos", "update", { data: null });
  stale.queue("kb_videos", "select", { data: row({ stream_uid: "newer" }) });
  const s = fakeStream();
  const res2 = await handleCancelKbVideoUpload(stale as never, { video_id: 7, stream_uid: "u1" }, s.deps, H);
  assertEquals(res2.status, 200);
  assertEquals(s.deleted, []);

  const bad = await handleCancelKbVideoUpload(createSupabaseQueryMock() as never, { video_id: 7 }, s.deps, H);
  assertEquals(bad.status, 400);
});

Deno.test("delete-kb-video-series: a series that still has videos is a 409", async () => {
  const db = createSupabaseQueryMock();
  db.queue("kb_video_series", "delete", { data: null, error: { code: "23503", message: "fk" } });
  const res = await handleDeleteKbVideoSeries(db as never, { series_id: "s1" }, H);
  assertEquals(res.status, 409);
});

Deno.test("reorder-kb-videos: validates every item before writing", async () => {
  const db = createSupabaseQueryMock();
  const bad = await handleReorderKbVideos(db as never, { items: [{ id: 1, display_order: 10 }, { id: "x", display_order: 20 }] }, H);
  assertEquals(bad.status, 400);
  assertEquals(callsFor(db, "kb_videos", "update").length, 0);

  const ok = await handleReorderKbVideos(db as never, { items: [{ id: 1, display_order: 20 }, { id: 2, display_order: 10 }] }, H);
  assertEquals(ok.status, 200);
  assertEquals(callsFor(db, "kb_videos", "update").map((c) => c.payload), [{ display_order: 20 }, { display_order: 10 }]);
});

Deno.test("platform-admin: every kb-video action is dispatched behind the admin gate", async () => {
  const src = await Deno.readTextFile(new URL("../platform-admin/index.ts", import.meta.url));
  const gate = src.indexOf("if (!admin)");
  assert(gate > 0, "admin gate not found");
  for (
    const action of [
      "list-kb-video-series", "upsert-kb-video-series", "delete-kb-video-series", "list-kb-videos",
      "get-kb-video", "upsert-kb-video", "delete-kb-video", "create-kb-video-upload",
      "refresh-kb-video", "cancel-kb-video-upload", "reorder-kb-videos",
    ]
  ) {
    const at = src.indexOf(`case "${action}":`);
    assert(at > gate, `${action} must be dispatched after the admin gate`);
  }
});
