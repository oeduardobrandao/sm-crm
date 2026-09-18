# Instagram Carousel Resumable Children Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Instagram carousel posts the same resumable, persisted per-item container state machine that Stories already have (`story_segments`), so a carousel whose video children need more than one cron tick to transcode is finished across ticks instead of failing the whole post; then delete the synchronous pacing/poll stopgap that is currently in prod.

**Architecture:** A new nullable `workflow_posts.carousel_children jsonb` column (array of `{file_id, kind, container_id, ready}`) plus a `set_carousel_child_field` RPC, mirroring `20260625000001_instagram_story_segments.sql`. Four new functions in `supabase/functions/_shared/instagram-publish-utils.ts` (`ensureCarouselChildren`, `createMissingCarouselChildContainers`, `pollCarouselChildrenReady`, and the composing `advanceCarouselContainer`) persist each child's container id the moment it is created and each child's readiness the moment Meta reports FINISHED, and only assemble the CAROUSEL parent once every child is ready. The cron's Phase 1 (`processContainerCreation`) and `instagram-publish`'s `publish-now` get a carousel branch parallel to their existing Stories branch; a "not ready yet" outcome clears the lock and returns without marking the post failed, exactly like the Stories `!allDone` path. `createContainerForPost` keeps its simple throw-or-return contract for single images/videos and throws for carousels.

**Tech Stack:** Deno edge functions (ES modules, `npm:` / relative `.ts` imports), Supabase Postgres (SQL migration, `SECURITY DEFINER` RPC), `deno test` with hand-rolled fetch/db stubs (see `supabase/functions/__tests__/instagram-publish-story-segments_test.ts`) and `test/shared/supabaseMock.ts` for handler-level tests.

## Global Constraints

- Deno runtime only in `supabase/functions/`: ES modules, imports via `npm:` specifier or relative `.ts` paths. No Node APIs.
- Type gate for edge functions is `npm run check:functions` (deno check). Test gate is `npm run test:functions` (`deno test --no-check`). Both must pass. `npm run test:functions` dirties `deno.lock`; run `git checkout -- deno.lock` afterwards unless you intend to commit a lockfile change.
- Migration filename prefix (digits before the first `_`) must be unique across ALL of `supabase/migrations/`, including anything merged to `main` after this branch was cut. CI job `migration-version-guard` fails on a duplicate. Re-check `git fetch origin main && git log --oneline HEAD..origin/main -- supabase/migrations` immediately before choosing the final prefix.
- Never commit `.env`, `.env.local`, `.env.staging`.
- Never log or return raw Meta error details to clients; edge functions keep the existing generic responses.
- Edge functions deployed from this git worktree need `--project-ref skjzpekeqefvlojenfsw --use-api`. `--no-verify-jwt` is required for `instagram-publish-cron` only (it authenticates via `x-cron-secret`), NOT for `instagram-publish`.
- Error message wording that must be preserved verbatim because `classifyPublishError` (`supabase/functions/_shared/publish-error-codes.ts`) pattern-matches it:
  - `"falhou no processamento do Instagram"` → `MEDIA_UNSUPPORTED` (non-retryable, stops the auto-retry loop; same routing Stories use for a segment ERROR).
  - `"Carrossel do Instagram aceita no máximo ..."` → `CAROUSEL_LIMIT`.
  - `TRIAL_MEDIA_SHAPE_ERROR` constant → `TRIAL_INELIGIBLE`.
  - `"Failed to persist ..."` → `INTERNAL`.
- Portuguese user-facing copy, no em-dashes in user-facing strings.

---

## Context the implementer needs (read before Task 1)

### The incident and the stopgap

Post 5093 (workspace "Hanna Marques", 8 videos + 2 images) failed on every attempt on 2026-09-17 with Meta's generic `"An unexpected error has occurred. Please retry your request later."` (`IG_TRANSIENT`), and `instagram_container_id` stayed `null` every time: the failure happened inside the synchronous "create all children then assemble the parent" burst in `createContainerForPost`'s carousel branch, so nothing was ever persisted and every retry redid everything from scratch.

**Migration prefix:** latest found in the worktree at planning time was `20260923000008_post_content_versions_baseline_same_update.sql`, with nothing newer on `origin/main`; this plan uses `20260923000009`. Task 2 Step 1 re-verifies both before the file is created.

A stopgap is **already deployed to prod but NOT yet committed** in this worktree (`git status` shows `M supabase/functions/_shared/instagram-publish-utils.ts` and `M supabase/functions/__tests__/instagram-publish-container_test.ts`). It is the block in `createContainerForPost` guarded by the comment that starts `// Narrow mitigation for a real prod failure (post 5093, 2026-09-17)` and the three constants `CAROUSEL_VIDEO_CHILD_DELAY_MS`, `CAROUSEL_CHILD_POLL_ROUNDS`, `CAROUSEL_CHILD_POLL_INTERVAL_MS`. Task 1 commits it as-is so that Task 9's deletion is a clean, reviewable diff.

### Decisions already made (do not redesign; each is explained so you can implement it faithfully)

