// Referências do cliente no post (spec docs/superpowers/specs/2026-10-08-client-post-references-design.md).
// Compartilhado por hub-post-references (token do Hub) e post-references (JWT do CRM).
// Todo resultado é { status, body }; erro é sempre { error: ReferenceErrorCode } para o
// Hub mapear a copy sem ler texto livre (regra de segurança: nunca erro cru de DB).
import { effectivePlanLimit } from "./entitlements-rpc.ts";
import { CONTROL_OR_SPACE } from "./safe-href.ts";

export type ReferenceFileKind = "image" | "video" | "document";

const MB = 1024 * 1024;

export const REFERENCE_MIME: Record<string, { kind: ReferenceFileKind; ext: string; maxBytes: number }> = {
  "image/jpeg": { kind: "image", ext: "jpg", maxBytes: 25 * MB },
  "image/png": { kind: "image", ext: "png", maxBytes: 25 * MB },
  "image/webp": { kind: "image", ext: "webp", maxBytes: 25 * MB },
  "image/gif": { kind: "image", ext: "gif", maxBytes: 25 * MB },
  "application/pdf": { kind: "document", ext: "pdf", maxBytes: 25 * MB },
  "video/mp4": { kind: "video", ext: "mp4", maxBytes: 200 * MB },
  "video/quicktime": { kind: "video", ext: "mov", maxBytes: 200 * MB },
  "video/webm": { kind: "video", ext: "webm", maxBytes: 200 * MB },
};

export const MAX_REFERENCES_PER_POST = 10;
export const MAX_REFERENCE_THUMB_BYTES = 512 * 1024;
export const MAX_REFERENCE_NOTE = 500;
export const MAX_REFERENCE_LINK_TITLE = 120;
export const MAX_REFERENCE_URL = 2048;
/** URLs GET assinadas (arquivo e thumbnail) valem 1h, como em hub-ideias. */
export const REFERENCE_SIGNED_URL_TTL = 3600;

const MAX_REFERENCE_NAME = 200;
const MAX_BLUR_DATA_URL = 10_000;
const MAX_DIMENSION = 100_000;
const MAX_VIDEO_SECONDS = 24 * 3600;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export interface ReferenceItem {
  id: number;
  kind: "file" | "link";
  file_kind: ReferenceFileKind | null;
  name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  url: string | null;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  download_url: string | null; // CRM only, files only; Hub always null
  link_url: string | null;
  link_title: string | null;
  link_domain: string | null;
  note: string | null;
  post_approval_id: number | null;
  created_at: string;
  can_remove: boolean;
}

export type ReferenceErrorCode =
  | "unsupported_type" | "too_large" | "thumbnail_invalid" | "reference_limit"
  | "quota_exceeded" | "post_not_pending" | "invalid_url" | "invalid_note"
  | "not_found" | "locked" | "rate_limited" | "upload_mismatch" | "internal";

export const REFERENCE_ERROR_STATUS: Record<ReferenceErrorCode, number> = {
  unsupported_type: 415,
  too_large: 413,
  thumbnail_invalid: 400,
  reference_limit: 409,
  quota_exceeded: 413,
  post_not_pending: 409,
  invalid_url: 400,
  invalid_note: 400,
  not_found: 404,
  locked: 409,
  rate_limited: 429,
  upload_mismatch: 400,
  internal: 500,
};

export type ReferenceResult = { status: number; body: Record<string, unknown> };

export function referenceError(code: ReferenceErrorCode): ReferenceResult {
  return { status: REFERENCE_ERROR_STATUS[code], body: { error: code } };
}

export type ReferencesDb = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
};

export type SignGetUrl = (key: string, expiresSeconds?: number, downloadName?: string) => Promise<string>;
export type SignPutUrl = (key: string, mime: string) => Promise<string>;
export type HeadObject = (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;

/** Entrada da allowlist, ou null. hasOwnProperty: "toString" não é um tipo de arquivo. */
export function referenceMimeSpec(mime: unknown) {
  if (typeof mime !== "string") return null;
  return Object.prototype.hasOwnProperty.call(REFERENCE_MIME, mime) ? REFERENCE_MIME[mime] : null;
}

export function parsePositiveId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,16}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Política autoritativa de URL de referência (o CHECK do banco é só backstop).
 * trim; sem esquema ganha https://; rejeita controle/espaço em qualquer posição;
 * new URL() absoluto; só http/https; sem usuário/senha; host não vazio; ≤ 2048.
 * Só "esquema://" conta como esquema, então "exemplo.com:8080" vira https e
 * "javascript:x"/"mailto:x" viram host inválido ou credencial e caem fora.
 * isSafeHref não basta: aceita caminho relativo e credenciais.
 */
