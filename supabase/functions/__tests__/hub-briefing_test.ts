import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubBriefingHandler } from "../hub-briefing/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts: {
    transcribe?: ((key: string) => Promise<{ text: string } | null>) | null;
    rateLimit?: (k: string) => boolean;
    signGetUrl?: (key: string) => Promise<string>;
  } = {},
) {
  return createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-06-16T12:00:00.000Z",
    rateLimit: async (_db, key) => (opts.rateLimit ? opts.rateLimit(key) : true),
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: opts.signGetUrl ?? (async (key: string) => `https://get.example.com/${key}`),
    headObject: async () => ({ contentLength: 5000, contentType: "audio/webm" }),
    transcribe: opts.transcribe ?? null,
    randomUUID: () => "fixed-uuid",
  });
}

function setupToken(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts: { briefingAudio?: boolean } = {},
) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  // A fila de effective_plan_feature é FIFO: a 1ª chamada é feature_hub_portal,
  // dentro de resolveHubToken; a 2ª é feature_briefing_audio, o gate das rotas
  // de ESCRITA de áudio (presign, finalize, transcribe — nunca o DELETE).
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queueRpc("effective_plan_feature", { data: opts.briefingAudio !== false, error: null });
}

function countFeatureRpcCalls(db: ReturnType<typeof createSupabaseQueryMock>) {
  return db.calls.filter((c) => c.table === "rpc:effective_plan_feature").length;
}

function getReq() {
  return new Request("https://example.test/hub-briefing?token=t", { method: "GET" });
}

Deno.test("hub-briefing GET groups questions under their briefings", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [
      { id: "b1", title: "Onboarding", display_order: 0 },
      { id: "b2", title: "Campanha", display_order: 1 },
    ],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Marca?", answer: null, section: null, display_order: 0, briefing_id: "b1" },
      { id: "q2", question: "Verba?", answer: "1000", section: "Mídia", display_order: 0, briefing_id: "b2" },
    ],
    error: null,
  });

  const res = await makeHandler(db)(getReq());
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body, {
    briefings: [
      {
        id: "b1",
        title: "Onboarding",
        display_order: 0,
        questions: [{ id: "q1", question: "Marca?", answer: null, section: null, display_order: 0, audio: null }],
      },
      {
        id: "b2",
        title: "Campanha",
        display_order: 1,
        questions: [
          { id: "q2", question: "Verba?", answer: "1000", section: "Mídia", display_order: 0, audio: null },
        ],
      },
    ],
  });
});

Deno.test("hub-briefing GET keeps a briefing with no questions (parent query)", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [
      { id: "b1", title: "Onboarding", display_order: 0 },
      { id: "b2", title: "Vazio", display_order: 1 },
    ],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Marca?", answer: null, section: null, display_order: 0, briefing_id: "b1" },
    ],
    error: null,
  });

  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings.length, 2);
  assertEquals(body.briefings[1].questions, []);
});

Deno.test("hub-briefing GET coalesces null briefing_id into the first briefing", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [{ id: "b1", title: "Briefing", display_order: 0 }],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Legacy?", answer: null, section: null, display_order: 0, briefing_id: null },
    ],
    error: null,
  });

  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings[0].questions.length, 1);
});

Deno.test("hub-briefing GET surfaces orphan null-briefing_id questions when no briefings exist", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", { data: [], error: null });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Legacy?", answer: null, section: null, display_order: 0, briefing_id: null },
    ],
    error: null,
  });

  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings.length, 1);
  assertEquals(body.briefings[0].title, "Briefing");
  assertEquals(body.briefings[0].questions.length, 1);
});

Deno.test("hub-briefing GET hides database error details", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: null,
    error: { message: "connection string leaked" },
  });

  const response = await makeHandler(db)(getReq());
  assertEquals(response.status, 500);
  assertEquals(await readJson(response), { error: "Internal server error" });
});

const Q = "11111111-1111-1111-1111-111111111111";
const KEY = `briefing-audio/conta-1/${Q}/fixed-uuid.webm`;

