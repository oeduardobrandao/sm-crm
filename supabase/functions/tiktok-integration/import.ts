// Video import (pagination + thumbnail caching + bulk upsert) and profile-avatar caching —
// pulled out of handlers.ts because both the OAuth callback's initial import and the manual
// /sync route need the exact same logic (design doc: "Import — same code path as sync").

import { TikTokApiError, tiktokFetch } from "../_shared/tiktok.ts";
import { cachePostThumbnail, type CacheThumbnailDeps, type ThumbnailStorage } from "../_shared/tiktok-thumbnail-cache.ts";

export type { ThumbnailStorage, CacheThumbnailDeps };

const VIDEO_FIELDS =
  "id,create_time,cover_image_url,share_url,video_description,duration,height,width,title,embed_link,like_count,comment_count,share_count,view_count";

// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any };

interface TikTokVideo {
  id: string;
  create_time?: number;
  cover_image_url?: string | null;
  share_url?: string | null;
  video_description?: string | null;
  duration?: number | null;
  height?: number | null;
  width?: number | null;
  title?: string | null;
  embed_link?: string | null;
  like_count?: number | null;
  comment_count?: number | null;
  share_count?: number | null;
  view_count?: number | null;
}

interface TikTokVideoListPage {
  videos?: TikTokVideo[];
  cursor?: number;
  has_more?: boolean;
}

// 10 pages * 20/page = 200, a hard stop against runaway pagination well above the 100-video
// import cap below — has_more/maxVideos are the normal exit conditions.
const MAX_PAGES = 10;

/**
 * Paginates TikTok's `POST /video/list/` (max_count 20/page) until `has_more=false` or
 * `opts.maxVideos` is reached, caches each cover thumbnail into the `tiktok-posts` bucket,
 * and bulk-upserts into `tiktok_posts` (onConflict `tiktok_video_id`). Returns the number of
 * videos upserted. Shared by the OAuth callback's initial import and manual /sync.
 */
export async function importTikTokVideos(
  deps: CacheThumbnailDeps,
  svc: DbClient,
  accountId: string,
  accessToken: string,
  opts: { maxVideos?: number } = {},
): Promise<number> {
  const maxVideos = opts.maxVideos ?? 100;
  const collected: TikTokVideo[] = [];
  let cursor: number | undefined;

  for (let page = 0; page < MAX_PAGES && collected.length < maxVideos; page++) {
    const body: Record<string, unknown> = { max_count: 20 };
    if (cursor !== undefined) body.cursor = cursor;
    const result = (await tiktokFetch(`/video/list/?fields=${VIDEO_FIELDS}`, {
      method: "POST",
      body: JSON.stringify(body),
      accessToken,
    })) as TikTokVideoListPage;

    collected.push(...(result.videos ?? []));
    if (!result.has_more) break;
    cursor = result.cursor;
  }

  const videos = collected.slice(0, maxVideos);
  if (videos.length === 0) return 0;

  const videoIds = videos.map((v) => v.id);
  const { data: existingRows } = await svc
    .from("tiktok_posts")
    .select("tiktok_video_id, cover_image_url")
    .in("tiktok_video_id", videoIds);
  const existingByVideoId = new Map<string, { tiktok_video_id: string; cover_image_url: string | null }>(
    // deno-lint-ignore no-explicit-any
    (existingRows ?? []).map((r: any) => [r.tiktok_video_id, r]),
  );

  const rows = [];
  for (const v of videos) {
    const cachedCover = await cachePostThumbnail(
      deps,
      accountId,
      v.id,
      v.cover_image_url ?? null,
      existingByVideoId.get(v.id)?.cover_image_url ?? null,
    );
    rows.push({
      tiktok_account_id: accountId,
      tiktok_video_id: v.id,
      title: v.title ?? null,
      video_description: v.video_description ?? null,
      duration: v.duration ?? null,
      height: v.height ?? null,
      width: v.width ?? null,
      share_url: v.share_url ?? null,
      embed_link: v.embed_link ?? null,
      cover_image_url: cachedCover,
      posted_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
      views: v.view_count ?? null,
      likes: v.like_count ?? null,
      comments: v.comment_count ?? null,
      shares: v.share_count ?? null,
      synced_at: new Date().toISOString(),
    });
  }

  const { error } = await svc.from("tiktok_posts").upsert(rows, { onConflict: "tiktok_video_id" });
  if (error) {
    console.error("[tiktok-integration] video upsert failed:", error.message);
    return 0;
  }
  return rows.length;
}

const METRICS_FIELDS = "id,like_count,comment_count,share_count,view_count";

// TikTok's `video/query/` accepts up to 20 video_ids per call; refresh covers the 200
// most-recently-posted stored rows (10 batches), well below anything TikTok itself paginates.
const METRICS_SELECT_LIMIT = 200;
const METRICS_BATCH_SIZE = 20;

