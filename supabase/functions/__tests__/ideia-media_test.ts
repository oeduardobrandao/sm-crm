import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { presignIdeiaImage, finalizeIdeiaImage } from "../_shared/ideia-media.ts";

const signPutUrl = async (key: string) => `https://put.example.com/${key}`;
const randomUUID = () => "uuid-1";

function baseArgs(db: ReturnType<typeof createSupabaseQueryMock>) {
  return {
    db: db as never,
    conta_id: "conta-1",
    cliente_id: 14 as number | null,
    ideia_id: "11111111-1111-1111-1111-111111111111",
    filename: "ref.png",
    mime_type: "image/png",
    size_bytes: 5000,
    thumbnail: { mime_type: "image/webp", size_bytes: 2000 },
    signPutUrl,
    randomUUID,
  };
}

Deno.test("presign: rejects non-image mime with 415", async () => {
  const db = createSupabaseQueryMock();
  const res = await presignIdeiaImage({ ...baseArgs(db), mime_type: "application/pdf" });
  assertEquals(res.status, 415);
});

Deno.test("presign: rejects oversize main file with 400", async () => {
  const db = createSupabaseQueryMock();
  const res = await presignIdeiaImage({ ...baseArgs(db), size_bytes: 26214401 });
  assertEquals(res.status, 400);
});

Deno.test("presign: rejects non-webp thumbnail with 400", async () => {
  const db = createSupabaseQueryMock();
  const res = await presignIdeiaImage({
    ...baseArgs(db),
    thumbnail: { mime_type: "image/png", size_bytes: 2000 },
  });
  assertEquals(res.status, 400);
});

Deno.test("presign: rejects oversize thumbnail with 400", async () => {
  const db = createSupabaseQueryMock();
  const res = await presignIdeiaImage({
    ...baseArgs(db),
    thumbnail: { mime_type: "image/webp", size_bytes: 524289 },
  });
  assertEquals(res.status, 400);
});

Deno.test("presign: 409 when idea already has 10 images", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideia_files", "select", { data: null, error: null, count: 10 });
  const res = await presignIdeiaImage(baseArgs(db));
  assertEquals(res.status, 409);
});

Deno.test("presign: happy path returns upload_id + keys under conta prefix", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideia_files", "select", { data: null, error: null, count: 3 });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null }); // unlimited
  const res = await presignIdeiaImage(baseArgs(db));
  assertEquals(res.status, 200);
  assertEquals(res.body.upload_id, "uuid-1");
  assertEquals(res.body.r2_key, "contas/conta-1/files/uuid-1.png");
  assertEquals(res.body.thumbnail_r2_key, "contas/conta-1/files/uuid-1.thumb.webp");
  assertEquals(res.body.upload_url, "https://put.example.com/contas/conta-1/files/uuid-1.png");
});

Deno.test("presign: 413 when projected usage exceeds quota", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideia_files", "select", { data: null, error: null, count: 0 });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 999 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null }); // 1000 byte quota
  const res = await presignIdeiaImage(baseArgs(db)); // needs 5000 + 2000
  assertEquals(res.status, 413);
});

const signGetUrl = async (key: string) => `https://get.example.com/${key}`;

function finalizeArgs(db: ReturnType<typeof createSupabaseQueryMock>) {
  return {
    db: db as never,
    conta_id: "conta-1",
    cliente_id: 14 as number | null,
    ideia_id: "11111111-1111-1111-1111-111111111111",
    r2_key: "contas/conta-1/files/uuid-1.png",
    thumbnail_r2_key: "contas/conta-1/files/uuid-1.thumb.webp",
    mime_type: "image/png",
    size_bytes: 5000,
    thumbnail_bytes: 2000,
    name: "ref.png",
    width: 800,
    height: 600,
    blur_data_url: "data:image/webp;base64,abc",
    sort_order: 0,
    uploaded_by: null as string | null,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : 5000, contentType: null }),
    signGetUrl,
  };
}

Deno.test("finalize: rejects r2_key outside conta prefix with 400", async () => {
  const db = createSupabaseQueryMock();
  const res = await finalizeIdeiaImage({ ...finalizeArgs(db), r2_key: "contas/other/files/x.png" });
  assertEquals(res.status, 400);
});

Deno.test("finalize: 400 when main object missing in R2", async () => {
  const db = createSupabaseQueryMock();
  const res = await finalizeIdeiaImage({ ...finalizeArgs(db), headObject: async () => null });
  assertEquals(res.status, 400);
});

