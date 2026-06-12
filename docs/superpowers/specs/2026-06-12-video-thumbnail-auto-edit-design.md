# Video thumbnails: auto-generate on upload + edit afterwards

**Date:** 2026-06-12
**Status:** Approved (design review with corrections incorporated)
**Scope:** CRM app only. Frontend-only — zero backend, schema, or Hub changes.

## Problem

Uploading a video in the workflow currently blocks until the user manually
uploads a thumbnail image (amber "Thumbnail necessária" panel in
`PostMediaGallery`). There is no way to change a thumbnail afterwards — the
only workaround is deleting the video and re-uploading it.

A side effect of the blocking prompt: `handleFiles` returns on the first video
in a selection, silently dropping every other file (including images) in the
same selection.

## Goals

- Videos upload immediately with an auto-extracted frame as the default
  thumbnail; uploading a custom thumbnail remains possible.
- Thumbnails are editable after upload: scrub the video to pick a new frame,
  or upload a custom image.
- Mixed image+video multi-selections all upload (fixes the drop-the-rest bug).

## Non-goals

- Hub (client portal) thumbnail editing.
- Changing the published Instagram reel cover. Instagram publishing sends only
  `video_url` + caption (`createVideoContainer`, REELS container) and never
  reads `thumbnail_r2_key` — Instagram picks its own cover. The thumbnail is
  **display-only**: CRM tile posters, Hub posters, lightbox. Wiring
  `cover_url`/`thumb_offset` into the Graph API call is a plausible future
  backend change, out of scope here.
- Server-side frame extraction.

## Design

### 1. Frame extraction utility — `apps/crm/src/utils/videoFrame.ts` (new)

- `captureFrameFromElement(video: HTMLVideoElement): Promise<File>` — core.
  Draws the element's current frame to a canvas and exports JPEG (q0.85),
  scaling so the longest edge is at most **1920px**. Rationale: the thumbnail
  is display-only (see Non-goals); a 4K frame at q0.85 is 1–3 MB, counts
  against the workspace storage quota, and renders as a poster in a 6-column
  grid. 1920px is visually identical as a poster and much cheaper. (The 10 MB
  thumbnail cap in `file-upload-url` is never approached.)
- `extractVideoFrame(source: File | string, timeSeconds?: number): Promise<File>`
  — wrapper. Loads the video (object URL for a `File`; remote URL with
  `crossOrigin="anonymous"` — R2 CORS already supports this, video tiles load
  with that attribute today), waits for metadata, seeks to
  `timeSeconds ?? min(0.5, duration / 2)` — guarding `duration` against
  NaN/Infinity (fall back to 0) — then delegates to `captureFrameFromElement`.
  Rejects on decode/load failure (e.g., HEVC `.mov` the browser can't play).
- **Capture-race requirement:** after setting `currentTime`, awaiting `seeked`
  alone is not sufficient — some browsers still paint a black or previous
  frame. Use `requestVideoFrameCallback` (supported in all targets) as the
  capture primitive, guarded by `readyState >= HAVE_CURRENT_DATA`. In the
  scrub dialog, pause the element before capturing — on a playing video the
  frame advances between the click and the draw.

### 2. Upload flow — `PostMediaGallery.tsx`

- **Extraction happens in the gallery, not the service.** `uploadPostMedia`
  keeps its current contract (thumbnail required for video). The gallery
  extracts a frame per video before calling it. This keeps "undecodable codec
  → fallback panel" trivially distinguishable from upload/network errors (no
  typed-error contract) and keeps the Vitest boundary clean.
- `handleFiles` no longer diverts videos to a blocking prompt. All files in a
  selection upload: images as today; videos get `extractVideoFrame(file)`
  first, then upload with that thumbnail.
- **Concurrency cap:** route `handleFiles` through the existing (currently
  unused by the gallery) `uploadMany` helper (`MAX_CONCURRENT = 3`,
  `postMedia.ts:265`), capping extraction + upload together. Unbounded
  concurrency would mean N hidden `<video>` elements decoding simultaneously
  for an N-video selection.
- **Fallback (load-bearing, not polish):** `file-upload-finalize` hard-requires
  `thumbnail_r2_key` for videos, so when extraction fails the video cannot
  upload. Failed videos go into a **queue** — `pendingVideos: File[]`
  (replacing the single-slot `pendingVideo`, which would silently overwrite
  when two videos fail) — and the existing amber panel handles them one at a
  time, asking for a manual thumbnail upload exactly as today. Canceling skips
  that video.
- After a video upload completes, the success toast offers an **"Ajustar
  miniatura"** action that opens the thumbnail editor for that video — the
  non-blocking, opt-in scrub entry point at upload time. `uploadPostMedia`
  returns the full `PostMedia` (link id, signed url, thumbnail_url), so the
  toast action needs no refetch.