function postReq(path: string, body: unknown) {
  return new Request(`https://example.test/hub-briefing${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("hub-briefing GET inclui audio assinado quando a pergunta tem áudio", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", { data: [{ id: "b1", title: "Briefing", display_order: 0 }], error: null });
  db.queue("hub_briefing_questions", "select", {
    data: [{
      id: Q, question: "Marca?", answer: "texto", section: null, display_order: 0, briefing_id: "b1",
      audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000, audio_duration_seconds: 12,
      audio_transcription_status: "done", audio_recorded_at: "2026-09-03T00:00:00Z",
    }],
    error: null,
  });
  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings[0].questions[0].audio, {
    url: `https://get.example.com/${KEY}`, mime: "audio/webm", duration_seconds: 12,
    transcription_status: "done", recorded_at: "2026-09-03T00:00:00Z",
  });
});

Deno.test("hub-briefing GET: falha ao assinar um áudio deixa a pergunta com audio null, sem 500", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const OTHER = "22222222-2222-2222-2222-222222222222";
  const otherKey = `briefing-audio/conta-1/${OTHER}/ok.webm`;
  db.queue("briefings", "select", { data: [{ id: "b1", title: "Briefing", display_order: 0 }], error: null });
  db.queue("hub_briefing_questions", "select", {
    data: [
      {
        id: Q, question: "Marca?", answer: "texto", section: null, display_order: 0, briefing_id: "b1",
        audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000, audio_duration_seconds: 12,
        audio_transcription_status: "done", audio_recorded_at: "2026-09-03T00:00:00Z",
      },
      {
        id: OTHER, question: "Público?", answer: null, section: null, display_order: 1, briefing_id: "b1",
        audio_r2_key: otherKey, audio_mime: "audio/webm", audio_size_bytes: 100, audio_duration_seconds: 3,
        audio_transcription_status: "done", audio_recorded_at: "2026-09-03T00:00:00Z",
      },
    ],
    error: null,
  });
  const res = await makeHandler(db, {
    signGetUrl: async (key: string) => {
      if (key === KEY) throw new Error("r2 signing down");
      return `https://get.example.com/${key}`;
    },
  })(getReq());
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.briefings[0].questions[0].audio, null);
  assertEquals(body.briefings[0].questions[1].audio.url, `https://get.example.com/${otherKey}`);
});

Deno.test("hub-briefing POST /upload-url devolve presign no prefixo da pergunta", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(postReq("/upload-url", { token: "t", question_id: Q, mime_type: "audio/webm;codecs=opus", size_bytes: 5000 }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.r2_key, KEY);
  assertEquals(body.mime_type, "audio/webm");
});

Deno.test("hub-briefing POST /upload-url sem question_id -> 400; 429 na chave de áudio", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db)(postReq("/upload-url", { token: "t", mime_type: "audio/webm", size_bytes: 10 }));
  assertEquals(res.status, 400);

  const db2 = createSupabaseQueryMock();
  setupToken(db2);
  const limited = makeHandler(db2, { rateLimit: (k) => !k.startsWith("hub-write:hub-briefing-audio:") });
  const res2 = await limited(postReq("/upload-url", { token: "t", question_id: Q, mime_type: "audio/webm", size_bytes: 10 }));
  assertEquals(res2.status, 429);
});

Deno.test("hub-briefing POST /{id}/audio finaliza, transcreve e devolve answer", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", {
    data: {
      answer: null, audio_transcript: null, audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000,
      audio_duration_seconds: 12, audio_transcription_status: "pending", audio_recorded_at: "2026-09-03T00:00:00Z",
    },
    error: null,
  });
  // O append é uma RPC atômica: a linha que ela devolve É a resposta. Sem
  // linha, runTranscription (briefing-audio.ts) relê a pergunta em vez de
  // confiar num answer velho em memória.
  db.queueRpc("briefing_audio_apply_transcript", {
    data: {
      id: Q, answer: "Nossa marca.", audio_transcript: "Nossa marca.", audio_r2_key: KEY,
      audio_mime: "audio/webm", audio_size_bytes: 5000, audio_duration_seconds: 12,
      audio_transcription_status: "done", audio_recorded_at: "2026-09-03T00:00:00Z",
    },
    error: null,
  });
  const res = await makeHandler(db, { transcribe: async () => ({ text: "Nossa marca." }) })(
    postReq(`/${Q}/audio`, { token: "t", r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12 }),
  );
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.answer, "Nossa marca.");
  assertEquals(body.audio.transcription_status, "done");
});

