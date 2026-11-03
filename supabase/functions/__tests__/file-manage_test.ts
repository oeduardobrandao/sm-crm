import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createFileManageHandler } from "../file-manage/handler.ts";
import { allClientsScope, type ClientScope } from "../_shared/client-scope.ts";
import { GATED_ROUTES } from "../file-manage/client-scope-gate.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(
  db: ReturnType<typeof createSupabaseQueryMock>,
  overrides: Partial<Parameters<typeof createFileManageHandler>[0]> = {},
) {
  return createFileManageHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signUrl: async (key) => `https://signed.example.com/${key}`,
    now: () => "2026-04-24T12:00:00.000Z",
    // Acesso por cliente: unrestricted unless a test overrides it.
    loadClientScope: () => Promise.resolve(allClientsScope()),
    ...overrides,
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
  return new Request(`https://example.test/file-manage${path}`, init);
}

// ─── CORS & Auth ──────────────────────────────────────────────

Deno.test("file-manage: OPTIONS returns 200", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-manage/folders", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("file-manage: missing auth returns 401", async () => {
  const db = createSupabaseQueryMock();
  const handler = makeHandler(db);
  const res = await handler(new Request("https://example.test/file-manage/folders", { method: "GET" }));
  assertEquals(res.status, 401);
});

Deno.test("file-manage: invalid JWT returns 401", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth(null, { message: "invalid" });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 401);
});

Deno.test("file-manage: missing profile returns 403", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 403);
});

// ─── Unknown resource ──────────────────────────────────────────

Deno.test("file-manage: unknown resource returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/unknown"));
  assertEquals(res.status, 404);
});

// ─── FOLDERS: GET ──────────────────────────────────────────────

Deno.test("file-manage: GET /folders lists root folders and files", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [{ id: 1, name: "Marketing" }], error: null });
  db.queue("files", "select", {
    data: [{ id: 10, name: "logo.png", kind: "image", r2_key: "contas/conta-1/files/logo.png", thumbnail_r2_key: null }],
    error: null,
  });
  // folder_sizes_batch RPC (replaces N+1 folder_total_size calls)
  db.queueRpc("folder_sizes_batch", { data: [{ folder_id: 1, total_size_bytes: 1024, file_count: 2 }], error: null });
  // has_children check for subfolders
  db.queue("folders", "select", { data: [], error: null });
  // workspace storage query
  db.queue("workspaces", "select", { data: { storage_used_bytes: 5000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.subfolders.length, 1);
  assertEquals(body.subfolders[0].total_size_bytes, 1024);
  assertEquals(body.subfolders[0].file_count, 2);
  assertEquals(body.subfolders[0].has_children, false);
  assertEquals(body.files.length, 1);
  assertEquals(body.files[0].url, "https://signed.example.com/contas/conta-1/files/logo.png");
  assertEquals(body.breadcrumbs, []);
  assertEquals(body.folder, null);
  assertEquals(body.storage.used_bytes, 5000);
  assertEquals(body.storage.quota_bytes, 1000000);
});

Deno.test("file-manage: GET /folders?parent_id builds breadcrumbs", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  // subfolders query
  db.queue("folders", "select", { data: [], error: null });
  // files query
  db.queue("files", "select", { data: [], error: null });
  // parent ownership check
  db.queue("folders", "select", { data: { id: 5, conta_id: "conta-1" }, error: null });
  // folder_breadcrumbs RPC (replaces while-loop selects)
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 1, name: "Root" }, { id: 5, name: "Sub" }], error: null });
  // folder detail
  db.queue("folders", "select", { data: { id: 5, name: "Sub" }, error: null });
  // workspace storage query
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders?parent_id=5"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.breadcrumbs.length, 2);
  assertEquals(body.breadcrumbs[0].name, "Root");
  assertEquals(body.breadcrumbs[1].name, "Sub");
  assertEquals(body.storage.used_bytes, 0);
});

Deno.test("file-manage: GET /folders signs documents as url:null", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", {
    data: [{ id: 20, name: "report.pdf", kind: "document", r2_key: "contas/conta-1/files/report.pdf", thumbnail_r2_key: null }],
    error: null,
  });
  // workspace storage query (no subfolders, so no RPC calls needed)
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.files[0].url, null);
});

Deno.test("file-manage: GET /folders omits signed URL for a permanently lost file", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", {
    data: [{
      id: 10,
      name: "lost.png",
      kind: "image",
      r2_key: "contas/conta-1/files/lost.png",
      thumbnail_r2_key: "contas/conta-1/files/lost.thumb.webp",
      media_lost_at: "2026-08-14T03:00:00.000Z",
    }],
    error: null,
  });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 5000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  let signCalls = 0;
  const handler = makeHandler(db, {
    signUrl: async (key) => {
      signCalls++;
      return `https://signed.example.com/${key}`;
    },
  });
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.files[0].url, null);
  assertEquals(body.files[0].thumbnail_url, null);
  assertEquals(body.files[0].media_lost_at, "2026-08-14T03:00:00.000Z");
  assertEquals(signCalls, 0);
});

Deno.test("file-manage: GET /links omits signed URL for a permanently lost file", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", {
    data: [{
      id: 1,
      post_id: 50,
      conta_id: "conta-1",
      is_cover: true,
      sort_order: 0,
      files: {
        id: 10,
        name: "lost.png",
        kind: "image",
        r2_key: "contas/conta-1/files/lost.png",
        thumbnail_r2_key: null,
        media_lost_at: "2026-08-14T03:00:00.000Z",
      },
    }],
    error: null,
  });
  let signCalls = 0;
  const handler = makeHandler(db, {
    signUrl: async (key) => {
      signCalls++;
      return `https://signed.example.com/${key}`;
    },
  });
  const res = await handler(req("GET", "/links?post_id=50"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.links[0].files.url, null);
  assertEquals(body.links[0].files.media_lost_at, "2026-08-14T03:00:00.000Z");
  assertEquals(signCalls, 0);
});

