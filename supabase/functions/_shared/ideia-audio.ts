// Áudio nas ideias: irmão de briefing-audio.ts, apontando para `ideias`.
// Reusa os helpers genéricos de lá; o que muda é a tabela, o escopo
// (workspace_id + ideia_id + origem [+ cliente_id no Hub]) e o fato de a
// transcrição NÃO ser anexada à descrição.
import { effectivePlanLimit } from "./entitlements-rpc.ts";
import {
  AUDIO_COLUMNS,
  buildAudioView,
  extFromAudioMime,
  MAX_AUDIO_BYTES,
  normalizeAudioMime,
  normalizeDuration,
  type AudioRow,
  type AudioView,
  type BriefingAudioDb,
  type Transcriber,
} from "./briefing-audio.ts";

export { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, makeWorkerTranscriber } from "./briefing-audio.ts";
export type { AudioView, Transcriber } from "./briefing-audio.ts";

export const IDEIA_AUDIO_KEY_PREFIX = "ideia-audio/";
export const IDEIA_AUDIO_COLUMNS = AUDIO_COLUMNS;

export type IdeiaOrigem = "cliente" | "agencia";
export type IdeiaAudioResult = { status: number; body: Record<string, unknown> };

export interface IdeiaAudioScope {
  db: BriefingAudioDb;
  workspace_id: string;
  ideia_id: string;
  /** Lado que pode escrever. O Hub passa 'cliente' (+ cliente_id do token); o CRM passa 'agencia'. */
  origem: IdeiaOrigem;
  cliente_id?: number | null;
}

type FullRow = AudioRow & { id?: string | null; audio_transcript?: string | null };

function validSize(n: number | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_AUDIO_BYTES;
}

function scoped(q: ReturnType<BriefingAudioDb["from"]>, a: IdeiaAudioScope) {
  let s = q.eq("id", a.ideia_id).eq("workspace_id", a.workspace_id).eq("origem", a.origem);
  if (a.cliente_id != null) s = s.eq("cliente_id", a.cliente_id);
  return s;
}

function rpcErrorStatus(msg: string): number {
  if (msg.includes("quota_exceeded")) return 413;
  if (msg.includes("ideia_not_found")) return 404;
  if (msg.includes("invalid_key") || msg.includes("invalid_bytes")) return 400;
  return 500;
}

/** PostgREST expande `RETURNS ideias`: composto NULL vira UMA linha toda nula. `id` separa "atualizou" de "não casou". */
function rpcRow(data: unknown): FullRow | null {
  const row = (Array.isArray(data) ? data[0] : data) as FullRow | null | undefined;
  if (!row || typeof row !== "object" || row.id == null) return null;
  return row;
}

async function loadRow(a: IdeiaAudioScope): Promise<FullRow | null> {
  const { data } = await scoped(
    a.db.from("ideias").select(`id, audio_transcript, ${IDEIA_AUDIO_COLUMNS}`),
    a,
  ).maybeSingle();
  return (data as FullRow | null) ?? null;
}

async function view(row: FullRow, signGetUrl: (key: string) => Promise<string>): Promise<IdeiaAudioResult> {
  return {
    status: 200,
    body: { ok: true, transcript: row.audio_transcript ?? null, audio: await buildAudioView(row, signGetUrl) },
  };
}

