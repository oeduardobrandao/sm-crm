// Caches TikTok video cover thumbnails into a public Supabase Storage bucket.
//
// TikTok's Display API returns cover_image_url as a CDN link that expires within ~6h
// (docs/superpowers/specs/2026-07-17-tiktok-integration-design.md, "Verified TikTok API
// facts"). This mirrors instagram-thumbnail-cache.ts (same fix as IG PR #200): download
// once, store to a public bucket, and reuse the stable URL on every subsequent sync.
// Best-effort: any failure falls back to the raw CDN url, so caching can never regress a
// sync or the initial import.

export const THUMBNAIL_BUCKET = "tiktok-posts";

/** True once a url already points at our own stable, non-expiring cache bucket. */
export function isCachedTikTokUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes(`/${THUMBNAIL_BUCKET}/`);
}

interface StorageBucket {
  upload: (
    path: string,
    // deno-lint-ignore no-explicit-any
    body: any,
    opts: { contentType: string; upsert: boolean },
  ) => Promise<{ error: { message?: string } | null }>;
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
}

export interface ThumbnailStorage {
  from: (bucket: string) => StorageBucket;
  createBucket: (name: string, opts: { public: boolean }) => Promise<unknown>;
}

export interface CacheThumbnailDeps {
  fetch: typeof fetch;
  storage: ThumbnailStorage;
}

/** Downloading a single CDN image must never hang the edge worker (its kills bypass catch). */
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * Returns a stable, non-expiring URL for a TikTok video cover thumbnail.
 *
 * - If `existingUrl` already points into our bucket, returns it unchanged with no network
 *   call — a video's cover is immutable once cached, so it never needs refetching.
 * - Otherwise downloads `coverUrl` and uploads it to the public bucket, returning the
 *   public URL.
 * - On any failure returns `coverUrl` (the caller keeps the raw, short-lived url — no
 *   regression versus not caching at all).
 * - If `coverUrl` is null, returns the prior cached url when it's already stable, else null.
 */
export async function cachePostThumbnail(
  deps: CacheThumbnailDeps,
  accountId: string | number,
  videoId: string,
  coverUrl: string | null,
  existingUrl?: string | null,
): Promise<string | null> {
  const priorStable = existingUrl && isCachedTikTokUrl(existingUrl) ? existingUrl : null;
  if (priorStable) return priorStable;
  if (!coverUrl) return null;

  try {
    const res = await deps.fetch(coverUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      await res.body?.cancel();
      return coverUrl;
    }
    const bytes = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const path = `${accountId}/${videoId}.jpg`;

    let { error } = await deps.storage
      .from(THUMBNAIL_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error?.message?.includes("Bucket not found")) {
      await deps.storage.createBucket(THUMBNAIL_BUCKET, { public: true });
      ({ error } = await deps.storage
        .from(THUMBNAIL_BUCKET)
        .upload(path, bytes, { contentType, upsert: true }));
    }
    if (error) return coverUrl;

    return deps.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return coverUrl;
  }
}
