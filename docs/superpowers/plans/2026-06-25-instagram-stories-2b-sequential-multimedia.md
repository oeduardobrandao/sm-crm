# Instagram Stories — Stage 2b (Sequential Multi-Media) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a `tipo:'stories'` post with N media as N sequential Instagram Stories, resuming idempotently on retry, so publishing matches the Hub's existing multi-segment story preview.

**Architecture:** Per-segment state lives in a new `workflow_posts.story_segments jsonb` array (`[{file_id, container_id, media_id}]`, ordered). The publish pipeline (cron Phase 1/2/3 + the handler publish-now path) processes stories segment-by-segment: create a `media_type:"STORIES"` container per segment, publish each, and mark the post `postado` only when every segment has a `media_id`. A single-writer-per-post guarantee comes from the existing `publish_processing_at` claim lock; segment writes use targeted `jsonb_set` via a dedicated RPC so they never clobber the whole array. The first segment's `media_id` is mirrored into `instagram_media_id` for downstream compatibility.

**Tech Stack:** Deno edge functions (TypeScript), Supabase Postgres (SQL migrations + `plpgsql`/`sql` RPCs), Instagram Graph API v22.0, R2 presigned URLs. Tests: `deno test supabase/functions/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-25-instagram-stories-publishing-design.md` (§8 is this stage).
- Stage 2a (single-media stories) is already implemented in the working tree — do NOT re-implement it. This stage **removes** the single-media cap and adds multi-media.
- Edge functions are **Deno**, not Node: imports use `npm:` or relative `.ts`; never add Node APIs.
- `TOKEN_ENCRYPTION_KEY` required, no fallback. CORS via `buildCorsHeaders(req)`, never `*`.
- Never log or return raw Graph API error details to clients; log internally, return generic messages.
- Migrations are append-only, named `YYYYMMDDHHMMSS_<name>.sql`. This stage uses `20260625000001_instagram_story_segments.sql`.
- Story containers carry **no caption, no cover** (Stage 2a `createStoryImageContainer`/`createStoryVideoContainer` already enforce this — reuse them).
- `StorySegment` shape is fixed for the whole plan: `{ file_id: number; container_id: string | null; media_id: string | null }`.
- Run `deno test supabase/functions/` after each task. Do not commit until the task's tests pass.
- Do NOT run `npx supabase db push` (deploys to staging/prod). Migration verification is review + local parse only.

---

## File Structure

- **Create** `supabase/migrations/20260625000001_instagram_story_segments.sql` — `story_segments` column, backfill, `set_story_segment_field` RPC, story-aware `claim_posts_for_publishing`.
- **Modify** `supabase/functions/_shared/instagram-publish-utils.ts` — `StorySegment` type, `ensureStorySegments`, `createMissingStorySegmentContainers`, `publishReadyStorySegments`; loosen `validateForScheduling` multi-media cap.
- **Modify** `supabase/functions/instagram-publish-cron/index.ts` — story branches in `processContainerCreation`, `processPublish`, `processRetry`; add `story_segments` to `ClaimedPost`.
- **Modify** `supabase/functions/instagram-publish/handler.ts` — multi-segment publish-now loop.
- **Create** `supabase/functions/__tests__/instagram-publish-story-segments_test.ts` — unit tests for the new utils helpers.
- **Modify** `supabase/functions/__tests__/instagram-publish-validation_test.ts` — multi-media validation cases.

---

## Task 1: Migration — column, backfill, segment RPC, story-aware claim

**Files:**
- Create: `supabase/migrations/20260625000001_instagram_story_segments.sql`

**Interfaces:**
- Consumes: existing `workflow_posts`, `post_file_links`, `files`, `claim_posts_for_publishing(p_phase, p_limit)`.
- Produces:
  - column `workflow_posts.story_segments jsonb` (nullable).
  - RPC `set_story_segment_field(p_post_id bigint, p_index int, p_field text, p_value text) returns void`.
  - `claim_posts_for_publishing` now also returns `story_segments jsonb` and treats stories via segment state.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260625000001_instagram_story_segments.sql`:

```sql
-- ============================================================
-- Instagram Stories 2b: per-segment publish state
-- ============================================================

-- 1. Per-segment state column (null for non-stories)
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS story_segments jsonb;