| # | Decision | Why |
|---|---|---|
| D1 | Carousel path lives OUTSIDE `createContainerForPost`: callers branch on "is carousel" first (like they already branch on `tipo === "stories"`), and `createContainerForPost` throws if handed a carousel. | Keeps the throw-or-return contract for images / single videos untouched (smallest blast radius); mirrors the Stories wiring exactly. |
| D2 | One composing helper `advanceCarouselContainer` (create missing → poll → assemble when all ready) returns `{ containerId: string \| null, children, allReady }`. | Cron Phase 1 and `publish-now` need the identical sequence; `processContainerCreation` is not exported, so this helper is the only unit-testable surface for the wiring. |
| D3 | Cron Phase 2 (`processPublish`) and Phase 3 (`processRetry`) get NO carousel branch. | Once the parent CAROUSEL container exists in `instagram_container_id`, Phase 2 is the generic poll-then-publish path. Phase 3's non-story arm already re-enters `processContainerCreation` when `instagram_container_id` is null, then sets `status: 'agendado'`; a "pending" outcome (lock cleared, no throw) therefore flows back into Phase 1 on the next tick with zero changes. |
| D4 | `claim_posts_for_publishing` is NOT changed. | Its `container` phase claims `tipo <> 'stories' AND instagram_container_id IS NULL`, which re-claims an in-flight carousel every tick until the parent is assembled. Its `publish` phase (`instagram_container_id IS NOT NULL`) picks it up afterwards. |
| D5 | Polling is round-based: one `Promise.all(checkContainerStatus)` over every pending child per round, bounded by `maxPolls` rounds. | Sequential per-child polling (what `publishReadyStorySegments` does) would cost 8 videos × 2 polls × 3 s = 48 s in one tick; rounds bound the wall clock to `maxPolls × intervalMs` regardless of child count. |
| D6 | `set_carousel_child_field` takes `p_value jsonb`, not `text`. | `ready` is a boolean; `to_jsonb(text)` would store the string `"true"`. `COALESCE(p_value, 'null'::jsonb)` guards the bare-NULL case where `jsonb_set` would null the whole column. |
| D7 | `ensureCarouselChildren` rebuilds the array when the persisted `file_id` sequence no longer matches `post_file_links` (deliberate deviation from `ensureStorySegments`). | `post_file_link_replace` (`20260916000001`) only refuses gallery swaps when `instagram_container_id IS NOT NULL OR story_segments IS NOT NULL`; an in-flight carousel has a null parent id, so a swap mid-flight would leave stale `file_id`s and `createMissingCarouselChildContainers` would throw "not found" forever. Extending the SQL guard instead would make FAILED carousels un-editable, a regression. |
| D8 | `reorder_post_schedules` is copied forward in the migration with one added statement: the non-story branch also nulls `carousel_children` when the post is not yet published. | It already nulls `instagram_container_id` on reschedule. Without the change, a reschedule more than 24 h ahead leaves `ready: true` children whose Meta containers have expired; the next Phase 1 would assemble a parent from dead children and fail 3× identically, the exact incident shape. Stories solve this inside the same RPC (they null every segment's `container_id`). |
| D9 | `cancel`, `retry`, and both CONTAINER_EXPIRED paths clear `carousel_children` with a separate `.update()`. | `record_post_status_change` has a fixed `p_fields` allowlist (`20260807000001` lines 36-56) that does not include the new column. Clearing makes a manual retry rebuild from scratch (safe: nothing has been published) instead of re-using children of unknown validity. Automatic Phase 3 retries keep partial progress because they never go through these paths. |
| D10 | The `schedule` front-load in `instagram-publish/handler.ts` SKIPS carousels (same as it already skips Stories). | It only fires when the post is due within 1 h, which is also the cron's container window, so it saves at most 60 s; it also runs without holding `publish_processing_at`, so a concurrent cron tick could create duplicate children. Not worth the race. |
| D11 | A child ERROR clears only that child's `container_id`, persists it, and throws `Item N do carrossel falhou no processamento do Instagram`. | Matches the Stories precedent; the wording routes to `MEDIA_UNSUPPORTED` in `classifyPublishError` with no classifier change (locked by a test in Task 5). |

### How the pieces fit at runtime (carousel, scheduled post)

1. Cron Phase 1 claims the post (`instagram_container_id IS NULL`). `processContainerCreation` sees it is a carousel (`isCarouselPost`), calls `advanceCarouselContainer`.
2. `createMissingCarouselChildContainers` creates a Graph container for each child lacking one and persists each id immediately via `set_carousel_child_field`.
3. `pollCarouselChildrenReady` polls up to 2 rounds × 3 s; FINISHED children get `ready: true` persisted; an ERROR child is cleared and the function throws (post → `falha_publicacao`, Phase 3 retries it, recreating only that child).
4. If any child is still not ready: `advanceCarouselContainer` returns `{ containerId: null, allReady: false }`; the cron clears the lock and returns. Next tick, step 1 again, resuming from persisted state.
5. When all are ready: the CAROUSEL parent is created, its id written to `instagram_container_id`. Phase 2 then handles it exactly like a single-image post.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260923000009_instagram_carousel_children.sql` | Create | Column, backfill, `set_carousel_child_field` RPC, `reorder_post_schedules` copy-forward (prefix re-verified in Task 2). |
| `supabase/functions/_shared/instagram-publish-utils.ts` | Modify | `CarouselChild` type, `ensureCarouselChildren`, `isCarouselPost`, `setCarouselChildField` (private), `carouselLimitMessage` (private), `createMissingCarouselChildContainers`, `pollCarouselChildrenReady`, `advanceCarouselContainer`; stopgap removed and carousel branch of `createContainerForPost` replaced by a throw (Task 9). |
| `supabase/functions/instagram-publish-cron/index.ts` | Modify | Carousel branch in `processContainerCreation`; `markFailed` clears `carousel_children` on CONTAINER_EXPIRED. |
| `supabase/functions/instagram-publish/handler.ts` | Modify | Front-load skips carousels; `publish-now` carousel branch; `cancel` / `retry` / CONTAINER_EXPIRED clear `carousel_children`. |
| `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts` | Create | Unit tests for the four utils functions + `isCarouselPost` + classifier lock. |
| `supabase/functions/__tests__/instagram-publish-carousel-handler_test.ts` | Create | Handler-level tests: `publish-now` pending path, `publish-now` full path, `cancel` clears children. |
| `supabase/functions/__tests__/instagram-publish-container_test.ts` | Modify | Stopgap tests and helpers deleted; carousel test becomes "throws, zero Graph calls". |

---

### Task 1: Commit the deployed stopgap as the baseline

**Files:**
- Commit (already modified, uncommitted): `supabase/functions/_shared/instagram-publish-utils.ts`, `supabase/functions/__tests__/instagram-publish-container_test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean working tree so every later task's diff is only its own change, and Task 9's stopgap removal is reviewable as a deletion.

- [ ] **Step 1: Confirm the uncommitted diff is the stopgap and nothing else**

Run:
```bash
cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/instagram-api-delete-post-0bfd35
git status --short
git diff --stat
```
Expected: exactly the two files above are modified. `git diff supabase/functions/_shared/instagram-publish-utils.ts` shows the `// Narrow mitigation for a real prod failure (post 5093, 2026-09-17)` comment block, the three `CAROUSEL_*` constants, and the pacing/poll code inside the `if (isCarousel)` block. If anything else is modified, stop and ask before committing.

- [ ] **Step 2: Run the existing test file to prove the baseline is green**

Run:
```bash
npm run test:functions -- --filter "createContainerForPost"
git checkout -- deno.lock
```
Expected: all `createContainerForPost:` tests pass (including the two stopgap tests "video-heavy carousel paces children and waits out IN_PROGRESS" and "video child ERROR before assembly → throws, no parent call").

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-container_test.ts
git commit -m "fix(instagram): pace carousel video children and poll before assembly (prod stopgap, post 5093)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration: `carousel_children` column, backfill, `set_carousel_child_field`, `reorder_post_schedules` copy-forward

**Files:**
- Create: `supabase/migrations/20260923000009_instagram_carousel_children.sql`
- Reference (read only): `supabase/migrations/20260625000001_instagram_story_segments.sql`, `supabase/migrations/20260830000002_avulso_claim_reorder_ica.sql:225-360` (canonical `reorder_post_schedules`)

**Interfaces:**
- Produces: column `workflow_posts.carousel_children jsonb` (nullable); SQL function `set_carousel_child_field(p_post_id bigint, p_index int, p_field text, p_value jsonb) RETURNS void` (service_role only); `reorder_post_schedules` now also nulls `carousel_children` on reschedule of an unpublished non-story post.

- [ ] **Step 1: Verify the migration prefix is unique (record what you found)**

At the time this plan was written the latest migration in the worktree was `20260923000008_post_content_versions_baseline_same_update.sql` and `git log --oneline HEAD..origin/main -- supabase/migrations` was empty, so `20260923000009` was chosen. Re-verify NOW:

```bash
cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/instagram-api-delete-post-0bfd35
git fetch origin main
git log --oneline HEAD..origin/main -- supabase/migrations
ls supabase/migrations | sort | tail -3
git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3
```
Expected: no file on either side has prefix `20260923000009`. If one does, pick the next free `202609230000NN` above BOTH lists, and use that prefix everywhere this plan says `20260923000009`.

Also confirm that `20260830000002` is still the LAST migration defining `reorder_post_schedules` (this repo mixes SQL casing, so search case-insensitively):
```bash
grep -il "function reorder_post_schedules" supabase/migrations/*.sql | sort | tail -3
```
Expected: the last line printed is `supabase/migrations/20260830000002_avulso_claim_reorder_ica.sql`. If a later file appears, copy the function body from THAT file instead (Step 2's section 4 and Step 3's canonical path both change accordingly); otherwise the copy-forward would silently revert it.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260923000009_instagram_carousel_children.sql`:

```sql
-- ============================================================
-- Instagram carousels: per-child container state, resumable across cron ticks
-- ============================================================
-- Mirrors 20260625000001_instagram_story_segments.sql. Before this, a carousel's
-- children were created AND the CAROUSEL parent assembled inside one synchronous
-- cron tick, with nothing persisted until the whole burst succeeded (prod post
-- 5093, 2026-09-17: 8 videos, failed identically on every attempt). A child is
-- never published on its own, so an element carries no media_id -- only whether
-- its container reached FINISHED before the parent is built.
-- Element shape: {file_id, kind: 'image'|'video', container_id, ready}

-- 1. Per-child state column (null for non-carousels)
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS carousel_children jsonb;

-- 2. Backfill in-flight carousels (agendado / falha_publicacao, no parent yet,
--    more than one media). ensureCarouselChildren builds this lazily anyway, so
--    this is a convenience for rows the cron will touch on its next tick, not a
--    correctness requirement. A post whose parent already exists keeps flowing
--    through the unchanged publish phase.
UPDATE workflow_posts wp
SET carousel_children = (
  SELECT jsonb_agg(
           jsonb_build_object(
             'file_id', pfl.file_id,
             'kind', CASE WHEN f.kind = 'video' THEN 'video' ELSE 'image' END,
             'container_id', NULL,
             'ready', false)
           ORDER BY pfl.sort_order)
  FROM post_file_links pfl
  JOIN files f ON f.id = pfl.file_id
  WHERE pfl.post_id = wp.id
)
WHERE COALESCE(wp.tipo, '') <> 'stories'
  AND wp.status IN ('agendado', 'falha_publicacao')
  AND wp.instagram_container_id IS NULL
  AND wp.instagram_media_id IS NULL
  AND wp.carousel_children IS NULL
  AND (SELECT count(*) FROM post_file_links pfl2 WHERE pfl2.post_id = wp.id) > 1;

-- 3. Targeted single-field child update (avoids whole-array rewrites).
--    p_value is jsonb, NOT text as in set_story_segment_field: `ready` is a
--    boolean and to_jsonb(text) would store the string "true". A SQL NULL
--    new_value makes jsonb_set return NULL for the whole column, hence the
--    COALESCE -- callers pass JSON null to clear container_id.
CREATE OR REPLACE FUNCTION set_carousel_child_field(
  p_post_id bigint,
  p_index int,
  p_field text,
  p_value jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE workflow_posts
  SET carousel_children = jsonb_set(
    COALESCE(carousel_children, '[]'::jsonb),
    ARRAY[p_index::text, p_field],
    COALESCE(p_value, 'null'::jsonb),
    true
  )
  WHERE id = p_post_id;
$$;

-- service_role only. REVOKE FROM public alone is not enough on hosted Supabase,
-- where default privileges grant EXECUTE directly to anon/authenticated
-- (house gotcha, 20260806000002).
REVOKE ALL ON FUNCTION set_carousel_child_field(bigint, int, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_carousel_child_field(bigint, int, text, jsonb) TO service_role;

-- 4. reorder_post_schedules copy-forward.
-- Canonical: 20260830000002_avulso_claim_reorder_ica.sql (section 3). Copied
-- verbatim; the ONLY change is in the non-story branch of the agendado UPDATE,
-- which now also nulls carousel_children when the post is unpublished. Without
-- it a reschedule >24h ahead keeps ready:true children whose Meta containers
-- have expired, and the next container phase would assemble a parent from dead
-- children and fail 3x identically -- the exact shape of the 5093 incident.
-- Stories already handle this here by nulling every segment's container_id.
-- hub_reorder_post_schedules (wrapper) is unchanged and keeps delegating.
CREATE OR REPLACE FUNCTION reorder_post_schedules(
  p_cliente_id       bigint,
  p_conta_id         uuid,
  p_updates          jsonb,
  p_allowed_statuses text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids       bigint[];
  v_count     int;
  v_owned     int;
  v_locked    bigint[];
  v_updated   int := 0;
  r           record;
  v_new_at    timestamptz;
  v_status    text;
  v_tipo      text;
  v_media_id  text;
  v_segments  jsonb;
BEGIN
  IF p_updates IS NULL
     OR jsonb_typeof(p_updates) <> 'array'
     OR jsonb_array_length(p_updates) = 0 THEN
    RAISE EXCEPTION 'BAD_REQUEST: empty updates';
  END IF;

  SELECT array_agg((e->>'post_id')::bigint) INTO v_ids
  FROM jsonb_array_elements(p_updates) e;

  -- A swap must reference each post at most once.
  IF (SELECT count(*) FROM unnest(v_ids)) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'BAD_REQUEST: duplicate post_id';
  END IF;
  v_count := array_length(v_ids, 1);

  -- Lock every owned target row up front, in a stable order, to serialize against
  -- claim_posts_for_publishing and any concurrent reorder.
  PERFORM 1
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.cliente_id = p_cliente_id
    AND wp.conta_id  = p_conta_id
  ORDER BY wp.id
  FOR UPDATE OF wp;

  -- Ownership: every id must resolve to a row owned by this client/account.
  SELECT count(*) INTO v_owned
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.cliente_id = p_cliente_id
    AND wp.conta_id  = p_conta_id;
  IF v_owned <> v_count THEN
    RAISE EXCEPTION 'FORBIDDEN: post outside token scope';
  END IF;

  -- Status allowlist — reject the whole batch if any post is not reschedulable.
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND NOT (wp.status = ANY(p_allowed_statuses));
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: forbidden status: %', v_locked;
  END IF;

  -- Publishing safety: an agendado row the cron is actively working on is off-limits.
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.status = 'agendado'
    AND wp.publish_processing_at IS NOT NULL
    AND wp.publish_processing_at >= now() - interval '10 minutes';
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: publishing in progress: %', v_locked;
  END IF;

  FOR r IN
    SELECT (e->>'post_id')::bigint AS pid, e->>'scheduled_at' AS at
    FROM jsonb_array_elements(p_updates) e
  LOOP
    v_new_at := CASE WHEN r.at IS NULL THEN NULL ELSE r.at::timestamptz END;

    SELECT wp.status, wp.tipo, wp.instagram_media_id, wp.story_segments
      INTO v_status, v_tipo, v_media_id, v_segments
    FROM workflow_posts wp
    WHERE wp.id = r.pid;

    IF v_status = 'agendado' THEN
      -- A scheduled post must keep a valid, not-immediate future slot.
      IF v_new_at IS NULL OR v_new_at < now() + interval '10 minutes' THEN
        RAISE EXCEPTION 'BAD_REQUEST: agendado needs a future date';
      END IF;

      IF v_tipo = 'stories' THEN
        -- Defense-in-depth: if any segment already published we must not move it;
        -- otherwise drop prepared containers so the cron rebuilds them near the new time.
        IF v_segments IS NOT NULL
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'media_id' IS NOT NULL) THEN
          RAISE EXCEPTION 'LOCKED: publishing in progress: {%}', r.pid;
        END IF;
        UPDATE workflow_posts
        SET scheduled_at = v_new_at,
            story_segments = CASE
              WHEN v_segments IS NULL THEN NULL
              ELSE (
                SELECT jsonb_agg(jsonb_set(s, '{container_id}', 'null'::jsonb))
                FROM jsonb_array_elements(v_segments) s
              )
            END
        WHERE id = r.pid;
      ELSE
        -- Non-story: clear a prepared (not-yet-published) container so a fresh one
        -- is built near the new time; never touch an already-published media.
        -- Carousel children are dropped for the same reason: their Meta containers
        -- expire in 24h and the parent is rebuilt from them (this migration).
        UPDATE workflow_posts
        SET scheduled_at = v_new_at,
            instagram_container_id = CASE
              WHEN v_media_id IS NULL THEN NULL
              ELSE instagram_container_id
            END,
            carousel_children = CASE
              WHEN v_media_id IS NULL THEN NULL
              ELSE carousel_children
            END
        WHERE id = r.pid;
      END IF;
    ELSE
      UPDATE workflow_posts SET scheduled_at = v_new_at WHERE id = r.pid;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION reorder_post_schedules(bigint, uuid, jsonb, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION reorder_post_schedules(bigint, uuid, jsonb, text[]) TO service_role;
```

- [ ] **Step 3: Diff the copied function against the canonical to prove "verbatim + one change"**

Run:
```bash
cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/instagram-api-delete-post-0bfd35
sed -n '225,360p' supabase/migrations/20260830000002_avulso_claim_reorder_ica.sql > /tmp/reorder_canonical.sql
awk '/^CREATE OR REPLACE FUNCTION reorder_post_schedules/,/^GRANT EXECUTE ON FUNCTION reorder_post_schedules/' supabase/migrations/20260923000009_instagram_carousel_children.sql > /tmp/reorder_new.sql
diff /tmp/reorder_canonical.sql /tmp/reorder_new.sql
```
Expected: the only differences are (a) the two added comment lines starting `-- Carousel children are dropped`, (b) the added `carousel_children = CASE ... END` clause plus the comma now ending the `instagram_container_id` CASE's `END` line, and (c) the REVOKE line, which in the new file also names `anon, authenticated` (house rule from 20260806000002; the canonical already does this too, so this may show no diff). Anything else is a copy error; fix it.

- [ ] **Step 4: Confirm the version guard is satisfied**

Run:
```bash
ls supabase/migrations | sed 's/_.*//' | sort | uniq -d
```
Expected: no output (no duplicate prefixes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260923000009_instagram_carousel_children.sql
git commit -m "feat(db): workflow_posts.carousel_children + set_carousel_child_field for resumable carousels

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `CarouselChild` type, `ensureCarouselChildren`, `isCarouselPost`

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (insert after `selectStoryMediaId`, i.e. after the line `export function selectStoryMediaId(...) { ... }` and before `export interface ContainerCreationResult`)
- Create: `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts`

**Interfaces:**
- Consumes: `fetchPostMedia(db, postId): Promise<PostMediaRow[]>` (existing, same file; `PostMediaRow = { id, kind, r2_key, thumbnail_r2_key, sort_order }`), `DbClient` type (existing, same file).
- Produces:
  - `export interface CarouselChild { file_id: number; kind: "image" | "video"; container_id: string | null; ready: boolean }`
  - `export async function ensureCarouselChildren(db: DbClient, postId: number): Promise<CarouselChild[]>` (idempotent; rebuilds when the persisted file sequence differs from `post_file_links`).
  - `export async function isCarouselPost(db: DbClient, postId: number, tipo?: string | null): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { classifyPublishError, TRIAL_MEDIA_SHAPE_ERROR } from "../_shared/publish-error-codes.ts";

// signGetUrl presigns locally (no network) but reads R2 env lazily.
Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const {
  ensureCarouselChildren,
  isCarouselPost,
} = await import("../_shared/instagram-publish-utils.ts");

type MediaLink = {
  sort_order: number;
  files: { id: number; kind: string; r2_key: string; thumbnail_r2_key: string | null };
};

function link(sort: number, id: number, kind: string): MediaLink {
  return {
    sort_order: sort,
    files: { id, kind, r2_key: `${kind}/${id}.${kind === "video" ? "mp4" : "jpg"}`, thumbnail_r2_key: null },
  };
}

// Stateful db stub: `children` is what workflow_posts.carousel_children reads back;
// set_carousel_child_field rpc mutates it in place (like the real RPC would), and
// a whole-column update replaces it. Records every update and rpc call.
// deno-lint-ignore no-explicit-any
function makeDb(opts: { children?: any; media?: MediaLink[] }) {
  const updates: Array<Record<string, unknown>> = [];
  // deno-lint-ignore no-explicit-any
  const rpcCalls: Array<{ fn: string; params: any }> = [];
  let children = opts.children ?? null;
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return Promise.resolve({ data: opts.media ?? [] }); },
        single() {
          return Promise.resolve({ data: table === "workflow_posts" ? { carousel_children: children } : null });
        },
        update(vals: Record<string, unknown>) {
          updates.push(vals);
          if ("carousel_children" in vals) children = vals.carousel_children;
          return { eq() { return Promise.resolve({ data: null }); } };
        },
      };
    },
    // deno-lint-ignore no-explicit-any
    rpc(fn: string, params: any) {
      rpcCalls.push({ fn, params });
      if (fn === "set_carousel_child_field" && Array.isArray(children)) {
        // deno-lint-ignore no-explicit-any
        children = children.map((c: any, i: number) =>
          i === params.p_index ? { ...c, [params.p_field]: params.p_value } : c
        );
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, updates, rpcCalls, get children() { return children; } };
}

Deno.test("ensureCarouselChildren builds one unready child per media when absent", async () => {
  const ctx = makeDb({ children: null, media: [link(0, 11, "image"), link(1, 12, "video")] });
  const children = await ensureCarouselChildren(ctx.db, 1);
  assertEquals(children, [
    { file_id: 11, kind: "image", container_id: null, ready: false },
    { file_id: 12, kind: "video", container_id: null, ready: false },
  ]);
  assertEquals(ctx.updates.length, 1);
  assertEquals(ctx.updates[0].carousel_children, children);
});

Deno.test("ensureCarouselChildren is idempotent and preserves persisted state", async () => {
  const existing = [
    { file_id: 11, kind: "image", container_id: "c1", ready: true },
    { file_id: 12, kind: "video", container_id: "c2", ready: false },
  ];
  const ctx = makeDb({ children: existing, media: [link(0, 11, "image"), link(1, 12, "video")] });
  const children = await ensureCarouselChildren(ctx.db, 1);
  assertEquals(children, existing);
  assertEquals(ctx.updates.length, 0, "must not rewrite when the file sequence is unchanged");
});

Deno.test("ensureCarouselChildren rebuilds when the media set changed (gallery swap / reorder)", async () => {
  const stale = [
    { file_id: 11, kind: "image", container_id: "c1", ready: true },
    { file_id: 12, kind: "video", container_id: "c2", ready: true },
  ];
  // file 12 was swapped for file 99 in the gallery
  const ctx = makeDb({ children: stale, media: [link(0, 11, "image"), link(1, 99, "video")] });
  const children = await ensureCarouselChildren(ctx.db, 1);
  assertEquals(children, [
    { file_id: 11, kind: "image", container_id: null, ready: false },
    { file_id: 99, kind: "video", container_id: null, ready: false },
  ]);
  assertEquals(ctx.updates.length, 1, "stale array must be replaced");
});

Deno.test("isCarouselPost: stories never, single media no, 2+ media yes", async () => {
  const two = [link(0, 1, "image"), link(1, 2, "image")];
  assertEquals(await isCarouselPost(makeDb({ media: two }).db, 1, "stories"), false);
  assertEquals(await isCarouselPost(makeDb({ media: [link(0, 1, "video")] }).db, 1, "reels"), false);
  assertEquals(await isCarouselPost(makeDb({ media: two }).db, 1, "feed"), true);
  assertEquals(await isCarouselPost(makeDb({ media: two }).db, 1, null), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /Users/eduardosouza/projects/sm-crm/.claude/worktrees/instagram-api-delete-post-0bfd35
npm run test:functions -- --filter "ensureCarouselChildren"
```
Expected: FAIL. The dynamic import succeeds but `ensureCarouselChildren` is `undefined` ("ensureCarouselChildren is not a function"), or the `isCarouselPost` test fails the same way.

- [ ] **Step 3: Implement**

In `supabase/functions/_shared/instagram-publish-utils.ts`, insert immediately after the closing brace of `selectStoryMediaId` (before `export interface ContainerCreationResult`):

```ts
// --- Carousel children (resumable per-child state, mirrors story_segments) ---

export interface CarouselChild {
  file_id: number;
  kind: "image" | "video";
  container_id: string | null;
  ready: boolean;
}

function sameFileSequence(children: CarouselChild[], media: PostMediaRow[]): boolean {
  if (children.length !== media.length) return false;
  return children.every((c, i) => c.file_id === media[i].id);
}

/**
 * Idempotently ensure a carousel post has a `carousel_children` array (one entry
 * per media, ordered). Returns the persisted array unchanged when its file_id
 * sequence still matches post_file_links, preserving container_id/ready. Unlike
 * ensureStorySegments it REBUILDS when the sequence differs: post_file_link_replace
 * only blocks gallery swaps once instagram_container_id is set, and an in-flight
 * carousel has none yet, so a swap mid-flight would otherwise leave stale file_ids
 * that createMissingCarouselChildContainers could never resolve. Only the
 * single-writer holding the publish_processing_at lock should call this.
 */
export async function ensureCarouselChildren(db: DbClient, postId: number): Promise<CarouselChild[]> {
  const { data: post } = await db
    .from("workflow_posts")
    .select("carousel_children")
    .eq("id", postId)
    .single();
  const media = await fetchPostMedia(db, postId);

  const existing = (post?.carousel_children ?? null) as CarouselChild[] | null;
  if (existing && existing.length > 0 && sameFileSequence(existing, media)) return existing;

  const children: CarouselChild[] = media.map((m) => ({
    file_id: m.id,
    kind: m.kind === "video" ? "video" : "image",
    container_id: null,
    ready: false,
  }));
  await db.from("workflow_posts").update({ carousel_children: children }).eq("id", postId);
  return children;
}

/** A non-story post with more than one media publishes as a carousel. */
export async function isCarouselPost(
  db: DbClient,
  postId: number,
  tipo?: string | null,
): Promise<boolean> {
  if (tipo === "stories") return false;
  const media = await fetchPostMedia(db, postId);
  return media.length > 1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm run test:functions -- --filter "ensureCarouselChildren"
npm run test:functions -- --filter "isCarouselPost"
npm run check:functions
git checkout -- deno.lock
```
Expected: 3 `ensureCarouselChildren` tests + 1 `isCarouselPost` test PASS; `check:functions` clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-carousel-children_test.ts
git commit -m "feat(instagram): ensureCarouselChildren + isCarouselPost

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `createMissingCarouselChildContainers` (persist each child id immediately)

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (append after `isCarouselPost`; also replace the inline cap message in `createContainerForPost` with the new helper)
- Test: `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts`

**Interfaces:**
- Consumes: `ensureCarouselChildren`, `fetchPostMedia`, `createCarouselChildContainer(igUserId, token, mediaUrl, isVideo): Promise<{id}>` (existing), `signGetUrl(key, ttl)` from `./r2.ts` (existing import), `CAROUSEL_MAX_ITEMS` (existing import).
- Produces:
  - `export async function createMissingCarouselChildContainers(db: DbClient, opts: { postId: number; igUserId: string; token: string }): Promise<CarouselChild[]>`
  - private `setCarouselChildField(db, postId, index, field: "container_id" | "ready", value: string | boolean | null): Promise<void>` (RPC `set_carousel_child_field`)
  - private `carouselLimitMessage(count: number): string` (the exact existing CAROUSEL_LIMIT wording).

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts`:

```ts
const { createMissingCarouselChildContainers } = await import("../_shared/instagram-publish-utils.ts");

// Graph stub. POST /media -> {id: c-N} (N counts POSTs); GET status polls answer
// from statusFor(containerId), default FINISHED. Records every call.
// deno-lint-ignore no-explicit-any
function stubGraph(statusFor: (id: string) => string = () => "FINISHED") {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const calls: Array<{ url: string; body: any }> = [];
  let n = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (!init) {
      const id = url.split("/").pop()?.split("?")[0] ?? "";
      return Promise.resolve(new Response(JSON.stringify({ status_code: statusFor(id) }), { status: 200 }));
    }
    n += 1;
    return Promise.resolve(new Response(JSON.stringify({ id: `c-${n}` }), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test("createMissingCarouselChildContainers creates only children lacking a container and persists each id", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "kept", ready: true },
      { file_id: 12, kind: "video", container_id: null, ready: false },
      { file_id: 13, kind: "image", container_id: null, ready: false },
    ],
    media: [link(0, 11, "image"), link(1, 12, "video"), link(2, 13, "image")],
  });
  const g = stubGraph();
  let children;
  try {
    children = await createMissingCarouselChildContainers(ctx.db, { postId: 1, igUserId: "ig", token: "t" });
  } finally { g.restore(); }

  assertEquals(g.calls.length, 2, "one POST per missing child, none for the kept one");
  assertEquals(g.calls[0].body.is_carousel_item, true);
  assertEquals(g.calls[0].body.media_type, "VIDEO");
  assert(g.calls[0].body.video_url, "video child uses video_url");
  assertEquals(g.calls[1].body.is_carousel_item, true);
  assert(g.calls[1].body.image_url, "image child uses image_url");
  assert(!("media_type" in g.calls[1].body), "image child sets no media_type");

  const sets = ctx.rpcCalls.filter((c) => c.fn === "set_carousel_child_field");
  assertEquals(sets.map((c) => [c.params.p_index, c.params.p_field, c.params.p_value]), [
    [1, "container_id", "c-1"],
    [2, "container_id", "c-2"],
  ]);
  assertEquals(children.map((c) => c.container_id), ["kept", "c-1", "c-2"]);
});

Deno.test("createMissingCarouselChildContainers: >10 media throws CAROUSEL_LIMIT before any Graph call", async () => {
  const media = Array.from({ length: 11 }, (_, i) => link(i, i + 1, "image"));
  const ctx = makeDb({ children: null, media });
  const g = stubGraph();
  let threw = "";
  try {
    await createMissingCarouselChildContainers(ctx.db, { postId: 1, igUserId: "ig", token: "t" });
  } catch (e) { threw = (e as Error).message; } finally { g.restore(); }
  assert(threw.includes("máximo 10"), `expected the cap message, got: ${threw}`);
  assertEquals(classifyPublishError(new Error(threw)), "CAROUSEL_LIMIT");
  assertEquals(g.calls.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm run test:functions -- --filter "createMissingCarouselChildContainers"
```
Expected: FAIL with "createMissingCarouselChildContainers is not a function".

- [ ] **Step 3: Implement**

In `supabase/functions/_shared/instagram-publish-utils.ts`, append after `isCarouselPost`:

```ts
function carouselLimitMessage(count: number): string {
  return (
    `Carrossel do Instagram aceita no máximo ${CAROUSEL_MAX_ITEMS} itens ` +
    `(este post tem ${count}). Reduza para ${CAROUSEL_MAX_ITEMS} ou menos. ` +
    `O app do Instagram permite 20, mas a publicação via API é limitada a ${CAROUSEL_MAX_ITEMS}.`
  );
}

async function setCarouselChildField(
  db: DbClient,
  postId: number,
  index: number,
  field: "container_id" | "ready",
  value: string | boolean | null,
): Promise<void> {
  // p_value is jsonb on the SQL side (ready is a boolean); JS null clears the field.
  // deno-lint-ignore no-explicit-any
  const { error } = await (db as any).rpc("set_carousel_child_field", {
    p_post_id: postId,
    p_index: index,
    p_field: field,
    p_value: value,
  });
  if (error) throw new Error(`Failed to persist carousel child ${field}: ${error.message ?? error}`);
}

/**
 * Create a carousel-item container for every child that lacks one; persist each
 * id the moment it exists (one RPC per success, never batched at the end) so a
 * later tick resumes from the last created child instead of redoing the burst.
 */
export async function createMissingCarouselChildContainers(
  db: DbClient,
  opts: { postId: number; igUserId: string; token: string },
): Promise<CarouselChild[]> {
  const { postId, igUserId, token } = opts;
  const children = await ensureCarouselChildren(db, postId);
  if (children.length > CAROUSEL_MAX_ITEMS) throw new Error(carouselLimitMessage(children.length));

  const media = await fetchPostMedia(db, postId);
  const byFileId = new Map(media.map((m) => [m.id, m]));

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.container_id) continue;
    const file = byFileId.get(child.file_id);
    if (!file) throw new Error(`Carousel child ${i}: media file ${child.file_id} not found`);
    const url = await signGetUrl(file.r2_key, 7200);
    const container = await createCarouselChildContainer(igUserId, token, url, child.kind === "video");
    child.container_id = container.id;
    await setCarouselChildField(db, postId, i, "container_id", container.id);
  }
  return children;
}
```

Then in `createContainerForPost`, replace the existing cap throw

```ts
  if (media.length > CAROUSEL_MAX_ITEMS) {
    throw new Error(
      `Carrossel do Instagram aceita no máximo ${CAROUSEL_MAX_ITEMS} itens ` +
        `(este post tem ${media.length}). Reduza para ${CAROUSEL_MAX_ITEMS} ou menos. ` +
        `O app do Instagram permite 20, mas a publicação via API é limitada a ${CAROUSEL_MAX_ITEMS}.`,
    );
  }
```
with
```ts
  if (media.length > CAROUSEL_MAX_ITEMS) throw new Error(carouselLimitMessage(media.length));
```
(`carouselLimitMessage` is a function declaration, so it is hoisted; its position after `createContainerForPost` in the file does not matter.)

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm run test:functions -- --filter "createMissingCarouselChildContainers"
npm run test:functions -- --filter "createContainerForPost"
npm run check:functions
git checkout -- deno.lock
```
Expected: both new tests PASS; every existing `createContainerForPost:` test still PASSES (the `>10 media` test asserts `message.includes("máximo 10")`, unchanged by the helper); `check:functions` clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-carousel-children_test.ts
git commit -m "feat(instagram): createMissingCarouselChildContainers persists each child id as it is created

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `pollCarouselChildrenReady` (round-based, bounded, ERROR clears + throws)

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (append after `createMissingCarouselChildContainers`)
- Test: `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts`

**Interfaces:**
- Consumes: `ensureCarouselChildren`, `setCarouselChildField`, `checkContainerStatus(containerId, token): Promise<"FINISHED" | "IN_PROGRESS" | "ERROR">` (existing, same file; a function declaration, hoisted).
- Produces: `export async function pollCarouselChildrenReady(db: DbClient, opts: { postId: number; igUserId: string; token: string; maxPolls?: number; intervalMs?: number }): Promise<{ children: CarouselChild[]; allReady: boolean }>` with defaults `maxPolls = 2`, `intervalMs = 3000` (same as `publishReadyStorySegments`).

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts`:

```ts
const { pollCarouselChildrenReady } = await import("../_shared/instagram-publish-utils.ts");

const twoMedia = [link(0, 11, "image"), link(1, 12, "video")];

Deno.test("pollCarouselChildrenReady marks FINISHED children ready, persists it, reports allReady", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: true },  // already ready: not polled
      { file_id: 12, kind: "video", container_id: "c-2", ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph(() => "FINISHED");
  let result;
  try {
    result = await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } finally { g.restore(); }
  assertEquals(result.allReady, true);
  assertEquals(g.calls.length, 1, "only the unready child is polled");
  assert(g.calls[0].url.includes("/c-2?"), "polls the unready child's container");
  const readySets = ctx.rpcCalls.filter((c) => c.fn === "set_carousel_child_field" && c.params.p_field === "ready");
  assertEquals(readySets.map((c) => [c.params.p_index, c.params.p_value]), [[1, true]]);
});

Deno.test("pollCarouselChildrenReady leaves an IN_PROGRESS child for the next tick without throwing", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: false },
      { file_id: 12, kind: "video", container_id: "c-2", ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph((id) => (id === "c-2" ? "IN_PROGRESS" : "FINISHED"));
  let result;
  try {
    result = await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 2, intervalMs: 1 });
  } finally { g.restore(); }
  assertEquals(result.allReady, false);
  // round 1 polls both (c-1 FINISHED, c-2 IN_PROGRESS); round 2 polls only c-2.
  assertEquals(g.calls.length, 3, "bounded: maxPolls rounds, only pending children per round");
  assertEquals(result.children[0].ready, true);
  assertEquals(result.children[1].ready, false);
  assertEquals(result.children[1].container_id, "c-2", "IN_PROGRESS must NOT clear the container");
  const readySets = ctx.rpcCalls.filter((c) => c.fn === "set_carousel_child_field" && c.params.p_field === "ready");
  assertEquals(readySets.length, 1, "only the FINISHED child is persisted as ready");
});

Deno.test("pollCarouselChildrenReady: ERROR clears that child's container_id, persists it, and throws MEDIA_UNSUPPORTED wording", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: false },
      { file_id: 12, kind: "video", container_id: "c-2", ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph((id) => (id === "c-2" ? "ERROR" : "FINISHED"));
  let threw = "";
  try {
    await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } catch (e) { threw = (e as Error).message; } finally { g.restore(); }
  assertEquals(threw, "Item 2 do carrossel falhou no processamento do Instagram");
  assertEquals(classifyPublishError(new Error(threw)), "MEDIA_UNSUPPORTED");
  const cleared = ctx.rpcCalls.find((c) =>
    c.fn === "set_carousel_child_field" && c.params.p_index === 1 &&
    c.params.p_field === "container_id" && c.params.p_value === null
  );
  assert(cleared, "must clear the failed child's container_id so the next tick recreates it");
  // The sibling that FINISHED in the same round keeps its progress.
  assertEquals(ctx.children[0], { file_id: 11, kind: "image", container_id: "c-1", ready: true });
  assertEquals(ctx.children[1], { file_id: 12, kind: "video", container_id: null, ready: false });
});

Deno.test("pollCarouselChildrenReady: a child without a container is not polled and blocks allReady", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: true },
      { file_id: 12, kind: "video", container_id: null, ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph();
  let result;
  try {
    result = await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 3, intervalMs: 1 });
  } finally { g.restore(); }
  assertEquals(result.allReady, false);
  assertEquals(g.calls.length, 0, "nothing to poll");
});

Deno.test("pollCarouselChildrenReady returns allReady=false for an empty children array", async () => {
  const ctx = makeDb({ children: [], media: [] });
  const g = stubGraph();
  let result;
  try {
    result = await pollCarouselChildrenReady(ctx.db, { postId: 1, igUserId: "ig", token: "t", maxPolls: 1, intervalMs: 1 });
  } finally { g.restore(); }
  assertEquals(result.allReady, false, "empty must never report ready (mirrors publishReadyStorySegments)");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm run test:functions -- --filter "pollCarouselChildrenReady"
```
Expected: FAIL with "pollCarouselChildrenReady is not a function".

- [ ] **Step 3: Implement**

Append to `supabase/functions/_shared/instagram-publish-utils.ts` after `createMissingCarouselChildContainers`:

```ts
/**
 * Poll every child that has a container but is not yet ready. Round-based: one
 * status check per pending child per round (in parallel), at most `maxPolls`
 * rounds, so the wall clock is bounded by maxPolls * intervalMs no matter how
 * many videos the carousel has. FINISHED -> ready:true (persisted). ERROR ->
 * that child's container_id is cleared (persisted) so the next container phase
 * recreates it, then throws; the wording classifies as MEDIA_UNSUPPORTED, same
 * as a story segment ERROR. IN_PROGRESS after the budget is not an error:
 * allReady=false tells the caller to leave the post for the next cron tick.
 */
export async function pollCarouselChildrenReady(
  db: DbClient,
  opts: { postId: number; igUserId: string; token: string; maxPolls?: number; intervalMs?: number },
): Promise<{ children: CarouselChild[]; allReady: boolean }> {
  const { postId, token, maxPolls = 2, intervalMs = 3000 } = opts;
  const children = await ensureCarouselChildren(db, postId);

  for (let round = 0; round < maxPolls; round++) {
    const pending = children
      .map((child, index) => ({ child, index }))
      .filter(({ child }) => child.container_id && !child.ready);
    if (pending.length === 0) break;

    const statuses = await Promise.all(
      pending.map(({ child }) => checkContainerStatus(child.container_id as string, token)),
    );

    // Persist every FINISHED child first so a sibling's ERROR never discards
    // progress made in the same round.
    let errored: number | null = null;
    for (let k = 0; k < pending.length; k++) {
      const { child, index } = pending[k];
      if (statuses[k] === "FINISHED") {
        child.ready = true;
        await setCarouselChildField(db, postId, index, "ready", true);
      } else if (statuses[k] === "ERROR" && errored === null) {
        errored = index;
      }
    }
    if (errored !== null) {
      children[errored].container_id = null;
      await setCarouselChildField(db, postId, errored, "container_id", null);
      throw new Error(`Item ${errored + 1} do carrossel falhou no processamento do Instagram`);
    }

    const stillPending = children.some((c) => c.container_id && !c.ready);
    if (!stillPending) break;
    if (round < maxPolls - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }

  const allReady = children.length > 0 && children.every((c) => !!c.container_id && c.ready);
  return { children, allReady };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm run test:functions -- --filter "pollCarouselChildrenReady"
npm run check:functions
git checkout -- deno.lock
```
Expected: 5 tests PASS; `check:functions` clean (note `igUserId` is intentionally not destructured; it stays in the opts type for signature symmetry with the story functions).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-carousel-children_test.ts
git commit -m "feat(instagram): pollCarouselChildrenReady, bounded round-based child readiness poll

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `advanceCarouselContainer` (compose create → poll → assemble parent)

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (append after `pollCarouselChildrenReady`)
- Test: `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts`

**Interfaces:**
- Consumes: `createMissingCarouselChildContainers`, `pollCarouselChildrenReady`, `createCarouselParentContainer(igUserId, token, childIds: string[], caption): Promise<{id}>` (existing), `TRIAL_MEDIA_SHAPE_ERROR` (existing import).
- Produces:
  - `export interface CarouselAdvanceResult { containerId: string | null; children: CarouselChild[]; allReady: boolean }`
  - `export async function advanceCarouselContainer(db: DbClient, opts: { postId: number; igUserId: string; token: string; caption: string; trialStrategy?: string | null; maxPolls?: number; intervalMs?: number }): Promise<CarouselAdvanceResult>`. `containerId` is non-null exactly when `allReady` is true. Used by Task 7 (cron) and Task 8 (publish-now).

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/instagram-publish-carousel-children_test.ts`:

```ts
const { advanceCarouselContainer } = await import("../_shared/instagram-publish-utils.ts");

Deno.test("advanceCarouselContainer: not all ready -> containerId null, no CAROUSEL parent call", async () => {
  const ctx = makeDb({ children: null, media: twoMedia });
  // c-1 (image) FINISHED immediately, c-2 (video) still transcoding.
  const g = stubGraph((id) => (id === "c-2" ? "IN_PROGRESS" : "FINISHED"));
  let result;
  try {
    result = await advanceCarouselContainer(ctx.db, {
      postId: 1, igUserId: "ig", token: "t", caption: "cap", maxPolls: 1, intervalMs: 1,
    });
  } finally { g.restore(); }
  assertEquals(result.allReady, false);
  assertEquals(result.containerId, null);
  assert(!g.calls.some((c) => c.body?.media_type === "CAROUSEL"), "parent must not be assembled");
  // Both children were created and persisted this tick: next tick resumes from here.
  assertEquals(ctx.children.map((c: { container_id: string | null }) => c.container_id), ["c-1", "c-2"]);
});

Deno.test("advanceCarouselContainer: all ready -> parent assembled from children in order, containerId returned", async () => {
  const ctx = makeDb({
    children: [
      { file_id: 11, kind: "image", container_id: "c-1", ready: true },
      { file_id: 12, kind: "video", container_id: "c-2", ready: false },
    ],
    media: twoMedia,
  });
  const g = stubGraph(() => "FINISHED");
  let result;
  try {
    result = await advanceCarouselContainer(ctx.db, {
      postId: 1, igUserId: "ig", token: "t", caption: "cap", maxPolls: 1, intervalMs: 1,
    });
  } finally { g.restore(); }
  assertEquals(result.allReady, true);
  const parent = g.calls.find((c) => c.body?.media_type === "CAROUSEL");
  assert(parent, "parent must be assembled once every child is ready");
  assertEquals(parent!.body.children, "c-1,c-2");
  assertEquals(parent!.body.caption, "cap");
  // POST count: 0 children (both existed) + 1 parent => the parent is c-1 in the
  // stub's POST numbering, and that id is what the caller persists.
  assertEquals(result.containerId, "c-1");
});

Deno.test("advanceCarouselContainer: trial reel on a carousel throws TRIAL_MEDIA_SHAPE_ERROR before any Graph call", async () => {
  const ctx = makeDb({ children: null, media: twoMedia });
  const g = stubGraph();
  let threw = "";
  try {
    await advanceCarouselContainer(ctx.db, {
      postId: 1, igUserId: "ig", token: "t", caption: "cap", trialStrategy: "auto", maxPolls: 1, intervalMs: 1,
    });
  } catch (e) { threw = (e as Error).message; } finally { g.restore(); }
  assertEquals(threw, TRIAL_MEDIA_SHAPE_ERROR);
  assertEquals(g.calls.length, 0);
  assertEquals(ctx.updates.length, 0, "must not even build the children array");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm run test:functions -- --filter "advanceCarouselContainer"
```
Expected: FAIL with "advanceCarouselContainer is not a function".

- [ ] **Step 3: Implement**

Append to `supabase/functions/_shared/instagram-publish-utils.ts` after `pollCarouselChildrenReady`:

```ts
export interface CarouselAdvanceResult {
  /** The CAROUSEL parent container id; non-null exactly when allReady is true. */
  containerId: string | null;
  children: CarouselChild[];
  allReady: boolean;
}

/**
 * One resumable step of carousel container creation: create any missing child
 * containers (persisting each), poll readiness within the budget, and assemble
 * the CAROUSEL parent only once every child is FINISHED. allReady=false is NOT
 * an error -- the caller clears the publish lock and lets the next cron tick
 * call this again; persisted state makes the next call pick up where this one
 * stopped. Throws on child ERROR, cap, trial-shape, or any Graph error (callers
 * mark the post failed, as with createContainerForPost).
 */
export async function advanceCarouselContainer(
  db: DbClient,
  opts: {
    postId: number;
    igUserId: string;
    token: string;
    caption: string;
    trialStrategy?: string | null;
    maxPolls?: number;
    intervalMs?: number;
  },
): Promise<CarouselAdvanceResult> {
  const { postId, igUserId, token, caption, maxPolls, intervalMs } = opts;

  // Reel de teste nunca degrada em silêncio: fora do formato exato (reels + 1
  // vídeo) falha alto com TRIAL_INELIGIBLE, igual a createContainerForPost.
  if (opts.trialStrategy === "manual" || opts.trialStrategy === "auto") {
    throw new Error(TRIAL_MEDIA_SHAPE_ERROR);
  }

  await createMissingCarouselChildContainers(db, { postId, igUserId, token });
  const { children, allReady } = await pollCarouselChildrenReady(db, {
    postId, igUserId, token, maxPolls, intervalMs,
  });
  if (!allReady) return { containerId: null, children, allReady: false };

  const parent = await createCarouselParentContainer(
    igUserId,
    token,
    children.map((c) => c.container_id as string),
    caption,
  );
  return { containerId: parent.id, children, allReady: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm run test:functions -- --filter "advanceCarouselContainer"
npm run test:functions -- --filter "Carousel"
npm run check:functions
git checkout -- deno.lock
```
Expected: 3 new tests PASS; the whole carousel-children file (14 tests) PASSES; `check:functions` clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-carousel-children_test.ts
git commit -m "feat(instagram): advanceCarouselContainer composes create/poll/assemble for one cron tick

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Cron wiring: carousel branch in Phase 1, CONTAINER_EXPIRED clears children

**Files:**
- Modify: `supabase/functions/instagram-publish-cron/index.ts` (imports lines 9-19; `markFailed` lines 84-94; `processContainerCreation` lines 133-169)

**Interfaces:**
- Consumes: `isCarouselPost`, `advanceCarouselContainer` (Tasks 3, 6), `clearLock(db, postId)` (existing, line 127).
- Produces: no new exports. Behavior: a carousel post whose children are not all ready leaves Phase 1 with `publish_processing_at = null`, `status` untouched, `instagram_container_id` still null, so the next tick re-claims it (D3, D4).

There is no unit test for `processContainerCreation` (it is not exported and none exists for the Stories branch either); the wiring is verified by `check:functions`, by the `advanceCarouselContainer` tests in Task 6, and end-to-end in Task 10.

- [ ] **Step 1: Add the imports**

In `supabase/functions/instagram-publish-cron/index.ts`, change the import block

```ts
import {
  decryptToken,
  createContainerForPost,
  pollContainerReady,
  publishContainer,
  fetchPermalink,
  processBatch,
  createMissingStorySegmentContainers,
  publishReadyStorySegments,
  selectStoryMediaId,
} from "../_shared/instagram-publish-utils.ts";
```
to
```ts
import {
  decryptToken,
  createContainerForPost,
  pollContainerReady,
  publishContainer,
  fetchPermalink,
  processBatch,
  createMissingStorySegmentContainers,
  publishReadyStorySegments,
  selectStoryMediaId,
  isCarouselPost,
  advanceCarouselContainer,
} from "../_shared/instagram-publish-utils.ts";
```

- [ ] **Step 2: Add the carousel branch to `processContainerCreation`**

Immediately after the Stories branch (the block ending with `console.log(\`[IG-PUBLISH] Story containers ensured for post ${post.post_id}\`); return; }`) and before the `// First attempt carries the cover;` comment, insert:

```ts
  // Carousels are resumable across ticks (carousel_children mirrors story_segments):
  // each child container id is persisted as it is created, readiness is persisted
  // per child, and the CAROUSEL parent is only assembled once every child is
  // FINISHED. "Not ready yet" is not a failure -- release the lock and let the
  // next tick continue from the persisted state. The claim RPC keeps re-claiming
  // this post in the container phase while instagram_container_id is null.
  if (await isCarouselPost(db, post.post_id, post.tipo)) {
    const { containerId, allReady } = await advanceCarouselContainer(db, {
      postId: post.post_id,
      igUserId: post.instagram_user_id,
      token,
      caption: post.ig_caption,
      trialStrategy: post.ig_trial_strategy,
    });
    if (!allReady) {
      await clearLock(db, post.post_id);
      console.log(`[IG-PUBLISH] Carousel post ${post.post_id}: children still processing, will continue next cycle`);
      return;
    }
    await db.from("workflow_posts").update({
      instagram_container_id: containerId,
      publish_processing_at: null,
    }).eq("id", post.post_id);
    console.log(`[IG-PUBLISH] Carousel container created for post ${post.post_id}: ${containerId}`);
    return;
  }
```

- [ ] **Step 3: Clear `carousel_children` on CONTAINER_EXPIRED in `markFailed`**

Replace
```ts
  // Um container expirado nunca volta a funcionar; sem limpar, o retry
  // automático (processRetry) reusaria o mesmo id e falharia 3x igual.
  if (errorCode === "CONTAINER_EXPIRED") fields.instagram_container_id = null;
```
with
```ts
  // Um container expirado nunca volta a funcionar; sem limpar, o retry
  // automático (processRetry) reusaria o mesmo id e falharia 3x igual. O mesmo
  // vale para os filhos de um carrossel (carousel_children): sem limpar, o
  // próximo tick montaria um novo pai a partir de filhos já expirados.
  if (errorCode === "CONTAINER_EXPIRED") {
    fields.instagram_container_id = null;
    fields.carousel_children = null;
  }
```

- [ ] **Step 4: Type-check and run the existing suite**

Run:
```bash
npm run check:functions
npm run test:functions
git checkout -- deno.lock
```
Expected: `check:functions` clean; all edge-function tests PASS (no test exercises `index.ts` directly).

- [ ] **Step 5: Re-read `processRetry` and `processPublish` and confirm no change is needed (D3)**

Read `supabase/functions/instagram-publish-cron/index.ts` `processRetry` (the non-story arm: `if (!post.instagram_container_id) { await processContainerCreation(db, post); await db.from("workflow_posts").update({ status: "agendado" })... } else if (!post.instagram_media_id) { await processPublish(db, post); }`). Confirm: a pending carousel returns from `processContainerCreation` without throwing, the retry arm then flips `status` to `agendado`, and the claim RPC's container phase re-claims it next tick. Confirm `processPublish`'s non-story path only needs `post.instagram_container_id`, which for a carousel is the parent id. Do not add branches.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/instagram-publish-cron/index.ts
git commit -m "feat(instagram-publish-cron): resumable carousel branch in Phase 1; expired containers drop carousel_children

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Handler wiring: publish-now carousel branch, front-load skip, cancel/retry/expired clearing

**Files:**
- Modify: `supabase/functions/instagram-publish/handler.ts` (imports lines 6-17; `schedule` front-load line 109; `cancel` lines 134-151; `retry` lines 153-171; `publish-now` lines 266-283 and the catch at 359-379)
- Create: `supabase/functions/__tests__/instagram-publish-carousel-handler_test.ts`

**Interfaces:**
- Consumes: `advanceCarouselContainer` (Task 6); `validation.media` from `validateForScheduling` (existing: `MediaFile[]`, one per `post_file_links` row).
- Produces: `publish-now` on a carousel returns `{ ok: true, status: "agendado", message: "Mídia ainda processando no Instagram. O post será publicado automaticamente em alguns minutos." }` when children are not all ready (same response the single-video IN_PROGRESS path already returns), otherwise proceeds to publish; `cancel` and `retry` issue `workflow_posts.update({ carousel_children: null })`.

- [ ] **Step 1: Write the failing handler tests**

Create `supabase/functions/__tests__/instagram-publish-carousel-handler_test.ts`:

```ts
// Handler-level coverage for the carousel branches of instagram-publish:
//   - publish-now on a carousel whose children are still transcoding leaves the
//     post agendado (lock cleared, scheduled_at = now) instead of failing it;
//   - publish-now on a carousel whose children all FINISH assembles the parent
//     and publishes through the ordinary tail;
//   - cancel clears carousel_children (outside record_post_status_change's
//     p_fields allowlist, so it is a separate update).
// createSupabaseQueryMock is scripted, not stateful: every ensureCarouselChildren
// re-read consumes one queued workflow_posts select + one post_file_links select,
// so those are queued generously below (extra entries are harmless).

import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-token-key");
Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const { createPublishHandler } = await import("../instagram-publish/handler.ts");

async function encryptedToken(value = "ig-token") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("test-token-key".padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value)),
  );
  const combined = new Uint8Array(iv.length + data.length);
  combined.set(iv);
  combined.set(data, iv.length);
  return btoa(String.fromCharCode(...combined));
}

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createPublishHandler({
    buildCorsHeaders: () => ({}),
    createDb: () => db as never,
    createServiceDb: () => db as never,
  });
}

function request(action: string, postId: number) {
  return new Request(`http://x/instagram-publish/${action}/${postId}`, {
    method: "POST",
    headers: { authorization: "Bearer t" },
  });
}

function rpcCalls(db: ReturnType<typeof createSupabaseQueryMock>, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

function updates(db: ReturnType<typeof createSupabaseQueryMock>, table: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === "update");
}

// Graph stub: POST /media -> {id: c-N}; POST media_publish -> {id: media-1};
// GET ?fields=permalink -> permalink; GET status -> statusFor(containerId).
// deno-lint-ignore no-explicit-any
function stubGraph(statusFor: (id: string) => string) {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const calls: Array<{ url: string; body: any }> = [];
  let n = 0;
  const ok = (obj: unknown) => Promise.resolve(new Response(JSON.stringify(obj), { status: 200 }));
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (!init) {
      if (url.includes("fields=permalink")) return ok({ permalink: "https://instagram.com/p/x" });
      const id = url.split("/").pop()?.split("?")[0] ?? "";
      return ok({ status_code: statusFor(id) });
    }
    if (url.includes("media_publish")) return ok({ id: "media-1" });
    n += 1;
    return ok({ id: `c-${n}` });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// publish-now polls children 12 x 3s; make timers fire immediately for the test
// and restore afterwards so other test files are unaffected.
function instantTimers() {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 as unknown as number; }) as typeof setTimeout;
  return () => { globalThis.setTimeout = original; };
}

const postRow = {
  id: 1,
  status: "aprovado_cliente",
  workflow_id: 9,
  cliente_id: 5,
  scheduled_at: "2030-01-01T12:00:00Z",
  ig_caption: "legenda",
  instagram_container_id: null,
  publish_retry_count: 0,
  tipo: "feed",
  ig_trial_strategy: null,
};

// Two 1:1 JPEGs: pass validateMedia's carousel rules (aspect 3/4..1.91, <= 8MB).
const carouselLinks = [
  {
    sort_order: 0,
    files: {
      id: 10, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
      width: 1080, height: 1080, duration_seconds: null, r2_key: "img/10.jpg", thumbnail_r2_key: null,
    },
  },
  {
    sort_order: 1,
    files: {
      id: 11, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
      width: 1080, height: 1080, duration_seconds: null, r2_key: "img/11.jpg", thumbnail_r2_key: null,
    },
  },
];

async function queuePublishNowPreamble(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: postRow, error: null }); // handler access check
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queue("workflow_posts", "select", { data: postRow, error: null }); // validateForScheduling
  db.queue("post_file_links", "select", { data: carouselLinks, error: null }); // validateForScheduling
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: await encryptedToken(),
      instagram_user_id: "ig-user",
      token_expires_at: "2030-01-01T12:00:00Z",
      authorization_status: "connected",
    },
    error: null,
  });
  db.queueRpc("record_post_status_change", { data: null, error: null }); // processing marker
  // Every fetchPostMedia / ensureCarouselChildren read of post_file_links.
  for (let i = 0; i < 8; i++) db.queue("post_file_links", "select", { data: carouselLinks, error: null });
}

Deno.test("instagram-publish publish-now (carousel): children still processing -> stays agendado, no parent, no failure", async () => {
  const db = createSupabaseQueryMock();
  await queuePublishNowPreamble(db);
  // createMissingCarouselChildContainers -> ensureCarouselChildren: nothing persisted yet.
  db.queue("workflow_posts", "select", { data: { carousel_children: null }, error: null });
  // pollCarouselChildrenReady -> ensureCarouselChildren: both children now exist (c-1, c-2).
  db.queue("workflow_posts", "select", {
    data: {
      carousel_children: [
        { file_id: 10, kind: "image", container_id: "c-1", ready: false },
        { file_id: 11, kind: "image", container_id: "c-2", ready: false },
      ],
    },
    error: null,
  });

  const restoreTimers = instantTimers();
  const g = stubGraph((id) => (id === "c-2" ? "IN_PROGRESS" : "FINISHED"));
  let res: Response;
  try {
    res = await makeHandler(db)(request("publish-now", 1));
  } finally {
    g.restore();
    restoreTimers();
  }

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    ok: true,
    status: "agendado",
    message: "Mídia ainda processando no Instagram. O post será publicado automaticamente em alguns minutos.",
  });
  assert(!g.calls.some((c) => c.body?.media_type === "CAROUSEL"), "parent must not be assembled");
  assert(!g.calls.some((c) => c.url.includes("media_publish")), "nothing published");
  assertEquals(
    rpcCalls(db, "record_post_status_change").filter(
      (c) => (c.payload as Record<string, unknown>).p_new_status === "falha_publicacao",
    ).length,
    0,
    "not-ready must never be recorded as a failure",
  );
  const release = updates(db, "workflow_posts").find(
    (u) => (u.payload as Record<string, unknown>).publish_processing_at === null &&
      "scheduled_at" in (u.payload as Record<string, unknown>),
  );
  assert(release, "lock released and scheduled_at pulled to now so the cron finishes it");
});

