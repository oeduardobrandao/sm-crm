import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createFileManageHandler } from "../file-manage/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createFileManageHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signUrl: async (key) => `https://signed.example.com/${key}`,
    now: () => "2026-04-24T12:00:00.000Z",
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
  db.queue("workspaces", "select", { data: { storage_used_bytes: 5000, storage_quota_bytes: 1000000 }, error: null });
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
  // folder_breadcrumbs RPC (replaces while-loop selects)
  db.queueRpc("folder_breadcrumbs", { data: [{ id: 1, name: "Root" }, { id: 5, name: "Sub" }], error: null });
  // folder detail
  db.queue("folders", "select", { data: { id: 5, name: "Sub" }, error: null });
  // workspace storage query
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0, storage_quota_bytes: 1000000 }, error: null });
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
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0, storage_quota_bytes: 1000000 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("GET", "/folders"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.files[0].url, null);
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
  const handler = makeHandler(db);
  const res = await handler(req("DELETE", "/files/10"));
  assertEquals(res.status, 409);
  const body = await readJson(res);
  assertEquals(body.error, "file_in_use");
  assertEquals(body.reference_count, 2);
  assertEquals(body.linked_posts[0].post_id, 50);
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
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0, storage_quota_bytes: 1000000 }, error: null });
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
  db.queueRpc("folder_breadcrumbs", {
    data: [{ id: 1, name: "Root" }, { id: 5, name: "Sub" }],
    error: null,
  });
  db.queue("folders", "select", { data: { id: 5, name: "Sub" }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0, storage_quota_bytes: 1000000 }, error: null });
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