export function normalizeReferenceUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_REFERENCE_URL) return null;
  if (CONTROL_OR_SPACE.test(trimmed)) return null;
  const candidate = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username !== "" || u.password !== "") return null;
  if (!u.hostname) return null;
  const href = u.href;
  if (href.length > MAX_REFERENCE_URL || CONTROL_OR_SPACE.test(href)) return null;
  return href;
}

export type OptionalText = { ok: true; value: string | null } | { ok: false };

function normalizeOptionalText(raw: unknown, max: number): OptionalText {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  // char_length() conta code points; Array.from também (string.length conta UTF-16).
  if (Array.from(v).length > max) return { ok: false };
  return { ok: true, value: v };
}

export function normalizeReferenceNote(raw: unknown): OptionalText {
  return normalizeOptionalText(raw, MAX_REFERENCE_NOTE);
}

export function normalizeReferenceLinkTitle(raw: unknown): OptionalText {
  return normalizeOptionalText(raw, MAX_REFERENCE_LINK_TITLE);
}

/** Nome exibido e usado no Content-Disposition: sem controle, sem barra, ≤ 200. */
export function sanitizeReferenceName(raw: unknown, ext: string): string {
  const cleaned = typeof raw === "string"
    ? raw.replace(/[\x00-\x1F\x7F]/g, "").replace(/[\\/]/g, "_").trim()
    : "";
  const capped = Array.from(cleaned).slice(0, MAX_REFERENCE_NAME).join("");
  return capped || `referencia.${ext}`;
}

export function linkDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Linha de post_reference_list (Task 1), LEFT JOIN files. */
export interface ReferenceListRow {
  id: number;
  kind: "file" | "link";
  file_id: number | null;
  url: string | null;
  link_title: string | null;
  note: string | null;
  post_approval_id: number | null;
  created_at: string;
  can_remove: boolean;
  name: string | null;
  mime_type: string | null;
  file_kind: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  r2_key: string | null;
  thumbnail_r2_key: string | null;
  blur_data_url: string | null;
}

