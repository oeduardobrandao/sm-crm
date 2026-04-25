import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createPostMediaManageHandler } from "../post-media-manage/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createPostMediaManageHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signUrl: async (key) => `https://signed.example.com/${key}`,
    signPutUrl: async (key, _mime) => `https://r2.example.com/put/${key}`,
    randomUUID: () => "thumb-uuid",
  });
}

function setupAuth(db: ReturnType<typeof createSupabaseQueryMock>, contaId = "conta-1") {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: contaId }, error: null });
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { Authorization: "Bearer valid-jwt" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return new Request(`https://example.test/post-media-manage${path}`, init);
}

const sampleFile = {
  id: 10,
  r2_key: "contas/conta-1/files/img.png",
  thumbnail_r2_key: null,
  kind: "image",
  mime_type: "image/png",
  size_bytes: 5000,
  name: "img.png",
  width: 1080,
  height: 1080,
  duration_seconds: null,
  uploaded_by: "user-1",
  created_at: "2026-04-20T10:00:00.000Z",
  blur_data_url: null,
};

const sampleLink = {
  id: 1,
  post_id: 50,
  conta_id: "conta-1",
  is_cover: true,
  sort_order: 0,
  files: sampleFile,
};

// ─── CORS & Auth ──────────────────────────────────────────────

Deno.test("post-media-manage: OPTIONS returns 200", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/post-media-manage", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("post-media-manage: missing auth returns 401", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/post-media-manage", { method: "GET" }));
  assertEquals(res.status, 401);
});

Deno.test("post-media-manage: invalid JWT returns 401", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth(null, { message: "bad" });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "?post_id=50"));
  assertEquals(res.status, 401);
});

Deno.test("post-media-manage: missing profile returns 403", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "?post_id=50"));
  assertEquals(res.status, 403);
});

// ─── GET: covers by workflow_ids ──────────────────────────────

Deno.test("post-media-manage: GET with workflow_ids returns covers grouped by workflow", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", {
    data: [{ id: 50, workflow_id: 7, ordem: 0 }],
    error: null,
  });
  db.queue("post_file_links", "select", {
    data: [{ ...sampleLink }],
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "?workflow_ids=7"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.covers.length, 1);
  assertEquals(body.covers[0].workflow_id, 7);
  assertEquals(body.covers[0].media.length, 1);
  assertEquals(body.covers[0].media[0].url, "https://signed.example.com/contas/conta-1/files/img.png");
});

Deno.test("post-media-manage: GET with empty workflow_ids returns empty covers", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("GET", "?workflow_ids=abc"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.covers, []);
});

Deno.test("post-media-manage: GET with workflow_ids no posts returns empty covers", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", { data: [], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "?workflow_ids=7"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.covers, []);
});

// ─── GET: media by post_id ──────────────────────────────────

Deno.test("post-media-manage: GET with post_id returns media in legacy format", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "select", { data: [sampleLink], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "?post_id=50"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.media.length, 1);
  assertEquals(body.media[0].id, 1);
  assertEquals(body.media[0].original_filename, "img.png");
  assertEquals(body.media[0].is_cover, true);
});

Deno.test("post-media-manage: GET without post_id or workflow_ids returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("GET", ""));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "post_id required");
});

Deno.test("post-media-manage: GET with post from different workspace returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", { data: { conta_id: "other-ws" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "?post_id=50"));
  assertEquals(res.status, 404);
});

// ─── Non-GET: id validation ──────────────────────────────────

Deno.test("post-media-manage: PATCH without id returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "", { sort_order: 1 }));
  assertEquals(res.status, 400);
});

// ─── PATCH ──────────────────────────────────────────────────────