// ─── FOLDERS: GET playback (Cloudflare Stream) ─────────────────

Deno.test("file-manage: GET /folders includes signed playback for a ready streamed video and strips stream_* keys", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", {
    data: [{
      id: 30,
      name: "clip.mp4",
      kind: "video",
      r2_key: "contas/conta-1/files/clip.mp4",
      thumbnail_r2_key: null,
      stream_uid: "stream-uid-1",
      stream_status: "ready",
    }],
    error: null,
  });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const handler = makeHandler(db, {
    signPlayback: async (uid) => ({ hls: `https://stream.example.com/${uid}.m3u8`, expires_at: "2026-04-24T13:00:00.000Z" }),
  });
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.files[0].playback, {
    hls: "https://stream.example.com/stream-uid-1.m3u8",
    expires_at: "2026-04-24T13:00:00.000Z",
  });
  assert(!("stream_uid" in body.files[0]), "stream_uid must not leak to the client");
  assert(!("stream_status" in body.files[0]), "stream_status must not leak to the client");
});

Deno.test("file-manage: GET /folders returns playback: null for a pending streamed video", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", {
    data: [{
      id: 31,
      name: "clip2.mp4",
      kind: "video",
      r2_key: "contas/conta-1/files/clip2.mp4",
      thumbnail_r2_key: null,
      stream_uid: "stream-uid-2",
      stream_status: "pending",
    }],
    error: null,
  });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const handler = makeHandler(db, {
    signPlayback: async (uid) => ({ hls: `https://stream.example.com/${uid}.m3u8`, expires_at: "2026-04-24T13:00:00.000Z" }),
  });
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.files[0].playback, null);
  assert(!("stream_uid" in body.files[0]), "stream_uid must not leak to the client");
  assert(!("stream_status" in body.files[0]), "stream_status must not leak to the client");
});

Deno.test("file-manage: GET /folders returns playback: null when signPlayback is not configured (Stream disabled)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", {
    data: [{
      id: 32,
      name: "clip3.mp4",
      kind: "video",
      r2_key: "contas/conta-1/files/clip3.mp4",
      thumbnail_r2_key: null,
      stream_uid: "stream-uid-3",
      stream_status: "ready",
    }],
    error: null,
  });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const handler = makeHandler(db); // no signPlayback dep
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.files[0].playback, null);
  assert(!("stream_uid" in body.files[0]), "stream_uid must not leak to the client");
});

// ─── FOLDERS: POST ──────────────────────────────────────────────

Deno.test("file-manage: POST /folders creates a folder", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "insert", { data: { id: 2, name: "New Folder", conta_id: "conta-1" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/folders", { name: "New Folder" }));
  assertEquals(res.status, 201);
  const body = await readJson(res);
  assertEquals(body.name, "New Folder");
});

Deno.test("file-manage: POST /folders without name returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/folders", {}));
  assertEquals(res.status, 400);
});

Deno.test("file-manage: POST /folders with invalid parent returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/folders", { name: "Child", parent_id: 999 }));
  assertEquals(res.status, 404);
});

Deno.test("file-manage: POST /folders DB error returns 500", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "insert", { data: null, error: { message: "unique constraint" } });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/folders", { name: "Dup" }));
  assertEquals(res.status, 500);
  assertEquals(await readJson(res), { error: "Internal server error" });
});

// ─── FOLDERS: PATCH ──────────────────────────────────────────────

Deno.test("file-manage: PATCH /folders/:id renames a user folder", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 3, conta_id: "conta-1", source: "user" }, error: null });
  db.queue("folders", "update", { data: { id: 3, name: "Renamed" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/folders/3", { name: "Renamed" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.name, "Renamed");
});

Deno.test("file-manage: PATCH /folders/:id on system folder sets name_overridden", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 4, conta_id: "conta-1", source: "system" }, error: null });
  db.queue("folders", "update", { data: { id: 4, name: "Custom Name", name_overridden: true }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/folders/4", { name: "Custom Name" }));
  assertEquals(res.status, 200);
  // Verify the update call included name_overridden
  const updateCall = db.calls.find((c) => c.table === "folders" && c.operation === "update");
  assertEquals(!!updateCall, true);
});

Deno.test("file-manage: PATCH /folders/:id not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/folders/999", { name: "x" }));
  assertEquals(res.status, 404);
});

// ─── FOLDERS: DELETE ──────────────────────────────────────────────

Deno.test("file-manage: DELETE /folders/:id deletes a user folder", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { source: "user", conta_id: "conta-1" }, error: null });
  db.queue("folders", "delete", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/folders/3"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);
});

Deno.test("file-manage: DELETE /folders/:id blocks system folder deletion", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { source: "system", conta_id: "conta-1" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/folders/1"));
  assertEquals(res.status, 403);
  const body = await readJson(res);
  assertEquals(body.error, "System folders cannot be deleted");
});

Deno.test("file-manage: DELETE /folders/:id not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/folders/999"));
  assertEquals(res.status, 404);
});

Deno.test("file-manage: DELETE /folders/:id from different workspace returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { source: "user", conta_id: "other-ws" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/folders/3"));
  assertEquals(res.status, 404);
});

// ─── FILES: PATCH ──────────────────────────────────────────────