Deno.test("hub-briefing POST /{id}/audio propaga 413 da quota", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "quota_exceeded" } });
  const res = await makeHandler(db)(
    postReq(`/${Q}/audio`, { token: "t", r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12 }),
  );
  assertEquals(res.status, 413);
});

Deno.test("hub-briefing POST /{id}/audio/transcribe e DELETE /{id}/audio", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("hub_briefing_questions", "select", { data: { answer: "a", audio_r2_key: null }, error: null });
  const r1 = await makeHandler(db)(postReq(`/${Q}/audio/transcribe`, { token: "t" }));
  assertEquals(r1.status, 404);

  const db2 = createSupabaseQueryMock();
  setupToken(db2);
  db2.queue("hub_briefing_questions", "select", { data: { id: Q, audio_r2_key: KEY }, error: null });
  db2.queueRpc("briefing_audio_release", { data: KEY, error: null });
  const r2 = await makeHandler(db2)(
    new Request(`https://example.test/hub-briefing/${Q}/audio?token=t`, { method: "DELETE" }),
  );
  assertEquals(r2.status, 200);
  assertEquals(await readJson(r2), { ok: true });
});

Deno.test("hub-briefing POST simples (sem segmento) segue salvando answer", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  const res = await makeHandler(db)(postReq("", { token: "t", question_id: Q, answer: "oi" }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
});

// ── Gate de plano (feature_briefing_audio) ─────────────────────────────

Deno.test("hub-briefing: feature_briefing_audio off -> 403 no presign", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db, { briefingAudio: false });
  const res = await makeHandler(db)(
    postReq("/upload-url", { token: "t", question_id: Q, mime_type: "audio/webm", size_bytes: 5000 }),
  );
  assertEquals(res.status, 403);
  assertEquals(await readJson(res), { error: "Recurso indisponível no plano atual." });
});

Deno.test("hub-briefing: feature_briefing_audio off -> 403 no finalize e no transcribe", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db, { briefingAudio: false });
  const res = await makeHandler(db)(
    postReq(`/${Q}/audio`, { token: "t", r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000 }),
  );
  assertEquals(res.status, 403);

  const db2 = createSupabaseQueryMock();
  setupToken(db2, { briefingAudio: false });
  const res2 = await makeHandler(db2)(postReq(`/${Q}/audio/transcribe`, { token: "t" }));
  assertEquals(res2.status, 403);
});

Deno.test("hub-briefing: DELETE do áudio segue liberado com o plano sem a feature", async () => {
  // Depois de um downgrade o cliente ainda precisa conseguir remover (e ouvir,
  // via GET) o que já gravou — só a escrita nova é paga.
  const db = createSupabaseQueryMock();
  setupToken(db, { briefingAudio: false });
  db.queue("hub_briefing_questions", "select", { data: { id: Q, audio_r2_key: KEY }, error: null });
  db.queueRpc("briefing_audio_release", { data: KEY, error: null });
  const res = await makeHandler(db)(
    new Request(`https://example.test/hub-briefing/${Q}/audio?token=t`, { method: "DELETE" }),
  );
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
  // Só o feature_hub_portal do resolveHubToken: o gate nem é consultado.
  assertEquals(countFeatureRpcCalls(db), 1);
});

Deno.test("hub-briefing: com a feature ligada o presign segue normal", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db, { briefingAudio: true });
  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(
    postReq("/upload-url", { token: "t", question_id: Q, mime_type: "audio/webm", size_bytes: 5000 }),
  );
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).r2_key, KEY);
  assertEquals(countFeatureRpcCalls(db), 2);
});