-- 2. Backfill already-scheduled / failed stories with null-id segments. Stage 2a is
--    not deployed, so there are no in-flight single-media stories whose existing
--    instagram_container_id needs preserving; any rare such row simply re-creates its
--    container on the next container phase (the orphan container expires in 24h).
UPDATE workflow_posts wp
SET story_segments = (
  SELECT jsonb_agg(
           jsonb_build_object('file_id', pfl.file_id, 'container_id', NULL, 'media_id', NULL)
           ORDER BY pfl.sort_order)
  FROM post_file_links pfl
  WHERE pfl.post_id = wp.id
)
WHERE wp.tipo = 'stories'
  AND wp.status IN ('agendado', 'falha_publicacao')
  AND wp.story_segments IS NULL;

-- 3. Targeted single-field segment update (avoids whole-array rewrites).
--    p_value NULL clears the field (used to reset a failed container).
CREATE OR REPLACE FUNCTION set_story_segment_field(
  p_post_id bigint,
  p_index int,
  p_field text,
  p_value text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE workflow_posts
  SET story_segments = jsonb_set(
    COALESCE(story_segments, '[]'::jsonb),
    ARRAY[p_index::text, p_field],
    CASE WHEN p_value IS NULL THEN 'null'::jsonb ELSE to_jsonb(p_value) END,
    true
  )
  WHERE id = p_post_id;
$$;

REVOKE ALL ON FUNCTION set_story_segment_field(bigint, int, text, text) FROM public;
GRANT EXECUTE ON FUNCTION set_story_segment_field(bigint, int, text, text) TO service_role;

-- 4. Story-aware claim. Non-story predicates unchanged; stories keyed off segments.
CREATE OR REPLACE FUNCTION claim_posts_for_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  ig_caption text,
  scheduled_at timestamptz,
  instagram_container_id text,
  instagram_media_id text,
  publish_retry_count smallint,
  tipo text,
  story_segments jsonb,
  encrypted_access_token text,
  instagram_user_id text,
  client_id bigint
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE
      CASE p_phase
        WHEN 'container' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now() + interval '1 hour'
          AND (
            (wp.tipo <> 'stories' AND wp.instagram_container_id IS NULL)
            OR (wp.tipo = 'stories' AND (
              wp.story_segments IS NULL
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'container_id' IS NULL
              )
            ))
          )
        WHEN 'publish' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now()
          AND (
            (wp.tipo <> 'stories' AND wp.instagram_container_id IS NOT NULL)
            OR (wp.tipo = 'stories'
              AND wp.story_segments IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'container_id' IS NULL
              )
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'media_id' IS NULL
              )
            )
          )
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.publish_retry_count < 3
      END
      AND (wp.publish_processing_at IS NULL
           OR wp.publish_processing_at < now() - interval '10 minutes')
    FOR UPDATE OF wp SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE workflow_posts
    SET publish_processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id AS post_id,
    u.workflow_id,
    u.ig_caption,
    u.scheduled_at,
    u.instagram_container_id,
    u.instagram_media_id,
    u.publish_retry_count,
    u.tipo,
    u.story_segments,
    ia.encrypted_access_token,
    ia.instagram_user_id,
    c.id AS client_id
  FROM updated u
  JOIN workflows w ON w.id = u.workflow_id
  JOIN clientes c ON c.id = w.cliente_id
  JOIN instagram_accounts ia ON ia.client_id = c.id;
$$;
```

- [ ] **Step 2: Verify the SQL parses locally (no deploy)**

Run: `grep -c "CREATE OR REPLACE FUNCTION" supabase/migrations/20260625000001_instagram_story_segments.sql`
Expected: `2` (the segment RPC + the claim RPC).

Manually re-read the claim RPC predicates and confirm: non-story branches are byte-identical to the prior migration except for the added `tipo <> 'stories'` guard; the `RETURNS TABLE` gained exactly one column (`story_segments jsonb`) positioned before `encrypted_access_token`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625000001_instagram_story_segments.sql
git commit -m "feat(stories): story_segments column, segment RPC, story-aware claim (2b)"
```

---