Deno.test("file-manage: PATCH /files/:id renames a file", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("files", "update", { data: { id: 10, name: "renamed.png" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/files/10", { name: "renamed.png" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.name, "renamed.png");
});

Deno.test("file-manage: PATCH /files/:id strips stream_uid/stream_status from the updated row", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1" }, error: null });
  // A real `RETURNING *` includes every column, incl. the Stream ones (bare `.select()`
  // after `.update()` is `select("*")`).
  db.queue("files", "update", {
    data: {
      id: 10, name: "renamed.mp4", kind: "video",
      stream_uid: "stream-uid-1", stream_status: "ready",
    },
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/files/10", { name: "renamed.mp4" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.name, "renamed.mp4");
  assert(!("stream_uid" in body), "stream_uid must not leak to the client");
  assert(!("stream_status" in body), "stream_status must not leak to the client");
});

Deno.test("file-manage: PATCH /files/:id with empty body returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/files/10", {}));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "Nothing to update");
});

Deno.test("file-manage: PATCH /files/:id not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/files/999", { name: "x" }));
  assertEquals(res.status, 404);
});

// ─── FILES: DELETE ──────────────────────────────────────────────

Deno.test("file-manage: DELETE /files/:id deletes an unreferenced file", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", reference_count: 0 }, error: null });
  db.queue("files", "delete", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/files/10"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);
});

Deno.test("file-manage: DELETE /files/:id with references returns 409 with linked posts", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", reference_count: 2 }, error: null });
  db.queue("post_file_links", "select", {
    data: [{
      post_id: 50,
      workflow_posts: { titulo: "Post A", workflow_id: 7, workflows: { titulo: "Calendar" } },
    }],
    error: null,
  });
  db.queue("report_document_files", "select", {
    data: [{ report_id: "doc-1", report_documents: { title: "Relatório de setembro" } }],
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/files/10"));
  assertEquals(res.status, 409);
  const body = await readJson(res);
  assertEquals(body.error, "file_in_use");
  assertEquals(body.reference_count, 2);
  assertEquals(body.linked_posts[0].post_id, 50);
  assertEquals(body.linked_reports, [{ report_id: "doc-1", title: "Relatório de setembro" }]);
  const postCall = db.calls.find((c) => c.table === "post_file_links" && c.operation === "select");
  assert(postCall!.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"));
  const repCall = db.calls.find((c) => c.table === "report_document_files");
  assert(repCall!.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"));
});

Deno.test("file-manage: DELETE /files/:id not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/files/999"));
  assertEquals(res.status, 404);
});

// ─── LINKS: POST ──────────────────────────────────────────────

Deno.test("file-manage: POST /links creates a link", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", kind: "image" }, error: null });
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "insert", { data: { id: 1, post_id: 50, file_id: 10 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/links", { post_id: 50, file_id: 10 }));
  assertEquals(res.status, 201);
});

Deno.test("file-manage: POST /links forwards sort_order", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", kind: "image" }, error: null });
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "insert", { data: { id: 2, post_id: 50, file_id: 11 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/links", { post_id: 50, file_id: 11, sort_order: 6 }));
  assertEquals(res.status, 201);
  const linkCalls = db.calls.filter((c) => c.table === "post_file_links" && c.operation === "insert");
  assertEquals((linkCalls[linkCalls.length - 1].payload as { sort_order?: number }).sort_order, 6);
});

Deno.test("file-manage: POST /links missing fields returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/links", { post_id: 50 }));
  assertEquals(res.status, 400);
});

Deno.test("file-manage: POST /links document file returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", kind: "document" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/links", { post_id: 50, file_id: 10 }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "Documents cannot be linked to posts");
});

Deno.test("file-manage: POST /links duplicate returns 409", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", kind: "image" }, error: null });
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "insert", { data: null, error: { message: "duplicate key constraint" } });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/links", { post_id: 50, file_id: 10 }));
  assertEquals(res.status, 409);
});

// ─── LINKS: DELETE ──────────────────────────────────────────────

Deno.test("file-manage: DELETE /links/:id removes a link", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "delete", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/links/1"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);
});

Deno.test("file-manage: DELETE /links/:id not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/links/999"));
  assertEquals(res.status, 404);
});

// ─── LINKS: GET ──────────────────────────────────────────────

Deno.test("file-manage: GET /links?post_id returns links with signed URLs", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", {
    data: [{
      id: 1, post_id: 50, files: {
        id: 10, kind: "image", r2_key: "contas/conta-1/files/img.png", thumbnail_r2_key: null,
      },
    }],
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/links?post_id=50"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.links.length, 1);
  assertEquals(body.links[0].files.url, "https://signed.example.com/contas/conta-1/files/img.png");
});

Deno.test("file-manage: GET /links strips stream_uid/stream_status from the embedded file row", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", {
    data: [{
      id: 1, post_id: 50, files: {
        id: 10, kind: "video", r2_key: "contas/conta-1/files/clip.mp4", thumbnail_r2_key: null,
        stream_uid: "stream-uid-9", stream_status: "ready",
      },
    }],
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/links?post_id=50"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assert(!("stream_uid" in body.links[0].files), "stream_uid must not leak to the client");
  assert(!("stream_status" in body.links[0].files), "stream_status must not leak to the client");
});

Deno.test("file-manage: GET /links without post_id returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/links"));
  assertEquals(res.status, 400);
});

// ─── LINKS: PATCH ──────────────────────────────────────────────

Deno.test("file-manage: PATCH /links/:id updates sort_order", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "update", { data: { id: 1, sort_order: 3 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/links/1", { sort_order: 3 }));
  assertEquals(res.status, 200);
});

Deno.test("file-manage: PATCH /links/:id with is_cover calls RPC", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queueRpc("post_file_link_set_cover", { data: true, error: null });
  db.queue("post_file_links", "select", { data: { id: 1, is_cover: true }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/links/1", { is_cover: true }));
  assertEquals(res.status, 200);
});

Deno.test("file-manage: PATCH /links/:id with empty body returns 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: { conta_id: "conta-1" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/links/1", {}));
  assertEquals(res.status, 400);
});

