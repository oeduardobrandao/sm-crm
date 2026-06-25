# Instagram Stories Publishing — Design

**Date:** 2026-06-25
**Status:** Stage 2a implemented (uncommitted working tree); Stage 2b in design.
**Scope:** Make `tipo: 'stories'` posts publish to Instagram as native Stories.

> **Implementation state (2026-06-25):** Stage 2a (single-media stories) is already
> implemented in the working tree (uncommitted) and verified correct against this
> design — as-built references in §5–§7. The remaining design work is **Stage 2b
> (sequential multi-media), §8**, which is not yet implemented (the code still throws
> `"Stories require exactly one media file"` and validation rejects multi-media).

---

## 1. Problem

`tipo: 'stories'` is a first-class post type across the data model and the UI of
both apps, but it **cannot actually publish**. The publishing pipeline
(`createContainerForPost`) branches only on media shape — carousel / single-video
(REELS) / single-image — and ignores `tipo`. Two further blockers:

- `validateForScheduling` **requires** `ig_caption`; stories have no caption.
- `validateMedia` rejects portrait media below a `3:4` aspect floor, so a proper
  9:16 story image fails validation before it can even be scheduled.

A story sent to auto-publish today would be mis-published as a feed image/reel/
carousel based on its media, or fail validation outright.

## 2. Already shipped (no work needed)

Confirmed in code — the **entire UI layer is already story-aware**:

- **CRM editor** (`WorkflowDrawer.tsx:963,1232-1235`): when `tipo === 'stories'`
  the IG caption field is replaced by the hint *"Stories: 1 mídia, sem legenda,
  formato vertical 9:16."*
- **CRM publish buttons** (`ScheduleButton.tsx:217-223`): stories are exempt from
  the caption gate; Agendar / Publicar agora enable without a caption.
- **Hub (client portal)**: `StoryPostCard.tsx` renders a native 9:16 Instagram-
  story preview (progress segments, profile header, caption overlay, reply bar)
  with the client Aprovar / Correção flow. `AprovacoesPage.tsx` and
  `PostagensPage.tsx` group stories into their own "Stories" section and already
  support **multi-media stories** (multiple progress segments + tap-to-advance).
- **Data model**: `tipo` includes `'stories'` in `store/posts.ts`, the
  `workflow_posts` table constraint, and the Hub types.

The Hub already lets clients view and approve multi-segment stories. This design
makes publishing match that experience.

## 3. Instagram API facts (and a source caveat)

Stories use the same two-step container flow as other media: `POST /{ig-user-id}/media`
with `media_type=STORIES` and `image_url` **or** `video_url`, then
`POST /{ig-user-id}/media_publish`. Key properties:

- **Single media per container** — there is no carousel story. Multiple segments =
  multiple containers, each published separately.
- **No caption** — the caption field does not apply to stories.
- **No cover** — the cover/thumbnail flow (reels) does not apply.
- Containers **expire if not published within 24h**.
- Each published story **counts toward the per-account daily publish limit**.

> **Source caveat:** Meta's official Content Publishing page
> (`developers.facebook.com/docs/instagram-platform/content-publishing/`) is
> login-gated and could not be transcribed. The `media_type=STORIES` shape is
> confirmed via secondary sources; the exact media bounds in §5 are **our chosen
> conservative ("light") bounds**, not transcribed from the official spec.
> Instagram's async container validation (`ERROR` → `falha_publicacao`) is the
> backstop for anything we don't pre-validate.

## 4. Delivery: two stages

Shipped as two reviewable PRs, matching this repo's slice cadence.

- **Stage 2a — single-media stories. ✅ Implemented (uncommitted working tree).**
  Validation + `STORIES` container + call-site plumbing + tests. Multi-media stories
  remain rejected at validation. As-built references in §5–§7.
- **Stage 2b — sequential multi-media stories. ⬜ Not implemented — this design.**
  Adds the `story_segments` column, story-aware claim RPC, segment-resume processing,
  and partial-failure recovery. Removes the multi-media rejection. Closes the
  Hub/publish mismatch.

---

## 5. Validation (Stage 2a — ✅ implemented) — `_shared/instagram-publish-utils.ts:73-182`

As-built constants (one new story constant + reuse of existing bounds; "light" bounds —
see source caveat):

```ts
const STORY_IMAGE_AR_MIN = 9 / 16;   // 0.5625 — image stories may be full-vertical
const STORY_VIDEO_MAX_DURATION = 60; // seconds
// story image AR window = [STORY_IMAGE_AR_MIN (9:16), IMAGE_AR_MAX (1.91)]
// story video AR window  = [VIDEO_AR_MIN (9:16),      VIDEO_AR_MAX (1.25)]   (reused)
// story video duration   = [VIDEO_MIN_DURATION (3),   STORY_VIDEO_MAX_DURATION (60)]
// reuse: IMAGE_MAX_BYTES (8MB), VIDEO_MAX_BYTES (250MB), MIME sets, IMAGE_MIN_DIM (320)
```

