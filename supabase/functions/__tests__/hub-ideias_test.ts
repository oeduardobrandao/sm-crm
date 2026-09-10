import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubIdeiasHandler } from "../hub-ideias/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>, transcribe: ((k: string) => Promise<{ text: string } | null>) | null = null) {
  return createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-06-26T12:00:00.000Z",
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: async (k: string) => ({ contentLength: k.includes('.thumb.') ? 2000 : k.includes('.webm') ? 5000 : 5000, contentType: null }),
    rateLimit: async () => true,
    transcribe,
    randomUUID: () => "fixed-uuid",
  });
}
const OWN = { id: "11111111-1111-1111-1111-111111111111", origem: "cliente" };

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
  db.queue("ideias", "select", { data: OWN, error: null });
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
  db.queue("ideias", "select", { data: OWN, error: null });
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
  db.queue("ideias", "select", { data: OWN, error: null });
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

Deno.test("hub-ideias: POST create with tipo=solicitacao inserts tipo", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "insert", { data: { id: "i1", titulo: "T", tipo: "solicitacao" }, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", titulo: "T", descricao: "D", tipo: "solicitacao" }),
  }));
  assertEquals(res.status, 201);
  const insert = db.calls.find((c) => c.table === "ideias" && c.operation === "insert");
  assertEquals((insert?.payload as Record<string, unknown> | undefined)?.tipo, "solicitacao");
});

Deno.test("hub-ideias: POST create defaults tipo to ideia", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "insert", { data: { id: "i1", titulo: "T", tipo: "ideia" }, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", titulo: "T", descricao: "D" }),
  }));
  assertEquals(res.status, 201);
  const insert = db.calls.find((c) => c.table === "ideias" && c.operation === "insert");
  assertEquals((insert?.payload as Record<string, unknown> | undefined)?.tipo, "ideia");
});

Deno.test("hub-ideias: POST create rejects invalid tipo with 400", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", titulo: "T", descricao: "D", tipo: "pedido" }),
  }));
  assertEquals(res.status, 400);
});

Deno.test("hub-ideias: PATCH accepts tipo under the lock", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: { status: "nova", comentario_agencia: null }, error: null });
  db.queue("ideia_reactions", "select", { data: null, error: null, count: 0 });
  db.queue("ideias", "update", { data: { id: "i1", tipo: "solicitacao" }, error: null });
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111?token=t",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "t", tipo: "solicitacao" }),
    },
  ));
  assertEquals(res.status, 200);
  const update = db.calls.find((c) => c.table === "ideias" && c.operation === "update");
  assertEquals((update?.payload as Record<string, unknown> | undefined)?.tipo, "solicitacao");
});

Deno.test("hub-ideias: PATCH rejects invalid tipo with 400", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: { status: "nova", comentario_agencia: null }, error: null });
  db.queue("ideia_reactions", "select", { data: null, error: null, count: 0 });
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111?token=t",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "t", tipo: "pedido" }),
    },
  ));
  assertEquals(res.status, 400);
});

Deno.test("hub-ideias: GET select includes tipo and tarefa_id", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", {
    data: [{ id: "i1", titulo: "T", tipo: "solicitacao", tarefa_id: "tarefa-1" }],
    error: null,
  });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", { method: "GET" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ideias[0].tipo, "solicitacao");
  assertEquals(body.ideias[0].tarefa_id, "tarefa-1");
  const select = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  const selectStr = (select?.selectArgs?.[0]?.[0] as string | undefined) ?? "";
  assertEquals(selectStr.includes("tipo"), true);
  assertEquals(selectStr.includes("tarefa_id"), true);
});

Deno.test("hub-ideias: PATCH/DELETE on an agency ideia -> 404 (never 409)", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: null, error: null }); // origem filter excluded the row
  const res = await makeHandler(db)(new Request(
    "https://x.test/hub-ideias/11111111-1111-1111-1111-111111111111?token=t",
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "t", titulo: "x" }) },
  ));
  assertEquals(res.status, 404);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "cliente"), true);
});

Deno.test("hub-ideias: image presign on an agency ideia -> 404", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias/upload-url?token=t", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", ideia_id: OWN.id, filename: "a.png", mime_type: "image/png", size_bytes: 5, thumbnail: { mime_type: "image/webp", size_bytes: 2 } }),
  }));
  assertEquals(res.status, 404);
});

Deno.test("hub-ideias: GET filters visivel_no_hub, returns origem and audio view, strips audio_* columns", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", {
    data: [{
      id: "i1", titulo: "T", tipo: "ideia", origem: "agencia", audio_transcript: "Fala",
      audio_r2_key: "ideia-audio/conta-1/i1/a.webm", audio_mime: "audio/webm", audio_size_bytes: 10,
      audio_duration_seconds: 3, audio_transcription_status: "done", audio_recorded_at: "2026-09-10T00:00:00Z",
    }],
    error: null,
  });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", { method: "GET" }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ideias[0].origem, "agencia");
  assertEquals(body.ideias[0].audio.url, "https://get.example.com/ideia-audio/conta-1/i1/a.webm");
  assertEquals(body.ideias[0].audio.transcript, "Fala");
  assertEquals("audio_r2_key" in body.ideias[0], false);
  const select = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(select?.modifiers.some((m) => m.method === "eq" && m.args[0] === "visivel_no_hub" && m.args[1] === true), true);
  assertEquals(select?.modifiers.some((m) => m.method === "eq" && m.args[0] === "workspace_id" && m.args[1] === "conta-1"), true);
  const selectStr = (select?.selectArgs?.[0]?.[0] as string | undefined) ?? "";
  assertEquals(selectStr.includes("origem"), true);
  assertEquals(selectStr.includes("audio_r2_key"), true);
});