Deno.test("file-manage: PATCH /links/:id set_cover RPC error returns 500", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_file_links", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queueRpc("post_file_link_set_cover", { data: null, error: { message: "rpc failed" } });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/links/1", { is_cover: true }));
  assertEquals(res.status, 500);
  assertEquals(await readJson(res), { error: "Internal server error" });
});

// ─── TREE ─────────────────────────────────────────────────────

Deno.test("file-manage: GET /tree returns root subfolders with has_children", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  // folders query (root: parent_id is null)
  db.queue("folders", "select", {
    data: [
      { id: 1, name: "Clientes", source: "system", source_type: null, position: 0 },
      { id: 2, name: "Projetos", source: "user", source_type: null, position: 1 },
    ],
    error: null,
  });
  // has_children batch: folder 1 has children, folder 2 does not
  db.queue("folders", "select", { data: [{ parent_id: 1 }], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/tree"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.length, 2);
  assertEquals(body[0].id, 1);
  assertEquals(body[0].has_children, true);
  assertEquals(body[1].id, 2);
  assertEquals(body[1].has_children, false);
});

Deno.test("file-manage: GET /tree?parent_id=1 returns children of folder 1", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  // folders query filtered by parent_id=1
  db.queue("folders", "select", {
    data: [{ id: 10, name: "ClienteA", source: "user", source_type: null, position: 0 }],
    error: null,
  });
  // has_children batch: folder 10 has no children
  db.queue("folders", "select", { data: [], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/tree?parent_id=1"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.length, 1);
  assertEquals(body[0].id, 10);
  assertEquals(body[0].has_children, false);
});

// ─── GET /folders uses folder_sizes_batch and has_children ────

Deno.test("file-manage: GET /folders uses folder_sizes_batch and includes has_children", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", {
    data: [
      { id: 3, name: "Alpha" },
      { id: 4, name: "Beta" },
    ],
    error: null,
  });
  db.queue("files", "select", { data: [], error: null });
  // Single batch RPC instead of N individual calls
  db.queueRpc("folder_sizes_batch", {
    data: [
      { folder_id: 3, total_size_bytes: 500, file_count: 1 },
      { folder_id: 4, total_size_bytes: 2048, file_count: 5 },
    ],
    error: null,
  });
  // has_children: folder 4 has children
  db.queue("folders", "select", { data: [{ parent_id: 4 }], error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.subfolders.length, 2);
  assertEquals(body.subfolders[0].total_size_bytes, 500);
  assertEquals(body.subfolders[0].has_children, false);
  assertEquals(body.subfolders[1].total_size_bytes, 2048);
  assertEquals(body.subfolders[1].has_children, true);
  // Verify only one RPC call was made (not two folder_total_size calls)
  const rpcCalls = db.calls.filter((c) => c.table === "rpc:folder_sizes_batch");
  assertEquals(rpcCalls.length, 1);
});

// ─── GET /folders?parent_id uses folder_breadcrumbs RPC ───────

Deno.test("file-manage: GET /folders?parent_id=5 uses folder_breadcrumbs RPC", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", { data: [], error: null });
  db.queue("folders", "select", { data: { id: 5, conta_id: "conta-1" }, error: null });
  db.queueRpc("folder_breadcrumbs", {
    data: [{ id: 1, name: "Root" }, { id: 5, name: "Sub" }],
    error: null,
  });
  db.queue("folders", "select", { data: { id: 5, name: "Sub" }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders?parent_id=5"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.breadcrumbs.length, 2);
  assertEquals(body.breadcrumbs[0], { id: 1, name: "Root" });
  assertEquals(body.breadcrumbs[1], { id: 5, name: "Sub" });
  // Confirm the breadcrumbs RPC was called
  const rpcCall = db.calls.find((c) => c.table === "rpc:folder_breadcrumbs");
  assertEquals(!!rpcCall, true);
});

// ─── FILES PATCH blur_data_url ─────────────────────────────────

Deno.test("file-manage: PATCH /files/:id accepts blur_data_url", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("files", "update", { data: { id: 10, blur_data_url: "data:image/png;base64,abc" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/files/10", { blur_data_url: "data:image/png;base64,abc" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.blur_data_url, "data:image/png;base64,abc");
  // Confirm the update call included blur_data_url
  const updateCall = db.calls.find((c) => c.table === "files" && c.operation === "update");
  assertEquals(!!(updateCall?.payload as any)?.blur_data_url, true);
});

// ─── FILES GET /:id/url ────────────────────────────────────────

Deno.test("file-manage: GET /files/:id/url returns signed URL", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", r2_key: "contas/conta-1/files/img.png" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/files/10/url"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.url, "https://signed.example.com/contas/conta-1/files/img.png");
});

Deno.test("file-manage: GET /files/:id/url not found returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/files/999/url"));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "File not found");
});

Deno.test("file-manage: GET /files/:id/url wrong workspace returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "other-ws", r2_key: "contas/other-ws/files/img.png" }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/files/10/url"));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "File not found");
});

// ─── Security regression tests ────────────────────────────────

Deno.test("file-manage: GET /folders?parent_id from other workspace returns 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null }); // subfolders
  db.queue("files", "select", { data: [], error: null }); // files
  db.queue("folders", "select", { data: { id: 5, conta_id: "other-ws" }, error: null }); // parent ownership
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders?parent_id=5"));
  assertEquals(res.status, 404);
});

Deno.test("file-manage: PATCH /folders/:id rejects parent_id from other workspace", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 1, conta_id: "conta-1", source: "user" }, error: null }); // folder lookup
  db.queue("folders", "select", { data: { id: 99, conta_id: "other-ws" }, error: null }); // parent ownership
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/folders/1", { parent_id: 99 }));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "Parent folder not found");
});

Deno.test("file-manage: PATCH /folders/:id rejects moving folder into itself", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 1, conta_id: "conta-1", source: "user" }, error: null });
  db.queue("folders", "select", { data: { id: 1, conta_id: "conta-1" }, error: null }); // parent ownership passes
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/folders/1", { parent_id: 1 }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "Cannot move folder into itself");
});