interface TikTokVideoMetrics {
  id: string;
  like_count?: number | null;
  comment_count?: number | null;
  share_count?: number | null;
  view_count?: number | null;
}

interface TikTokVideoQueryResult {
  videos?: TikTokVideoMetrics[];
}

export interface RefreshMetricsDeps {
  svc: DbClient;
}

/**
 * Refreshes views/likes/comments/shares (+ synced_at) for the 200 most-recently-posted
 * `tiktok_posts` rows via TikTok's `POST /video/query/`, batched 20 ids/call (TikTok's max
 * per query). Unlike importTikTokVideos (video.list — discovers NEW videos), this only
 * refreshes metrics for videos already stored. Ids the response omits (deleted/private
 * videos) are left untouched, not treated as a failure. A single batch failing with a
 * retryable TikTokApiError (e.g. rate limit) is logged and skipped so the rest of the
 * refresh still runs; a non-retryable error (TOKEN_INVALID/REVOKED/etc.) propagates so the
 * caller's existing error mapping applies. Returns the number of rows updated.
 */
export async function refreshStoredPostMetrics(
  deps: RefreshMetricsDeps,
  accountId: string,
  accessToken: string,
): Promise<number> {
  const { svc } = deps;

  const { data: rows, error: selectErr } = await svc
    .from("tiktok_posts")
    .select("tiktok_video_id")
    .eq("tiktok_account_id", accountId)
    .order("posted_at", { ascending: false })
    .limit(METRICS_SELECT_LIMIT);
  if (selectErr) {
    console.error(
      "[tiktok-integration] refreshStoredPostMetrics: select failed:",
      (selectErr as { message?: string })?.message,
    );
    return 0;
  }

  const videoIds = ((rows ?? []) as Array<{ tiktok_video_id: string }>)
    .map((r) => r.tiktok_video_id)
    .filter(Boolean);
  if (videoIds.length === 0) return 0;

  let updated = 0;
  for (let i = 0; i < videoIds.length; i += METRICS_BATCH_SIZE) {
    const batchIds = videoIds.slice(i, i + METRICS_BATCH_SIZE);

    let videos: TikTokVideoMetrics[];
    try {
      const result = (await tiktokFetch(`/video/query/?fields=${METRICS_FIELDS}`, {
        method: "POST",
        body: JSON.stringify({ filters: { video_ids: batchIds } }),
        accessToken,
      })) as TikTokVideoQueryResult;
      videos = result.videos ?? [];
    } catch (e) {
      if (e instanceof TikTokApiError && e.retryable) {
        // Retryable (e.g. rate-limited) — a partial metrics refresh beats failing the whole
        // sync; move on to the next batch.
        console.error("[tiktok-integration] refreshStoredPostMetrics: batch failed (retryable), skipping:", e.message);
        continue;
      }
      // Non-retryable (TOKEN_INVALID, REVOKED, etc.) — propagate so the caller's existing
      // error mapping (handleUnexpectedError / handleSync's TOKEN_EXPIRED branch) applies.
      throw e;
    }

    for (const v of videos) {
      const { error: updateErr } = await svc
        .from("tiktok_posts")
        .update({
          views: v.view_count ?? null,
          likes: v.like_count ?? null,
          comments: v.comment_count ?? null,
          shares: v.share_count ?? null,
          synced_at: new Date().toISOString(),
        })
        .eq("tiktok_video_id", v.id);
      if (updateErr) {
        console.error(
          "[tiktok-integration] refreshStoredPostMetrics: update failed for video",
          v.id,
          ":",
          (updateErr as { message?: string })?.message,
        );
        continue;
      }
      updated++;
    }
  }

  return updated;
}

/**
 * Caches a TikTok profile avatar into the shared `avatars` bucket — same bucket and
 * upload-with-bucket-autocreate fallback as instagram-integration's inline profile-picture
 * caching. Keyed by `accountKey` (the caller passes the stable client_id, avoiding the
 * chicken-and-egg problem of needing the not-yet-created tiktok_accounts row id during the
 * OAuth callback). Best-effort: returns undefined on any failure so the caller falls back to
 * the raw (short-lived) TikTok CDN url.
 */
export async function cacheTikTokAvatar(
  fetchImpl: typeof fetch,
  storage: ThumbnailStorage,
  accountKey: string | number,
  avatarUrl: string | null,
): Promise<string | undefined> {
  if (!avatarUrl) return undefined;
  const BUCKET = "avatars";
  const path = `tiktok/${accountKey}.jpg`;
  try {
    const res = await fetchImpl(avatarUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      await res.body?.cancel();
      return undefined;
    }
    const bytes = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    let { error } = await storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error?.message?.includes("Bucket not found")) {
      await storage.createBucket(BUCKET, { public: true });
      ({ error } = await storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true }));
    }
    if (error) return undefined;
    return storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return undefined;
  }
}
