import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  appendTranscript,
  finalizeBriefingAudio,
  makeWorkerTranscriber,
  normalizeAudioMime,
  presignBriefingAudio,
  removeBriefingAudio,
  transcribeBriefingAudio,
} from "../_shared/briefing-audio.ts";

const signPutUrl = async (key: string) => `https://put.example.com/${key}`;
const signGetUrl = async (key: string) => `https://get.example.com/${key}`;
const Q = "11111111-1111-1111-1111-111111111111";
const KEY = `briefing-audio/conta-1/${Q}/fixed-uuid.webm`;

const audioRow = {
  answer: "Já tinha texto.",
  audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000,
  audio_duration_seconds: 12, audio_transcription_status: "pending", audio_recorded_at: "2026-09-03T00:00:00Z",
};

Deno.test("normalizeAudioMime aceita codecs e rejeita vídeo", () => {
  assertEquals(normalizeAudioMime("audio/webm;codecs=opus"), "audio/webm");
  assertEquals(normalizeAudioMime("AUDIO/MP4"), "audio/mp4");
  assertEquals(normalizeAudioMime("video/mp4"), null);
  assertEquals(normalizeAudioMime(undefined), null);
});

Deno.test("appendTranscript: separa com linha em branco só quando há texto", () => {
  assertEquals(appendTranscript(null, " Olá "), "Olá");
  assertEquals(appendTranscript("   ", "Olá"), "Olá");
  assertEquals(appendTranscript("Antes.\n", "Depois"), "Antes.\n\nDepois");
});

Deno.test("presign: mime inválido 415, tamanho fora 400, pergunta alheia 404", async () => {
  const db = createSupabaseQueryMock();
  const base = { db, conta_id: "conta-1", cliente_id: 14, question_id: Q, signPutUrl, randomUUID: () => "fixed-uuid" };
  assertEquals((await presignBriefingAudio({ ...base, mime_type: "video/mp4", size_bytes: 10 })).status, 415);
  assertEquals((await presignBriefingAudio({ ...base, mime_type: "audio/webm", size_bytes: 16 * 1024 * 1024 })).status, 400);
  db.queue("hub_briefing_questions", "select", { data: null, error: null });
  assertEquals((await presignBriefingAudio({ ...base, mime_type: "audio/webm", size_bytes: 10 })).status, 404);
});

Deno.test("presign: devolve chave no prefixo da pergunta, mime normalizado e 413 sobre quota", async () => {
  const db = createSupabaseQueryMock();
  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const ok = await presignBriefingAudio({
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q,
    mime_type: "audio/webm;codecs=opus", size_bytes: 5000, signPutUrl, randomUUID: () => "fixed-uuid",
  });
  assertEquals(ok.status, 200);
  assertEquals(ok.body.r2_key, KEY);
  assertEquals(ok.body.mime_type, "audio/webm");
  assertEquals(ok.body.upload_url, `https://put.example.com/${KEY}`);

  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 999 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const full = await presignBriefingAudio({
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q, mime_type: "audio/webm", size_bytes: 10, signPutUrl,
  });
  assertEquals(full.status, 413);
  assertEquals(full.body.error, "quota_exceeded");
});

Deno.test("presign: desconta audio_size_bytes atual da pergunta ao checar quota (re-gravação)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("hub_briefing_questions", "select", { data: { id: Q, audio_size_bytes: 600 }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 1000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const ok = await presignBriefingAudio({
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q,
    mime_type: "audio/webm", size_bytes: 500, signPutUrl, randomUUID: () => "fixed-uuid",
  });
  // used(1000) - audio_size_bytes(600) + size_bytes(500) = 900 <= quota(1000)
  assertEquals(ok.status, 200);

  db.queue("hub_briefing_questions", "select", { data: { id: Q, audio_size_bytes: null }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 1000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const full = await presignBriefingAudio({
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q,
    mime_type: "audio/webm", size_bytes: 500, signPutUrl, randomUUID: () => "fixed-uuid",
  });
  // used(1000) - 0 + size_bytes(500) = 1500 > quota(1000)
  assertEquals(full.status, 413);
  assertEquals(full.body.error, "quota_exceeded");
});