Deno.test("file-manage: PATCH /folders/:id rejects moving folder into descendant", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 1, conta_id: "conta-1", source: "user" }, error: null });
  db.queue("folders", "select", { data: { id: 3, conta_id: "conta-1" }, error: null }); // parent ownership
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 1, name: "Root" }, { id: 3, name: "Child" }], error: null }); // ancestors include folder 1
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/folders/1", { parent_id: 3 }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "Cannot move folder into a descendant");
});

Deno.test("file-manage: PATCH /folders/:id accepts valid parent_id from same workspace", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 1, conta_id: "conta-1", source: "user" }, error: null });
  db.queue("folders", "select", { data: { id: 5, conta_id: "conta-1" }, error: null }); // parent ownership
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 5, name: "Target" }], error: null }); // no cycle
  db.queue("folders", "update", { data: { id: 1, parent_id: 5 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/folders/1", { parent_id: 5 }));
  assertEquals(res.status, 200);
});

Deno.test("file-manage: PATCH /files/:id rejects folder_id from other workspace", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { id: 10, conta_id: "conta-1" }, error: null }); // file lookup
  db.queue("folders", "select", { data: { id: 99, conta_id: "other-ws" }, error: null }); // folder ownership
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/files/10", { folder_id: 99 }));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "Folder not found");
});

Deno.test("file-manage: PATCH /files/:id accepts valid folder_id from same workspace", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { id: 10, conta_id: "conta-1" }, error: null });
  db.queue("folders", "select", { data: { id: 5, conta_id: "conta-1" }, error: null }); // folder ownership
  db.queue("files", "update", { data: { id: 10, folder_id: 5 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("PATCH", "/files/10", { folder_id: 5 }));
  assertEquals(res.status, 200);
});

Deno.test("file-manage: POST /folders/:id/copy rejects destination from other workspace", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 1, conta_id: "conta-1", name: "Source" }, error: null }); // source folder
  db.queue("folders", "select", { data: { id: 99, conta_id: "other-ws" }, error: null }); // destination ownership
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/folders/1/copy", { destination_folder_id: 99 }));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "Destination not found");
});

Deno.test("file-manage: POST /zip-token returns 429 when rate limited", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("check_rate_limit", { data: false, error: null }); // rate limited
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/zip-token", { folder_id: 1 }));
  assertEquals(res.status, 429);
  const body = await readJson(res);
  assertEquals(body.error, "Rate limit exceeded");
});

// ─── Client post references (files.attached_to) ─────────────────

function hasAttachedToFilter(db: ReturnType<typeof createSupabaseQueryMock>) {
  const filesSelect = db.calls.find((c) => c.table === "files" && c.operation === "select");
  return !!filesSelect?.modifiers.some((m) =>
    m.method === "is" && m.args[0] === "attached_to" && m.args[1] === null
  );
}

Deno.test("file-manage: GET /folders root listing excludes reference files (attached_to)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", { data: [], error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const res = await makeHandler(db)(req("GET", "/folders"));
  assertEquals(res.status, 200);
  assert(hasAttachedToFilter(db), "root files query must filter attached_to IS NULL");
});

Deno.test("file-manage: GET /folders?parent_id also excludes reference files", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: [], error: null });
  db.queue("files", "select", { data: [], error: null });
  db.queue("folders", "select", { data: { id: 5, conta_id: "conta-1" }, error: null });
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 5, name: "Sub" }], error: null });
  db.queue("folders", "select", { data: { id: 5, name: "Sub" }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000000, error: null });
  const res = await makeHandler(db)(req("GET", "/folders?parent_id=5"));
  assertEquals(res.status, 200);
  assert(hasAttachedToFilter(db), "folder files query must filter attached_to IS NULL");
});

Deno.test("file-manage: PATCH /files/:id on a reference file is 404 and never updates", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: { conta_id: "conta-1", attached_to: "post_reference" }, error: null });
  const res = await makeHandler(db)(req("PATCH", "/files/10", { folder_id: null, name: "x" }));
  assertEquals(res.status, 404);
  assertEquals(db.calls.find((c) => c.table === "files" && c.operation === "update"), undefined);
});

Deno.test("file-manage: POST /links refuses to link a reference file to a post", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", {
    data: { conta_id: "conta-1", kind: "image", attached_to: "post_reference" },
    error: null,
  });
  // Valid post + insert queued: without the attached_to guard this would be a 201.
  db.queue("workflow_posts", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("post_file_links", "insert", { data: { id: 1, post_id: 50, file_id: 10 }, error: null });
  const res = await makeHandler(db)(req("POST", "/links", { post_id: 50, file_id: 10 }));
  assertEquals(res.status, 404);
  assertEquals(db.calls.find((c) => c.table === "post_file_links" && c.operation === "insert"), undefined);
});

// ─── acesso por cliente ───────────────────────────────────────

const restrictedTo = (ids: number[], membroIds: number[] = []) => () =>
  Promise.resolve<ClientScope>({ all: false, ids: new Set(ids), membroIds: new Set(membroIds) });

/** Folder 3 = client folder of client 42, under the "Clientes" root (1). */
function queueClientFolder(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 1 }, { id: 3 }], error: null });
  db.queue("folders", "select", {
    data: [
      { id: 1, conta_id: "conta-1", source_type: "root_clients", source_id: null },
      { id: 3, conta_id: "conta-1", source_type: "client", source_id: 42 },
    ],
    error: null,
  });
}

Deno.test("file-manage: restricted member listing a hidden client's folder gets the missing-folder 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  queueClientFolder(db);
  const res = await makeHandler(db, { loadClientScope: restrictedTo([7]) })(req("GET", "/folders?parent_id=3"));
  assertEquals(res.status, 404);
  assertEquals(await readJson(res), { error: "Folder not found" });
  assertEquals(db.calls.filter((c) => c.table === "files").length, 0);
});