Deno.test("hub-ideias: POST create ignores origem/visivel_no_hub from the body", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "insert", { data: { id: "i1" }, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias?token=t", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", titulo: "T", descricao: "D", origem: "agencia", visivel_no_hub: false, audio_r2_key: "x" }),
  }));
  assertEquals(res.status, 201);
  const insert = db.calls.find((c) => c.table === "ideias" && c.operation === "insert");
  const payload = insert?.payload as Record<string, unknown>;
  assertEquals("origem" in payload, false);
  assertEquals("visivel_no_hub" in payload, false);
  assertEquals("audio_r2_key" in payload, false);
});

Deno.test("hub-ideias: POST /audio-upload-url is plan-gated (403) and presigns under ideia-audio/", async () => {
  const gated = createSupabaseQueryMock();
  gated.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  gated.queueRpc("effective_plan_feature", { data: true, error: null }); // feature_hub_portal (resolveHubToken)
  gated.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_briefing_audio (audio gate)
  const denied = await makeHandler(gated)(new Request("https://x.test/hub-ideias/audio-upload-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", ideia_id: OWN.id, mime_type: "audio/webm", size_bytes: 5000 }),
  }));
  assertEquals(denied.status, 403);

  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: { id: OWN.id, audio_size_bytes: null }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-ideias/audio-upload-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", ideia_id: OWN.id, mime_type: "audio/webm;codecs=opus", size_bytes: 5000 }),
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.r2_key, `ideia-audio/conta-1/${OWN.id}/fixed-uuid.webm`);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id" && m.args[1] === 14), true);
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "cliente"), true);
});

Deno.test("hub-ideias: POST /:id/audio finalizes + transcribes; DELETE /:id/audio releases without plan gate", async () => {
  const key = `ideia-audio/conta-1/${OWN.id}/fixed-uuid.webm`;
  const row = {
    id: OWN.id, audio_transcript: null, audio_r2_key: key, audio_mime: "audio/webm", audio_size_bytes: 5000,
    audio_duration_seconds: 7, audio_transcription_status: "pending", audio_recorded_at: "2026-09-10T00:00:00Z",
  };
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("ideia_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  // Task 2's ownership pre-check runs after the R2 HEAD checks and before the RPC.
  db.queue("ideias", "select", { data: { id: OWN.id }, error: null });
  db.queue("ideias", "select", { data: row, error: null });
  db.queueRpc("ideia_audio_apply_transcript", { data: { ...row, audio_transcript: "Olá", audio_transcription_status: "done" }, error: null });
  const res = await makeHandler(db, async () => ({ text: "Olá" }))(new Request(`https://x.test/hub-ideias/${OWN.id}/audio`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", r2_key: key, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 7 }),
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.transcript, "Olá");
  assertEquals(body.audio.transcription_status, "done");

  const del = createSupabaseQueryMock();
  del.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  // No feature_briefing_audio queued: only resolveHubToken's mandatory feature_hub_portal
  // check may hit effective_plan_feature (via the mock's default `true`); DELETE must not
  // consult the plan gate a second time.
  del.queue("ideias", "select", { data: { id: OWN.id, audio_r2_key: key }, error: null });
  del.queueRpc("ideia_audio_release", { data: key, error: null });
  const dres = await makeHandler(del)(new Request(`https://x.test/hub-ideias/${OWN.id}/audio?token=t`, { method: "DELETE" }));
  assertEquals(dres.status, 200);
  const planFeatureCalls = del.calls.filter((c) => c.table === "rpc:effective_plan_feature").length;
  assertEquals(planFeatureCalls, 1);
});

Deno.test("hub-ideias: POST /:id/audio/transcribe retries", async () => {
  const key = `ideia-audio/conta-1/${OWN.id}/fixed-uuid.webm`;
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("ideias", "select", { data: { id: OWN.id, audio_transcript: null, audio_r2_key: key, audio_mime: "audio/webm", audio_size_bytes: 1, audio_duration_seconds: 1, audio_transcription_status: "failed", audio_recorded_at: "2026-09-10T00:00:00Z" }, error: null });
  db.queueRpc("ideia_audio_apply_transcript", { data: { id: OWN.id, audio_transcript: "De novo", audio_r2_key: key, audio_mime: "audio/webm", audio_size_bytes: 1, audio_duration_seconds: 1, audio_transcription_status: "done", audio_recorded_at: "2026-09-10T00:00:00Z" }, error: null });
  const res = await makeHandler(db, async () => ({ text: "De novo" }))(new Request(`https://x.test/hub-ideias/${OWN.id}/audio/transcribe`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "t" }),
  }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).transcript, "De novo");
});
