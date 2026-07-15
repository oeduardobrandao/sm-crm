import { assert, assertEquals } from "./assert.ts";
import {
  cachePostThumbnail,
  isEphemeralInstagramUrl,
  THUMBNAIL_BUCKET,
} from "../_shared/instagram-thumbnail-cache.ts";

const PUBLIC_BASE = "https://proj.supabase.co/storage/v1/object/public/instagram-posts";

/** Minimal in-memory storage double mirroring the supabase.storage surface we use. */
function makeStorage(opts: { uploadError?: { message?: string }; missingBucketOnce?: boolean } = {}) {
  const uploads: { bucket: string; path: string; contentType: string }[] = [];
  const createdBuckets: string[] = [];
  let bucketMissing = opts.missingBucketOnce ?? false;
  const storage = {
    from(bucket: string) {
      return {
        // deno-lint-ignore no-explicit-any
        async upload(path: string, _body: any, o: { contentType: string; upsert: boolean }) {
          if (bucketMissing) {
            return { error: { message: "Bucket not found" } };
          }
          if (opts.uploadError) return { error: opts.uploadError };
          uploads.push({ bucket, path, contentType: o.contentType });
          return { error: null };
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `${PUBLIC_BASE.replace("/instagram-posts", "")}/${bucket}/${path}` } };
        },
      };
    },
    async createBucket(name: string, _o: { public: boolean }) {
      createdBuckets.push(name);
      bucketMissing = false;
      return {};
    },
  };
  return { storage, uploads, createdBuckets };
}

const okImage = (contentType = "image/jpeg") =>
  Promise.resolve({
    ok: true,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    body: null,
  } as unknown as Response);

Deno.test("isEphemeralInstagramUrl: flags IG CDN hosts, not our stored URLs", () => {
  assert(isEphemeralInstagramUrl("https://scontent-abc.cdninstagram.com/x.jpg"));
  assert(isEphemeralInstagramUrl("https://z.fbcdn.net/v/x.jpg"));
  assertEquals(isEphemeralInstagramUrl(`${PUBLIC_BASE}/1/abc.jpg`), false);
  assertEquals(isEphemeralInstagramUrl(null), false);
  assertEquals(isEphemeralInstagramUrl(undefined), false);
});

Deno.test("cachePostThumbnail: downloads CDN image and returns a stable public URL", async () => {
  const { storage, uploads } = makeStorage();
  let fetched: string | null = null;
  const fetchFn = ((u: string) => {
    fetched = u;
    return okImage();
  }) as typeof fetch;

  const url = await cachePostThumbnail(
    { fetch: fetchFn, storage },
    42,
    "post_1",
    "https://scontent.cdninstagram.com/live.jpg",
    null,
  );

  assertEquals(fetched, "https://scontent.cdninstagram.com/live.jpg");
  assertEquals(uploads.length, 1);
  assertEquals(uploads[0].bucket, THUMBNAIL_BUCKET);
  assertEquals(uploads[0].path, "42/post_1.jpg");
  assert(url!.includes(`/${THUMBNAIL_BUCKET}/42/post_1.jpg`));
  assert(!isEphemeralInstagramUrl(url));
});

Deno.test("cachePostThumbnail: already-cached URL is reused without any network call", async () => {
  const { storage, uploads } = makeStorage();
  let called = false;
  const fetchFn = (() => {
    called = true;
    return okImage();
  }) as typeof fetch;

  const cached = `${PUBLIC_BASE}/42/post_1.jpg`;
  const url = await cachePostThumbnail(
    { fetch: fetchFn, storage },
    42,
    "post_1",
    "https://scontent.cdninstagram.com/live.jpg",
    cached,
  );

  assertEquals(url, cached);
  assertEquals(called, false);
  assertEquals(uploads.length, 0);
});

Deno.test("cachePostThumbnail: falls back to the raw CDN url when download fails", async () => {
  const { storage, uploads } = makeStorage();
  const fetchFn = (() =>
    Promise.resolve({ ok: false, headers: new Headers(), body: null } as unknown as Response)) as typeof fetch;

  const url = await cachePostThumbnail(
    { fetch: fetchFn, storage },
    42,
    "post_1",
    "https://scontent.cdninstagram.com/live.jpg",
    null,
  );

  assertEquals(url, "https://scontent.cdninstagram.com/live.jpg");
  assertEquals(uploads.length, 0);
});

Deno.test("cachePostThumbnail: falls back to raw url when fetch throws (edge timeout)", async () => {
  const { storage } = makeStorage();
  const fetchFn = (() => Promise.reject(new Error("timeout"))) as typeof fetch;

  const url = await cachePostThumbnail(
    { fetch: fetchFn, storage },
    42,
    "post_1",
    "https://scontent.cdninstagram.com/live.jpg",
    null,
  );
  assertEquals(url, "https://scontent.cdninstagram.com/live.jpg");
});

Deno.test("cachePostThumbnail: creates the bucket on first use, then uploads", async () => {
  const { storage, uploads, createdBuckets } = makeStorage({ missingBucketOnce: true });
  const fetchFn = (() => okImage()) as typeof fetch;

  const url = await cachePostThumbnail(
    { fetch: fetchFn, storage },
    7,
    "p9",
    "https://scontent.cdninstagram.com/live.jpg",
    null,
  );

  assertEquals(createdBuckets, [THUMBNAIL_BUCKET]);
  assertEquals(uploads.length, 1);
  assert(url!.includes(`/${THUMBNAIL_BUCKET}/7/p9.jpg`));
});

Deno.test("cachePostThumbnail: null cdn url keeps a prior cached url, else stays null", async () => {
  const { storage } = makeStorage();
  const fetchFn = (() => okImage()) as typeof fetch;
  const cached = `${PUBLIC_BASE}/1/x.jpg`;
  assertEquals(
    await cachePostThumbnail({ fetch: fetchFn, storage }, 1, "x", null, cached),
    cached,
  );
  assertEquals(await cachePostThumbnail({ fetch: fetchFn, storage }, 1, "x", null, null), null);
});
