import { effectivePlanLimit } from "./entitlements-rpc.ts";

export const BRIEFING_AUDIO_MIME = ["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav"];
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MiB
export const AUDIO_KEY_PREFIX = "briefing-audio/";
export const AUDIO_COLUMNS =
  "audio_r2_key, audio_mime, audio_size_bytes, audio_duration_seconds, audio_transcription_status, audio_recorded_at";

export type BriefingAudioResult = { status: number; body: Record<string, unknown> };
export type BriefingAudioDb = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
};
export type Transcriber = (key: string) => Promise<{ text: string; duration?: number } | null>;
export type TranscriptionStatus = "pending" | "done" | "failed";

export interface AudioRow {
  audio_r2_key: string | null;
  audio_mime: string | null;
  audio_size_bytes: number | null;
  audio_duration_seconds: number | null;
  audio_transcription_status: string | null;
  audio_recorded_at: string | null;
}

export interface AudioView {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: TranscriptionStatus | null;
  recorded_at: string | null;
}

export function normalizeAudioMime(raw: string | null | undefined): string | null {
  const base = (raw ?? "").split(";")[0].trim().toLowerCase();
  return BRIEFING_AUDIO_MIME.includes(base) ? base : null;
}

export function extFromAudioMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav",
  };
  return map[mime] ?? "bin";
}

export function appendTranscript(answer: string | null | undefined, text: string): string {
  const current = answer ?? "";
  const base = current.trim() ? current.trimEnd() + "\n\n" : "";
  return base + text.trim();
}

export async function buildAudioView(
  row: AudioRow, signGetUrl: (key: string) => Promise<string>,
): Promise<AudioView | null> {
  if (!row.audio_r2_key) return null;
  const status = row.audio_transcription_status;
  return {
    url: await signGetUrl(row.audio_r2_key),
    mime: row.audio_mime ?? "audio/webm",
    duration_seconds: row.audio_duration_seconds ?? null,
    transcription_status: status === "pending" || status === "done" || status === "failed" ? status : null,
    recorded_at: row.audio_recorded_at ?? null,
  };
}

function validSize(n: number | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_AUDIO_BYTES;
}

export interface PresignAudioArgs {
  db: BriefingAudioDb;
  conta_id: string;
  cliente_id: number;
  question_id: string;
  mime_type: string;
  size_bytes: number;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  randomUUID?: () => string;
}

export async function presignBriefingAudio(a: PresignAudioArgs): Promise<BriefingAudioResult> {
  const mime = normalizeAudioMime(a.mime_type);
  if (!mime) return { status: 415, body: { error: "unsupported file type" } };
  if (!validSize(a.size_bytes)) return { status: 400, body: { error: "size_bytes out of range" } };

  const { data: q } = await a.db.from("hub_briefing_questions")
    .select("id, audio_size_bytes").eq("id", a.question_id).eq("cliente_id", a.cliente_id).eq("conta_id", a.conta_id)
    .maybeSingle();
  if (!q) return { status: 404, body: { error: "Pergunta não encontrada." } };

  // Best-effort early quota check (authoritative check is in the RPC at finalize).
  // Nets out this question's current audio_size_bytes, mirroring the RPC's
  // `v_used - COALESCE(v_prev_bytes,0) + p_bytes`: a re-record replaces the
  // existing audio, so its bytes shouldn't count twice against the quota.
  try {
    const { data: ws } = await a.db.from("workspaces")
      .select("storage_used_bytes").eq("id", a.conta_id).single();
    const quota = await effectivePlanLimit(a.db as never, a.conta_id, "storage_quota_bytes");
    if (quota !== null) {
      const used = Number(ws?.storage_used_bytes ?? 0) - Number(q.audio_size_bytes ?? 0);
      if (used + a.size_bytes > quota) {
        return { status: 413, body: { error: "quota_exceeded", used, quota } };
      }
    }
  } catch (e) {
    console.error("briefing-audio presign quota check error:", (e as Error).message ?? e);
    return { status: 500, body: { error: "internal error" } };
  }

  const id = (a.randomUUID ?? crypto.randomUUID.bind(crypto))();
  const r2_key = `${AUDIO_KEY_PREFIX}${a.conta_id}/${a.question_id}/${id}.${extFromAudioMime(mime)}`;
  const upload_url = await a.signPutUrl(r2_key, mime);
  return { status: 200, body: { upload_url, r2_key, mime_type: mime } };
}

