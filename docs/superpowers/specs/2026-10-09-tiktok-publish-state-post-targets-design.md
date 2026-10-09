# TikTok publish state on `post_targets` (P4 design)

Spec 2 of the TikTok work, and phase P4 of `2026-09-29-platform-agnostic-posts-design.md`. It runs while TikTok reviews the app and changes nothing a reviewer sees.

## Context

P1 (#606) created `post_targets`, which records which destinations a post has. It did not ship the rest of P1's planned SQL:
- the `post_targets_resolved` view;
- `mark_target_published` and `mark_target_failed`;
- `recompute_post_publish_status`.

TikTok publish state still lives in `workflow_posts.tiktok_*`:
- `tiktok_publish_status`: `initiated`, `processing`, `published` or `failed`;
- `tiktok_publish_id`, `tiktok_post_id`, `tiktok_post_url`;
- `tiktok_publish_error`, `tiktok_publish_retry_count`, `tiktok_publish_processing_at`.

Every TikTok transition is a direct UPDATE of those columns followed by a separate `record_post_status_change` call, with no transaction between them. `record_post_status_change` has no `tiktok_*` fields in its allowlist (`20260807000001:36-56`), and the failure path papers over half-finished pairs (`_shared/tiktok-publish-utils.ts:528-570`).

Bugs this causes on posts going to both Instagram and TikTok:
1. **"Publicar agora" 422s on the TikTok side.**
   - `ScheduleButton.tsx:293` calls Instagram publish-now first, which moves the post from `aprovado_cliente` to `agendado` (`instagram-publish:204-210`).
   - The TikTok call (`:298`) then fails its `status !== 'aprovado_cliente'` check (`tiktok-publish/handler.ts:363-364`).
2. **Retry after both sides failed strands TikTok.**
   - The Instagram retry moves the post to `agendado` (`instagram-publish:168-180`).
   - The TikTok retry then requires `falha_publicacao` (`handler.ts:340`) and 422s.
   - The post is left at `agendado` with `tiktok_publish_status='failed'`, which no claim phase matches.
3. **A stale `failed` blocks TikTok forever.** The init claim requires `tiktok_publish_status IS NULL`, and nothing clears a `failed` when the post goes back to draft and is scheduled again.

Other gaps:
- `reorder_post_schedules` (`20260923000009:144-151`) does not check for a TikTok publish in flight.
- The TikTok claim has no ORDER BY.
- The claim also sets the lock on rows that its account join then drops.
- Nothing stops a signed-in user from writing `post_targets.status`, `external_id` or `permalink`, or from deleting a published destination row. The table has a plain `GRANT SELECT, INSERT, UPDATE, DELETE` to `authenticated` (`20261010100002:105-107`).

## Decisions (user, 2026-10-09)

- **The TikTok caption stays in `workflow_posts.tiktok_caption`.**
  - P4 moves publish state only.
  - TikTok caption version history (`20260923000001:159-166`) keeps working.
  - The caption moves together with the later phase that extends content versions to every destination.
- **"Horário próprio" is out of scope.** The per-destination schedule override ships as its own PR. `post_targets.scheduled_at` stays unread.

## Goal

1. `post_targets` (platform `tiktok`) is the only record of TikTok publish state.
2. Every transition that changes the post's status happens in one transaction with the destination write.
3. The `tiktok_*` publish columns are frozen: backfilled once and then never written again.
4. Bugs 1–3 are fixed.
5. No visible change in the CRM or the Hub.

## Non-goals

- Instagram publish state. That is P5. Instagram keeps writing its legacy columns and calling `mark_platform_published('instagram')`.
- Full decoupling: a TikTok failure no longer blocks a *pending* Instagram publish. That also needs Instagram's claim to read its destination row, so it is P5.
- Removing the BEFORE UPDATE OF `platform` trigger (a2). `PlatformSelector` still writes `platform` while `feature_multiplatform` is off.
- Dropping the `tiktok_*` columns.
- Geral, `disponivel` and the zip export. Those are P3, which has not shipped.

## Approaches considered

- **A. Store adapter (chosen).**
  - The publishers, claims and server readers move to `post_targets`.
  - In the CRM, the post loaders embed the TikTok destination row, and one mapper projects it onto the existing `tiktok_publish_status` / `tiktok_publish_error` / `tiktok_post_url` / … fields.
  - Components, `postLabels`, polling and about 30 frontend test files keep their current vocabulary.
  - Cost: legacy field names live on in the frontend until the columns are retired.
- **B. Move every reader to destination vocabulary.**
  - It touches seven CRM components, `postLabels` and their tests for no visible change.
  - Better done once, when the columns are retired.
- **C. One-way mirror trigger, destination → legacy columns.**
  - It would leave the frontend and the server readers untouched.
  - Rejected: it keeps two copies of the same state, against the platform spec's "one writer, no sync triggers" rule. Every future reader could read either copy.

## Design

### 1. TikTok states on a destination row

| `post_targets.status` | Meaning | Legacy equivalent (backfill and adapter) |
|---|---|---|
| `pendente` | No attempt in flight. Default, and the state after a cancel or reset. | `NULL` |
| `agendado` | Re-queued by a retry. Claimable while the post is in `agendado` or `falha_publicacao`. | `NULL` |
| `processando` | `publish_ref` is set and TikTok is processing. | `initiated`, `processing` |
| `publicado` | `external_id` (TikTok post id) is set when public, and `published_at` is set. | `published` |
| `falha` | `error`, `error_code` and `retry_count` are set. A non-retryable error sets `retry_count = 3`. | `failed` |

`initiated` and `processing` collapse into `processando`. Both are already "Publicando" in the UI (`postLabels.ts:99-116`), and the cron's status phase treats them the same.

**New column:** `post_targets.publish_ref text`. It is the provider's handle for an in-flight publish, which for TikTok is the temporary `publish_id` that the webhook looks rows up by.
- `external_id` stays the public post id. TikTok has two ids, so a single column cannot hold both.
- Partial unique index on `(platform, publish_ref) WHERE publish_ref IS NOT NULL`. Today nothing indexes the webhook's lookup (`tiktok-webhook/handler.ts:124`).
- Lock column: `processing_at`, the same 10-minute stale rule as today.
- Permalink: `permalink`, which replaces `tiktok_post_url`.

### 2. Migration

One migration with a version above main's latest. The version must be checked at PR time. It contains:

**a. Columns:** add `publish_ref` and the index.

**b. Backfill.** For each `tiktok` destination, copy from its post:
- `status` mapped as in the table above;
- `publish_ref ← tiktok_publish_id`, `external_id ← tiktok_post_id`, `permalink ← tiktok_post_url`;
- `error ← tiktok_publish_error`, `retry_count ← tiktok_publish_retry_count`, `processing_at ← tiktok_publish_processing_at`;
- `published_at ← workflow_posts.published_at` when the post is published.

The migration ends with a parity assertion: a `DO` block raises an exception if any `tiktok` destination's mapped status differs from its post's legacy status.

**c. `recompute_post_publish_status(p_post_id bigint, p_source text)`.** Internal; it expects the caller to hold the post row lock. Rules:
- Return without doing anything unless the post's status is in `agendado` or `falha_publicacao`. `postado` is never downgraded. Earlier statuses belong to the user.
- Find the auto-publishing destinations and their effective state:
  - **TikTok:** the row's `status`.
  - **Instagram (legacy until P5):**
    - `publicado` when `instagram_media_id IS NOT NULL`;
    - `falha` when `post.status = 'falha_publicacao' AND instagram_media_id IS NULL AND publish_error IS NOT NULL`;
    - otherwise in progress.
    - Requiring the post status for `falha` keeps an Instagram retry that is still in flight (post back at `agendado`, `publish_error` not yet cleared) from counting as failed.
  - Geral is ignored.
- With no auto-publishing destination, return.
- Target post status:
  - `postado` when every destination is `publicado` (sets `published_at = COALESCE(published_at, now())`);
  - `falha_publicacao` when any destination is `falha`;
  - otherwise `agendado`.
- Call `record_post_status_change` only when the status actually changes, so status events and automations keep firing.

**d. Writers.** All are `SECURITY DEFINER` with `search_path = public, pg_temp`. Each does `REVOKE ALL … FROM public, anon, authenticated` and then `GRANT EXECUTE … TO service_role`, the pair from `20260925000001:53-54`. Each locks the `workflow_posts` row `FOR UPDATE` before touching the destination, the same order as `mark_platform_published`.
- **`mark_target_published(p_post_id, p_platform, p_fields jsonb, p_source)`**
  - Sets `status='publicado'`, `external_id` / `permalink` (COALESCE from `p_fields`), `published_at`, `processing_at=NULL`, `error=NULL`, `error_code=NULL`.
  - Then recomputes.
- **`mark_target_failed(p_post_id, p_platform, p_error, p_error_code, p_retryable, p_source)`**
  - Sets `status='falha'`, the error fields, `retry_count = CASE WHEN p_retryable THEN retry_count + 1 ELSE 3 END` and `processing_at=NULL`.
  - Then recomputes.
- **`requeue_target(p_post_id, p_platform, p_source)`**
  - Only acts on a `falha` row whose post is in `agendado` or `falha_publicacao`.
  - Sets `status='agendado'`, `error=NULL`, `error_code=NULL`, `publish_ref=NULL`, `processing_at=NULL`, and keeps `retry_count`.
  - Then recomputes, which moves the post to `agendado` unless another destination is still failed.
  - Returns whether it acted.
  - The manual retry and the cron retry phase both use it.
- **`mark_platform_published`**, latest body `20260807000001:67-120`, copied forward in full:
  - The Instagram branch keeps its legacy writes, then calls the recompute instead of computing `tt_done` inline.
  - The TikTok branch delegates to `mark_target_published`, so a function version that is still deployed during the deploy window lands on the destination.
  - Grants stay the same.

**e. Reset on leaving publication.** An AFTER UPDATE OF `status` trigger on `workflow_posts`:
- When the new status is not `agendado`, `falha_publicacao` or `postado`, it sets that post's `tiktok` destination from `falha` or `agendado` back to `pendente`, and clears `error`, `error_code`, `publish_ref` and `retry_count`.
- It never touches `processando` or `publicado`.
- This fixes bug 3.
- It shares the `app.post_targets_sync` recursion GUC.

**f. Claim.** New function `claim_tiktok_targets_for_publishing(p_limit int)`, service_role only. It replaces `claim_posts_for_tiktok_publishing` (latest `20260830000002:139-214`).
- Joins `post_targets t` with `t.platform = 'tiktok'`. Posts without a TikTok destination never match, so `wp.platform` is not checked.
- Phases:
  - **init:** `scheduled_at <= now()` AND either `t.status = 'agendado' AND wp.status IN ('agendado','falha_publicacao')` or `t.status = 'pendente' AND wp.status = 'agendado'`.
  - **status:** `t.status = 'processando' AND t.publish_ref IS NOT NULL AND wp.status IN ('agendado','falha_publicacao')`.
  - **retry:** `t.status = 'falha' AND t.retry_count < 3 AND wp.status IN ('agendado','falha_publicacao')`. The cron calls `requeue_target` on these.
- All phases require `t.processing_at IS NULL OR < now() - interval '10 minutes'`.
- The active-account join (`tiktok_accounts.client_id = cliente_id AND authorization_status = 'active'`) moves into the candidate CTE, before `FOR UPDATE SKIP LOCKED`, so the lock lands only on rows that are returned.
- `ORDER BY wp.scheduled_at`, as in the Instagram claim (`20260925000013`).
- Sets `t.processing_at = now()` and returns the same fields as today: `caption = COALESCE(tiktok_caption, ig_caption, '')`, title, settings, username. `publish_ref` and `retry_count` come from the destination, plus `target_id` and `phase`.

**The old `claim_posts_for_tiktok_publishing`** keeps its signature, but its body becomes a no-op that returns zero rows. A cron still on the old code between the migration and the function deploy then claims nothing, instead of publishing from frozen columns. A follow-up drops it.

**g. Copied-forward guards.**
- **`reorder_post_schedules`** (latest `20260923000009:77-218`): the publishing guard also refuses when the post has a destination with `processing_at IS NOT NULL` or `status = 'processando'`. Full body copied.
- **`post_file_link_replace`** (latest `20260916000001:98-104`): the TikTok condition reads the destination (`processing_at IS NOT NULL OR status IN ('processando','publicado')`) instead of the `tiktok_*` columns. Full body copied.

**h. `post_targets` privileges.**
- Revoke `INSERT` and `UPDATE` from `authenticated`.
- Grant `INSERT (conta_id, post_id, platform, format, caption, title, settings)` and `UPDATE (caption, title, settings, format)`.
- The CRM writes only `conta_id`, `post_id`, `platform` and `caption` (`store/postTargets.ts:89-91,148-155`).
- The P1 triggers that write `platform` and `post_id` are `SECURITY DEFINER`, so they are unaffected. Every function in `20261010100002` is DEFINER.
- **BEFORE DELETE trigger:** refuses to delete a destination in `processando` or `publicado` while its post still exists. A cascade from deleting the post finds no parent row and goes through.

### 3. Edge functions

**`_shared/tiktok-publish-utils.ts`**
- `markTikTokPublishFailed` → `mark_target_failed`. The non-transactional fallback goes away.
- `confirmAndApplyPublishStatus`:
  - success → `mark_target_published`;
  - still processing → `post_targets.update({ processing_at: null })` by `target_id`.
- `clearLock` → the destination row.
- `validateForTikTokScheduling` is unchanged. It reads captions, settings and `platform`, which is still correct because it is derived from destinations.

**`tiktok-publish/handler.ts`**
- Loads the TikTok destination alongside the post.
- **schedule:** unchanged. A stale `falha` was already reset by the 2e trigger when the post left publication.
- **cancel:** sets the destination back to `pendente` (clearing `publish_ref`, `error` and `processing_at`) and moves the post to `aprovado_cliente`, as today. Refuses while the destination is `processando`.
- **retry:**
  - Requires the destination in `falha` and the post in `agendado` or `falha_publicacao`.
  - Calls `requeue_target`.
  - The cron's init phase publishes it.
  - This fixes bug 2.
- **publish-now:**
  - Accepts a post in `aprovado_cliente` (moved to `agendado` first, as today) or already in `agendado`, with the destination in `pendente` or `agendado`. This fixes bug 1: Instagram's publish-now running first is fine.
  - Takes the conditional lock on the destination's `processing_at`.
  - Init → destination `processando` + `publish_ref`.
  - Done → `mark_target_published`; failure → `mark_target_failed`.

**`tiktok-publish-cron/core.ts`**
- Uses the new claim.
- init success → destination `processando` + `publish_ref`, `processing_at = NULL`.
- retry phase → `requeue_target`.

**`tiktok-webhook/handler.ts`**
- Looks up `post_targets` by `(platform, publish_ref)`.
- `claimPublishLock` uses the destination's `processing_at`.
- `publicly_available` / `no_longer_publicly_available` → `external_id` / `permalink` on the destination.

**Other readers**
- **`data-import/handler.ts:250-253`** (`guardPublishedPosts`): a post also counts as published when it has a `publicado` destination, in place of `tiktok_post_id IS NOT NULL`.
- **`hub-posts/handler.ts:167`:** `tiktok_post_url` comes from the TikTok destination's `permalink`. The response field name stays, so the Hub doesn't change.

### 4. CRM adapter

- `store/posts.ts` gains `applyTikTokTargetState(row)`. It reads the embedded `post_targets` TikTok row and overwrites the following fields with the legacy equivalents from the table in 1:
  - `tiktok_publish_status`
  - `tiktok_publish_error`
  - `tiktok_post_url`
  - `tiktok_post_id`
  - `tiktok_publish_retry_count`
  - `tiktok_publish_processing_at`
- When there is no TikTok row, it nulls those fields.
- Every query that feeds those fields adds `post_targets(platform,status,error,permalink,external_id,retry_count,processing_at)` to its select, either into an existing embed or as a new one, and maps its rows. That covers:
  - the `select('*')` loaders (`store/posts.ts:557,567,710` and the rest the plan lists);
  - `POST_CONTEXT_COLUMNS` (`:300`);
  - `getActivePosts` (`:398-411`).
- `postDestinations.ts`'s TikTok fallback (`:68-72`) stays correct, because the adapter feeds it. Once the TikTok row leaves `pendente` the row already wins (`:58`).
- **Unchanged:** `ScheduleButton`, `postLabels`, `PostStatusChip`, `PublicacoesPanel`, `PostEditorBody` and polling.

### 5. Deploy order

1. Run the pre-deploy query on prod. It counts TikTok rows by legacy status, and counts posts with `tiktok_publish_status IN ('initiated','processing')` (any in flight are finished or cleared first).
2. Apply the migration to staging, then prod.
3. Deploy the functions to prod right away: `tiktok-publish` (verify_jwt=true); `tiktok-publish-cron`, `tiktok-webhook`, `data-import`, `hub-posts` (`--no-verify-jwt`, their current settings).
   - Staging has no TikTok functions deployed (TikTok testing happens on prod with DK TESTE). Deploy `data-import` and `hub-posts` to staging too, for parity.
4. Merge the PR, which deploys the frontend.
5. Run the end-to-end check on prod with DK TESTE:
   - a TikTok-only video post goes through publish-now, then schedule, then a forced failure and retry;
   - one Instagram+TikTok post goes through publish-now.

During the window between steps 2 and 3:
- The old cron claims nothing, because of the no-op claim.
- The old webhook still calls `mark_platform_published('tiktok')`, which now lands on the destination.
- An old publish-now writes the frozen columns. TikTok is dark outside DK TESTE, so nobody else can trigger it.

## Testing

**SQL** (`supabase/tests/`, run by `test:db`, gated by CI)
- `tiktok_publishing_rpcs.sql` is rewritten for the new claim:
  - each phase, including `agendado` re-queued with the post in `falha_publicacao`;
  - posts without a TikTok destination, stories posts and inactive accounts are skipped;
  - no lock is left on rows that are not returned;
  - ORDER BY;
  - the old claim returns no rows.
- New `post_targets_publish_state.sql`:
  - the recompute matrix: TikTok × Instagram × post status, including never downgrading `postado`, ignoring Geral, a post with no auto-publishing destination, and an Instagram retry in flight not counting as `falha`;
  - `mark_target_*` and `requeue_target` transitions;
  - ACLs: service_role can execute; anon and authenticated cannot;
  - the reset trigger, including that it leaves `processando`/`publicado` alone;
  - column privileges: authenticated cannot set `status`, `external_id` or `publish_ref`, and can set `caption`;
  - the delete guard, including that a cascade from deleting the post still works;
  - backfill parity.
- `post_file_link_replace.sql` and the reorder test gain the TikTok destination guard.

**Deno**
- The tiktok-publish, cron, webhook and utils tests are rewritten for the RPC calls and destination writes.
- New `both` cases:
  - publish-now after Instagram already moved the post to `agendado`;
  - retry when both sides failed.
- data-import and hub-posts get their reader changes.

**Vitest**
- `applyTikTokTargetState` mapping table.
- One loader test per query shape the plan touches.
- The existing ScheduleButton, postLabels and postDestinations tests should pass unchanged. A change there means the adapter leaked.

**Gates:** lint, format:check, the four `tsc` projects, `npm run test`, `check:functions`, `test:functions`. Both `__tests__` trees are grepped for contract changes.

## Risks

- **Copying RPCs forward.** The claim, reorder, `post_file_link_replace` and `mark_platform_published` each copy the full latest body. The plan cites each source line range.
- **Recursion.** The reset trigger and the recompute share the GUC, and the recompute writes only through `record_post_status_change`.
- **Column grants on a table that triggers write.** Every trigger and function that writes `post_targets` must be DEFINER. A test inserts a post as `authenticated` and checks that the seed trigger still creates its destinations.
- **Adapter coverage.** A loader that misses the embed silently shows stale frozen values. The plan lists every query by line, and a test asserts the mapper runs on each one.
