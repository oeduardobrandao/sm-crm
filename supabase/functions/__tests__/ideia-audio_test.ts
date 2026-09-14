import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  finalizeIdeiaAudio,
  IDEIA_AUDIO_KEY_PREFIX,
  loadIdeiaAudioView,
  presignIdeiaAudio,
  removeIdeiaAudio,
  transcribeIdeiaAudio,
} from "../_shared/ideia-audio.ts";

const signPutUrl = async (key: string) => `https://put.example.com/${key}`;
const signGetUrl = async (key: string) => `https://get.example.com/${key}`;
const I = "11111111-1111-1111-1111-111111111111";
const KEY = `${IDEIA_AUDIO_KEY_PREFIX}conta-1/${I}/fixed-uuid.webm`;
const headOk = async () => ({ contentLength: 5000, contentType: "audio/webm" });

const row = {
  id: I, audio_transcript: null,
  audio_r2_key: KEY, audio_mime: "audio/webm", audio_size_bytes: 5000,
  audio_duration_seconds: 12, audio_transcription_status: "pending", audio_recorded_at: "2026-09-10T00:00:00Z",
};

Deno.test("presign: 415 mime, 400 size, 404 quando a ideia não é do lado/cliente", async () => {
  const db = createSupabaseQueryMock();
  const base = { db, workspace_id: "conta-1", ideia_id: I, origem: "cliente" as const, cliente_id: 14, signPutUrl, randomUUID: () => "fixed-uuid" };
  assertEquals((await presignIdeiaAudio({ ...base, mime_type: "video/mp4", size_bytes: 10 })).status, 415);
  assertEquals((await presignIdeiaAudio({ ...base, mime_type: "audio/webm", size_bytes: 16 * 1024 * 1024 })).status, 400);
  db.queue("ideias", "select", { data: null, error: null });
  const r = await presignIdeiaAudio({ ...base, mime_type: "audio/webm", size_bytes: 10 });
  assertEquals(r.status, 404);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "cliente"), true);
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id" && m.args[1] === 14), true);
});

Deno.test("presign: chave no prefixo da ideia, mime normalizado, 413 sobre quota (desconta áudio atual)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: I, audio_size_bytes: 600 }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 1000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const ok = await presignIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "agencia",
    mime_type: "audio/webm;codecs=opus", size_bytes: 500, signPutUrl, randomUUID: () => "fixed-uuid",
  });
  assertEquals(ok.status, 200);
  assertEquals(ok.body.r2_key, KEY);
  assertEquals(ok.body.mime_type, "audio/webm");
  // agencia scope: no cliente_id filter
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id"), false);

  db.queue("ideias", "select", { data: { id: I, audio_size_bytes: null }, error: null });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 1000 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const full = await presignIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "agencia", mime_type: "audio/webm", size_bytes: 500, signPutUrl,
  });
  assertEquals(full.status, 413);
  assertEquals(full.body.error, "quota_exceeded");
});

Deno.test("finalize: prefixo errado 400, tamanho divergente 400, RPC ideia_not_found 404", async () => {
  const db = createSupabaseQueryMock();
  const base = {
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente" as const, cliente_id: 14,
    mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12, headObject: headOk, signGetUrl, transcribe: null,
  };
  assertEquals((await finalizeIdeiaAudio({ ...base, r2_key: "briefing-audio/conta-1/x/a.webm" })).status, 400);
  assertEquals((await finalizeIdeiaAudio({ ...base, r2_key: `${IDEIA_AUDIO_KEY_PREFIX}conta-1/${I}/../x.webm` })).status, 400);
  const badHead = async () => ({ contentLength: 1, contentType: "audio/webm" });
  assertEquals((await finalizeIdeiaAudio({ ...base, r2_key: KEY, headObject: badHead })).status, 400);
  db.queue("ideias", "select", { data: { id: I }, error: null });
  db.queueRpc("ideia_audio_finalize", { data: null, error: { message: "ideia_not_found" } });
  assertEquals((await finalizeIdeiaAudio({ ...base, r2_key: KEY })).status, 404);
});

Deno.test("finalize: ideia fora do escopo do cliente/origem -> 404 antes da RPC", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: null, error: null });
  const r = await finalizeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14,
    r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12,
    headObject: headOk, signGetUrl, transcribe: null,
  });
  assertEquals(r.status, 404);
  assertEquals(db.calls.some((c) => c.table === "rpc:ideia_audio_finalize"), false);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "cliente_id" && m.args[1] === 14), true);
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem" && m.args[1] === "cliente"), true);
});

