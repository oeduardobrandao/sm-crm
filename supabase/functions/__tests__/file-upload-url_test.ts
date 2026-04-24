import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createFileUploadUrlHandler } from "../file-upload-url/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>, opts?: { randomUUID?: () => string }) {
  return createFileUploadUrlHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signPutUrl: async (key, _mime) => `https://r2.example.com/put/${key}`,
    randomUUID: opts?.randomUUID ?? (() => "test-uuid-1234"),
  });
}

function authedRequest(body: unknown, token = "valid-jwt") {
  return new Request("https://example.test/file-upload-url", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupAuthAndProfile(db: ReturnType<typeof createSupabaseQueryMock>, contaId = "conta-1", userId = "user-1") {
  db.withAuth({ id: userId });
  db.queue("profiles", "select", { data: { conta_id: contaId }, error: null });
}

// ─── CORS & Method ──────────────────────────────────────────────

Deno.test("file-upload-url: OPTIONS returns 200 for CORS preflight", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-upload-url", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("file-upload-url: non-POST returns 405", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-upload-url", {
    method: "GET",
    headers: { Authorization: "Bearer token" },
  }));
  assertEquals(res.status, 405);
});

// ─── Auth ──────────────────────────────────────────────────────

Deno.test("file-upload-url: missing Authorization header returns 401", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-upload-url", { method: "POST" }));
  assertEquals(res.status, 401);
});

Deno.test("file-upload-url: invalid JWT returns 401", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth(null, { message: "invalid token" });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "test.png", mime_type: "image/png", size_bytes: 100 }));
  assertEquals(res.status, 401);
});

Deno.test("file-upload-url: missing profile returns 403", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "test.png", mime_type: "image/png", size_bytes: 100 }));
  assertEquals(res.status, 403);
});

// ─── Validation ──────────────────────────────────────────────────

Deno.test("file-upload-url: invalid JSON returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-upload-url", {
    method: "POST",
    headers: { Authorization: "Bearer valid-jwt" },
    body: "{bad json",
  }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "Invalid JSON");
});

Deno.test("file-upload-url: missing required fields returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "test.png" }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "Missing fields");
});

Deno.test("file-upload-url: size_bytes out of range returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  const handler = makeHandler(db);

  const resNeg = await handler(authedRequest({ filename: "f.png", mime_type: "image/png", size_bytes: -1 }));
  assertEquals(resNeg.status, 400);

  const db2 = createSupabaseQueryMock();
  setupAuthAndProfile(db2);
  const handler2 = makeHandler(db2);
  const resTooBig = await handler2(authedRequest({ filename: "f.mp4", mime_type: "video/mp4", size_bytes: 500 * 1024 * 1024, thumbnail: { mime_type: "image/png", size_bytes: 1000 } }));
  assertEquals(resTooBig.status, 400);
});

Deno.test("file-upload-url: video without thumbnail returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "vid.mp4", mime_type: "video/mp4", size_bytes: 1000 }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "video requires thumbnail");
});

Deno.test("file-upload-url: thumbnail with non-image mime returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({
    filename: "vid.mp4", mime_type: "video/mp4", size_bytes: 1000,
    thumbnail: { mime_type: "video/mp4", size_bytes: 500 },
  }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "thumbnail must be an image");
});

Deno.test("file-upload-url: thumbnail size out of range returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  const handler = makeHandler(db);
  const res = await handler(authedRequest({
    filename: "vid.mp4", mime_type: "video/mp4", size_bytes: 1000,
    thumbnail: { mime_type: "image/png", size_bytes: 20 * 1024 * 1024 },
  }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "thumbnail size out of range");
});

// ─── Folder ownership ──────────────────────────────────────────

Deno.test("file-upload-url: folder not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  db.queue("folders", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "f.png", mime_type: "image/png", size_bytes: 1000, folder_id: 99 }));
  assertEquals(res.status, 404);
});

Deno.test("file-upload-url: folder from different workspace returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  db.queue("folders", "select", { data: { conta_id: "other-workspace" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "f.png", mime_type: "image/png", size_bytes: 1000, folder_id: 99 }));
  assertEquals(res.status, 404);
});

// ─── Quota ──────────────────────────────────────────────────────

Deno.test("file-upload-url: quota exceeded returns 413", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  db.queue("workspaces", "select", {
    data: { storage_quota_bytes: 1000, storage_used_bytes: 900 },
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "f.png", mime_type: "image/png", size_bytes: 200 }));
  assertEquals(res.status, 413);
  const body = await readJson(res);
  assertEquals(body.error, "quota_exceeded");
});

// ─── Happy path ──────────────────────────────────────────────────

Deno.test("file-upload-url: image upload returns presigned URL and r2_key", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  db.queue("workspaces", "select", {
    data: { storage_quota_bytes: null, storage_used_bytes: 0 },
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "photo.png", mime_type: "image/png", size_bytes: 5000 }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.file_id, "test-uuid-1234");
  assertEquals(body.r2_key, "contas/conta-1/files/test-uuid-1234.png");
  assertEquals(body.upload_url, "https://r2.example.com/put/contas/conta-1/files/test-uuid-1234.png");
  assertEquals(body.kind, "image");
  assertEquals(body.thumbnail_upload_url, undefined);
  assertEquals(body.thumbnail_r2_key, undefined);
});

Deno.test("file-upload-url: video upload returns both file and thumbnail presigned URLs", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  db.queue("workspaces", "select", {
    data: { storage_quota_bytes: null, storage_used_bytes: 0 },
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({
    filename: "clip.mp4", mime_type: "video/mp4", size_bytes: 10000,
    thumbnail: { mime_type: "image/jpeg", size_bytes: 500 },
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.kind, "video");
  assertEquals(body.r2_key, "contas/conta-1/files/test-uuid-1234.mp4");
  assertEquals(body.thumbnail_r2_key, "contas/conta-1/files/test-uuid-1234.thumb.jpg");
  assertEquals(body.thumbnail_upload_url, "https://r2.example.com/put/contas/conta-1/files/test-uuid-1234.thumb.jpg");
});

Deno.test("file-upload-url: document upload classifies kind as document", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  db.queue("workspaces", "select", {
    data: { storage_quota_bytes: null, storage_used_bytes: 0 },
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "file.pdf", mime_type: "application/pdf", size_bytes: 2000 }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.kind, "document");
  assertEquals(body.r2_key, "contas/conta-1/files/test-uuid-1234.pdf");
});

Deno.test("file-upload-url: upload into a valid folder succeeds", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  db.queue("folders", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("workspaces", "select", {
    data: { storage_quota_bytes: null, storage_used_bytes: 0 },
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "f.png", mime_type: "image/png", size_bytes: 1000, folder_id: 5 }));
  assertEquals(res.status, 200);
});

Deno.test("file-upload-url: quota check passes when under limit", async () => {
  const db = createSupabaseQueryMock();
  setupAuthAndProfile(db);
  db.queue("workspaces", "select", {
    data: { storage_quota_bytes: 10000, storage_used_bytes: 5000 },
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(authedRequest({ filename: "f.png", mime_type: "image/png", size_bytes: 3000 }));
  assertEquals(res.status, 200);
});
