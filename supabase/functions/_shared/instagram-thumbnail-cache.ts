// Caches Instagram post thumbnails into a public Supabase Storage bucket.
//
// Instagram's Graph API returns media_url / thumbnail_url as SIGNED CDN links
// (scontent.cdninstagram.com / fbcdn.net) that EXPIRE within days. The Hub "Visualizar
// no feed" preview renders instagram_posts.thumbnail_url directly in an <img>, so once
// those links expire the tiles show broken-image icons. This mirrors the existing
// profile-picture caching (the `avatars` bucket) so the feed serves a stable URL that
// never expires. Best-effort: any failure falls back to the raw CDN url (today's behavior),
// so caching can never regress the feed.

export const THUMBNAIL_BUCKET = "instagram-posts";

/** IG media URLs live on these hosts and expire; anything else is already our stable cache. */
export function isEphemeralInstagramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /cdninstagram\.com|fbcdn\.net/i.test(url);
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
 * Returns a stable, non-expiring URL for a post thumbnail.
 *
 * - If `existingUrl` is already cached (not an IG CDN url), returns it unchanged with no
 *   network call — a post's media is immutable, so once cached it never needs refetching.
 * - Otherwise downloads `cdnUrl` and uploads it to the public bucket, returning the public URL.
 * - On any failure returns `cdnUrl` (the caller keeps the raw url — no regression).
 * - If `cdnUrl` is null, returns the prior cached url when it's already stable, else null.
 */
export async function cachePostThumbnail(
  deps: CacheThumbnailDeps,
  accountId: string | number,
  postId: string,
  cdnUrl: string | null,
  existingUrl?: string | null,
): Promise<string | null> {
  const priorStable = existingUrl && !isEphemeralInstagramUrl(existingUrl) ? existingUrl : null;
  if (priorStable) return priorStable;
  if (!cdnUrl) return null;

  try {
    const res = await deps.fetch(cdnUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      await res.body?.cancel();
      return cdnUrl;
    }
    const bytes = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const path = `${accountId}/${postId}.jpg`;

    let { error } = await deps.storage
      .from(THUMBNAIL_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error?.message?.includes("Bucket not found")) {
      await deps.storage.createBucket(THUMBNAIL_BUCKET, { public: true });
      ({ error } = await deps.storage
        .from(THUMBNAIL_BUCKET)
        .upload(path, bytes, { contentType, upsert: true }));
    }
    if (error) return cdnUrl;

    return deps.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return cdnUrl;
  }
}
