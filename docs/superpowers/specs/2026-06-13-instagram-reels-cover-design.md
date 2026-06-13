# Video thumbnail as the published Instagram Reels cover

**Date:** 2026-06-13
**Status:** Approved (design review, round 2 incorporated)
**Scope:** Backend edge functions (publish path) + small frontend changes. Builds on the auto-thumbnail feature (PR #114 / branch `feat/video-thumbnail-auto-edit`).

## Problem

The video thumbnail chosen in `ThumbnailPickerDialog` (auto-extracted frame or
custom upload) is currently **display-only** — it sets the CRM tile poster and
the Hub preview, but it does **not** become the cover of the Reel published to
Instagram. When publishing a single-video post, `createVideoContainer`
(`_shared/instagram-publish-utils.ts:248`) sends only `video_url`, `caption`,
and `media_type=REELS`; Instagram then picks its own cover frame. The publish
queries (`instagram-publish/handler.ts:164`, `instagram-publish-cron/index.ts:60`)
never even select `thumbnail_r2_key`.

Users expect the thumbnail they pick to be the actual Reel cover.

## Blast radius (read before the design)

`files` has `CHECK (kind != 'video' OR thumbnail_r2_key IS NOT NULL)`
(`20260425000001_file_system_tables.sql:55`) — **every video file is guaranteed
to have a thumbnail.** Therefore, after rollout, **100% of single-video Reel
publishes will carry a `cover_url`**, not "some." The "missing thumbnail → omit
cover" path is a defensive guard that essentially never executes in practice.

This reframes the risk: previously, a single-video publish that reached
container creation was essentially guaranteed to succeed (Instagram chose its
own cover). Now every such publish carries a cover Instagram could choke on. A
bad cover surfaces **asynchronously** during container processing as a generic
`status_code = ERROR`, which both paths convert to an opaque message — NOT the
Graph cover detail:
- publish-now: `"Container falhou no processamento do Instagram"` (`handler.ts:209`)
- cron: `"Container failed processing on Instagram's side"` (`cron/index.ts:166`)

Because the failure mode is real and the diagnostic is opaque, the
**retry-without-cover fallback is part of v1** (not deferred) — see Design §5.

## Goals

- For **single-video Reels**, pass the post's thumbnail to Instagram as the
  Reel cover via the Graph API `cover_url` parameter.
- The custom-upload path in the existing dialog already lets users pick any
  image; that image becomes the cover with no new UI.
- **Never regress publish success because of a cover:** a cover that Instagram
  rejects must degrade to a coverless publish (today's behavior), not a failed
  post.

## Non-goals

- **Carousels** (multi-media posts). Instagram has no per-Reel `cover_url` for
  carousel parents — the carousel cover is whichever child is first
  (`sort_order`). Carousel publishing is unchanged. (Scoping decision.)
- Re-covering **already-published** Reels. `cover_url` only applies at
  container-creation time; this affects posts published after rollout.
- `thumb_offset` (frame-offset cover). We use `cover_url` because it also
  supports custom uploaded images; `thumb_offset` cannot.
- DB schema changes. `files.thumbnail_r2_key` already exists and is required
  for videos by a CHECK constraint.

## Design

### 1. `createVideoContainer` — optional cover (`_shared/instagram-publish-utils.ts`)

Add an optional `coverUrl` argument; include `cover_url` in the Graph body only
when provided:

```ts
export async function createVideoContainer(
  igUserId: string,
  token: string,
  videoUrl: string,
  caption: string,
  coverUrl?: string,
): Promise<{ id: string }> {
  const body: Record<string, string> = {
    video_url: videoUrl,
    caption,
    media_type: "REELS",
    access_token: token,
  };
  if (coverUrl) body.cover_url = coverUrl;
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throwGraphError(data);
  return { id: data.id };
}
```

Existing callers that omit `coverUrl` are unaffected (backward compatible).

### 2. Both publish paths select + sign the thumbnail

The two paths are symmetric. In each, the media-loading select adds
`thumbnail_r2_key`, and the `isSingleVideo` branch signs it (same
`signGetUrl(key, 7200)` mechanism and 2-hour TTL as the video URL — Instagram
fetches the cover during the same container-processing window). The
null-thumbnail check stays as a defensive guard, though the CHECK constraint
means it won't trigger in practice.

**`instagram-publish/handler.ts`** (direct publish-now, ~line 164-200):
- Select: `"sort_order, files!inner(id, kind, r2_key, thumbnail_r2_key)"`
- Map: add `thumbnail_r2_key: l.files.thumbnail_r2_key` to the media object.
- `isSingleVideo` branch: see §5 (the cover is wired together with the retry).

**`instagram-publish-cron/index.ts`** (`fetchMediaForPost` + `processContainerCreation`):
- Same select + map addition in `fetchMediaForPost`; extend its return type to
  include `thumbnail_r2_key: string | null`.
- `isSingleVideo` branch: see §5.

Carousel and single-image branches are untouched.

### 3. Frontend — normalize custom uploads to JPEG

Instagram's `cover_url` reliably accepts **JPEG** only; a PNG/WebP cover risks
failing the publish. Auto-extracted frames are already JPEG
(`captureFrameFromElement`). Custom uploads in `ThumbnailPickerDialog` can be
PNG/WebP, so re-encode them to JPEG client-side before upload:

- New util `encodeImageAsJpeg(file, maxEdge = 1920, quality = 0.85): Promise<File>`
  — loads the image, draws to a canvas capped at `maxEdge` on the longest edge,
  exports `image/jpeg`. (Re-encoding drops alpha; covers are opaque, so fine.)
- **Always run it on every custom upload, including JPEG inputs** — do NOT
  short-circuit on `type === 'image/jpeg'`. A user can upload a 4000px JPEG; the
  `maxEdge` cap must always apply.
- The dialog's custom-upload `onChange` awaits `encodeImageAsJpeg(file)` before
  setting the pending thumbnail. The capture path is unchanged (already JPEG).
- **EXIF orientation:** canvas re-encoding must not rotate a phone photo
  sideways. Rely on the CSS/canvas default `image-orientation: from-image`
  (honor EXIF) when drawing, and cover it with a test (Testing §).

This guarantees every `thumbnail_r2_key` used as `cover_url` is a
Graph-API-compatible JPEG, and the user's chosen custom image always applies.

### 4. Frontend — dialog disclaimer copy (`thumbnailEditor.disclaimer`, pt + en)

The current copy says the thumbnail does NOT change the Instagram cover. Invert
it:
- **pt:** "Esta miniatura será a capa do Reel no Instagram e aparece nas
  pré-visualizações do CRM e do portal do cliente. (Em carrosséis, o Instagram
  usa o primeiro item como capa.)"
- **en:** "This thumbnail becomes the Reel's cover on Instagram and appears in
  the CRM and client portal previews. (For carousels, Instagram uses the first
  item as the cover.)"

The carousel note avoids the inverse expectation trap for a video that's part
of a multi-media post.

### 5. Cover-failure resilience (retry without cover) — v1, both paths

Because the cover is effectively mandatory (Blast radius) and a cover rejection
surfaces as an opaque container ERROR, both paths must degrade to a coverless
publish rather than fail. Two shapes, because the paths differ:

**publish-now (synchronous) — targeted retry.** The `isSingleVideo` branch:
```ts
const url = await signGetUrl(media[0].r2_key, 7200);
const coverUrl = media[0].thumbnail_r2_key
  ? await signGetUrl(media[0].thumbnail_r2_key, 7200)
  : undefined;
let container = await createVideoContainer(igUserId, token, url, post.ig_caption, coverUrl);
let containerId = container.id;
await svcDb.from("workflow_posts").update({ instagram_container_id: containerId }).eq("id", postId);
let containerStatus = await pollContainerReady(containerId, token, 12, 3000);

// A cover Instagram can't process surfaces as ERROR during processing. Retry
// once without the cover so the Reel still publishes (Instagram's auto-cover).
if (containerStatus === "ERROR" && coverUrl) {
  container = await createVideoContainer(igUserId, token, url, post.ig_caption);
  containerId = container.id;
  await svcDb.from("workflow_posts").update({ instagram_container_id: containerId }).eq("id", postId);
  containerStatus = await pollContainerReady(containerId, token, 12, 3000);
}
// then the existing ERROR/IN_PROGRESS/FINISHED handling
```
Worst case adds one extra create + poll (~36s) only on the rare ERROR path,
well within the function's execution budget.

**cron (asynchronous, stateless) — drop the cover on retries.** The cron creates
the container in Phase 1 and detects ERROR later in Phase 2, with no cover
context carried across runs, and `processRetry` (Phase 3) delegates to
`processContainerCreation` (so there is **no third site to patch** — the retry
reuses the same creation code). Use the existing `publish_retry_count` as the
signal:
```ts
// in processContainerCreation, isSingleVideo branch:
const url = await signGetUrl(media[0].r2_key, 7200);
const useCover = post.publish_retry_count === 0 && media[0].thumbnail_r2_key;
const coverUrl = useCover ? await signGetUrl(media[0].thumbnail_r2_key, 7200) : undefined;
const container = await createVideoContainer(post.instagram_user_id, token, url, post.ig_caption, coverUrl);
```
First scheduled attempt carries the cover; any retry omits it, so a
cover-induced ERROR can't make a scheduled post fail permanently.
**Trade-off (documented, accepted):** a post that fails its first attempt for an
*unrelated* transient reason loses its custom cover on the successful retry
(Instagram picks the cover instead). The post still publishes — graceful
degradation, no new schema. `ClaimedPost` already carries `publish_retry_count`
(used by `markFailed`).

## Error handling & edge cases

- **Missing thumbnail** → `coverUrl` undefined → `cover_url` omitted (defensive;
  ~never happens given the CHECK constraint).
- **Cover signing** reuses `signGetUrl`, the same presign as the mandatory video
  URL; if it could fail, the video URL would already have failed. Propagates to
  the existing `catch` consistently.
- **Instagram rejects the cover:** surfaces as a generic container ERROR (the
  Graph cover detail is NOT exposed — the failure is async during processing).
  Mitigated by the retry-without-cover in §5, which is precisely why it's in v1.
- **Custom-cover aspect ratio is not normalized.** `encodeImageAsJpeg` caps the
  longest edge but preserves the source aspect ratio, so e.g. a 1:1 custom
  upload on a 9:16 Reel relies on Instagram center-cropping the cover to fit.
  This is the one place arbitrary user input exercises the "Instagram crops to
  fit" assumption (auto-frames inherit the video's valid aspect ratio).
  Acceptable for v1; not normalized.
- **Token expiry / retries** otherwise unchanged.

## Testing

- **Deno** (new file `supabase/functions/__tests__/instagram-publish-cover_test.ts`):
  mock `fetch`; assert `createVideoContainer` includes `cover_url` when
  `coverUrl` is passed and omits it when not. (Mind the deno.lock/node_modules
  gotcha: after `deno test`, restore with `git checkout deno.lock && npm ci`.)
- **Frontend** (Vitest):
  - `encodeImageAsJpeg` returns an `image/jpeg` File, caps dimensions for a
    large input, and runs even for a JPEG input (no short-circuit).
  - EXIF orientation: a rotated source is not sideways in the output (or an
    explicit assertion that `image-orientation: from-image` is relied upon).
- Manual (staging): see the go/no-go gate in Deployment.

## Deployment

No DB migration. Redeploy the two edge functions that bundle the changed shared
util:
- `instagram-publish` (JWT-verified user action — standard deploy).
- `instagram-publish-cron` (own auth via `x-cron-secret` — deploy with
  `--no-verify-jwt`).

**Go/no-go gate (staging, before prod):** publish a real single-video Reel and
confirm the chosen thumbnail actually appears as the cover on the published
Reel. `GRAPH_BASE` is `https://graph.instagram.com/v22.0`
(`instagram-publish-utils.ts:220`) — the **Instagram-Login API**, not
`graph.facebook.com`. `cover_url` is documented as supported there for
`media_type=REELS`, but if the cover does **not** actually take effect (silently
ignored or rejected) on this host/version, **stop — do not ship to prod.** Also
verify a custom (PNG) upload becomes the cover. Prod deploy is gated on explicit
approval (live client publish path).

## Alternatives considered

- **`thumb_offset` instead of `cover_url`:** can't represent a custom uploaded
  image. Rejected — the custom-cover requirement forces `cover_url`.
- **Backend-only JPEG guard** (set `cover_url` only when the thumbnail is JPEG):
  **infeasible without a schema change** — the thumbnail's mime type is not
  stored anywhere (the publish select has only `thumbnail_r2_key`; mime is
  validated only at upload time in `post-media-manage/handler.ts:187`). So the
  backend can't even inspect the cover's format. This removes the alternative
  entirely and makes client-side JPEG normalization the clear choice.
- **Carousel cover via reordering:** different mechanism (sort order, not
  `cover_url`); out of scope per the scoping decision.
- **Stateful cover-skip flag (new column) for cron retries** instead of the
  `publish_retry_count` heuristic: more precise (only drops the cover when the
  cover was the actual culprit) but needs a schema change. Deferred — the
  stateless heuristic is good enough for v1.