- **Cache invalidation:** after a successful video upload AND after a
  successful thumbnail edit, invalidate `['workflow-covers']` alongside
  `['post-media', postId]`. The kanban board (`useEntregasData.ts:229`) and
  client detail page (`ClienteDetalhePage.tsx:339`) read covers — including
  `thumbnail_url` — from that separate query; without invalidation the board
  card keeps the stale cover until an unrelated refetch.
- `UploadHint` copy updated: thumbnail is generated automatically and can be
  adjusted afterwards.
- `hasVideoMissingThumbnail` (WorkflowDrawer "send to client" gate) stays
  untouched — still correct, and finalize enforces the constraint server-side.

### 3. Thumbnail editor — `ThumbnailPickerDialog.tsx` (new)

shadcn Dialog, CRM only. Two ways to set the cover:

- **Scrub:** the video plays in the dialog (signed URL,
  `crossOrigin="anonymous"`) with a timeline slider; "Usar este frame" pauses
  the element, then captures via `captureFrameFromElement` — no
  re-download/re-seek.
- **Upload:** file input accepting `image/jpeg,image/png,image/webp` (matches
  `THUMB_MIME` on both endpoints).

Shows the current thumbnail and a preview of the new choice before confirming.

**Copy requirements (i18n-visible, pinned here):**
- **Naming — avoid the "capa" collision.** The tile already uses "capa" for
  the `is_cover` concept (badge "capa", action "Definir como capa"). The
  thumbnail feature must use **"Miniatura do vídeo"** terminology everywhere
  (hover action title, dialog title, toast action "Ajustar miniatura"),
  leaving plain "capa" exclusively to the post-cover concept. Two adjacent
  buttons on one tile both saying "capa" while doing different things is a
  confusion trap.
- The dialog states that the miniatura applies to the CRM/Hub preview and
  does **not** change the published Instagram reel cover (avoids the
  expectation trap for users who scrub to a perfect frame).

Entry points:
1. New hover action (image icon) on video tiles in `SortableMediaTile` —
   placed inside the existing `onPointerDown={e => e.stopPropagation()}`
   wrapper (`PostMediaGallery.tsx:547`), since the tile container handles
   click (lightbox) and drag.
2. The post-upload toast's "Ajustar miniatura" action.

**Signed-URL expiry:** tile URLs are signed for 900s; a dialog opened from a
long-idle gallery could 403. Read the video URL from the current query cache
at open time rather than a captured prop; the error path (toast, dialog stays
open) covers the residual case.

### 4. Service — `updateVideoThumbnail(linkId, thumbnail)` in `postMedia.ts` (new)

Three steps, all against existing endpoints (zero backend changes):

1. `POST post-media-manage/:id/thumbnail` with `{ mime_type }` → presigned PUT
   URL + new R2 key (`handler.ts:183-191`).
2. PUT the image to R2.
3. `PATCH post-media-manage/:id` with `{ thumbnail_r2_key }` — handler already
   validates the `contas/{conta_id}/` prefix, swaps the key on `files`, and
   queues the old key in `file_deletions` (`handler.ts:159-168`).

**Shared-file caveat (accepted):** thumbnails live on the `files` table, so a
video linked to multiple posts shows the new thumbnail everywhere. This
matches existing PATCH behavior.

**Storage quota (accepted):** auto-thumbnails add bytes to every video upload
(`file-upload-url` counts thumbnail bytes against the workspace quota). At
≤1920px JPEG this is negligible — no action needed.

## Error handling

- Extraction failure at upload → video enters `pendingVideos` queue, manual
  thumbnail panel (today's behavior). No dead ends, no silent drops.
- Extraction/capture failure in the editor → error toast, dialog stays open so
  the user can fall back to the upload option.
- `updateVideoThumbnail` failure → error toast, no state change (PATCH is the
  commit point; an orphaned R2 object from a failed step 3 is acceptable —
  same exposure as the existing upload flow).

## Testing

- Vitest: gallery orchestration (extraction called per video, queue behavior
  on multi-failure, mixed-selection concurrency) and `updateVideoThumbnail`
  (3-step sequence, error propagation) with mocked fetch/XHR.
- jsdom cannot decode video, so `extractVideoFrame`'s load/seek logic is
  exercised with mocked media elements; real frame capture verified manually
  in the running app.
- i18n: new strings in the `posts` namespace locale files.
- Before pushing: `format` + `lint` + `test` + deno edge tests (CI enforces
  eslint/prettier/coverage-ratchet despite CLAUDE.md).

## Alternatives considered

- **Server-side extraction** (ffmpeg/Cloudflare Stream): new infrastructure,
  async complexity, cost. Rejected.
- **Make thumbnails truly optional** (drop DB CHECK constraint, render
  fallbacks in CRM + Hub): most downstream churn for no UX gain. Rejected.
- **Extraction inside `uploadPostMedia`**: requires a typed/sentinel error so
  the gallery can distinguish codec failure from network failure. Rejected in
  review — extraction in the gallery is simpler and tests cleaner.