Deno.test("finalize: 400 when main size mismatches R2", async () => {
  const db = createSupabaseQueryMock();
  const res = await finalizeIdeiaImage({
    ...finalizeArgs(db),
    headObject: async () => ({ contentLength: 9999, contentType: null }),
  });
  assertEquals(res.status, 400);
});

Deno.test("finalize: 400 when thumbnail missing in R2", async () => {
  const db = createSupabaseQueryMock();
  let n = 0;
  const res = await finalizeIdeiaImage({
    ...finalizeArgs(db),
    headObject: async () => { n++; return n === 1 ? { contentLength: 5000, contentType: null } : null; },
  });
  assertEquals(res.status, 400);
});

Deno.test("finalize: RPC ideia_not_found -> 404", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", { data: null, error: { message: "ideia_not_found" } });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 404);
});

Deno.test("finalize: RPC image_limit -> 409", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", { data: null, error: { message: "image_limit" } });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 409);
});

Deno.test("finalize: RPC quota_exceeded -> 413", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", { data: null, error: { message: "quota_exceeded" } });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 413);
});

Deno.test("finalize: unexpected RPC error -> 500 with generic message (no leak)", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", {
    data: null,
    error: { message: 'duplicate key value violates unique constraint "files_pkey"' },
  });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 500);
  assertEquals(res.body.error, "internal error"); // raw DB message must NOT leak
});

Deno.test("finalize: happy path returns signed IdeiaImage from inserted row", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("ideia_file_insert_with_quota", {
    data: { id: 42, r2_key: "contas/conta-1/files/uuid-1.png",
            thumbnail_r2_key: "contas/conta-1/files/uuid-1.thumb.webp",
            width: 800, height: 600, blur_data_url: "data:image/webp;base64,abc" },
    error: null,
  });
  // Find the link id created for this file.
  db.queue("ideia_files", "select", { data: { id: 7, sort_order: 0 }, error: null });
  const res = await finalizeIdeiaImage(finalizeArgs(db));
  assertEquals(res.status, 200);
  assertEquals(res.body.file_id, 42);
  assertEquals(res.body.id, 7);
  assertEquals(res.body.url, "https://get.example.com/contas/conta-1/files/uuid-1.png");
  assertEquals(res.body.thumbnail_url, "https://get.example.com/contas/conta-1/files/uuid-1.thumb.webp");
});

import { listIdeiaImages, removeIdeiaImage } from "../_shared/ideia-media.ts";

Deno.test("list: 404 when idea not owned by this workspace/client", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: null, error: null }); // ownership lookup misses
  const res = await listIdeiaImages({
    db: db as never, conta_id: "conta-1", cliente_id: 14,
    ideia_id: "11111111-1111-1111-1111-111111111111", signGetUrl,
  });
  assertEquals(res.status, 404);
});

Deno.test("list: returns signed images ordered for an owned idea", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", {
    data: [
      { id: 7, file_id: 42, sort_order: 0,
        files: { r2_key: "contas/conta-1/files/a.png", thumbnail_r2_key: "contas/conta-1/files/a.thumb.webp",
                 blur_data_url: "data:...", width: 800, height: 600 } },
    ],
    error: null,
  });
  const res = await listIdeiaImages({
    db: db as never, conta_id: "conta-1", cliente_id: 14,
    ideia_id: "i1", signGetUrl,
  });
  assertEquals(res.status, 200);
  const images = res.body.images as Array<Record<string, unknown>>;
  assertEquals(images.length, 1);
  assertEquals(images[0].file_id, 42);
  assertEquals(images[0].url, "https://get.example.com/contas/conta-1/files/a.png");
});

Deno.test("remove: 404 when link not found for owned idea", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", { data: null, error: null }); // link lookup misses
  const res = await removeIdeiaImage({
    db: db as never, conta_id: "conta-1", cliente_id: 14, ideia_id: "i1", file_id: 42,
  });
  assertEquals(res.status, 404);
});

Deno.test("remove: deletes the link and returns ok", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", { data: { id: 7 }, error: null });
  db.queue("ideia_files", "delete", { data: null, error: null });
  const res = await removeIdeiaImage({
    db: db as never, conta_id: "conta-1", cliente_id: 14, ideia_id: "i1", file_id: 42,
  });
  assertEquals(res.status, 200);
  assertEquals(res.body.ok, true);
  const del = db.calls.filter((c) => c.table === "ideia_files" && c.operation === "delete");
  assertEquals(del.length, 1);
});