Deno.test("presign: erro na RPC de quota vira 500 sem lançar", async () => {
  const db = createSupabaseQueryMock();
  db.queue("hub_briefing_questions", "select", { data: { id: Q }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 0 }, error: null });
  db.queueRpc("effective_plan_limit", { data: null, error: { message: "boom" } });
  const res = await presignBriefingAudio({
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q,
    mime_type: "audio/webm", size_bytes: 5000, signPutUrl, randomUUID: () => "fixed-uuid",
  });
  assertEquals(res.status, 500);
  assertEquals(res.body, { error: "internal error" });
});

function finalizeArgs(db: ReturnType<typeof createSupabaseQueryMock>, extra: Record<string, unknown> = {}) {
  return {
    db, conta_id: "conta-1", cliente_id: 14, question_id: Q, r2_key: KEY,
    mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12,
    headObject: async () => ({ contentLength: 5000, contentType: "audio/webm" }),
    signGetUrl, transcribe: null,
    ...extra,
  } as Parameters<typeof finalizeBriefingAudio>[0];
}

Deno.test("finalize: prefixo errado 400, tamanho divergente 400, content-type divergente 400", async () => {
  const db = createSupabaseQueryMock();
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db, { r2_key: "contas/conta-1/files/x.webm" }))).status, 400);
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db, { headObject: async () => ({ contentLength: 1, contentType: "audio/webm" }) }))).status, 400);
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db, { headObject: async () => ({ contentLength: 5000, contentType: "video/mp4" }) }))).status, 400);
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db, { headObject: async () => null }))).status, 400);
});

Deno.test("finalize: mapeia erros da RPC (413/404/400) e 500 genérico", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "quota_exceeded" } });
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db))).status, 413);
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "question_not_found" } });
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db))).status, 404);
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "invalid_key" } });
  assertEquals((await finalizeBriefingAudio(finalizeArgs(db))).status, 400);
  db.queueRpc("briefing_audio_finalize", { data: null, error: { message: "relation x does not exist" } });
  const res = await finalizeBriefingAudio(finalizeArgs(db));
  assertEquals(res.status, 500);
  assertEquals(res.body.error, "internal error");
});

Deno.test("finalize: duration_seconds Infinity vira p_duration null na RPC", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: audioRow, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  await finalizeBriefingAudio(finalizeArgs(db, { duration_seconds: Infinity }));
  const call = db.calls.find((c) => c.table === "rpc:briefing_audio_finalize");
  assertEquals((call?.payload as Record<string, unknown>).p_duration, null);
});

Deno.test("finalize sem transcriber: marca failed, mantém áudio e devolve answer atual", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: audioRow, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_transcription_status: "failed" }, error: null });
  const res = await finalizeBriefingAudio(finalizeArgs(db));
  assertEquals(res.status, 200);
  assertEquals(res.body.answer, "Já tinha texto.");
  assertEquals(res.body.transcript, null);
  const audio = res.body.audio as Record<string, unknown>;
  assertEquals(audio.transcription_status, "failed");
  assertEquals(audio.url, `https://get.example.com/${KEY}`);
  const upd = db.calls.find((c) => c.table === "hub_briefing_questions" && c.operation === "update");
  assertEquals((upd?.payload as Record<string, unknown>).audio_transcription_status, "failed");
  assert(
    upd?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id" && m.args[1] === 14),
    "transcription update must scope by cliente_id",
  );
  assert(
    upd?.modifiers.some((m) => m.method === "neq" && m.args[0] === "audio_transcription_status" && m.args[1] === "done"),
    "failure update must be conditioned on audio_transcription_status != done",
  );
});