export async function presignIdeiaAudio(a: IdeiaAudioScope & {
  mime_type: string;
  size_bytes: number;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  randomUUID?: () => string;
}): Promise<IdeiaAudioResult> {
  const mime = normalizeAudioMime(a.mime_type);
  if (!mime) return { status: 415, body: { error: "unsupported file type" } };
  if (!validSize(a.size_bytes)) return { status: 400, body: { error: "size_bytes out of range" } };

  const { data: row } = await scoped(a.db.from("ideias").select("id, audio_size_bytes"), a).maybeSingle();
  if (!row) return { status: 404, body: { error: "Ideia não encontrada." } };

  try {
    const { data: ws } = await a.db.from("workspaces").select("storage_used_bytes").eq("id", a.workspace_id).single();
    const quota = await effectivePlanLimit(a.db as never, a.workspace_id, "storage_quota_bytes");
    if (quota !== null) {
      const used = Number(ws?.storage_used_bytes ?? 0) - Number(row.audio_size_bytes ?? 0);
      if (used + a.size_bytes > quota) return { status: 413, body: { error: "quota_exceeded", used, quota } };
    }
  } catch (e) {
    console.error("ideia-audio presign quota check error:", (e as Error).message ?? e);
    return { status: 500, body: { error: "internal error" } };
  }

  const id = (a.randomUUID ?? crypto.randomUUID.bind(crypto))();
  const r2_key = `${IDEIA_AUDIO_KEY_PREFIX}${a.workspace_id}/${a.ideia_id}/${id}.${extFromAudioMime(mime)}`;
  const upload_url = await a.signPutUrl(r2_key, mime);
  return { status: 200, body: { upload_url, r2_key, mime_type: mime } };
}

interface TranscriptionArgs extends IdeiaAudioScope {
  signGetUrl: (key: string) => Promise<string>;
  transcribe: Transcriber | null;
}

async function runTranscription(a: TranscriptionArgs): Promise<IdeiaAudioResult> {
  const row = await loadRow(a);
  if (!row?.audio_r2_key) return { status: 404, body: { error: "Áudio não encontrado." } };
  // Capturada ANTES da chamada (até 90s): toda escrita abaixo é amarrada a esta chave.
  const key = row.audio_r2_key;
  if (row.audio_transcription_status === "done") return view(row, a.signGetUrl);

  let result: { text: string; duration?: number } | null = null;
  if (a.transcribe) {
    try {
      result = await a.transcribe(key);
    } catch (e) {
      console.error("ideia-audio transcribe error:", (e as Error).message);
      result = null;
    }
  }
  const text = result?.text?.trim() ?? "";

  if (!text) {
    await scoped(a.db.from("ideias").update({ audio_transcription_status: "failed" }), a)
      .eq("audio_r2_key", key)
      .neq("audio_transcription_status", "done");
    const current = await loadRow(a);
    return view(current ?? { ...row, audio_transcription_status: "failed" }, a.signGetUrl);
  }

  const { data: applied, error } = await a.db.rpc("ideia_audio_apply_transcript", {
    p_workspace_id: a.workspace_id,
    p_ideia_id: a.ideia_id,
    p_key: key,
    p_text: text,
    p_duration: normalizeDuration(result?.duration),
  });
  if (error) {
    console.error("ideia_audio_apply_transcript error:", (error as { message?: string }).message ?? error);
    return { status: 500, body: { error: "internal error" } };
  }
  const updated = rpcRow(applied);
  if (!updated) {
    const fresh = await loadRow(a);
    if (!fresh?.audio_r2_key) return { status: 404, body: { error: "Áudio não encontrado." } };
    return view(fresh, a.signGetUrl);
  }
  return view(updated, a.signGetUrl);
}

