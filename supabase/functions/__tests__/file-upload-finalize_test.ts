import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createFileUploadFinalizeHandler } from "../file-upload-finalize/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts?: {
    headObject?: (key: string) => Promise<{ contentLength: number } | null>;
    streamCopy?: (r2Key: string, meta: { file_id: string; conta_id: string }) => Promise<string>;
  },
) {
  return createFileUploadFinalizeHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    headObject: opts?.headObject ?? (async () => ({ contentLength: 5000 })),
    signUrl: async (key) => `https://signed.example.com/${key}`,
    streamCopy: opts?.streamCopy,
  });
}

function authedRequest(body: unknown, token = "valid-jwt") {
  return new Request("https://example.test/file-upload-finalize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupAuth(db: ReturnType<typeof createSupabaseQueryMock>, contaId = "conta-1", userId = "user-1") {
  db.withAuth({ id: userId });
  db.queue("profiles", "select", { data: { conta_id: contaId }, error: null });
}

const baseBody = {
  file_id: "abc-123",
  r2_key: "contas/conta-1/files/abc-123.png",
  kind: "image" as const,
  mime_type: "image/png",
  size_bytes: 5000,
  name: "photo.png",
};

// ─── CORS & Method ──────────────────────────────────────────────

Deno.test("file-upload-finalize: OPTIONS returns 200", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-upload-finalize", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("file-upload-finalize: non-POST returns 405", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-upload-finalize", {
    method: "GET",
    headers: { Authorization: "Bearer token" },
  }));
  assertEquals(res.status, 405);
});

// ─── Auth ──────────────────────────────────────────────────────

Deno.test("file-upload-finalize: missing auth returns 401", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-upload-finalize", { method: "POST" }));
  assertEquals(res.status, 401);
});

Deno.test("file-upload-finalize: invalid JWT returns 401", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth(null, { message: "invalid" });
  const handler = makeHandler(db);
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 401);
});

Deno.test("file-upload-finalize: missing profile returns 403", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 403);
});

// ─── Validation ──────────────────────────────────────────────────

Deno.test("file-upload-finalize: invalid JSON returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-upload-finalize", {
    method: "POST",
    headers: { Authorization: "Bearer valid-jwt" },
    body: "{bad",
  }));
  assertEquals(res.status, 400);
});

Deno.test("file-upload-finalize: r2_key not matching conta_id returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, r2_key: "contas/other/files/abc.png" }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "invalid r2_key");
});

Deno.test("file-upload-finalize: invalid thumbnail_r2_key prefix returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({
    ...baseBody,
    kind: "video",
    thumbnail_r2_key: "contas/other/files/thumb.jpg",
  }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "invalid thumbnail_r2_key");
});

Deno.test("file-upload-finalize: R2 object not found returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db, { headObject: async () => null });
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "object not found");
});

Deno.test("file-upload-finalize: size mismatch returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db, { headObject: async () => ({ contentLength: 9999 }) });
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "size mismatch");
});

Deno.test("file-upload-finalize: video without thumbnail_r2_key returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, kind: "video", mime_type: "video/mp4" }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "video requires thumbnail_r2_key");
});

Deno.test("file-upload-finalize: video thumbnail not found returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  let calls = 0;
  const handler = makeHandler(db, {
    headObject: async () => {
      calls++;
      if (calls === 1) return { contentLength: 5000 }; // main file OK
      return null; // thumbnail not found
    },
  });
  const res = await handler(authedRequest({
    ...baseBody,
    kind: "video",
    mime_type: "video/mp4",
    thumbnail_r2_key: "contas/conta-1/files/abc-123.thumb.jpg",
  }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "thumbnail not found");
});

Deno.test("file-upload-finalize: document with post_id returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, kind: "document", mime_type: "application/pdf", post_id: 10 }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "documents cannot be linked to posts");
});

Deno.test("file-upload-finalize: folder not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, folder_id: 42 }));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "Folder not found");
});

// ─── RPC errors ──────────────────────────────────────────────────

Deno.test("file-upload-finalize: RPC insert failure returns 500", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("file_insert_with_quota", { data: null, error: { message: "db error" } });
  const handler = makeHandler(db);
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 500);
  assertEquals(await readJson(res), { error: "Internal server error" });
});

