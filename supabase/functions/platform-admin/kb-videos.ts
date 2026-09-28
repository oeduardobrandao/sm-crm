// Actions do Admin para os vídeos tutoriais da Central de Ajuda (spec
// 2026-09-28-ajuda-video-playlist-design). Handlers exportados para teste direto, no padrão de
// popups.ts. A autorização (platform_admins) já aconteceu em index.ts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isUniqueViolation } from "../_shared/admin-kb.ts";
import {
  hasStreamColumns,
  KB_VIDEO_COLUMNS,
  KB_VIDEO_MAX_DURATION_S,
  KB_VIDEO_SERIES_COLUMNS,
  KB_VIDEO_UPLOAD_TTL_MS,
  normalizeKbVideoRow,
  pickColumns,
  validateKbVideo,
  validateKbVideoSeries,
} from "../_shared/admin-kb-videos.ts";
import type { StreamVideoInfo } from "../_shared/stream.ts";

type Svc = SupabaseClient;
type Headers = Record<string, string>;
type Row = Record<string, unknown>;

export interface KbVideoStreamDeps {
  enabled(): boolean;
  createDirectUpload(
    opts: { maxDurationSeconds: number; expiry: string; meta: Record<string, string> },
  ): Promise<{ uid: string; uploadURL: string }>;
  getVideo(uid: string): Promise<StreamVideoInfo>;
  deleteVideo(uid: string): Promise<void>;
  now(): number;
}

const MAX_REORDER_ITEMS = 200;
const MAX_DISPLAY_ORDER = 10_000;

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function isFkViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "23503";
}

// Estrito por convenção do repo (parseInt + guard, nunca Number() bruto): uma string só passa
// se for inteiro positivo em dígitos puros -- rejeita notação científica ("1e3"), hex ("0x10"),
// espaço, ponto decimal e sufixos ("12abc"), que Number() aceitaria silenciosamente.
const VIDEO_ID_RE = /^[1-9][0-9]*$/;