Deno.test("instagram-publish publish-now (carousel): all children FINISHED -> parent assembled and published", async () => {
  const db = createSupabaseQueryMock();
  await queuePublishNowPreamble(db);
  db.queue("workflow_posts", "select", { data: { carousel_children: null }, error: null }); // createMissing
  db.queue("workflow_posts", "select", {                                                      // poll
    data: {
      carousel_children: [
        { file_id: 10, kind: "image", container_id: "c-1", ready: false },
        { file_id: 11, kind: "image", container_id: "c-2", ready: false },
      ],
    },
    error: null,
  });
  db.queueRpc("mark_platform_published", { data: null, error: null });

  const restoreTimers = instantTimers();
  const g = stubGraph(() => "FINISHED");
  let res: Response;
  try {
    res = await makeHandler(db)(request("publish-now", 1));
  } finally {
    g.restore();
    restoreTimers();
  }

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "postado", instagram_permalink: "https://instagram.com/p/x" });
  const parent = g.calls.find((c) => c.body?.media_type === "CAROUSEL");
  assert(parent, "parent must be assembled");
  assertEquals(parent!.body.children, "c-1,c-2");
  assertEquals(parent!.body.caption, "legenda");
  // Parent is the 3rd POST -> c-3; it is what gets persisted and published.
  const persisted = updates(db, "workflow_posts").find(
    (u) => (u.payload as Record<string, unknown>).instagram_container_id === "c-3",
  );
  assert(persisted, "parent container id must be persisted before polling/publishing it");
  const publish = g.calls.find((c) => c.url.includes("media_publish"));
  assertEquals(publish?.body.creation_id, "c-3");
  const marked = rpcCalls(db, "mark_platform_published");
  assertEquals(marked.length, 1);
  assertEquals(
    ((marked[0].payload as Record<string, unknown>).p_fields as Record<string, unknown>).instagram_media_id,
    "media-1",
  );
});

