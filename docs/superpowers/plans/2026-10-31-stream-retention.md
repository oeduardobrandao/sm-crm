# Stream Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a video in Cloudflare Stream only while a post it belongs to is in front of the client; release everything else to plain R2 playback.

**Architecture:** One SQL eligibility predicate (`stream_file_is_eligible`) drives two service-role RPCs: `stream_ingest_candidates` (replaces the cron's ingest select) and `stream_release_claim` (atomic claim that parks the row and returns the uid to delete). `post-media-cleanup-cron` gets a new `release` step in `stream-steps.ts`. A BEFORE INSERT trigger parks every new video by default, so only eligible videos ever enter Stream.

**Tech Stack:** Postgres (Supabase migrations, psql test suites), Deno edge functions, `deno test` with the shared `supabaseMock`.

**Spec:** `docs/superpowers/specs/2026-10-31-stream-retention-design.md`

## Global Constraints

- New `files.stream_status` value: `parked` (CHECK becomes `pending | ready | error | skipped | parked`).
- Env dials (plain edge secrets, no redeploy to change): `STREAM_RELEASE_GRACE_DAYS` default `7`, `STREAM_RELEASE_IDLE_DAYS` default `60`, `STREAM_RELEASE_BATCH` default `50`. Parse like the existing `STREAM_INGEST_BATCH` (`Math.max(1, parseInt(...) || default)`).
- A post is live iff: status `agendado` or `falha_publicacao`; or status `postado` and `published_at > now() - grace`; or any other status and last status change (`max(post_status_events.created_at)`, else `workflow_posts.created_at`) `> now() - idle`. `postado` with NULL `published_at` is NOT live.
- A link counts only when `files.conta_id = post_file_links.conta_id = workflow_posts.conta_id`.
- New RPCs: `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role` (name the roles explicitly; `FROM PUBLIC` alone leaves them).
- Never touch `kb_videos` or `stream_status = 'skipped'` rows.
- Migration version: `20261113000001`. Before `gh pr create`, renumber above main's tail if main moved.
- Portuguese comments in SQL to match neighbouring migrations; English comments in `stream-steps.ts` to match that file.

## Review Focus

1. A file linked to one stale post and one live post must stay in Stream (any-live wins). Test in Task 1.
2. A cross-workspace link to a live post must not keep (or ingest) another workspace's file. Test in Task 1.
3. `agendado` post untouched for 200 days keeps its video (no ping-pong for far-scheduled posts). Test in Task 1.
4. Stream delete failure after the claim: row stays parked with no uid, the loop continues, and the failure is not counted as released (the reap cleans the uid). Test in Task 2.
5. Kill-switch mode (no `copyToStream`): release still runs, ingest does not. Test in Task 2.

---

### Task 1: Migration — `parked`, default trigger, eligibility, RPCs

**Files:**
- Create: `supabase/migrations/20261113000001_stream_retention.sql`
- Test: `supabase/tests/stream_retention.sql` (picked up by `scripts/test-entitlements.sh`; follow `supabase/tests/post_file_link_replace.sql` for shape: `\i supabase/tests/entitlements/_helpers.sql`, `begin`, `do $$ ... $$`, `rollback`)

**Interfaces:**
- Produces:
  - `stream_post_is_live(p_status text, p_published_at timestamptz, p_last_moved_at timestamptz, p_grace_days int, p_idle_days int) returns boolean` (STABLE, uses `now()`)
  - `stream_file_is_eligible(p_file_id bigint, p_grace_days int, p_idle_days int) returns boolean` (STABLE)
  - `stream_ingest_candidates(p_limit int, p_grace_days int, p_idle_days int) returns table(id bigint, r2_key text, conta_id uuid, created_at timestamptz)`: `kind='video'`, `stream_uid IS NULL`, `stream_status IS NULL OR IN ('pending','parked')`, `created_at < now() - interval '10 minutes'`, eligible, `ORDER BY created_at, id LIMIT p_limit`. Eligibility is in the WHERE, before the LIMIT.
  - `stream_release_claim(p_limit int, p_grace_days int, p_idle_days int) returns table(id bigint, stream_uid text)`: CTE selects `id, stream_uid` from `files` where `kind='video' AND stream_uid IS NOT NULL AND NOT stream_file_is_eligible(...)` `ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED`; `UPDATE files SET stream_status='parked', stream_uid=NULL FROM c WHERE files.id=c.id RETURNING files.id, c.stream_uid`.
  - Trigger `trg_files_video_default_parked` BEFORE INSERT ON files: `kind='video' AND NEW.stream_status IS NULL` → `NEW.stream_status := 'parked'`.

- [ ] **Step 1: Write the failing SQL suite `supabase/tests/stream_retention.sql`**

  One workspace `ws`, one `other_ws`, a client + workflow, helper `pg_temp.mk_video(ws) returns bigint` inserting a `files` row (`kind='video'`) with a `stream_uid`. Assertions (each `assert ..., '<label>'`):
  - insert of a video with NULL `stream_status` reads back `parked`; insert with `'skipped'` stays `skipped`; an image stays NULL.
  - `stream_post_is_live('agendado', null, now() - '200 days', 7, 60)` is true; `('falha_publicacao', ...)` true; `('postado', now() - '3 days', ...)` true; `('postado', now() - '8 days', ...)` false; `('postado', null, now(), 7, 60)` false; `('enviado_cliente', null, now() - '59 days', 7, 60)` true; `('rascunho', null, now() - '61 days', 7, 60)` false.
  - file linked to a `postado` post published 30 days ago AND to a `enviado_cliente` post moved yesterday: eligible; not returned by `stream_release_claim`.
  - file linked only to the 30-day `postado` post: `stream_release_claim(50, 7, 60)` returns its `(id, stream_uid)`; afterwards row has `stream_status='parked'`, `stream_uid IS NULL`; a second call returns nothing for it.
  - file in `ws` whose only link row carries `conta_id = other_ws` pointing at a live post of `other_ws`: not eligible (released by claim).
  - library-only video (no links): released by claim; not returned by `stream_ingest_candidates`.
  - parked video created 20 minutes ago (set `created_at` explicitly) linked to a live post: returned by `stream_ingest_candidates(20, 7, 60)`; the same row with `created_at = now() - '5 minutes'` is not.
  - `has_function_privilege('authenticated', 'stream_release_claim(int,int,int)', 'execute')` and the same for `anon` and for `stream_ingest_candidates` are false.
  - To produce `postado` with NULL `published_at`, `ALTER TABLE workflow_posts DISABLE TRIGGER <published_at trigger name from 20260601000001>` inside the transaction; assert that file is released.

- [ ] **Step 2: Run it to verify it fails**

  Run: `npm run test:db` (needs Docker/colima)
  Expected: FAIL in `stream_retention.sql` (function does not exist).

- [ ] **Step 3: Write `20261113000001_stream_retention.sql`**

  Order: drop/re-add `files_stream_status_check` with `parked` (constraint name and pattern as in `20261011000001_post_references.sql:31-33`); the trigger function + trigger; backfill `UPDATE files SET stream_status='parked' WHERE kind='video' AND stream_uid IS NULL AND stream_status IS NULL`; the four functions; REVOKE/GRANT. Header comment states the deploy order (this migration before the functions) and the rollback note: an old cron ingests only NULL/`pending`, so it never re-copies `parked`.

- [ ] **Step 4: Run it to verify it passes**

  Run: `npm run test:db`
  Expected: all suites PASS, including `stream_retention.sql`.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20261113000001_stream_retention.sql supabase/tests/stream_retention.sql
  git commit -m "feat(stream): elegibilidade, claim de release e default parked para vídeo"
  ```

### Task 2: `stream-steps.ts` — ingest via RPC, release step

**Files:**
- Modify: `supabase/functions/post-media-cleanup-cron/stream-steps.ts`
- Test: `supabase/functions/__tests__/stream-steps_test.ts`

**Interfaces:**
- Consumes: `stream_ingest_candidates`, `stream_release_claim` (Task 1), called as `deps.db.rpc(name, { p_limit, p_grace_days, p_idle_days })`.
- Produces:
  - `StreamStepsDeps` gains `releaseBatchSize?: number` (default `RELEASE_BATCH = 50`), `releaseGraceDays?: number` (default 7), `releaseIdleDays?: number` (default 60).
  - `StreamSweepResult` gains `released: number`.
  - Step order in `runStreamSweeps`: ingest, settle, release, reap; release wrapped like the others, logging `"stream-steps:release"`.

- [ ] **Step 1: Write failing tests**

  - `"stream-steps: release deletes every claimed uid and counts them"`: `db.queueRpc("stream_release_claim", { data: [{ id: 1, stream_uid: "u1" }, { id: 2, stream_uid: "u2" }], error: null })`; `deleteStreamVideo` records calls. Assert `result.released === 2`, deleted `["u1","u2"]`, the rpc call payload equals `{ p_limit: 50, p_grace_days: 7, p_idle_days: 60 }`.
  - `"stream-steps: release honors custom batch/grace/idle"`: deps `releaseBatchSize: 5, releaseGraceDays: 3, releaseIdleDays: 30`; payload `{ p_limit: 5, p_grace_days: 3, p_idle_days: 30 }`.
  - `"stream-steps: a failed Stream delete after the claim is not counted and the loop continues"` (Review Focus 4): delete throws for `u1`, succeeds for `u2`; `released === 1`, both attempted, `errors === 0`.
  - `"stream-steps: a failing release claim counts one error and the reap still runs"`: `queueRpc("stream_release_claim", { data: null, error: { message: "boom" } })`; `errors === 1`, `listStreamVideos` called.
  - `"stream-steps: release runs in kill-switch mode (no copyToStream)"` (Review Focus 5): no `copyToStream`; claim returns one uid; `released === 1`; no `stream_ingest_candidates` rpc call recorded.
  - Rewrite the existing ingest tests (lines ~43, 288, 308, 335, 369, 391, 438, 545) to queue `db.queueRpc("stream_ingest_candidates", { data: [...] })` instead of `db.queue("files", "select", ...)` for the candidate read; the `files` update queues stay. Add to the 545 test: payload `p_limit` equals the custom `ingestBatchSize`.
  - Existing tests that don't care about release: the mock's default rpc response is `{ data: true }`; make the release step treat a non-array `data` as zero rows so those tests keep passing unchanged except for the new `released: 0` in any whole-result `assertEquals`.

- [ ] **Step 2: Run to verify they fail**

  Run: `deno test --no-check supabase/functions/__tests__/stream-steps_test.ts`
  Expected: FAIL (no `released`, ingest still uses `from("files").select`).

- [ ] **Step 3: Implement**

  `ingestCatchUp`: replace the `.from("files").select(...)` chain with the rpc; keep the JS `created_at < cutoffIso` re-check and everything after it. New `releaseSweep(deps): Promise<number>`: one rpc call, throw on `error`, then delete each uid sequentially, `console.error("stream-steps:release-uid", uid, e)` on failure. Update the file's top comment to list the four steps and note that a failed delete is left to the orphan reap (the uid is no longer in `files`).

- [ ] **Step 4: Run to verify they pass**

  Run: `deno test --no-check supabase/functions/__tests__/stream-steps_test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/functions/post-media-cleanup-cron/stream-steps.ts supabase/functions/__tests__/stream-steps_test.ts
  git commit -m "feat(stream): passo de release no post-media-cleanup-cron e ingest só de vídeo elegível"
  ```

### Task 3: Cron wiring, env dials, docs

**Files:**
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts` (constants near line 52; `runStreamSweeps` call ~191; result fields ~186-232 and the response/log ~362)
- Modify: `CLAUDE.md` (Environment variables, next to `STREAM_INGEST_BATCH` / `STREAM_SETTLE_BATCH`)

**Interfaces:**
- Consumes: `releaseBatchSize`, `releaseGraceDays`, `releaseIdleDays`, `StreamSweepResult.released` (Task 2).
- Produces: response JSON field `streamReleased`.

- [ ] **Step 1: Add the three constants and pass them; add `streamReleased`** next to `streamReaped` in the result and the JSON body.
- [ ] **Step 2: Document** `STREAM_RELEASE_GRACE_DAYS` / `STREAM_RELEASE_IDLE_DAYS` / `STREAM_RELEASE_BATCH` in CLAUDE.md: what "live" means (one line each for the three cases), that `parked` = out of Stream by policy and re-ingested automatically when the post becomes live, that playback falls back to R2, and that 50/run on the hourly prod job caps the backlog at ~1,200 deletes/day.
- [ ] **Step 3: Verify**

  Run: `npm run check:functions && npm run test:functions`
  Expected: both pass.

- [ ] **Step 4: Commit**

  ```bash
  git add supabase/functions/post-media-cleanup-cron/index.ts CLAUDE.md
  git commit -m "feat(stream): dials de release no cron e documentação"
  ```

### Task 4: `file-upload-finalize` — copy to Stream only for post uploads

**Files:**
- Modify: `supabase/functions/file-upload-finalize/handler.ts:193`
- Test: `supabase/functions/__tests__/file-upload-finalize_test.ts`

**Interfaces:**
- Consumes: the Task 1 trigger (library video inserts arrive `parked`).

Decision recorded here: any upload that carries `post_id` copies immediately, without calling the eligibility RPC. Uploads into a post are almost always into a live post; if not, the next hourly release returns it. This keeps upload latency and the handler unchanged in shape.

- [ ] **Step 1: Write failing test** `"file-upload-finalize: video finalize without post_id does not call streamCopy and writes no stream fields"`: `streamCopy` set to a recorder; body without `post_id`; assert recorder not called and no `files` update with `stream_status`/`stream_uid` in `db.calls`. Update the existing `"video finalize with streamCopy set kicks off Stream ingest"` test (line ~489) and its siblings at ~518, 542, 574 to send `post_id` (and queue the post/link responses they then need, as in the `"finalize with post_id creates link"` test at ~264).
- [ ] **Step 2: Run to verify it fails**

  Run: `deno test --no-check supabase/functions/__tests__/file-upload-finalize_test.ts`
  Expected: the new test FAILS (streamCopy called).

- [ ] **Step 3: Change the guard** to `body.kind === "video" && body.post_id && deps.streamCopy`, and update the comment above it to say library uploads stay `parked` (trigger) and enter Stream through the cron once linked to a live post.
- [ ] **Step 4: Run to verify it passes**

  Run: `deno test --no-check supabase/functions/__tests__/file-upload-finalize_test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/functions/file-upload-finalize/handler.ts supabase/functions/__tests__/file-upload-finalize_test.ts
  git commit -m "feat(stream): upload de biblioteca não vai para o Stream"
  ```

### Task 5: Full gate and staging check

- [ ] **Step 1: Run the CI gate** — `npm run lint`, `npm run format:check`, the five `tsc` commands from CLAUDE.md, `npm run test`, `npm run check:functions`, `npm run test:functions`, `npm run test:db`. Expected: all green.
- [ ] **Step 2: Staging** — `npx supabase db push --linked` (staging), deploy `post-media-cleanup-cron` and `file-upload-finalize` (both `--no-verify-jwt` as today), invoke the cron once with `x-cron-secret`, and confirm in the response `streamReleased > 0` (or 0 with no candidates) and `streamErrors = 0`. Then open a Hub post in `enviado_cliente` with a video and confirm it still plays via HLS, and a released video plays the MP4.
- [ ] **Step 3: Deploy order for prod (record in the PR body):** migration → `post-media-cleanup-cron` + `file-upload-finalize` → merge. First prod runs release the backlog at 50/hour; watch `stream-steps:release` / 429 logs.