Deno.test("finalize: falha de transcrição concorrente não sobrescreve done já vencido", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: audioRow, error: null });
  // A UPDATE ... WHERE audio_transcription_status <> 'done' é um no-op — outra
  // corrida já marcou done antes desta falhar.
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  db.queue("hub_briefing_questions", "select", {
    data: { ...audioRow, audio_transcription_status: "done", answer: "Já tinha texto.\n\nOutro venceu." },
    error: null,
  });
  const res = await finalizeBriefingAudio(finalizeArgs(db));
  assertEquals(res.status, 200);
  assertEquals(res.body.answer, "Já tinha texto.\n\nOutro venceu.");
  const audio = res.body.audio as Record<string, unknown>;
  assertEquals(audio.transcription_status, "done");
  const upd = db.calls.find((c) => c.table === "hub_briefing_questions" && c.operation === "update");
  assert(
    upd?.modifiers.some((m) => m.method === "neq" && m.args[0] === "audio_transcription_status" && m.args[1] === "done"),
    "failure update must be conditioned on audio_transcription_status != done",
  );
});

Deno.test("finalize com transcriber: anexa transcrição ao answer e marca done", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_duration_seconds: null }, error: null });
  db.queue("hub_briefing_questions", "update", { data: [{ id: Q }], error: null });
  const res = await finalizeBriefingAudio(finalizeArgs(db, {
    transcribe: async (key: string) => ({ text: ` Nossa marca nasceu em 2010. `, duration: 11.6 }),
  }));
  assertEquals(res.status, 200);
  assertEquals(res.body.answer, "Já tinha texto.\n\nNossa marca nasceu em 2010.");
  assertEquals(res.body.transcript, "Nossa marca nasceu em 2010.");
  const upd = db.calls.find((c) => c.table === "hub_briefing_questions" && c.operation === "update");
  const payload = upd?.payload as Record<string, unknown>;
  assertEquals(payload.audio_transcription_status, "done");
  assertEquals(payload.audio_duration_seconds, 12);
  assertEquals((res.body.audio as Record<string, unknown>).transcription_status, "done");
});

Deno.test("finalize: retry idempotente (reserved:false) não re-transcreve pergunta já done", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: false, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", {
    data: { ...audioRow, audio_transcription_status: "done", audio_transcript: "Já transcrito." },
    error: null,
  });
  let transcribeCalls = 0;
  const res = await finalizeBriefingAudio(finalizeArgs(db, {
    transcribe: async () => {
      transcribeCalls++;
      throw new Error("não deveria transcrever de novo");
    },
  }));
  assertEquals(res.status, 200);
  assertEquals(transcribeCalls, 0);
  assertEquals(res.body.answer, "Já tinha texto.");
  assertEquals(res.body.transcript, "Já transcrito.");
  assert(!db.calls.some((c) => c.operation === "update"), "retry sobre pergunta done não deve escrever");
});

Deno.test("finalize: RPC reserved:true mas linha já done (defensivo) não re-transcreve", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", {
    data: { ...audioRow, audio_transcription_status: "done", audio_transcript: "Já transcrito." },
    error: null,
  });
  let transcribeCalls = 0;
  const res = await finalizeBriefingAudio(finalizeArgs(db, {
    transcribe: async () => {
      transcribeCalls++;
      throw new Error("não deveria transcrever de novo");
    },
  }));
  assertEquals(res.status, 200);
  assertEquals(transcribeCalls, 0);
  assertEquals(res.body.transcript, "Já transcrito.");
});

Deno.test("finalize: perdedor da corrida concorrente não duplica o texto anexado", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: audioRow, error: null });
  // A UPDATE ... WHERE audio_transcription_status <> 'done' não bate em nenhuma
  // linha porque o vencedor da corrida já marcou done primeiro.
  db.queue("hub_briefing_questions", "update", { data: [], error: null });
  db.queue("hub_briefing_questions", "select", {
    data: { ...audioRow, audio_transcription_status: "done", answer: "Já tinha texto.\n\nOutro venceu." },
    error: null,
  });
  const res = await finalizeBriefingAudio(finalizeArgs(db, {
    transcribe: async () => ({ text: "Este texto não deveria aparecer." }),
  }));
  assertEquals(res.status, 200);
  assertEquals(res.body.answer, "Já tinha texto.\n\nOutro venceu.");
  const upd = db.calls.find((c) => c.table === "hub_briefing_questions" && c.operation === "update");
  assert(
    upd?.modifiers.some((m) => m.method === "neq" && m.args[0] === "audio_transcription_status" && m.args[1] === "done"),
    "update must be conditioned on audio_transcription_status != done",
  );
});