Deno.test("file-upload-finalize: RPC quota_exceeded returns 413", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("file_insert_with_quota", { data: null, error: { message: "quota_exceeded" } });
  const handler = makeHandler(db);
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 413);
});

// ─── Happy paths ──────────────────────────────────────────────────

Deno.test("file-upload-finalize: image finalize returns signed file record", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const insertedFile = {
    id: 10,
    r2_key: baseBody.r2_key,
    name: "photo.png",
    kind: "image",
    // RPC result carries these (always null at this point in the flow, since Stream
    // ingest hasn't run yet) — the response must strip them regardless, same contract
    // as file-manage.
    stream_uid: null,
    stream_status: null,
  };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.id, 10);
  assertEquals(body.url, `https://signed.example.com/${baseBody.r2_key}`);
  assertEquals(body.thumbnail_url, null);
  assertEquals(body.blur_data_url, null);
  assert(!("stream_uid" in body), "stream_uid must not leak to the client");
  assert(!("stream_status" in body), "stream_status must not leak to the client");
});

Deno.test("file-upload-finalize: finalize with blur_data_url patches and returns it", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const insertedFile = { id: 11, r2_key: baseBody.r2_key, name: "photo.png", kind: "image" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  db.queue("files", "update", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, blur_data_url: "data:image/png;base64,abc" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.blur_data_url, "data:image/png;base64,abc");
});

Deno.test("file-upload-finalize: finalize with post_id creates link", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const insertedFile = { id: 12, r2_key: baseBody.r2_key, name: "photo.png", kind: "image" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "insert", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, post_id: 7 }));
  assertEquals(res.status, 200);
});

Deno.test("file-upload-finalize: post not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("file_insert_with_quota", { data: { id: 13 }, error: null });
  db.queue("workflow_posts", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, post_id: 7 }));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "Post not found");
});

Deno.test("file-upload-finalize: post from different workspace returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("file_insert_with_quota", { data: { id: 14 }, error: null });
  db.queue("workflow_posts", "select", { data: { conta_id: "other-ws" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, post_id: 7 }));
  assertEquals(res.status, 404);
});

Deno.test("file-upload-finalize: post_file_links insert error returns 500", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("file_insert_with_quota", { data: { id: 15 }, error: null });
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "insert", { data: null, error: { message: "constraint violation" } });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, post_id: 7 }));
  assertEquals(res.status, 500);
  assertEquals(await readJson(res), { error: "Internal server error" });
});

Deno.test("file-upload-finalize: video finalize with thumbnail returns both signed URLs", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const videoBody = {
    ...baseBody,
    kind: "video" as const,
    mime_type: "video/mp4",
    r2_key: "contas/conta-1/files/vid.mp4",
    thumbnail_r2_key: "contas/conta-1/files/vid.thumb.jpg",
  };
  const insertedFile = { id: 16, r2_key: videoBody.r2_key, name: "clip.mp4", kind: "video" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest(videoBody));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.url, `https://signed.example.com/${videoBody.r2_key}`);
  assertEquals(body.thumbnail_url, `https://signed.example.com/${videoBody.thumbnail_r2_key}`);
});

// ─── Security regression tests ────────────────────────────────

Deno.test("file-upload-finalize: rejects image kind with wrong MIME type", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, kind: "image", mime_type: "application/pdf" }));
  assertEquals(res.status, 415);
  const body = await readJson(res);
  assertEquals(body.error, "unsupported file type");
});

Deno.test("file-upload-finalize: rejects executable MIME type", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, kind: "image", mime_type: "application/x-elf" }));
  assertEquals(res.status, 415);
});

Deno.test("file-upload-finalize: rejects content-type mismatch from R2", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db, {
    headObject: async () => ({ contentLength: 5000, contentType: "image/gif" }),
  });
  const res = await handler(authedRequest(baseBody)); // baseBody has mime_type: "image/png"
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "content-type mismatch");
});

Deno.test("file-upload-finalize: cross-tenant post_id returns 404 without consuming quota", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: null, error: null }); // no post folder
  db.queue("workflow_posts", "select", { data: { conta_id: "other-ws" }, error: null }); // wrong workspace
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, post_id: 99 }));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "Post not found");
  const rpcCalls = db.calls.filter((c) => c.table === "rpc:file_insert_with_quota");
  assertEquals(rpcCalls.length, 0);
});

