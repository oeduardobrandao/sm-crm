# Video thumbnail as the published Instagram Reels cover

**Date:** 2026-06-13
**Status:** Approved (design review)
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

## Goals

- For **single-video Reels**, pass the post's thumbnail to Instagram as the
  Reel cover via the Graph API `cover_url` parameter.
- The custom-upload path in the existing dialog already lets users pick any
  image; that image becomes the cover with no new UI.
- Be safe on the live publish path: a missing or non-JPEG thumbnail must never
  cause a publish to fail.

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
fetches the cover during the same container-processing window) and passes it as
`coverUrl`. A null/absent `thumbnail_r2_key` simply omits the cover.

**`instagram-publish/handler.ts`** (direct publish-now, ~line 164-200):
- Select: `"sort_order, files!inner(id, kind, r2_key, thumbnail_r2_key)"`
- Map: add `thumbnail_r2_key: l.files.thumbnail_r2_key` to the media object.
- `isSingleVideo` branch:
  ```ts
  const url = await signGetUrl(media[0].r2_key, 7200);
  const coverUrl = media[0].thumbnail_r2_key
    ? await signGetUrl(media[0].thumbnail_r2_key, 7200)
    : undefined;
  const container = await createVideoContainer(igUserId, token, url, post.ig_caption, coverUrl);
  ```

**`instagram-publish-cron/index.ts`** (`fetchMediaForPost` + `processContainerCreation`, ~line 60-133):
- Same select + map addition in `fetchMediaForPost` (extend its return type to
  include `thumbnail_r2_key: string | null`).
- Same `coverUrl` derivation in the `isSingleVideo` branch of
  `processContainerCreation`.

Carousel and single-image branches are untouched.

### 3. Frontend — normalize custom uploads to JPEG

Instagram's `cover_url` reliably accepts **JPEG** only; a PNG/WebP cover risks
failing the publish. Auto-extracted frames are already JPEG
(`captureFrameFromElement`). Custom uploads in `ThumbnailPickerDialog` can be
PNG/WebP, so re-encode them to JPEG client-side before upload:

- New util `encodeImageAsJpeg(file, maxEdge = 1920, quality = 0.85): Promise<File>`
  — loads the image, draws to a canvas capped at `maxEdge` on the longest edge
  (mirrors the frame-capture cap), exports `image/jpeg`. (Re-encoding drops
  alpha; covers are opaque, so this is fine.)
- The dialog's custom-upload `onChange` awaits `encodeImageAsJpeg(file)` before
  setting the pending thumbnail. The capture path is unchanged (already JPEG).

This guarantees every `thumbnail_r2_key` used as `cover_url` is a
Graph-API-compatible JPEG, and the user's chosen custom image always applies.

### 4. Frontend — dialog disclaimer copy (`thumbnailEditor.disclaimer`, pt + en)

The current copy says the thumbnail does NOT change the Instagram cover. Invert
it. Proposed:

- **pt:** "Esta miniatura será a capa do Reel no Instagram e aparece nas
  pré-visualizações do CRM e do portal do cliente. (Em carrosséis, o Instagram
  usa o primeiro item como capa.)"
- **en:** "This thumbnail becomes the Reel's cover on Instagram and appears in
  the CRM and client portal previews. (For carousels, Instagram uses the first
  item as the cover.)"

The carousel note avoids the inverse expectation trap for a video that's part
of a multi-media post.

## Error handling & edge cases

- **Missing thumbnail** → `coverUrl` undefined → `cover_url` omitted →
  Instagram picks its own cover (today's behavior). No failure.
- **Cover signing** reuses `signGetUrl`, the same presign as the (mandatory)
  video URL; if it could fail, the video URL would already have failed, so it
  propagates to the existing `catch` → `markFailed` / status change, consistent
  with current handling. Not specially wrapped.
- **Instagram rejects `cover_url`** (e.g., unexpected aspect ratio): Instagram
  crops covers to fit rather than rejecting a valid JPEG, so this is unlikely.
  If it does error, the existing Graph error handling marks the post failed with
  the Graph message (visible to the user). A defensive "retry without cover" is
  out of scope (see Alternatives).
- **Token expiry / retries** unchanged — the cover only adds parameters to the
  existing container call.

## Testing

- **Deno** (new test file, e.g. `supabase/functions/__tests__/instagram-publish-cover_test.ts`):
  mock `fetch`; assert `createVideoContainer` includes `cover_url` when
  `coverUrl` is passed and omits it when not. (Mind the deno.lock/node_modules
  gotcha: after `deno test`, restore with `git checkout deno.lock && npm ci`.)
- **Frontend** (Vitest): `encodeImageAsJpeg` returns an `image/jpeg` File and
  caps dimensions (mocked Image/canvas, like the existing videoFrame tests).
- Manual (staging): publish a real single-video Reel and confirm the chosen
  thumbnail is the cover; repeat with a custom (PNG) upload.

## Deployment

No DB migration. Redeploy the two edge functions that bundle the changed shared
util:
- `instagram-publish` (JWT-verified user action — standard deploy).
- `instagram-publish-cron` (own auth via `x-cron-secret` — deploy with
  `--no-verify-jwt`).

Roll out to **staging** first, verify a real Reel cover end-to-end, then **prod**
— gated on explicit approval, since this is the live client publish path.

## Alternatives considered

- **`thumb_offset` instead of `cover_url`:** can't represent a custom uploaded
  image. Rejected — the custom-cover requirement forces `cover_url`.
- **Backend-only JPEG guard** (set `cover_url` only when the thumbnail mime is
  JPEG, else omit): no frontend change, but a user's custom PNG/WebP cover would
  silently not apply ("I set a cover but it didn't take"). Rejected in favor of
  client-side JPEG normalization, which makes the custom cover always apply.
- **Retry-without-cover on cover-specific Graph errors:** extra robustness on
  the publish path, but adds branching/complexity for an unlikely case (valid
  JPEG covers aren't rejected). Deferred; the failure is already surfaced.
- **Carousel cover via reordering:** different mechanism (sort order, not
  `cover_url`); out of scope per the scoping decision.
