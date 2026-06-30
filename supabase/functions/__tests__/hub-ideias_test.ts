import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubIdeiasHandler } from "../hub-ideias/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-06-26T12:00:00.000Z",
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : 5000, contentType: null }),
  });
}

function setupToken(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
}

Deno.test("hub-ideias: POST /upload-url returns presigned keys", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideia_files", "select", { data: null, error: null, count: 1 });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias/upload-url?token=t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "t", ideia_id: "11111111-1111-1111-1111-111111111111",
      filename: "a.png", mime_type: "image/png", size_bytes: 5000,
      thumbnail: { mime_type: "image/webp", size_bytes: 2000 },
    }),
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(typeof body.upload_url, "string");
});

Deno.test("hub-ideias: POST /:id/files works on a LOCKED idea (lock-independent)", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  // No checkLock query is consulted; finalize goes straight to the RPC.
  db.queueRpc("ideia_file_insert_with_quota", {
    data: { id: 42, blur_data_url: null, width: 800, height: 600 }, error: null,
  });
  db.queue("ideia_files", "select", { data: { id: 7, sort_order: 0 }, error: null });
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111/files?token=t",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "t",
        r2_key: "contas/conta-1/files/uuid-1.png",
        thumbnail_r2_key: "contas/conta-1/files/uuid-1.thumb.webp",
        mime_type: "image/png", size_bytes: 5000, thumbnail_bytes: 2000, name: "a.png",
      }),
    },
  ));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.file_id, 42);
});

Deno.test("hub-ideias: DELETE /:id/files/:fileId removes an image", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: { id: "i1", cliente_id: 14, workspace_id: "conta-1" }, error: null });
  db.queue("ideia_files", "select", { data: { id: 7 }, error: null });
  db.queue("ideia_files", "delete", { data: null, error: null });
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111/files/42?token=t",
    { method: "DELETE" },
  ));
  assertEquals(res.status, 200);
});

Deno.test("hub-ideias: PATCH on a locked idea still returns 409 (text lock intact)", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  // Locked because status != 'nova'.
  db.queue("ideias", "select", { data: { status: "em_analise", comentario_agencia: null }, error: null });
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111?token=t",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "t", titulo: "novo titulo" }),
    },
  ));
  assertEquals(res.status, 409);
});

Deno.test("hub-ideias: invalid token returns 404", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias/upload-url?token=bad", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "bad" }),
  }));
  assertEquals(res.status, 404);
});