function parseVideoId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && VIDEO_ID_RE.test(value)) {
    const n = parseInt(value, 10);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

async function bestEffortDelete(stream: KbVideoStreamDeps, uid: string, scope: string): Promise<void> {
  try {
    await stream.deleteVideo(uid);
  } catch (err) {
    // O orphan reap remove depois: este uid deixou de ser conhecido por kb_videos.
    console.error(`[platform-admin:${scope}] stream delete failed`, uid, err);
  }
}

async function readVideo(svc: Svc, id: number): Promise<Row | null> {
  const { data, error } = await svc.from("kb_videos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

/** Guarded write out of `pending`: matches only while the row still holds `uid`, so a newer upload
 * is never overwritten. Returns the updated row, or null when nothing matched. */
async function settlePending(svc: Svc, id: number, uid: string, patch: Row): Promise<Row | null> {
  const { data, error } = await svc
    .from("kb_videos")
    .update(patch)
    .eq("id", id)
    .eq("stream_uid", uid)
    .eq("stream_status", "pending")
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

async function clearUpload(svc: Svc, stream: KbVideoStreamDeps, id: number, uid: string): Promise<Row | null> {
  const video = await settlePending(svc, id, uid, {
    stream_uid: null,
    stream_status: "error",
    stream_upload_expires_at: null,
  });
  if (video) await bestEffortDelete(stream, uid, "kb-video-clear");
  return video;
}

// ─── Séries ──────────────────────────────────────────────────────

export async function handleListKbVideoSeries(svc: Svc, headers: Headers) {
  const { data, error } = await svc
    .from("kb_video_series")
    .select("*")
    .order("display_order", { ascending: true });
  if (error) throw error;
  return json({ series: data ?? [] }, 200, headers);
}

export async function handleUpsertKbVideoSeries(svc: Svc, body: Row, headers: Headers) {
  const seriesId = typeof body.series_id === "string" && body.series_id ? body.series_id : null;
  const fields = normalizeKbVideoRow(pickColumns(body, KB_VIDEO_SERIES_COLUMNS));
  let merged = fields;
  if (seriesId) {
    const { data: current, error } = await svc.from("kb_video_series").select("*").eq("id", seriesId).maybeSingle();
    if (error) throw error;
    if (!current) return json({ error: "Series not found" }, 404, headers);
    merged = { ...(current as Row), ...fields };
  }
  const fieldError = validateKbVideoSeries(merged);
  if (fieldError) return json({ error: fieldError }, 400, headers);

  const { data, error } = seriesId
    ? await svc.from("kb_video_series").update(fields).eq("id", seriesId).select().single()
    : await svc.from("kb_video_series").insert(fields).select().single();
  if (error) {
    if (isUniqueViolation(error)) return json({ error: "slug already in use" }, 409, headers);
    throw error;
  }
  return json({ series: data }, seriesId ? 200 : 201, headers);
}

export async function handleDeleteKbVideoSeries(svc: Svc, body: Row, headers: Headers) {
  const seriesId = typeof body.series_id === "string" && body.series_id ? body.series_id : null;
  if (!seriesId) return json({ error: "series_id is required" }, 400, headers);
  const { error } = await svc.from("kb_video_series").delete().eq("id", seriesId);
  if (error) {
    if (isFkViolation(error)) return json({ error: "series has videos" }, 409, headers);
    throw error;
  }
  return json({ message: "Series deleted" }, 200, headers);
}

// ─── Vídeos ──────────────────────────────────────────────────────

export async function handleListKbVideos(svc: Svc, headers: Headers) {
  const { data, error } = await svc.from("kb_videos").select("*").order("display_order", { ascending: true });
  if (error) throw error;
  return json({ videos: data ?? [] }, 200, headers);
}

export async function handleGetKbVideo(svc: Svc, body: Row, headers: Headers) {
  const id = parseVideoId(body.video_id);
  if (!id) return json({ error: "video_id is required" }, 400, headers);
  const video = await readVideo(svc, id);
  if (!video) return json({ error: "Video not found" }, 404, headers);
  return json({ video }, 200, headers);
}

export async function handleUpsertKbVideo(svc: Svc, body: Row, headers: Headers) {
  if (hasStreamColumns(body)) return json({ error: "stream fields are read-only" }, 400, headers);
  const hasId = body.video_id !== undefined && body.video_id !== null;
  const id = hasId ? parseVideoId(body.video_id) : null;
  if (hasId && !id) return json({ error: "invalid video_id" }, 400, headers);

  const fields = normalizeKbVideoRow(pickColumns(body, KB_VIDEO_COLUMNS));
  let current: Row | null = null;
  if (id) {
    current = await readVideo(svc, id);
    if (!current) return json({ error: "Video not found" }, 404, headers);
  }
  const merged = { ...(current ?? {}), ...fields };
  const fieldError = validateKbVideo(merged, { alreadyPublished: current?.status === "published" });
  if (fieldError) return json({ error: fieldError }, 400, headers);

  const { data: series, error: seriesErr } = await svc
    .from("kb_video_series").select("id").eq("id", merged.series_id as string).maybeSingle();
  if (seriesErr) throw seriesErr;
  if (!series) return json({ error: "series not found" }, 400, headers);

  if (merged.article_id) {
    const { data: article, error: articleErr } = await svc
      .from("kb_articles").select("id, status").eq("id", merged.article_id as string).maybeSingle();
    if (articleErr) throw articleErr;
    if (!article || (article as Row).status !== "published") {
      return json({ error: "related article must be published" }, 400, headers);
    }
  }

  const { data, error } = id
    ? await svc.from("kb_videos").update(fields).eq("id", id).select().single()
    : await svc.from("kb_videos").insert(fields).select().single();
  if (error) {
    if (isUniqueViolation(error)) return json({ error: "slug already in use" }, 409, headers);
    throw error;
  }
  return json({ video: data }, id ? 200 : 201, headers);
}

export async function handleDeleteKbVideo(svc: Svc, body: Row, stream: KbVideoStreamDeps, headers: Headers) {
  const id = parseVideoId(body.video_id);
  if (!id) return json({ error: "video_id is required" }, 400, headers);
  const current = await readVideo(svc, id);
  if (!current) return json({ error: "Video not found" }, 404, headers);
  const { error } = await svc.from("kb_videos").delete().eq("id", id);
  if (error) throw error;
  if (typeof current.stream_uid === "string") await bestEffortDelete(stream, current.stream_uid, "kb-video-delete");
  return json({ message: "Video deleted" }, 200, headers);
}

// ─── Upload / processamento ─────────────────────────────────────

export async function handleCreateKbVideoUpload(
  svc: Svc,
  body: Row,
  stream: KbVideoStreamDeps,
  headers: Headers,
) {
  if (!stream.enabled()) return json({ error: "stream_not_configured" }, 503, headers);
  const id = parseVideoId(body.video_id);
  if (!id) return json({ error: "video_id is required" }, 400, headers);
  const current = await readVideo(svc, id);
  if (!current) return json({ error: "Video not found" }, 404, headers);

  const expiry = new Date(stream.now() + KB_VIDEO_UPLOAD_TTL_MS).toISOString();
  const { uid, uploadURL } = await stream.createDirectUpload({
    maxDurationSeconds: KB_VIDEO_MAX_DURATION_S,
    expiry,
    meta: { kind: "kb-video", video_id: String(id) },
  });

  // O uid é gravado ANTES de responder: o orphan reap nunca o vê como desconhecido.
  const { data: video, error } = await svc
    .from("kb_videos")
    .update({
      stream_uid: uid,
      stream_status: "pending",
      stream_upload_expires_at: expiry,
      duration_seconds: null,
      hls_url: null,
      thumbnail_url: null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    await bestEffortDelete(stream, uid, "kb-video-upload");
    throw error;
  }

  const oldUid = typeof current.stream_uid === "string" ? current.stream_uid : null;
  if (oldUid && oldUid !== uid) await bestEffortDelete(stream, oldUid, "kb-video-upload");

  return json({ uploadURL, video }, 200, headers);
}

export async function handleRefreshKbVideo(svc: Svc, body: Row, stream: KbVideoStreamDeps, headers: Headers) {
  if (!stream.enabled()) return json({ error: "stream_not_configured" }, 503, headers);
  const id = parseVideoId(body.video_id);
  if (!id) return json({ error: "video_id is required" }, 400, headers);
  const current = await readVideo(svc, id);
  if (!current) return json({ error: "Video not found" }, 404, headers);

  const uid = typeof current.stream_uid === "string" ? current.stream_uid : null;
  if (current.stream_status !== "pending" || !uid) return json({ video: current }, 200, headers);

  const info = await stream.getVideo(uid);
  if (info.state === "ready" && info.hls) {
    const video = await settlePending(svc, id, uid, {
      stream_status: "ready",
      duration_seconds: info.duration,
      hls_url: info.hls,
      thumbnail_url: info.thumbnail,
      stream_upload_expires_at: null,
    });
    return json({ video: video ?? current }, 200, headers);
  }
  if (info.state === "error") {
    const video = await settlePending(svc, id, uid, { stream_status: "error", stream_upload_expires_at: null });
    return json({ video: video ?? current }, 200, headers);
  }
  const expiresAt = typeof current.stream_upload_expires_at === "string"
    ? Date.parse(current.stream_upload_expires_at)
    : NaN;
  const neverArrived = info.state === "pendingupload" || info.state === "notfound";
  if (neverArrived && Number.isFinite(expiresAt) && expiresAt < stream.now()) {
    const video = await clearUpload(svc, stream, id, uid);
    return json({ video: video ?? current }, 200, headers);
  }
  return json({ video: current }, 200, headers);
}

export async function handleCancelKbVideoUpload(
  svc: Svc,
  body: Row,
  stream: KbVideoStreamDeps,
  headers: Headers,
) {
  const id = parseVideoId(body.video_id);
  const uid = typeof body.stream_uid === "string" && body.stream_uid ? body.stream_uid : null;
  if (!id || !uid) return json({ error: "video_id and stream_uid are required" }, 400, headers);
  const video = await clearUpload(svc, stream, id, uid);
  if (video) return json({ video }, 200, headers);
  const current = await readVideo(svc, id);
  if (!current) return json({ error: "Video not found" }, 404, headers);
  return json({ video: current }, 200, headers);
}

export async function handleReorderKbVideos(svc: Svc, body: Row, headers: Headers) {
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0 || items.length > MAX_REORDER_ITEMS) {
    return json({ error: `items must have 1 to ${MAX_REORDER_ITEMS} entries` }, 400, headers);
  }
  const parsed: Array<{ id: number; display_order: number }> = [];
  for (const item of items as Row[]) {
    const id = parseVideoId(item?.id);
    const order = item?.display_order;
    if (!id || !Number.isInteger(order) || (order as number) < 0 || (order as number) > MAX_DISPLAY_ORDER) {
      return json({ error: "invalid reorder item" }, 400, headers);
    }
    parsed.push({ id, display_order: order as number });
  }
  for (const item of parsed) {
    const { error } = await svc.from("kb_videos").update({ display_order: item.display_order }).eq("id", item.id);
    if (error) throw error;
  }
  return json({ message: "Reordered" }, 200, headers);
}