- `validateMedia(files, opts?: { forStories?: boolean })` (`:81`): when `forStories`,
  overrides only the **image AR floor** (→ `STORY_IMAGE_AR_MIN`) and the **video max
  duration** (→ `STORY_VIDEO_MAX_DURATION`). Image AR ceiling and the video AR window
  are reused from feed/reels. MIME + size checks unchanged. Backward compatible.

  > Note: story **video** AR currently reuses the reels ceiling `VIDEO_AR_MAX = 1.25`
  > (not widened). Acceptable — stories are vertical — but flagged for a possible wider
  > story-video window later.

- `validateForScheduling` (`:147-182`): selects `tipo`, derives `isStory`, skips the
  `ig_caption` check for stories (`:162`). **Stage 2a (as-built):** a story with media
  count `!== 1` yields only `"Stories aceitam apenas uma mídia."` — per-file validation
  is skipped via the `if/else` (`:175-182`); a valid single-media story is checked with
  `validateMedia(mediaFiles, { forStories: true })`.
  **Stage 2b (this design):** remove the count cap; require ≥1 media; validate **each**
  media as a segment with `{ forStories: true }`.

## 6. Container creation (Stage 2a — ✅ implemented) — `_shared/instagram-publish-utils.ts`

- Helpers (`:281-317`):
  - `createStoryImageContainer(igUserId, token, imageUrl)` → `media_type:"STORIES"`,
    `image_url`, **no caption**.
  - `createStoryVideoContainer(igUserId, token, videoUrl)` → `media_type:"STORIES"`,
    `video_url`, **no caption, no cover**.
- `createContainerForPost(opts)` takes `tipo?: string` (`:414`) and branches on
  `tipo === 'stories'` **before** carousel/video/image (`:419-427`); single-media only
  (throws `"Stories require exactly one media file"` on `!== 1`). Returns
  `{ containerId }` with **no** `coverVideoUrl`, so the handler's coverless-retry path
  is skipped for stories.

## 7. Call-site plumbing (Stage 2a — ✅ implemented)

- **Cron** (`instagram-publish-cron/index.ts:101`): passes `tipo: post.tipo` into
  `createContainerForPost` (`tipo` already on the claimed row).
- **Handler** (`instagram-publish/handler.ts`): select includes `tipo` (`:58`); both
  `createContainerForPost` calls pass `tipo: post.tipo` (`:113`, `:203`), and
  `caption` is null-coalesced to `""`.
- **Permalink**: unchanged. `fetchPermalink` returns `null` gracefully and both publish
  paths guard with `if (permalink)`; story permalinks are often null.

---

## 8. Sequential multi-media (Stage 2b)

### 8.1 The model problem

`workflow_posts` tracks a **single** `instagram_container_id` and a **single**
`instagram_media_id`, and `claim_posts_for_publishing` decides each phase by their
null-ness. A multi-segment story needs **N** containers and **N** media ids,
published in order, with retries that do not re-post completed segments.

### 8.2 Per-segment state — `story_segments jsonb`

New nullable column `workflow_posts.story_segments jsonb`. For `tipo='stories'` it is
an ordered array, one entry per media (single-media story = a 1-element array):

```jsonc
[ { "file_id": 12, "container_id": "1789…", "media_id": "1790…" },
  { "file_id": 13, "container_id": null,    "media_id": null     } ]
```

- Non-story posts keep `story_segments` null and use the existing single columns.
- `instagram_container_id` / `instagram_media_id` stay null for stories **except**
  `instagram_media_id`, which mirrors the **first segment's** media id once posted —
  see §8.6 (compatibility).

### 8.3 `ensureStorySegments(db, postId)` — idempotent initializer

A single idempotent function that builds/repairs `story_segments` from
`post_file_links` (sorted by `sort_order`), preserving any already-persisted
`container_id` / `media_id` by `file_id`. Called from **every** entry point, not just
schedule:

- schedule front-load, publish-now, and the cron container phase (before processing);
- a **backfill** for already-scheduled `tipo='stories'` rows whose column is null.

Validation may also call it, but is never the sole initializer.

### 8.4 Claim RPC — story-aware predicates (`claim_posts_for_publishing`)

Make the phase predicates inspect the JSONB for stories (non-story predicates
unchanged). The RPC also returns `story_segments` to the worker.

- *container* phase: `tipo='stories'` AND any segment has `container_id IS NULL`
  (or `story_segments IS NULL`, to claim un-initialized rows).
- *publish* phase: `tipo='stories'` AND all segments have a `container_id` AND any
  segment lacks `media_id`.
- A story is **done** (`postado`) when every segment has a `media_id`.

Locking/update strategy (addresses lost updates):