Deno.test("file-manage: restricted member listing an assigned client's folder is unchanged", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  queueClientFolder(db);
  db.queue("folders", "select", { data: [], error: null }, { data: { id: 3, conta_id: "conta-1" }, error: null });
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 1, name: "Clientes" }, { id: 3, name: "Ana" }], error: null });
  db.queue("files", "select", { data: [], error: null });
  const res = await makeHandler(db, { loadClientScope: restrictedTo([42]) })(req("GET", "/folders?parent_id=3"));
  assertEquals(res.status, 200);
});

Deno.test("file-manage: tree under the Clientes root drops hidden clients' folders", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 1 }], error: null });
  db.queue("folders", "select", {
    data: [{ id: 1, conta_id: "conta-1", source_type: "root_clients", source_id: null }],
    error: null,
  }, {
    data: [
      { id: 3, name: "Ana", source: "system", source_type: "client", source_id: 42, position: 0 },
      { id: 4, name: "Bia", source: "system", source_type: "client", source_id: 43, position: 1 },
    ],
    error: null,
  });
  const res = await makeHandler(db, { loadClientScope: restrictedTo([43]) })(req("GET", "/tree?parent_id=1"));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).map((f: { id: number }) => f.id), [4]);
});

Deno.test("file-manage: linking a file to own post in a hidden client is limitado", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue(
    "files",
    "select",
    { data: { conta_id: "conta-1", folder_id: null, attached_to: null }, error: null },
    { data: { conta_id: "conta-1", kind: "image", attached_to: null }, error: null },
  );
  db.queue("workflow_posts", "select", { data: { cliente_id: 42, responsavel_id: 9 }, error: null });
  const res = await makeHandler(db, { loadClientScope: restrictedTo([7], [9]) })(
    req("POST", "/links", { post_id: 50, file_id: 10 }),
  );
  assertEquals(res.status, 403);
  assertEquals(await readJson(res), { error: "Seu acesso é limitado aos clientes atribuídos." });
  assertEquals(db.calls.filter((c) => c.operation === "insert").length, 0);
});

Deno.test("file-manage: a scope read error is a 500, never data", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db, { loadClientScope: () => Promise.reject(new Error("boom")) })(
    req("GET", "/folders?parent_id=3"),
  );
  assertEquals(res.status, 500);
  assertEquals(db.calls.filter((c) => c.table === "folders" || c.table === "files").length, 0);
});

// ─── acesso por cliente: fix round 1 ─────────────────────────

Deno.env.set("ZIP_TOKEN_SECRET", "test-secret-key-for-unit-tests");
Deno.env.set("SUPABASE_URL", "https://test.supabase.co");

type Db = ReturnType<typeof createSupabaseQueryMock>;
const LIMITADO = { error: "Seu acesso é limitado aos clientes atribuídos." };

/** Gate setup: folder `id` is not in this workspace (folder_breadcrumbs finds nothing). */
const queueMissingFolder = (db: Db) => db.queueRpc("folder_breadcrumbs", { data: [], error: null });
/** Gate setup: file 10 sits in folder 3 (client 42). */
function queueFileInClientFolder(db: Db) {
  db.queue("files", "select", { data: { conta_id: "conta-1", folder_id: 3, attached_to: null }, error: null });
  queueClientFolder(db);
}

/** Runs the same request with the id hidden and with the id missing; returns both answers. */
async function probe(path: string, body: unknown, method: string, hidden: (db: Db) => void, missing: (db: Db) => void) {
  const run = async (setup: (db: Db) => void) => {
    const db = createSupabaseQueryMock();
    setupAuth(db);
    setup(db);
    const res = await makeHandler(db, { loadClientScope: restrictedTo([7]) })(req(method, path, body));
    return { status: res.status, body: await res.text(), db };
  };
  return { hidden: await run(hidden), missing: await run(missing) };
}

function assertSameAnswer(p: { hidden: { status: number; body: string }; missing: { status: number; body: string } }) {
  assertEquals(p.hidden.status, p.missing.status);
  assertEquals(p.hidden.body, p.missing.body);
}

Deno.test("probe: GET /tree under a hidden folder answers like a missing one (200 [])", async () => {
  const p = await probe("/tree?parent_id=3", undefined, "GET", queueClientFolder, queueMissingFolder);
  assertSameAnswer(p);
  assertEquals([p.hidden.status, p.hidden.body], [200, "[]"]);
});

Deno.test("probe: GET /links of a hidden post answers like a missing one (200 {links: []})", async () => {
  const p = await probe(
    "/links?post_id=50",
    undefined,
    "GET",
    (db) => db.queue("workflow_posts", "select", { data: { cliente_id: 42, responsavel_id: 1 }, error: null }),
    (db) => db.queue("workflow_posts", "select", { data: null, error: null }),
  );
  assertSameAnswer(p);
  assertEquals([p.hidden.status, JSON.parse(p.hidden.body)], [200, { links: [] }]);
  assertEquals(p.hidden.db.calls.filter((c) => c.table === "post_file_links").length, 0);
});

Deno.test("probe: bulk-move of a hidden file answers like a missing one (RPC invalid_files)", async () => {
  const invalid = { error: "Some files not found or not owned", code: "invalid_files" };
  const p = await probe(
    "/bulk-move",
    { file_ids: [10], folder_ids: [], destination_id: null },
    "POST",
    (db) => {
      queueFileInClientFolder(db);
      db.queue("files", "select", { data: [], error: null });
      db.queueRpc("bulk_move_items", { data: invalid, error: null });
    },
    (db) => {
      db.queue("files", "select", { data: null, error: null }, { data: [], error: null });
      db.queueRpc("bulk_move_items", { data: invalid, error: null });
    },
  );
  assertSameAnswer(p);
  assertEquals(p.hidden.status, 400);
  // The hidden id reaches the RPC as an id no row has, so it fails exactly where a missing id does.
  const rpc = p.hidden.db.calls.find((c) => c.table === "rpc:bulk_move_items");
  assertEquals((rpc?.payload as { p_file_ids: number[] }).p_file_ids, [-1]);
});

