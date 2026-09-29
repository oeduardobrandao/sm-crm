// Validação de séries e vídeos tutoriais da Central de Ajuda (kb_video_series, kb_videos).
// Usado por platform-admin/kb-videos.ts. Linha MESCLADA em update (current + campos novos).
import { RESERVED_SLUGS, SLUG_RE } from "./admin-kb.ts";

export const KB_VIDEO_SERIES_COLUMNS = ["title", "slug", "description", "display_order", "status"] as const;
export const KB_VIDEO_COLUMNS = [
  "title", "slug", "description", "article_id", "series_id", "display_order", "status",
] as const;
/** Escritas só pelo upload, pelo refresh, pelo cancelamento e pelo stream-webhook. */
export const KB_VIDEO_STREAM_COLUMNS = [
  "stream_uid", "stream_status", "stream_upload_expires_at", "duration_seconds", "hls_url", "thumbnail_url",
] as const;

export const KB_VIDEO_MAX_DURATION_S = 900;
export const KB_VIDEO_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_DISPLAY_ORDER = 10_000;
const MAX_DESCRIPTION = 500;

export function pickColumns(body: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (body[col] !== undefined) out[col] = body[col];
  }
  return out;
}

export function hasStreamColumns(body: Record<string, unknown>): boolean {
  return KB_VIDEO_STREAM_COLUMNS.some((col) => col in body);
}

export function normalizeKbVideoRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const col of ["title", "slug"] as const) {
    if (typeof out[col] === "string") out[col] = (out[col] as string).trim();
  }
  for (const col of ["description", "article_id"] as const) {
    if (typeof out[col] === "string") {
      const t = (out[col] as string).trim();
      out[col] = t.length > 0 ? t : null;
    }
  }
  return out;
}

function validateCommon(row: Record<string, unknown>): string | null {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (title.length === 0 || title.length > 200) return "title required (max 200)";
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!SLUG_RE.test(slug)) return "slug must be lowercase words separated by hyphens";
  if (RESERVED_SLUGS.includes(slug)) return `slug "${slug}" is reserved`;
  const description = row.description ?? null;
  if (description !== null && (typeof description !== "string" || description.length > MAX_DESCRIPTION)) {
    return `description max ${MAX_DESCRIPTION}`;
  }
  if (row.display_order !== undefined && row.display_order !== null) {
    const order = row.display_order;
    if (!Number.isInteger(order) || (order as number) < 0 || (order as number) > MAX_DISPLAY_ORDER) {
      return `display_order must be an integer between 0 and ${MAX_DISPLAY_ORDER}`;
    }
  }
  const status = row.status ?? "draft";
  if (status !== "draft" && status !== "published") return "invalid status";
  return null;
}

export function validateKbVideoSeries(row: Record<string, unknown>): string | null {
  return validateCommon(row);
}

export function validateKbVideo(
  row: Record<string, unknown>,
  opts?: { alreadyPublished?: boolean },
): string | null {
  const common = validateCommon(row);
  if (common) return common;
  if (typeof row.series_id !== "string" || row.series_id.length === 0) return "series_id is required";
  const articleId = row.article_id ?? null;
  if (articleId !== null && (typeof articleId !== "string" || articleId.length === 0)) return "invalid article_id";
  // A exigência de "ready + HLS" só vale na TRANSIÇÃO para published (linha nova já publicada, ou
  // draft -> published). Uma linha já publicada continua editável mesmo com o arquivo em
  // reprocessamento (stream_status volta a pending ao trocar o arquivo) -- o RLS já esconde o
  // vídeo do Hub enquanto isso, e ele reaparece sozinho quando o refresh o marcar ready de novo.
  if ((row.status ?? "draft") === "published" && !opts?.alreadyPublished) {
    if (row.stream_status !== "ready" || typeof row.hls_url !== "string" || row.hls_url.length === 0) {
      return "only a ready video can be published";
    }
  }
  return null;
}
