import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createIdeiaMediaManageHandler } from "../ideia-media-manage/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(
  db: ReturnType<typeof createSupabaseQueryMock>,
  transcribe: ((key: string) => Promise<{ text: string; duration?: number }>) | null = null,
) {
  return createIdeiaMediaManageHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : 5000, contentType: null }),
    transcribe,
    randomUUID: () => "fixed-uuid",
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

const I = "11111111-1111-1111-1111-111111111111";
const AKEY = `ideia-audio/conta-1/${I}/fixed-uuid.webm`;
const arow = {
  id: I, audio_transcript: null, audio_r2_key: AKEY, audio_mime: "audio/webm", audio_size_bytes: 5000,
  audio_duration_seconds: 7, audio_transcription_status: "pending", audio_recorded_at: "2026-09-10T00:00:00Z",
};

Deno.test("ideia-media-manage: GET /audio returns the view; 404 when the ideia is not in the workspace", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("ideias", "select", { data: { ...arow, audio_transcript: "T" }, error: null });
  const res = await makeHandler(db)(req("GET", `ideia-media-manage/audio?ideia_id=${I}`));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.transcript, "T");
  assertEquals(body.audio.url, `https://get.example.com/${AKEY}`);

  const miss = createSupabaseQueryMock();
  setupAuth(miss);
  miss.queue("ideias", "select", { data: null, error: null });
  assertEquals((await makeHandler(miss)(req("GET", `ideia-media-manage/audio?ideia_id=${I}`))).status, 404);
});

Deno.test("ideia-media-manage: POST /audio-upload-url gates on the plan flag and scopes origem=agencia", async () => {
  const gated = createSupabaseQueryMock();
  setupAuth(gated);
  gated.queueRpc("effective_plan_feature", { data: false, error: null });
  assertEquals((await makeHandler(gated)(req("POST", "ideia-media-manage/audio-upload-url", { ideia_id: I, mime_type: "audio/webm", size_bytes: 10 }))).status, 403);

  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queue("ideias", "select", { data: { id: I, audio_size_bytes: null }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(req("POST", "ideia-media-manage/audio-upload-url", { ideia_id: I, mime_type: "audio/webm", size_bytes: 10 }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).r2_key, AKEY);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "agencia"), true);
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id"), false);
});

Deno.test("ideia-media-manage: POST /:id/audio finalizes with p_origem=agencia; transcribe + DELETE routes", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queue("ideias", "select", { data: { id: I }, error: null });
  db.queueRpc("ideia_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: arow, error: null });
  db.queueRpc("ideia_audio_apply_transcript", { data: { ...arow, audio_transcript: "Olá", audio_transcription_status: "done" }, error: null });
  const res = await makeHandler(db, async () => ({ text: "Olá" }))(req("POST", `ideia-media-manage/${I}/audio`, {
    r2_key: AKEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 7,
  }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).transcript, "Olá");
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_audio_finalize");
  assertEquals((rpc?.payload as Record<string, unknown>).p_origem, "agencia");

  const t = createSupabaseQueryMock();
  setupAuth(t);
  t.queueRpc("effective_plan_feature", { data: true, error: null });
  t.queue("ideias", "select", { data: { ...arow, audio_transcription_status: "failed" }, error: null });
  t.queueRpc("ideia_audio_apply_transcript", { data: { ...arow, audio_transcript: "De novo", audio_transcription_status: "done" }, error: null });
  assertEquals((await makeHandler(t, async () => ({ text: "De novo" }))(req("POST", `ideia-media-manage/${I}/audio/transcribe`))).status, 200);

  const d = createSupabaseQueryMock();
  setupAuth(d);
  d.queue("ideias", "select", { data: { id: I, audio_r2_key: AKEY }, error: null });
  d.queueRpc("ideia_audio_release", { data: AKEY, error: null });
  assertEquals((await makeHandler(d)(req("DELETE", `ideia-media-manage/${I}/audio`))).status, 200);
  assertEquals(d.calls.some((c) => c.table === "rpc:effective_plan_feature"), false);
});

Deno.test("ideia-media-manage: a custom role without ideias:editar is forbidden from every audio-mutating route", async () => {
  for (const [method, path, body] of [
    ["POST", "ideia-media-manage/audio-upload-url", { ideia_id: I, mime_type: "audio/webm", size_bytes: 10 }],
    ["POST", `ideia-media-manage/${I}/audio`, { r2_key: AKEY, mime_type: "audio/webm", size_bytes: 5000 }],
    ["POST", `ideia-media-manage/${I}/audio/transcribe`, undefined],
    ["DELETE", `ideia-media-manage/${I}/audio`, undefined],
  ] as const) {
    const db = createSupabaseQueryMock();
    setupAuth(db);
    db.queueRpc("has_permission_for", { data: false, error: null });
    const res = await makeHandler(db)(req(method, path, body));
    assertEquals(res.status, 403, `${method} ${path} should be 403`);
    assertEquals(db.calls.some((c) => c.table === "rpc:effective_plan_feature"), false, `${method} ${path} must not reach the plan-feature check`);
  }
});

Deno.test("ideia-media-manage: a custom role without ideias:ver is forbidden from GET /audio", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("has_permission_for", { data: false, error: null });
  const res = await makeHandler(db)(req("GET", `ideia-media-manage/audio?ideia_id=${I}`));
  assertEquals(res.status, 403);
});