## Task 2: `ensureStorySegments` + `StorySegment` type

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts`
- Test: `supabase/functions/__tests__/instagram-publish-story-segments_test.ts` (create)

**Interfaces:**
- Consumes: existing `fetchPostMedia(db, postId)` (returns rows `{ id, kind, r2_key, thumbnail_r2_key, sort_order }`).
- Produces:
  - `export interface StorySegment { file_id: number; container_id: string | null; media_id: string | null }`
  - `export async function ensureStorySegments(db, postId: number): Promise<StorySegment[]>` — reads current `workflow_posts.story_segments`; if null/empty, builds one segment per media (ordered by `sort_order`) with null ids and persists via a single `update`; if present, returns it unchanged (idempotent). Preserves existing `container_id`/`media_id` by re-using the stored array.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/instagram-publish-story-segments_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";

Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const { ensureStorySegments } = await import("../_shared/instagram-publish-utils.ts");

// Minimal db stub: records updates, returns scripted selects.
// deno-lint-ignore no-explicit-any
function makeDb(opts: {
  segments?: unknown;
  links?: Array<{ sort_order: number; files: { id: number; kind: string; r2_key: string; thumbnail_r2_key: string | null } }>;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      const builder: any = {
        _table: table,
        _select: "",
        select(sel: string) { this._select = sel; return this; },
        eq() { return this; },
        order() { return Promise.resolve({ data: opts.links ?? [] }); },
        update(vals: Record<string, unknown>) { updates.push(vals); return { eq() { return Promise.resolve({ data: null }); } }; },
        single() {
          if (table === "workflow_posts") return Promise.resolve({ data: { story_segments: opts.segments ?? null } });
          return Promise.resolve({ data: null });
        },
        maybeSingle() { return Promise.resolve({ data: { story_segments: opts.segments ?? null } }); },
      };
      return builder;
    },
  };
  return { db, updates };
}

Deno.test("ensureStorySegments builds one null segment per media when absent", async () => {
  const { db, updates } = makeDb({
    segments: null,
    links: [
      { sort_order: 0, files: { id: 11, kind: "image", r2_key: "a.jpg", thumbnail_r2_key: null } },
      { sort_order: 1, files: { id: 12, kind: "video", r2_key: "b.mp4", thumbnail_r2_key: "b.jpg" } },
    ],
  });
  // deno-lint-ignore no-explicit-any
  const segs = await ensureStorySegments(db as any, 1);
  assertEquals(segs, [
    { file_id: 11, container_id: null, media_id: null },
    { file_id: 12, container_id: null, media_id: null },
  ]);
  assertEquals(updates.length, 1);
  assertEquals((updates[0] as any).story_segments, segs);
});

Deno.test("ensureStorySegments is idempotent and preserves persisted ids", async () => {
  const existing = [{ file_id: 11, container_id: "c1", media_id: "m1" }];
  const { db, updates } = makeDb({ segments: existing });
  // deno-lint-ignore no-explicit-any
  const segs = await ensureStorySegments(db as any, 1);
  assertEquals(segs, existing);
  assertEquals(updates.length, 0, "must not rewrite when segments already exist");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/__tests__/instagram-publish-story-segments_test.ts`
Expected: FAIL — `ensureStorySegments is not exported` / not a function.

- [ ] **Step 3: Implement `StorySegment` + `ensureStorySegments`**

In `supabase/functions/_shared/instagram-publish-utils.ts`, after the `PostMediaRow` interface / `fetchPostMedia` definition, add:

```ts
export interface StorySegment {
  file_id: number;
  container_id: string | null;
  media_id: string | null;
}

/**
 * Idempotently ensure a story post has a `story_segments` array (one entry per
 * media, ordered). Returns the existing array unchanged if already present,
 * preserving any persisted container_id/media_id. Only the single-writer holding
 * the publish_processing_at lock should call this.
 */
export async function ensureStorySegments(db: DbClient, postId: number): Promise<StorySegment[]> {
  const { data: post } = await db
    .from("workflow_posts")
    .select("story_segments")
    .eq("id", postId)
    .single();

  const existing = (post?.story_segments ?? null) as StorySegment[] | null;
  if (existing && existing.length > 0) return existing;

  const media = await fetchPostMedia(db, postId);
  const segments: StorySegment[] = media.map((m) => ({
    file_id: m.id,
    container_id: null,
    media_id: null,
  }));

  await db.from("workflow_posts").update({ story_segments: segments }).eq("id", postId);
  return segments;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/__tests__/instagram-publish-story-segments_test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-story-segments_test.ts
git commit -m "feat(stories): ensureStorySegments + StorySegment type (2b)"
```

---

## Task 3: Loosen `validateForScheduling` for multi-media stories

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts:175-182`
- Test: `supabase/functions/__tests__/instagram-publish-validation_test.ts`

**Interfaces:**
- Consumes: `validateMedia(files, { forStories })` (Stage 2a).
- Produces: `validateForScheduling` no longer rejects a story with >1 media; instead validates **each** media as a story segment. A 0-media story still errors. Non-story behavior unchanged.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/__tests__/instagram-publish-validation_test.ts` (reuse its existing `media`, `encryptedToken`, `queueSchedulingReads` helpers; mirror their call style):