Deno.test("file-upload-finalize: valid post_id triggers insert and link creation", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 7 }, error: null }); // post folder found
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null }); // same workspace
  db.queueRpc("file_insert_with_quota", { data: { id: 42 }, error: null });
  db.queue("post_file_links", "insert", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, post_id: 10 }));
  assertEquals(res.status, 200);
  const rpcCalls = db.calls.filter((c) => c.table === "rpc:file_insert_with_quota");
  assertEquals(rpcCalls.length, 1);
  const linkCalls = db.calls.filter((c) => c.table === "post_file_links" && c.operation === "insert");
  assertEquals(linkCalls.length, 1);
  // No sort_order supplied -> omitted so the DB default (0) applies.
  assertEquals((linkCalls[0].payload as { sort_order?: number }).sort_order, undefined);
});

Deno.test("file-upload-finalize: forwards sort_order to the post_file_links insert", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 7 }, error: null });
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queueRpc("file_insert_with_quota", { data: { id: 43 }, error: null });
  db.queue("post_file_links", "insert", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ ...baseBody, post_id: 10, sort_order: 4 }));
  assertEquals(res.status, 200);
  const linkCalls = db.calls.filter((c) => c.table === "post_file_links" && c.operation === "insert");
  assertEquals(linkCalls.length, 1);
  assertEquals((linkCalls[0].payload as { sort_order?: number }).sort_order, 4);
});

// ─── Stream ingest (video finalize) ────────────────────────────

Deno.test("file-upload-finalize: video finalize with streamCopy set kicks off Stream ingest", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const videoBody = {
    ...baseBody,
    kind: "video" as const,
    mime_type: "video/mp4",
    r2_key: "contas/conta-1/files/vid-stream.mp4",
    thumbnail_r2_key: "contas/conta-1/files/vid-stream.thumb.jpg",
  };
  const insertedFile = { id: 20, r2_key: videoBody.r2_key, name: "clip.mp4", kind: "video" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  db.queue("files", "update", { data: null, error: null }); // pending
  db.queue("files", "update", { data: null, error: null }); // uid
  let streamCopyArgs: [string, { file_id: string; conta_id: string }] | null = null;
  const streamCopy = async (r2Key: string, meta: { file_id: string; conta_id: string }) => {
    streamCopyArgs = [r2Key, meta];
    return "stream-uid-123";
  };
  const handler = makeHandler(db, { streamCopy });
  const res = await handler(authedRequest(videoBody));
  assertEquals(res.status, 200);
  assertEquals(streamCopyArgs, [videoBody.r2_key, { file_id: "20", conta_id: "conta-1" }]);
  const updateCalls = db.calls.filter((c) => c.table === "files" && c.operation === "update");
  assertEquals(updateCalls.length, 2);
  assertEquals(updateCalls[0].payload, { stream_status: "pending" });
  assertEquals(updateCalls[1].payload, { stream_uid: "stream-uid-123" });
});

Deno.test("file-upload-finalize: video finalize with streamCopy rejecting still returns 200 without a uid update", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const videoBody = {
    ...baseBody,
    kind: "video" as const,
    mime_type: "video/mp4",
    r2_key: "contas/conta-1/files/vid-stream-fail.mp4",
    thumbnail_r2_key: "contas/conta-1/files/vid-stream-fail.thumb.jpg",
  };
  const insertedFile = { id: 21, r2_key: videoBody.r2_key, name: "clip2.mp4", kind: "video" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  db.queue("files", "update", { data: null, error: null }); // pending
  const streamCopy = async () => {
    throw new Error("stream copy failed");
  };
  const handler = makeHandler(db, { streamCopy });
  const res = await handler(authedRequest(videoBody));
  assertEquals(res.status, 200);
  const updateCalls = db.calls.filter((c) => c.table === "files" && c.operation === "update");
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0].payload, { stream_status: "pending" });
});