Deno.test("probe: bulk-move into a hidden destination answers like a missing one", async () => {
  const invalid = { error: "Destination folder not found", code: "invalid_destination" };
  const p = await probe(
    "/bulk-move",
    { folder_ids: [], file_ids: [], destination_id: 3 },
    "POST",
    queueClientFolder,
    queueMissingFolder,
  );
  // file_ids and folder_ids both empty: the route's own 400 comes first in both cases.
  assertSameAnswer(p);
  const q = await probe(
    "/bulk-move",
    { file_ids: [11], destination_id: 3 },
    "POST",
    (db) => {
      db.queue("files", "select", { data: { conta_id: "conta-1", folder_id: null, attached_to: null }, error: null });
      queueClientFolder(db);
      db.queueRpc("bulk_move_items", { data: invalid, error: null });
    },
    (db) => {
      db.queue("files", "select", { data: { conta_id: "conta-1", folder_id: null, attached_to: null }, error: null });
      queueMissingFolder(db);
      db.queueRpc("bulk_move_items", { data: invalid, error: null });
    },
  );
  assertSameAnswer(q);
  const rpc = q.hidden.db.calls.find((c) => c.table === "rpc:bulk_move_items");
  assertEquals((rpc?.payload as { p_destination_id: number }).p_destination_id, -1);
});

Deno.test("probe: bulk-delete of a hidden file or folder answers like a missing one (409 not_found)", async () => {
  const files = await probe(
    "/bulk-delete",
    { file_ids: [10] },
    "POST",
    (db) => {
      queueFileInClientFolder(db);
      // The row exists in the database; the scope must still report it as not found.
      db.queue("files", "select", { data: [{ id: 10, reference_count: 0, size_bytes: 5 }], error: null });
    },
    (db) => db.queue("files", "select", { data: null, error: null }, { data: [], error: null }),
  );
  assertSameAnswer(files);
  assertEquals(JSON.parse(files.hidden.body), {
    blocked: [{ id: 10, type: "file", reason: "not_found" }],
    deletable: { file_ids: [], folder_ids: [] },
  });
  assertEquals(files.hidden.db.calls.filter((c) => c.operation === "delete").length, 0);

  const folders = await probe(
    "/bulk-delete",
    { folder_ids: [3] },
    "POST",
    (db) => {
      queueClientFolder(db);
      db.queue("folders", "select", { data: [{ id: 3, source: "user" }], error: null });
    },
    (db) => {
      queueMissingFolder(db);
      db.queue("folders", "select", { data: [], error: null });
    },
  );
  assertSameAnswer(folders);
  assertEquals(folders.hidden.status, 409);
});

Deno.test("probe: zip-token of a hidden folder or file answers like a missing one (404, no token)", async () => {
  const folder = await probe("/zip-token", { folder_id: 3 }, "POST", queueClientFolder, (db) => {
    queueMissingFolder(db);
    db.queue("folders", "select", { data: null, error: null });
  });
  assertSameAnswer(folder);
  assertEquals([folder.hidden.status, JSON.parse(folder.hidden.body)], [404, { error: "Not found" }]);

  const files = await probe(
    "/zip-token",
    { file_ids: [10] },
    "POST",
    queueFileInClientFolder,
    (db) => db.queue("files", "select", { data: null, error: null }, { data: [], error: null }),
  );
  assertSameAnswer(files);
  assertEquals(files.hidden.status, 404);
});

Deno.test("probe: GET /folders?parent_id of a hidden folder answers like a missing one", async () => {
  const p = await probe("/folders?parent_id=3", undefined, "GET", queueClientFolder, (db) => {
    queueMissingFolder(db);
    db.queue("folders", "select", { data: [], error: null }, { data: null, error: null });
  });
  assertSameAnswer(p);
  assertEquals(p.hidden.status, 404);
});

Deno.test("zip-token: a missing folder no longer mints a token", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: null, error: null });
  const res = await makeHandler(db)(req("POST", "/zip-token", { folder_id: 999 }));
  assertEquals(res.status, 404);
  assertEquals(await readJson(res), { error: "Not found" });
});

// ─── default deny + route parity ─────────────────────────────

Deno.test("gate: a restricted caller on a route the gate does not know gets the fallthrough 404", async () => {
  for (const [method, path] of [["PUT", "/folders/3"], ["GET", "/files/10"], ["POST", "/folders/3/move"], ["POST", "/tree"]]) {
    const db = createSupabaseQueryMock();
    setupAuth(db);
    const res = await makeHandler(db, { loadClientScope: restrictedTo([7]) })(req(method, path, method === "GET" ? undefined : {}));
    assertEquals(res.status, 404, `${method} ${path}`);
    assertEquals(await readJson(res), { error: "Not found" });
    assertEquals(db.calls.filter((c) => c.table !== "profiles").length, 0, `${method} ${path} touched data`);
  }
});

Deno.test("gate: every route condition in handler.ts has a GATED_ROUTES entry, and no more", async () => {
  const src = await Deno.readTextFile(new URL("../file-manage/handler.ts", import.meta.url));
  const routes = src.slice(src.indexOf("// ─── TREE"));
  const found: Record<string, string[]> = {};
  let resource = "";
  for (const line of routes.split("\n")) {
    const res = line.match(/if \(resource === "([\w-]+)"/);
    if (res) resource = res[1];
    const cond = line.match(/if \((.*)\) \{\s*$/);
    if (!cond || !/req\.method ===|subResource ===/.test(cond[1])) continue;
    (found[resource] ??= []).push(cond[1]);
  }
  assertEquals(found, GATED_ROUTES);
});

// ─── subtree operations ──────────────────────────────────────

/** Folder 5: the member's own user folder at the workspace root. */
function queueOwnRootFolder(db: Db) {
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 5 }], error: null });
  db.queue("folders", "select", {
    data: [{ id: 5, conta_id: "conta-1", source_type: null, source_id: null }],
    error: null,
  });
}