```ts
Deno.test("validateForScheduling: multi-media story validates each segment (no count cap)", async () => {
  const db = createSupabaseQueryMock();
  await queueSchedulingReads(db, {
    tipo: "stories",
    igCaption: null,
    links: [
      { sort_order: 0, files: media({ id: 1, width: 1080, height: 1920 }) },
      { sort_order: 1, files: media({ id: 2, width: 1080, height: 1920 }) },
    ],
    encryptedAccessToken: await encryptedToken(),
  });
  // deno-lint-ignore no-explicit-any
  const res = await validateForScheduling(db as any, 1);
  assert(res.ok, `expected ok, got: ${res.errors.join("; ")}`);
});

Deno.test("validateForScheduling: multi-media story rejects a bad segment", async () => {
  const db = createSupabaseQueryMock();
  await queueSchedulingReads(db, {
    tipo: "stories",
    igCaption: null,
    links: [
      { sort_order: 0, files: media({ id: 1, width: 1080, height: 1920 }) },
      { sort_order: 1, files: media({ id: 2, mime_type: "image/gif" }) }, // bad MIME
    ],
    encryptedAccessToken: await encryptedToken(),
  });
  // deno-lint-ignore no-explicit-any
  const res = await validateForScheduling(db as any, 1);
  assert(!res.ok);
  assert(res.errors.some((e) => e.includes("JPEG")), res.errors.join("; "));
});
```

> If the existing `instagram-publish-validation_test.ts` has a test asserting the
> single-media cap (`"Stories aceitam apenas uma mídia"`), DELETE that test — the cap
> is being removed. Grep first: `grep -n "apenas uma mídia" supabase/functions/__tests__/instagram-publish-validation_test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/__tests__/instagram-publish-validation_test.ts`
Expected: FAIL — the multi-media story currently hits `"Stories aceitam apenas uma mídia."` so `res.ok` is false in the first new test.

- [ ] **Step 3: Replace the count-cap branch**

In `validateForScheduling`, replace the Stage-2a block (currently around `:175-182`):

```ts
  if (isStory && mediaFiles.length !== 1) {
    errors.push("Stories aceitam apenas uma mídia.");
  } else if (mediaFiles.length === 0) {
    errors.push("Post precisa de pelo menos uma mídia.");
  } else {
    const mediaErrors = validateMedia(mediaFiles, { forStories: isStory });
    for (const e of mediaErrors) errors.push(e.message);
  }
```

with:

```ts
  if (mediaFiles.length === 0) {
    errors.push("Post precisa de pelo menos uma mídia.");
  } else {
    const mediaErrors = validateMedia(mediaFiles, { forStories: isStory });
    for (const e of mediaErrors) errors.push(e.message);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/__tests__/instagram-publish-validation_test.ts`
Expected: PASS (including the two new tests; the deleted cap test is gone).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-validation_test.ts
git commit -m "feat(stories): validate multi-media stories per-segment, drop single-media cap (2b)"
```

---

## Task 4: Segment container creation + publishing helpers

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts`
- Test: `supabase/functions/__tests__/instagram-publish-story-segments_test.ts`

**Interfaces:**
- Consumes: `ensureStorySegments`, `fetchPostMedia`, `signGetUrl`, `createStoryImageContainer`, `createStoryVideoContainer`, `checkContainerStatus`, `publishContainer`, RPC `set_story_segment_field`.
- Produces:
  - `createMissingStorySegmentContainers(db, opts: { postId: number; igUserId: string; token: string }): Promise<StorySegment[]>` — for each segment with `container_id === null`, sign its media URL, create a `STORIES` container (image/video by kind), persist via `set_story_segment_field(postId, i, 'container_id', id)`. Returns the updated segments.
  - `publishReadyStorySegments(db, opts: { postId: number; igUserId: string; token: string; maxPolls?: number; intervalMs?: number }): Promise<{ segments: StorySegment[]; allDone: boolean }>` — for each segment with a `container_id` and no `media_id`, poll once-ish; on `FINISHED` publish and persist `media_id`; on `ERROR` clear that segment's `container_id` (via `set_story_segment_field(..., 'container_id', null)`) then throw; on `IN_PROGRESS` stop early (leave for next cycle). `allDone` = every segment has a `media_id`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/instagram-publish-story-segments_test.ts`:

```ts
const { createMissingStorySegmentContainers, publishReadyStorySegments } = await import(
  "../_shared/instagram-publish-utils.ts"
);

// db stub that also records set_story_segment_field rpc calls and returns scripted segments
// deno-lint-ignore no-explicit-any
function makeRpcDb(opts: {
  segments: any[];
  media?: Array<{ sort_order: number; files: { id: number; kind: string; r2_key: string; thumbnail_r2_key: string | null } }>;
}) {
  const rpcCalls: Array<{ fn: string; params: any }> = [];
  let segs = opts.segments;
  const db: any = {
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return Promise.resolve({ data: opts.media ?? [] }); },
        single() { return Promise.resolve({ data: table === "workflow_posts" ? { story_segments: segs } : null }); },
        update() { return { eq() { return Promise.resolve({ data: null }); } }; },
      };
    },
    rpc(fn: string, params: any) {
      rpcCalls.push({ fn, params });
      if (fn === "set_story_segment_field") {
        segs = segs.map((s, i) => (i === params.p_index ? { ...s, [params.p_field]: params.p_value } : s));
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, rpcCalls, get segments() { return segs; } };
}

// deno-lint-ignore no-explicit-any
function stubFetch(responder: (url: string, body: any, n: number) => any) {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    n += 1;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return Promise.resolve(new Response(JSON.stringify(responder(String(input), body, n)), { status: 200 }));
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

Deno.test("createMissingStorySegmentContainers creates STORIES container per empty segment", async () => {
  const ctx = makeRpcDb({
    segments: [
      { file_id: 11, container_id: null, media_id: null },
      { file_id: 12, container_id: "already", media_id: null },
    ],
    media: [
      { sort_order: 0, files: { id: 11, kind: "image", r2_key: "a.jpg", thumbnail_r2_key: null } },
      { sort_order: 1, files: { id: 12, kind: "video", r2_key: "b.mp4", thumbnail_r2_key: null } },
    ],
  });
  const bodies: any[] = [];
  const restore = stubFetch((_url, body, n) => { bodies.push(body); return { id: `cont-${n}` }; });
  try {
    await createMissingStorySegmentContainers(ctx.db, { postId: 1, igUserId: "ig", token: "t" });
  } finally { restore(); }

  // Only segment 0 (container_id null) gets created
  assertEquals(bodies.length, 1);
  assertEquals(bodies[0].media_type, "STORIES");
  assert(bodies[0].image_url, "image segment uses image_url");
  assert(!("caption" in bodies[0]), "stories carry no caption");
  // persisted via rpc for index 0
  const setCall = ctx.rpcCalls.find((c) => c.fn === "set_story_segment_field");
  assertEquals(setCall?.params.p_index, 0);
  assertEquals(setCall?.params.p_field, "container_id");
});

Deno.test("publishReadyStorySegments publishes ready segments and reports allDone", async () => {
  const ctx = makeRpcDb({
    segments: [
      { file_id: 11, container_id: "c1", media_id: null },
      { file_id: 12, container_id: "c2", media_id: null },
    ],
  });
  // GET status -> FINISHED; POST media_publish -> {id}
  const restore = stubFetch((url, _body, n) => {
    if (url.includes("media_publish")) return { id: `media-${n}` };
    return { status_code: "FINISHED" };
  });
  let result;
  try {
    result = await publishReadyStorySegments(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } finally { restore(); }
  assertEquals(result.allDone, true);
  const mediaSets = ctx.rpcCalls.filter((c) => c.fn === "set_story_segment_field" && c.params.p_field === "media_id");
  assertEquals(mediaSets.length, 2);
});

Deno.test("publishReadyStorySegments clears container_id and throws on ERROR", async () => {
  const ctx = makeRpcDb({ segments: [{ file_id: 11, container_id: "c1", media_id: null }] });
  const restore = stubFetch((_url) => ({ status_code: "ERROR" }));
  let threw = false;
  try {
    await publishReadyStorySegments(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } catch { threw = true; } finally { restore(); }
  assert(threw, "must throw on ERROR");
  const cleared = ctx.rpcCalls.find((c) => c.fn === "set_story_segment_field" && c.params.p_field === "container_id" && c.params.p_value === null);
  assert(cleared, "must clear the failed segment container_id");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/__tests__/instagram-publish-story-segments_test.ts`
Expected: FAIL — `createMissingStorySegmentContainers` / `publishReadyStorySegments` not exported.

- [ ] **Step 3: Implement the two helpers**

In `instagram-publish-utils.ts`, after `ensureStorySegments`, add:

```ts
async function setSegmentField(
  db: DbClient,
  postId: number,
  index: number,
  field: "container_id" | "media_id",
  value: string | null,
): Promise<void> {
  // deno-lint-ignore no-explicit-any
  await (db as any).rpc("set_story_segment_field", {
    p_post_id: postId,
    p_index: index,
    p_field: field,
    p_value: value,
  });
}

/** Create a STORIES container for every segment that lacks one; persist each id. */
export async function createMissingStorySegmentContainers(
  db: DbClient,
  opts: { postId: number; igUserId: string; token: string },
): Promise<StorySegment[]> {
  const { postId, igUserId, token } = opts;
  const segments = await ensureStorySegments(db, postId);
  const media = await fetchPostMedia(db, postId);
  const byFileId = new Map(media.map((m) => [m.id, m]));

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.container_id) continue;
    const file = byFileId.get(seg.file_id);
    if (!file) throw new Error(`Story segment ${i}: media file ${seg.file_id} not found`);
    const url = await signGetUrl(file.r2_key, 7200);
    const container = file.kind === "video"
      ? await createStoryVideoContainer(igUserId, token, url)
      : await createStoryImageContainer(igUserId, token, url);
    seg.container_id = container.id;
    await setSegmentField(db, postId, i, "container_id", container.id);
  }
  return segments;
}

/**
 * Publish any segment whose container is FINISHED. On ERROR, clear that segment's
 * container_id (so the next container phase recreates it) and throw. On IN_PROGRESS,
 * stop and leave the rest for the next cron cycle. allDone = all segments posted.
 */
export async function publishReadyStorySegments(
  db: DbClient,
  opts: { postId: number; igUserId: string; token: string; maxPolls?: number; intervalMs?: number },
): Promise<{ segments: StorySegment[]; allDone: boolean }> {
  const { postId, igUserId, token, maxPolls = 2, intervalMs = 3000 } = opts;
  const segments = await ensureStorySegments(db, postId);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.media_id) continue;
    if (!seg.container_id) break; // a container is still missing; container phase first

    const status = await pollContainerReady(seg.container_id, token, maxPolls, intervalMs);
    if (status === "IN_PROGRESS") break; // try again next cycle
    if (status === "ERROR") {
      seg.container_id = null;
      await setSegmentField(db, postId, i, "container_id", null);
      throw new Error(`Story segment ${i + 1} falhou no processamento do Instagram`);
    }
    const result = await publishContainer(igUserId, token, seg.container_id);
    seg.media_id = result.id;
    await setSegmentField(db, postId, i, "media_id", result.id);
  }

  const allDone = segments.every((s) => !!s.media_id);
  return { segments, allDone };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/__tests__/instagram-publish-story-segments_test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-story-segments_test.ts
git commit -m "feat(stories): per-segment container creation + publish helpers (2b)"
```

---

## Task 5: Cron — story branches in container/publish/retry phases

**Files:**
- Modify: `supabase/functions/instagram-publish-cron/index.ts`

**Interfaces:**
- Consumes: `createMissingStorySegmentContainers`, `publishReadyStorySegments`, `ensureStorySegments`, `fetchPermalink`.
- Produces: cron processes `tipo:'stories'` posts segment-wise; marks `postado` only when `allDone`; mirrors first segment `media_id` into `instagram_media_id`. `ClaimedPost` gains `story_segments`.

- [ ] **Step 1: Add `story_segments` to `ClaimedPost` + import helpers**

In the imports from `../_shared/instagram-publish-utils.ts`, add `createMissingStorySegmentContainers`, `publishReadyStorySegments`. In the `ClaimedPost` interface add:

```ts
  story_segments: Array<{ file_id: number; container_id: string | null; media_id: string | null }> | null;
```

- [ ] **Step 2: Story branch in `processContainerCreation`**

Replace the body of `processContainerCreation` so stories use the segment path:

```ts
async function processContainerCreation(
  db: any,
  post: ClaimedPost,
) {
  const token = await decryptToken(post.encrypted_access_token);

  if (post.tipo === "stories") {
    await createMissingStorySegmentContainers(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
    });
    await db.from("workflow_posts").update({ publish_processing_at: null }).eq("id", post.post_id);
    console.log(`[IG-PUBLISH] Story containers ensured for post ${post.post_id}`);
    return;
  }

  const { containerId } = await createContainerForPost(db, {
    igUserId: post.instagram_user_id,
    token,
    postId: post.post_id,
    caption: post.ig_caption,
    useCover: post.publish_retry_count === 0,
    tipo: post.tipo,
  });

  await db.from("workflow_posts").update({
    instagram_container_id: containerId,
    publish_processing_at: null,
  }).eq("id", post.post_id);

  console.log(`[IG-PUBLISH] Container created for post ${post.post_id}: ${containerId}`);
}
```

- [ ] **Step 3: Story branch in `processPublish`**

