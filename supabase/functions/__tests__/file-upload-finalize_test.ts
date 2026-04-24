import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createFileUploadFinalizeHandler } from "../file-upload-finalize/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts?: { headObject?: (key: string) => Promise<{ contentLength: number } | null> },
) {
  return createFileUploadFinalizeHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    headObject: opts?.headObject ?? (async () => ({ contentLength: 5000 })),
    signUrl: async (key) => `https://signed.example.com/${key}`,
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
  const res = await handler(authedRequest({ ...baseBody, kind: "document", post_id: 10 }));
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
  const insertedFile = { id: 10, r2_key: baseBody.r2_key, name: "photo.png", kind: "image" };
  db.queueRpc("file_insert_with_quota", { data: insertedFile, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest(baseBody));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.id, 10);
  assertEquals(body.url, `https://signed.example.com/${baseBody.r2_key}`);
  assertEquals(body.thumbnail_url, null);
  assertEquals(body.blur_data_url, null);
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