export async function finalizeIdeiaAudio(a: TranscriptionArgs & {
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number | null;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
}): Promise<IdeiaAudioResult> {
  const mime = normalizeAudioMime(a.mime_type);
  if (!mime) return { status: 415, body: { error: "unsupported file type" } };
  const prefix = `${IDEIA_AUDIO_KEY_PREFIX}${a.workspace_id}/${a.ideia_id}/`;
  if (typeof a.r2_key !== "string" || !a.r2_key.startsWith(prefix) || a.r2_key.includes("..")) {
    return { status: 400, body: { error: "invalid r2_key" } };
  }
  if (!validSize(a.size_bytes)) return { status: 400, body: { error: "size_bytes out of range" } };

  const head = await a.headObject(a.r2_key);
  if (!head) return { status: 400, body: { error: "object not found" } };
  if (head.contentLength !== a.size_bytes) return { status: 400, body: { error: "size mismatch" } };
  if (head.contentType && normalizeAudioMime(head.contentType) !== mime) {
    return { status: 400, body: { error: "content-type mismatch" } };
  }

  const { data: own } = await scoped(a.db.from("ideias").select("id"), a).maybeSingle();
  if (!own) return { status: 404, body: { error: "Ideia não encontrada." } };

  const { data, error } = await a.db.rpc("ideia_audio_finalize", {
    p_workspace_id: a.workspace_id,
    p_ideia_id: a.ideia_id,
    p_origem: a.origem,
    p_key: a.r2_key,
    p_bytes: a.size_bytes,
    p_mime: mime,
    p_duration: normalizeDuration(a.duration_seconds),
  });
  if (error) {
    const msg = (error as { message?: string }).message ?? "finalize failed";
    const status = rpcErrorStatus(msg);
    if (status === 500) {
      console.error("ideia_audio_finalize error:", msg);
      return { status: 500, body: { error: "internal error" } };
    }
    return { status, body: { error: msg } };
  }
  // reserved:false = retry da mesma chave; runTranscription pula Whisper se já 'done'.
  return runTranscription(a);
}

export function transcribeIdeiaAudio(a: TranscriptionArgs): Promise<IdeiaAudioResult> {
  return runTranscription(a);
}

export async function removeIdeiaAudio(a: IdeiaAudioScope): Promise<IdeiaAudioResult> {
  const { data: row } = await scoped(a.db.from("ideias").select("id, audio_r2_key, descricao"), a).maybeSingle();
  if (!row) return { status: 404, body: { error: "Ideia não encontrada." } };
  if (!row.audio_r2_key) return { status: 200, body: { ok: true } };
  // descricao is optional precisely because audio can carry the content instead --
  // removing the only audio off a text-less ideia would leave it with neither.
  if (!(row as { descricao?: string | null }).descricao) {
    return { status: 400, body: { error: "descricao obrigatória" } };
  }
  const { error } = await a.db.rpc("ideia_audio_release", {
    p_workspace_id: a.workspace_id, p_ideia_id: a.ideia_id, p_origem: a.origem,
  });
  if (error) {
    console.error("ideia_audio_release error:", (error as { message?: string }).message ?? error);
    return { status: 500, body: { error: "internal error" } };
  }
  return { status: 200, body: { ok: true } };
}

/** Leitura para os dois lados: sem filtro de origem. `null` = ideia inexistente. */
export async function loadIdeiaAudioView(a: {
  db: BriefingAudioDb;
  workspace_id: string;
  ideia_id: string;
  cliente_id?: number | null;
  signGetUrl: (key: string) => Promise<string>;
}): Promise<{ audio: AudioView | null; transcript: string | null } | null> {
  let q = a.db.from("ideias").select(`id, audio_transcript, ${IDEIA_AUDIO_COLUMNS}`)
    .eq("id", a.ideia_id).eq("workspace_id", a.workspace_id);
  if (a.cliente_id != null) q = q.eq("cliente_id", a.cliente_id);
  const { data } = await q.maybeSingle();
  const row = data as FullRow | null;
  if (!row) return null;
  return { audio: await buildAudioView(row, a.signGetUrl), transcript: row.audio_transcript ?? null };
}

/** View de áudio a partir de uma linha já carregada (GET de lista). Inclui o transcript. */
export async function buildAudioViewForIdeia(
  row: AudioRow & { audio_transcript?: string | null },
  signGetUrl: (key: string) => Promise<string>,
): Promise<(AudioView & { transcript: string | null }) | null> {
  const v = await buildAudioView(row, signGetUrl);
  return v ? { ...v, transcript: row.audio_transcript ?? null } : null;
}
