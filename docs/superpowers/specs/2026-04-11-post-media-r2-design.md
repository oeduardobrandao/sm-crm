# Post Media Attachments via Cloudflare R2

**Date:** 2026-04-11
**Status:** Draft

## Summary

Let CRM users attach photos and videos to Entregas posts, stored in Cloudflare R2, so clients can view them inside the existing hub app (`apps/hub/`). This replaces the current workaround of linking to Google Drive. Media is organized per-post with a gallery model and one designated cover item. Approval stays at the post level — clients only view media, no per-item interaction.

## Goals

- CRM users can upload photos (JPG/PNG/WebP/GIF) and short videos (MP4/MOV/WebM) up to 400 MB per file directly to R2, attached to a specific post.
- Each post has a gallery of media with exactly one cover item shown on cards and as the post thumbnail.
- Videos require a user-uploaded thumbnail image; posts cannot be marked ready until every video has one.
- Clients see the cover on post cards in the hub and a fullscreen lightbox/carousel of all media when opening a post.
- Single shared R2 bucket, credentials scoped to Edge Functions only; browser never sees keys.
- Storage quota enforced per workspace (nullable — null means unlimited — in preparation for the upcoming pricing plans).

## Non-Goals

- Per-item client feedback, commenting, or approval.
- Server-side video transcoding or automatic thumbnail extraction.
- Per-workspace R2 buckets or bring-your-own-storage.
- Files > 400 MB or multipart uploads.
- Standalone media library outside of posts.

## Architecture

### Storage layout

- Single Cloudflare R2 bucket.
- Object keys: `contas/{conta_id}/posts/{post_id}/{media_id}.{ext}`
- Video thumbnails: `contas/{conta_id}/posts/{post_id}/{media_id}.thumb.jpg`
- Credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) live in Supabase Edge Function secrets only.
- Bucket is private. All access is via presigned URLs.

### Upload flow (CRM → R2)

1. User picks files in `PostMediaGallery` on a post.
2. Client validates mime/size locally.
3. For images: client reads dimensions via an `Image` object.
4. For videos: client reads `videoWidth`/`videoHeight`/`duration` via a hidden `<video>`, and requires the user to pick a thumbnail image before proceeding.
5. Client calls `post-media-upload-url` → receives `{ media_id, upload_url, r2_key, thumbnail_upload_url?, thumbnail_r2_key? }`.
6. Client `PUT`s the file to `upload_url` via `XMLHttpRequest` (for progress events). Thumbnails upload the same way in parallel.
7. On both PUTs complete, client calls `post-media-finalize` with the full metadata.
8. Finalize verifies objects exist via R2 `HeadObject`, inserts the `post_media` row, and returns it.
9. If the post has no cover yet, the new item is automatically marked as cover.

Abandoned uploads (tab closed, network lost between step 6 and 8) leave orphan objects in R2, cleaned by the cleanup cron.

### Read flow — CRM side

- `post-media-manage` (method `GET`) returns all media rows for a post with short-lived presigned GET URLs (15 min) for both the main file and thumbnail.

### Read flow — hub side

- `hub-posts` is extended: each post includes `media: [...]` with presigned GET URLs (1-hour expiry) and the resolved `cover_media` for convenience.
- Thumbnails are served as `thumbnail_url` alongside `url` so the hub can set `<video poster={thumbnail_url}>` without touching the video byte stream.
- On a 403 from an image/video element, the hub refetches `hub-posts` once to get fresh URLs.

## Data Model