At the top of `processPublish`, before the existing single-container logic:

```ts
  const token = await decryptToken(post.encrypted_access_token);

  if (post.tipo === "stories") {
    const { segments, allDone } = await publishReadyStorySegments(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
    });
    if (!allDone) {
      await clearLock(db, post.post_id);
      console.log(`[IG-PUBLISH] Story post ${post.post_id} partially published, will continue next cycle`);
      return;
    }
    const firstMediaId = segments[0]?.media_id ?? null;
    await db.from("workflow_posts").update({
      instagram_media_id: firstMediaId,
      status: "postado",
      published_at: new Date().toISOString(),
      publish_processing_at: null,
      publish_error: null,
      publish_retry_count: 0,
    }).eq("id", post.post_id);
    console.log(`[IG-PUBLISH] Published story post ${post.post_id} (${segments.length} segments)`);
    const permalink = firstMediaId ? await fetchPermalink(firstMediaId, token) : null;
    if (permalink) {
      await db.from("workflow_posts").update({ instagram_permalink: permalink }).eq("id", post.post_id);
    }
    return;
  }

  const containerId = post.instagram_container_id!;
```

> Remove the now-duplicate `const token = await decryptToken(...)` line that previously
> began `processPublish` (it is moved above the story branch). Leave the rest of the
> non-story body intact.

- [ ] **Step 4: Story branch in `processRetry`**

Replace `processRetry`:

```ts
async function processRetry(
  db: any,
  post: ClaimedPost,
) {
  if (post.tipo === "stories") {
    const token = await decryptToken(post.encrypted_access_token);
    await createMissingStorySegmentContainers(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
    });
    const { segments, allDone } = await publishReadyStorySegments(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
    });
    if (allDone) {
      await db.from("workflow_posts").update({
        instagram_media_id: segments[0]?.media_id ?? null,
        status: "postado",
        published_at: new Date().toISOString(),
        publish_processing_at: null,
        publish_error: null,
        publish_retry_count: 0,
      }).eq("id", post.post_id);
    } else {
      await db.from("workflow_posts").update({ status: "agendado", publish_processing_at: null }).eq("id", post.post_id);
    }
    return;
  }

  if (!post.instagram_container_id) {
    await processContainerCreation(db, post);
    await db.from("workflow_posts").update({ status: "agendado" }).eq("id", post.post_id);
  } else if (!post.instagram_media_id) {
    await processPublish(db, post);
  }
}
```

- [ ] **Step 5: Typecheck the function**

Run: `deno check supabase/functions/instagram-publish-cron/index.ts`
Expected: no errors. (If `deno check` pollutes `node_modules`/`deno.lock`, restore per project memory: `git checkout deno.lock && npm ci`.)

- [ ] **Step 6: Run the full edge-function suite**