Deno.test("finalize: sem transcriber grava failed e devolve audio + transcript null", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: I }, error: null });
  db.queueRpc("ideia_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: row, error: null });
  db.queue("ideias", "update", { data: null, error: null });
  db.queue("ideias", "select", { data: { ...row, audio_transcription_status: "failed" }, error: null });
  const r = await finalizeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14,
    r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12,
    headObject: headOk, signGetUrl, transcribe: null,
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.transcript, null);
  assertEquals((r.body.audio as { transcription_status: string }).transcription_status, "failed");
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_audio_finalize");
  assertEquals((rpc?.payload as Record<string, unknown>).p_origem, "cliente");
  assertEquals((rpc?.payload as Record<string, unknown>).p_workspace_id, "conta-1");
  const upd = db.calls.find((c) => c.table === "ideias" && c.operation === "update");
  assertEquals(upd?.modifiers.some((m) => m.method === "eq" && m.args[0] === "audio_r2_key" && m.args[1] === KEY), true);
});

Deno.test("finalize: transcriber ok chama ideia_audio_apply_transcript com p_key e devolve o transcript", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: I }, error: null });
  db.queueRpc("ideia_audio_finalize", { data: { reserved: true, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: row, error: null });
  db.queueRpc("ideia_audio_apply_transcript", {
    data: { ...row, audio_transcript: "Olá mundo", audio_transcription_status: "done" }, error: null,
  });
  const r = await finalizeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "agencia",
    r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000, duration_seconds: 12,
    headObject: headOk, signGetUrl, transcribe: async () => ({ text: " Olá mundo ", duration: 11.6 }),
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.transcript, "Olá mundo");
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_audio_apply_transcript");
  const p = rpc?.payload as Record<string, unknown>;
  assertEquals(p.p_key, KEY);
  assertEquals(p.p_text, "Olá mundo");
  assertEquals(p.p_duration, 12);
  assertEquals("p_origem" in p, false);
});

Deno.test("finalize: reserved:false (retry) não re-transcreve linha done", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { id: I }, error: null });
  db.queueRpc("ideia_audio_finalize", { data: { reserved: false, previous_key: null }, error: null });
  db.queue("ideias", "select", { data: { ...row, audio_transcript: "Já", audio_transcription_status: "done" }, error: null });
  let calls = 0;
  const r = await finalizeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "agencia",
    r2_key: KEY, mime_type: "audio/webm", size_bytes: 5000,
    headObject: headOk, signGetUrl, transcribe: async () => { calls++; return { text: "x" }; },
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.transcript, "Já");
  assertEquals(calls, 0);
});

Deno.test("transcribe: chave órfã (RPC devolve composto nulo) relê a linha", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: row, error: null });
  db.queueRpc("ideia_audio_apply_transcript", { data: { id: null, audio_r2_key: null }, error: null });
  db.queue("ideias", "select", { data: { ...row, audio_r2_key: `${IDEIA_AUDIO_KEY_PREFIX}conta-1/${I}/newer.webm` }, error: null });
  const r = await transcribeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14,
    signGetUrl, transcribe: async () => ({ text: "atrasada" }),
  });
  assertEquals(r.status, 200);
  assertEquals((r.body.audio as { url: string }).url.includes("newer.webm"), true);
});

Deno.test("transcribe: sem áudio -> 404", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { ...row, audio_r2_key: null }, error: null });
  const r = await transcribeIdeiaAudio({
    db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14, signGetUrl, transcribe: null,
  });
  assertEquals(r.status, 404);
});

Deno.test("remove: 404 sem linha, ok sem áudio, RPC release com p_origem", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: null, error: null });
  assertEquals((await removeIdeiaAudio({ db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14 })).status, 404);
  db.queue("ideias", "select", { data: { id: I, audio_r2_key: null }, error: null });
  assertEquals((await removeIdeiaAudio({ db, workspace_id: "conta-1", ideia_id: I, origem: "cliente", cliente_id: 14 })).status, 200);
  db.queue("ideias", "select", { data: { id: I, audio_r2_key: KEY }, error: null });
  db.queueRpc("ideia_audio_release", { data: KEY, error: null });
  const r = await removeIdeiaAudio({ db, workspace_id: "conta-1", ideia_id: I, origem: "agencia" });
  assertEquals(r.status, 200);
  const rpc = db.calls.find((c) => c.table === "rpc:ideia_audio_release");
  assertEquals((rpc?.payload as Record<string, unknown>).p_origem, "agencia");
});

Deno.test("loadIdeiaAudioView: sem filtro de origem; null quando a ideia não existe; audio null sem chave", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ideias", "select", { data: { ...row, audio_transcript: "T" }, error: null });
  const v = await loadIdeiaAudioView({ db, workspace_id: "conta-1", ideia_id: I, signGetUrl });
  assertEquals(v?.transcript, "T");
  assertEquals(v?.audio?.url, `https://get.example.com/${KEY}`);
  const sel = db.calls.find((c) => c.table === "ideias" && c.operation === "select");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "origem"), false);
  db.queue("ideias", "select", { data: null, error: null });
  assertEquals(await loadIdeiaAudioView({ db, workspace_id: "conta-1", ideia_id: I, signGetUrl }), null);
  db.queue("ideias", "select", { data: { ...row, audio_r2_key: null }, error: null });
  const none = await loadIdeiaAudioView({ db, workspace_id: "conta-1", ideia_id: I, signGetUrl });
  assertEquals(none?.audio, null);
});