function rpcErrorStatus(msg: string): number {
  if (msg.includes("quota_exceeded")) return 413;
  if (msg.includes("question_not_found")) return 404;
  if (msg.includes("invalid_key") || msg.includes("invalid_bytes")) return 400;
  return 500;
}

interface TranscriptionArgs {
  db: BriefingAudioDb;
  conta_id: string;
  cliente_id: number;
  question_id: string;
  signGetUrl: (key: string) => Promise<string>;
  transcribe: Transcriber | null;
}

type FullRow = AudioRow & { answer: string | null; audio_transcript?: string | null };

async function loadRow(
  db: BriefingAudioDb, conta_id: string, cliente_id: number, question_id: string,
): Promise<FullRow | null> {
  // Escopo por cliente_id além de conta_id: o token do hub é de UM cliente e
  // question_id vem da URL; sem isso um cliente lê a resposta e o áudio de outro
  // cliente da mesma workspace.
  const { data } = await db.from("hub_briefing_questions")
    .select(`answer, audio_transcript, ${AUDIO_COLUMNS}`)
    .eq("id", question_id).eq("conta_id", conta_id).eq("cliente_id", cliente_id)
    .maybeSingle();
  return (data as FullRow | null) ?? null;
}

async function runTranscription(a: TranscriptionArgs): Promise<BriefingAudioResult> {
  const row = await loadRow(a.db, a.conta_id, a.cliente_id, a.question_id);
  if (!row?.audio_r2_key) return { status: 404, body: { error: "Áudio não encontrado." } };
  if (row.audio_transcription_status === "done") {
    // Already transcribed — a retry (finalize idempotent RPC or a duplicate
    // transcribe call) must not re-run Whisper or append the text again.
    return {
      status: 200,
      body: {
        ok: true,
        answer: row.answer ?? null,
        transcript: row.audio_transcript ?? null,
        audio: await buildAudioView(row, a.signGetUrl),
      },
    };
  }

  let result: { text: string; duration?: number } | null = null;
  if (a.transcribe) {
    try {
      result = await a.transcribe(row.audio_r2_key);
    } catch (e) {
      console.error("briefing-audio transcribe error:", (e as Error).message);
      result = null;
    }
  }
  const text = result?.text?.trim() ?? "";
  const where = (q: ReturnType<BriefingAudioDb["from"]>) =>
    q.eq("id", a.question_id).eq("conta_id", a.conta_id).eq("cliente_id", a.cliente_id);

  if (!text) {
    // Same neq guard as the success write below: if a concurrent run already
    // flipped the row to "done", this failure must not downgrade it back.
    await where(a.db.from("hub_briefing_questions").update({ audio_transcription_status: "failed" })).neq(
      "audio_transcription_status",
      "done",
    );
    // Re-read after the (possibly no-op) write so the response reflects
    // whatever actually ended up on the row instead of an assumed "failed".
    const current = await loadRow(a.db, a.conta_id, a.cliente_id, a.question_id);
    const finalRow = current ?? { ...row, audio_transcription_status: "failed" };
    return {
      status: 200,
      body: {
        ok: true,
        answer: finalRow.answer ?? null,
        transcript: finalRow.audio_transcript ?? null,
        audio: await buildAudioView(finalRow, a.signGetUrl),
      },
    };
  }

  const answer = appendTranscript(row.answer, text);
  const resultDuration = result?.duration;
  const duration = row.audio_duration_seconds ??
    (typeof resultDuration === "number" && Number.isFinite(resultDuration) && resultDuration > 0
      ? Math.round(resultDuration)
      : null);
  // Conditioned on audio_transcription_status != "done": guards against two
  // concurrent retries both reading the same `answer` and racing to append the
  // transcript twice. Whichever write lands first flips the row to "done" and
  // the loser's UPDATE matches zero rows.
  const { data: updated, error } = await where(a.db.from("hub_briefing_questions").update({
    answer,
    audio_transcript: text,
    audio_transcription_status: "done",
    audio_duration_seconds: duration,
  })).neq("audio_transcription_status", "done").select("id");
  if (error) {
    console.error("briefing-audio save transcript error:", (error as { message?: string }).message ?? error);
    return { status: 500, body: { error: "internal error" } };
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    // Concurrent run won the race and already wrote "done" — re-read and return
    // its answer/transcript instead of appending on top of it.
    const current = await loadRow(a.db, a.conta_id, a.cliente_id, a.question_id);
    return {
      status: 200,
      body: {
        ok: true,
        answer: current?.answer ?? row.answer ?? null,
        transcript: current?.audio_transcript ?? null,
        audio: await buildAudioView(current ?? row, a.signGetUrl),
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      answer,
      transcript: text,
      audio: await buildAudioView(
        { ...row, audio_transcription_status: "done", audio_duration_seconds: duration }, a.signGetUrl,
      ),
    },
  };
}

export interface FinalizeAudioArgs extends TranscriptionArgs {
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number | null;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
}

export async function finalizeBriefingAudio(a: FinalizeAudioArgs): Promise<BriefingAudioResult> {
  const mime = normalizeAudioMime(a.mime_type);
  if (!mime) return { status: 415, body: { error: "unsupported file type" } };
  const prefix = `${AUDIO_KEY_PREFIX}${a.conta_id}/${a.question_id}/`;
  if (typeof a.r2_key !== "string" || !a.r2_key.startsWith(prefix)) {
    return { status: 400, body: { error: "invalid r2_key" } };
  }
  if (!validSize(a.size_bytes)) return { status: 400, body: { error: "size_bytes out of range" } };

  const head = await a.headObject(a.r2_key);
  if (!head) return { status: 400, body: { error: "object not found" } };
  if (head.contentLength !== a.size_bytes) return { status: 400, body: { error: "size mismatch" } };
  if (head.contentType && normalizeAudioMime(head.contentType) !== mime) {
    return { status: 400, body: { error: "content-type mismatch" } };
  }

  const duration = typeof a.duration_seconds === "number" && Number.isFinite(a.duration_seconds) && a.duration_seconds > 0
    ? Math.round(a.duration_seconds)
    : null;
  const { data, error } = await a.db.rpc("briefing_audio_finalize", {
    p_conta_id: a.conta_id,
    p_cliente_id: a.cliente_id,
    p_question_id: a.question_id,
    p_key: a.r2_key,
    p_bytes: a.size_bytes,
    p_mime: mime,
    p_duration: duration,
  });
  if (error) {
    const msg = (error as { message?: string }).message ?? "finalize failed";
    const status = rpcErrorStatus(msg);
    if (status === 500) {
      console.error("briefing_audio_finalize error:", msg);
      return { status: 500, body: { error: "internal error" } };
    }
    return { status, body: { error: msg } };
  }

  // The RPC is idempotent on a same-key retry (timeout on the up-to-90s
  // synchronous transcription, or a double click): it reports reserved:false
  // instead of re-reserving quota. Route through transcribeBriefingAudio,
  // which — via runTranscription's "already done" guard — skips a duplicate
  // paid Whisper call and a duplicate transcript append.
  if (data && typeof data === "object" && (data as { reserved?: boolean }).reserved === false) {
    return transcribeBriefingAudio(a);
  }

  return runTranscription(a);
}

export type TranscribeAudioArgs = TranscriptionArgs;

export async function transcribeBriefingAudio(a: TranscribeAudioArgs): Promise<BriefingAudioResult> {
  // The "already done" short-circuit (and the 404 for a missing/removed audio)
  // lives in runTranscription now, shared with finalizeBriefingAudio's retry path.
  return runTranscription(a);
}

export interface RemoveAudioArgs {
  db: BriefingAudioDb;
  conta_id: string;
  cliente_id: number;
  question_id: string;
}

export async function removeBriefingAudio(a: RemoveAudioArgs): Promise<BriefingAudioResult> {
  const { data: q } = await a.db.from("hub_briefing_questions")
    .select("id, audio_r2_key").eq("id", a.question_id).eq("cliente_id", a.cliente_id).eq("conta_id", a.conta_id)
    .maybeSingle();
  if (!q) return { status: 404, body: { error: "Pergunta não encontrada." } };
  if (!q.audio_r2_key) return { status: 200, body: { ok: true } };
  const { error } = await a.db.rpc("briefing_audio_release", {
    p_conta_id: a.conta_id, p_cliente_id: a.cliente_id, p_question_id: a.question_id,
  });
  if (error) {
    console.error("briefing_audio_release error:", (error as { message?: string }).message ?? error);
    return { status: 500, body: { error: "internal error" } };
  }
  return { status: 200, body: { ok: true } };
}

export function makeWorkerTranscriber(opts: {
  url?: string | null;
  secret?: string | null;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): Transcriber | null {
  const url = (opts.url ?? "").trim();
  const secret = (opts.secret ?? "").trim();
  if (!url || !secret) return null;
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async (key: string) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error("briefing-audio worker status:", res.status);
      return null;
    }
    const body = (await res.json().catch(() => null)) as { text?: unknown; duration?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return null;
    return { text, duration: typeof body?.duration === "number" ? body.duration : undefined };
  };
}
