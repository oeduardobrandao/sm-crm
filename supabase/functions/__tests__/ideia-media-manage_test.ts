import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createIdeiaMediaManageHandler } from "../ideia-media-manage/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createIdeiaMediaManageHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : 5000, contentType: null }),
  });
}

function setupAuth(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "conta-1" }, error: null });
}

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x.test/${path}`, {
    method,
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

Deno.test("ideia-media-manage: missing auth -> 401", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db)(new Request("https://x.test/ideia-media-manage?ideia_id=i1"));
  assertEquals(res.status, 401);
});

Deno.test("ideia-media-manage: GET lists images (cliente unbound)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", { data: [], error: null });
  const res = await makeHandler(db)(req("GET", "ideia-media-manage?ideia_id=i1"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.images, []);
});

Deno.test("ideia-media-manage: GET without ideia_id -> 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("GET", "ideia-media-manage"));
  assertEquals(res.status, 400);
});

Deno.test("ideia-media-manage: POST /:id/files finalizes (uploaded_by = user)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("ideia_file_insert_with_quota", { data: { id: 42, blur_data_url: null }, error: null });
  db.queue("ideia_files", "select", { data: { id: 7, sort_order: 0 }, error: null });
  const res = await makeHandler(db)(req("POST", "ideia-media-manage/i1/files", {
    r2_key: "contas/conta-1/files/u.png",
    thumbnail_r2_key: "contas/conta-1/files/u.thumb.webp",
    mime_type: "image/png", size_bytes: 5000, thumbnail_bytes: 2000, name: "a.png",
  }));
  assertEquals(res.status, 200);
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_file_insert_with_quota");
  assertEquals((rpc?.payload as any).p.uploaded_by, "user-1");
});
