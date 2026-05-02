import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createFileManageHandler } from "../file-manage/handler.ts";

Deno.env.set("ZIP_TOKEN_SECRET", "test-secret-key-for-unit-tests");
Deno.env.set("SUPABASE_URL", "https://test.supabase.co");

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createFileManageHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signUrl: async (key) => `https://signed.example.com/${key}`,
    now: () => "2026-05-01T12:00:00.000Z",
  });
}

function setupAuth(db: ReturnType<typeof createSupabaseQueryMock>, contaId = "conta-1") {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: contaId }, error: null });
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: "Bearer valid-jwt" } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return new Request(`https://example.test/file-manage${path}`, init);
}

// ─── BULK MOVE ──────────────────────────────────────────────

Deno.test("bulk-move: rejects when no items provided", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-move", { file_ids: [], folder_ids: [] }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "No items to move");
});

Deno.test("bulk-move: calls RPC and returns result", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("bulk_move_items", { data: { files_moved: 2, folders_moved: 0 }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-move", { file_ids: [1, 2], folder_ids: [], destination_id: 10 }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.files_moved, 2);
  const rpcCall = db.calls.find((c) => c.table === "rpc:bulk_move_items");
  assertEquals(!!rpcCall, true);
});

Deno.test("bulk-move: returns 500 when RPC errors", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("bulk_move_items", { data: null, error: { message: "rpc failed" } });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-move", { file_ids: [1], folder_ids: [] }));
  assertEquals(res.status, 500);
});

// ─── BULK DELETE ──────────────────────────────────────────────

Deno.test("bulk-delete: rejects when no items provided", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-delete", { file_ids: [], folder_ids: [] }));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "No items to delete");
});

Deno.test("bulk-delete: returns 409 with blocked items when files in use", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", {
    data: [
      { id: 1, reference_count: 0, size_bytes: 100 },
      { id: 2, reference_count: 3, size_bytes: 200 },
    ],
    error: null,
  });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-delete", { file_ids: [1, 2], folder_ids: [] }));
  assertEquals(res.status, 409);
  const body = await readJson(res);
  assertEquals(body.blocked.length, 1);
  assertEquals(body.blocked[0].id, 2);
  assertEquals(body.blocked[0].reason, "file_in_use");
  assertEquals(body.deletable.file_ids, [1]);
});

Deno.test("bulk-delete: deletes all items when none blocked", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: [{ id: 1, reference_count: 0, size_bytes: 100 }], error: null });
  db.queue("folders", "select", { data: [{ id: 10, source: "user" }], error: null });
  db.queue("files", "select", { data: [{ size_bytes: 100 }], error: null });
  db.queue("files", "delete", { data: null, error: null });
  db.queue("folders", "delete", { data: null, error: null });
  db.queueRpc("decrement_storage", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/bulk-delete", { file_ids: [1], folder_ids: [10] }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);
  assertEquals(body.files_deleted, 1);
  assertEquals(body.folders_deleted, 1);
});

// ─── COPY FILE ──────────────────────────────────────────────

Deno.test("copy-file: returns 404 when file not found", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/files/999/copy", { destination_folder_id: null }));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "File not found");
});

Deno.test("copy-file: returns 413 when quota exceeded", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", {
    data: {
      id: 1,
      conta_id: "conta-1",
      size_bytes: 1000,
      name: "photo.jpg",
      kind: "image",
      r2_key: "conta-1/photo.jpg",
      thumbnail_r2_key: null,
    },
    error: null,
  });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 9500, storage_quota_bytes: 10000 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/files/1/copy", { destination_folder_id: null }));
  assertEquals(res.status, 413);
  const body = await readJson(res);
  assertEquals(body.error, "quota_exceeded");
});

// ─── COPY FOLDER ──────────────────────────────────────────────

Deno.test("copy-folder: returns 404 when folder not found", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/folders/999/copy", {}));
  assertEquals(res.status, 404);
  const body = await readJson(res);
  assertEquals(body.error, "Folder not found");
});

Deno.test("copy-folder: returns 413 when copy limit exceeded", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 1, conta_id: "conta-1", name: "Test" }, error: null });
  db.queueRpc("folder_sizes_batch", { data: [{ folder_id: 1, total_size_bytes: 100, file_count: 201 }], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/folders/1/copy", {}));
  assertEquals(res.status, 413);
  const body = await readJson(res);
  assertEquals(body.error, "copy_limit_exceeded");
});

Deno.test("copy-folder: returns 413 when quota exceeded", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("folders", "select", { data: { id: 2, conta_id: "conta-1", name: "Big Folder" }, error: null });
  db.queueRpc("folder_sizes_batch", { data: [{ folder_id: 2, total_size_bytes: 5000, file_count: 10 }], error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 9000, storage_quota_bytes: 10000 }, error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/folders/2/copy", {}));
  assertEquals(res.status, 413);
  const body = await readJson(res);
  assertEquals(body.error, "quota_exceeded");
});

// ─── ZIP TOKEN ──────────────────────────────────────────────

Deno.test("zip-token: rejects when no folder_id or file_ids", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/zip-token", {}));
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "folder_id or file_ids required");
});

Deno.test("zip-token: returns 413 when file count limit exceeded", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const manyFiles = Array.from({ length: 501 }, (_, i) => ({ size_bytes: 1000 }));
  db.queue("files", "select", { data: manyFiles, error: null });
  const handler = makeHandler(db);
  const fileIds = Array.from({ length: 501 }, (_, i) => i + 1);
  const res = await handler(req("POST", "/zip-token", { file_ids: fileIds }));
  assertEquals(res.status, 413);
  const body = await readJson(res);
  assertEquals(body.error, "zip_limit_exceeded");
});

Deno.test("zip-token: returns token and download_url for folder", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("folder_sizes_batch", { data: [{ folder_id: 5, total_size_bytes: 1000, file_count: 10 }], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/zip-token", { folder_id: 5 }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(typeof body.token, "string");
  assertEquals(typeof body.download_url, "string");
  assertEquals(body.download_url.includes("file-zip"), true);
  assertEquals(body.download_url.includes("token="), true);
});

Deno.test("zip-token: returns token and download_url for file_ids", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("files", "select", { data: [{ size_bytes: 500 }, { size_bytes: 300 }], error: null });
  const handler = makeHandler(db);
  const res = await handler(req("POST", "/zip-token", { file_ids: [10, 20] }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(typeof body.token, "string");
  assertEquals(typeof body.download_url, "string");
});