### New table: `post_media`

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` PK | |
| `post_id` | `bigint` NOT NULL FK → `workflow_posts(id)` ON DELETE CASCADE | |
| `conta_id` | `uuid` NOT NULL FK → `workspaces(id)` ON DELETE CASCADE | denormalized for RLS + R2 key prefix (matches project convention) |
| `r2_key` | `text` NOT NULL | main object key |
| `thumbnail_r2_key` | `text` NULL | required for `kind='video'`, ignored for images |
| `kind` | `text` CHECK (`kind` IN ('image', 'video')) | |
| `mime_type` | `text` NOT NULL | |
| `size_bytes` | `bigint` NOT NULL | ≤ 400 MB, enforced on finalize |
| `original_filename` | `text` NOT NULL | |
| `width` | `int` NULL | |
| `height` | `int` NULL | |
| `duration_seconds` | `int` NULL | videos only |
| `is_cover` | `boolean` NOT NULL DEFAULT false | |
| `sort_order` | `int` NOT NULL DEFAULT 0 | |
| `uploaded_by` | `uuid` FK → `auth.users.id` | |
| `created_at` | `timestamptz` NOT NULL DEFAULT now() | |

Constraints:

- `CREATE UNIQUE INDEX post_media_one_cover_per_post ON post_media(post_id) WHERE is_cover = true;`
- `CHECK (kind = 'image' OR thumbnail_r2_key IS NOT NULL)` — videos must have a thumbnail.
- `CHECK (size_bytes > 0 AND size_bytes <= 419430400)` — 400 MB.

Allowed mime types (enforced at `post-media-upload-url` and `post-media-finalize`):

- Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Videos: `video/mp4`, `video/quicktime`, `video/webm`
- Video thumbnails: `image/jpeg`, `image/png`, `image/webp`

### Cover reassignment trigger

When a `post_media` row with `is_cover = true` is deleted, promote the next item (lowest `sort_order`, tiebreak by `id`) to cover. If no items remain, no cover.

### Deletion queue: `post_media_deletions`

| Column | Type |
|---|---|
| `id` | `bigint` PK |
| `r2_key` | `text` NOT NULL |
| `enqueued_at` | `timestamptz` DEFAULT now() |
| `attempts` | `int` DEFAULT 0 |
| `last_error` | `text` NULL |

A trigger on `post_media` `AFTER DELETE` enqueues both `r2_key` and (if present) `thumbnail_r2_key`. `post-media-cleanup-cron` drains the queue.

### Workspace quota

Add to `workspaces`:

- `storage_quota_bytes` `bigint` NULL — null = unlimited.

Enforcement: at `post-media-upload-url`, sum `size_bytes` across `post_media` for the `conta_id` plus the new upload. If over, return `413` with `{ error: 'quota_exceeded', used, quota }`.

### RLS

`post_media` readable/writable by members of the matching `conta_id`, following the `workflow_posts` RLS pattern: policy `USING (conta_id IN (SELECT public.get_my_conta_id()))` plus a `service_role_bypass` policy. Hub reads bypass RLS via service role inside `hub-posts` (same as today).

## Edge Functions

### New: `post-media-upload-url` (authenticated)

- Input: `{ post_id, filename, mime_type, size_bytes, kind, thumbnail?: { mime_type, size_bytes } }`
- Validates: user → workspace → post ownership; mime allowlist; size ≤ 400 MB; quota; `thumbnail` required iff `kind='video'`.
- Generates `media_id` (uuid or bigint), builds R2 keys, signs PUT URLs (15-min expiry).
- Returns `{ media_id, upload_url, r2_key, thumbnail_upload_url?, thumbnail_r2_key? }`.
- Does not touch the database.

### New: `post-media-finalize` (authenticated)

- Input: `{ post_id, media_id, r2_key, thumbnail_r2_key?, kind, mime_type, size_bytes, original_filename, width?, height?, duration_seconds? }`
- Verifies object(s) exist in R2 via `HeadObject` and that `ContentLength` matches `size_bytes` (blocks fake rows).
- Inserts `post_media`. Auto-sets `is_cover = true` if this is the first item on the post.
- Returns the inserted row (with a freshly signed read URL for immediate UI use).

### New: `post-media-manage` (authenticated)

- `GET ?post_id=...` → all media for a post with presigned read URLs (15 min for CRM use).
- `PATCH /:id` with `{ is_cover? , sort_order? }` → in a transaction: if setting cover, unset prior cover first.
- `DELETE /:id` → deletes the DB row; trigger enqueues R2 deletion.
- Replacing a video thumbnail: `POST /:id/thumbnail` → returns a fresh presigned PUT for a new `thumbnail_r2_key`; after upload, client calls `PATCH` to swap `thumbnail_r2_key` and enqueues the old one for deletion.

### New: `post-media-cleanup-cron` (no JWT)

- Runs hourly.
- Drains `post_media_deletions`: issues `DeleteObject` calls, removes successful rows, increments `attempts` / stores `last_error` on failure. Alerts if `attempts > 5`.
- Sweeps orphan R2 objects: lists objects under `workspaces/*/posts/*/` older than 24h with no matching `post_media` row and deletes them.

### Modified: `hub-posts`

- After fetching posts, fetch `post_media` for those posts in one query.
- For each post, build `media: [{ id, kind, mime_type, url, thumbnail_url, width, height, duration_seconds, is_cover, sort_order }]` with presigned GET URLs (1 hour).
- Add `cover_media` (the cover entry) as a top-level convenience field on the post.

## Frontend

### Shared

- New module `apps/crm/src/services/postMedia.ts` — upload orchestration, dimension/duration probing, presigned URL calls, retry logic, parallelism cap (3 concurrent). Progress events via `XMLHttpRequest.upload`.
- Extend CRM types (`apps/crm/src/store.ts` or local types) with `PostMedia`.

### CRM (`apps/crm/`)

**New: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`**
- Grid of media tiles + upload dropzone tile.
- Per-tile: thumbnail (image or video poster), progress overlay during upload, "missing thumbnail" warning for videos without one, menu with {Set as cover, Replace thumbnail (videos only), Delete}.
- Drag-to-reorder (persists `sort_order` via `PATCH`).
- Validates mime/size client-side before hitting the network.
- Shows quota-exceeded errors prominently.