Deno.test("subtree: deleting an own root folder with no hidden client below it is allowed", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  queueOwnRootFolder(db);
  db.queue(
    "folders",
    "select",
    { data: [{ id: 6, source_type: null, source_id: null }], error: null }, // subtree level 1
    { data: [], error: null }, // subtree level 2
    { data: { source: "user", conta_id: "conta-1" }, error: null }, // route
  );
  const res = await makeHandler(db, { loadClientScope: restrictedTo([42]) })(req("DELETE", "/folders/5"));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
});

Deno.test("subtree: a visible folder holding a hidden client's folder is limitado (403)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  // The "Clientes" root (1) holds client 42 (hidden) and client 43 (assigned).
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 1 }], error: null });
  db.queue(
    "folders",
    "select",
    { data: [{ id: 1, conta_id: "conta-1", source_type: "root_clients", source_id: null }], error: null },
    {
      data: [{ id: 3, source_type: "client", source_id: 42 }, { id: 4, source_type: "client", source_id: 43 }],
      error: null,
    },
    { data: [], error: null },
  );
  const res = await makeHandler(db, { loadClientScope: restrictedTo([43]) })(req("POST", "/zip-token", { folder_id: 1 }));
  assertEquals(res.status, 403);
  assertEquals(await readJson(res), LIMITADO);
  assertEquals(db.calls.filter((c) => c.table === "rpc:folder_sizes_batch").length, 0);
});

Deno.test("subtree: a folder the member cannot see answers not-found on delete", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  queueClientFolder(db);
  const res = await makeHandler(db, { loadClientScope: restrictedTo([7]) })(req("DELETE", "/folders/3"));
  assertEquals(res.status, 404);
  assertEquals(await readJson(res), { error: "Folder not found" });
  assertEquals(db.calls.filter((c) => c.operation === "delete").length, 0);
});

// ─── id shape (no parser differential) ───────────────────────

Deno.test("shape: malformed id lists answer 400 and never reach the gate or the RPC", async () => {
  const bad: [string, unknown][] = [
    ["/bulk-move", { file_ids: [10, "x"], folder_ids: [] }],
    ["/bulk-move", { file_ids: ["10"] }],
    ["/bulk-move", { file_ids: [10], destination_id: "3" }],
    ["/bulk-delete", { folder_ids: 3 }],
    ["/bulk-delete", { file_ids: [1.5] }],
    ["/bulk-delete", { file_ids: [-1] }],
    ["/zip-token", { folder_id: "3" }],
    ["/zip-token", { file_ids: [0] }],
  ];
  for (const [path, body] of bad) {
    const db = createSupabaseQueryMock();
    setupAuth(db);
    const res = await makeHandler(db, { loadClientScope: restrictedTo([7]) })(req("POST", path, body));
    assertEquals(res.status, 400, `${path} ${JSON.stringify(body)}`);
    assertEquals(await readJson(res), { error: "Requisição inválida." });
    assertEquals(db.calls.filter((c) => c.table !== "profiles").length, 0);
  }
});

Deno.test("shape: the route uses exactly the ids the gate checked", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  // Gate: both files are workspace-level and visible.
  db.queue(
    "files",
    "select",
    { data: { conta_id: "conta-1", folder_id: null, attached_to: null }, error: null },
    { data: { conta_id: "conta-1", folder_id: null, attached_to: null }, error: null },
    { data: [], error: null }, // route: attached check
  );
  db.queueRpc("bulk_move_items", { data: { ok: true, files_moved: 2, folders_moved: 0 }, error: null });
  const res = await makeHandler(db, { loadClientScope: restrictedTo([7]) })(
    req("POST", "/bulk-move", { file_ids: [10, 11], destination_id: null }),
  );
  assertEquals(res.status, 200);
  const gateReads = db.calls.filter((c) => c.table === "files" && c.modifiers.some((m) => m.method === "maybeSingle"));
  assertEquals(gateReads.map((c) => c.modifiers.find((m) => m.method === "eq")?.args[1]), [10, 11]);
  const rpc = db.calls.find((c) => c.table === "rpc:bulk_move_items");
  assertEquals((rpc?.payload as { p_file_ids: number[] }).p_file_ids, [10, 11]);
});

// ─── listings: workflow / post folders ───────────────────────

Deno.test("listing: workflow and post folders of hidden clients are dropped", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  queueClientFolder(db); // parent 3 = client 42, assigned
  db.queue("folders", "select", {
    data: [
      { id: 10, name: "A", source: "system", source_type: "workflow", source_id: 100, position: 0 },
      { id: 11, name: "B", source: "system", source_type: "workflow", source_id: 101, position: 1 },
      { id: 12, name: "C", source: "system", source_type: "post", source_id: 500, position: 2 },
      { id: 13, name: "D", source: "user", source_type: null, source_id: null, position: 3 },
    ],
    error: null,
  });
  db.queue("workflows", "select", { data: [{ id: 100, cliente_id: 42 }, { id: 101, cliente_id: 43 }], error: null });
  db.queue("workflow_posts", "select", { data: [{ id: 500, cliente_id: 43 }], error: null });
  const res = await makeHandler(db, { loadClientScope: restrictedTo([42]) })(req("GET", "/tree?parent_id=3"));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).map((f: { id: number }) => f.id), [10, 13]);
});