/** Linha de post_references devolvida pelos RPCs de insert. */
interface ReferenceInsertedRow {
  id: number;
  post_id: number;
  conta_id: string;
  kind: "file" | "link";
  file_id: number | null;
  url: string | null;
  link_title: string | null;
  note: string | null;
  post_approval_id: number | null;
  created_at: string;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isFileKind(v: unknown): v is ReferenceFileKind {
  return v === "image" || v === "video" || v === "document";
}

export async function toReferenceItem(
  row: ReferenceListRow,
  signGetUrl: SignGetUrl,
  opts: { includeDownload: boolean },
): Promise<ReferenceItem> {
  const base = {
    id: Number(row.id),
    note: row.note ?? null,
    post_approval_id: numOrNull(row.post_approval_id),
    created_at: row.created_at,
    can_remove: row.can_remove === true,
  };
  if (row.kind === "link") {
    return {
      ...base,
      kind: "link",
      file_kind: null,
      name: null,
      mime_type: null,
      size_bytes: null,
      duration_seconds: null,
      width: null,
      height: null,
      url: null,
      thumbnail_url: null,
      blur_data_url: null,
      download_url: null,
      link_url: row.url ?? null,
      link_title: row.link_title ?? null,
      link_domain: row.url ? linkDomain(row.url) : null,
    };
  }
  const key = row.r2_key;
  return {
    ...base,
    kind: "file",
    file_kind: isFileKind(row.file_kind) ? row.file_kind : null,
    name: row.name ?? null,
    mime_type: row.mime_type ?? null,
    size_bytes: numOrNull(row.size_bytes),
    duration_seconds: numOrNull(row.duration_seconds),
    width: numOrNull(row.width),
    height: numOrNull(row.height),
    url: key ? await signGetUrl(key, REFERENCE_SIGNED_URL_TTL) : null,
    thumbnail_url: row.thumbnail_r2_key ? await signGetUrl(row.thumbnail_r2_key, REFERENCE_SIGNED_URL_TTL) : null,
    blur_data_url: row.blur_data_url ?? null,
    download_url: opts.includeDownload && key
      ? await signGetUrl(key, REFERENCE_SIGNED_URL_TTL, row.name ?? "referencia")
      : null,
    link_url: null,
    link_title: null,
    link_domain: null,
  };
}

export type ListOutcome = { ok: true; items: ReferenceItem[] } | { ok: false; result: ReferenceResult };

/** post_reference_list já filtra conta_id e calcula can_remove (decisão 2). O chamador
 * confere a posse do post antes (token: cliente+conta; CRM: conta). */
export async function listPostReferences(a: {
  db: ReferencesDb;
  post_id: number;
  conta_id: string;
  signGetUrl: SignGetUrl;
  includeDownload: boolean;
}): Promise<ListOutcome> {
  const { data, error } = await a.db.rpc("post_reference_list", { p_post_id: a.post_id, p_conta: a.conta_id });
  if (error) {
    console.error("[post-references] list failed:", error);
    return { ok: false, result: referenceError("internal") };
  }
  const rows = Array.isArray(data) ? (data as ReferenceListRow[]) : [];
  const items = await Promise.all(
    rows.map((r) => toReferenceItem(r, a.signGetUrl, { includeDownload: a.includeDownload })),
  );
  return { ok: true, items };
}

/** RAISE conhecidos dos RPCs de insert viram código; o resto loga e vira 500 genérico. */
export function mapReferenceRpcError(error: unknown, scope: string): ReferenceResult {
  const raw = (error as { message?: unknown } | null)?.message;
  const msg = typeof raw === "string" ? raw : "";
  if (msg.includes("post_not_found")) return referenceError("not_found");
  if (msg.includes("post_not_pending")) return referenceError("post_not_pending");
  if (msg.includes("reference_limit")) return referenceError("reference_limit");
  if (msg.includes("quota_exceeded")) return referenceError("quota_exceeded");
  // Recheck de chave já usada por outro files dentro do RPC (ver Contract issues).
  if (msg.includes("upload_mismatch")) return referenceError("upload_mismatch");
  console.error(`[${scope}] rpc failed:`, error);
  return referenceError("internal");
}

function isSafeSize(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

function isThumbSize(v: unknown): v is number {
  return isSafeSize(v) && v <= MAX_REFERENCE_THUMB_BYTES;
}

function optionalDimension(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_DIMENSION ? Math.round(v) : null;
}

function optionalDuration(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_VIDEO_SECONDS ? Math.round(v) : null;
}

function optionalBlur(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("data:image/") && v.length <= MAX_BLUR_DATA_URL ? v : null;
}

/** Thumbnail webp obrigatória para imagem/vídeo (files_video_requires_thumbnail),
 * proibida para PDF. */
function presignThumbnailOk(kind: ReferenceFileKind, thumb: unknown): boolean {
  if (kind === "document") return thumb === undefined || thumb === null;
  if (!thumb || typeof thumb !== "object") return false;
  const t = thumb as { mime_type?: unknown; size_bytes?: unknown };
  return t.mime_type === "image/webp" && isThumbSize(t.size_bytes);
}

export async function presignReferenceUpload(a: {
  db: ReferencesDb;
  conta_id: string;
  post_id: number;
  mime_type: unknown;
  size_bytes: unknown;
  thumbnail: unknown;
  signPutUrl: SignPutUrl;
  randomUUID?: () => string;
}): Promise<ReferenceResult> {
  const spec = referenceMimeSpec(a.mime_type);
  if (!spec) return referenceError("unsupported_type");
  const mime = a.mime_type as string;
  if (!isSafeSize(a.size_bytes)) return referenceError("upload_mismatch");
  const size = a.size_bytes;
  if (size > spec.maxBytes) return referenceError("too_large");
  if (!presignThumbnailOk(spec.kind, a.thumbnail)) return referenceError("thumbnail_invalid");

  // Best-effort: o RPC de insert recheca teto e cota sob o lock do post.
  const { count, error: countErr } = await a.db.from("post_references")
    .select("id", { count: "exact", head: true })
    .eq("post_id", a.post_id)
    .eq("conta_id", a.conta_id);
  if (!countErr && (count ?? 0) >= MAX_REFERENCES_PER_POST) return referenceError("reference_limit");

  // Cobra só size_bytes, como o RPC (contracts: thumbnail não entra na cota).
  try {
    const quota = await effectivePlanLimit(a.db as never, a.conta_id, "storage_quota_bytes");
    if (quota !== null) {
      const { data: ws } = await a.db.from("workspaces")
        .select("storage_used_bytes").eq("id", a.conta_id).single();
      if (Number(ws?.storage_used_bytes ?? 0) + size > quota) return referenceError("quota_exceeded");
    }
  } catch (e) {
    console.error("[post-references] quota precheck skipped:", e);
  }

  const uuid = (a.randomUUID ?? crypto.randomUUID.bind(crypto))();
  const stem = `contas/${a.conta_id}/files/${uuid}`;
  const r2_key = `${stem}.${spec.ext}`;
  const thumbnail_r2_key = spec.kind === "document" ? null : `${stem}.thumb.webp`;
  const upload_url = await a.signPutUrl(r2_key, mime);
  const thumbnail_upload_url = thumbnail_r2_key ? await a.signPutUrl(thumbnail_r2_key, "image/webp") : null;
  return { status: 200, body: { upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key } };
}

/** Uma chave que já é de outro files (mídia de post, ideia, Arquivos) nunca vira
 * referência: apagar a referência apagaria o objeto do R2 (file_enqueue_delete) e a
 * mídia do post sumiria. O Hub vê as chaves nas URLs assinadas de hub-posts.
 * null = falha de leitura (o chamador responde 500). */
async function keysAlreadyStored(db: ReferencesDb, keys: string[]): Promise<boolean | null> {
  for (const column of ["r2_key", "thumbnail_r2_key"]) {
    const { data, error } = await db.from("files").select("id").in(column, keys).limit(1);
    if (error) {
      console.error("[post-references] key lookup failed:", error);
      return null;
    }
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return false;
}

export async function finalizeReferenceFile(a: {
  db: ReferencesDb;
  conta_id: string;
  cliente_id: number;
  post_id: number;
  input: Record<string, unknown>;
  headObject: HeadObject;
  signGetUrl: SignGetUrl;
}): Promise<ReferenceResult> {
  const b = a.input;
  const spec = referenceMimeSpec(b.mime_type);
  if (!spec) return referenceError("unsupported_type");
  const mime = b.mime_type as string;
  const sizeRaw = b.size_bytes;
  if (!isSafeSize(sizeRaw)) return referenceError("upload_mismatch");
  const size = sizeRaw;
  if (size > spec.maxBytes) return referenceError("too_large");

  // As chaves têm de ser o par que /upload-url cunhou:
  // contas/{conta}/files/{uuid}.{ext} e, para imagem/vídeo, {uuid}.thumb.webp.
  const prefix = `contas/${a.conta_id}/files/`;
  const r2Key = typeof b.r2_key === "string" ? b.r2_key : "";
  const match = r2Key.startsWith(prefix)
    ? new RegExp(`^(${UUID_RE})\\.${spec.ext}$`).exec(r2Key.slice(prefix.length))
    : null;
  if (!match) return referenceError("upload_mismatch");

  const rawThumbKey = typeof b.thumbnail_r2_key === "string" ? b.thumbnail_r2_key : "";
  const rawThumbBytes = b.thumbnail_bytes;
  let thumbKey: string | null = null;
  let thumbBytes: number | null = null;
  if (spec.kind === "document") {
    if (rawThumbKey !== "" || (rawThumbBytes !== undefined && rawThumbBytes !== null)) {
      return referenceError("thumbnail_invalid");
    }
  } else {
    if (rawThumbKey === "" || !isThumbSize(rawThumbBytes)) return referenceError("thumbnail_invalid");
    if (rawThumbKey !== `${prefix}${match[1]}.thumb.webp`) return referenceError("upload_mismatch");
    thumbKey = rawThumbKey;
    thumbBytes = rawThumbBytes;
  }

  const note = normalizeReferenceNote(b.note);
  if (!note.ok) return referenceError("invalid_note");

  const stored = await keysAlreadyStored(a.db, thumbKey ? [r2Key, thumbKey] : [r2Key]);
  if (stored === null) return referenceError("internal");
  if (stored) return referenceError("upload_mismatch");

  const head = await a.headObject(r2Key);
  if (!head || head.contentLength !== size || (head.contentType && head.contentType !== mime)) {
    return referenceError("upload_mismatch");
  }
  if (thumbKey) {
    const th = await a.headObject(thumbKey);
    if (!th || th.contentLength !== thumbBytes || (th.contentType && th.contentType !== "image/webp")) {
      return referenceError("upload_mismatch");
    }
  }

  const name = sanitizeReferenceName(b.name, spec.ext);
  const width = spec.kind === "document" ? null : optionalDimension(b.width);
  const height = spec.kind === "document" ? null : optionalDimension(b.height);
  const duration = spec.kind === "video" ? optionalDuration(b.duration_seconds) : null;
  const blur = spec.kind === "document" ? null : optionalBlur(b.blur_data_url);

  const { data: inserted, error } = await a.db.rpc("post_reference_file_insert", {
    p: {
      post_id: a.post_id,
      conta_id: a.conta_id,
      cliente_id: a.cliente_id,
      r2_key: r2Key,
      thumbnail_r2_key: thumbKey ?? "",
      name,
      mime_type: mime,
      file_kind: spec.kind,
      size_bytes: size,
      width,
      height,
      duration_seconds: duration,
      blur_data_url: blur,
      note: note.value,
    },
  }).single();
  if (error) return mapReferenceRpcError(error, "post-references:file-insert");
  const ref = inserted as ReferenceInsertedRow | null;
  if (!ref) {
    console.error("[post-references:file-insert] rpc returned no row");
    return referenceError("internal");
  }

  // Recém-criada: nenhuma ação da equipe pode ser posterior a ela, então can_remove = true.
  const item = await toReferenceItem({
    id: ref.id, kind: "file", file_id: ref.file_id, url: null, link_title: null,
    note: ref.note ?? null, post_approval_id: null, created_at: ref.created_at, can_remove: true,
    name, mime_type: mime, file_kind: spec.kind, size_bytes: size, width, height,
    duration_seconds: duration, r2_key: r2Key, thumbnail_r2_key: thumbKey, blur_data_url: blur,
  }, a.signGetUrl, { includeDownload: false });
  return { status: 201, body: { item } };
}

export async function insertReferenceLink(a: {
  db: ReferencesDb;
  conta_id: string;
  cliente_id: number;
  post_id: number;
  input: Record<string, unknown>;
  signGetUrl: SignGetUrl;
}): Promise<ReferenceResult> {
  const b = a.input;
  const url = normalizeReferenceUrl(typeof b.url === "string" ? b.url : "");
  if (!url) return referenceError("invalid_url");
  const title = normalizeReferenceLinkTitle(b.title);
  if (!title.ok) return referenceError("invalid_note");
  const note = normalizeReferenceNote(b.note);
  if (!note.ok) return referenceError("invalid_note");

  const { data: inserted, error } = await a.db.rpc("post_reference_link_insert", {
    p: {
      post_id: a.post_id,
      conta_id: a.conta_id,
      cliente_id: a.cliente_id,
      url,
      link_title: title.value,
      note: note.value,
    },
  }).single();
  if (error) return mapReferenceRpcError(error, "post-references:link-insert");
  const ref = inserted as ReferenceInsertedRow | null;
  if (!ref) {
    console.error("[post-references:link-insert] rpc returned no row");
    return referenceError("internal");
  }

  const item = await toReferenceItem({
    id: ref.id, kind: "link", file_id: null, url: ref.url ?? url, link_title: ref.link_title ?? title.value,
    note: ref.note ?? null, post_approval_id: null, created_at: ref.created_at, can_remove: true,
    name: null, mime_type: null, file_kind: null, size_bytes: null, width: null, height: null,
    duration_seconds: null, r2_key: null, thumbnail_r2_key: null, blur_data_url: null,
  }, a.signGetUrl, { includeDownload: false });
  return { status: 201, body: { item } };
}