Deno.test("post-media-manage: PATCH with is_cover calls RPC and returns updated legacy record", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  // Fetch link
  db.queue("post_file_links", "select", { data: sampleLink, error: null });
  // RPC call
  db.queueRpc("post_file_link_set_cover", { data: true, error: null });
  // Re-fetch updated link
  db.queue("post_file_links", "select", { data: { ...sampleLink, is_cover: true }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/1", { is_cover: true }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.is_cover, true);
});

Deno.test("post-media-manage: PATCH set_cover RPC error returns 500", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: sampleLink, error: null });
  db.queueRpc("post_file_link_set_cover", { data: null, error: { message: "rpc fail" } });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/1", { is_cover: true }));
  assertEquals(res.status, 500);
});

Deno.test("post-media-manage: PATCH sort_order updates link", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: sampleLink, error: null });
  db.queue("post_file_links", "update", { data: null, error: null });
  // Re-fetch after update
  db.queue("post_file_links", "select", { data: { ...sampleLink, sort_order: 5 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/1", { sort_order: 5 }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.sort_order, 5);
});

Deno.test("post-media-manage: PATCH thumbnail_r2_key replaces old thumbnail", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const linkWithThumb = {
    ...sampleLink,
    files: { ...sampleFile, thumbnail_r2_key: "contas/conta-1/files/old-thumb.jpg" },
  };
  db.queue("post_file_links", "select", { data: linkWithThumb, error: null });
  db.queue("file_deletions", "insert", { data: null, error: null }); // old thumb deletion
  db.queue("files", "update", { data: null, error: null }); // new thumb update
  // Re-fetch updated
  const updatedLink = {
    ...sampleLink,
    files: { ...sampleFile, thumbnail_r2_key: "contas/conta-1/files/new-thumb.jpg" },
  };
  db.queue("post_file_links", "select", { data: updatedLink, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/1", { thumbnail_r2_key: "contas/conta-1/files/new-thumb.jpg" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.thumbnail_url, "https://signed.example.com/contas/conta-1/files/new-thumb.jpg");
});

Deno.test("post-media-manage: PATCH on link not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/999", { sort_order: 1 }));
  assertEquals(res.status, 404);
});

// ─── DELETE ──────────────────────────────────────────────────────

Deno.test("post-media-manage: DELETE removes a link", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: sampleLink, error: null });
  db.queue("post_file_links", "delete", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/1"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);
});

Deno.test("post-media-manage: DELETE DB error returns 500", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: sampleLink, error: null });
  db.queue("post_file_links", "delete", { data: null, error: { message: "constraint" } });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/1"));
  assertEquals(res.status, 500);
});

Deno.test("post-media-manage: DELETE on not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/999"));
  assertEquals(res.status, 404);
});

// ─── POST thumbnail ──────────────────────────────────────────────

Deno.test("post-media-manage: POST /id/thumbnail returns presigned URL for video", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const videoLink = {
    ...sampleLink,
    files: { ...sampleFile, kind: "video", mime_type: "video/mp4" },
  };
  db.queue("post_file_links", "select", { data: videoLink, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/1/thumbnail", { mime_type: "image/jpeg" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.thumbnail_r2_key, "contas/conta-1/files/thumb-uuid.thumb.jpg");
  assertEquals(body.thumbnail_upload_url, "https://r2.example.com/put/contas/conta-1/files/thumb-uuid.thumb.jpg");
});

Deno.test("post-media-manage: POST /id/thumbnail for non-video returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: sampleLink, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/1/thumbnail", { mime_type: "image/jpeg" }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "only videos have thumbnails");
});

Deno.test("post-media-manage: POST /id/thumbnail with unsupported mime returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const videoLink = {
    ...sampleLink,
    files: { ...sampleFile, kind: "video" },
  };
  db.queue("post_file_links", "select", { data: videoLink, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/1/thumbnail", { mime_type: "image/gif" }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "Unsupported thumbnail mime type");
});

// ─── Unsupported method ──────────────────────────────────────────

Deno.test("post-media-manage: PUT returns 405", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: sampleLink, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PUT", "/1", {}));
  assertEquals(res.status, 405);
});