Deno.test("instagram-publish cancel clears carousel_children with a separate update", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: { ...postRow, status: "agendado" }, error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const res = await makeHandler(db)(request("cancel", 1));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "aprovado_cliente" });
  const cleared = updates(db, "workflow_posts").find(
    (u) => (u.payload as Record<string, unknown>).carousel_children === null,
  );
  assert(cleared, "cancel must null carousel_children");
});

Deno.test("instagram-publish retry clears carousel_children with a separate update", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: { ...postRow, status: "falha_publicacao" }, error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const res = await makeHandler(db)(request("retry", 1));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "agendado" });
  const cleared = updates(db, "workflow_posts").find(
    (u) => (u.payload as Record<string, unknown>).carousel_children === null,
  );
  assert(cleared, "retry must null carousel_children so the rebuild starts clean");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm run test:functions -- --filter "instagram-publish publish-now (carousel)"
npm run test:functions -- --filter "clears carousel_children"
```
Expected: FAIL. The two `publish-now` tests fail because the handler still routes carousels through `createContainerForPost` (which, until Task 9, runs the stopgap and assembles a parent even for the IN_PROGRESS case, so "parent must not be assembled" fails; and the FINISHED case asserts the parent is `c-3` while the stopgap's POST numbering also yields `c-3`, so it may pass by coincidence: that is acceptable, the pending test is the one that must fail). The `cancel` / `retry` tests fail on "must null carousel_children".

- [ ] **Step 3: Import `advanceCarouselContainer`**

In `supabase/functions/instagram-publish/handler.ts` change
```ts
  createMissingStorySegmentContainers,
  publishReadyStorySegments,
  selectStoryMediaId,
} from "../_shared/instagram-publish-utils.ts";
```
to
```ts
  createMissingStorySegmentContainers,
  publishReadyStorySegments,
  selectStoryMediaId,
  advanceCarouselContainer,
} from "../_shared/instagram-publish-utils.ts";
```

- [ ] **Step 4: Skip the schedule front-load for carousels (D10)**

Replace the front-load comment and condition
```ts
      // Front-load the Instagram container when the post is due within ~1h so
      // transcoding starts immediately instead of waiting for the cron's Phase 1
      // (the cron's container window is also "scheduled_at <= now() + 1 hour").
      // Best-effort: on any failure leave instagram_container_id null and let the
      // cron create it later. Mirrors cron Phase 1 cover semantics (deferred
      // coverless retry via retry_count), NOT publish-now's immediate retry.
      try {
        const dueInMs = post.scheduled_at
          ? new Date(post.scheduled_at).getTime() - Date.now()
          : Infinity;
        if (dueInMs <= 3_600_000 && validation.account && post.tipo !== "stories") {
```
with
```ts
      // Front-load the Instagram container when the post is due within ~1h so
      // transcoding starts immediately instead of waiting for the cron's Phase 1
      // (the cron's container window is also "scheduled_at <= now() + 1 hour").
      // Best-effort: on any failure leave instagram_container_id null and let the
      // cron create it later. Mirrors cron Phase 1 cover semantics (deferred
      // coverless retry via retry_count), NOT publish-now's immediate retry.
      // Stories and carousels are skipped: both keep per-item state that the cron
      // advances under the publish_processing_at lock, which this path does not
      // hold, and the cron picks the post up within a minute anyway.
      try {
        const dueInMs = post.scheduled_at
          ? new Date(post.scheduled_at).getTime() - Date.now()
          : Infinity;
        const isCarousel = (validation.media?.length ?? 0) > 1;
        if (dueInMs <= 3_600_000 && validation.account && post.tipo !== "stories" && !isCarousel) {
```

- [ ] **Step 5: Clear `carousel_children` on `cancel` and `retry` (D9)**

In the `cancel` action, after the `await svcDb.rpc("record_post_status_change", { ... });` call and before `return json({ ok: true, status: "aprovado_cliente" });`, insert:
```ts
      // carousel_children is outside record_post_status_change's p_fields allowlist
      // (20260807000001): clear it separately so a re-scheduled carousel rebuilds
      // its children instead of assembling a parent from stale (possibly expired) ones.
      await svcDb.from("workflow_posts").update({ carousel_children: null }).eq("id", postId);
```
In the `retry` action, after its `await svcDb.rpc("record_post_status_change", { ... });` and before `return json({ ok: true, status: "agendado" });`, insert the same four lines (identical comment and statement).

- [ ] **Step 6: Add the `publish-now` carousel branch**

Replace
```ts
        // publish-now always attaches the cover when present (useCover:true) and does
        // an IMMEDIATE coverless retry below if Instagram rejects it during processing.
        const created = await createContainerForPost(svcDb, {
          igUserId,
          token,
          postId,
          caption: post.ig_caption ?? "",
          useCover: true,
          tipo: post.tipo,
          trialStrategy: post.ig_trial_strategy,
        });
        let containerId = created.containerId;
        const coverVideoUrl = created.coverVideoUrl; // set only when a cover was used

        await svcDb.from("workflow_posts").update({
          instagram_container_id: containerId,
        }).eq("id", postId);
```
with
```ts
        let containerId: string;
        let coverVideoUrl: string | undefined; // set only when a single-video cover was used

        if ((validation.media?.length ?? 0) > 1) {
          // Carousel: resumable per-child state (carousel_children). Create the
          // children, wait up to the same 12 x 3s budget the parent poll below uses,
          // and assemble the parent only when every child is FINISHED. Not ready is
          // not a failure: leave the post agendado for the cron to finish, exactly
          // like the IN_PROGRESS exit below and the stories !allDone exit above.
          const advanced = await advanceCarouselContainer(svcDb, {
            postId,
            igUserId,
            token,
            caption: post.ig_caption ?? "",
            trialStrategy: post.ig_trial_strategy,
            maxPolls: 12,
            intervalMs: 3000,
          });
          if (!advanced.allReady) {
            await svcDb.from("workflow_posts").update({
              scheduled_at: new Date().toISOString(),
              publish_processing_at: null,
            }).eq("id", postId);
            return json({
              ok: true,
              status: "agendado",
              message: "Mídia ainda processando no Instagram. O post será publicado automaticamente em alguns minutos.",
            });
          }
          containerId = advanced.containerId!;
        } else {
          // publish-now always attaches the cover when present (useCover:true) and does
          // an IMMEDIATE coverless retry below if Instagram rejects it during processing.
          const created = await createContainerForPost(svcDb, {
            igUserId,
            token,
            postId,
            caption: post.ig_caption ?? "",
            useCover: true,
            tipo: post.tipo,
            trialStrategy: post.ig_trial_strategy,
          });
          containerId = created.containerId;
          coverVideoUrl = created.coverVideoUrl;
        }

        await svcDb.from("workflow_posts").update({
          instagram_container_id: containerId,
        }).eq("id", postId);
```
Everything after this point (`let containerStatus = await pollContainerReady(containerId, token, 12, 3000);` through the permalink write) stays exactly as it is; it already uses `containerId` and `coverVideoUrl` by name.

- [ ] **Step 7: Clear `carousel_children` on CONTAINER_EXPIRED in the publish-now catch (D9)**

Immediately after the existing block that starts `if (errorCode === "CONTAINER_EXPIRED" && post.tipo === "stories") {` and ends with `} catch (_) { /* best-effort */ } }`, insert:
```ts
        if (errorCode === "CONTAINER_EXPIRED" && post.tipo !== "stories") {
          // Carousel children live in carousel_children, not in the top-level
          // instagram_container_id cleared above: drop them so the retry rebuilds
          // every child instead of assembling a parent from expired ones.
          try {
            await svcDb.from("workflow_posts").update({ carousel_children: null }).eq("id", postId);
          } catch (_) { /* best-effort */ }
        }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run:
```bash
npm run test:functions -- --filter "instagram-publish"
npm run check:functions
git checkout -- deno.lock
```
Expected: the 4 new handler tests PASS; every pre-existing `instagram-publish` test (gate, container-expired, mark-platform-published, validate, validation, cover, container, story-segments) still PASSES; `check:functions` clean. If the gate test's `cancel`/`retry` cases fail on the extra `update` call, the mock returned its default `{ data: null, error: null }` for it, which the handler ignores, so they should not; if they do, read the failure before changing anything.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/instagram-publish/handler.ts supabase/functions/__tests__/instagram-publish-carousel-handler_test.ts
git commit -m "feat(instagram-publish): publish-now uses resumable carousel children; cancel/retry/expired clear them

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Delete the stopgap; `createContainerForPost` throws for carousels

This is the last code task, by design: the stopgap is removed only after the resumable path is in place and tested (Tasks 3-8).

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (the comment block + 3 constants at lines 10-23 as of Task 1; the `if (isCarousel) { ... }` block inside `createContainerForPost`)
- Modify: `supabase/functions/__tests__/instagram-publish-container_test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createContainerForPost` throws `Error("Carousel posts must go through advanceCarouselContainer")` for `media.length > 1` (non-stories), after the existing trial-shape and cap guards, before any Graph call. `checkContainerStatus` stays exported (used by `pollCarouselChildrenReady`).

- [ ] **Step 1: Update the carousel test in `instagram-publish-container_test.ts`**

Replace the test `"createContainerForPost: multiple media → carousel children + parent"` (its whole `Deno.test(...)` block) with:
```ts
Deno.test("createContainerForPost: multiple media → throws before any Graph call (carousels use advanceCarouselContainer)", async () => {
  const f = stubFetch();
  try {
    const db = dbWithMedia([
      { kind: "image", r2_key: "a.jpg" },
      { kind: "video", r2_key: "b.mp4" },
    ]);
    let threw = "";
    try {
      await createContainerForPost(db, { ...base, useCover: true });
    } catch (e) {
      threw = (e as Error).message;
    }
    assertEquals(threw, "Carousel posts must go through advanceCarouselContainer");
    assertEquals(f.calls.length, 0, "no child or parent container may be created here");
  } finally {
    f.restore();
  }
});
```

Delete these two stopgap-only tests entirely (whole `Deno.test` blocks):
- `"createContainerForPost: video-heavy carousel paces children and waits out IN_PROGRESS"`
- `"createContainerForPost: video child ERROR before assembly → throws, no parent call"`

Delete the stopgap-only helpers at the top of the file:
- the `globalThis.setTimeout = ((fn: () => void) => { ... }) as typeof setTimeout;` override and its two-line comment (`// No test in this file exercises real timing ...`)
- the whole `stubFetchWithStatus` function and its three-line comment (`// Like stubFetch, but GET status-check calls ...`)

Keep unchanged: every other test, in particular `"createContainerForPost: >10 media → throws before any Graph call"` and `"createContainerForPost: trial em carrossel → lança TRIAL_MEDIA_SHAPE_ERROR"` (both hit guards that run BEFORE the carousel branch).

- [ ] **Step 2: Run the file to verify the new test fails**

Run:
```bash
npm run test:functions -- --filter "createContainerForPost: multiple media"
```
Expected: FAIL: `threw` is `""` (the stopgap still assembles a parent) and `f.calls.length` is 4.

- [ ] **Step 3: Delete the stopgap from `instagram-publish-utils.ts`**

Delete the block at the top of the file (between the `export type { MediaFile, ValidationError };` line and the `// --- Token Decryption` comment):
```ts
// Narrow mitigation for a real prod failure (post 5093, 2026-09-17): a carousel
// with several video children created back-to-back, then assembled into a
// CAROUSEL container immediately, reproducibly got Meta's generic "An unexpected
// error has occurred. Please retry your request later." (classified IG_TRANSIENT)
// on every attempt. Root cause wasn't isolated to a single bad file — all 8
// videos decoded cleanly — so this hedges both plausible triggers: bursting the
// Graph API with back-to-back video-container creations, and assembling the
// parent while a video child is still IN_PROGRESS. It is a bounded, best-effort
// mitigation, not the real fix — see the resumable per-child design tracked for
// the long-term carousel rework (children need persisted state across cron
// ticks, like story_segments already has for Stories).
const CAROUSEL_VIDEO_CHILD_DELAY_MS = 1200;
const CAROUSEL_CHILD_POLL_ROUNDS = 3;
const CAROUSEL_CHILD_POLL_INTERVAL_MS = 2000;
```

Then in `createContainerForPost`, replace the entire carousel block, from `if (isCarousel) {` through its closing `}` (the block containing `const childIds: string[] = [];`, the `CAROUSEL_VIDEO_CHILD_DELAY_MS` pacing, the `CAROUSEL_CHILD_POLL_ROUNDS` loop, and `const parent = await createCarouselParentContainer(...)`), with:
```ts
  if (isCarousel) {
    // Carousels are resumable across cron ticks (carousel_children, mirroring
    // story_segments) and go through advanceCarouselContainer; every caller
    // branches on isCarouselPost / validation.media.length before reaching here.
    // Throwing beats silently rebuilding every child in one synchronous burst,
    // which is exactly what post 5093 (2026-09-17) died on.
    throw new Error("Carousel posts must go through advanceCarouselContainer");
  }
```

Also update the `createContainerForPost` doc comment: change the line `* Throws on no media or any Graph API error (callers mark the post failed).` to `* Throws on no media, on a carousel (see advanceCarouselContainer), or any Graph API error (callers mark the post failed).`

- [ ] **Step 4: Verify nothing else referenced the deleted constants**

Run:
```bash
grep -rn "CAROUSEL_VIDEO_CHILD_DELAY_MS\|CAROUSEL_CHILD_POLL_ROUNDS\|CAROUSEL_CHILD_POLL_INTERVAL_MS\|stubFetchWithStatus" supabase/ apps/ 2>/dev/null
```
Expected: no output.

- [ ] **Step 5: Run the full function suite and type-check**

Run:
```bash
npm run check:functions
npm run test:functions
git checkout -- deno.lock
```
Expected: `check:functions` clean; all tests PASS, including the rewritten `multiple media → throws` test and all 14 tests in `instagram-publish-carousel-children_test.ts` and 4 in `instagram-publish-carousel-handler_test.ts`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/instagram-publish-utils.ts supabase/functions/__tests__/instagram-publish-container_test.ts
git commit -m "refactor(instagram): remove carousel pacing/poll stopgap; createContainerForPost rejects carousels

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Full verification, deploy (migration first, then functions), and prod check of post 5093

**Files:** none modified (deploy + verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: migration applied to prod, both functions deployed, post 5093 observed to leave `agendado` with either a published media id or a specific (non-generic) Meta error.

- [ ] **Step 1: Run every CI gate locally**

Run, from the worktree root:
```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
git checkout -- deno.lock
ls supabase/migrations | sed 's/_.*//' | sort | uniq -d
```
Expected: all green; the last command prints nothing. If `format:check` fails, run `npm run format` and commit the result (`git commit -am "style: prettier"` is fine; prettier does not cover `supabase/` so it should not).

- [ ] **Step 2: Re-verify the migration prefix against origin/main one last time**

```bash
git fetch origin main
git ls-tree --name-only origin/main supabase/migrations/ | grep '^supabase/migrations/20260923000009' || echo "prefix free on main"
```
Expected: `prefix free on main`. If a file is printed, rename the migration to the next free prefix, update this plan's file references, commit, and re-run Step 1's last command.

- [ ] **Step 3: Confirm which Supabase project the worktree is linked to**

```bash
cat supabase/.temp/project-ref 2>/dev/null || echo "not linked"
```
Prod is `skjzpekeqefvlojenfsw`; staging is `wlyzhyfondykzpsiqsce`. The migration must go to prod for the 5093 check. If the printed ref is not prod, link it first: `npx supabase link --project-ref skjzpekeqefvlojenfsw` (it prompts for a DB password; do not pass it as a CLI argument; if you do not have it, stop and ask the user to run the push).

- [ ] **Step 4: Push the migration to prod BEFORE deploying functions**

The functions read `carousel_children` and call `set_carousel_child_field`; deploying them first would break every carousel tick until the column exists. `db push` applies EVERY unapplied migration on the branch, so first confirm this one is the only pending row:
```bash
npx supabase migration list --linked
```
Expected: `20260923000009` is the only version present locally and absent remotely. If any other version is pending, stop and ask before pushing.
```bash
npx supabase db push --linked
```
Expected: `20260923000009_instagram_carousel_children.sql` applied. Verify:
```bash
npx supabase db query --linked "select column_name from information_schema.columns where table_name = 'workflow_posts' and column_name = 'carousel_children';"
npx supabase db query --linked "select proname, pg_get_function_arguments(oid) from pg_proc where proname = 'set_carousel_child_field';"
```
Expected: one row each; the second shows `p_post_id bigint, p_index integer, p_field text, p_value jsonb`.

- [ ] **Step 5: Smoke the RPC's jsonb handling in ONE transaction that leaves no trace**

Post 5093 is a live `agendado` row the cron can claim at any minute, so the fake array must never be visible outside a single `db query` call. Everything below runs in one invocation; the final `select` is last because the CLI returns the last statement's rows, and the reset runs BEFORE it:
```bash
npx supabase db query --linked "create temp table smoke as select carousel_children from workflow_posts where id = 5093; update workflow_posts set carousel_children = '[{\"file_id\":1,\"kind\":\"image\",\"container_id\":null,\"ready\":false}]'::jsonb where id = 5093; select set_carousel_child_field(5093, 0, 'ready', 'true'::jsonb); select set_carousel_child_field(5093, 0, 'container_id', '\"abc\"'::jsonb); create temp table result as select carousel_children as after_rpc from workflow_posts where id = 5093; update workflow_posts set carousel_children = (select carousel_children from smoke) where id = 5093; select r.after_rpc, wp.carousel_children as restored, wp.status, wp.publish_retry_count, wp.instagram_container_id from result r, workflow_posts wp where wp.id = 5093;"
```
Expected one row: `after_rpc` = `[{"file_id": 1, "kind": "image", "container_id": "abc", "ready": true}]` (boolean `true`, not the string `"true"`; `"abc"` a JSON string), `restored` = exactly the pre-smoke value (post 5093 matches the Task 2 backfill, so expect the backfilled array with real `file_id`s, `container_id: null`, `ready: false` for every element; NOT the fake `file_id: 1` row), `status` = `agendado`, `publish_retry_count` = `0`, `instagram_container_id` = `null`. If `after_rpc` shows `"ready": "true"` the RPC's `p_value` type is wrong (Task 2 D6); fix the migration with a follow-up migration, do not deploy the functions.

- [ ] **Step 6: Deploy the two functions from the worktree**

```bash
npx supabase functions deploy instagram-publish-cron --project-ref skjzpekeqefvlojenfsw --use-api --no-verify-jwt
npx supabase functions deploy instagram-publish --project-ref skjzpekeqefvlojenfsw --use-api
```
Expected: both report a successful deploy. `--no-verify-jwt` only on the cron (it authenticates with `x-cron-secret`); `instagram-publish` verifies the user JWT via the gateway.

- [ ] **Step 7: Reschedule post 5093 and watch it**

In the CRM (workspace "Hanna Marques"), reschedule post 5093 to about 15 minutes in the future (the container phase only claims `scheduled_at <= now() + 1 hour`, and `validateForScheduling` requires at least 10 minutes ahead), or ask the user to do it. Then poll every minute or two:
```bash
npx supabase db query --linked "select id, status, publish_error_code, publish_error, instagram_container_id, instagram_media_id from workflow_posts where id = 5093;"
npx supabase db query --linked "select jsonb_pretty(carousel_children) from workflow_posts where id = 5093;"
```
Expected progression:
1. Within 1-2 ticks: `carousel_children` populated with 10 entries, every `container_id` non-null (children created and persisted even though `instagram_container_id` is still null; this alone is what the stopgap could never do).
2. Over the following ticks: `ready` flips to `true` child by child; `status` stays `agendado`, `publish_error_code` stays null.
3. Once all 10 are ready: `instagram_container_id` set (the parent). Then, at/after `scheduled_at`: `instagram_media_id` set, `status = postado`.

Acceptable alternative outcome: `status = falha_publicacao` with a SPECIFIC error (`publish_error_code` in `MEDIA_UNSUPPORTED` with `Item N do carrossel falhou no processamento do Instagram`, or any Meta message that names the cause). NOT acceptable: the generic `IG_TRANSIENT` "retry your request later" with `carousel_children` still all-null, which would mean the failure is upstream of child creation; in that case stop and report, do not iterate blindly. Also stop and report if `publish_error` starts with `Failed to persist carousel child`: that is `set_carousel_child_field` rejecting the call (the Step 5 smoke exercised the SQL directly, not PostgREST's marshalling of the `p_value jsonb` argument, which this is the first live check of; the fix would be in `setCarouselChildField`, not in the cron).

- [ ] **Step 8: Report**

Record in the PR description: the observed progression from Step 7 (copy the final `select` output), the migration prefix used, and the deploy commands run. Then open the PR against `main` (migration and functions are already live, per this repo's "migrations and functions BEFORE merge" rule).

---

## Self-review

**Spec coverage**
- Migration with column, backfill, `set_carousel_child_field`, unique prefix with re-check instructions: Task 2 (plus the D8 `reorder_post_schedules` copy-forward the brief did not list; justified in the decisions table).
- `ensureCarouselChildren`, `createMissingCarouselChildContainers`, `pollCarouselChildrenReady`, parent assembly with the `{ containerId }`-compatible return: Tasks 3-6 (`advanceCarouselContainer` is the composing function; its `containerId` is what callers persist exactly as they persisted `createContainerForPost`'s).
- Classifier decision: wording `"... falhou no processamento do Instagram"` kept, no classifier change, locked by the Task 5 test asserting `MEDIA_UNSUPPORTED`.
- Wiring, approach 2: cron Phase 1 branch (Task 7); explicit written decision that Phase 2/3 and the claim RPC need no change (D3, D4, Task 7 Step 5); handler front-load decision (D10, Task 8 Step 4); publish-now branch the brief did not mention but the code required (Task 8 Step 6).
- Tests: new utils test file with idempotency, media-change rebuild, partial resume, ERROR clears + throws, bounded poll leaves IN_PROGRESS without throwing, parent assembly only when all ready, cap, trial (Tasks 3-6); handler tests (Task 8); `instagram-publish-container_test.ts` changes spelled out per test: two stopgap tests deleted, carousel test rewritten to "throws", `>10` and trial tests kept (Task 9).
- Stopgap deletion as the last code task, naming the guarding comment and the three constants (Task 9).
- Manual prod verification of post 5093 with the exact query, prod project ref, `--use-api`, and `--no-verify-jwt` only on the cron (Task 10).
- `deno.lock` reset after every `test:functions` run: present in every task that runs it.

**Placeholder scan**: no TBD/TODO; every code step has the code; the `reorder_post_schedules` body is included in full rather than "copy from"; the only "copy verbatim" instruction (Task 2 Step 3) is a diff check against text that is also fully present in Step 2.

**Type consistency**: `CarouselChild` fields `file_id / kind / container_id / ready` are used identically in the migration backfill, Tasks 3-6, both test files, and the Task 10 smoke. `advanceCarouselContainer` opts (`postId, igUserId, token, caption, trialStrategy?, maxPolls?, intervalMs?`) match its callers in Task 7 (cron, defaults) and Task 8 (publish-now, `12 / 3000`). `setCarouselChildField`'s `field` union `"container_id" | "ready"` matches every RPC assertion (`p_field`, `p_value`) in the tests. `isCarouselPost(db, postId, tipo)` matches the cron call. The new `createContainerForPost` throw message is identical in Task 9's implementation and test.