Run: `deno test supabase/functions/`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/instagram-publish-cron/index.ts
git commit -m "feat(stories): cron publishes multi-segment stories sequentially (2b)"
```

---

## Task 6: Handler publish-now — multi-segment loop

**Files:**
- Modify: `supabase/functions/instagram-publish/handler.ts:190-263`

**Interfaces:**
- Consumes: `ensureStorySegments`, `createMissingStorySegmentContainers`, `publishReadyStorySegments`, `fetchPermalink`, `record_post_status_change`.
- Produces: publish-now publishes all story segments in one request (longer poll budget); if any segment is still processing, persists progress and returns the existing "ainda processando" response, leaving the cron to finish.

- [ ] **Step 1: Add a story branch at the start of the publish-now `try`**

In the `if (action === "publish-now")` block, immediately inside `try {` (after `const token = ...` and `const igUserId = ...`), insert the story branch before the existing single-container logic:

```ts
        if (post.tipo === "stories") {
          await createMissingStorySegmentContainers(svcDb, { postId, igUserId, token });
          const { segments, allDone } = await publishReadyStorySegments(svcDb, {
            postId, igUserId, token, maxPolls: 12, intervalMs: 3000,
          });
          if (!allDone) {
            await svcDb.from("workflow_posts").update({
              scheduled_at: new Date().toISOString(),
              publish_processing_at: null,
            }).eq("id", postId);
            return json({
              ok: true,
              status: "agendado",
              message: "Stories ainda processando no Instagram. Os segmentos restantes serão publicados em instantes.",
            });
          }
          const firstMediaId = segments[0]?.media_id ?? null;
          await svcDb.rpc("record_post_status_change", {
            p_post_id: postId,
            p_new_status: "postado",
            p_source: "workspace_user",
            p_actor: actorId,
            p_fields: {
              instagram_media_id: firstMediaId,
              published_at: new Date().toISOString(),
              publish_processing_at: null,
              publish_error: null,
              publish_retry_count: 0,
            },
          });
          const permalink = firstMediaId ? await fetchPermalink(firstMediaId, token) : null;
          if (permalink) {
            await svcDb.from("workflow_posts").update({ instagram_permalink: permalink }).eq("id", postId);
          }
          return json({ ok: true, status: "postado", instagram_permalink: permalink });
        }
```

- [ ] **Step 2: Import the helpers**

Add `createMissingStorySegmentContainers`, `publishReadyStorySegments` to the import from `../_shared/instagram-publish-utils.ts` at the top of `handler.ts`.

- [ ] **Step 3: Typecheck**

Run: `deno check supabase/functions/instagram-publish/handler.ts`
Expected: no errors.

- [ ] **Step 4: Run the full edge-function suite**

Run: `deno test supabase/functions/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-publish/handler.ts
git commit -m "feat(stories): publish-now publishes multi-segment stories (2b)"
```

---

## Task 7: Schedule front-load — skip stories (let the cron own segments)

**Files:**
- Modify: `supabase/functions/instagram-publish/handler.ts:101-124`

**Interfaces:**
- Consumes: existing schedule front-load block.
- Produces: the schedule action no longer calls `createContainerForPost` for stories (which throws on multi-media). Story container creation is owned by the cron container phase / publish-now.

- [ ] **Step 1: Guard the front-load against stories**

In the `if (action === "schedule")` block's best-effort front-load `try`, change the condition so stories are skipped:

```ts
        if (dueInMs <= 3_600_000 && validation.account && post.tipo !== "stories") {
```

(Stories rely on `ensureStorySegments` + the cron container phase; no single-container front-load.)

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/instagram-publish/handler.ts`
Expected: no errors.

- [ ] **Step 3: Run the full edge-function suite**

Run: `deno test supabase/functions/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-publish/handler.ts
git commit -m "feat(stories): skip single-container front-load for stories on schedule (2b)"
```

---

## Task 8: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full edge-function suite**

Run: `deno test supabase/functions/`
Expected: PASS, including `instagram-publish-story-segments_test.ts`, `instagram-publish-validation_test.ts`, `instagram-publish-container_test.ts`.

- [ ] **Step 2: Frontend build + tests unaffected**

Run: `npm run build && npm run test`
Expected: typecheck + Vitest PASS (the CRM/Hub story UI from Stage 2a is unchanged here; this confirms no shared-type drift).

> If `deno test`/`deno check` polluted `node_modules` or `deno.lock` and the build
> breaks, restore per project memory: `git checkout deno.lock && npm ci`, then re-run.

- [ ] **Step 3: Manual review checklist (read, don't run)**

Confirm against the spec §8:
- Multi-media story: claim `container` phase creates N containers; `publish` phase posts them; `postado` only when all segments have `media_id`.
- Retry after a mid-sequence failure does not re-post segments that already have a `media_id`.
- An `ERROR` container clears its segment's `container_id` so the next container phase recreates it.
- `instagram_media_id` mirrors the first segment.

- [ ] **Step 4: No commit** (verification task).

---

## Self-Review

**Spec coverage (§8):**
- §8.2 `story_segments` column → Task 1.
- §8.3 `ensureStorySegments` (schedule/publish-now/cron/backfill) → Task 2 (function) + Task 1 (backfill) + called from Tasks 5/6.
- §8.4 story-aware claim + locking + targeted `jsonb_set` → Task 1 (claim RPC + `set_story_segment_field`) used in Task 4.
- §8.5 processing + ERROR-clears-container + partial-failure → Task 4 (`publishReadyStorySegments`), Tasks 5/6.
- §8.6 `instagram_media_id` first-segment mirror → Tasks 5/6.
- §8.7 publish-now multi-segment → Task 6.
- §5 (Stage 2b validation: drop cap) → Task 3.

**Placeholder scan:** none — every code/SQL step is complete.

**Type consistency:** `StorySegment` defined once (Task 2), reused verbatim in `ClaimedPost` (Task 5) and helper signatures (Task 4). Helper names consistent across tasks: `ensureStorySegments`, `createMissingStorySegmentContainers`, `publishReadyStorySegments`, `set_story_segment_field`. `publishReadyStorySegments` returns `{ segments, allDone }` and is consumed that way in Tasks 5/6.

**Known follow-ups (out of scope, noted in spec §9/§12):** rate-limit accounting for N segments; confirming Meta's exact story media bounds.