Deno.test("finalize: transcriber que lança vira failed sem 500", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("briefing_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("hub_briefing_questions", "select", { data: audioRow, error: null });
  db.queue("hub_briefing_questions", "update", { data: null, error: null });
  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_transcription_status: "failed" }, error: null });
  const res = await finalizeBriefingAudio(finalizeArgs(db, { transcribe: async () => { throw new Error("boom"); } }));
  assertEquals(res.status, 200);
  assertEquals((res.body.audio as Record<string, unknown>).transcription_status, "failed");
});

Deno.test("retry: sem áudio 404; já done devolve sem anexar de novo; failed roda de novo", async () => {
  const db = createSupabaseQueryMock();
  const base = { db, conta_id: "conta-1", cliente_id: 14, question_id: Q, signGetUrl, transcribe: async () => ({ text: "X" }) };
  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_r2_key: null }, error: null });
  assertEquals((await transcribeBriefingAudio(base)).status, 404);
  const sel = db.calls.find((c) => c.table === "hub_briefing_questions" && c.operation === "select");
  assert(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id" && m.args[1] === 14), "retry must scope by cliente_id");

  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_transcription_status: "done", audio_transcript: "X" }, error: null });
  const done = await transcribeBriefingAudio(base);
  assertEquals(done.status, 200);
  assertEquals(done.body.answer, "Já tinha texto.");
  assert(!db.calls.some((c) => c.operation === "update"), "done must not update");

  db.queue("hub_briefing_questions", "select", { data: { ...audioRow, audio_transcription_status: "failed" }, error: null });
  db.queue("hub_briefing_questions", "update", { data: [{ id: Q }], error: null });
  const again = await transcribeBriefingAudio(base);
  assertEquals(again.body.answer, "Já tinha texto.\n\nX");
});

Deno.test("remove: pergunta alheia 404; sem áudio ok; com áudio chama release", async () => {
  const db = createSupabaseQueryMock();
  const base = { db, conta_id: "conta-1", cliente_id: 14, question_id: Q };
  db.queue("hub_briefing_questions", "select", { data: null, error: null });
  assertEquals((await removeBriefingAudio(base)).status, 404);
  db.queue("hub_briefing_questions", "select", { data: { id: Q, audio_r2_key: null }, error: null });
  assertEquals((await removeBriefingAudio(base)).status, 200);
  assert(!db.calls.some((c) => c.table === "rpc:briefing_audio_release"));
  db.queue("hub_briefing_questions", "select", { data: { id: Q, audio_r2_key: KEY }, error: null });
  db.queueRpc("briefing_audio_release", { data: KEY, error: null });
  assertEquals((await removeBriefingAudio(base)).status, 200);
  const rel = db.calls.find((c) => c.table === "rpc:briefing_audio_release");
  assertEquals(rel?.payload, { p_conta_id: "conta-1", p_cliente_id: 14, p_question_id: Q });
});

Deno.test("makeWorkerTranscriber: null sem env; POST com bearer; null em 500 e texto vazio", async () => {
  assertEquals(makeWorkerTranscriber({ url: "", secret: "s" }), null);
  assertEquals(makeWorkerTranscriber({ url: "https://w", secret: undefined }), null);

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ text: "olá", duration: 3.2 }), { status: 200 });
  }) as typeof fetch;
  const t = makeWorkerTranscriber({ url: "https://w.example", secret: "sec", fetchFn })!;
  assertEquals(await t(KEY), { text: "olá", duration: 3.2 });
  assertEquals(calls[0].url, "https://w.example");
  assertEquals((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sec");
  assertEquals(JSON.parse(calls[0].init.body as string), { key: KEY });

  const bad = makeWorkerTranscriber({ url: "https://w", secret: "s", fetchFn: (async () => new Response("x", { status: 500 })) as typeof fetch })!;
  assertEquals(await bad(KEY), null);
  const empty = makeWorkerTranscriber({ url: "https://w", secret: "s", fetchFn: (async () => new Response(JSON.stringify({ text: "  " }))) as typeof fetch })!;
  assertEquals(await empty(KEY), null);
});