**Modified: `WorkflowDrawer.tsx` / post editor panel**
- Hosts `PostMediaGallery` next to `PostEditor`. Exact placement decided during implementation after reading the drawer layout.
- Blocks "mark post ready" (or equivalent status transition) when any video in the gallery is missing a thumbnail.

**Modified: `WorkflowCard.tsx`**
- When the post has a `cover_media`, show a small cover thumbnail in the card header. Graceful fallback if absent.

### Hub (`apps/hub/`)

**Modified: `apps/hub/src/api.ts`**
- Extend the post type with `media` and `cover_media`.

**Modified: `apps/hub/src/components/PostCard.tsx`**
- Render `cover_media` thumbnail. Overlay a play icon if cover is a video.
- Click/tap opens the lightbox.

**New: `apps/hub/src/components/PostMediaLightbox.tsx`**
- Fullscreen carousel over all media for a post.
- Keyboard nav (←/→/Esc), swipe on touch, pinch-zoom on images.
- Videos use native `<video controls poster={thumbnail_url}>`.
- Refetches post on a 403 from an element (expired URL).

**Consumers**: `apps/hub/src/pages/PostagensPage.tsx` and `apps/hub/src/pages/AprovacoesPage.tsx` both render post cards and must wire up the lightbox.

### Visual components skill

All new visual components (`PostMediaGallery`, `PostMediaLightbox`, updated `PostCard` / `WorkflowCard` treatments) must be built via the `frontend-design:frontend-design` skill during implementation to keep the design language consistent with the rest of the product.

### R2 CORS

Configure the bucket CORS policy to allow:

- `PUT` from CRM origins (prod + dev).
- `GET` from hub origins (prod + dev).
- Headers: `Content-Type`, `Content-Length`.

## Error Handling & Edge Cases

- **Upload interrupted** — UI offers retry; orphan in R2 swept by cron.
- **Tab closed mid-upload** — same; orphan swept.
- **Post deleted while upload in flight** — finalize fails on FK check; orphan swept.
- **R2 outage** — upload-url still succeeds (it's just signing), PUT fails → UI shows retry. Read URLs served with a placeholder tile on failure.
- **Presigned GET expired on hub** — one automatic refetch of `hub-posts`.
- **Cover deleted** — trigger promotes next item by `sort_order`.
- **Video missing thumbnail** — gallery shows warning; post ready-state blocked.
- **Quota exceeded** — `413` from upload-url; UI surfaces a clear message with used/quota numbers.
- **Thumbnail replacement** — old `thumbnail_r2_key` enqueued to deletion queue on swap.

## Testing

- **Unit**: mime/size validators, quota math, cover-unicity trigger, cover reassignment trigger, cleanup-queue draining, video-requires-thumbnail check.
- **Integration (edge functions)**: upload-url → PUT → finalize → read → delete → cleanup full roundtrip against a test R2 bucket or mocked S3 client.
- **Manual**: happy path (image + video), 400 MB video, interrupted upload, hub rendering of cover and lightbox, cover reassignment, quota hit, thumbnail replacement.

## Environment Variables (Edge Functions)

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

## Open Questions

- Exact placement of `PostMediaGallery` within `WorkflowDrawer.tsx` — decided during implementation after reading the drawer.
- Where to wire the "post ready" gate — depends on current status transition implementation; identified during implementation.
