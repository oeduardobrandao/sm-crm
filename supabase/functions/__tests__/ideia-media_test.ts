import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { presignIdeiaImage } from "../_shared/ideia-media.ts";

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