- The existing `FOR UPDATE … SKIP LOCKED` + `publish_processing_at` claim lock
  (10-min window) guarantees a **single writer per post** across cron and publish-now
  (verified: publish-now sets `publish_processing_at` before processing, so the cron
  skips a post being published-now).
- Segment writes use **targeted `jsonb_set(story_segments, '{<i>,<field>}', …)`** on a
  specific index — never a full-array rewrite — so concurrent field writes can't
  clobber each other even in unexpected interleavings.

### 8.5 Processing + failure semantics

- **Container phase (story):** `ensureStorySegments`, then create a `STORIES`
  container for each segment with `container_id IS NULL`; persist each id via
  `jsonb_set`.
- **Publish phase (story):** for each segment with a `container_id` and no `media_id`,
  poll readiness then publish; persist `media_id` via `jsonb_set`. When the **last**
  segment gets its `media_id`, mark the post `postado`, set `published_at`, mirror the
  first segment's media id to `instagram_media_id`, and best-effort fetch a permalink
  (first non-null across segments) into `instagram_permalink`.
- **Container ERROR (point #1):** if a segment's container reaches Instagram `ERROR`,
  **clear that segment's `container_id`** before failing, so the next container-phase
  recreates it instead of re-polling a dead container forever. (This also fixes the
  single-post auto-retry path, where the cron currently reuses a dead `ERROR`
  container while the manual `retry` action already clears it.)
- **Partial failure:** on any segment failure the post goes `falha_publicacao` with
  `publish_error` naming the failed segment index. Retry resumes only unfinished
  segments (those without a `media_id`).
- **Idempotency is best-effort, only after a persisted `media_id` (point #2):** a
  segment with a stored `media_id` is skipped on retry. There remains a narrow window
  where `media_publish` succeeds but the DB write fails/times out — a retry could then
  duplicate that story or error on the already-consumed container. This is the **same
  risk the single-post flow already carries**; multi-segment makes it more visible. We
  document it; we do not add distributed-transaction machinery in this slice.

### 8.6 Compatibility — `instagram_media_id` (point #4)

Verified consumer: `supabase/functions/mcp/queries.ts` already tolerates null
(`.filter((x): x is string => !!x)` at `:174`; `if (post.instagram_media_id && …)` at
`:221`) — nothing throws on null. But a null means a story gets **no analytics/insight
matching**. We therefore mirror the **first segment's `media_id`** into
`instagram_media_id` on completion: preserves the loose "postado ⇒ media_id present"
invariant and keeps analytics matching working. Full per-segment ids live in
`story_segments`.

### 8.7 publish-now (handler) for multi-segment

The publish-now path loops segments synchronously (create → poll → publish, persisting
each `media_id`), under the `publish_processing_at` lock it already sets. If any
segment is still `IN_PROGRESS` within the poll budget, it persists progress and returns
the existing "ainda processando" response, leaving the cron to finish the remaining
segments. No coverless-retry for stories (no cover).

## 9. Rate limit

N segments = N posts against Instagram's per-account daily publish cap. No accounting
exists today; this slice **does not** add it. We `log()` per-segment publishes so the
volume is visible. Out of scope for enforcement.

## 10. Tests

Stage 2a tests already exist in the working tree: `instagram-publish-validation_test.ts`
(new), `instagram-publish-container_test.ts` (modified), and the `ScheduleButton.test.tsx`
story caption-exemption case. The items below are the Stage 2b additions.

**Deno** (`supabase/functions/`):

- `validateMedia` story rules: 9:16 image passes (fails under feed rules); >60s video
  fails; sub-3s video fails; bad MIME fails.
- `validateForScheduling`: story with no caption passes; Stage 2a — 2-media story
  rejected **without** per-file noise; Stage 2b — multi-media story validates each
  segment; valid story passes.
- Container creation: story image → `media_type:"STORIES"` + `image_url`, no caption;
  story video → no cover, no `coverVideoUrl`.
- Stage 2b: `ensureStorySegments` idempotency (re-run preserves persisted ids);
  segment publish marks `postado` only after the last `media_id`; ERROR clears the
  segment's `container_id`; first segment id mirrored to `instagram_media_id`.

**Vitest** (regression, point #5 of the earlier review):

- `ScheduleButton` enables schedule + publish-now for a `tipo:'stories'` post with no
  `ig_caption` (locks in the already-shipped exemption).

## 11. Out of scope

- Stickers, links, mentions, `user_tags` on stories.
- Rate-limit accounting/enforcement.
- Hub authoring changes (already shipped).
- Any change to feed/reels/carousel publishing beyond the shared ERROR-clears-
  container improvement noted in §8.5.

## 12. Open verification items

- Confirm Meta's current story media bounds against the official (login-gated) spec
  when access is available; reconcile the §5 constants if they differ.
- Confirm the exact per-account daily publish limit (sources cite 50 and 100 in
  different places) before any future rate-limit accounting work.