Deno.test("file-upload-finalize: video finalize skips streamCopy when the pending-status write resolves with an error", async () => {
  // supabase-js update() RESOLVES with { error } instead of throwing -- an unchecked
  // failure here used to let streamCopy run anyway, and the eventual stream_uid write
  // would leave the row with stream_uid set but stream_status still null: a state no
  // sweep (webhook/settle require stream_status='pending', catch-up requires stream_uid
  // is null) can ever repair. The pending-write error must be checked and thrown BEFORE
  // streamCopy is called.
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const videoBody = {
    ...baseBody,
    kind: "video" as const,
    mime_type: "video/mp4",
    r2_key: "contas/conta-1/files/vid-pending-fails.mp4",
    thumbnail_r2_key: "contas/conta-1/files/vid-pending-fails.thumb.jpg",
  };
  const insertedFile = { id: 24, r2_key: videoBody.r2_key, name: "clip4.mp4", kind: "video" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  db.queue("files", "update", { data: null, error: { message: "connection reset" } }); // pending write FAILS
  let streamCopyCalled = false;
  const streamCopy = async () => {
    streamCopyCalled = true;
    return "stream-uid-should-not-be-saved";
  };
  const handler = makeHandler(db, { streamCopy });
  const res = await handler(authedRequest(videoBody));
  assertEquals(res.status, 200);
  assertEquals(streamCopyCalled, false, "streamCopy must not run once the pending write is known to have failed");
  const updateCalls = db.calls.filter((c) => c.table === "files" && c.operation === "update");
  assertEquals(updateCalls.length, 1, "only the failed pending-status attempt -- no uid write follows");
});

Deno.test("file-upload-finalize: video finalize does not credit the uid write when it resolves with an error", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const videoBody = {
    ...baseBody,
    kind: "video" as const,
    mime_type: "video/mp4",
    r2_key: "contas/conta-1/files/vid-uid-save-fails.mp4",
    thumbnail_r2_key: "contas/conta-1/files/vid-uid-save-fails.thumb.jpg",
  };
  const insertedFile = { id: 25, r2_key: videoBody.r2_key, name: "clip5.mp4", kind: "video" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  db.queue("files", "update", { data: null, error: null }); // pending write ok
  db.queue("files", "update", { data: null, error: { message: "connection reset" } }); // uid write FAILS
  const streamCopy = async () => "stream-uid-never-persisted";
  const handler = makeHandler(db, { streamCopy });
  const res = await handler(authedRequest(videoBody));
  assertEquals(res.status, 200);
  const updateCalls = db.calls.filter((c) => c.table === "files" && c.operation === "update");
  assertEquals(updateCalls.length, 2, "both writes were attempted");
  assertEquals(updateCalls[0].payload, { stream_status: "pending" });
  assertEquals(updateCalls[1].payload, { stream_uid: "stream-uid-never-persisted" });
  // Row is left with stream_status='pending' and no stream_uid recorded -- exactly the
  // repairable state the ingest catch-up sweep selects for, not an unrepairable
  // stream_uid-set/stream_status-null orphan.
});

Deno.test("file-upload-finalize: image finalize does not call streamCopy", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const insertedFile = { id: 22, r2_key: baseBody.r2_key, name: "photo.png", kind: "image" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  let called = false;
  const streamCopy = async () => {
    called = true;
    return "uid";
  };
  const handler = makeHandler(db, { streamCopy });
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 200);
  assertEquals(called, false);
  const updateCalls = db.calls.filter((c) => c.table === "files" && c.operation === "update");
  assertEquals(updateCalls.length, 0);
});

Deno.test("file-upload-finalize: video finalize without streamCopy dep leaves stream fields untouched", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const videoBody = {
    ...baseBody,
    kind: "video" as const,
    mime_type: "video/mp4",
    r2_key: "contas/conta-1/files/vid-no-stream.mp4",
    thumbnail_r2_key: "contas/conta-1/files/vid-no-stream.thumb.jpg",
  };
  const insertedFile = { id: 23, r2_key: videoBody.r2_key, name: "clip3.mp4", kind: "video" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  const handler = makeHandler(db); // no streamCopy opt -> deps.streamCopy stays undefined
  const res = await handler(authedRequest(videoBody));
  assertEquals(res.status, 200);
  const updateCalls = db.calls.filter((c) => c.table === "files" && c.operation === "update");
  assertEquals(updateCalls.length, 0);
});
