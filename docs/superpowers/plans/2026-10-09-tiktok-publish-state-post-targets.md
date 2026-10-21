# TikTok Publish State on post_targets (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `post_targets` (platform `tiktok`) the only record of TikTok publish state. Every TikTok transition that changes the post's status runs in one transaction with the destination write. The `workflow_posts.tiktok_*` publish columns are frozen. Bugs 1-3 from the spec are fixed, with no visible change in the CRM or the Hub.

**Architecture:** Three migrations, applied in order:
1. Backfill the TikTok destination from the legacy columns, then lock `post_targets` down with column grants and a delete guard.
2. Add SECURITY DEFINER writers (`mark_target_*`, `requeue_target`, `begin_target_publish`, `cancel_target_publish`), all funnelling into `recompute_post_publish_status`. A reset trigger clears stale failures when a post leaves publication.
3. Add a destination-based claim and turn the old claim into a no-op. Copy forward the publishing guards in `reorder_post_schedules` and `post_file_link_replace`.

The edge functions (`tiktok-publish`, `tiktok-publish-cron`, `tiktok-webhook`, `data-import`, `hub-posts`) switch to those RPCs and to `post_targets` reads. In the CRM, a store adapter (`applyTikTokTargetState`) projects the embedded TikTok destination onto the legacy `tiktok_*` field names, so no component changes.

**Tech Stack:** Postgres/Supabase SQL migrations (plpgsql), psql test suites (`scripts/test-entitlements.sh`), Deno edge functions with the shared `supabaseMock`, React 19 CRM store (TypeScript) with Vitest.

## Global Constraints

- Spec (source of truth): `docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md`.
- Migration versions: `20261014000001`, `20261014000002`, `20261014000003` (main's tail is `20261013000002`; renumbered from 20261013000001..3 after the affiliate migrations landed). Re-check `ls supabase/migrations | tail -3` against `origin/main` right before `gh pr create`; renumber above main's tail if anything landed. Duplicate prefixes fail `migration-version-guard`.
- Every new or copied-forward function: `SECURITY DEFINER SET search_path = public, pg_temp`.
- Callable RPCs: `REVOKE ALL ON FUNCTION … FROM public, anon, authenticated;` then `GRANT EXECUTE ON FUNCTION … TO service_role;` (the pair from `20260925000001:53-54`).
- Trigger functions: `REVOKE ALL ON FUNCTION … FROM public, anon, authenticated;` with no grant (P1 convention, `20261010100002`).
- Every SQL writer of `post_targets` sets `updated_at = now()`. Edge-function single-statement writes set `updated_at` from the injected clock.
- Every writer locks the `workflow_posts` row `FOR UPDATE` before touching the destination.
- TikTok status mapping: `pendente`/`agendado` → legacy `NULL`; `processando` → `'processing'`; `publicado` → `'published'`; `falha` → `'failed'`.
- Stale-lock window: `processing_at < now() - interval '10 minutes'`.
- Retry ceiling: `retry_count < 3`. A non-retryable failure sets `retry_count = 3`.
- RPC refusal codes:
  - `ERRCODE 'P0422'` with MESSAGE in {`post_not_publishable`, `post_not_scheduled`, `target_publishing`, `target_published`, `target_not_ready`, `target_not_found`};
  - `ERRCODE 'P0404'` with MESSAGE in {`post_not_found`, `target_not_found`};
  - `ERRCODE 'P0409'` with MESSAGE `target_not_removable` (delete guard);
  - `ERRCODE '22023'` for an unsupported platform or an invalid phase.
- pt-BR user copy with no em dashes. Use a period or a colon instead.
- Edge functions never return raw error details. Use `internalServerError(json, scope, err)` for unknown errors and curated pt-BR strings for refusals.
- CORS stays on the existing `deps.buildCorsHeaders(req)`. Never `*`.
- Deno: imports use relative `.ts` paths. `npm run check:functions` is the only type gate for `supabase/functions/`.
- The Deno test helper `assertEquals` compares `JSON.stringify` output, so key order matters. Expected objects in tests must list keys in the same order as the implementation.
- Never run the whole `npm run test:functions` suite before the final task. During tasks, run only the single Deno test file given, with the same flags `test:functions` uses. Deno can rewrite `node_modules` and `deno.lock` (memory: `project_deno_npm_node_modules_gotcha`). So after a Deno run, run `git checkout deno.lock`, and run `ls node_modules/.deno 2>/dev/null && npm ci` before any npm, vitest, lint or prettier command. Never commit `deno.lock` changes.
- SQL tests need a local Supabase (`npx supabase start`, colima, per-worktree port overrides). Apply migrations with `npx supabase db reset`. Run one file with:
  `psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f <file>`
  from the repo root. If Docker is unavailable, CI's `entitlement-tests` job is the gate. Say so in the task report instead of claiming a pass.
- Deploy steps (Task 9) are owner-approval-gated. Implementers never run them.
- Commit trailer: end commit messages with the attribution line from the session's system reminder (currently: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), after a blank line. The commit steps below spell out the current line.

## Deviations from spec

1. **Three migrations instead of one.**
   - `20261014000001` holds §2a, §2b and §2h.
   - `20261014000002` holds §2c, §2d and §2e.
   - `20261014000003` holds §2f and §2g.

   They apply in order in one `db push`. Each file is smaller and can be reviewed on its own.
2. **Claim return shape follows the explicit "Signature and return contract" list, not §2f's "same fields as today … plus `phase`".**
   - Returned: `post_id, conta_id, cliente_id, tipo, scheduled_at, caption, tiktok_title, tiktok_settings, tiktok_username, tiktok_account_id, target_id, publish_ref, retry_count`.
   - Dropped: `workflow_id`, the `encrypted_*` columns, `access_token_expires_at` and `tiktok_open_id`. `core.ts` never reads them, because it calls `getFreshTikTokToken` by account id.
   - `phase` is not returned. The caller already knows it.
3. **`p_actor uuid DEFAULT NULL` is added as a trailing parameter** to `recompute_post_publish_status`, `mark_target_published`, `mark_target_failed` and `requeue_target`. Without it, `mark_platform_published('instagram')` (which receives `p_actor`) and publish-now would lose the actor on the status event they fire today.
4. **`mark_target_failed` idempotency.** The spec says it is idempotent "on the same `publish_ref`", but its signature has no ref. A row already in `falha` is left alone, and the call returns `false`. This is equivalent: `mark_target_failed` keeps `publish_ref`, only `requeue_target` clears it, and init then sets a new one. So a `falha` row always carries the ref of the publish that failed. A row already in `publicado` is also left alone (returns `false`), so a late failure report can never downgrade a published destination.
5. **The writers accept `p_platform = 'tiktok'` only in P4.** `mark_target_published`, `mark_target_failed`, `requeue_target`, `begin_target_publish` and `cancel_target_publish` raise `22023 unsupported_platform` for anything else. Instagram state stays legacy until P5, so writing an Instagram row's status would be invisible to the recompute and misleading. P5 widens this.
6. **The lock-held publish-now response is new.** The spec maps "lock held" to "today's 'já está publicando' response", but no such response exists in `tiktok-publish/handler.ts`. The plan adds `409 { error: "Já está publicando no TikTok." }`.
7. **`cancel_target_publish` refuses more than the spec lists:**
   - a destination with a fresh lock (`processing_at` within 10 minutes), because the cron or publish-now owns it mid-init;
   - a `publicado` destination, because cancelling would erase a real publication. Legacy cancel blindly nulled `tiktok_publish_status`.

   Both refusals raise `P0422` (`target_publishing` / `target_published`).
8. **`data-import` keeps its live `verify_jwt` setting instead of the spec's `--no-verify-jwt`.** The spec lists `data-import` with the `--no-verify-jwt` functions as "their current settings", but `supabase/config.toml` has no `[functions.data-import]` entry (so the gateway default, JWT verification on, applies), and the data-import plan (`docs/superpowers/plans/2026-07-27-data-import-wizard.md:24`) deploys it plainly. The function also verifies the user JWT itself (`data-import/handler.ts:600-606`), so either setting is safe. Task 9 Step 6.4 has the owner confirm the live value first and keep it: deploy plainly when JWT verification is on, add `--no-verify-jwt` only when it is already off.
9. **Backfill copies `publish_ref` and `error` only when the mapped state carries them.**
   - `publish_ref` is copied for `processando`, `publicado` and `falha`.
   - `error` is copied for `falha` only.
   - The legacy retry (`tiktok-publish/handler.ts:344-347`) cleared the status but kept `tiktok_publish_id`. Copying that stale ref onto a `pendente` row would let a late webhook act on a superseded publish.
10. **The mapping is a permanent helper, `public.tiktok_legacy_target_status(p_legacy text, p_post_status text)`** (IMMUTABLE, service_role only). The backfill, the parity block, the reconcile script and the SQL tests share one mapping instead of four copies. The backfill UPDATE itself is also a function, `public.tiktok_backfill_targets(p_conta uuid DEFAULT NULL)` (DEFINER, service_role only): the migration calls it with `NULL`, and the test calls it with its own workspace id, so the test exercises the shipped UPDATE rather than a copy. Both are dropped with the columns in the follow-up.
11. **Parity on stories may abort the migration on prod.** P1's backfill (`20261010100002:110-115`) created a `tiktok` row for every `tiktok`/`both` post with no `tipo` filter, and `20261010100006:117-119` documents that such legacy rows exist. The migration keeps the spec's assertion. Task 9's pre-deploy query counts these rows and ships an owner-gated remediation `DELETE` (pendente rows only), to run before the migration if the count is non-zero.
12. **The reconcile query is time-bounded.**
    - It only touches posts whose `workflow_posts.updated_at >= window_start` (the moment noted before the migration ran). The script has no psql variable: the owner edits the placeholder in a copy, `SELECT set_config('p4.window_start', 'DEFINA-O-INSTANTE-DO-PASSO-2', false)`, and the unedited value fails the timestamp cast on purpose.
    - A remap to `falha` also requires the post to be in `falha_publicacao` (the legacy failure path always moved it there), so a post that the new code reset and the user rescheduled is not sent back to `falha`. A destination with a fresh `processing_at` (under 10 minutes) is skipped, so a publish lock is never wiped.
    - Without the bound, a legacy `failed` left behind on a post that was later rescheduled would be copied back onto a fresh `pendente` destination. That would reintroduce bug 3.
    - A `permalink` that the new webhook cleared on purpose would also be restored.
13. **The reorder TikTok guard applies regardless of the post's status.** The Instagram guard only checks `agendado`. A `processando` destination can sit on a post that was moved to `aprovado_cliente` mid-publish (spec §2e), and its schedule should not move under it either.
14. **The claim locks `OF wp, t`, not only `t`.** The legacy TikTok claim locked the post row (`FOR UPDATE OF wp SKIP LOCKED`), and `post_file_link_replace` relies on "publishers lock this same row" (`20260916000001:67-69`). Locking both keeps that serialization. The rowmarks lock in `FROM` order, `t` then `wp`, while the writers lock the post first and then the target. When `t` locks but `wp` is busy, `SKIP LOCKED` skips the join row, but the `t` lock stays until the statement's transaction ends. That is safe only because the claim runs in its own autocommit transaction (one rpc call from the cron): it ends at once, and since `SKIP LOCKED` never waits, there is no deadlock. The claim must never be wrapped in a longer transaction; the migration comment says so.
15. **CRM adapter extras.**
    - It also nulls `tiktok_publish_id`, which `select('*')` still returns frozen and nothing reads.
    - It emits `'processing'` for `processando`. The TikTok chip in `ScheduleButton.tsx:114` therefore reads "processando" during the short window that used to be `initiated` ("pendente"). The spec already treats both as one "Publicando" state.
    - With no TikTok row, `tiktok_publish_retry_count` becomes `0`, not `null`, because the field is typed `number`.
16. **The existing select pin in `apps/crm/src/__tests__/store.posts.test.ts:792` is updated** to the new `getStandalonePost` select string. It is a select-string contract test, not a ScheduleButton, postLabels or postDestinations test.
17. **The recompute counts Instagram as present when legacy `wp.platform` is `instagram`/`both` OR an Instagram destination row exists** (Task 2). A drifted post (P1 trigger skipped, or a hand edit) is therefore never moved to `postado` with its Instagram side unpublished.
18. **`schedule` refuses a `publicado` TikTok destination only when nothing else is left to publish** (Task 5; a refinement of spec §3 decided in review). The spec's blanket refusal left a dead end: a `both` post moved to draft mid-publish after TikTok landed could never be scheduled again for Instagram. Now:
    - `processando` always refuses (`target_publishing`);
    - `publicado` refuses (`target_published`) only when the post is TikTok-only, or Instagram is already published (`instagram_media_id` set);
    - otherwise the post schedules normally, running only the Instagram validator. The published TikTok destination is never re-claimed (init takes only `pendente`/`agendado`), and the recompute reaches `postado` when Instagram lands.

    Task 9's end-to-end checklist covers this scenario.
19. **`mark_platform_published('tiktok')` copy-forward: a TikTok completion sets the post's `published_at` only when the recompute reaches `postado`** (Task 2; follows spec §2c). The legacy TikTok branch stamped `workflow_posts.published_at` on every TikTok completion, including the first side of a `both` post. Now the TikTok timestamp lands on the destination (`post_targets.published_at`), and the post-level `published_at` moves only with the transition to `postado` (`COALESCE(published_at, now())` in the recompute). The Instagram branch keeps its legacy `published_at` write unchanged.
20. **`mark_platform_published` copy-forward: no re-fire of `postado` on a post that is already `postado`** (Task 2; follows spec §2c). The recompute never downgrades and never re-writes the same status, so a late or duplicate completion records no second `postado` status event or notification.
21. **`mark_platform_published('instagram')` no longer moves a post outside `agendado`/`falha_publicacao` to `postado`** (Task 2; follows spec §2c). The recompute returns `NULL` for a post outside publication, so the Instagram fields still land but the status stays. `supabase/tests/entitlements/66_instagram_automation_post_targets.sql:276` and `:573` call it on posts outside publication and assert only the automation link fields, never the post status, so they keep passing; Task 10's grep re-checks them.
22. **The reconcile runs twice, not once after the function deploys** (Task 9 Step 6; refines spec §5, decided in the final review). The first run comes right after the `db push` is verified, before the function deploys; the second comes after them. An old publish-now still deployed between the push and the deploys can leave a `pendente` destination without a `publish_ref` that the new cron would re-publish; the early run remaps it first. The script is idempotent, so the second run only picks up writes the old functions made in between.

## File map

**SQL**
- `supabase/migrations/20261014000001_post_targets_publish_state.sql` (create): `publish_ref` and its index, the mapping helper, the backfill function `tiktok_backfill_targets` (with the reset rule) and its call, the parity `DO` block, column grants, the delete guard, and the a2/z7 copy-forward.
- `supabase/migrations/20261014000002_post_targets_publish_writers.sql` (create): `recompute_post_publish_status`, `mark_target_published`, `mark_target_failed`, `requeue_target`, `begin_target_publish`, `cancel_target_publish`, the `mark_platform_published` copy-forward, and the z9 reset trigger.
- `supabase/migrations/20261014000003_tiktok_target_claim.sql` (create): `claim_tiktok_targets_for_publishing`, the old claim as a no-op, and the `reorder_post_schedules` and `post_file_link_replace` copy-forwards.
- `supabase/tests/post_targets_publish_state.sql` (create): sections 1-4 (Task 1), 5-11 (Task 2), 12 (Task 3).
- `supabase/tests/tiktok_publishing_rpcs.sql` (rewrite, Task 3): the new claim phases, ordering, locks, and the old claim's no-op.
- `supabase/tests/post_file_link_replace.sql` (modify, Task 3): the TikTok guard now reads the destination.
- `supabase/tests/entitlements/70_workflow_posts_avulsos.sql` (modify, Task 3): new section 8b for the reorder TikTok guard, and the new claim's ACL in section 11.
- `supabase/tests/entitlements/99_post_targets.sql` (modify, Task 1): classify `publish_ref` in the `_clone_post_row` column guard.

**Edge functions**
- `supabase/functions/_shared/tiktok-publish-utils.ts` (modify, Task 4): `clearLock(targetId)`; `markTikTokPublishFailed` → `mark_target_failed`; `confirmAndApplyPublishStatus` → `mark_target_published` or a `post_targets` lock release.
- `supabase/functions/tiktok-publish-cron/core.ts` (modify, Task 4): new claim and row type, writes by `target_id`, retry via `requeue_target`.
- `supabase/functions/tiktok-publish/handler.ts` (modify, Task 5): embeds the TikTok destination; schedule refusal; cancel/retry/publish-now via RPCs.
- `supabase/functions/tiktok-webhook/handler.ts` (modify, Task 6): `post_targets` lookup by `(platform, publish_ref)`, the destination lock, and the public URL writes.
- `supabase/functions/data-import/handler.ts` (modify, Task 7): `guardPublishedPosts` also skips posts with a `publicado` destination.
- `supabase/functions/hub-posts/handler.ts` (modify, Task 7): `tiktok_post_url` now comes from the TikTok destination's `permalink`.
- Tests (modify): `supabase/functions/__tests__/tiktok-publish-cron_test.ts` (Task 4), `tiktok-publish_test.ts` (Task 5), `tiktok-webhook_test.ts` (Task 6), `data-import_test.ts` and `hub-functions_test.ts` (Task 7).

**CRM**
- `apps/crm/src/store/posts.ts` (modify, Task 8): `TIKTOK_TARGET_STATE_EMBED`, `applyTikTokTargetState`, the embed in `POST_CONTEXT_COLUMNS` and in four raw loaders, and the `tiktok_publish_processing_at` type field.
- `apps/crm/src/store/postTargets.ts` (modify, Task 8): `TargetNotRemovableError`; `removePostDestination` maps `P0409` to it.
- `apps/crm/src/pages/entregas/hooks/usePostDestinations.ts` (modify, Task 8): pt-BR toast for `TargetNotRemovableError`.
- Tests: `apps/crm/src/store/__tests__/posts.tiktokTargetState.test.ts` (create), `apps/crm/src/store/__tests__/postTargets.test.ts`, `apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx` and `apps/crm/src/__tests__/store.posts.test.ts` (modify).

**Ops**
- `scripts/tiktok-p4-predeploy.sql` (create, Task 9): the read-only pre-deploy report and the owner-gated stories remediation.
- `scripts/tiktok-p4-reconcile.sql` (create, Task 9): the idempotent, time-bounded reconcile.

## Parallelization

- **T1 → T2 → T3 are sequential.** They share migration ordering. T2's writers reference T1's column, and T3's claim and test reference T2's functions. One subagent should do all three, or each starts after the previous one is committed.
- **T4 → (T5 ∥ T6).** T5 and T6 import the T4 shapes `markTikTokPublishFailed(svc, postId, message, opts)` and `ConfirmAndApplyPublishStatusPost`. Freeze T4's Interfaces first. T5 and T6 can then run in parallel, in separate worktrees or on files that don't overlap.
- **T7, T8 and T9 run in parallel with T4-T6.** They depend only on the SQL names and contracts in the T1-T3 Interfaces (`post_targets.status/permalink/publish_ref`, the `P0409 target_not_removable` code), not on the migrations being merged or applied. Exception: T9's Step 4 runs `supabase db reset`, so it needs T1-T3 committed in the same worktree (the reconcile calls `tiktok_legacy_target_status`).
- **T10 (final gates) runs last, after every other task is committed.**

---

### Task 1: Destination columns, backfill, parity, grants and delete guard

**Files:**
- Create: `supabase/migrations/20261014000001_post_targets_publish_state.sql`
- Create: `supabase/tests/post_targets_publish_state.sql` (sections 1-4)
- Modify: `supabase/tests/entitlements/99_post_targets.sql:648-650` (column classification list in section 13)
- Test: `supabase/tests/post_targets_publish_state.sql`, `supabase/tests/entitlements/99_post_targets.sql`

**Interfaces:**
- Consumes:
  - `public.post_targets` (`20261010100002:65-93`);
  - the trigger functions `workflow_posts_platform_to_targets()` (`:280-341`) and `workflow_posts_stories_drop_tiktok()` (`:351-357`), which this task copies forward.
- Produces:
  - column `post_targets.publish_ref text`;
  - index `post_targets_publish_ref_idx` on `(platform, publish_ref) WHERE publish_ref IS NOT NULL` (non-unique);
  - `public.tiktok_legacy_target_status(p_legacy text, p_post_status text) RETURNS text` (IMMUTABLE; service_role only);
  - `public.tiktok_backfill_targets(p_conta uuid DEFAULT NULL) RETURNS integer` (SECURITY DEFINER, `search_path` pinned, service_role only): the backfill with the reset rule, limited to one workspace when `p_conta` is set. The migration calls it with `NULL`, then runs the parity `DO` block; the test calls it with its workspace id. It is dropped together with the legacy `tiktok_*` columns in the follow-up;
  - trigger `post_targets_a0_guard_delete` (BEFORE DELETE), which raises `ERRCODE 'P0409'`, MESSAGE `target_not_removable`;
  - `authenticated` loses table-level `INSERT` and `UPDATE` on `post_targets`, and gains `INSERT (conta_id, post_id, platform, format, caption, title, settings)` and `UPDATE (caption, title, settings, format)`.

Latest-definition check (done while writing this plan):
- `grep -ln "FUNCTION[^(]*workflow_posts_platform_to_targets\|FUNCTION[^(]*workflow_posts_stories_drop_tiktok" supabase/migrations/*.sql` returns only `20261010100002_post_targets.sql`.
- `_clone_post_row` (`20261010100006:113`) deletes only the freshly seeded `pendente` rows of the new post. The guard never fires there, so it needs no change.

- [ ] **Step 1: Write the failing SQL test (sections 1-4)**

Create `supabase/tests/post_targets_publish_state.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- P4: estado de publicação do TikTok em post_targets
-- (migrations 20261014000001..20261014000003).
-- Spec: docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md
-- Seções 1-4: Task 1 (coluna, backfill, privilégios, guarda de DELETE, a2/z7).
-- Seções 5-11: Task 2 (recompute, writers, reset). Seção 12: Task 3 (claim).

-- 1. publish_ref, índice, mapeamento legado -> destino e backfill com a regra de reset
begin;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_pub bigint; v_proc bigint; v_fail_live bigint; v_fail_reset bigint; v_none bigint;
  r record; v_bad bigint[]; v_legacy jsonb; v_dest jsonb;
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'post_targets'
                    and column_name = 'publish_ref'), 'post_targets.publish_ref ausente';
  assert exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'post_targets_publish_ref_idx'
                    and indexdef like '%(platform, publish_ref)%'
                    and indexdef like '%WHERE (publish_ref IS NOT NULL)%'),
    'indice parcial (platform, publish_ref) ausente';
  assert not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                      where c.relname = 'post_targets_publish_ref_idx' and i.indisunique),
    'indice de publish_ref nao pode ser unico';

  -- matriz do mapeamento (uma fonte para backfill, paridade e reconcile)
  assert tiktok_legacy_target_status(null, 'agendado') = 'pendente', 'NULL -> pendente';
  assert tiktok_legacy_target_status('initiated', 'agendado') = 'processando', 'initiated -> processando';
  assert tiktok_legacy_target_status('processing', 'rascunho') = 'processando', 'processing nunca reseta';
  assert tiktok_legacy_target_status('published', 'postado') = 'publicado', 'published -> publicado';
  assert tiktok_legacy_target_status('failed', 'falha_publicacao') = 'falha', 'failed em falha_publicacao';
  assert tiktok_legacy_target_status('failed', 'agendado') = 'falha', 'failed em agendado';
  assert tiktok_legacy_target_status('failed', 'postado') = 'falha', 'failed em postado';
  assert tiktok_legacy_target_status('failed', 'rascunho') = 'pendente', 'failed fora de publicacao reseta';
  assert tiktok_legacy_target_status('failed', 'aprovado_cliente') = 'pendente', 'failed em aprovado_cliente reseta';

  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_uid);
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_uid, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_uid, 'W', 'ativo') returning id into v_wf;

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, published_at,
      tiktok_publish_status, tiktok_publish_id, tiktok_post_id, tiktok_post_url)
    values (v_wf, v_ws, 'pub', 'feed', 'postado', 'tiktok', '2026-01-01T10:00:00Z',
      'published', 'pid-pub', 'tt-1', 'https://www.tiktok.com/@x/photo/tt-1')
    returning id into v_pub;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform,
      tiktok_publish_status, tiktok_publish_id, tiktok_publish_processing_at)
    values (v_wf, v_ws, 'proc', 'reels', 'agendado', 'both',
      'processing', 'pid-proc', '2026-01-02T10:00:00Z')
    returning id into v_proc;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform,
      tiktok_publish_status, tiktok_publish_id, tiktok_publish_error, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'fail-live', 'feed', 'falha_publicacao', 'tiktok',
      'failed', 'pid-fail', 'boom', 2)
    returning id into v_fail_live;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform,
      tiktok_publish_status, tiktok_publish_id, tiktok_publish_error, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'fail-reset', 'feed', 'rascunho', 'tiktok',
      'failed', 'pid-old', 'velho', 3)
    returning id into v_fail_reset;
  -- retry legado: status NULL mas tiktok_publish_id velho ficou para trás
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform,
      tiktok_publish_status, tiktok_publish_id, tiktok_publish_retry_count)
    values (v_wf, v_ws, 'none', 'feed', 'agendado', 'tiktok', null, 'pid-stale', 1)
    returning id into v_none;

  -- A migration já rodou antes do teste: chama a MESMA função de backfill que ela
  -- chamou, restrita aos posts deste workspace (5 posts TikTok/both).
  assert tiktok_backfill_targets(v_ws) = 5, 'backfill deve tocar os 5 destinos TikTok do workspace';

  select * into r from post_targets where post_id = v_pub and platform = 'tiktok';
  assert r.status = 'publicado' and r.publish_ref = 'pid-pub' and r.external_id = 'tt-1'
     and r.permalink = 'https://www.tiktok.com/@x/photo/tt-1'
     and r.published_at = '2026-01-01T10:00:00Z'::timestamptz,
    format('publicado: %s', row_to_json(r));

  select * into r from post_targets where post_id = v_proc and platform = 'tiktok';
  assert r.status = 'processando' and r.publish_ref = 'pid-proc'
     and r.processing_at = '2026-01-02T10:00:00Z'::timestamptz and r.published_at is null,
    format('processando: %s', row_to_json(r));
  assert (select status from post_targets where post_id = v_proc and platform = 'instagram') = 'pendente',
    'destino Instagram nao e tocado pelo backfill';

  select * into r from post_targets where post_id = v_fail_live and platform = 'tiktok';
  assert r.status = 'falha' and r.publish_ref = 'pid-fail' and r.error = 'boom' and r.retry_count = 2,
    format('falha: %s', row_to_json(r));

  select * into r from post_targets where post_id = v_fail_reset and platform = 'tiktok';
  assert r.status = 'pendente' and r.publish_ref is null and r.error is null
     and r.error_code is null and r.retry_count = 0,
    format('reset: failed fora de publicacao vira pendente limpo: %s', row_to_json(r));

  select * into r from post_targets where post_id = v_none and platform = 'tiktok';
  assert r.status = 'pendente' and r.publish_ref is null and r.retry_count = 1,
    format('pendente legado nao herda publish_id velho: %s', row_to_json(r));

  -- paridade (as três asserções do DO block da migration, restritas a v_ws)
  select coalesce(jsonb_object_agg(st, n), '{}'::jsonb) into v_legacy from (
    select tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) as st, count(*) as n
      from workflow_posts wp
     where wp.conta_id = v_ws and wp.platform in ('tiktok','both')
     group by 1) s;
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_dest from (
    select t.status, count(*) as n from post_targets t
     where t.conta_id = v_ws and t.platform = 'tiktok'
     group by 1) s;
  assert v_legacy = v_dest, format('paridade por status: %s vs %s', v_legacy, v_dest);

  select array_agg(wp.id) into v_bad from workflow_posts wp
   where wp.conta_id = v_ws and wp.platform in ('tiktok','both')
     and (select count(*) from post_targets t
           where t.post_id = wp.id and t.platform = 'tiktok') <> 1;
  assert v_bad is null, format('tiktok/both sem exatamente um destino TikTok: %s', v_bad);
  select array_agg(t.post_id) into v_bad from post_targets t join workflow_posts wp on wp.id = t.post_id
   where t.conta_id = v_ws and t.platform = 'tiktok' and wp.platform not in ('tiktok','both');
  assert v_bad is null, format('destino TikTok em post sem tiktok/both: %s', v_bad);
  select array_agg(t.post_id) into v_bad from post_targets t join workflow_posts wp on wp.id = t.post_id
   where t.conta_id = v_ws and t.platform = 'tiktok' and wp.tipo = 'stories';
  assert v_bad is null, format('destino TikTok em stories: %s', v_bad);

  assert not has_function_privilege('anon', 'public.tiktok_legacy_target_status(text,text)', 'EXECUTE'),
    'anon executa tiktok_legacy_target_status';
  assert not has_function_privilege('authenticated', 'public.tiktok_legacy_target_status(text,text)', 'EXECUTE'),
    'authenticated executa tiktok_legacy_target_status';
  assert not has_function_privilege('anon', 'public.tiktok_backfill_targets(uuid)', 'EXECUTE'),
    'anon executa tiktok_backfill_targets';
  assert not has_function_privilege('authenticated', 'public.tiktok_backfill_targets(uuid)', 'EXECUTE'),
    'authenticated executa tiktok_backfill_targets';
  assert has_function_privilege('service_role', 'public.tiktok_backfill_targets(uuid)', 'EXECUTE'),
    'service_role deve executar tiktok_backfill_targets';
  raise notice 'PASS p4.1 publish_ref, mapeamento e backfill';
end $$;
rollback;

-- 2. Privilégios de coluna: authenticated não grava estado de publicação; a
--    semente de destinos (DEFINER) segue funcionando para um post criado por ele.
begin;
-- post_targets fora da parity: o helper daria ALL e desfaria os grants sob teste.
select et_grant_hosted_parity(array['post_targets']);
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_p bigint;
  v_n int; v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;

  assert not has_table_privilege('authenticated', 'public.post_targets', 'UPDATE'),
    'authenticated ainda tem UPDATE de tabela inteira';
  assert not has_table_privilege('authenticated', 'public.post_targets', 'INSERT'),
    'authenticated ainda tem INSERT de tabela inteira';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'status', 'UPDATE'), 'UPDATE status';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'external_id', 'UPDATE'), 'UPDATE external_id';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'permalink', 'UPDATE'), 'UPDATE permalink';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'publish_ref', 'UPDATE'), 'UPDATE publish_ref';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'platform', 'UPDATE'), 'UPDATE platform';
  assert not has_column_privilege('authenticated', 'public.post_targets', 'status', 'INSERT'), 'INSERT status';
  assert has_column_privilege('authenticated', 'public.post_targets', 'caption', 'UPDATE'), 'UPDATE caption';
  assert has_column_privilege('authenticated', 'public.post_targets', 'platform', 'INSERT'), 'INSERT platform';
  assert has_table_privilege('authenticated', 'public.post_targets', 'SELECT'), 'SELECT';
  assert has_table_privilege('authenticated', 'public.post_targets', 'DELETE'), 'DELETE';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'p', 'feed', 'both') returning id into v_p;
  select count(*) into v_n from post_targets
   where post_id = v_p and platform in ('instagram','tiktok');
  assert v_n = 2, format('seed de destinos como authenticated: %s', v_n);

  v_rejected := false;
  begin update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated gravou status';

  v_rejected := false;
  begin update post_targets set external_id = 'x' where post_id = v_p and platform = 'tiktok';
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated gravou external_id';

  v_rejected := false;
  begin update post_targets set publish_ref = 'x' where post_id = v_p and platform = 'tiktok';
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated gravou publish_ref';

  v_rejected := false;
  begin insert into post_targets (conta_id, post_id, platform, status) values (v_ws, v_p, 'geral', 'publicado');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'authenticated inseriu destino com status';

  update post_targets set caption = 'ok' where post_id = v_p and platform = 'tiktok';
  get diagnostics v_n = row_count;
  assert v_n = 1, 'authenticated deve poder gravar caption';
  insert into post_targets (conta_id, post_id, platform, caption) values (v_ws, v_p, 'geral', 'g');
  raise notice 'PASS p4.2 privilegios de coluna';
end $$;
rollback;

-- 3. Guarda de DELETE: processando/publicado não saem enquanto o post existe;
--    a cascata do DELETE do post passa.
begin;
select et_grant_hosted_parity(array['post_targets']);
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_p bigint; v_q bigint;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'p', 'feed', 'both') returning id into v_p;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'q', 'feed', 'both') returning id into v_q;

  -- dono da tabela (stand-in do service_role): o trigger vale para qualquer papel
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  v_rejected := false;
  begin delete from post_targets where post_id = v_p and platform = 'tiktok';
  exception when sqlstate 'P0409' then
    assert sqlerrm = 'target_not_removable', format('mensagem: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'DELETE de destino publicado passou';

  update post_targets set status = 'processando' where post_id = v_q and platform = 'tiktok';
  v_rejected := false;
  begin delete from post_targets where post_id = v_q and platform = 'tiktok';
  exception when sqlstate 'P0409' then v_rejected := true; end;
  assert v_rejected, 'DELETE de destino processando passou';

  -- pendente sai normalmente
  delete from post_targets where post_id = v_q and platform = 'instagram';
  assert not exists (select 1 from post_targets where post_id = v_q and platform = 'instagram'),
    'destino pendente deve sair';

  -- como authenticated (caminho do CRM, removePostDestination)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin delete from post_targets where post_id = v_p and platform = 'tiktok';
  exception when sqlstate 'P0409' then v_rejected := true; end;
  assert v_rejected, 'authenticated tirou destino publicado';
  execute 'reset role';

  -- cascata: o post sai com o destino publicado junto
  delete from workflow_posts where id = v_p;
  assert not exists (select 1 from post_targets where post_id = v_p),
    'cascata do DELETE do post deve levar o destino publicado';
  raise notice 'PASS p4.3 guarda de DELETE';
end $$;
rollback;

-- 4. a2 e z7 copiados para frente: escrita legada de platform e virar stories
--    deixam um destino TikTok publicando/publicado no lugar, sem erro.
begin;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_pub bigint; v_proc bigint; v_pend bigint; v_plat text;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_uid);
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_uid, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_uid, 'W', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'pub', 'reels', 'both') returning id into v_pub;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'proc', 'reels', 'both') returning id into v_proc;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform)
    values (v_wf, v_ws, 'pend', 'reels', 'both') returning id into v_pend;
  update post_targets set status = 'publicado' where post_id = v_pub and platform = 'tiktok';
  update post_targets set status = 'processando' where post_id = v_proc and platform = 'tiktok';

  -- a2: PlatformSelector grava 'instagram'
  update workflow_posts set platform = 'instagram' where id = v_pub;
  assert (select status from post_targets where post_id = v_pub and platform = 'tiktok') = 'publicado',
    'a2 apagou destino TikTok publicado';
  select platform into v_plat from workflow_posts where id = v_pub;
  assert v_plat = 'both', format('platform segue derivado do que restou: %s', v_plat);

  -- controle: pendente sai como antes
  update workflow_posts set platform = 'instagram' where id = v_pend;
  assert not exists (select 1 from post_targets where post_id = v_pend and platform = 'tiktok'),
    'a2 deve continuar tirando destino TikTok pendente';
  select platform into v_plat from workflow_posts where id = v_pend;
  assert v_plat = 'instagram', format('controle a2: %s', v_plat);

  -- z7: virou stories
  update workflow_posts set tipo = 'stories' where id = v_proc;
  assert (select status from post_targets where post_id = v_proc and platform = 'tiktok') = 'processando',
    'z7 apagou destino TikTok processando';
  update workflow_posts set tipo = 'stories' where id = v_pub;
  assert exists (select 1 from post_targets where post_id = v_pub and platform = 'tiktok'),
    'z7 apagou destino TikTok publicado';
  raise notice 'PASS p4.4 a2/z7 respeitam a guarda de DELETE';
end $$;
rollback;
```

- [ ] **Step 2: Update the clone column guard so it classifies `publish_ref`**

In `supabase/tests/entitlements/99_post_targets.sql`, replace:

```sql
       'caption','title','settings','scheduled_at','status','external_id',
       'permalink','error','error_code','retry_count','processing_at','published_at',
```

with:

```sql
       'caption','title','settings','scheduled_at','status','external_id',
       'permalink','error','error_code','retry_count','processing_at','published_at',
       'publish_ref',
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
npx supabase db reset
psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/post_targets_publish_state.sql
```

Expected: FAIL in section 1 with `assertion failed: post_targets.publish_ref ausente` (or `function tiktok_legacy_target_status(...) does not exist` / `function tiktok_backfill_targets(uuid) does not exist`).

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261014000001_post_targets_publish_state.sql`:

```sql
-- ============================================================
-- P4 (1/3): estado de publicação do TikTok passa a morar em post_targets.
-- Spec: docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md
--   §1, §2a (publish_ref), §2b (backfill + paridade), §2h (privilégios + guarda).
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 1).
--
-- Depois desta migration as colunas tiktok_* de publicação em workflow_posts
-- (tiktok_publish_status/id/error/retry_count/processing_at, tiktok_post_id/url)
-- ficam congeladas: o backfill abaixo é a última leitura delas por escrita.
-- 20261014000002 traz os writers; 20261014000003 o claim novo.
-- ============================================================

-- CREATE TRIGGER e ALTER em post_targets pedem lock forte: desiste em 5s em vez
-- de enfileirar o tráfego (mesmo cabeçalho de 20261010100002).
SET LOCAL lock_timeout = '5s';

-- ---------- a. publish_ref --------------------------------------------------
-- Handle do provedor para uma publicação em voo (TikTok: publish_id temporário,
-- o que o webhook usa para achar a linha). external_id segue sendo o id público.
-- Não é UNIQUE: tiktok_publish_id nunca foi, e uma duplicata no legado
-- derrubaria a migration sem ganho. O webhook resolve duplicata pela linha mais nova.
ALTER TABLE public.post_targets ADD COLUMN publish_ref text;
CREATE INDEX post_targets_publish_ref_idx
  ON public.post_targets (platform, publish_ref)
  WHERE publish_ref IS NOT NULL;

-- ---------- b. backfill -----------------------------------------------------
-- Mapeamento legado -> destino, com a regra de reset (§2b): 'failed' num post
-- fora de publicação vira 'pendente' (mesma regra do trigger z9 de
-- 20261014000002, que só pega updates futuros). Fonte única para o backfill,
-- a paridade abaixo, scripts/tiktok-p4-reconcile.sql e os testes.
CREATE OR REPLACE FUNCTION public.tiktok_legacy_target_status(p_legacy text, p_post_status text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_legacy IN ('initiated','processing') THEN 'processando'
    WHEN p_legacy = 'published' THEN 'publicado'
    WHEN p_legacy = 'failed'
         AND p_post_status IN ('agendado','falha_publicacao','postado') THEN 'falha'
    ELSE 'pendente'
  END;
$$;
REVOKE ALL ON FUNCTION public.tiktok_legacy_target_status(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tiktok_legacy_target_status(text, text) TO service_role;

-- O backfill mora numa função para o teste exercitar o MESMO UPDATE da migration
-- (restrito ao workspace do teste) em vez de uma cópia. p_conta NULL = todos os
-- posts (a chamada da migration). Sai junto das colunas tiktok_* no follow-up.
-- publish_ref só onde o estado carrega uma publicação (o retry legado limpava o
-- status mas deixava tiktok_publish_id velho); error só em 'falha'. O reset
-- zera retry_count; nas demais linhas a contagem legada vem junto.
CREATE OR REPLACE FUNCTION public.tiktok_backfill_targets(p_conta uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.post_targets t SET
    status        = m.st,
    publish_ref   = CASE WHEN m.st IN ('processando','publicado','falha') THEN m.tiktok_publish_id END,
    external_id   = m.tiktok_post_id,
    permalink     = m.tiktok_post_url,
    error         = CASE WHEN m.st = 'falha' THEN m.tiktok_publish_error END,
    error_code    = NULL,
    retry_count   = CASE WHEN m.was_reset THEN 0 ELSE COALESCE(m.tiktok_publish_retry_count, 0) END,
    processing_at = m.tiktok_publish_processing_at,
    published_at  = CASE WHEN m.st = 'publicado' THEN m.published_at END,
    updated_at    = now()
  FROM (
    SELECT wp.id, wp.tiktok_publish_id, wp.tiktok_post_id, wp.tiktok_post_url,
           wp.tiktok_publish_error, wp.tiktok_publish_retry_count,
           wp.tiktok_publish_processing_at, wp.published_at,
           public.tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) AS st,
           (wp.tiktok_publish_status = 'failed'
            AND public.tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) = 'pendente') AS was_reset
      FROM public.workflow_posts wp
     WHERE p_conta IS NULL OR wp.conta_id = p_conta
  ) m
  WHERE t.post_id = m.id AND t.platform = 'tiktok';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.tiktok_backfill_targets(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tiktok_backfill_targets(uuid) TO service_role;

SELECT public.tiktok_backfill_targets(NULL);

-- Paridade: qualquer divergência derruba a migration inteira.
DO $$
DECLARE
  v_legacy jsonb;
  v_dest   jsonb;
  v_bad    bigint[];
BEGIN
  SELECT COALESCE(jsonb_object_agg(st, n), '{}'::jsonb) INTO v_legacy FROM (
    SELECT public.tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) AS st,
           count(*) AS n
      FROM public.workflow_posts wp
     WHERE wp.platform IN ('tiktok','both')
     GROUP BY 1) s;
  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_dest FROM (
    SELECT t.status, count(*) AS n
      FROM public.post_targets t
     WHERE t.platform = 'tiktok'
     GROUP BY 1) s;
  IF v_legacy IS DISTINCT FROM v_dest THEN
    RAISE EXCEPTION 'P4 paridade: legado % <> destinos %', v_legacy, v_dest;
  END IF;

  SELECT array_agg(wp.id ORDER BY wp.id) INTO v_bad
    FROM public.workflow_posts wp
   WHERE wp.platform IN ('tiktok','both')
     AND (SELECT count(*) FROM public.post_targets t
           WHERE t.post_id = wp.id AND t.platform = 'tiktok') <> 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'P4 paridade: posts tiktok/both sem exatamente um destino TikTok: %', v_bad;
  END IF;

  SELECT array_agg(t.post_id ORDER BY t.post_id) INTO v_bad
    FROM public.post_targets t
    JOIN public.workflow_posts wp ON wp.id = t.post_id
   WHERE t.platform = 'tiktok' AND wp.platform NOT IN ('tiktok','both');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'P4 paridade: destino TikTok em post fora de tiktok/both: %', v_bad;
  END IF;

  -- P1 semeou TikTok sem filtrar tipo (20261010100002:110-115). Se isto falhar
  -- em prod, rodar a remediação de scripts/tiktok-p4-predeploy.sql antes.
  SELECT array_agg(t.post_id ORDER BY t.post_id) INTO v_bad
    FROM public.post_targets t
    JOIN public.workflow_posts wp ON wp.id = t.post_id
   WHERE t.platform = 'tiktok' AND wp.tipo = 'stories';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'P4 paridade: destino TikTok em post stories: %', v_bad;
  END IF;
END $$;

-- ---------- h. privilégios --------------------------------------------------
-- authenticated não grava status/external_id/permalink/publish_ref/erro.
-- O CRM só escreve conta_id, post_id, platform e caption (store/postTargets.ts).
-- Os triggers de P1 que gravam platform/post_id são DEFINER: não são afetados.
REVOKE INSERT, UPDATE ON TABLE public.post_targets FROM authenticated;
GRANT INSERT (conta_id, post_id, platform, format, caption, title, settings)
  ON TABLE public.post_targets TO authenticated;
GRANT UPDATE (caption, title, settings, format)
  ON TABLE public.post_targets TO authenticated;

-- Guarda de DELETE: destino publicando ou publicado não sai enquanto o post
-- existe. A cascata do DELETE do post passa: a ação RI roda depois do DELETE
-- da linha pai, então o post já não existe aqui (mesma premissa de
-- post_targets_sync_platform, 20261010100002:263-264).
CREATE OR REPLACE FUNCTION public.post_targets_guard_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status IN ('processando','publicado')
     AND EXISTS (SELECT 1 FROM public.workflow_posts WHERE id = OLD.post_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'target_not_removable';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.post_targets_guard_delete() FROM public, anon, authenticated;

CREATE TRIGGER post_targets_a0_guard_delete
  BEFORE DELETE ON public.post_targets
  FOR EACH ROW EXECUTE FUNCTION public.post_targets_guard_delete();

-- ---------- a2 copiado para frente ------------------------------------------
-- Canônica: 20261010100002_post_targets.sql:280-341. Única mudança (-- P4:):
-- os dois DELETEs pulam destinos em processando/publicado, que a guarda acima
-- recusaria com erro cru no editor. platform segue derivado do que restou.
CREATE OR REPLACE FUNCTION public.workflow_posts_platform_to_targets()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev text := current_setting('app.post_targets_sync', true);
  v_want_ig boolean;
  v_want_tt boolean;
BEGIN
  IF v_prev = 'on' OR NEW.platform IS NOT DISTINCT FROM OLD.platform THEN
    RETURN NEW;
  END IF;
  -- Post Express é só Instagram: a escrita legada de platform não faz nada.
  IF NEW.is_express THEN
    NEW.platform := OLD.platform;
    RETURN NEW;
  END IF;
  -- Valor fora do domínio: deixa a CHECK recusar (não tocar em destinos).
  IF NEW.platform IS NULL OR NEW.platform NOT IN ('instagram','tiktok','both','other') THEN
    RETURN NEW;
  END IF;

  -- Instagram só entra se o quadro lista Instagram (ou o post já tem o destino):
  -- o auto-reparo de stories do PlatformSelector grava 'instagram' e não pode
  -- criar destino Instagram num quadro só TikTok. TikTok nunca em stories.
  v_want_ig := NEW.platform IN ('instagram','both')
    AND ('instagram' = ANY(public.post_board_platforms(NEW.workflow_id, NEW.cliente_id))
         OR EXISTS (SELECT 1 FROM public.post_targets
                     WHERE post_id = NEW.id AND platform = 'instagram'));
  v_want_tt := NEW.platform IN ('tiktok','both') AND NEW.tipo <> 'stories';

  -- Pedido de Instagram/TikTok que não sobra nenhum dos dois (quadro só TikTok
  -- e o usuário pede Instagram; stories e o usuário pede TikTok): em P1 não há
  -- editor de destinos para sair de 'other', então a escrita não faz nada e o
  -- platform volta a ser o dos destinos atuais. 'other' explícito (nenhuma UI
  -- grava) segue valendo: tira Instagram e TikTok de propósito.
  IF NEW.platform <> 'other' AND NOT v_want_ig AND NOT v_want_tt THEN
    NEW.platform := public.derive_post_platform(NEW.id);
    RETURN NEW;
  END IF;

  -- GUC ligado: os INSERT/DELETE abaixo não podem reescrever esta mesma linha
  -- (UPDATE dentro de BEFORE UPDATE da própria linha = erro 27000).
  PERFORM set_config('app.post_targets_sync', 'on', true);
  IF v_want_ig THEN
    INSERT INTO public.post_targets (conta_id, post_id, platform)
    VALUES (NEW.conta_id, NEW.id, 'instagram') ON CONFLICT (post_id, platform) DO NOTHING;
  ELSE
    DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'instagram'
      AND status NOT IN ('processando','publicado');  -- P4: guarda de DELETE
  END IF;
  IF v_want_tt THEN
    INSERT INTO public.post_targets (conta_id, post_id, platform)
    VALUES (NEW.conta_id, NEW.id, 'tiktok') ON CONFLICT (post_id, platform) DO NOTHING;
  ELSE
    DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'tiktok'
      AND status NOT IN ('processando','publicado');  -- P4: guarda de DELETE
  END IF;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);

  -- O pedido pode não ter sido atendido por inteiro (quadro sem Instagram,
  -- stories sem TikTok, P4: destino publicando/publicado que ficou): grava o
  -- que os destinos dizem.
  NEW.platform := public.derive_post_platform(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_platform_to_targets() FROM public, anon, authenticated;

-- ---------- z7 copiado para frente ------------------------------------------
-- Canônica: 20261010100002_post_targets.sql:351-357. Única mudança (-- P4:):
-- destino TikTok publicando/publicado fica. O trigger (z7, AFTER UPDATE OF tipo)
-- não muda e continua apontando para esta função.
CREATE OR REPLACE FUNCTION public.workflow_posts_stories_drop_tiktok()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'tiktok'
    AND status NOT IN ('processando','publicado');  -- P4: guarda de DELETE
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_stories_drop_tiktok() FROM public, anon, authenticated;
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npx supabase db reset
psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/post_targets_publish_state.sql
psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_targets.sql
```

Expected:
- `post_targets_publish_state.sql` prints `NOTICE: PASS p4.1` through `PASS p4.4` and exits 0.
- `99_post_targets.sql` exits 0. Its sections 4 and 15 still pass under the new grants.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261014000001_post_targets_publish_state.sql supabase/tests/post_targets_publish_state.sql supabase/tests/entitlements/99_post_targets.sql
git commit -m "feat(db): backfill TikTok publish state into post_targets (P4 1/3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Recompute, destination writers, `mark_platform_published` copy-forward, reset trigger

**Files:**
- Create: `supabase/migrations/20261014000002_post_targets_publish_writers.sql`
- Modify: `supabase/tests/post_targets_publish_state.sql` (append the fixture helpers and sections 5-11)
- Test: `supabase/tests/post_targets_publish_state.sql`, `supabase/tests/tiktok_publishing_rpcs.sql` cases (a) and (b), which must stay green unchanged until Task 3 rewrites (c), (d) and (f)

**Interfaces:**
- Consumes:
  - `post_targets.publish_ref` (Task 1);
  - `record_post_status_change(bigint, text, text, uuid, bigint, jsonb)` (latest `20260807000001:14-58`, grants `20260925000001:56-57`);
  - `mark_platform_published` latest body `20260807000001:67-120`.
- Produces (all `SECURITY DEFINER SET search_path = public, pg_temp`):
  - `public.recompute_post_publish_status(p_post_id bigint, p_source text, p_actor uuid DEFAULT NULL) RETURNS text`. It returns the target status it computed, or `NULL` when the post is outside publication or has no auto-publishing destination. Internal: no `service_role` grant.
  - `public.mark_target_published(p_post_id bigint, p_platform text, p_fields jsonb DEFAULT '{}'::jsonb, p_source text DEFAULT 'system', p_actor uuid DEFAULT NULL) RETURNS void`. `p_fields` keys: `external_id`, `permalink`, `published_at`.
  - `public.mark_target_failed(p_post_id bigint, p_platform text, p_error text, p_error_code text, p_retryable boolean, p_source text DEFAULT 'system', p_actor uuid DEFAULT NULL) RETURNS boolean`. Returns `false` (no write) when the row is already `falha` or `publicado`.
  - `public.requeue_target(p_post_id bigint, p_platform text, p_source text DEFAULT 'system', p_actor uuid DEFAULT NULL) RETURNS boolean`.
  - `public.begin_target_publish(p_post_id bigint, p_platform text, p_source text, p_actor uuid DEFAULT NULL) RETURNS boolean`. Returns `false` when the lock is held. When it takes the lock it stamps `workflow_posts.scheduled_at = now()` in the same transaction: through `record_post_status_change`'s `p_fields` when it moves `aprovado_cliente` → `agendado`, or with a direct `UPDATE` when the post is already `agendado`. This mirrors `instagram-publish/handler.ts:225,304,363`, so a destination re-queued after a failed publish-now satisfies the claim's `scheduled_at <= now()`.
  - `public.cancel_target_publish(p_post_id bigint, p_platform text, p_source text, p_actor uuid DEFAULT NULL) RETURNS void`.
  - `public.mark_platform_published(bigint, text, text, uuid, jsonb)`: same signature and grants as today.
  - Trigger `workflow_posts_z9_reset_tiktok_target` (AFTER UPDATE OF status, `WHEN (NEW.status IS DISTINCT FROM OLD.status)`), backed by `public.workflow_posts_reset_tiktok_target()`.
- Refusals: `P0422` with `post_not_publishable | post_not_scheduled | target_publishing | target_published | target_not_ready | target_not_found`; `P0404` with `post_not_found | target_not_found`; `22023` with `unsupported_platform`.

Latest-definition check (done while writing this plan):
- `grep -l "FUNCTION[^(]*mark_platform_published" supabase/migrations/*.sql` lists `20260720000005`, `20260807000001` and `20260925000001`. The last one only re-grants, so `20260807000001:67-120` is the canonical body.
- `record_post_status_change` is called, not copied. Its allowlist already carries every key the writers pass: `instagram_container_id`, `publish_processing_at`, `publish_error`, `publish_error_code` and `published_at`.

- [ ] **Step 1: Append the fixture helpers and the failing sections 5-11 to the SQL test**

Append to `supabase/tests/post_targets_publish_state.sql`:

```sql
-- ===================== Task 2: recompute, writers, reset =====================
-- Helpers de sessão (pg_temp): fluxo pronto, post com destinos semeados pelo z4b
-- (platform 'tiktok' -> {tiktok}; 'both' -> {instagram,tiktok}; 'instagram' -> quadro)
-- e "esta chamada falha com SQLSTATE/mensagem".
create function pg_temp.p4_workflow() returns bigint language plpgsql as $$
declare v_ws uuid := et_make_workspace('pro'); v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
begin
  insert into auth.users (id) values (v_uid);
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_uid, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_uid, 'W', 'ativo') returning id into v_wf;
  return v_wf;
end $$;

create function pg_temp.p4_post(p_wf bigint, p_status text, p_platform text, p_tipo text default 'feed')
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
  select p_wf, w.conta_id, 'p', p_tipo, p_status, p_platform, now() - interval '1 hour'
    from workflows w where w.id = p_wf
  returning id into v_id;
  return v_id;
end $$;

create function pg_temp.p4_expect(p_sql text, p_state text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    assert sqlstate = p_state and sqlerrm = p_msg,
      format('esperado %s/%s, veio %s/%s em: %s', p_state, p_msg, sqlstate, sqlerrm, p_sql);
    return;
  end;
  raise exception 'deveria falhar com %/%: %', p_state, p_msg, p_sql;
end $$;

-- 5. recompute_post_publish_status: matriz TikTok x Instagram x status do post
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; v_r text; v_n int;
begin
  -- 5a TikTok só, destino publicado -> postado (com published_at e evento de status)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  v_r := recompute_post_publish_status(v_p, 'system');
  assert v_r = 'postado', format('5a retorno %s', v_r);
  assert (select status from workflow_posts where id = v_p) = 'postado', '5a post postado';
  assert (select published_at from workflow_posts where id = v_p) is not null, '5a published_at';
  select count(*) into v_n from post_status_events where post_id = v_p and to_status = 'postado';
  assert v_n = 1, format('5a um evento postado, veio %s', v_n);

  -- 5b TikTok só, destino falha -> falha_publicacao
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'falha' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') = 'falha_publicacao', '5b retorno';
  assert (select status from workflow_posts where id = v_p) = 'falha_publicacao', '5b post';

  -- 5c both: Instagram publicado, TikTok pendente -> segue agendado, sem evento novo
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  update workflow_posts set instagram_media_id = 'm1' where id = v_p;
  select count(*) into v_n from post_status_events where post_id = v_p;
  assert recompute_post_publish_status(v_p, 'system') = 'agendado', '5c retorno';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '5c post';
  assert (select count(*) from post_status_events where post_id = v_p) = v_n, '5c sem evento';

  -- 5d both em falha_publicacao, Instagram falhou (publish_error), TikTok publicado -> segue falha
  v_p := pg_temp.p4_post(v_wf, 'falha_publicacao', 'both');
  update workflow_posts set publish_error = 'ig boom' where id = v_p;
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') = 'falha_publicacao', '5d retorno';
  assert (select status from workflow_posts where id = v_p) = 'falha_publicacao', '5d post';

  -- 5e both agendado com publish_error ainda setado (retry do IG em voo) e TikTok
  --    publicado: Instagram conta como em andamento, não como falha
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  update workflow_posts set publish_error = 'ig velho' where id = v_p;
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') = 'agendado', '5e retorno';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '5e post';

  -- 5f postado nunca rebaixa
  v_p := pg_temp.p4_post(v_wf, 'postado', 'tiktok');
  update post_targets set status = 'falha' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') is null, '5f retorno';
  assert (select status from workflow_posts where id = v_p) = 'postado', '5f post';

  -- 5g status do usuário (rascunho) não é tocado
  v_p := pg_temp.p4_post(v_wf, 'rascunho', 'tiktok');
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') is null, '5g retorno';
  assert (select status from workflow_posts where id = v_p) = 'rascunho', '5g post';

  -- 5h só Geral (nenhum destino que publica sozinho) -> NULL, nada muda
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  insert into post_targets (conta_id, post_id, platform)
    select conta_id, id, 'geral' from workflow_posts where id = v_p;
  delete from post_targets where post_id = v_p and platform = 'tiktok';
  assert (select platform from workflow_posts where id = v_p) not in ('instagram','both','tiktok'),
    '5h platform derivado sem social';
  assert recompute_post_publish_status(v_p, 'system') is null, '5h retorno';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '5h post';

  -- 5i Geral ignorado ao lado do TikTok
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  insert into post_targets (conta_id, post_id, platform)
    select conta_id, id, 'geral' from workflow_posts where id = v_p;
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  assert recompute_post_publish_status(v_p, 'system') = 'postado', '5i Geral nao segura o postado';
  raise notice 'PASS p4.5 recompute';
end $$;
rollback;

-- 6. mark_target_published e mark_platform_published copiado para frente
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record;
begin
  -- 6a destino TikTok publicado + post postado na mesma transação
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando', publish_ref = 'pub-6a', processing_at = now(),
         error = 'x', error_code = 'y'
   where post_id = v_p and platform = 'tiktok';
  perform mark_target_published(v_p, 'tiktok',
    jsonb_build_object('external_id', 'tt-6a', 'permalink', 'https://www.tiktok.com/@u/photo/tt-6a',
                       'published_at', '2026-02-01T10:00:00Z'));
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'publicado' and r.external_id = 'tt-6a'
     and r.permalink = 'https://www.tiktok.com/@u/photo/tt-6a'
     and r.published_at = '2026-02-01T10:00:00Z'::timestamptz
     and r.processing_at is null and r.error is null and r.error_code is null
     and r.publish_ref = 'pub-6a',
    format('6a destino: %s', row_to_json(r));
  assert (select status from workflow_posts where id = v_p) = 'postado', '6a post postado';
  -- reentrega sem campos não apaga o que já está lá
  perform mark_target_published(v_p, 'tiktok');
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.external_id = 'tt-6a' and r.published_at = '2026-02-01T10:00:00Z'::timestamptz,
    '6a COALESCE preserva external_id/published_at';

  -- 6b mark_platform_published('tiktok') com as chaves legadas cai no destino
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  perform mark_platform_published(v_p, 'tiktok', 'system', null,
    jsonb_build_object('tiktok_post_id', 'tt-6b', 'tiktok_post_url', 'https://www.tiktok.com/@u/video/tt-6b'));
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'publicado' and r.external_id = 'tt-6b'
     and r.permalink = 'https://www.tiktok.com/@u/video/tt-6b',
    format('6b traducao de chaves: %s', row_to_json(r));
  assert (select tiktok_publish_status is null and tiktok_post_id is null and tiktok_post_url is null
            from workflow_posts where id = v_p), '6b colunas tiktok_* congeladas';
  assert (select status from workflow_posts where id = v_p) = 'postado', '6b post postado';

  -- 6c ramo Instagram: paridade (IG só -> postado; both com TikTok pendente -> agendado)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  perform mark_platform_published(v_p, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'ig-6c'));
  assert (select status from workflow_posts where id = v_p) = 'agendado', '6c both espera o TikTok';
  assert (select instagram_media_id from workflow_posts where id = v_p) = 'ig-6c', '6c media';
  perform mark_target_published(v_p, 'tiktok', jsonb_build_object('external_id', 'tt-6c'));
  assert (select status from workflow_posts where id = v_p) = 'postado', '6c both postado';

  -- 6d recusas
  perform pg_temp.p4_expect(format('select mark_target_published(%s, %L)', v_p, 'instagram'),
    '22023', 'unsupported_platform');
  perform pg_temp.p4_expect('select mark_target_published(-1, ''tiktok'')', 'P0404', 'post_not_found');
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'other');
  perform pg_temp.p4_expect(format('select mark_target_published(%s, %L)', v_p, 'tiktok'),
    'P0404', 'target_not_found');
  raise notice 'PASS p4.6 mark_target_published / mark_platform_published';
end $$;
rollback;

-- 7. mark_target_failed: contagem, erro, idempotência, nunca rebaixa publicado
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record; v_ok boolean;
begin
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando', publish_ref = 'pub-7', processing_at = now()
   where post_id = v_p and platform = 'tiktok';
  v_ok := mark_target_failed(v_p, 'tiktok', repeat('e', 600), 'video_pull_failed', true);
  assert v_ok, '7a primeira falha grava';
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'falha' and r.retry_count = 1 and length(r.error) = 500
     and r.error_code = 'video_pull_failed' and r.processing_at is null and r.publish_ref = 'pub-7',
    format('7a destino: %s', row_to_json(r));
  assert (select status from workflow_posts where id = v_p) = 'falha_publicacao', '7a post';

  -- 7b o mesmo publish relatado de novo (status do cron + webhook failed): nada muda
  v_ok := mark_target_failed(v_p, 'tiktok', 'de novo', null, true);
  assert not v_ok, '7b segunda falha devolve false';
  assert (select retry_count from post_targets where post_id = v_p and platform = 'tiktok') = 1,
    '7b contagem nao dobra';

  -- 7c não-retentável esgota direto
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  perform mark_target_failed(v_p, 'tiktok', 'spam', 'spam_risk_too_many_posts', false);
  assert (select retry_count from post_targets where post_id = v_p and platform = 'tiktok') = 3,
    '7c retry_count = 3';

  -- 7d falha atrasada não rebaixa um destino publicado
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  perform mark_target_published(v_p, 'tiktok', jsonb_build_object('external_id', 'tt-7d'));
  assert not mark_target_failed(v_p, 'tiktok', 'tarde', null, true), '7d devolve false';
  assert (select status from post_targets where post_id = v_p and platform = 'tiktok') = 'publicado',
    '7d segue publicado';
  assert (select status from workflow_posts where id = v_p) = 'postado', '7d post segue postado';
  raise notice 'PASS p4.7 mark_target_failed';
end $$;
rollback;

-- 8. requeue_target
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record;
begin
  -- 8a TikTok só: falha -> agendado, post volta para agendado
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set publish_ref = 'pub-8a' where post_id = v_p and platform = 'tiktok';
  perform mark_target_failed(v_p, 'tiktok', 'boom', 'x', true);
  assert requeue_target(v_p, 'tiktok'), '8a agiu';
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'agendado' and r.error is null and r.error_code is null and r.publish_ref is null
     and r.processing_at is null and r.retry_count = 1,
    format('8a destino: %s', row_to_json(r));
  assert (select status from workflow_posts where id = v_p) = 'agendado', '8a post agendado';

  -- 8b both com os dois lados em falha: o post segue em falha_publicacao (bug 2)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  perform mark_target_failed(v_p, 'tiktok', 'boom', null, true);
  update workflow_posts set publish_error = 'ig boom' where id = v_p;
  assert requeue_target(v_p, 'tiktok'), '8b agiu';
  assert (select status from post_targets where post_id = v_p and platform = 'tiktok') = 'agendado', '8b destino';
  assert (select status from workflow_posts where id = v_p) = 'falha_publicacao', '8b post segue falha';

  -- 8c recusas silenciosas
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  assert not requeue_target(v_p, 'tiktok'), '8c destino pendente';
  v_p := pg_temp.p4_post(v_wf, 'rascunho', 'tiktok');
  update post_targets set status = 'falha' where post_id = v_p and platform = 'tiktok';
  assert not requeue_target(v_p, 'tiktok'), '8c post fora de publicacao';
  assert (select status from post_targets where post_id = v_p and platform = 'tiktok') = 'falha', '8c intacto';
  assert not requeue_target(-1, 'tiktok'), '8c post inexistente';
  raise notice 'PASS p4.8 requeue_target';
end $$;
rollback;

-- 9. begin_target_publish
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record;
begin
  -- 9a aprovado_cliente + pendente: post vai a agendado, trava o destino
  v_p := pg_temp.p4_post(v_wf, 'aprovado_cliente', 'tiktok');
  update workflow_posts set scheduled_at = null where id = v_p;
  assert begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9a tomou a trava';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '9a post agendado';
  -- now() é o instante da transação: o mesmo que a função gravou
  assert (select scheduled_at from workflow_posts where id = v_p) = now(),
    '9a publicar agora carimba scheduled_at (via record_post_status_change)';
  assert (select processing_at is not null and status = 'pendente'
            from post_targets where post_id = v_p and platform = 'tiktok'), '9a trava setada';
  -- 9b trava fresca: false, nada muda
  update workflow_posts set scheduled_at = now() + interval '1 day' where id = v_p;
  assert not begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9b trava segura';
  assert (select scheduled_at from workflow_posts where id = v_p) = now() + interval '1 day',
    '9b trava segura nao mexe em scheduled_at';
  -- 9c trava velha (> 10 min) é retomada
  update post_targets set processing_at = now() - interval '20 minutes'
   where post_id = v_p and platform = 'tiktok';
  assert begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9c trava velha retomada';

  -- 9d post já agendado (o publicar agora do Instagram rodou antes: bug 1)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  update workflow_posts set scheduled_at = now() + interval '3 days' where id = v_p;
  assert begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9d aceita agendado';
  assert (select scheduled_at from workflow_posts where id = v_p) = now(),
    '9d post ja agendado com data futura: scheduled_at carimbado para agora';
  assert (select status from workflow_posts where id = v_p) = 'agendado', '9d post segue agendado';

  -- 9e destino re-enfileirado (agendado) também é aceito
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'agendado' where post_id = v_p and platform = 'tiktok';
  assert begin_target_publish(v_p, 'tiktok', 'workspace_user'), '9e aceita destino agendado';

  -- 9f recusas
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando' where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_publishing');
  update post_targets set status = 'publicado' where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_published');
  update post_targets set status = 'falha' where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_not_ready');
  v_p := pg_temp.p4_post(v_wf, 'rascunho', 'tiktok');
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'post_not_publishable');
  assert (select status from workflow_posts where id = v_p) = 'rascunho', '9f recusa nao mexe no post';
  v_p := pg_temp.p4_post(v_wf, 'aprovado_cliente', 'other');
  perform pg_temp.p4_expect(format('select begin_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_not_found');
  perform pg_temp.p4_expect('select begin_target_publish(-1, ''tiktok'', ''workspace_user'')',
    'P0404', 'post_not_found');
  raise notice 'PASS p4.9 begin_target_publish';
end $$;
rollback;

-- 10. cancel_target_publish
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; r record;
begin
  -- 10a both agendado com container do IG preparado: TikTok volta a pendente,
  --     campos do IG limpos, post em aprovado_cliente
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'both');
  update workflow_posts set instagram_container_id = 'c1', publish_error = 'e', publish_error_code = 'X'
   where id = v_p;
  update post_targets set status = 'agendado', error = 'velho', publish_ref = 'pub-old'
   where post_id = v_p and platform = 'tiktok';
  perform cancel_target_publish(v_p, 'tiktok', 'workspace_user');
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'pendente' and r.publish_ref is null and r.error is null and r.processing_at is null,
    format('10a destino: %s', row_to_json(r));
  assert (select status = 'aprovado_cliente' and instagram_container_id is null and publish_error is null
                 and publish_error_code is null and publish_processing_at is null
            from workflow_posts where id = v_p), '10a post e campos do IG';

  -- 10b TikTok só: não manda campos do IG (container fica como estava)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update workflow_posts set instagram_container_id = 'nao-mexe' where id = v_p;
  perform cancel_target_publish(v_p, 'tiktok', 'workspace_user');
  assert (select instagram_container_id from workflow_posts where id = v_p) = 'nao-mexe', '10b IG intacto';

  -- 10c recusas
  v_p := pg_temp.p4_post(v_wf, 'aprovado_cliente', 'tiktok');
  perform pg_temp.p4_expect(format('select cancel_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'post_not_scheduled');
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando' where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select cancel_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_publishing');
  update post_targets set status = 'pendente', processing_at = now() where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select cancel_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_publishing');
  update post_targets set status = 'publicado', processing_at = null where post_id = v_p and platform = 'tiktok';
  perform pg_temp.p4_expect(format('select cancel_target_publish(%s, %L, %L)', v_p, 'tiktok', 'workspace_user'),
    'P0422', 'target_published');
  assert (select status from workflow_posts where id = v_p) = 'agendado', '10c recusa nao mexe no post';
  raise notice 'PASS p4.10 cancel_target_publish';
end $$;
rollback;

-- 11. Reset ao sair de publicação (z9) e ACLs
begin;
do $$
declare
  v_wf bigint := pg_temp.p4_workflow();
  v_p bigint; v_q bigint; v_s bigint; r record; f text;
begin
  -- 11a falha velha some quando o post volta para rascunho (bug 3)
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set publish_ref = 'pub-11' where post_id = v_p and platform = 'tiktok';
  perform mark_target_failed(v_p, 'tiktok', 'boom', 'x', false);
  perform record_post_status_change(v_p, 'rascunho', 'workspace_user', null, null, '{}'::jsonb);
  select * into r from post_targets where post_id = v_p and platform = 'tiktok';
  assert r.status = 'pendente' and r.error is null and r.error_code is null
     and r.publish_ref is null and r.retry_count = 0,
    format('11a reset: %s', row_to_json(r));

  -- 11b destino re-enfileirado também volta a pendente (post vai a aprovado_cliente)
  v_q := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'agendado' where post_id = v_q and platform = 'tiktok';
  update workflow_posts set status = 'aprovado_cliente' where id = v_q;
  assert (select status from post_targets where post_id = v_q and platform = 'tiktok') = 'pendente', '11b';

  -- 11c processando e publicado nunca são tocados
  v_s := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'processando', publish_ref = 'pub-11c'
   where post_id = v_s and platform = 'tiktok';
  update workflow_posts set status = 'rascunho' where id = v_s;
  assert (select status = 'processando' and publish_ref = 'pub-11c'
            from post_targets where post_id = v_s and platform = 'tiktok'), '11c processando fica';
  update post_targets set status = 'publicado' where post_id = v_s and platform = 'tiktok';
  update workflow_posts set status = 'revisao_interna' where id = v_s;
  assert (select status from post_targets where post_id = v_s and platform = 'tiktok') = 'publicado', '11c publicado fica';

  -- 11d dentro de publicação nada é resetado
  v_p := pg_temp.p4_post(v_wf, 'agendado', 'tiktok');
  update post_targets set status = 'falha', error = 'fica' where post_id = v_p and platform = 'tiktok';
  update workflow_posts set status = 'falha_publicacao' where id = v_p;
  assert (select error from post_targets where post_id = v_p and platform = 'tiktok') = 'fica', '11d';

  -- 11e ACLs: só service_role executa os writers; o recompute é interno
  foreach f in array array[
    'public.mark_target_published(bigint,text,jsonb,text,uuid)',
    'public.mark_target_failed(bigint,text,text,text,boolean,text,uuid)',
    'public.requeue_target(bigint,text,text,uuid)',
    'public.begin_target_publish(bigint,text,text,uuid)',
    'public.cancel_target_publish(bigint,text,text,uuid)',
    'public.mark_platform_published(bigint,text,text,uuid,jsonb)'
  ] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), format('anon executa %s', f);
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), format('authenticated executa %s', f);
    assert has_function_privilege('service_role', f, 'EXECUTE'), format('service_role sem %s', f);
  end loop;
  f := 'public.recompute_post_publish_status(bigint,text,uuid)';
  assert not has_function_privilege('anon', f, 'EXECUTE'), 'anon executa recompute';
  assert not has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated executa recompute';
  assert not has_function_privilege('anon', 'public.workflow_posts_reset_tiktok_target()', 'EXECUTE'),
    'anon executa a funcao do trigger';
  raise notice 'PASS p4.11 reset z9 e ACLs';
end $$;
rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx supabase db reset
psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/post_targets_publish_state.sql
```

Expected: sections 1-4 pass. Section 5 then fails with `function recompute_post_publish_status(bigint, unknown) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261014000002_post_targets_publish_writers.sql`:

```sql
-- ============================================================
-- P4 (2/3): writers do estado de publicação em post_targets.
-- Spec: docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md
--   §2c (recompute), §2d (writers + mark_platform_published), §2e (reset).
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 2).
--
-- Toda transição do TikTok que muda o status do post passa por aqui, numa
-- transação só: trava o post (FOR UPDATE), escreve o destino, recalcula o
-- status do post via record_post_status_change (eventos e automações seguem).
-- Em P4 os writers só aceitam 'tiktok' (o estado do Instagram segue legado até P5).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ---------- c. recompute ---------------------------------------------------
-- Interno: o chamador já segura a trava do post. Só age em agendado /
-- falha_publicacao; postado nunca rebaixa e os status anteriores são do usuário.
-- Instagram (legado até P5): publicado = instagram_media_id; falha =
-- post em falha_publicacao com publish_error (um retry do IG em voo, com o post
-- de volta em agendado e publish_error ainda setado, conta como em andamento).
-- Presença do Instagram: linha em post_targets OU platform legado instagram/both
-- (platform é derivado dos destinos desde P1; o OR só evita prender um post IG
-- cujo destino faltasse por drift). Geral é ignorado.
CREATE OR REPLACE FUNCTION public.recompute_post_publish_status(
  p_post_id bigint,
  p_source  text,
  p_actor   uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post   public.workflow_posts%ROWTYPE;
  v_states text[] := ARRAY[]::text[];
  v_tt     text;
  v_target text;
BEGIN
  SELECT * INTO v_post FROM public.workflow_posts WHERE id = p_post_id;
  IF NOT FOUND OR v_post.status NOT IN ('agendado','falha_publicacao') THEN
    RETURN NULL;
  END IF;

  SELECT t.status INTO v_tt
    FROM public.post_targets t
   WHERE t.post_id = p_post_id AND t.platform = 'tiktok';
  IF FOUND THEN
    v_states := v_states || v_tt;
  END IF;

  IF v_post.platform IN ('instagram','both')
     OR EXISTS (SELECT 1 FROM public.post_targets t
                 WHERE t.post_id = p_post_id AND t.platform = 'instagram') THEN
    v_states := v_states || CASE
      WHEN v_post.instagram_media_id IS NOT NULL THEN 'publicado'
      WHEN v_post.status = 'falha_publicacao' AND v_post.publish_error IS NOT NULL THEN 'falha'
      ELSE 'em_andamento'
    END;
  END IF;

  IF cardinality(v_states) = 0 THEN
    RETURN NULL;
  END IF;

  v_target := CASE
    WHEN 'falha' = ANY (v_states) THEN 'falha_publicacao'
    WHEN v_states <@ ARRAY['publicado'] THEN 'postado'
    ELSE 'agendado'
  END;

  IF v_target IS DISTINCT FROM v_post.status THEN
    PERFORM public.record_post_status_change(
      p_post_id, v_target, p_source, p_actor, NULL,
      CASE WHEN v_target = 'postado'
           THEN jsonb_build_object('published_at', COALESCE(v_post.published_at, now()))
           ELSE '{}'::jsonb END);
  END IF;
  RETURN v_target;
END $$;
REVOKE ALL ON FUNCTION public.recompute_post_publish_status(bigint, text, uuid) FROM public, anon, authenticated;

-- ---------- d. writers -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_target_published(
  p_post_id  bigint,
  p_platform text,
  p_fields   jsonb DEFAULT '{}'::jsonb,
  p_source   text  DEFAULT 'system',
  p_actor    uuid  DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fields jsonb := COALESCE(p_fields, '{}'::jsonb);
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  PERFORM 1 FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'post_not_found';
  END IF;

  UPDATE public.post_targets SET
    status        = 'publicado',
    external_id   = COALESCE(v_fields->>'external_id', external_id),
    permalink     = COALESCE(v_fields->>'permalink', permalink),
    published_at  = COALESCE(published_at, (v_fields->>'published_at')::timestamptz, now()),
    processing_at = NULL,
    error         = NULL,
    error_code    = NULL,
    updated_at    = now()
  WHERE post_id = p_post_id AND platform = p_platform;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'target_not_found';
  END IF;

  PERFORM public.recompute_post_publish_status(p_post_id, p_source, p_actor);
END $$;
REVOKE ALL ON FUNCTION public.mark_target_published(bigint, text, jsonb, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_target_published(bigint, text, jsonb, text, uuid) TO service_role;

-- Idempotente: uma linha já em falha carrega o publish_ref do publish que falhou
-- (só requeue_target limpa a ref, e só o init seguinte grava uma nova), então
-- "já está em falha" = "este publish já foi contado". publicado nunca rebaixa.
CREATE OR REPLACE FUNCTION public.mark_target_failed(
  p_post_id    bigint,
  p_platform   text,
  p_error      text,
  p_error_code text,
  p_retryable  boolean,
  p_source     text DEFAULT 'system',
  p_actor      uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  PERFORM 1 FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'post_not_found';
  END IF;
  SELECT status INTO v_status FROM public.post_targets
   WHERE post_id = p_post_id AND platform = p_platform FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'target_not_found';
  END IF;
  IF v_status IN ('falha','publicado') THEN
    RETURN false;
  END IF;

  UPDATE public.post_targets SET
    status        = 'falha',
    error         = left(p_error, 500),
    error_code    = p_error_code,
    retry_count   = CASE WHEN p_retryable THEN retry_count + 1 ELSE 3 END,
    processing_at = NULL,
    updated_at    = now()
  WHERE post_id = p_post_id AND platform = p_platform;

  PERFORM public.recompute_post_publish_status(p_post_id, p_source, p_actor);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mark_target_failed(bigint, text, text, text, boolean, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_target_failed(bigint, text, text, text, boolean, text, uuid) TO service_role;

-- Reenvio (manual e fase retry do cron): falha -> agendado, mantém retry_count.
-- O recompute leva o post a agendado, a menos que outro destino siga em falha.
CREATE OR REPLACE FUNCTION public.requeue_target(
  p_post_id  bigint,
  p_platform text,
  p_source   text DEFAULT 'system',
  p_actor    uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_status text;
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  SELECT status INTO v_post_status FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND OR v_post_status NOT IN ('agendado','falha_publicacao') THEN
    RETURN false;
  END IF;

  UPDATE public.post_targets SET
    status        = 'agendado',
    error         = NULL,
    error_code    = NULL,
    publish_ref   = NULL,
    processing_at = NULL,
    updated_at    = now()
  WHERE post_id = p_post_id AND platform = p_platform AND status = 'falha';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM public.recompute_post_publish_status(p_post_id, p_source, p_actor);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.requeue_target(bigint, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_target(bigint, text, text, uuid) TO service_role;

-- Publicar agora: aceita post em aprovado_cliente OU agendado (o publicar agora
-- do Instagram pode ter rodado antes: bug 1) e destino pendente/agendado.
-- false = trava fresca (outro processo publicando). Ao tomar a trava, carimba
-- scheduled_at = now() no post, na mesma transação.
CREATE OR REPLACE FUNCTION public.begin_target_publish(
  p_post_id  bigint,
  p_platform text,
  p_source   text,
  p_actor    uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_status text;
  v_status      text;
  v_lock        timestamptz;
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  SELECT status INTO v_post_status FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'post_not_found';
  END IF;
  SELECT status, processing_at INTO v_status, v_lock FROM public.post_targets
   WHERE post_id = p_post_id AND platform = p_platform FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_not_found';
  END IF;
  IF v_status = 'processando' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_publishing';
  END IF;
  IF v_status = 'publicado' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_published';
  END IF;
  IF v_post_status NOT IN ('aprovado_cliente','agendado') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'post_not_publishable';
  END IF;
  IF v_status NOT IN ('pendente','agendado') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_not_ready';
  END IF;
  IF v_lock IS NOT NULL AND v_lock >= now() - interval '10 minutes' THEN
    RETURN false;
  END IF;

  -- Publicar agora carimba scheduled_at = now(), como o instagram-publish
  -- (handler.ts:225,304,363): se o init falhar e o destino for re-enfileirado, o
  -- claim (scheduled_at <= now(), 20261014000003) o pega no próximo ciclo em vez de
  -- esperar uma data futura ou nula.
  IF v_post_status = 'aprovado_cliente' THEN
    PERFORM public.record_post_status_change(p_post_id, 'agendado', p_source, p_actor, NULL,
      jsonb_build_object('scheduled_at', now()));
  ELSE
    UPDATE public.workflow_posts SET scheduled_at = now() WHERE id = p_post_id;
  END IF;
  UPDATE public.post_targets SET processing_at = now(), updated_at = now()
   WHERE post_id = p_post_id AND platform = p_platform;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.begin_target_publish(bigint, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_target_publish(bigint, text, text, uuid) TO service_role;

-- Cancelar agendamento: só post agendado (regra de hoje). Recusa destino
-- publicando (processando ou trava fresca) e publicado. Para post que também
-- vai ao Instagram, limpa os mesmos campos do IG que o handler limpava
-- (tiktok-publish/handler.ts:330-332).
CREATE OR REPLACE FUNCTION public.cancel_target_publish(
  p_post_id  bigint,
  p_platform text,
  p_source   text,
  p_actor    uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_status text;
  v_status      text;
  v_lock        timestamptz;
  v_fields      jsonb := '{}'::jsonb;
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  SELECT status INTO v_post_status FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'post_not_found';
  END IF;
  IF v_post_status <> 'agendado' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'post_not_scheduled';
  END IF;
  SELECT status, processing_at INTO v_status, v_lock FROM public.post_targets
   WHERE post_id = p_post_id AND platform = p_platform FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_not_found';
  END IF;
  IF v_status = 'processando'
     OR (v_lock IS NOT NULL AND v_lock >= now() - interval '10 minutes') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_publishing';
  END IF;
  IF v_status = 'publicado' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_published';
  END IF;

  UPDATE public.post_targets SET
    status        = 'pendente',
    publish_ref   = NULL,
    error         = NULL,
    error_code    = NULL,
    processing_at = NULL,
    updated_at    = now()
  WHERE post_id = p_post_id AND platform = p_platform;

  IF EXISTS (SELECT 1 FROM public.post_targets
              WHERE post_id = p_post_id AND platform = 'instagram') THEN
    -- NULL::text: jsonb_build_object com NULL sem tipo é "unknown" (ambiguidade
    -- de tipo em alguns contextos); tipado, cada chave vira JSON null.
    v_fields := jsonb_build_object(
      'instagram_container_id', NULL::text,
      'publish_processing_at',  NULL::text,
      'publish_error',          NULL::text,
      'publish_error_code',     NULL::text);
  END IF;
  PERFORM public.record_post_status_change(p_post_id, 'aprovado_cliente', p_source, p_actor, NULL, v_fields);
END $$;
REVOKE ALL ON FUNCTION public.cancel_target_publish(bigint, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_target_publish(bigint, text, text, uuid) TO service_role;

-- ---------- mark_platform_published copiado para frente ---------------------
-- Canônica: 20260807000001_publish_error_code.sql:67-120 (grants refeitos em
-- 20260925000001:53-54). Mudanças marcadas com -- P4:.
--   * ramo TikTok delega a mark_target_published, traduzindo as chaves legadas
--     que os callers de hoje mandam (tiktok_post_id -> external_id,
--     tiktok_post_url -> permalink, published_at passa direto): uma versão
--     antiga de função ainda no ar durante o deploy cai no destino;
--   * ramo Instagram mantém as escritas legadas e chama o recompute no lugar do
--     ig_done/tt_done inline (que lia tiktok_publish_status, agora congelado).
CREATE OR REPLACE FUNCTION public.mark_platform_published(
  p_post_id  bigint,
  p_platform text,
  p_source   text  DEFAULT 'system',
  p_actor    uuid  DEFAULT NULL,
  p_fields   jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$  -- P4: pg_temp
BEGIN
  IF p_platform NOT IN ('instagram','tiktok') THEN
    RAISE EXCEPTION 'mark_platform_published: invalid platform %', p_platform;
  END IF;

  IF p_platform = 'tiktok' THEN  -- P4: delega ao destino
    PERFORM public.mark_target_published(
      p_post_id, 'tiktok',
      jsonb_strip_nulls(jsonb_build_object(
        'external_id',  p_fields->>'tiktok_post_id',
        'permalink',    p_fields->>'tiktok_post_url',
        'published_at', p_fields->>'published_at')),
      p_source, p_actor);
    RETURN;
  END IF;

  PERFORM 1 FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;  -- P4: trava antes do recompute
  UPDATE public.workflow_posts SET
    instagram_media_id    = COALESCE(p_fields->>'instagram_media_id', instagram_media_id),
    instagram_permalink   = COALESCE(p_fields->>'instagram_permalink', instagram_permalink),
    published_at          = COALESCE((p_fields->>'published_at')::timestamptz, published_at),
    publish_processing_at = NULL,
    publish_error         = NULL,
    publish_error_code    = NULL,
    publish_retry_count   = 0
  WHERE id = p_post_id;

  PERFORM public.recompute_post_publish_status(p_post_id, p_source, p_actor);  -- P4: no lugar de ig_done/tt_done
END;
$$;
REVOKE ALL ON FUNCTION public.mark_platform_published(bigint, text, text, uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_platform_published(bigint, text, text, uuid, jsonb) TO service_role;

-- ---------- e. reset ao sair de publicação ----------------------------------
-- Post sai de agendado/falha_publicacao/postado: destino TikTok em falha ou
-- agendado volta a pendente, limpo (bug 3). processando e publicado nunca são
-- tocados: a fase status do cron não filtra o status do post e termina o publish.
-- Sem GUC de recursão: escreve só status/erro em post_targets, e
-- post_targets_sync_platform só dispara em INSERT/DELETE/UPDATE OF platform, post_id.
CREATE OR REPLACE FUNCTION public.workflow_posts_reset_tiktok_target()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status NOT IN ('agendado','falha_publicacao','postado') THEN
    UPDATE public.post_targets SET
      status      = 'pendente',
      error       = NULL,
      error_code  = NULL,
      publish_ref = NULL,
      retry_count = 0,
      updated_at  = now()
    WHERE post_id = NEW.id AND platform = 'tiktok' AND status IN ('falha','agendado');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_reset_tiktok_target() FROM public, anon, authenticated;

-- WHEN obrigatório: record_post_status_change sempre grava status.
CREATE TRIGGER workflow_posts_z9_reset_tiktok_target
  AFTER UPDATE OF status ON public.workflow_posts
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.workflow_posts_reset_tiktok_target();
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx supabase db reset
psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/post_targets_publish_state.sql
```

Expected: `NOTICE: PASS p4.1` through `PASS p4.11`, exit 0.

Do not run `supabase/tests/tiktok_publishing_rpcs.sql` yet. Its case (c) asserts the frozen `tiktok_publish_status`, and Task 3 rewrites it.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014000002_post_targets_publish_writers.sql supabase/tests/post_targets_publish_state.sql
git commit -m "feat(db): TikTok destination writers, recompute and reset trigger (P4 2/3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Destination claim, old claim no-op, reorder and media-replace guards

**Files:**
- Create: `supabase/migrations/20261014000003_tiktok_target_claim.sql`
- Rewrite: `supabase/tests/tiktok_publishing_rpcs.sql` (whole file)
- Modify: `supabase/tests/post_file_link_replace.sql:27` (declare) and `:79-82` (TikTok guard lines)
- Modify: `supabase/tests/entitlements/70_workflow_posts_avulsos.sql`: insert section 8b after section 8 (after line 668); extend section 11 (lines 738-760)
- Modify: `supabase/tests/post_targets_publish_state.sql` (append section 12)
- Test: all four files above

**Interfaces:**
- Consumes:
  - `post_targets.status/processing_at/publish_ref/retry_count` (Task 1);
  - `tiktok_accounts (id, client_id, username, authorization_status)`;
  - `workflow_posts (id, conta_id, cliente_id, tipo, status, scheduled_at, tiktok_caption, ig_caption, tiktok_title, tiktok_settings)`.
- Produces:
  - `public.claim_tiktok_targets_for_publishing(p_phase text, p_limit int DEFAULT 25) RETURNS TABLE (post_id bigint, conta_id uuid, cliente_id bigint, tipo text, scheduled_at timestamptz, caption text, tiktok_title text, tiktok_settings jsonb, tiktok_username text, tiktok_account_id uuid, target_id bigint, publish_ref text, retry_count int)`.
    - Raises `22023 invalid_phase` for anything other than `init|status|retry`.
    - Sets `post_targets.processing_at = now()` on returned rows only.
    - Ordered by `scheduled_at, target_id`. Service_role only.
  - `public.claim_posts_for_tiktok_publishing(text, int)`: same signature and RETURNS TABLE as `20260830000002:147-164`, now returns zero rows.
  - `public.reorder_post_schedules(bigint, uuid, jsonb, text[]) RETURNS jsonb`. Also raises `LOCKED: publishing in progress: {ids}` when a destination of a post is `processando`, or has `processing_at` within 10 minutes. The message format is the one hub-posts already parses.
  - `public.post_file_link_replace(uuid, uuid, bigint, bigint, text) RETURNS boolean`. The TikTok condition now reads the destination.

Latest-definition check (done while writing this plan):
- `claim_posts_for_tiktok_publishing`: `20260720000005` and `20260830000002`. Latest is `20260830000002:139-214`, LANGUAGE sql.
- `reorder_post_schedules`: `20260813000003`, `20260830000002` and `20260923000009`. Latest is `20260923000009:77-218`.
- `post_file_link_replace`: only `20260916000001:32-122`.

- [ ] **Step 1: Rewrite the RPC test for the new claim**

Replace the whole content of `supabase/tests/tiktok_publishing_rpcs.sql` with:

```sql
-- Validação do claim por destino (20261014000003) e da paridade de
-- mark_platform_published copiado para frente (20261014000002). Casos:
--   (a) mark_platform_published('instagram') num post só Instagram -> postado (paridade)
--   (b) both: só o lado IG concluído, destino TikTok pendente -> segue agendado
--   (c) mark_platform_published('tiktok') nesse post -> postado; estado no destino,
--       colunas tiktok_* congeladas
--   (d) claim init: devolve as colunas do contrato; ignora post sem destino TikTok,
--       conta inativa e stories; não deixa trava em linha que não devolve
--   (e) claim do IG (inalterado): pula post both com instagram_media_id
--   (f) claim retry: destino falha + retry_count < 3 + post em agendado/falha_publicacao
--   (g) init: só com data vencida; destino re-enfileirado (agendado) com post em
--       falha_publicacao entra; re-enfileirado com data futura NÃO entra; pendente só
--       com post agendado
--   (h) status: destino processando com publish_ref, sem filtro de status do post
--   (i) ORDER BY scheduled_at
--   (j) o claim antigo devolve zero linhas e não trava nada
--
-- Plano 'pro' (limites folgados para a quantidade de posts da fixture).
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws  uuid;
  v_u   uuid := gen_random_uuid();
  v_cli bigint; v_cli2 bigint;
  v_wf  bigint; v_wf2  bigint;
  v_tt_acct uuid;

  v_post_ig bigint; v_post_both bigint;
  v_post_ig_only bigint; v_post_tt_valid bigint; v_post_tt_inactive bigint; v_post_stories bigint;
  v_post_both_guard_container bigint; v_post_both_guard_publish bigint;
  v_post_both_valid_publish bigint; v_post_both_guard_retry bigint;
  v_retry_valid bigint; v_retry_agendado bigint; v_retry_maxed bigint; v_retry_rascunho bigint;
  v_requeued_falha bigint; v_requeued_future bigint; v_pend_falha bigint; v_pend_future bigint;
  v_status_moved bigint; v_status_noref bigint;
  v_order_late bigint; v_order_early bigint;
  v_old bigint;
  v_order bigint[];
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_u) on conflict do nothing;

  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_u, 'Cliente A', 'CA', '#000') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_u, 'wf', 'ativo') returning id into v_wf;
  insert into instagram_accounts (client_id, instagram_user_id, encrypted_access_token)
    values (v_cli, 'ig_user_1', 'enc_ig');
  insert into tiktok_accounts (client_id, tiktok_open_id, username, authorization_status,
                                encrypted_access_token, encrypted_refresh_token, access_token_expires_at)
    values (v_cli, 'tt_open_1', 'tt_user', 'active', 'enc_tt_a', 'enc_tt_r', now() + interval '1 day')
    returning id into v_tt_acct;

  -- (a) paridade do ramo Instagram
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-ig', 'feed', 'agendado', 'instagram', now() - interval '1 hour')
    returning id into v_post_ig;
  perform mark_platform_published(v_post_ig, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'media_ig_1', 'instagram_permalink', 'https://instagram.com/p/1'));
  assert (select status from workflow_posts where id = v_post_ig) = 'postado', '(a) postado';
  assert (select instagram_media_id from workflow_posts where id = v_post_ig) = 'media_ig_1', '(a) media';
  assert (select publish_processing_at from workflow_posts where id = v_post_ig) is null, '(a) trava IG limpa';

  -- (b) both: IG pronto, TikTok pendente
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-both', 'feed', 'agendado', 'both', now() + interval '1 hour')
    returning id into v_post_both;
  perform mark_platform_published(v_post_both, 'instagram', 'system', null,
    jsonb_build_object('instagram_media_id', 'media_both_1'));
  assert (select status from workflow_posts where id = v_post_both) = 'agendado', '(b) segue agendado';
  assert (select status from post_targets where post_id = v_post_both and platform = 'tiktok') = 'pendente',
    '(b) destino TikTok intacto';

  -- (c) TikTok concluído pelo caminho legado -> postado, estado no destino
  perform mark_platform_published(v_post_both, 'tiktok', 'system', null,
    jsonb_build_object('tiktok_post_id', 'tt_vid_1', 'tiktok_post_url', 'https://tiktok.com/@x/video/1'));
  assert (select status from workflow_posts where id = v_post_both) = 'postado', '(c) postado';
  assert (select status = 'publicado' and external_id = 'tt_vid_1'
                 and permalink = 'https://tiktok.com/@x/video/1'
            from post_targets where post_id = v_post_both and platform = 'tiktok'), '(c) destino publicado';
  assert (select tiktok_publish_status is null and tiktok_post_id is null
            from workflow_posts where id = v_post_both), '(c) colunas tiktok_* congeladas';

  -- (d) init: filtros e contrato de retorno
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-ig-only', 'feed', 'agendado', 'instagram', now() - interval '1 hour')
    returning id into v_post_ig_only;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at, tiktok_caption)
    values (v_wf, v_ws, 'p-tt-valid', 'feed', 'agendado', 'tiktok', now() - interval '1 hour', 'legenda tt')
    returning id into v_post_tt_valid;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-stories', 'stories', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_post_stories;
  insert into clientes (conta_id, user_id, nome, sigla, cor)
    values (v_ws, v_u, 'Cliente B', 'CB', '#111') returning id into v_cli2;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli2, v_u, 'wf2', 'ativo') returning id into v_wf2;
  insert into tiktok_accounts (client_id, tiktok_open_id, username, authorization_status)
    values (v_cli2, 'tt_open_2', 'tt_user_2', 'expired');
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf2, v_ws, 'p-tt-inactive', 'feed', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_post_tt_inactive;

  -- (g) fixtures do init (antes do primeiro claim de init)
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-requeued-falha', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour')
    returning id into v_requeued_falha;
  update post_targets set status = 'agendado' where post_id = v_requeued_falha and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-requeued-future', 'feed', 'agendado', 'tiktok', now() + interval '3 days')
    returning id into v_requeued_future;
  update post_targets set status = 'agendado' where post_id = v_requeued_future and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-pend-falha', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour')
    returning id into v_pend_falha;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-pend-future', 'feed', 'agendado', 'tiktok', now() + interval '3 days')
    returning id into v_pend_future;

  -- (i) ordem: o mais antigo primeiro
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-order-late', 'feed', 'agendado', 'tiktok', now() - interval '5 minutes')
    returning id into v_order_late;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-order-early', 'feed', 'agendado', 'tiktok', now() - interval '5 days')
    returning id into v_order_early;

  -- (j) antes de qualquer claim novo: o antigo não devolve nem trava nada
  assert (select count(*) from claim_posts_for_tiktok_publishing('init', 25)) = 0, '(j) claim antigo vazio';
  assert (select count(*) from claim_posts_for_tiktok_publishing('retry', 25)) = 0, '(j) retry antigo vazio';
  assert (select processing_at from post_targets where post_id = v_post_tt_valid and platform = 'tiktok') is null,
    '(j) claim antigo nao trava';

  create temp table tt_claim_init on commit drop as
    select row_number() over () as rn, c.* from claim_tiktok_targets_for_publishing('init', 25) c;

  assert exists (select 1 from tt_claim_init where post_id = v_post_tt_valid), '(d) post TikTok valido';
  assert not exists (select 1 from tt_claim_init where post_id = v_post_ig_only), '(d) sem destino TikTok';
  assert not exists (select 1 from tt_claim_init where post_id = v_post_stories), '(d) stories';
  assert not exists (select 1 from tt_claim_init where post_id = v_post_tt_inactive), '(d) conta inativa';
  assert (select processing_at from post_targets where post_id = v_post_tt_inactive and platform = 'tiktok') is null,
    '(d) nenhuma trava em linha que o claim nao devolveu';
  assert (select processing_at from post_targets where post_id = v_post_tt_valid and platform = 'tiktok') is not null,
    '(d) trava no destino devolvido';
  assert (select tiktok_publish_processing_at from workflow_posts where id = v_post_tt_valid) is null,
    '(d) coluna legada de trava nao e tocada';
  assert (select conta_id = v_ws and cliente_id = v_cli and tipo = 'feed' and caption = 'legenda tt'
                 and tiktok_account_id = v_tt_acct and tiktok_username = 'tt_user'
                 and publish_ref is null and retry_count = 0
                 and target_id = (select id from post_targets where post_id = v_post_tt_valid and platform = 'tiktok')
            from tt_claim_init where post_id = v_post_tt_valid), '(d) contrato de retorno';

  -- (g)
  assert exists (select 1 from tt_claim_init where post_id = v_requeued_falha),
    '(g) re-enfileirado com post em falha_publicacao';
  assert not exists (select 1 from tt_claim_init where post_id = v_requeued_future),
    '(g) re-enfileirado com data futura fica (spec §2f: scheduled_at <= now())';
  assert (select processing_at from post_targets where post_id = v_requeued_future and platform = 'tiktok') is null,
    '(g) re-enfileirado com data futura nao e travado';
  assert not exists (select 1 from tt_claim_init where post_id = v_pend_falha),
    '(g) pendente com post em falha_publicacao fica';
  assert not exists (select 1 from tt_claim_init where post_id = v_pend_future),
    '(g) pendente com data futura fica';

  -- (i)
  select array_agg(post_id order by rn) into v_order
    from tt_claim_init where post_id in (v_order_early, v_order_late);
  assert v_order = array[v_order_early, v_order_late], format('(i) ordem %s', v_order);
  assert (select max(rn) from tt_claim_init where post_id = v_order_early)
       < (select min(rn) from tt_claim_init where post_id = v_post_tt_valid), '(i) mais antigo antes';

  -- (e) claim do IG inalterado
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id)
    values (v_wf, v_ws, 'p-guard-container', 'feed', 'agendado', 'both', now() - interval '1 hour',
            null, 'already_published_container')
    returning id into v_post_both_guard_container;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id)
    values (v_wf, v_ws, 'p-guard-publish', 'feed', 'agendado', 'both', now() - interval '1 hour',
            'container_x', 'already_published_publish')
    returning id into v_post_both_guard_publish;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_container_id, instagram_media_id, ig_caption)
    values (v_wf, v_ws, 'p-valid-publish', 'feed', 'agendado', 'both', now() - interval '1 hour',
            'container_y', null, 'legenda ig')
    returning id into v_post_both_valid_publish;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at,
                               instagram_media_id, publish_retry_count)
    values (v_wf, v_ws, 'p-guard-retry', 'feed', 'falha_publicacao', 'both', now() - interval '1 hour',
            'already_published_retry', 0)
    returning id into v_post_both_guard_retry;

  create temp table ig_claim_container on commit drop as
    select * from claim_posts_for_publishing('container', 25);
  assert not exists (select 1 from ig_claim_container where post_id = v_post_both_guard_container), '(e) container';
  assert not exists (select 1 from ig_claim_container where post_id = v_post_tt_valid), '(e) TikTok so nunca no IG';
  create temp table ig_claim_publish on commit drop as
    select * from claim_posts_for_publishing('publish', 25);
  assert not exists (select 1 from ig_claim_publish where post_id = v_post_both_guard_publish), '(e) publish';
  assert exists (select 1 from ig_claim_publish where post_id = v_post_both_valid_publish), '(e) controle positivo';
  create temp table ig_claim_retry on commit drop as
    select * from claim_posts_for_publishing('retry', 25);
  assert not exists (select 1 from ig_claim_retry where post_id = v_post_both_guard_retry), '(e) retry';

  -- (f) retry
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-retry-valid', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour')
    returning id into v_retry_valid;
  update post_targets set status = 'falha', retry_count = 1, publish_ref = 'pub-r1'
   where post_id = v_retry_valid and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-retry-agendado', 'feed', 'agendado', 'both', now() - interval '1 hour')
    returning id into v_retry_agendado;
  update post_targets set status = 'falha', retry_count = 1
   where post_id = v_retry_agendado and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-retry-maxed', 'feed', 'falha_publicacao', 'tiktok', now() - interval '1 hour')
    returning id into v_retry_maxed;
  update post_targets set status = 'falha', retry_count = 3
   where post_id = v_retry_maxed and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-retry-rascunho', 'feed', 'rascunho', 'tiktok', now() - interval '1 hour')
    returning id into v_retry_rascunho;
  update post_targets set status = 'falha', retry_count = 1
   where post_id = v_retry_rascunho and platform = 'tiktok';

  create temp table tt_claim_retry on commit drop as
    select * from claim_tiktok_targets_for_publishing('retry', 25);
  assert exists (select 1 from tt_claim_retry where post_id = v_retry_valid and publish_ref = 'pub-r1'
                                                 and retry_count = 1), '(f) falha + falha_publicacao';
  assert exists (select 1 from tt_claim_retry where post_id = v_retry_agendado),
    '(f) falha com post de volta em agendado (flap do IG)';
  assert not exists (select 1 from tt_claim_retry where post_id = v_retry_maxed), '(f) retry_count 3';
  assert not exists (select 1 from tt_claim_retry where post_id = v_retry_rascunho), '(f) post fora de publicacao';

  -- (h) status
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-status-moved', 'feed', 'aprovado_cliente', 'tiktok', now() - interval '1 hour')
    returning id into v_status_moved;
  update post_targets set status = 'processando', publish_ref = 'pub-h1'
   where post_id = v_status_moved and platform = 'tiktok';
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-status-noref', 'feed', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_status_noref;
  update post_targets set status = 'processando' where post_id = v_status_noref and platform = 'tiktok';

  create temp table tt_claim_status on commit drop as
    select * from claim_tiktok_targets_for_publishing('status', 25);
  assert exists (select 1 from tt_claim_status where post_id = v_status_moved and publish_ref = 'pub-h1'),
    '(h) processando com post movido para aprovado_cliente';
  assert not exists (select 1 from tt_claim_status where post_id = v_status_noref), '(h) sem publish_ref';
  -- trava fresca: o mesmo destino não volta no claim seguinte
  assert not exists (select 1 from claim_tiktok_targets_for_publishing('status', 25) c
                      where c.post_id = v_status_moved), '(h) trava fresca segura o destino';

  -- (j) depois de tudo: o claim antigo continua vazio
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform, scheduled_at)
    values (v_wf, v_ws, 'p-old', 'feed', 'agendado', 'tiktok', now() - interval '1 hour')
    returning id into v_old;
  assert (select count(*) from claim_posts_for_tiktok_publishing('init', 25)) = 0, '(j) antigo segue vazio';
  assert (select processing_at from post_targets where post_id = v_old and platform = 'tiktok') is null,
    '(j) antigo nao trava o destino novo';

  raise notice 'tiktok_publishing_rpcs: all cases (a)-(j) passed';
end $$;
rollback;
```

- [ ] **Step 2: Update the media-replace guard test**

In `supabase/tests/post_file_link_replace.sql`, replace line 27:

```sql
  status_value text;
```

with:

```sql
  status_value text;
  edited bigint;
```

Then replace lines 79-82:

```sql
  update workflow_posts set publish_processing_at = null, tiktok_publish_processing_at = now() where id = post_id;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
  update workflow_posts set tiktok_publish_processing_at = null, instagram_container_id = 'prepared-container' where id = post_id;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
```

with:

```sql
  -- P4: a guarda do TikTok lê o destino. 'both' faz o a2 criar o destino TikTok.
  update workflow_posts set publish_processing_at = null, platform = 'both' where id = post_id;
  edited := post_id;
  update post_targets t set processing_at = now() where t.post_id = edited and t.platform = 'tiktok';
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
  update post_targets t set processing_at = null, status = 'processando' where t.post_id = edited and t.platform = 'tiktok';
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
  update post_targets t set status = 'publicado' where t.post_id = edited and t.platform = 'tiktok';
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
  update post_targets t set status = 'pendente' where t.post_id = edited and t.platform = 'tiktok';
  -- As colunas tiktok_* congeladas não bloqueiam mais: o sucesso abaixo roda com elas setadas.
  update workflow_posts set tiktok_publish_processing_at = now(), tiktok_publish_status = 'processing' where id = post_id;
  update workflow_posts set instagram_container_id = 'prepared-container' where id = post_id;
  perform pg_temp.expect_replace_error(ws, uid, link_id, new_file, old_key, 'P0409');
```

Line 83 (`update workflow_posts set instagram_container_id = null where id = post_id;`) and everything after it stay as they are. The success assertion at line 85 now runs with the frozen `tiktok_publish_*` columns set.

- [ ] **Step 3: Add the reorder TikTok guard test (section 8b) and the new claim's ACL**

In `supabase/tests/entitlements/70_workflow_posts_avulsos.sql`, insert after the `rollback;` that closes section 8 (line 668):

```sql

-- =====================================================================
-- 8b. reorder_post_schedules recusa post com destino TikTok publicando
--     (P4, 20261014000003), qualquer que seja o status do post
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_result jsonb; v_raised boolean;
  v_allowed text[] := array['rascunho','revisao_interna','aprovado_interno','enviado_cliente','aprovado_cliente','correcao_cliente'];
  v_updates jsonb;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, status, platform)
    values (v_ws, v_cli, 'avulso-tt', 'aprovado_cliente', 'tiktok') returning id into v_post;
  v_updates := jsonb_build_array(jsonb_build_object('post_id', v_post, 'scheduled_at', now() + interval '2 days'));

  -- processando (post já fora de agendado: o publish segue em voo)
  update post_targets set status = 'processando' where post_id = v_post and platform = 'tiktok';
  v_raised := false;
  begin
    perform reorder_post_schedules(v_cli, v_ws, v_updates, v_allowed);
  exception when others then
    assert sqlerrm = format('LOCKED: publishing in progress: {%s}', v_post), format('mensagem: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'reorder deve recusar destino processando';

  -- trava fresca num destino pendente
  update post_targets set status = 'pendente', processing_at = now() where post_id = v_post and platform = 'tiktok';
  v_raised := false;
  begin
    perform reorder_post_schedules(v_cli, v_ws, v_updates, v_allowed);
  exception when others then v_raised := true;
  end;
  assert v_raised, 'reorder deve recusar trava fresca';

  -- trava velha não segura
  update post_targets set processing_at = now() - interval '20 minutes' where post_id = v_post and platform = 'tiktok';
  select reorder_post_schedules(v_cli, v_ws, v_updates, v_allowed) into v_result;
  assert (v_result->>'updated')::int = 1, format('trava velha nao segura: %s', v_result);

  raise notice 'PASS 70.8b reorder_post_schedules guarda do destino TikTok';
end $$;
rollback;
```

In section 11 (the `do $$ … $$;` at lines 738-760), insert before `raise notice 'PASS 70.11 claim RPCs ACL';`:

```sql
  assert has_function_privilege('anon', 'claim_tiktok_targets_for_publishing(text,int)', 'EXECUTE') = false,
    'anon must not be able to call claim_tiktok_targets_for_publishing';
  assert has_function_privilege('authenticated', 'claim_tiktok_targets_for_publishing(text,int)', 'EXECUTE') = false,
    'authenticated must not be able to call claim_tiktok_targets_for_publishing';
  assert has_function_privilege('service_role', 'claim_tiktok_targets_for_publishing(text,int)', 'EXECUTE') = true,
    'service_role must be able to call claim_tiktok_targets_for_publishing';
```

- [ ] **Step 4: Append section 12 to the publish-state test**

Append to `supabase/tests/post_targets_publish_state.sql`:

```sql

-- 12. Claim por destino: fase inválida recusada; claim antigo vazio
begin;
do $$
begin
  perform pg_temp.p4_expect('select * from claim_tiktok_targets_for_publishing(''bogus'', 5)',
    '22023', 'invalid_phase');
  perform pg_temp.p4_expect('select * from claim_tiktok_targets_for_publishing(null, 5)',
    '22023', 'invalid_phase');
  assert (select count(*) from claim_posts_for_tiktok_publishing('status', 25)) = 0,
    'claim antigo devolve zero linhas';
  raise notice 'PASS p4.12 claim por destino: fase invalida e claim antigo';
end $$;
rollback;
```

- [ ] **Step 5: Run the tests and confirm they fail**

```bash
npx supabase db reset
for f in supabase/tests/tiktok_publishing_rpcs.sql supabase/tests/post_file_link_replace.sql supabase/tests/entitlements/70_workflow_posts_avulsos.sql supabase/tests/post_targets_publish_state.sql; do
  psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f "$f" || echo "FAILED: $f"
done
```

Expected:
- `tiktok_publishing_rpcs.sql` fails at `(j) claim antigo vazio`. The old claim still claims the new fixtures, because it reads `tiktok_publish_status IS NULL`.
- `post_file_link_replace.sql` fails with `Replacement should have failed with P0409`. The destination lock is not checked yet.
- `70_workflow_posts_avulsos.sql` fails at `reorder deve recusar destino processando`.
- `post_targets_publish_state.sql` fails in section 12 inside `pg_temp.p4_expect`, which catches the missing-function error and turns it into an assertion: `assertion failed: esperado 22023/invalid_phase, veio 42883/function claim_tiktok_targets_for_publishing(unknown, integer) does not exist em: select * from claim_tiktok_targets_for_publishing('bogus', 5)`.

- [ ] **Step 6: Write the migration**

Create `supabase/migrations/20261014000003_tiktok_target_claim.sql`:

```sql
-- ============================================================
-- P4 (3/3): claim do TikTok por destino + guardas copiadas para frente.
-- Spec: docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md
--   §2f (claim), §2g (reorder_post_schedules, post_file_link_replace).
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 3).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ---------- f. claim por destino --------------------------------------------
-- init:   data vencida (scheduled_at <= now(), spec §2f) E destino re-enfileirado
--         (agendado) com post em agendado/falha_publicacao, ou destino pendente com
--         post agendado. Um reenvio de publicar-agora tem data vencida porque
--         begin_target_publish carimba scheduled_at = now() (20261014000002).
-- status: destino processando com publish_ref, sem filtro de status do post (um
--         publish em voo termina mesmo se o post foi movido).
-- retry:  destino falha, retry_count < 3, post em agendado/falha_publicacao; o cron
--         chama requeue_target.
-- A conta ativa entra no CTE antes do FOR UPDATE SKIP LOCKED: processing_at só é
-- carimbado em linha devolvida. Trava post e destino (OF wp, t): post_file_link_replace
-- e os writers serializam na linha do post (20260916000001:67-69).
-- Ordem das travas: os rowmarks travam na ordem do FROM, t e depois wp (os writers
-- travam wp e depois t). Se t trava e wp está ocupado, SKIP LOCKED pula a linha do
-- join mas a trava de t FICA até o fim da transação do statement. Isso só é seguro
-- porque o claim roda na própria transação autocommit (uma chamada rpc do cron): ela
-- termina logo, o writer que esperava por t segue, e como SKIP LOCKED nunca espera
-- não há deadlock. NUNCA chame este claim dentro de uma transação mais longa.
CREATE OR REPLACE FUNCTION public.claim_tiktok_targets_for_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id           bigint,
  conta_id          uuid,
  cliente_id        bigint,
  tipo              text,
  scheduled_at      timestamptz,
  caption           text,
  tiktok_title      text,
  tiktok_settings   jsonb,
  tiktok_username   text,
  tiktok_account_id uuid,
  target_id         bigint,
  publish_ref       text,
  retry_count       int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF p_phase IS NULL OR p_phase NOT IN ('init','status','retry') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_phase';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT t.id AS c_target_id, wp.id AS c_post_id, ta.id AS c_account_id, ta.username AS c_username
      FROM public.post_targets t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
      JOIN public.tiktok_accounts ta
        ON ta.client_id = wp.cliente_id AND ta.authorization_status = 'active'
     WHERE t.platform = 'tiktok'
       AND CASE p_phase
         WHEN 'init' THEN
              wp.scheduled_at <= now()
              AND (   (t.status = 'agendado' AND wp.status IN ('agendado','falha_publicacao'))
                   OR (t.status = 'pendente' AND wp.status = 'agendado'))
         WHEN 'status' THEN
              t.status = 'processando' AND t.publish_ref IS NOT NULL
         WHEN 'retry' THEN
              t.status = 'falha' AND t.retry_count < 3
              AND wp.status IN ('agendado','falha_publicacao')
       END
       AND (t.processing_at IS NULL OR t.processing_at < now() - interval '10 minutes')
     ORDER BY wp.scheduled_at, t.id
     LIMIT p_limit
     FOR UPDATE OF wp, t SKIP LOCKED
  ),
  stamped AS (
    UPDATE public.post_targets u
       SET processing_at = now(), updated_at = now()
      FROM candidates c
     WHERE u.id = c.c_target_id
    RETURNING u.id AS s_target_id, u.publish_ref AS s_publish_ref, u.retry_count AS s_retry_count
  )
  SELECT wp.id::bigint,
         wp.conta_id::uuid,
         wp.cliente_id::bigint,
         wp.tipo::text,
         wp.scheduled_at::timestamptz,
         COALESCE(wp.tiktok_caption, wp.ig_caption, '')::text,
         wp.tiktok_title::text,
         wp.tiktok_settings::jsonb,
         c.c_username::text,
         c.c_account_id::uuid,
         s.s_target_id::bigint,
         s.s_publish_ref::text,
         s.s_retry_count::int
    FROM stamped s
    JOIN candidates c ON c.c_target_id = s.s_target_id
    JOIN public.workflow_posts wp ON wp.id = c.c_post_id
   ORDER BY wp.scheduled_at, s.s_target_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_tiktok_targets_for_publishing(text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tiktok_targets_for_publishing(text, int) TO service_role;

-- ---------- claim antigo vira no-op ------------------------------------------
-- Canônica: 20260830000002_avulso_claim_reorder_ica.sql:139-214. Assinatura,
-- nomes de parâmetro, default e RETURNS TABLE idênticos (CREATE OR REPLACE exige);
-- o corpo passa a não devolver nada. Um cron ainda na versão antiga entre a
-- migration e o deploy da função não claima nada, em vez de publicar a partir das
-- colunas congeladas. Um follow-up remove a função.
CREATE OR REPLACE FUNCTION public.claim_posts_for_tiktok_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  tipo text,
  scheduled_at timestamptz,
  caption text,
  tiktok_title text,
  tiktok_settings jsonb,
  tiktok_publish_id text,
  tiktok_publish_retry_count smallint,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  tiktok_account_id uuid,
  tiktok_open_id text,
  tiktok_username text,
  client_id bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$  -- P4: plpgsql no-op
BEGIN
  RETURN;  -- P4: substituído por claim_tiktok_targets_for_publishing
END $$;
REVOKE ALL ON FUNCTION public.claim_posts_for_tiktok_publishing(text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_posts_for_tiktok_publishing(text, int) TO service_role;

-- ---------- g1. reorder_post_schedules copiado para frente --------------------
-- Canônica: 20260923000009_instagram_carousel_children.sql:77-218. Mudanças
-- marcadas com -- P4: search_path com pg_temp e a guarda de destino publicando
-- (processando, ou trava com menos de 10 min, a mesma janela da checagem do IG).
-- Vale para qualquer status do post: um destino processando pode estar num post
-- movido para aprovado_cliente no meio do publish.
CREATE OR REPLACE FUNCTION public.reorder_post_schedules(
  p_cliente_id       bigint,
  p_conta_id         uuid,
  p_updates          jsonb,
  p_allowed_statuses text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp  -- P4: pg_temp
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

  -- P4: um destino publicando (processando ou com trava fresca) segura o post.
  SELECT array_agg(DISTINCT t.post_id) INTO v_locked
  FROM post_targets t
  WHERE t.post_id = ANY(v_ids)
    AND (t.status = 'processando'
         OR (t.processing_at IS NOT NULL
             AND t.processing_at >= now() - interval '10 minutes'));
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

REVOKE ALL ON FUNCTION public.reorder_post_schedules(bigint, uuid, jsonb, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_post_schedules(bigint, uuid, jsonb, text[]) TO service_role;

-- ---------- g2. post_file_link_replace copiado para frente --------------------
-- Canônica: 20260916000001_post_file_link_replace.sql:32-122 (única definição).
-- Única mudança (-- P4:): a condição do TikTok lê o destino em vez das colunas
-- tiktok_* congeladas.
CREATE OR REPLACE FUNCTION public.post_file_link_replace(
  p_conta_id uuid,
  p_user_id uuid,
  p_link_id bigint,
  p_file_id bigint,
  p_expected_r2_key text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_id bigint;
  v_post public.workflow_posts%ROWTYPE;
  v_link public.post_file_links%ROWTYPE;
  v_source public.files%ROWTYPE;
  v_target public.files%ROWTYPE;
BEGIN
  -- p_user_id is the validated JWT subject supplied by the service-role handler.
  -- Recheck both selectors and membership under locks, preventing revocation or
  -- workspace switching between the handler's authentication and the actual swap.
  PERFORM p.id FROM public.profiles p
    JOIN public.workspace_members m ON m.user_id = p.id AND m.workspace_id = p_conta_id
    WHERE p.id = p_user_id AND p.active_workspace_id = p_conta_id
    FOR SHARE OF p, m;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'workspace_unavailable';
  END IF;
  IF p_link_id IS NULL OR p_link_id <= 0 OR p_file_id IS NULL OR p_file_id <= 0 OR
     p_expected_r2_key IS NULL OR btrim(p_expected_r2_key) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0400', MESSAGE = 'invalid_replacement';
  END IF;

  SELECT post_id INTO v_post_id FROM public.post_file_links
    WHERE id = p_link_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  -- Publishers claim/lock this same row before reading media. Serialize with them.
  SELECT * INTO v_post FROM public.workflow_posts
    WHERE id = v_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  SELECT * INTO v_link FROM public.post_file_links
    WHERE id = p_link_id AND post_id = v_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;

  PERFORM id FROM public.files WHERE id IN (v_link.file_id, p_file_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_source FROM public.files WHERE id = v_link.file_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  SELECT * INTO v_target FROM public.files WHERE id = p_file_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  IF v_source.media_lost_at IS NOT NULL OR v_target.media_lost_at IS NOT NULL OR
     v_source.kind NOT IN ('image', 'video') OR v_source.kind <> v_target.kind OR
     v_target.r2_key NOT LIKE 'contas/' || p_conta_id::text || '/files/%' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0400', MESSAGE = 'invalid_replacement';
  END IF;

  -- An uncertain response may be retried after the transaction already committed,
  -- even if the post has since been scheduled. This branch never changes any row.
  IF v_link.file_id = p_file_id THEN RETURN true; END IF;

  IF v_post.status IN ('agendado', 'postado') OR v_post.published_at IS NOT NULL OR
     v_post.instagram_media_id IS NOT NULL OR v_post.publish_processing_at IS NOT NULL OR
     EXISTS (SELECT 1 FROM public.post_targets t                          -- P4: destino TikTok
              WHERE t.post_id = v_post_id AND t.platform = 'tiktok'       -- P4
                AND (t.processing_at IS NOT NULL                          -- P4
                     OR t.status IN ('processando', 'publicado'))) OR     -- P4
     v_post.instagram_container_id IS NOT NULL OR v_post.story_segments IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'post_not_editable';
  END IF;
  IF v_source.r2_key IS DISTINCT FROM p_expected_r2_key THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'source_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.post_file_links WHERE post_id = v_post_id AND file_id = p_file_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'target_already_linked';
  END IF;

  -- Only file_id changes. Cover, ordering and link identity stay intact, while the
  -- UPDATE trigger transfers the reference count. Never garbage-collect the source.
  UPDATE public.post_file_links SET file_id = p_file_id WHERE id = p_link_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.post_file_link_replace(uuid, uuid, bigint, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_file_link_replace(uuid, uuid, bigint, bigint, text)
  TO service_role;
```

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
npx supabase db reset
for f in supabase/tests/tiktok_publishing_rpcs.sql supabase/tests/post_file_link_replace.sql supabase/tests/entitlements/70_workflow_posts_avulsos.sql supabase/tests/post_targets_publish_state.sql supabase/tests/entitlements/99_post_targets.sql supabase/tests/entitlements/99_duplicate_post.sql; do
  psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f "$f" || echo "FAILED: $f"
done
bash scripts/test-entitlements.sh
```

Expected:
- No `FAILED:` line.
- `tiktok_publishing_rpcs: all cases (a)-(j) passed`, `PASS 70.8b`, `PASS 70.11` and `PASS p4.12` are printed.
- `scripts/test-entitlements.sh` exits 0. This is the CI suite, and it also covers the hub reorder wrapper suites.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261014000003_tiktok_target_claim.sql supabase/tests/tiktok_publishing_rpcs.sql supabase/tests/post_file_link_replace.sql supabase/tests/entitlements/70_workflow_posts_avulsos.sql supabase/tests/post_targets_publish_state.sql
git commit -m "feat(db): claim TikTok publishes by destination, copy guards forward (P4 3/3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared utils and cron on destination RPCs

**Files:**
- Modify: `supabase/functions/_shared/tiktok-publish-utils.ts:467-572` (`clearLock`, `markTikTokPublishFailed`) and `:583-682` (`ConfirmAndApplyPublishStatusPost`, `confirmAndApplyPublishStatus`); doc comment at `:303-305`
- Modify: `supabase/functions/tiktok-publish-cron/core.ts:8-12` (module comment), `:71-88` (row type), `:152-165` (`claimPosts`), `:175-407` (three phases)
- Rewrite: `supabase/functions/__tests__/tiktok-publish-cron_test.ts` (whole file)
- Test: `supabase/functions/__tests__/tiktok-publish-cron_test.ts`

**Interfaces:**
- Consumes the RPCs from Tasks 2 and 3:
  - `claim_tiktok_targets_for_publishing(p_phase, p_limit)`;
  - `mark_target_failed(p_post_id, p_platform, p_error, p_error_code, p_retryable, p_source, p_actor) → boolean`;
  - `mark_target_published(p_post_id, p_platform, p_fields, p_source, p_actor)`;
  - `requeue_target(p_post_id, p_platform, p_source, p_actor) → boolean`.
- Produces (`_shared/tiktok-publish-utils.ts`). Task 5 (tiktok-publish) and Task 6 (tiktok-webhook) rely on these exact shapes:
  - `clearLock(svc: SvcClient, targetId: number, now?: () => Date): Promise<void>`: writes `post_targets.update({ processing_at: null, updated_at })` where `id = targetId`.
  - `interface MarkTikTokPublishFailedOpts { failReason?: string; nonRetryable?: boolean; source?: "system" | "workspace_user"; actorId?: string | null }`.
  - `markTikTokPublishFailed(svc: SvcClient, postId: number, message: string, opts?: MarkTikTokPublishFailedOpts): Promise<boolean>`.
    - Calls rpc `mark_target_failed` with keys in this order: `p_post_id, p_platform: "tiktok", p_error: message.slice(0, 500), p_error_code: failReason ?? null, p_retryable, p_source: source ?? "system", p_actor: actorId ?? null`.
    - Resolves `false` on an RPC error (logged) or when the RPC returns `false`. It never throws.
  - `interface ConfirmAndApplyPublishStatusPost { post_id: number; target_id: number; publish_ref: string | null; tiktok_username: string | null; tipo: string | null }`.
  - `confirmAndApplyPublishStatus(deps, post)`: the signature is unchanged; it writes destinations:
    - published: rpc `mark_target_published` with `{ p_post_id, p_platform: "tiktok", p_fields: { external_id?, permalink?, published_at }, p_source: "system", p_actor: null }`;
    - processing: `post_targets.update({ processing_at: null, updated_at })` where `id = target_id`;
    - failed: `markTikTokPublishFailed`.

- [ ] **Step 1: Rewrite the cron test file (failing)**

Replace the whole content of `supabase/functions/__tests__/tiktok-publish-cron_test.ts` with:

```ts
// tiktok-publish-cron (Task B5, P4) — handler.ts's timingSafeEqual auth gate tested in isolation;
// core.ts's business logic tested via DI'd getFreshTikTokToken / tiktokFetch / buildTikTokMediaUrl /
// reportCronFailure against the shared supabaseMock. P4: the cron claims TikTok DESTINATIONS
// (claim_tiktok_targets_for_publishing), writes `post_targets` by target_id, and every transition
// that moves the post's status goes through a SECURITY DEFINER RPC (mark_target_failed,
// mark_target_published, requeue_target). No test here may see a workflow_posts write.
//
// buildTikTokMediaUrl: TikTok's PULL_FROM_URL source needs a TikTok-verifiable URL prefix, which
// raw *.r2.cloudflarestorage.com presigned URLs can't satisfy. Most tests stub it; test (c) uses
// the REAL shared implementation to pin the URL shape TikTok actually receives.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createTikTokPublishCronHandler } from "../tiktok-publish-cron/handler.ts";
import { runTikTokPublishCron, type TikTokPublishCronDeps } from "../tiktok-publish-cron/core.ts";
import { FIELD_PUBLIC_POST_ID, TikTokApiError } from "../_shared/tiktok.ts";
import { buildTikTokMediaUrl, verifyTikTokMediaToken } from "../_shared/tiktok-media-url.ts";

const timingSafeEqual = (a: string, b: string) => a === b;

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-tiktok-publish-cron-key");
Deno.env.set("SUPABASE_URL", "https://supabase.example");
const MEDIA_URL_PREFIX = "https://supabase.example/functions/v1/tiktok-media/m/";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();

type Db = ReturnType<typeof createSupabaseQueryMock>;

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function rpcCalls(db: Db, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

function eqId(call: QueryCall): unknown {
  return call.modifiers.find((m) => m.method === "eq" && m.args[0] === "id")?.args[1];
}

/** No P4 code path writes workflow_posts directly any more. */
function assertNoWorkflowPostWrites(db: Db) {
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0, "no direct workflow_posts write");
  assertEquals(rpcCalls(db, "record_post_status_change").length, 0, "status moves only inside the RPCs");
  assertEquals(rpcCalls(db, "claim_posts_for_tiktok_publishing").length, 0, "the old claim is never called");
}

// Matches claim_tiktok_targets_for_publishing's RETURNS TABLE (20261014000003).
// target_id defaults to 1000 + post_id so assertions can tell the two apart.
function claimedPost(overrides: Partial<Record<string, unknown>> = {}) {
  const postId = (overrides.post_id as number | undefined) ?? 1;
  return {
    post_id: postId,
    conta_id: "conta-1",
    cliente_id: 101,
    tipo: "feed",
    scheduled_at: new Date().toISOString(),
    caption: "legenda",
    tiktok_title: null,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
    tiktok_username: "dktest",
    tiktok_account_id: "acct-1",
    target_id: 1000 + postId,
    publish_ref: null,
    retry_count: 0,
    ...overrides,
  };
}

/** Queues the three claim responses in call order (init, status, retry). */
function queueClaims(db: Db, init: unknown[], status: unknown[], retry: unknown[]) {
  db.queueRpc("claim_tiktok_targets_for_publishing", { data: init, error: null });
  db.queueRpc("claim_tiktok_targets_for_publishing", { data: status, error: null });
  db.queueRpc("claim_tiktok_targets_for_publishing", { data: retry, error: null });
}

function unreachable(label: string) {
  return () => {
    throw new Error(`must not be called: ${label}`);
  };
}

function baseDeps(db: Db, overrides: Partial<TikTokPublishCronDeps> = {}): TikTokPublishCronDeps {
  return {
    svc: db as never,
    getFreshTikTokToken: (unreachable("getFreshTikTokToken") as unknown) as TikTokPublishCronDeps["getFreshTikTokToken"],
    tiktokFetch: (unreachable("tiktokFetch") as unknown) as TikTokPublishCronDeps["tiktokFetch"],
    buildTikTokMediaUrl: (unreachable("buildTikTokMediaUrl") as unknown) as TikTokPublishCronDeps["buildTikTokMediaUrl"],
    reportCronFailure: async () => {},
    now: () => NOW,
    ...overrides,
  };
}

function failedPayload(postId: number, error: string, errorCode: string | null, retryable: boolean) {
  return {
    p_post_id: postId,
    p_platform: "tiktok",
    p_error: error,
    p_error_code: errorCode,
    p_retryable: retryable,
    p_source: "system",
    p_actor: null,
  };
}

// ── (a) auth gate rejects before any DB access ──────────────────────────────────

Deno.test("tiktok-publish-cron: missing x-cron-secret returns 401 before any DB access", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokPublishCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => runTikTokPublishCron(baseDeps(db)),
  });

  const response = await handler(new Request("https://example.test/tiktok-publish-cron"));
  assertEquals(response.status, 401);
  assertEquals(db.calls.length, 0, "no query should run before the secret check");
});

Deno.test("tiktok-publish-cron: wrong x-cron-secret returns 401 before any DB access", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokPublishCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => runTikTokPublishCron(baseDeps(db)),
  });

  const response = await handler(
    new Request("https://example.test/tiktok-publish-cron", { headers: { "x-cron-secret": "errado" } }),
  );
  assertEquals(response.status, 401);
  assertEquals(db.calls.length, 0, "no query should run before the secret check");
});

// ── (b) init phase: per-account cap + token-once-per-account ───────────────────

Deno.test("tiktok-publish-cron init phase: caps at 5 inits per account, releases overflow destination locks", async () => {
  const db = createSupabaseQueryMock();
  const sevenPosts = Array.from({ length: 7 }, (_, i) => claimedPost({ post_id: i + 1 }));
  queueClaims(db, sevenPosts, [], []);

  const tokenCalls: string[] = [];
  const initCalls: string[] = [];

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async (_svc, accountId) => {
      tokenCalls.push(accountId);
      return { accessToken: "tok", openId: "open-1" };
    },
    tiktokFetch: async (path) => {
      initCalls.push(path);
      return { publish_id: `pub-${initCalls.length}` };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "claim_tiktok_targets_for_publishing").map((c) => c.payload), [
    { p_phase: "init", p_limit: 25 },
    { p_phase: "status", p_limit: 25 },
    { p_phase: "retry", p_limit: 10 },
  ]);
  assertEquals(tokenCalls, ["acct-1"], "token must be fetched exactly once for the whole account batch");
  assertEquals(initCalls.length, 5, "only 5 of the 7 claimed posts get an init call this run");

  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 7, "5 init writes + 2 overflow lock releases");

  const overflow = updates.filter((c) => !("status" in (c.payload as Record<string, unknown>)));
  assertEquals(overflow.map((c) => c.payload), [
    { processing_at: null, updated_at: NOW_ISO },
    { processing_at: null, updated_at: NOW_ISO },
  ]);
  assertEquals(overflow.map(eqId), [1006, 1007], "overflow releases the destinations, by target_id");

  const inited = updates.filter((c) => (c.payload as Record<string, unknown>).status === "processando");
  assertEquals(inited.length, 5);
  assertEquals(inited[0].payload, {
    status: "processando",
    publish_ref: "pub-1",
    processing_at: null,
    updated_at: NOW_ISO,
  });
  assertEquals(eqId(inited[0]), 1001);
  assertNoWorkflowPostWrites(db);
});

// ── (c) init phase: payload shape per tipo ──────────────────────────────────────

Deno.test("tiktok-publish-cron init phase: reels hits video/init with a video payload; carrossel hits content/init with a photo payload", async () => {
  const db = createSupabaseQueryMock();
  const videoPost = claimedPost({ post_id: 10, tipo: "reels", caption: "legenda video" });
  const carrosselPost = claimedPost({
    post_id: 11,
    tiktok_account_id: "acct-2",
    tipo: "carrossel",
    caption: "legenda carrossel",
  });
  queueClaims(db, [videoPost, carrosselPost], [], []);

  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (path, init) => {
      calls.push({ path, body: JSON.parse(String(init.body)) });
      return { publish_id: `pub-${calls.length}` };
    },
    buildTikTokMediaUrl,
    fetchPostMedia: async (_db, postId) =>
      postId === 10
        ? [{ id: 1, kind: "video", r2_key: "vid/1.mp4", sort_order: 0 }]
        : [
          { id: 2, kind: "image", r2_key: "img/1.jpg", sort_order: 0 },
          { id: 3, kind: "image", r2_key: "img/2.jpg", sort_order: 1 },
        ],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(calls.length, 2);

  const videoCall = calls.find((c) => c.path === "/post/publish/video/init/");
  assert(videoCall, "video (reels) post must POST to /post/publish/video/init/");
  const videoBody = videoCall!.body as { source_info: Record<string, unknown>; post_info: Record<string, unknown> };
  assertEquals(videoBody.source_info.source, "PULL_FROM_URL");
  const videoUrl = videoBody.source_info.video_url as string;
  assert(videoUrl.startsWith(MEDIA_URL_PREFIX), `video_url must be a tiktok-media proxy URL, got ${videoUrl}`);
  assertEquals(await verifyTikTokMediaToken(videoUrl.slice(MEDIA_URL_PREFIX.length)), "vid/1.mp4");
  assertEquals(videoBody.post_info.title, "legenda video");

  const photoCall = calls.find((c) => c.path === "/post/publish/content/init/");
  assert(photoCall, "carrossel post must POST to /post/publish/content/init/");
  const photoBody = photoCall!.body as {
    media_type: string;
    post_mode: string;
    source_info: Record<string, unknown>;
    post_info: Record<string, unknown>;
  };
  assertEquals(photoBody.media_type, "PHOTO");
  assertEquals(photoBody.post_mode, "DIRECT_POST");
  const photoUrls = photoBody.source_info.photo_images as string[];
  assertEquals(photoUrls.length, 2);
  for (const url of photoUrls) {
    assert(url.startsWith(MEDIA_URL_PREFIX), `photo_images entries must be tiktok-media proxy URLs, got ${url}`);
  }
  assertEquals(
    await Promise.all(photoUrls.map((u) => verifyTikTokMediaToken(u.slice(MEDIA_URL_PREFIX.length)))),
    ["img/1.jpg", "img/2.jpg"],
  );
  assertEquals(photoBody.post_info.description, "legenda carrossel");
});

// ── (d) init phase: precheck, mapped / unmapped errors, token errors ──────────

Deno.test("tiktok-publish-cron init phase: precheck failure -> non-retryable mark_target_failed, no init call", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1, tipo: "reels" })], [], []);

  const fetchPaths: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (path) => {
      fetchPaths.push(path);
      return { publish_id: "pub-1" };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "video", r2_key: "vid/1.mp4", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "cannot_post", code: "spam_risk_too_many_posts" }),
    fetchPrecheckMedia: async () => [{ kind: "video", duration_seconds: 10, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(fetchPaths, [], "a precheck failure must never reach TikTok init");
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(1, "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.", null, false),
  ]);
  assertEquals(callsFor(db, "post_targets", "update").length, 0);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron init phase: creator check runs once per account, with that account's token", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [
    claimedPost({ post_id: 1 }),
    claimedPost({ post_id: 2 }),
    claimedPost({ post_id: 3, tiktok_account_id: "acct-2" }),
  ], [], []);

  const checkedWith: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async (_svc, accountId) => ({ accessToken: `tok-${accountId}`, openId: "open-1" }),
    tiktokFetch: async () => ({ publish_id: "pub-x" }),
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async (_tiktokFetch, accessToken) => {
      checkedWith.push(accessToken);
      return { kind: "skip" };
    },
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(checkedWith, ["tok-acct-1", "tok-acct-2"], "one creator_info call per account, never per post");
  const inited = callsFor(db, "post_targets", "update")
    .filter((c) => (c.payload as Record<string, unknown>).status === "processando");
  assertEquals(inited.map(eqId), [1001, 1002, 1003]);
});

Deno.test("tiktok-publish-cron init phase: mapped TikTok init error -> pt-BR message, non-retryable", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1 })], [], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => {
      throw new TikTokApiError("unaudited", "unaudited_client_can_only_post_to_private_accounts", false);
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(
      1,
      "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
      null,
      false,
    ),
  ]);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron init phase: unmapped init error stays retryable with the raw message", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1, retry_count: 1 })], [], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => {
      throw new Error("network down");
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(1, "network down", null, true),
  ]);
});

Deno.test("tiktok-publish-cron init phase: TOKEN_INVALID from the creator check fails every post of the account, retryable, no init", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1 }), claimedPost({ post_id: 2 })], [], []);

  const fetchPaths: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (path) => {
      fetchPaths.push(path);
      return { publish_id: "pub-x" };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => {
      throw new TikTokApiError("access token invalid", "TOKEN_INVALID", false);
    },
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(fetchPaths, []);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(1, "Erro ao obter token do TikTok: access token invalid", null, true),
    failedPayload(2, "Erro ao obter token do TikTok: access token invalid", null, true),
  ]);
});

// ── (e) status phase: PUBLISH_COMPLETE ──────────────────────────────────────────

Deno.test("tiktok-publish-cron status phase: PUBLISH_COMPLETE with a public id calls mark_target_published with a built permalink", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 30, publish_ref: "pub-30", tiktok_username: "dktest" });
  queueClaims(db, [], [post], []);

  const fetchBodies: unknown[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (_path, init) => {
      fetchBodies.push(JSON.parse(String(init.body)));
      return { status: "PUBLISH_COMPLETE", [FIELD_PUBLIC_POST_ID]: "7301234" };
    },
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  assertEquals(fetchBodies, [{ publish_id: "pub-30" }], "status fetch uses the destination's publish_ref");
  assertEquals(rpcCalls(db, "mark_target_published").map((c) => c.payload), [{
    p_post_id: 30,
    p_platform: "tiktok",
    p_fields: {
      external_id: "7301234",
      permalink: "https://www.tiktok.com/@dktest/photo/7301234",
      published_at: NOW_ISO,
    },
    p_source: "system",
    p_actor: null,
  }]);
  assertEquals(rpcCalls(db, "mark_platform_published").length, 0);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron status phase: a reels post keeps the /video/ URL", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 31, tipo: "reels", publish_ref: "pub-31", tiktok_username: "dktest" });
  queueClaims(db, [], [post], []);
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PUBLISH_COMPLETE", [FIELD_PUBLIC_POST_ID]: "7301235" }),
    buildTikTokMediaUrl: async () => "",
  }));
  assertEquals(response.status, 200);
  const fields = (rpcCalls(db, "mark_target_published")[0].payload as Record<string, unknown>)
    .p_fields as Record<string, unknown>;
  assertEquals(fields.permalink, "https://www.tiktok.com/@dktest/video/7301235");
});

Deno.test("tiktok-publish-cron status phase: PUBLISH_COMPLETE without a public id omits external_id/permalink", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 32, publish_ref: "pub-32", tiktok_username: "dktest" });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PUBLISH_COMPLETE" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const fields = (rpcCalls(db, "mark_target_published")[0].payload as Record<string, unknown>)
    .p_fields as Record<string, unknown>;
  assertEquals(fields, { published_at: NOW_ISO });
});

// ── (f) status phase: still processing ──────────────────────────────────────────

Deno.test("tiktok-publish-cron status phase: still processing only releases the destination lock", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 40, publish_ref: "pub-40" });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PROCESSING_DOWNLOAD" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.map((c) => c.payload), [{ processing_at: null, updated_at: NOW_ISO }]);
  assertEquals(eqId(updates[0]), 1040);
  assertEquals(rpcCalls(db, "mark_target_published").length, 0);
  assertEquals(rpcCalls(db, "mark_target_failed").length, 0);
  assertNoWorkflowPostWrites(db);
});

// ── (g) status phase: FAILED retryable vs non-retryable reasons ────────────────

Deno.test("tiktok-publish-cron status phase: FAILED with video_pull_failed is retryable and carries the reason as error_code", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [claimedPost({ post_id: 50, publish_ref: "pub-50" })], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "video_pull_failed" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(50, "Falha ao publicar no TikTok: video_pull_failed", "video_pull_failed", true),
  ]);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron status phase: FAILED with spam_risk_too_many_posts is non-retryable", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [claimedPost({ post_id: 51, publish_ref: "pub-51" })], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "spam_risk_too_many_posts" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const payload = rpcCalls(db, "mark_target_failed")[0].payload as Record<string, unknown>;
  assertEquals(payload.p_retryable, false, "non-retryable reason exhausts the destination");
  assertEquals(payload.p_error_code, "spam_risk_too_many_posts");
});

Deno.test("tiktok-publish-cron status phase: a destination without publish_ref fails through mark_target_failed", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [claimedPost({ post_id: 52, publish_ref: null })], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: (unreachable("tiktokFetch") as unknown) as TikTokPublishCronDeps["tiktokFetch"],
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(52, "Destino sem publish_id do TikTok para consultar status.", null, true),
  ]);
});

// ── (g2) mark_target_failed RPC error: logged, never thrown, no compensating writes ──

Deno.test("tiktok-publish-cron: a mark_target_failed RPC error does not throw and writes nothing else", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [claimedPost({ post_id: 53, publish_ref: "pub-53" })], []);
  db.queueRpc("mark_target_failed", { data: null, error: { message: "boom" } });

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "video_pull_failed" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200, "must not throw even though the RPC failed");
  assertEquals(rpcCalls(db, "mark_target_failed").length, 1);
  assertEquals(callsFor(db, "post_targets", "update").length, 0, "the stale-lock window re-claims it");
  assertNoWorkflowPostWrites(db);
});

// ── (h) retry phase: requeue_target ─────────────────────────────────────────────

Deno.test("tiktok-publish-cron retry phase: re-queues the destination through requeue_target", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [], [claimedPost({ post_id: 60, retry_count: 1 })]);
  db.queueRpc("requeue_target", { data: true, error: null });

  const response = await runTikTokPublishCron(baseDeps(db));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "requeue_target").map((c) => c.payload), [
    { p_post_id: 60, p_platform: "tiktok", p_source: "system", p_actor: null },
  ]);
  assertEquals(callsFor(db, "post_targets", "update").length, 0);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron retry phase: a declined requeue (post moved away) releases the lock", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [], [claimedPost({ post_id: 61 })]);
  db.queueRpc("requeue_target", { data: false, error: null });

  const response = await runTikTokPublishCron(baseDeps(db));

  assertEquals(response.status, 200);
  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.map((c) => c.payload), [{ processing_at: null, updated_at: NOW_ISO }]);
  assertEquals(eqId(updates[0]), 1061);
});

Deno.test("tiktok-publish-cron retry phase: a requeue_target error releases the lock and is reported", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [], [claimedPost({ post_id: 62 })]);
  db.queueRpc("requeue_target", { data: null, error: { message: "boom" } });

  const failures: unknown[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    reportCronFailure: async (_svc, _name, detail) => {
      failures.push(detail);
    },
  }));

  assertEquals(response.status, 200);
  assertEquals(eqId(callsFor(db, "post_targets", "update")[0]), 1062);
  assertEquals(failures.length, 1, "a failed retry counts toward the cron failure report");
});

// ── (i) outer failure path reports via reportCronFailure ───────────────────────

Deno.test("tiktok-publish-cron: a broken claim query aborts the run and is reported via reportCronFailure", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("claim_tiktok_targets_for_publishing", { data: null, error: { message: "connection reset" } });

  const failureCalls: Array<{ cronName: string; detail: unknown }> = [];

  const response = await runTikTokPublishCron(baseDeps(db, {
    reportCronFailure: async (_svc, cronName, detail) => {
      failureCalls.push({ cronName, detail });
    },
  }));

  assertEquals(response.status, 500);
  assertEquals(failureCalls.length, 1);
  assertEquals(failureCalls[0].cronName, "tiktok-publish-cron");
});

Deno.test("tiktok-publish-cron: no posts claimed in any phase returns 200 without reporting a failure", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [], []);

  const failureCalls: unknown[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    reportCronFailure: async () => {
      failureCalls.push(1);
    },
  }));

  assertEquals(response.status, 200);
  assertEquals(failureCalls.length, 0);
  assertNoWorkflowPostWrites(db);
});
```

- [ ] **Step 2: Run the cron test and confirm it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish-cron_test.ts
```

Expected: FAIL. The auth tests pass, and every phase test fails. For example, the first init test fails with `Expected [{"p_phase":"init","p_limit":25},…] but received []`, because the cron still calls `claim_posts_for_tiktok_publishing`.

- [ ] **Step 3: Rewrite the three helpers in `_shared/tiktok-publish-utils.ts`**

Replace lines 467-479 (`clearLock`) with:

```ts
/** Releases a TikTok destination's `processing_at` lock WITHOUT touching its status — used by
 * tiktok-publish-cron when a claimed destination is deferred (per-account overflow) or when
 * requeue_target declines (the post left publication), so the next claim can pick it back up. */
export async function clearLock(
  svc: SvcClient,
  targetId: number,
  now: () => Date = () => new Date(),
): Promise<void> {
  const { error } = await svc
    .from("post_targets")
    .update({ processing_at: null, updated_at: now().toISOString() })
    .eq("id", targetId);
  if (error) {
    console.error(`[tiktok-publish] failed to clear lock for target ${targetId}:`, error.message);
  }
}
```

Replace lines 481-572 (the `markTikTokPublishFailed` doc comment and function) with:

```ts
export interface MarkTikTokPublishFailedOpts {
  /** TikTok wire fail_reason; persisted as post_targets.error_code. A reason outside
   * RETRYABLE_FAIL_REASONS exhausts the destination (retry_count = 3). */
  failReason?: string;
  /** Precheck failures and mapped (curated pt-BR) errors: exhaust immediately (spec A10). */
  nonRetryable?: boolean;
  source?: "system" | "workspace_user";
  actorId?: string | null;
}

/**
 * Marks the post's TikTok destination failed through mark_target_failed (P4): the destination
 * write, the retry count and the post status recompute (-> falha_publicacao) happen in ONE
 * transaction, so the old two-write compensation dance is gone. The RPC is idempotent: a
 * destination already in `falha` (the same publish reported by both the cron's status phase and
 * a webhook) or already `publicado` is left alone and the call resolves `false`.
 *
 * Never throws. An RPC error is logged and resolves `false`; the destination keeps its claim
 * lock, so the claim's 10-minute stale window hands it back to the same phase.
 */
export async function markTikTokPublishFailed(
  svc: SvcClient,
  postId: number,
  message: string,
  opts?: MarkTikTokPublishFailedOpts,
): Promise<boolean> {
  const nonRetryable = opts?.nonRetryable === true ||
    (opts?.failReason !== undefined && !RETRYABLE_FAIL_REASONS.includes(opts.failReason));

  const { data, error } = await svc.rpc("mark_target_failed", {
    p_post_id: postId,
    p_platform: "tiktok",
    p_error: message.slice(0, 500),
    p_error_code: opts?.failReason ?? null,
    p_retryable: !nonRetryable,
    p_source: opts?.source ?? "system",
    p_actor: opts?.actorId ?? null,
  });
  if (error) {
    console.error(`[tiktok-publish] mark_target_failed failed for post ${postId}:`, error.message);
    return false;
  }
  return data === true;
}
```

Replace lines 583-589 (`ConfirmAndApplyPublishStatusPost`) with:

```ts
export interface ConfirmAndApplyPublishStatusPost {
  post_id: number;
  /** post_targets.id of the TikTok destination (the lock the caller holds). */
  target_id: number;
  /** TikTok's temporary publish_id, stored on the destination. */
  publish_ref: string | null;
  tiktok_username: string | null;
  tipo: string | null;
}
```

In the doc comment above `confirmAndApplyPublishStatus` (lines 602-623):
- replace every `tiktok_publish_processing_at` with `post_targets.processing_at`;
- replace `mark_platform_published` with `mark_target_published`;
- replace `markTikTokPublishFailed's update` with `mark_target_failed`.

Then replace the function body (lines 624-682) with:

```ts
export async function confirmAndApplyPublishStatus(
  deps: ConfirmAndApplyPublishStatusDeps,
  post: ConfirmAndApplyPublishStatusPost,
): Promise<ConfirmAndApplyPublishStatusOutcome> {
  const { svc, tiktokFetch, accessToken } = deps;
  const now = deps.now ?? (() => new Date());

  try {
    if (!post.publish_ref) {
      throw new Error("Destino sem publish_id do TikTok para consultar status.");
    }

    const statusData = await tiktokFetch("/post/publish/status/fetch/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({ publish_id: post.publish_ref }),
    });
    const result = mapStatusFetch(statusData);

    if (result.state === "published") {
      const permalink = result.publicPostId && post.tiktok_username
        ? buildTikTokPostUrl(post.tiktok_username, result.publicPostId, post.tipo)
        : undefined;

      const { error: markErr } = await svc.rpc("mark_target_published", {
        p_post_id: post.post_id,
        p_platform: "tiktok",
        p_fields: {
          ...(result.publicPostId ? { external_id: result.publicPostId } : {}),
          ...(permalink ? { permalink } : {}),
          published_at: now().toISOString(),
        },
        p_source: "system",
        p_actor: null,
      });
      if (markErr) throw new Error(`mark_target_published falhou: ${markErr.message}`);
      return "published";
    }

    if (result.state === "processing") {
      const { error: updErr } = await svc
        .from("post_targets")
        .update({ processing_at: null, updated_at: now().toISOString() })
        .eq("id", post.target_id);
      if (updErr) throw new Error(`Falha ao liberar a trava do destino TikTok: ${updErr.message}`);
      return "processing";
    }

    const failReason = result.failReason;
    const message = failReason
      ? `Falha ao publicar no TikTok: ${failReason}`
      : "Falha ao publicar no TikTok.";
    await markTikTokPublishFailed(svc, post.post_id, message, { failReason });
    return "failed";
  } catch (err) {
    await markTikTokPublishFailed(svc, post.post_id, errorMessage(err));
    return "failed";
  }
}
```

Replace the first doc-comment line at line 303:

```ts
/** Subset of claim_posts_for_tiktok_publishing's row shape needed to build an init payload.
```

with:

```ts
/** Subset of claim_tiktok_targets_for_publishing's row shape needed to build an init payload.
```

- [ ] **Step 4: Move the cron to the destination claim**

In `supabase/functions/tiktok-publish-cron/core.ts`, replace lines 8-12 of the module comment:

```ts
// Three phases via claim_posts_for_tiktok_publishing (init/status/retry). Every claimed post's
// tiktok_publish_processing_at lock is cleared on EVERY exit path — success, deferred
// (per-account overflow), or failure — so nothing outlives the RPC's 10-minute
// stale-reclaim window by leaning on it. markTikTokPublishFailed and the plain workflow_posts
// updates used elsewhere in this file all clear the lock explicitly as part of their write.
```

with:

```ts
// Three phases via claim_tiktok_targets_for_publishing (init/status/retry; P4: the claim is per
// TikTok DESTINATION, post_targets). Every claimed destination's processing_at lock is cleared on
// every normal exit path: init success (processando + publish_ref), deferral (clearLock), failure
// (mark_target_failed), status (mark_target_published or a lock release) and retry
// (requeue_target, or clearLock when it declines). Every transition that moves the post's status
// runs inside one of those SECURITY DEFINER RPCs, never as a direct workflow_posts write.
```

Replace lines 71-88 (`interface ClaimedTikTokCronPost`) with:

```ts
/** Row of claim_tiktok_targets_for_publishing (20261014000003). */
interface ClaimedTikTokCronPost {
  post_id: number;
  conta_id: string;
  cliente_id: number;
  tipo: string;
  scheduled_at: string | null;
  caption: string;
  tiktok_title: string | null;
  tiktok_settings: TikTokSettings | null;
  tiktok_username: string | null;
  tiktok_account_id: string;
  target_id: number;
  publish_ref: string | null;
  retry_count: number;
}
```

Replace lines 152-165 (`claimPosts`) with:

```ts
async function claimPosts(
  svc: DbClient,
  phase: "init" | "status" | "retry",
  limit: number,
): Promise<ClaimedTikTokCronPost[]> {
  const { data, error } = await svc.rpc("claim_tiktok_targets_for_publishing", {
    p_phase: phase,
    p_limit: limit,
  });
  if (error) {
    throw new Error(`claim_tiktok_targets_for_publishing(${phase}) failed: ${error.message}`);
  }
  return (data ?? []) as ClaimedTikTokCronPost[];
}
```

Replace lines 175-407 (`processInitPhase`, the status-phase comment, `processStatusPhase`, the retry-phase comment and `processRetryPhase`) with:

```ts
async function processInitPhase(
  deps: TikTokPublishCronDeps,
  posts: ClaimedTikTokCronPost[],
): Promise<PhaseResult> {
  const { svc, getFreshTikTokToken, tiktokFetch, buildTikTokMediaUrl } = deps;
  const now = deps.now ?? (() => new Date());
  const fetchPostMedia = deps.fetchPostMedia ?? realFetchPostMedia;
  const fetchCreatorCheck = deps.fetchCreatorCheck ?? realFetchCreatorCheck;
  const fetchPrecheckMedia = deps.fetchPrecheckMedia ?? realFetchPrecheckMedia;

  let succeeded = 0;
  let failed = 0;

  for (const [accountId, accountPosts] of groupByAccount(posts)) {
    const toProcess = accountPosts.slice(0, MAX_INIT_PER_ACCOUNT);
    const overflow = accountPosts.slice(MAX_INIT_PER_ACCOUNT);

    // Overflow beyond the per-account cap: release the destination lock untouched so the next
    // run's init claim picks it straight back up — not a failure.
    for (const post of overflow) {
      await clearLock(svc, post.target_id, now);
    }

    let accessToken: string;
    try {
      const token = await getFreshTikTokToken(svc, accountId);
      accessToken = token.accessToken;
    } catch (err) {
      const message = tokenErrorMessage(err);
      for (const post of toProcess) {
        await markTikTokPublishFailed(svc, post.post_id, message);
        failed++;
      }
      continue;
    }

    // One creator_info call per account per run (same invariant as the token fetch above).
    let creator: CreatorCheck;
    try {
      creator = await fetchCreatorCheck(tiktokFetch, accessToken);
    } catch (err) {
      // TOKEN_INVALID / REVOKED rethrown by fetchCreatorCheck: same treatment as the
      // getFreshTikTokToken catch above (spec A10): tokenErrorMessage, retryable (+1).
      const message = tokenErrorMessage(err);
      for (const post of toProcess) {
        await markTikTokPublishFailed(svc, post.post_id, message);
        failed++;
      }
      continue;
    }

    for (const post of toProcess) {
      try {
        const precheckMedia = await fetchPrecheckMedia(svc, post.post_id);
        const precheckFailure = evaluateTikTokPrecheck({
          tipo: post.tipo,
          settings: post.tiktok_settings,
          media: precheckMedia,
          creator,
        });
        if (precheckFailure) {
          await markTikTokPublishFailed(svc, post.post_id, precheckFailure, { nonRetryable: true });
          failed++;
          continue;
        }

        const media = await fetchPostMedia(svc, post.post_id);
        const claimedForBuilder: ClaimedTikTokPost = {
          tipo: post.tipo,
          caption: post.caption,
          tiktok_title: post.tiktok_title,
          tiktok_settings: post.tiktok_settings ?? {},
        };

        let initPath: string;
        let initPayload: object;
        if (post.tipo === "reels") {
          const videoFile = media.find((f) => f.kind === "video");
          if (!videoFile) throw new Error("Post de vídeo sem arquivo de vídeo vinculado.");
          const videoUrl = await buildTikTokMediaUrl(videoFile.r2_key, 7200);
          initPath = "/post/publish/video/init/";
          initPayload = buildVideoInitPayload(claimedForBuilder, videoUrl);
        } else {
          if (media.length === 0) throw new Error("Post sem arquivos de mídia vinculados.");
          const imageUrls = await Promise.all(media.map((f) => buildTikTokMediaUrl(f.r2_key, 7200)));
          initPath = "/post/publish/content/init/";
          initPayload = buildPhotoInitPayload(claimedForBuilder, imageUrls);
        }

        const initResult = (await tiktokFetch(initPath, {
          method: "POST",
          accessToken,
          body: JSON.stringify(initPayload),
        })) as { publish_id?: string };
        const publishId = initResult?.publish_id;
        if (!publishId) throw new Error("TikTok não retornou publish_id na inicialização.");

        // Single-statement destination write (spec §2d): the post's status does not change here.
        const { error: updErr } = await svc
          .from("post_targets")
          .update({
            status: "processando",
            publish_ref: publishId,
            processing_at: null,
            updated_at: now().toISOString(),
          })
          .eq("id", post.target_id);
        if (updErr) throw new Error(`Falha ao salvar publish_id do TikTok: ${updErr.message}`);

        succeeded++;
        console.log(`[${CRON_NAME}] Init: post ${post.post_id} -> publish_id ${publishId}`);
      } catch (err) {
        const code = err instanceof TikTokApiError ? err.code : undefined;
        const mapped = tiktokErrorMessage(code);
        await markTikTokPublishFailed(
          svc,
          post.post_id,
          mapped ?? errorMessage(err),
          mapped ? { nonRetryable: true } : undefined,
        );
        failed++;
      }
    }
  }

  return { succeeded, failed };
}

// --- Phase 2: status ---
//
// Per-destination "confirm via status fetch, then apply" is confirmAndApplyPublishStatus
// (_shared/tiktok-publish-utils.ts), shared with tiktok-webhook. This phase still owns getting
// one fresh access token per account and passes it into the shared function. The claim does not
// filter on the post's status: a publish in flight finishes even after the post was moved.

async function processStatusPhase(
  deps: TikTokPublishCronDeps,
  posts: ClaimedTikTokCronPost[],
): Promise<PhaseResult> {
  const { svc, getFreshTikTokToken, tiktokFetch } = deps;
  const now = deps.now ?? (() => new Date());

  let succeeded = 0;
  let failed = 0;

  for (const [accountId, accountPosts] of groupByAccount(posts)) {
    let accessToken: string;
    try {
      const token = await getFreshTikTokToken(svc, accountId);
      accessToken = token.accessToken;
    } catch (err) {
      const message = tokenErrorMessage(err);
      for (const post of accountPosts) {
        await markTikTokPublishFailed(svc, post.post_id, message);
        failed++;
      }
      continue;
    }

    for (const post of accountPosts) {
      const outcome = await confirmAndApplyPublishStatus(
        { svc, tiktokFetch, accessToken, now },
        {
          post_id: post.post_id,
          target_id: post.target_id,
          publish_ref: post.publish_ref,
          tiktok_username: post.tiktok_username,
          tipo: post.tipo,
        },
      );
      if (outcome === "failed") {
        failed++;
      } else {
        succeeded++;
        console.log(`[${CRON_NAME}] status ${outcome} for post ${post.post_id}`);
      }
    }
  }

  return { succeeded, failed };
}

// --- Phase 3: retry ---
//
// Purely a state reset — no TikTok API calls here. requeue_target moves the destination from
// `falha` to `agendado` (clearing error and publish_ref, keeping retry_count) and recomputes the
// post's status in the same transaction; the NEXT run's init phase publishes it with a fresh
// media URL. It declines (false) when the post left publication meanwhile — the destination lock
// is then released so it doesn't sit locked for the stale window.

async function processRetryPhase(
  deps: TikTokPublishCronDeps,
  posts: ClaimedTikTokCronPost[],
): Promise<PhaseResult> {
  const { svc } = deps;
  const now = deps.now ?? (() => new Date());
  let succeeded = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      const { data: acted, error: rpcErr } = await svc.rpc("requeue_target", {
        p_post_id: post.post_id,
        p_platform: "tiktok",
        p_source: "system",
        p_actor: null,
      });
      if (rpcErr) throw new Error(`requeue_target falhou: ${rpcErr.message}`);
      if (acted === true) {
        succeeded++;
      } else {
        console.log(`[${CRON_NAME}] retry: post ${post.post_id} left publication, lock released`);
        await clearLock(svc, post.target_id, now);
      }
    } catch (err) {
      console.error(`[${CRON_NAME}] retry failed for post ${post.post_id}:`, errorMessage(err));
      await clearLock(svc, post.target_id, now);
      failed++;
    }
  }

  return { succeeded, failed };
}
```

- [ ] **Step 5: Run the cron test and the type gate and confirm they pass**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish-cron_test.ts
npm run check:functions
```

Expected:
- The cron test file passes every test.
- `check:functions` reports type errors only in `tiktok-publish/handler.ts` and `tiktok-webhook/handler.ts`. They still call `markTikTokPublishFailed` with the old 5-argument shape, or read `tiktok_publish_id` on `ConfirmAndApplyPublishStatusPost`. Tasks 5 and 6 fix them, and no other file may error.

Afterwards run `git checkout deno.lock`. Deno runs with `--node-modules-dir=auto` can rewrite `node_modules` (memory `project_deno_npm_node_modules_gotcha`), so before any later npm, vitest, lint or prettier command in this worktree, run `ls node_modules/.deno 2>/dev/null && npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/tiktok-publish-utils.ts supabase/functions/tiktok-publish-cron/core.ts supabase/functions/__tests__/tiktok-publish-cron_test.ts
git commit -m "feat(tiktok): cron claims and writes TikTok destinations (P4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `tiktok-publish` handler on destination RPCs

**Files:**
- Modify: `supabase/functions/tiktok-publish/handler.ts`:
  - `:27-36` (imports);
  - `:75-79` (constants and helpers);
  - `:199-206` (post select);
  - `:222-300` (target lookup, schedule refusal, and skipping the TikTok validator when TikTok is already published);
  - `:309-571` (cancel, retry, publish-now).
- Modify: `supabase/functions/__tests__/tiktok-publish_test.ts`:
  - `:44-58` (`basePost`);
  - insert after `:354` (new schedule tests);
  - replace `:371-526` (retry and cancel sections);
  - replace `:634-930` (publish-now section).
- Test: `supabase/functions/__tests__/tiktok-publish_test.ts`

**Interfaces:**
- Consumes:
  - from Task 4: `markTikTokPublishFailed(svc, postId, message, opts?: { failReason?, nonRetryable?, source?, actorId? }): Promise<boolean>`;
  - from Task 2: rpc `begin_target_publish`, `cancel_target_publish`, `requeue_target` and `mark_target_published`, with the P0422 identifiers.
- Produces (HTTP contract; the CRM's `ScheduleButton` and services call these):
  - the existing routes and success bodies are unchanged: schedule `{ ok, status: "agendado" }`, cancel `{ ok, status: "aprovado_cliente" }`, retry `{ ok, status: "agendado" }`, publish-now `{ ok, status: "postado" }` or `{ ok, status: "agendado", message }`;
    - pre-existing and kept: publish-now on a `both` post whose Instagram side is still pending answers `{ ok, status: "postado" }` once TikTok lands, although the recompute leaves the post `agendado` until Instagram publishes. The body describes the TikTok side, not the post. The CRM ignores this body's `status` for TikTok and refetches through `onStatusChange()` (`ScheduleButton.tsx:296-331`), so it shows the real post status. Not changed in P4;
    - the retry body stays `{ ok, status: "agendado" }` even when a `both` post stays in `falha_publicacao` because Instagram still failed (same reason);
  - changed: schedule refuses with `target_published` only when the TikTok destination is `publicado` AND nothing else is left to publish (TikTok-only post, or Instagram already published). A `both` post with Instagram pending schedules normally, validating Instagram only. `processando` always refuses (Deviation 18);
  - new: publish-now while the destination lock is held returns `409 { error: "Já está publicando no TikTok." }`;
  - new: P0422 refusals return `422 { error: <pt-BR> }` from `TARGET_REFUSALS`.

- [ ] **Step 1: Update the test fixtures and add the schedule refusal tests (failing)**

In `supabase/functions/__tests__/tiktok-publish_test.ts`, replace `basePost` (lines 44-58) with:

```ts
/** The TikTok destination embed (targets_state:post_targets(id, platform, status, processing_at)). */
function ttTarget(status = "pendente", extra: Record<string, unknown> = {}) {
  return [{ id: 501, platform: "tiktok", status, processing_at: null, ...extra }];
}

function basePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "aprovado_cliente",
    platform: "tiktok",
    tipo: "feed",
    tiktok_caption: "legenda tiktok",
    tiktok_title: null,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
    ig_caption: null,
    targets_state: ttTarget(),
    ...overrides,
  };
}

/** No P4 path writes workflow_posts' status or tiktok_* columns directly. */
function assertNoLegacyTikTokWrites(db: ReturnType<typeof createSupabaseQueryMock>) {
  for (const c of callsFor(db, "workflow_posts", "update")) {
    const keys = Object.keys(c.payload as Record<string, unknown>);
    assert(!keys.some((k) => k.startsWith("tiktok_")), `legacy tiktok_* write: ${keys.join(",")}`);
    assert(!keys.includes("status"), "status must move only inside the RPCs");
  }
  assertEquals(rpcCalls(db, "record_post_status_change").length, 0, "status moves only inside the RPCs");
  assertEquals(rpcCalls(db, "mark_platform_published").length, 0, "the legacy writer is not called");
}
```

After the `IG-only post -> 400` schedule test (ends at line 354), insert:

```ts
Deno.test("tiktok-publish: the post select embeds the TikTok destination, not the frozen columns", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "instagram" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db));
  await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const select = String(callsFor(db, "workflow_posts", "select")[0].selectArgs[0][0]);
  assert(select.includes("targets_state:post_targets(id, platform, status, processing_at)"), select);
  assert(!select.includes("tiktok_publish_"), select);
});

// processando always refuses; publicado refuses only when nothing else is left to publish
// (TikTok-only, or Instagram already published). See the `both` + publicado tests below.
for (const [platform, status, extra, message] of [
  ["tiktok", "processando", {}, "Já está publicando no TikTok."],
  ["both", "processando", {}, "Já está publicando no TikTok."],
  ["tiktok", "publicado", {}, "Já publicado no TikTok."],
  ["both", "publicado", { instagram_media_id: "ig-media-1" }, "Já publicado no TikTok."],
] as const) {
  Deno.test(`tiktok-publish schedule: ${platform} post, destination ${status}${"instagram_media_id" in extra ? ", Instagram published" : ""} -> 422, nothing written`, async () => {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("workflow_posts", "select", {
      data: basePost({ platform, targets_state: ttTarget(status), ...extra }),
      error: null,
    });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);

    const handler = createPublishHandler(makeDeps(db, {
      validateForTikTokScheduling: (() => {
        throw new Error("must not validate");
      }) as never,
    }));
    const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
    assertEquals(res.status, 422);
    assertEquals(await res.json(), { error: message });
    assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
    assertEquals(rpcCalls(db, "record_post_status_change").length, 0);
  });
}

Deno.test("tiktok-publish schedule: `both` post, TikTok publicado, Instagram pending -> schedules for Instagram only", async () => {
  // The post went back to draft mid-publish after TikTok landed. Scheduling it again is how
  // Instagram goes out: init never re-claims a publicado destination, and the recompute
  // reaches postado when Instagram lands.
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({
      platform: "both",
      instagram_media_id: null,
      targets_state: [...ttTarget("publicado"), { id: 502, platform: "instagram", status: "pendente", processing_at: null }],
    }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null }); // scheduled_at write
  db.queueRpc("record_post_status_change", { data: null, error: null });

  let tiktokCalled = 0;
  let igCalled = 0;
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => {
      tiktokCalled++;
      return Promise.resolve(okTikTokValidation());
    }) as never,
    validateForScheduling: (() => {
      igCalled++;
      return Promise.resolve({ ok: true, errors: [] } as ScheduleValidationResult);
    }) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "agendado" });
  assertEquals(tiktokCalled, 0); // TikTok already published: nothing left to validate there
  assertEquals(igCalled, 1);
  const rpc = rpcCalls(db, "record_post_status_change");
  assertEquals(rpc.length, 1);
  assertEquals((rpc[0].payload as Record<string, unknown>).p_new_status, "agendado");
});

Deno.test("tiktok-publish schedule: `both` post, TikTok publicado, Instagram validation fails -> 422 with IG details only", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", targets_state: ttTarget("publicado"), scheduled_at: "2025-01-01T00:00:00Z" }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null }); // candidate write
  db.queue("workflow_posts", "update", { data: null, error: null }); // restore write

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => {
      throw new Error("must not validate TikTok");
    }) as never,
    validateForScheduling: (() =>
      Promise.resolve({ ok: false, errors: ["Legenda do Instagram não definida."] } as ScheduleValidationResult)) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Validação falhou", details: ["Legenda do Instagram não definida."] });
  assertEquals(rpcCalls(db, "record_post_status_change").length, 0);
});
```

Replace lines 371-526 (the `retry` and `cancel` sections, from the `// retry` banner through the end of the last cancel test) with:

```ts
// ============================================================
// retry
// ============================================================

Deno.test("tiktok-publish retry: succeeds with both feature flags OFF (retry is ungated) and re-queues the destination", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "tiktok", status: "falha_publicacao", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_post_scheduling OFF
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_tiktok OFF
  db.queueRpc("requeue_target", { data: true, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "agendado" });
  assertEquals(db.calls.filter((c: QueryCall) => c.table === "rpc:effective_plan_feature").length, 0);
  assertEquals(rpcCalls(db, "requeue_target").map((c) => c.payload), [
    { p_post_id: 1, p_platform: "tiktok", p_source: "workspace_user", p_actor: "actor-1" },
  ]);
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish retry: `both` post already back at agendado (IG retried first) still re-queues TikTok (bug 2)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", status: "agendado", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("requeue_target", { data: true, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 200);
  assertEquals(rpcCalls(db, "requeue_target").length, 1);
});

Deno.test("tiktok-publish retry: `both` post with both sides failed re-queues only TikTok and leaves the post to the recompute", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", status: "falha_publicacao", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("requeue_target", { data: true, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "agendado" });
  assertEquals(rpcCalls(db, "requeue_target").map((c) => c.payload), [
    { p_post_id: 1, p_platform: "tiktok", p_source: "workspace_user", p_actor: "actor-1" },
  ]);
  // The post stays in falha_publicacao (Instagram still failed); only requeue_target's
  // recompute may move it, never a direct write from the handler.
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish retry: destination not in falha (the IG side failed) -> 422, no RPC", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", status: "falha_publicacao", targets_state: ttTarget("pendente") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Apenas posts com falha no TikTok podem ser reenviados." });
  assertEquals(rpcCalls(db, "requeue_target").length, 0);
});

Deno.test("tiktok-publish retry: post outside publication -> 422, no RPC", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ status: "rascunho", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 422);
  assertEquals(rpcCalls(db, "requeue_target").length, 0);
});

Deno.test("tiktok-publish retry: requeue_target declining (race) -> 422", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ status: "falha_publicacao", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("requeue_target", { data: false, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 422);
});

// ============================================================
// cancel
// ============================================================

Deno.test("tiktok-publish cancel: succeeds with both feature flags OFF (cancel is ungated) via cancel_target_publish", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "both", status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  db.queueRpc("cancel_target_publish", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "aprovado_cliente" });
  assertEquals(db.calls.filter((c: QueryCall) => c.table === "rpc:effective_plan_feature").length, 0);
  assertEquals(rpcCalls(db, "cancel_target_publish").map((c) => c.payload), [
    { p_post_id: 1, p_platform: "tiktok", p_source: "workspace_user", p_actor: "actor-1" },
  ]);
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0, "the IG field clearing moved into the RPC");
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish cancel: post not agendado -> 422, no RPC", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ status: "aprovado_cliente" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Apenas posts agendados podem ser cancelados." });
  assertEquals(rpcCalls(db, "cancel_target_publish").length, 0);
});

Deno.test("tiktok-publish cancel: destination publishing -> 422 pt-BR from the P0422 identifier", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("cancel_target_publish", { data: null, error: { code: "P0422", message: "target_publishing" } });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Já está publicando no TikTok." });
});

Deno.test("tiktok-publish cancel: an unexpected RPC error -> generic 500, no raw text", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("cancel_target_publish", { data: null, error: { code: "XX000", message: "private db detail" } });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  assertEquals(res.status, 500);
  assert(!JSON.stringify(await res.json()).includes("private db detail"));
});
```

Replace lines 634-930 (the `publish-now` section to the end of the file) with:

```ts
// ============================================================
// publish-now
// ============================================================

function initWrites(db: ReturnType<typeof createSupabaseQueryMock>) {
  return callsFor(db, "post_targets", "update")
    .filter((c) => (c.payload as Record<string, unknown>).status === "processando");
}

function failedCalls(db: ReturnType<typeof createSupabaseQueryMock>) {
  return rpcCalls(db, "mark_target_failed").map((c) => c.payload as Record<string, unknown>);
}

Deno.test("tiktok-publish publish-now: success takes the destination lock, inits, and calls mark_target_published", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });
  db.queue("tiktok_accounts", "select", { data: { username: "dramarina" }, error: null });
  db.queueRpc("mark_target_published", { data: null, error: null });

  const { fn: tiktokFetchStub, calls: fetchCalls } = stubTiktokFetch({
    init: { publish_id: "pub-1" },
    statusSequence: [{ status: "PUBLISH_COMPLETE", publicaly_available_post_id: "7123456" }],
  });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: tiktokFetchStub,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "postado" });
  assertEquals(fetchCalls.length, 2); // one init + exactly one status-fetch

  const initCall = fetchCalls.find((c) => c.path === "/post/publish/content/init/");
  assert(initCall, "feed (photo) post must POST to /post/publish/content/init/");
  const photoUrl = (initCall!.body as { source_info: { photo_images: string[] } }).source_info.photo_images[0];
  assert(photoUrl.startsWith(MEDIA_URL_PREFIX), `photo_images entry must be a tiktok-media proxy URL, got ${photoUrl}`);
  assertEquals(await verifyTikTokMediaToken(photoUrl.slice(MEDIA_URL_PREFIX.length)), "img/1.jpg");

  assertEquals(rpcCalls(db, "begin_target_publish").map((c) => c.payload), [
    { p_post_id: 1, p_platform: "tiktok", p_source: "workspace_user", p_actor: "actor-1" },
  ]);

  const inits = initWrites(db);
  assertEquals(inits.length, 1);
  const initPayload = inits[0].payload as Record<string, unknown>;
  assertEquals(initPayload.publish_ref, "pub-1");
  assert(typeof initPayload.updated_at === "string");
  assert(inits[0].modifiers.some((m) => m.method === "eq" && m.args[0] === "post_id" && m.args[1] === 1));
  assert(inits[0].modifiers.some((m) => m.method === "eq" && m.args[0] === "platform" && m.args[1] === "tiktok"));

  const marks = rpcCalls(db, "mark_target_published");
  assertEquals(marks.length, 1);
  const payload = marks[0].payload as Record<string, unknown>;
  assertEquals(payload.p_post_id, 1);
  assertEquals(payload.p_platform, "tiktok");
  assertEquals(payload.p_source, "workspace_user");
  assertEquals(payload.p_actor, "actor-1");
  const fields = payload.p_fields as Record<string, unknown>;
  assertEquals(fields.external_id, "7123456");
  assertEquals(fields.permalink, "https://www.tiktok.com/@dramarina/photo/7123456");
  assert(typeof fields.published_at === "string" && !isNaN(Date.parse(fields.published_at as string)));
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish publish-now: a `both` post Instagram already moved to agendado still publishes (bug 1)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "both", status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });
  db.queue("tiktok_accounts", "select", { data: { username: "dramarina" }, error: null });

  const { fn } = stubTiktokFetch({ statusSequence: [{ status: "PUBLISH_COMPLETE" }] });
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: fn,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 200);
  assertEquals(rpcCalls(db, "begin_target_publish").length, 1);
  assertEquals(rpcCalls(db, "mark_target_published").length, 1);
});

Deno.test("tiktok-publish publish-now: still-processing after 12 polls -> agendado response, destination lock released", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });

  const { fn: tiktokFetchStub, calls: fetchCalls } = stubTiktokFetch({
    init: { publish_id: "pub-1" },
    statusSequence: [{ status: "PROCESSING_UPLOAD" }],
  });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: tiktokFetchStub,
    buildTikTokMediaUrl: ((key: string) => Promise.resolve(`https://r2.example/${key}?sig=1`)) as never,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.status, "agendado");
  assert(typeof body.message === "string" && body.message.length > 0);
  assertEquals(fetchCalls.filter((c) => c.path === "/post/publish/status/fetch/").length, 12);
  assertEquals(rpcCalls(db, "mark_target_published").length, 0);

  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 2, "init write + lock release");
  const release = updates[1].payload as Record<string, unknown>;
  assertEquals(Object.keys(release), ["processing_at", "updated_at"]);
  assertEquals(release.processing_at, null);
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish publish-now: TikTok validation failure -> 422 before taking the lock", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() =>
      Promise.resolve(okTikTokValidation({ ok: false, errors: ["Post precisa de pelo menos uma mídia."] }))) as never,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  const body = await res.json();
  assertEquals(res.status, 422);
  assertEquals(body.details, ["Post precisa de pelo menos uma mídia."]);
  assertEquals(rpcCalls(db, "begin_target_publish").length, 0);
  assertEquals(rpcCalls(db, "mark_target_failed").length, 0);
});

Deno.test("tiktok-publish publish-now: lock held -> 409, never reaches TikTok", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost(), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: false, error: null });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    tiktokFetch: (() => {
      throw new Error("must not call TikTok");
    }) as never,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "Já está publicando no TikTok." });
  assertEquals(rpcCalls(db, "mark_target_failed").length, 0);
});

for (const [identifier, message] of [
  ["target_not_ready", "O envio anterior para o TikTok falhou. Use Reenviar para tentar de novo."],
  ["target_published", "Já publicado no TikTok."],
  ["post_not_publishable", "Post precisa estar aprovado pelo cliente para publicar."],
] as const) {
  Deno.test(`tiktok-publish publish-now: begin_target_publish refusal ${identifier} -> 422 pt-BR`, async () => {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("workflow_posts", "select", { data: basePost(), error: null });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);
    db.queueRpc("begin_target_publish", { data: null, error: { code: "P0422", message: identifier } });

    const handler = createPublishHandler(makeDeps(db, {
      validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    }));
    const res = await handler(tiktokRequest("publish-now", 1));
    assertEquals(res.status, 422);
    assertEquals(await res.json(), { error: message });
  });
}

Deno.test("tiktok-publish publish-now: destination already processando (embed) -> 422 without the RPC", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ status: "agendado", targets_state: ttTarget("processando") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Já está publicando no TikTok." });
  assertEquals(rpcCalls(db, "begin_target_publish").length, 0);
});

Deno.test("tiktok-publish publish-now: post outside aprovado_cliente/agendado -> 422", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ status: "rascunho" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Post precisa estar aprovado pelo cliente para publicar." });
  assertEquals(rpcCalls(db, "begin_target_publish").length, 0);
});

for (const outcome of ["replaced", "invalid", "read-error"] as const) {
  Deno.test(`tiktok-publish publish-now: media changes before claiming (${outcome})`, async () => {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("workflow_posts", "select", { data: basePost(), error: null });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);

    let publishingClaimed = false;
    // The replacement transaction wins the workflow_posts row lock after preflight
    // validation, immediately before begin_target_publish takes the destination lock.
    db.queueRpc("begin_target_publish", () => {
      publishingClaimed = true;
      return { data: true, error: null };
    });
    db.queue("tiktok_accounts", "select", { data: { username: "creator" }, error: null });

    const { fn: tiktokFetchStub, calls: fetchCalls } = stubTiktokFetch();
    const handler = createPublishHandler(makeDeps(db, {
      validateForTikTokScheduling: (() => {
        if (!publishingClaimed) return Promise.resolve(okTikTokValidation());
        if (outcome === "read-error") throw new Error("private database read details");
        if (outcome === "invalid") {
          return Promise.resolve(okTikTokValidation({
            ok: false,
            errors: ["Post precisa de pelo menos uma mídia."],
            media: [],
          }));
        }
        const replacement = okTikTokValidation();
        replacement.media![0].r2_key = "img/replacement.jpg";
        return Promise.resolve(replacement);
      }) as never,
      getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
      tiktokFetch: tiktokFetchStub,
      buildTikTokMediaUrl,
      sleep: noopSleep,
    }));

    const res = await handler(tiktokRequest("publish-now", 1));
    const body = await res.json();
    if (outcome === "replaced") {
      assertEquals(res.status, 200);
      const init = fetchCalls.find((call) => call.path === "/post/publish/content/init/");
      assert(init);
      const photoUrl = (init.body as { source_info: { photo_images: string[] } }).source_info.photo_images[0];
      assertEquals(
        await verifyTikTokMediaToken(photoUrl.slice(MEDIA_URL_PREFIX.length)),
        "img/replacement.jpg",
        "TikTok must receive the replacement file, even though the old R2 object still exists",
      );
    } else {
      assertEquals(res.status, outcome === "invalid" ? 422 : 500);
      assertEquals(fetchCalls.length, 0, "invalid or unreadable replacement must never reach TikTok");
      if (outcome === "invalid") assertEquals(body.details, ["Post precisa de pelo menos uma mídia."]);
      assert(!JSON.stringify(body).includes("private database read details"));
      const failed = failedCalls(db);
      assertEquals(failed.length, 1);
      assertEquals(failed[0].p_retryable, true);
      assertEquals(failed[0].p_source, "workspace_user");
      assertEquals(failed[0].p_actor, "actor-1");
      assert(!String(failed[0].p_error).includes("private database read details"));
    }
    assertNoLegacyTikTokWrites(db);
  });
}

Deno.test("tiktok-publish publish-now: precheck failure -> 422 with pt-BR message, non-retryable, no init", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "reels" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });

  const { fn, calls } = stubTiktokFetch();
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation({
      media: [{ id: 1, kind: "video", mime_type: "video/mp4", size_bytes: 1, width: 1080, height: 1920,
        duration_seconds: 750, r2_key: "v.mp4", sort_order: 0, media_lost_at: null }],
    }))) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: fn,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "ok", privacyLevelOptions: ["SELF_ONLY"], maxVideoPostDurationSec: 600 })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Este vídeo tem 750s. O máximo permitido para esta conta é 600s." });
  assertEquals(calls.filter((c) => c.path.endsWith("/init/")).length, 0);
  assertEquals(failedCalls(db), [{
    p_post_id: 1,
    p_platform: "tiktok",
    p_error: "Este vídeo tem 750s. O máximo permitido para esta conta é 600s.",
    p_error_code: null,
    p_retryable: false,
    p_source: "workspace_user",
    p_actor: "actor-1",
  }]);
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish publish-now: mapped init error -> 422 pt-BR, non-retryable", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });

  const initCalls: string[] = [];
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: ((path: string) => {
      initCalls.push(path);
      return Promise.reject(new TikTokApiError("unaudited", "unaudited_client_can_only_post_to_private_accounts", false));
    }) as never,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  const mapped = "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.";
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: mapped });
  assertEquals(initCalls, ["/post/publish/content/init/"]);
  const failed = failedCalls(db);
  assertEquals(failed.length, 1);
  assertEquals(failed[0].p_error, mapped);
  assertEquals(failed[0].p_retryable, false);
});

Deno.test("tiktok-publish publish-now: unmapped init error stays retryable and returns the generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: (() => Promise.reject(new Error("socket hang up"))) as never,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 500);
  const failed = failedCalls(db);
  assertEquals(failed.length, 1);
  assertEquals(failed[0].p_error, "socket hang up");
  assertEquals(failed[0].p_retryable, true);
  assertNoLegacyTikTokWrites(db);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish_test.ts
```

Expected: FAIL. For example, `the post select embeds the TikTok destination` fails on the `targets_state:post_targets(...)` assertion, and `retry: … re-queues the destination` fails with `Expected [{"p_post_id":1,…}] but received []`. The schedule happy path and creator-info tests keep passing.

- [ ] **Step 3: Implement the handler changes**

In `supabase/functions/tiktok-publish/handler.ts`, add `markTikTokPublishFailed` to the `_shared/tiktok-publish-utils.ts` import (lines 27-36):

```ts
import {
  validateForTikTokScheduling as realValidateForTikTokScheduling,
  buildVideoInitPayload,
  buildPhotoInitPayload,
  buildTikTokPostUrl,
  mapStatusFetch,
  markTikTokPublishFailed,
  type TikTokValidationResult,
  type ClaimedTikTokPost,
  type StatusFetchResult,
} from "../_shared/tiktok-publish-utils.ts";
```

After `const PUBLISH_NOW_POLL_INTERVAL_MS = 3000;` (line 79), add:

```ts
/** P4 RPC refusals (ERRCODE P0422, MESSAGE = identifier) mapped to curated pt-BR copy. */
const TARGET_REFUSALS: Record<string, string> = {
  target_publishing: "Já está publicando no TikTok.",
  target_published: "Já publicado no TikTok.",
  post_not_publishable: "Post precisa estar aprovado pelo cliente para publicar.",
  post_not_scheduled: "Apenas posts agendados podem ser cancelados.",
  target_not_ready: "O envio anterior para o TikTok falhou. Use Reenviar para tentar de novo.",
  target_not_found: "Este post não tem destino TikTok.",
};

function targetRefusal(err: unknown): string | null {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e || e.code !== "P0422" || typeof e.message !== "string") return null;
  return TARGET_REFUSALS[e.message] ?? null;
}

interface TikTokTargetState {
  id: number;
  platform: string;
  status: string;
  processing_at: string | null;
}

/** The post's TikTok destination from the `targets_state` embed (P4: the only publish state). */
function tiktokTarget(post: { targets_state?: TikTokTargetState[] | null }): TikTokTargetState | null {
  return (post.targets_state ?? []).find((t) => t.platform === "tiktok") ?? null;
}
```

Replace the post select (lines 199-206) with:

```ts
    const { data: post } = await userDb
      .from("workflow_posts")
      .select(
        "id, status, platform, tipo, tiktok_caption, tiktok_title, tiktok_settings, ig_caption, scheduled_at, " +
          "instagram_media_id, targets_state:post_targets(id, platform, status, processing_at)",
      )
      .eq("id", postId)
      .single();
```

Directly after the platform check that closes at line 227, add:

```ts
    const target = tiktokTarget(post);
```

In the schedule branch, after the `aprovado_cliente` check (closes at line 232), add:

```ts
      // A still-publishing TikTok destination always refuses. A published one is never
      // re-claimed (init takes only pendente/agendado), so scheduling is refused only when nothing
      // else is left to publish: a TikTok-only post, or Instagram already published. A `both` post
      // whose Instagram side is pending (post moved to draft mid-publish after TikTok landed) may
      // be scheduled: Instagram goes out and the recompute reaches postado when it lands.
      if (target?.status === "processando") return json({ error: TARGET_REFUSALS.target_publishing }, 422);
      const tiktokDone = target?.status === "publicado";
      const instagramPending =
        (post.platform === "both" ||
          ((post.targets_state ?? []) as TikTokTargetState[]).some((t) => t.platform === "instagram")) &&
        !post.instagram_media_id;
      if (tiktokDone && !instagramPending) return json({ error: TARGET_REFUSALS.target_published }, 422);
```

Then, further down the same branch, skip the TikTok validator when TikTok is already published. Replace:

```ts
      let tiktokValidation: TikTokValidationResult;
      try {
        tiktokValidation = await validateTikTok(svcDb as never, postId);
      } catch (e) {
        console.error("[TIKTOK-PUBLISH] schedule TikTok validation error:", (e as Error)?.message);
        const restoreFailure = await restoreScheduledAt();
        if (restoreFailure) return restoreFailure;
        return json({ error: "Erro ao validar post para agendamento no TikTok." }, 500);
      }
```

with:

```ts
      // TikTok already published: nothing left to validate on that side.
      let tiktokValidation: TikTokValidationResult | null = null;
      if (!tiktokDone) {
        try {
          tiktokValidation = await validateTikTok(svcDb as never, postId);
        } catch (e) {
          console.error("[TIKTOK-PUBLISH] schedule TikTok validation error:", (e as Error)?.message);
          const restoreFailure = await restoreScheduledAt();
          if (restoreFailure) return restoreFailure;
          return json({ error: "Erro ao validar post para agendamento no TikTok." }, 500);
        }
      }
```

and replace:

```ts
      const mergedErrors = [...tiktokValidation.errors, ...(igValidation?.errors ?? [])];
      const ok = tiktokValidation.ok && (igValidation ? igValidation.ok : true);
```

with:

```ts
      const mergedErrors = [...(tiktokValidation?.errors ?? []), ...(igValidation?.errors ?? [])];
      const ok = (tiktokValidation ? tiktokValidation.ok : true) && (igValidation ? igValidation.ok : true);
```

Replace the cancel, retry and publish-now branches (lines 309-571) with:

```ts
    if (action === "cancel") {
      if (post.status !== "agendado") {
        return json({ error: TARGET_REFUSALS.post_not_scheduled }, 422);
      }

      // One transaction: destination back to pendente, the Instagram handles cleared for a post
      // that also goes to Instagram, post back to aprovado_cliente (cancel_target_publish).
      const { error: rpcErr } = await svcDb.rpc("cancel_target_publish", {
        p_post_id: postId,
        p_platform: "tiktok",
        p_source: "workspace_user",
        p_actor: actorId,
      });
      if (rpcErr) {
        const refusal = targetRefusal(rpcErr);
        if (refusal) return json({ error: refusal }, 422);
        return internalServerError(json, "tiktok-publish:cancel", rpcErr);
      }

      return json({ ok: true, status: "aprovado_cliente" });
    }

    if (action === "retry") {
      // Accepts a post already back at agendado: Instagram's retry may have moved it first (bug 2).
      if (target?.status !== "falha" || !["agendado", "falha_publicacao"].includes(post.status)) {
        return json({ error: "Apenas posts com falha no TikTok podem ser reenviados." }, 422);
      }

      const { data: requeued, error: rpcErr } = await svcDb.rpc("requeue_target", {
        p_post_id: postId,
        p_platform: "tiktok",
        p_source: "workspace_user",
        p_actor: actorId,
      });
      if (rpcErr) return internalServerError(json, "tiktok-publish:retry", rpcErr);
      if (requeued !== true) {
        return json({ error: "Apenas posts com falha no TikTok podem ser reenviados." }, 422);
      }

      // The cron's init phase publishes the re-queued destination.
      return json({ ok: true, status: "agendado" });
    }

    if (action === "publish-now") {
      // agendado is accepted: Instagram's publish-now may have moved the post first (bug 1).
      if (post.status !== "aprovado_cliente" && post.status !== "agendado") {
        return json({ error: TARGET_REFUSALS.post_not_publishable }, 422);
      }
      if (target?.status === "processando") return json({ error: TARGET_REFUSALS.target_publishing }, 422);
      if (target?.status === "publicado") return json({ error: TARGET_REFUSALS.target_published }, 422);

      let validation: TikTokValidationResult;
      try {
        validation = await validateTikTok(svcDb as never, postId, { skipDateCheck: true });
      } catch (e) {
        console.error("[TIKTOK-PUBLISH-NOW] validation error:", (e as Error)?.message);
        return json({ error: "Erro ao validar post para publicação no TikTok." }, 500);
      }
      if (!validation.ok) {
        return json({ error: "Validação falhou", details: validation.errors }, 422);
      }

      // One transaction: aprovado_cliente -> agendado (if needed) + the destination lock.
      const { data: began, error: beginErr } = await svcDb.rpc("begin_target_publish", {
        p_post_id: postId,
        p_platform: "tiktok",
        p_source: "workspace_user",
        p_actor: actorId,
      });
      if (beginErr) {
        const refusal = targetRefusal(beginErr);
        if (refusal) return json({ error: refusal }, 422);
        return internalServerError(json, "tiktok-publish:publish-now", beginErr);
      }
      if (began !== true) return json({ error: TARGET_REFUSALS.target_publishing }, 409);

      let validationFailure: Response | null = null;
      try {
        // A media replacement can commit after preflight while this request waits for
        // the workflow_posts row lock. Once processing is claimed, replacements are
        // blocked; read and validate that committed media before building provider URLs.
        try {
          validation = await validateTikTok(svcDb as never, postId, { skipDateCheck: true });
        } catch (e) {
          console.error("[TIKTOK-PUBLISH-NOW] claimed validation error:", (e as Error)?.message);
          // Validator infrastructure errors can contain private DB details. Only the
          // generic error may be persisted by the publishing failure cleanup below.
          throw new Error("Erro ao validar post para publicação no TikTok.");
        }
        if (!validation.ok) {
          validationFailure = json({ error: "Validação falhou", details: validation.errors }, 422);
          throw new Error("Validação do post para publicação no TikTok falhou.");
        }

        const account = validation.account!;
        const { accessToken } = await getFreshToken(svcDb as never, account.id);

        const creator = await (deps.fetchCreatorCheck ?? realFetchCreatorCheck)(tiktokFetchFn, accessToken);
        const precheckFailure = evaluateTikTokPrecheck({
          tipo: post.tipo,
          settings: post.tiktok_settings,
          media: (validation.media ?? []).map((m) => ({
            kind: m.kind,
            duration_seconds: m.duration_seconds,
            media_lost_at: m.media_lost_at ?? null,
          })),
          creator,
        });
        if (precheckFailure) throw new TikTokUserFacingError(precheckFailure);

        const claimedPost: ClaimedTikTokPost = {
          tipo: post.tipo,
          caption: post.tiktok_caption ?? post.ig_caption ?? "",
          tiktok_title: post.tiktok_title ?? null,
          tiktok_settings: post.tiktok_settings ?? {},
        };

        const media = validation.media ?? [];
        let initPath: string;
        let initPayload: object;
        if (post.tipo === "reels") {
          const videoUrl = await buildMediaUrl(media[0].r2_key, 7200);
          initPath = "/post/publish/video/init/";
          initPayload = buildVideoInitPayload(claimedPost, videoUrl);
        } else {
          const imageUrls = await Promise.all(media.map((m) => buildMediaUrl(m.r2_key, 7200)));
          initPath = "/post/publish/content/init/";
          initPayload = buildPhotoInitPayload(claimedPost, imageUrls);
        }

        const initResult = (await tiktokFetchFn(initPath, {
          method: "POST",
          accessToken,
          body: JSON.stringify(initPayload),
        })) as { publish_id?: string };
        const publishId = initResult?.publish_id;
        if (!publishId) throw new Error("TikTok init did not return a publish_id");

        // Single-statement destination write; the lock stays held while this request polls.
        const { error: initErr } = await svcDb
          .from("post_targets")
          .update({ status: "processando", publish_ref: publishId, updated_at: new Date().toISOString() })
          .eq("post_id", postId)
          .eq("platform", "tiktok");
        if (initErr) {
          throw new Error(
            `post_targets update (init) failed: ${(initErr as { message?: string }).message}`,
          );
        }

        let statusResult: StatusFetchResult = { state: "processing" };
        for (let i = 0; i < PUBLISH_NOW_MAX_POLLS; i++) {
          const statusData = await tiktokFetchFn("/post/publish/status/fetch/", {
            method: "POST",
            accessToken,
            body: JSON.stringify({ publish_id: publishId }),
          });
          statusResult = mapStatusFetch(statusData);
          if (statusResult.state !== "processing") break;
          if (i < PUBLISH_NOW_MAX_POLLS - 1) await sleepFn(PUBLISH_NOW_POLL_INTERVAL_MS);
        }

        if (statusResult.state === "published") {
          const { data: accountRow } = await svcDb
            .from("tiktok_accounts")
            .select("username")
            .eq("id", account.id)
            .maybeSingle();
          const username = (accountRow as { username?: string } | null)?.username;
          const permalink = statusResult.publicPostId && username
            ? buildTikTokPostUrl(username, statusResult.publicPostId, post.tipo)
            : undefined;

          const { error: markErr } = await svcDb.rpc("mark_target_published", {
            p_post_id: postId,
            p_platform: "tiktok",
            p_fields: {
              ...(statusResult.publicPostId ? { external_id: statusResult.publicPostId } : {}),
              ...(permalink ? { permalink } : {}),
              published_at: new Date().toISOString(),
            },
            p_source: "workspace_user",
            p_actor: actorId,
          });
          if (markErr) {
            throw new Error(
              `mark_target_published failed: ${(markErr as { message?: string }).message}`,
            );
          }

          return json({ ok: true, status: "postado" });
        }

        if (statusResult.state === "processing") {
          // Release the lock: the cron's status phase finishes the publish.
          const { error: clearLockErr } = await svcDb
            .from("post_targets")
            .update({ processing_at: null, updated_at: new Date().toISOString() })
            .eq("post_id", postId)
            .eq("platform", "tiktok");
          if (clearLockErr) {
            console.error(
              "[TIKTOK-PUBLISH-NOW] failed to clear processing lock:",
              (clearLockErr as { message?: string }).message,
            );
          }
          return json({
            ok: true,
            status: "agendado",
            message: "TikTok ainda processando. A publicação será concluída automaticamente em instantes.",
          });
        }

        // statusResult.state === "failed"
        throw new Error(
          statusResult.failReason ? `TikTok publish failed: ${statusResult.failReason}` : "TikTok publish failed",
        );
      } catch (err) {
        const mapped = err instanceof TikTokUserFacingError
          ? err.message
          : tiktokErrorMessage(err instanceof TikTokApiError ? err.code : undefined);
        const message = mapped ?? (err as Error)?.message ?? "Unknown error";
        console.error(`[TIKTOK-PUBLISH-NOW] failed for post ${postId}:`, (err as Error)?.message);

        // Destination -> falha and post -> falha_publicacao in one transaction (mark_target_failed).
        await markTikTokPublishFailed(svcDb, postId, message, {
          nonRetryable: !!mapped,
          source: "workspace_user",
          actorId,
        });

        if (validationFailure) return validationFailure;
        if (mapped) return json({ error: mapped }, 422);
        return internalServerError(json, "tiktok-publish:publish-now", err);
      }
    }
```

- [ ] **Step 4: Run the test and the type gate and confirm they pass**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-publish_test.ts
npm run check:functions
git checkout deno.lock
```

Expected:
- Every test in `tiktok-publish_test.ts` passes.
- `check:functions` reports no error in `tiktok-publish/`. If Task 6 is not done yet, errors in `tiktok-webhook/handler.ts` are expected.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/tiktok-publish/handler.ts supabase/functions/__tests__/tiktok-publish_test.ts
git commit -m "feat(tiktok): publish-now, cancel and retry act on the TikTok destination (P4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `tiktok-webhook` on the destination

**Files:**
- Modify: `supabase/functions/tiktok-webhook/handler.ts`:
  - `:82-87` (`FoundPost` becomes `FoundTarget`);
  - `:119-136` (lookup);
  - `:166-188` (`claimPublishLock`);
  - `:210-304` (the three post handlers).
- Modify: `supabase/functions/__tests__/tiktok-webhook_test.ts`:
  - replace `:180-267` (sections 6 and 7);
  - replace `:335-546` (sections 9 and 9b).
- Test: `supabase/functions/__tests__/tiktok-webhook_test.ts`

**Interfaces:**
- Consumes:
  - from Task 4: `ConfirmAndApplyPublishStatusPost { post_id, target_id, publish_ref, tiktok_username, tipo }` and `confirmAndApplyPublishStatus`;
  - from Task 1: `post_targets.publish_ref` and the index on `(platform, publish_ref)`.
- Produces: no new exports. The webhook's DB contract becomes:
  - lookup: `post_targets.select("id, post_id, publish_ref, workflow_posts(tipo)").eq("platform","tiktok").eq("publish_ref", id).order("id",{ascending:false}).limit(1).maybeSingle()`;
  - lock: `post_targets.update({ processing_at, updated_at }).eq("id", targetId).or("processing_at.is.null,processing_at.lt.<stale>").select("id").maybeSingle()`;
  - `publicly_available`: `post_targets.update({ external_id, permalink?, updated_at })`;
  - `no_longer_publicly_available`: `post_targets.update({ permalink: null, updated_at })`.

- [ ] **Step 1: Rewrite the post-event tests (failing)**

In `supabase/functions/__tests__/tiktok-webhook_test.ts`, add after `baseAccount` (after line 42):

```ts
/** A post_targets row as the lookup selects it (P4: publish state lives on the destination). */
function ttTargetRow(postId: number, publishRef: string, tipo: string | null = "feed") {
  return { id: 7000 + postId, post_id: postId, publish_ref: publishRef, workflow_posts: { tipo } };
}

const NOW_ISO = "2026-07-18T12:00:00.000Z";
```

Replace lines 180-267 (sections 6 and 7) with:

```ts
// ── (6) publicly_available: stores external_id/permalink on the destination ─────

Deno.test("tiktok-webhook: publicly_available stores external_id/permalink on the TikTok destination", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount({ username: "dktest" }), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(70, "pub-70", "carrossel"), error: null });
  db.queue("post_targets", "update", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLICLY_AVAILABLE,
    content: JSON.stringify({ publish_id: "pub-70", post_id: "post-70" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  const lookup = callsFor(db, "post_targets", "select")[0];
  assertEquals(lookup.selectArgs, [["id, post_id, publish_ref, workflow_posts(tipo)"]]);
  assertEquals(lookup.modifiers, [
    { method: "eq", args: ["platform", "tiktok"] },
    { method: "eq", args: ["publish_ref", "pub-70"] },
    { method: "order", args: ["id", { ascending: false }] },
    { method: "limit", args: [1] },
    { method: "maybeSingle", args: [] },
  ]);

  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, {
    external_id: "post-70",
    permalink: "https://www.tiktok.com/@dktest/photo/post-70",
    updated_at: NOW_ISO,
  });
  assertEquals(updates[0].modifiers, [{ method: "eq", args: ["id", 7070] }]);
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0, "the frozen tiktok_* columns are never written");
});

Deno.test("tiktok-webhook: publicly_available redelivery writes the exact same fields again (idempotent, no error)", async () => {
  const db = createSupabaseQueryMock();
  const account = baseAccount({ username: "dktest" });
  db.queue("tiktok_accounts", "select", { data: account, error: null }, { data: account, error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null }, { data: null, error: null });
  const row = ttTargetRow(70, "pub-70");
  db.queue("post_targets", "select", { data: row, error: null }, { data: row, error: null });
  db.queue("post_targets", "update", { data: null, error: null }, { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null }, { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLICLY_AVAILABLE,
    content: JSON.stringify({ publish_id: "pub-70", post_id: "post-70" }),
  });

  const first = await handler(webhookRequest(payload));
  const second = await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 2, "each delivery re-applies the update");
  assertEquals(updates[0].payload, updates[1].payload, "redelivery converges to the exact same state");
});

// ── (7) no_longer_publicaly_available: clears permalink, keeps external_id ──────

Deno.test("tiktok-webhook: no_longer_publicaly_available clears the permalink but keeps external_id", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(71, "pub-71"), error: null });
  db.queue("post_targets", "update", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_NO_LONGER_PUBLICALY_AVAILABLE,
    content: JSON.stringify({ publish_id: "pub-71" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, { permalink: null, updated_at: NOW_ISO }, "external_id must NOT be touched");
  assertEquals(updates[0].modifiers, [{ method: "eq", args: ["id", 7071] }]);
});

```

Replace lines 335-546 (sections 9 and 9b) with:

```ts
// ── (9) publish.failed / publish.complete: re-confirm via the shared status ────
// resolution (spy) instead of mutating the destination directly ────────────────

Deno.test("tiktok-webhook: post.publish.failed re-confirms via confirmAndApplyPublishStatus with the destination", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(80, "pub-80", "reels"), error: null });
  db.queue("post_targets", "update", { data: { id: 7080 }, error: null }); // lock claim succeeds
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const confirmCalls: Array<{ post: unknown; accessToken: string }> = [];
  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, {
    waitUntil: (p) => waited.push(p),
    getFreshTikTokToken: async () => ({ accessToken: "fresh-tok", openId: "open-1" }),
    confirmAndApplyPublishStatus: (async (deps: { accessToken: string }, post: unknown) => {
      confirmCalls.push({ post, accessToken: deps.accessToken });
      return "failed";
    }) as unknown as TikTokWebhookDeps["confirmAndApplyPublishStatus"],
  }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_FAILED,
    content: JSON.stringify({ publish_id: "pub-80", reason: "video_pull_failed", publish_type: "VIDEO" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(confirmCalls.length, 1);
  assertEquals(confirmCalls[0].accessToken, "fresh-tok");
  assertEquals(confirmCalls[0].post, {
    post_id: 80,
    target_id: 7080,
    publish_ref: "pub-80",
    tiktok_username: "dktest",
    tipo: "reels",
  });

  const lockUpdates = callsFor(db, "post_targets", "update");
  assertEquals(lockUpdates.length, 1, "the handler only claims the destination lock");
  assertEquals(lockUpdates[0].payload, { processing_at: NOW_ISO, updated_at: NOW_ISO });
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
});

Deno.test("tiktok-webhook: post.publish.complete also re-confirms via confirmAndApplyPublishStatus", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(81, "pub-81"), error: null });
  db.queue("post_targets", "update", { data: { id: 7081 }, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const confirmCalls: number[] = [];
  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, {
    waitUntil: (p) => waited.push(p),
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    confirmAndApplyPublishStatus: (async (_deps: unknown, post: { post_id: number }) => {
      confirmCalls.push(post.post_id);
      return "published";
    }) as unknown as TikTokWebhookDeps["confirmAndApplyPublishStatus"],
  }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_COMPLETE,
    content: JSON.stringify({ publish_id: "pub-81" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(confirmCalls, [81]);
});

Deno.test("tiktok-webhook: publish.failed for an unknown publish_id logs and no-ops (still stamps processed_at)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: null, error: null }); // no matching destination
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_FAILED,
    content: JSON.stringify({ publish_id: "pub-missing" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 1, "an unresolvable publish_id is a logged no-op");
  assertEquals(callsFor(db, "post_targets", "update").length, 0);
});

// ── (9b) webhook/cron lock coordination: claim the destination's processing_at before ─
// re-confirming, so a mid-flight cron status-fetch can never race the webhook's write ─

Deno.test("tiktok-webhook: publish.complete cedes to the cron when the destination lock is held", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(90, "pub-90"), error: null });
  // maybeSingle() resolving to null data = the claim's .or() filter matched zero rows
  // (processing_at is fresh, the cron owns this destination).
  db.queue("post_targets", "update", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_COMPLETE,
    content: JSON.stringify({ publish_id: "pub-90" }),
  });
  const response = await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(response.status, 200);
  const lock = callsFor(db, "post_targets", "update");
  assertEquals(lock.length, 1, "the claim attempt itself must still run");
  assertEquals(lock[0].modifiers, [
    { method: "eq", args: ["id", 7090] },
    { method: "or", args: ["processing_at.is.null,processing_at.lt.2026-07-18T11:50:00.000Z"] },
    { method: "maybeSingle", args: [] },
  ]);
  assertEquals(lock[0].selectArgs, [["id"]]);
  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 1, "ceding is a normal no-op");
});

Deno.test("tiktok-webhook: publish.complete claims the free lock and proceeds to confirmAndApplyPublishStatus", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(91, "pub-91"), error: null });
  db.queue("post_targets", "update", { data: { id: 7091 }, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const confirmCalls: number[] = [];
  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, {
    waitUntil: (p) => waited.push(p),
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    confirmAndApplyPublishStatus: (async (_deps: unknown, post: { post_id: number }) => {
      confirmCalls.push(post.post_id);
      return "published";
    }) as unknown as TikTokWebhookDeps["confirmAndApplyPublishStatus"],
  }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_COMPLETE,
    content: JSON.stringify({ publish_id: "pub-91" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(callsFor(db, "post_targets", "update").length, 1, "the claim update must have run");
  assertEquals(confirmCalls, [91], "winning the claim must lead to confirmAndApplyPublishStatus being called");
});

Deno.test("tiktok-webhook: a DB error while claiming the lock leaves processed_at unstamped and never throws out", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(92, "pub-92"), error: null });
  db.queue("post_targets", "update", { data: null, error: { message: "connection reset" } });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_COMPLETE,
    content: JSON.stringify({ publish_id: "pub-92" }),
  });
  const response = await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 0, "processed_at must stay NULL");
});

Deno.test("tiktok-webhook: a DB error on the destination lookup leaves processed_at unstamped", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: null, error: { message: "timeout" } });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  await handler(webhookRequest(webhookPayload({ content: JSON.stringify({ publish_id: "pub-93" }) })));
  await Promise.all(waited);

  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 0);
});

```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-webhook_test.ts
```

Expected: FAIL in the section 6, 7, 9 and 9b tests, for example `expected a select on post_targets` / `Cannot read properties of undefined (reading 'selectArgs')`. Sections 1-5, 8 and 10 still pass.

- [ ] **Step 3: Implement the handler changes**

In `supabase/functions/tiktok-webhook/handler.ts`, replace lines 82-87 (`interface FoundPost`) with:

```ts
/** The TikTok destination a webhook's publish_id points at (P4: post_targets.publish_ref). */
interface FoundTarget {
  post_id: number;
  target_id: number;
  tipo: string | null;
  publish_ref: string | null;
}
```

Replace lines 119-136 (`findPostByPublishId`) with:

```ts
/** publish_ref is indexed (platform, publish_ref) but not unique: the legacy tiktok_publish_id
 * never was. A duplicate resolves to the newest destination row. */
async function findTargetByPublishRef(svc: DbClient, publishId: string | undefined): Promise<FoundTarget | null> {
  if (!publishId) return null;
  const { data, error } = await svc
    .from("post_targets")
    .select("id, post_id, publish_ref, workflow_posts(tipo)")
    .eq("platform", "tiktok")
    .eq("publish_ref", publishId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`tiktok-webhook: post_targets lookup by publish_ref failed: ${error.message}`);
  }
  if (!data) return null;
  const parent = data.workflow_posts as { tipo?: string | null } | null;
  return {
    post_id: data.post_id,
    target_id: data.id,
    tipo: parent?.tipo ?? null,
    publish_ref: data.publish_ref ?? null,
  };
}
```

Replace lines 166-188 (the `claimPublishLock` doc comment and function) with:

```ts
/** Claims the SAME post_targets.processing_at lock claim_tiktok_targets_for_publishing uses
 * (NULL or older than the 10-minute stale window), so a webhook-triggered re-confirmation and a
 * concurrently running cron status-fetch can never both act on the same destination. `claimed:
 * false` means the cron currently holds it (not an error — the caller cedes). */
async function claimPublishLock(
  svc: DbClient,
  targetId: number,
  now: () => Date,
): Promise<{ claimed: boolean }> {
  const staleBefore = new Date(now().getTime() - 10 * 60_000).toISOString();
  const nowIso = now().toISOString();
  const { data, error } = await svc
    .from("post_targets")
    .update({ processing_at: nowIso, updated_at: nowIso })
    .eq("id", targetId)
    .or(`processing_at.is.null,processing_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`tiktok-webhook: failed to claim publish lock for target ${targetId}: ${error.message}`);
  }
  return { claimed: !!data };
}
```

In the doc comment of `handlePublishCompleteOrFailed` (lines 190-209):
- replace `tiktok_publish_status='processing'` with `the destination's lock release`;
- replace the two mentions of `tiktok_publish_processing_at` with `post_targets.processing_at`;
- replace `findPostByPublishId` with `findTargetByPublishRef`.

Then replace the bodies of the three post handlers (lines 210-304) with:

```ts
async function handlePublishCompleteOrFailed(
  ctx: ProcessCtx,
  args: ProcessArgs,
  content: TikTokWebhookContent,
): Promise<void> {
  const target = await findTargetByPublishRef(ctx.svc, content.publish_id);
  if (!target) {
    console.log(
      `[tiktok-webhook] ${args.eventName}: no destination found for publish_id ${content.publish_id ?? "(missing)"}`,
    );
    return;
  }

  const { claimed } = await claimPublishLock(ctx.svc, target.target_id, ctx.now);
  if (!claimed) {
    console.log(
      `[tiktok-webhook] ${args.eventName}: post ${target.post_id} publish lock held by tiktok-publish-cron — ` +
        `ceding resolution to the cron's own status-fetch`,
    );
    return;
  }

  const { accessToken } = await ctx.getFreshToken(ctx.svc as never, args.account.id);
  const outcome: ConfirmAndApplyPublishStatusOutcome = await ctx.confirmAndApply(
    { svc: ctx.svc, tiktokFetch: ctx.tiktokFetchFn, accessToken, now: ctx.now },
    {
      post_id: target.post_id,
      target_id: target.target_id,
      publish_ref: target.publish_ref,
      tiktok_username: args.account.username,
      tipo: target.tipo,
    },
  );
  console.log(`[tiktok-webhook] ${args.eventName}: post ${target.post_id} re-confirmed as ${outcome}`);
  // No explicit lock release: every confirmAndApplyPublishStatus outcome clears
  // post_targets.processing_at (mark_target_published, the processing release, mark_target_failed).
}

/** post.publish.publicly_available: stores the public id + URL on the destination via a direct,
 * error-checked update (the destination was already published by an earlier confirmation; this
 * only adds the public URL once TikTok's review makes it visible). Idempotent by construction. */
async function handlePubliclyAvailable(
  ctx: ProcessCtx,
  args: ProcessArgs,
  content: TikTokWebhookContent,
): Promise<void> {
  const target = await findTargetByPublishRef(ctx.svc, content.publish_id);
  if (!target || !content.post_id) {
    console.log(
      `[tiktok-webhook] publicly_available: missing destination/post_id (publish_id ${content.publish_id ?? "(missing)"})`,
    );
    return;
  }

  const fields: Record<string, unknown> = { external_id: content.post_id };
  if (args.account.username) {
    fields.permalink = buildTikTokPostUrl(args.account.username, content.post_id, target.tipo);
  }
  fields.updated_at = ctx.now().toISOString();

  const { error } = await ctx.svc.from("post_targets").update(fields).eq("id", target.target_id);
  if (error) {
    throw new Error(`tiktok-webhook: failed to store external_id/permalink for post ${target.post_id}: ${error.message}`);
  }
  console.log(`[tiktok-webhook] publicly_available: post ${target.post_id} -> ${content.post_id}`);
}

/** post.publish.no_longer_publicaly_available (sic): clears the permalink only, KEEPING
 * external_id — the post still exists on TikTok, it's just no longer publicly viewable. */
async function handleNoLongerPubliclyAvailable(
  ctx: ProcessCtx,
  args: ProcessArgs,
  content: TikTokWebhookContent,
): Promise<void> {
  const target = await findTargetByPublishRef(ctx.svc, content.publish_id);
  if (!target) {
    console.log(
      `[tiktok-webhook] no_longer_publicaly_available: no destination found for publish_id ${content.publish_id ?? "(missing)"}`,
    );
    return;
  }

  const { error } = await ctx.svc
    .from("post_targets")
    .update({ permalink: null, updated_at: ctx.now().toISOString() })
    .eq("id", target.target_id);
  if (error) {
    throw new Error(`tiktok-webhook: failed to clear permalink for post ${target.post_id}: ${error.message}`);
  }
  console.log(`[tiktok-webhook] post ${target.post_id} is no longer publicly available.`);
}
```

The `args` parameter of `handleNoLongerPubliclyAvailable` is unused, as it was before. Keep the signature so that `routeEvent` stays unchanged.

- [ ] **Step 4: Run the test and the type gate and confirm they pass**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-webhook_test.ts
npm run check:functions
git checkout deno.lock
```

Expected:
- Every webhook test passes.
- `check:functions` exits 0 once Tasks 4, 5 and 6 are all in.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/tiktok-webhook/handler.ts supabase/functions/__tests__/tiktok-webhook_test.ts
git commit -m "feat(tiktok): webhook resolves and updates the TikTok destination (P4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Server readers — `data-import` guard and `hub-posts` permalink

**Files:**
- Modify: `supabase/functions/data-import/handler.ts:234-256` (`guardPublishedPosts` doc comment and first loop)
- Modify: `supabase/functions/hub-posts/handler.ts:167` (select) and `:236-239` (flatten)
- Modify: `supabase/functions/__tests__/data-import_test.ts:1066-1069` (fixture) and `:1106-1112` (predicate assertion); add one test after the undo test that ends at line 1125
- Modify: `supabase/functions/__tests__/hub-functions_test.ts`: add one test after the test ending at line 168
- Test: both test files

**Interfaces:**
- Consumes: `post_targets (post_id, conta_id, platform, status, permalink)` (Task 1 schema; the status values written by Tasks 2-6).
- Produces:
  - `hub-posts` GET keeps its response field `tiktok_post_url` (string | null) on every post, now taken from the TikTok destination's `permalink`. `targets_state` never appears in the response.
  - `data-import` undo skips a post that has any `publicado` destination.

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/__tests__/data-import_test.ts`:
- Replace the fixture at lines 1066-1069:

```ts
  db.queue("workflow_posts", "select", {
    data: [{ id: 31, instagram_media_id: "ig1", tiktok_post_id: null }],
    error: null,
  });
```

with:

```ts
  db.queue("workflow_posts", "select", {
    data: [{ id: 31, instagram_media_id: "ig1" }],
    error: null,
  });
```

- Replace the predicate assertion at lines 1106-1112:

```ts
  assertModifier(oneCall(db, "workflow_posts", "select", 0), "or", [
    "instagram_media_id.not.is.null,tiktok_post_id.not.is.null",
  ]);
```

with:

```ts
  assertModifier(oneCall(db, "workflow_posts", "select", 0), "not", ["instagram_media_id", "is", null]);
  // P4: TikTok publish state lives on the destination; the frozen tiktok_post_id is not read.
  const targetsProbe = oneCall(db, "post_targets", "select");
  assertEquals(targetsProbe.selectArgs, [["post_id"]]);
  assertModifier(targetsProbe, "eq", ["conta_id", "conta-1"]);
  assertModifier(targetsProbe, "eq", ["status", "publicado"]);
  assertModifier(targetsProbe, "in", ["post_id", [31, 32]]);
```

- After the test `"data-import: undo deletes recorded rows in order, skips published posts"` (ends at line 1125), insert:

```ts
Deno.test("data-import: undo keeps a post whose TikTok destination is publicado (P4)", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  db.queue("import_job_items", "select", {
    data: [{ table_name: "workflow_posts", row_id: "31", source_row_key: "p1", ordinal: 0, merged: false }],
    error: null,
  });
  db.queue("workflow_posts", "select", { data: [], error: null }); // no Instagram media
  db.queue("post_targets", "select", { data: [{ post_id: 31 }], error: null }); // published on TikTok
  db.queue("workflow_posts", "delete", { data: [{ id: 31 }], error: null }); // must go unused
  db.queue("import_jobs", "update", UNDO_CLAIM_OK);
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.skippedPublished, ["31"]);
  assertEquals(body.deleted, 0);
  assertEquals(callsFor(db, "workflow_posts", "delete").length, 0);
});
```

In `supabase/functions/__tests__/hub-functions_test.ts`, after the test `"hub-posts returns flattened post data with signed media URLs"` (ends at line 168), insert:

```ts
Deno.test("hub-posts takes tiktok_post_url from the TikTok destination's permalink (P4)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflow_posts", "select", {
    data: [
      {
        id: 99,
        titulo: "Publicado no TikTok",
        tipo: "reels",
        status: "postado",
        ordem: 0,
        scheduled_at: "2026-04-16T10:00:00.000Z",
        published_at: "2026-04-16T10:01:00.000Z",
        platform: "both",
        workflow_id: 7,
        workflows: { titulo: "Calendário Abril" },
        targets_state: [
          { platform: "instagram", permalink: "https://instagram.com/p/x" },
          { platform: "tiktok", permalink: "https://www.tiktok.com/@marca/video/123" },
        ],
      },
      {
        id: 100,
        titulo: "Só Instagram",
        tipo: "feed",
        status: "enviado_cliente",
        ordem: 1,
        scheduled_at: "2026-04-20T10:00:00.000Z",
        platform: "instagram",
        workflow_id: 7,
        workflows: { titulo: "Calendário Abril" },
        targets_state: [{ platform: "instagram", permalink: null }],
      },
    ],
    error: null,
  });
  db.queue("post_approvals", "select", { data: [], error: null });
  db.queue("post_file_links", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: false }, error: null });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
    rateLimit: async () => true,
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  const byId = new Map((body.posts as Array<Record<string, unknown>>).map((p) => [p.id, p]));
  assertEquals(byId.get(99)?.tiktok_post_url, "https://www.tiktok.com/@marca/video/123");
  assertEquals(byId.get(100)?.tiktok_post_url, null);
  assert(!("targets_state" in byId.get(99)!), "the embed must not leak into the response");

  const postsSelect = db.calls.find((c) =>
    c.table === "workflow_posts" && c.operation === "select" && String(c.selectArgs[0]?.[0]).includes("titulo")
  )!;
  const select = String(postsSelect.selectArgs[0][0]);
  assert(select.includes("targets_state:post_targets(platform, permalink)"), select);
  assert(!/(^|[ ,])tiktok_post_url/.test(select), "the frozen column is no longer selected");
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/data-import_test.ts supabase/functions/__tests__/hub-functions_test.ts
```

Expected:
- `undo deletes recorded rows …` fails with `workflow_posts:select is missing .not("instagram_media_id","is",null)`.
- `undo keeps a post whose TikTok destination is publicado` fails with `Expected ["31"] but received []`.
- The hub-posts test fails with `Expected "https://www.tiktok.com/@marca/video/123" but received undefined`.

- [ ] **Step 3: Implement the reader changes**

In `supabase/functions/data-import/handler.ts`, replace lines 234-256 (the doc comment through the first `for` loop of `guardPublishedPosts`) with:

```ts
/**
 * workflow_posts pass. Returns the ids to SKIP — the union of two distinct
 * hazards:
 *   - a post already published to Instagram (instagram_media_id) or with a
 *     `publicado` destination (P4: TikTok publish state lives in
 *     post_targets); deleting it would drop the record of live content.
 *     PostgREST can't .or() across an embed, so the destination check is a
 *     second query, unioned here.
 *   - a post with a surviving row in any PUBLISHED_POST_CASCADE_CHILDREN
 *     table carries user-authored data the import never wrote, which undo
 *     must not cascade away.
 */
async function guardPublishedPosts(db: DbClient, conta_id: string, ids: string[]): Promise<string[]> {
  const skip = new Set<string>();
  for (const part of chunked(ids)) {
    const numericPart = part.map(Number);
    const { data, error } = await db
      .from("workflow_posts")
      .select("id, instagram_media_id")
      .eq("conta_id", conta_id)
      .in("id", numericPart)
      .not("instagram_media_id", "is", null);
    if (error) throw error;
    for (const p of (data ?? []) as any[]) skip.add(String(p.id));

    const { data: published, error: targetsError } = await db
      .from("post_targets")
      .select("post_id")
      .eq("conta_id", conta_id)
      .eq("status", "publicado")
      .in("post_id", numericPart);
    if (targetsError) throw targetsError;
    for (const t of (published ?? []) as any[]) skip.add(String(t.post_id));
  }
```

The second `for` loop (cascade children, lines 257-269) and the `return` stay unchanged.

In `supabase/functions/hub-posts/handler.ts`, in the select at line 167, replace `tiktok_post_url, ` with nothing and append the embed before `workflows(titulo, created_at)`:

```ts
      .select("id, titulo, tipo, status, ordem, conteudo, conteudo_plain, scheduled_at, ig_caption, instagram_permalink, published_at, publish_error, platform, ig_trial_strategy, media_autocleaned_at, workflow_id, targets_state:post_targets(platform, permalink), workflows(titulo, created_at)")
```

Replace the flatten (lines 236-239):

```ts
    const flatPosts = (posts ?? []).map((post: any) => {
      const { workflows: workflow, ...rest } = post;
      return { ...rest, workflow_titulo: workflow?.titulo ?? null, workflow_created_at: workflow?.created_at ?? null };
    });
```

with:

```ts
    // P4: the TikTok URL lives on the TikTok destination (post_targets.permalink); the
    // response keeps the legacy field name so the Hub frontend does not change.
    const flatPosts = (posts ?? []).map((post: any) => {
      const { workflows: workflow, targets_state: targets, ...rest } = post;
      const tiktokTarget = Array.isArray(targets)
        ? targets.find((t: { platform?: string }) => t?.platform === "tiktok")
        : null;
      return {
        ...rest,
        tiktok_post_url: tiktokTarget?.permalink ?? null,
        workflow_titulo: workflow?.titulo ?? null,
        workflow_created_at: workflow?.created_at ?? null,
      };
    });
```

- [ ] **Step 4: Run the tests and the type gate and confirm they pass**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/data-import_test.ts supabase/functions/__tests__/hub-functions_test.ts supabase/functions/__tests__/hub-posts-modes_test.ts supabase/functions/__tests__/hub-posts-em-producao_test.ts
npm run check:functions
git checkout deno.lock
```

Expected:
- All four test files pass, including the existing `hub-posts-modes` and `hub-posts-em-producao` suites. They don't pin the select string.
- `check:functions` reports no error in `data-import/` or `hub-posts/`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/data-import/handler.ts supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/data-import_test.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(tiktok): data-import and hub-posts read the TikTok destination (P4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: CRM store adapter and destination-removal error

**Files:**
- Modify: `apps/crm/src/store/posts.ts`:
  - `:96-104` (`WorkflowPost` gains `tiktok_publish_processing_at`);
  - `:299-300` (`POST_CONTEXT_COLUMNS` plus the new embed and adapter just above it);
  - `:309-337` (`mapPostContextRow`);
  - `:564-572` (`getWorkflowPosts`), `:707-714` (`getAllWorkflowPosts`), `:716-752` (`getWorkflowPostsWithProperties`), `:1122-1135` (`getStandalonePost`).
- Modify: `apps/crm/src/store/postTargets.ts:112-119` (`removePostDestination`) and add `TargetNotRemovableError` after it.
- Modify: `apps/crm/src/pages/entregas/hooks/usePostDestinations.ts:60` (`onError`).
- Create: `apps/crm/src/store/__tests__/posts.tiktokTargetState.test.ts`
- Modify: `apps/crm/src/__tests__/store.posts.test.ts:792` (select pin), `apps/crm/src/store/__tests__/postTargets.test.ts` (one test after line 133), `apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx` (one test after the `onError` test)
- Test: the four test files above

**Interfaces:**
- Consumes:
  - the PostgREST embed `post_targets(platform,status,error,permalink,external_id,retry_count,processing_at)` (Task 1 schema; RLS SELECT for authenticated is unchanged);
  - the delete guard `P0409 target_not_removable` (Task 1).
- Produces (`apps/crm/src/store/posts.ts`, re-exported from `@/store`):
  - `TIKTOK_TARGET_STATE_EMBED = 'targets_state:post_targets(platform,status,error,permalink,external_id,retry_count,processing_at)'`.
  - `interface TikTokLegacyState { tiktok_publish_status; tiktok_publish_error: string | null; tiktok_post_url: string | null; tiktok_post_id: string | null; tiktok_publish_retry_count: number; tiktok_publish_processing_at: string | null; tiktok_publish_id: null }`. `tiktok_publish_status` is typed `WorkflowPost['tiktok_publish_status']`.
  - `tiktokLegacyState(targets: unknown): TikTokLegacyState`.
  - `applyTikTokTargetState<T extends object>(row: T): Omit<T, 'targets_state'> & TikTokLegacyState`.
  - `POST_CONTEXT_COLUMNS` no longer lists `tiktok_publish_status, tiktok_publish_error, tiktok_post_url`; it ends with `, ${TIKTOK_TARGET_STATE_EMBED}`.
- Produces (`apps/crm/src/store/postTargets.ts`): `class TargetNotRemovableError extends Error` with `name === 'TargetNotRemovableError'`. `removePostDestination` throws it on `P0409`.

**Reader audit** (spec §4: every `from('workflow_posts')` reader in `apps/crm/src` and `apps/hub/src`):

| Reader | Reads `tiktok_*` publish fields? | Coverage |
|---|---|---|
| `getScheduledPosts` (`posts.ts:346`), `getActivePosts` (`:398`), `getAwaitingClientePosts` (`:663`) | yes, via `POST_CONTEXT_COLUMNS` | covered: embed in `POST_CONTEXT_COLUMNS` + `mapPostContextRow` |
| `postProcesses.ts` `POST_EMBED` (`:125`) and `postEmbedInner` (`:178`) | yes, via `POST_CONTEXT_COLUMNS` | covered: same constant and mapper (nested embed) |
| `getWorkflowPosts` (`:564`), `getAllWorkflowPosts` (`:707`), `getWorkflowPostsWithProperties` (`:716`), `getStandalonePost` (`:1122`) | yes, `select('*')` | covered: embed + `applyTikTokTargetState` |
| `getClientePosts` (`:169`, `:175`), `getPostPreview` (`:202`), `searchPostsForMention` (`:239`), `getAssignedPendingPosts` (`:625`, `:634`), `getWorkflowPostsCounts` (`:761`) | no (explicit column lists without `tiktok_*`) | not applicable |
| `addWorkflowPost` (`:871`), `updateWorkflowPost` (`:903`), `createAvulsoPost` (`:960`) `.select()` returns | the returned row is used only for `id`, `maybeNudge` (`platform`, `scheduled_at`, `tiktok_settings`) and `scheduleApprovedPost` (`platform`, `scheduled_at`) | not applicable |
| `reorderWorkflowPosts` (`:1143`), `sendPostsToCliente`/`sendPostToCliente`/`approvePostsInternally`/`resetApprovedPostsForNextCycle` (`:1264-1309`), `postTargets.ts:106,140` (caption writes) | writes only | not applicable |
| `mensagens.ts:115` `getPostChipPreview` | no | not applicable |
| `apps/hub/src` | no `workflow_posts` query (reads the hub-posts response) | covered server-side by Task 7 |

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/store/__tests__/posts.tiktokTargetState.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  TIKTOK_TARGET_STATE_EMBED,
  applyTikTokTargetState,
  getActivePosts,
  getAllWorkflowPosts,
  getAwaitingClientePosts,
  getScheduledPosts,
  getStandalonePost,
  getWorkflowPosts,
  getWorkflowPostsWithProperties,
  mapPostContextRow,
  tiktokLegacyState,
} from '../posts';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    selectArgs?: unknown[][];
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown }>
  ) => void;
  __resetSupabaseMock: () => void;
};
const mocked = supabaseModule as MockedSupabaseModule;
const selects = () =>
  mocked
    .__getSupabaseCalls()
    .filter((c) => c.table === 'workflow_posts' && c.operation === 'select')
    .map((c) => String(c.selectArgs?.[0]?.[0]));

const target = (status: string, extra: Record<string, unknown> = {}) => ({
  platform: 'tiktok',
  status,
  error: null,
  permalink: null,
  external_id: null,
  retry_count: 0,
  processing_at: null,
  ...extra,
});

/** A raw row as select('*') returns it: frozen legacy columns + the destination embed. */
const frozenRow = (targets: unknown[]) => ({
  id: 7,
  workflow_id: 3,
  cliente_id: 9,
  titulo: 'P',
  tipo: 'reels',
  status: 'agendado',
  platform: 'tiktok',
  tiktok_publish_status: 'failed',
  tiktok_publish_error: 'velho',
  tiktok_post_url: 'https://velho',
  tiktok_post_id: 'velho',
  tiktok_publish_id: 'pub-velho',
  tiktok_publish_retry_count: 3,
  targets_state: targets,
});

describe('tiktokLegacyState (spec §1 mapping)', () => {
  it.each([
    ['pendente', null],
    ['agendado', null],
    ['processando', 'processing'],
    ['publicado', 'published'],
    ['falha', 'failed'],
  ])('maps %s to %s', (status, legacy) => {
    expect(tiktokLegacyState([target(status)]).tiktok_publish_status).toBe(legacy);
  });

  it('copies error, permalink, external_id, retry_count and processing_at', () => {
    expect(
      tiktokLegacyState([
        { platform: 'instagram', status: 'publicado' },
        target('falha', {
          error: 'boom',
          permalink: 'https://www.tiktok.com/@x/video/1',
          external_id: '1',
          retry_count: 2,
          processing_at: '2026-10-13T10:00:00Z',
        }),
      ]),
    ).toEqual({
      tiktok_publish_status: 'failed',
      tiktok_publish_error: 'boom',
      tiktok_post_url: 'https://www.tiktok.com/@x/video/1',
      tiktok_post_id: '1',
      tiktok_publish_retry_count: 2,
      tiktok_publish_processing_at: '2026-10-13T10:00:00Z',
      tiktok_publish_id: null,
    });
  });

  it('nulls everything when there is no TikTok destination (or no embed at all)', () => {
    const empty = {
      tiktok_publish_status: null,
      tiktok_publish_error: null,
      tiktok_post_url: null,
      tiktok_post_id: null,
      tiktok_publish_retry_count: 0,
      tiktok_publish_processing_at: null,
      tiktok_publish_id: null,
    };
    expect(tiktokLegacyState([{ platform: 'instagram', status: 'publicado' }])).toEqual(empty);
    expect(tiktokLegacyState(undefined)).toEqual(empty);
  });
});

describe('applyTikTokTargetState', () => {
  it('overwrites the frozen columns and strips the embed', () => {
    const out = applyTikTokTargetState(frozenRow([target('pendente')]));
    expect(out).not.toHaveProperty('targets_state');
    expect(out).toMatchObject({
      id: 7,
      titulo: 'P',
      tiktok_publish_status: null,
      tiktok_publish_error: null,
      tiktok_post_url: null,
      tiktok_post_id: null,
      tiktok_publish_id: null,
      tiktok_publish_retry_count: 0,
    });
  });
});

describe('loaders embed the TikTok destination and map it', () => {
  beforeEach(() => mocked.__resetSupabaseMock());

  it('getWorkflowPosts', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'select', {
      data: [frozenRow([target('publicado', { permalink: 'https://t/1' })])],
      error: null,
    });
    const [post] = await getWorkflowPosts(3);
    expect(selects()).toEqual([`*, ${TIKTOK_TARGET_STATE_EMBED}`]);
    expect(post.tiktok_publish_status).toBe('published');
    expect(post.tiktok_post_url).toBe('https://t/1');
    expect(post).not.toHaveProperty('targets_state');
  });

  it('getAllWorkflowPosts', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'select', {
      data: [frozenRow([target('falha', { error: 'boom', retry_count: 1 })])],
      error: null,
    });
    const [post] = await getAllWorkflowPosts();
    expect(selects()).toEqual([`*, ${TIKTOK_TARGET_STATE_EMBED}`]);
    expect(post.tiktok_publish_status).toBe('failed');
    expect(post.tiktok_publish_error).toBe('boom');
    expect(post.tiktok_publish_retry_count).toBe(1);
  });

  it('getWorkflowPostsWithProperties', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'select', {
      data: [{ ...frozenRow([target('processando')]), post_property_values: [], post_file_links: [] }],
      error: null,
    });
    const [post] = await getWorkflowPostsWithProperties(3);
    expect(selects()[0]).toContain(TIKTOK_TARGET_STATE_EMBED);
    expect(post.tiktok_publish_status).toBe('processing');
    expect(post).not.toHaveProperty('targets_state');
    expect(post.has_media).toBe(false);
  });

  it('getStandalonePost', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'select', {
      data: { ...frozenRow([]), workflow_id: null, clientes: { nome: 'Beto' } },
      error: null,
    });
    const post = await getStandalonePost(7);
    expect(selects()).toEqual([`*, clientes(nome), ${TIKTOK_TARGET_STATE_EMBED}`]);
    expect(post).toMatchObject({ cliente_nome: 'Beto', tiktok_publish_status: null, tiktok_post_url: null });
    expect(post).not.toHaveProperty('targets_state');
  });

  it('getScheduledPosts, getActivePosts and getAwaitingClientePosts (POST_CONTEXT_COLUMNS)', async () => {
    const row = {
      ...frozenRow([target('publicado', { permalink: 'https://t/2' })]),
      scheduled_at: '2026-10-13T10:00:00Z',
      workflows: { titulo: 'F', cliente_id: 9, status: 'ativo', clientes: { nome: 'C' } },
    };
    mocked.__queueSupabaseResult('workflow_posts', 'select', { data: [row], error: null }, { data: [], error: null });
    const [scheduled] = await getScheduledPosts('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    expect(scheduled.tiktok_publish_status).toBe('published');
    expect(scheduled.tiktok_post_url).toBe('https://t/2');

    mocked.__queueSupabaseResult('workflow_posts', 'select', { data: [row], error: null }, { data: [], error: null });
    const [active] = await getActivePosts();
    expect(active.tiktok_publish_status).toBe('published');

    mocked.__queueSupabaseResult(
      'workflow_posts',
      'select',
      { data: [{ ...row, status: 'enviado_cliente', created_at: '2026-10-01T00:00:00Z' }], error: null },
      { data: [], error: null },
    );
    const [awaiting] = await getAwaitingClientePosts();
    expect(awaiting.tiktok_post_url).toBe('https://t/2');

    for (const select of selects()) {
      expect(select).toContain(TIKTOK_TARGET_STATE_EMBED);
      expect(select).not.toMatch(/(^|[ ,])tiktok_publish_status/);
    }
  });

  it('mapPostContextRow (postProcesses embeds) maps the embed', () => {
    const post = mapPostContextRow({ ...frozenRow([target('falha', { error: 'x' })]), clientes: { nome: 'C' } });
    expect(post.tiktok_publish_status).toBe('failed');
    expect(post.tiktok_publish_error).toBe('x');
    expect(post).not.toHaveProperty('targets_state');
  });
});
```

In `apps/crm/src/__tests__/store.posts.test.ts`, replace line 792:

```ts
    expect(call.selectArgs).toContainEqual(['*, clientes(nome)']);
```

with:

```ts
    expect(call.selectArgs).toContainEqual([
      '*, clientes(nome), targets_state:post_targets(platform,status,error,permalink,external_id,retry_count,processing_at)',
    ]);
```

In `apps/crm/src/store/__tests__/postTargets.test.ts`:
- add `TargetNotRemovableError` to the `../postTargets` import list;
- after the test `'removePostDestination deletes one (post, platform) row'` (ends at line 133), insert:

```ts
  it('removePostDestination maps the delete guard (P0409) to TargetNotRemovableError', async () => {
    mocked.__queueSupabaseResult('post_targets', 'delete', {
      data: null,
      error: { code: 'P0409', message: 'target_not_removable' },
    });
    const err = await removePostDestination(9, 'tiktok').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TargetNotRemovableError);
    expect((err as Error).name).toBe('TargetNotRemovableError');
  });
```

In `apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx`, after the test `'onError toasts the destinations failure'`, insert:

```ts
  it('onError explains a destination that is publishing or published', async () => {
    vi.mocked(store.removePostDestination).mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'TargetNotRemovableError' }),
    );
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.toggle
        .mutateAsync({ platform: 'tiktok', on: false, seedCaption: null })
        .catch(() => {});
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Este destino já está publicando ou foi publicado e não pode ser removido.',
    );
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run apps/crm/src/store/__tests__/posts.tiktokTargetState.test.ts apps/crm/src/__tests__/store.posts.test.ts apps/crm/src/store/__tests__/postTargets.test.ts apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx
```

Expected:
- `posts.tiktokTargetState.test.ts` fails to import `TIKTOK_TARGET_STATE_EMBED` / `applyTikTokTargetState` (`undefined`).
- The `store.posts.test.ts` getStandalonePost pin fails.
- `postTargets.test.ts` fails because `TargetNotRemovableError` is undefined.
- The new hook test fails because it receives the generic toast `'Não foi possível atualizar os destinos.'`.

- [ ] **Step 3: Implement the adapter**

In `apps/crm/src/store/posts.ts`, in `interface WorkflowPost`, after `tiktok_publish_retry_count?: number;` (line 104) add:

```ts
  /** Lock of an in-flight TikTok publish (P4: post_targets.processing_at via the adapter). */
  tiktok_publish_processing_at?: string | null;
```

Replace `POST_CONTEXT_COLUMNS` (lines 299-300) with the embed, the adapter and the new constant:

```ts
/**
 * P4: TikTok publish state lives on the post's TikTok destination (post_targets). Loaders embed
 * it under this alias (no clash with getActivePosts' `post_targets(platform, status)` chips
 * embed) and project it onto the legacy tiktok_* field names, so components, postLabels and
 * polling keep their vocabulary. The workflow_posts.tiktok_* publish columns are frozen:
 * `select('*')` still returns them, and the adapter overwrites every one.
 */
export const TIKTOK_TARGET_STATE_EMBED =
  'targets_state:post_targets(platform,status,error,permalink,external_id,retry_count,processing_at)';

interface TikTokTargetStateRow {
  platform: string;
  status: string;
  error: string | null;
  permalink: string | null;
  external_id: string | null;
  retry_count: number | null;
  processing_at: string | null;
}

/** Destination status -> legacy tiktok_publish_status (spec §1). */
const TIKTOK_LEGACY_STATUS: Record<string, WorkflowPost['tiktok_publish_status']> = {
  pendente: null,
  agendado: null,
  processando: 'processing',
  publicado: 'published',
  falha: 'failed',
};

export interface TikTokLegacyState {
  tiktok_publish_status: WorkflowPost['tiktok_publish_status'];
  tiktok_publish_error: string | null;
  tiktok_post_url: string | null;
  tiktok_post_id: string | null;
  tiktok_publish_retry_count: number;
  tiktok_publish_processing_at: string | null;
  /** Frozen column; nothing reads it after P4. Nulled so a stale value never surfaces. */
  tiktok_publish_id: null;
}

/** Legacy tiktok_* fields from the `targets_state` embed; all null when there is no TikTok row. */
export function tiktokLegacyState(targets: unknown): TikTokLegacyState {
  const row = Array.isArray(targets)
    ? (targets as TikTokTargetStateRow[]).find((t) => t?.platform === 'tiktok')
    : undefined;
  return {
    tiktok_publish_status: row ? (TIKTOK_LEGACY_STATUS[row.status] ?? null) : null,
    tiktok_publish_error: row?.error ?? null,
    tiktok_post_url: row?.permalink ?? null,
    tiktok_post_id: row?.external_id ?? null,
    tiktok_publish_retry_count: row?.retry_count ?? 0,
    tiktok_publish_processing_at: row?.processing_at ?? null,
    tiktok_publish_id: null,
  };
}

/** Strips the `targets_state` embed and overwrites the frozen tiktok_* columns with it. */
export function applyTikTokTargetState<T extends object>(
  row: T,
): Omit<T, 'targets_state'> & TikTokLegacyState {
  const { targets_state, ...rest } = row as T & { targets_state?: unknown };
  return { ...(rest as Omit<T, 'targets_state'>), ...tiktokLegacyState(targets_state) };
}

export const POST_CONTEXT_COLUMNS = `id, workflow_id, cliente_id, titulo, tipo, status, custom_status_id, scheduled_at, published_at, ig_caption, instagram_permalink, publish_error, publish_error_code, ordem, responsavel_id, platform, instagram_media_id, ig_trial_strategy, board_ordem, ${TIKTOK_TARGET_STATE_EMBED}`;
```

In `mapPostContextRow` (line 309), make the first statement of the function body:

```ts
  const tiktok = tiktokLegacyState(row.targets_state);
```

Then replace the three lines:

```ts
    tiktok_publish_status: row.tiktok_publish_status ?? null,
    tiktok_publish_error: row.tiktok_publish_error ?? null,
    tiktok_post_url: row.tiktok_post_url ?? null,
```

with:

```ts
    tiktok_publish_status: tiktok.tiktok_publish_status,
    tiktok_publish_error: tiktok.tiktok_publish_error,
    tiktok_post_url: tiktok.tiktok_post_url,
```

To make `return {` the second statement, change `export function mapPostContextRow(row: any): ActivePost {\n  return {` into:

```ts
export function mapPostContextRow(row: any): ActivePost {
  const tiktok = tiktokLegacyState(row.targets_state);
  return {
```

Replace `getWorkflowPosts` (lines 564-572) with:

```ts
export async function getWorkflowPosts(workflowId: number): Promise<WorkflowPost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(`*, ${TIKTOK_TARGET_STATE_EMBED}`)
    .eq('workflow_id', workflowId)
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: WorkflowPost) => applyTikTokTargetState(row)) as WorkflowPost[];
}
```

Replace `getAllWorkflowPosts` (lines 707-714) with:

```ts
export async function getAllWorkflowPosts(): Promise<WorkflowPost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(`*, ${TIKTOK_TARGET_STATE_EMBED}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: WorkflowPost) => applyTikTokTargetState(row)) as WorkflowPost[];
}
```

In `getWorkflowPostsWithProperties`:
- change the first line inside the select template from `      *,` to:

```ts
      *,
      ${TIKTOK_TARGET_STATE_EMBED},
```

- change the mapper's return to spread the adapted row:

```ts
  return (data || []).map((post: any) => {
    const { post_property_values: rawPvs, post_file_links: rawMedia, ...rest } = post;
    return {
      ...applyTikTokTargetState(rest),
      has_media: Array.isArray(rawMedia) && rawMedia.length > 0,
      property_values: (rawPvs || []).map((pv: any) => ({
        id: pv.id,
        post_id: post.id,
        property_definition_id: pv.property_definition_id,
        value: pv.value,
        definition: pv.template_property_definitions,
      })),
    };
  });
```

Replace `getStandalonePost`'s select and return (lines 1122-1135):

```ts
export async function getStandalonePost(postId: number): Promise<StandalonePost | null> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(`*, clientes(nome), ${TIKTOK_TARGET_STATE_EMBED}`)
    .eq('id', postId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { clientes, ...rest } = data as WorkflowPost & {
    clientes: { nome: string } | null;
    targets_state?: unknown;
  };
  return {
    ...(applyTikTokTargetState(rest) as WorkflowPost),
    cliente_nome: clientes?.nome ?? '',
  };
}
```

In `apps/crm/src/store/postTargets.ts`, replace `removePostDestination` (lines 112-119) with:

```ts
export async function removePostDestination(postId: number, platform: PlatformId): Promise<void> {
  const { error } = await supabase
    .from('post_targets')
    .delete()
    .eq('post_id', postId)
    .eq('platform', platform);
  if (error) {
    // Guarda de DELETE (P4): destino publicando ou publicado não sai enquanto o post existe.
    if ((error as { code?: string }).code === 'P0409') throw new TargetNotRemovableError();
    throw error;
  }
}

/** O destino está publicando ou já foi publicado (P0409 target_not_removable, migration P4). */
export class TargetNotRemovableError extends Error {
  constructor() {
    super('Destino publicando ou publicado não pode ser removido.');
    this.name = 'TargetNotRemovableError';
  }
}
```

In `apps/crm/src/pages/entregas/hooks/usePostDestinations.ts`, replace line 60:

```ts
    onError: () => toast.error('Não foi possível atualizar os destinos.'),
```

with:

```ts
    // Pelo nome, não instanceof: os testes dos drawers mockam '@/store' com lista fixa.
    onError: (err) =>
      toast.error(
        err instanceof Error && err.name === 'TargetNotRemovableError'
          ? 'Este destino já está publicando ou foi publicado e não pode ser removido.'
          : 'Não foi possível atualizar os destinos.',
      ),
```

- [ ] **Step 4: Run the tests, typecheck and lint, and confirm they pass**

```bash
npx vitest run apps/crm/src/store/__tests__/posts.tiktokTargetState.test.ts apps/crm/src/__tests__/store.posts.test.ts apps/crm/src/store/__tests__/postTargets.test.ts apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx apps/crm/src/store/__tests__/postProcesses.test.ts apps/crm/src/store/__tests__/posts.awaitingCliente.test.ts
npx vitest run apps/crm/src/pages/entregas
npx tsc -p apps/crm/tsconfig.json --noEmit
npx eslint apps/crm/src/store/posts.ts apps/crm/src/store/postTargets.ts apps/crm/src/pages/entregas/hooks/usePostDestinations.ts apps/crm/src/store/__tests__/posts.tiktokTargetState.test.ts
npx prettier --check apps/crm/src/store/posts.ts apps/crm/src/store/postTargets.ts apps/crm/src/pages/entregas/hooks/usePostDestinations.ts apps/crm/src/store/__tests__/posts.tiktokTargetState.test.ts apps/crm/src/__tests__/store.posts.test.ts apps/crm/src/store/__tests__/postTargets.test.ts apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx
```

Expected:
- All tests pass, including the unchanged ScheduleButton, postLabels, postDestinations, PublicacoesPanel and DestinationStatusPill suites under `apps/crm/src/pages/entregas`. A failure in one of those means the adapter leaked; fix the adapter, not the test.
- `tsc`, `eslint` and `prettier --check` exit 0. Run `npx prettier --write <file>` on any file prettier flags.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/store/postTargets.ts apps/crm/src/pages/entregas/hooks/usePostDestinations.ts apps/crm/src/store/__tests__/posts.tiktokTargetState.test.ts apps/crm/src/__tests__/store.posts.test.ts apps/crm/src/store/__tests__/postTargets.test.ts apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx
git commit -m "feat(crm): read TikTok publish state from the destination (P4 adapter)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Ops scripts (pre-deploy report, reconcile) and the owner-gated deploy runbook

**Files:**
- Create: `scripts/tiktok-p4-predeploy.sql`
- Create: `scripts/tiktok-p4-reconcile.sql`
- Test: local verification commands in Step 4 (no CI suite: both scripts run once, by hand, against prod and staging)

**Interfaces:**
- Consumes:
  - `public.tiktok_legacy_target_status(text, text)` (Task 1; the reconcile script only);
  - the frozen `workflow_posts.tiktok_*` columns;
  - `workflow_posts.updated_at`, maintained by the `workflow_posts_updated_at` trigger (`20260402_workflow_posts.sql:51`).
- Produces: two single-result SQL scripts, compatible with `npx supabase db query --linked --file` (which returns only the last statement's result):
  - `tiktok-p4-predeploy.sql` → one `report` jsonb;
  - `tiktok-p4-reconcile.sql` → one `reconciled` jsonb `{ remapped: [{post_id, status}], filled: [post_id] }`.

- [ ] **Step 1: Run the verification and confirm it fails**

```bash
npx supabase db reset
psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f scripts/tiktok-p4-predeploy.sql
```

Expected: FAIL with `scripts/tiktok-p4-predeploy.sql: No such file or directory`.

- [ ] **Step 2: Write the pre-deploy report**

Create `scripts/tiktok-p4-predeploy.sql`:

```sql
-- P4 pré-deploy (TikTok publish state em post_targets): relatório SOMENTE LEITURA.
-- Rodar em prod e em staging ANTES de aplicar 20261014000001..3:
--   npx supabase link --project-ref <ref> < /dev/null
--   npx supabase db query --linked --file scripts/tiktok-p4-predeploy.sql
-- (só a última statement volta: o relatório inteiro é um SELECT).
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 9).
--
-- O que bloqueia a migration (o DO de paridade aborta):
--   * tiktok_targets_on_stories não vazio -> remediação abaixo, com OK do owner;
--   * tiktok_both_without_one_target / tiktok_target_on_other_post não vazios -> drift de P1,
--     investigar antes (não há remediação automática).
-- O que precisa de ação antes do passo 2 do deploy:
--   * in_flight_posts não vazio -> terminar (aguardar o cron) ou limpar antes.
--   * instagram_post_without_target / instagram_target_on_other_post não vazios -> drift de
--     P1 no lado Instagram. Não derruba a migration (o recompute conta o Instagram pelo
--     platform legado OU pela linha de destino), mas investigar antes: o P5 vai ler só a linha.
-- Informativo: legacy_status_counts, duplicate_publish_ids (esperado vazio),
--   failed_outside_publication (viram pendente pela regra de reset do backfill).
SELECT jsonb_pretty(jsonb_build_object(
  'legacy_status_counts', (
    SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
      SELECT COALESCE(tiktok_publish_status, 'NULL') AS k, count(*) AS n
        FROM public.workflow_posts
       WHERE platform IN ('tiktok','both')
       GROUP BY 1) s),
  'in_flight_posts', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'post_id', id, 'status', status, 'tiktok_publish_status', tiktok_publish_status,
             'tiktok_publish_processing_at', tiktok_publish_processing_at) ORDER BY id), '[]'::jsonb)
      FROM public.workflow_posts
     WHERE tiktok_publish_status IN ('initiated','processing')),
  'duplicate_publish_ids', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('tiktok_publish_id', tiktok_publish_id, 'post_ids', ids)), '[]'::jsonb)
      FROM (SELECT tiktok_publish_id, array_agg(id ORDER BY id) AS ids
              FROM public.workflow_posts
             WHERE tiktok_publish_id IS NOT NULL
             GROUP BY 1 HAVING count(*) > 1) d),
  'tiktok_targets_on_stories', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'post_id', t.post_id, 'target_status', t.status, 'post_status', wp.status,
             'platform', wp.platform, 'tiktok_publish_status', wp.tiktok_publish_status) ORDER BY t.post_id), '[]'::jsonb)
      FROM public.post_targets t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
     WHERE t.platform = 'tiktok' AND wp.tipo = 'stories'),
  'tiktok_both_without_one_target', (
    SELECT COALESCE(jsonb_agg(wp.id ORDER BY wp.id), '[]'::jsonb)
      FROM public.workflow_posts wp
     WHERE wp.platform IN ('tiktok','both')
       AND (SELECT count(*) FROM public.post_targets t
             WHERE t.post_id = wp.id AND t.platform = 'tiktok') <> 1),
  'tiktok_target_on_other_post', (
    SELECT COALESCE(jsonb_agg(t.post_id ORDER BY t.post_id), '[]'::jsonb)
      FROM public.post_targets t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
     WHERE t.platform = 'tiktok' AND wp.platform NOT IN ('tiktok','both')),
  'instagram_post_without_target', (
    SELECT COALESCE(jsonb_agg(wp.id ORDER BY wp.id), '[]'::jsonb)
      FROM public.workflow_posts wp
     WHERE wp.platform IN ('instagram','both')
       AND NOT EXISTS (SELECT 1 FROM public.post_targets t
                        WHERE t.post_id = wp.id AND t.platform = 'instagram')),
  'instagram_target_on_other_post', (
    SELECT COALESCE(jsonb_agg(t.post_id ORDER BY t.post_id), '[]'::jsonb)
      FROM public.post_targets t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
     WHERE t.platform = 'instagram' AND wp.platform NOT IN ('instagram','both')),
  'legacy_state_without_target', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'post_id', wp.id, 'platform', wp.platform, 'tiktok_publish_status', wp.tiktok_publish_status) ORDER BY wp.id), '[]'::jsonb)
      FROM public.workflow_posts wp
     WHERE wp.tiktok_publish_status IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.post_targets t
                        WHERE t.post_id = wp.id AND t.platform = 'tiktok')),
  'failed_outside_publication', (
    SELECT count(*)
      FROM public.workflow_posts
     WHERE platform IN ('tiktok','both')
       AND tiktok_publish_status = 'failed'
       AND status NOT IN ('agendado','falha_publicacao','postado'))
)) AS report;

-- REMEDIAÇÃO (só com OK explícito do owner, e só se tiktok_targets_on_stories vier não
-- vazio). Tira o destino TikTok PENDENTE de posts stories (P1 semeou sem filtrar tipo,
-- 20261010100002:110-115). post_targets_sync_platform recalcula o platform do post.
-- Um destino que não esteja pendente aparece no relatório e exige decisão caso a caso.
-- Rodar como arquivo separado, ANTES de aplicar as migrations:
--
-- DELETE FROM public.post_targets t
--  USING public.workflow_posts wp
--  WHERE wp.id = t.post_id AND t.platform = 'tiktok' AND wp.tipo = 'stories'
--    AND t.status = 'pendente'
-- RETURNING t.post_id;
```

- [ ] **Step 3: Write the reconcile script**

Create `scripts/tiktok-p4-reconcile.sql`:

```sql
-- P4 reconcile (TikTok publish state em post_targets). Passo 4 do deploy (spec §5):
-- rodar UMA vez, logo depois do deploy das functions, em prod (e staging, por paridade):
--   npx supabase link --project-ref <ref> < /dev/null
--   npx supabase db query --linked --file <cópia editada deste arquivo>
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 9).
--
-- Reaplica o mapeamento do backfill SÓ onde as colunas congeladas ganharam estado que o
-- destino não tem, escrito por uma versão antiga de função entre a migration e o deploy:
--   * remapped: destino ainda pendente com tiktok_publish_status não nulo (publish-now antigo,
--     falha antiga do webhook, tiktok-publish/handler.ts:536-560 antes de P4);
--   * filled:   destino publicado sem external_id/permalink enquanto tiktok_post_id/url têm
--     valor (publicly_available do webhook antigo, tiktok-webhook/handler.ts:252-301).
-- Janela: só posts com workflow_posts.updated_at >= window_start (o instante anotado no
-- passo 2, antes de aplicar a migration). Sem ela, um 'failed' legado de um post re-agendado
-- depois voltaria como falha (bug 3), e um permalink limpo de propósito voltaria.
-- Idempotente: na segunda execução nada casa (remapped exige destino pendente; filled exige
-- campo nulo). Não move status de post: as versões antigas já moveram junto da escrita legada.
--
-- LIMITE CONHECIDO: só destino PENDENTE é remapeado. Um destino re-enfileirado (agendado)
-- que um publicar-agora ANTIGO derrubou dentro da janela (escreveu tiktok_publish_status =
-- 'failed' nas colunas congeladas) NÃO é remapeado: continua agendado e o cron novo o
-- publica de novo no próximo ciclo. É aceito porque o TikTok está escuro fora do DK TESTE e
-- o owner segura publicações entre os passos 2 e 5; se o relatório de antes mostrar uma
-- linha assim, decidir à mão.
--
-- EDITAR ANTES DE RODAR: troque o valor abaixo pelo instante anotado no passo 2 do runbook
-- (ISO 8601 com fuso). O valor de fábrica não é uma data e faz o script falhar de propósito.
SELECT set_config('p4.window_start', 'DEFINA-O-INSTANTE-DO-PASSO-2', false);

WITH params AS (
  SELECT current_setting('p4.window_start')::timestamptz AS window_start
),
src AS (
  SELECT wp.id, wp.tiktok_publish_status, wp.tiktok_publish_id, wp.tiktok_post_id,
         wp.tiktok_post_url, wp.tiktok_publish_error, wp.tiktok_publish_retry_count,
         wp.published_at,
         public.tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) AS st
    FROM public.workflow_posts wp, params p
   WHERE wp.updated_at >= p.window_start
),
remap AS (
  UPDATE public.post_targets t SET
    status        = s.st,
    publish_ref   = CASE WHEN s.st IN ('processando','publicado','falha') THEN s.tiktok_publish_id END,
    external_id   = COALESCE(t.external_id, s.tiktok_post_id),
    permalink     = COALESCE(t.permalink, s.tiktok_post_url),
    error         = CASE WHEN s.st = 'falha' THEN s.tiktok_publish_error END,
    retry_count   = CASE WHEN s.st = 'falha' THEN COALESCE(s.tiktok_publish_retry_count, 0) ELSE t.retry_count END,
    processing_at = NULL,
    published_at  = CASE WHEN s.st = 'publicado' THEN COALESCE(t.published_at, s.published_at, now()) END,
    updated_at    = now()
  FROM src s
  WHERE t.post_id = s.id AND t.platform = 'tiktok'
    AND t.status = 'pendente'
    AND s.tiktok_publish_status IS NOT NULL
    AND s.st <> 'pendente'
  RETURNING t.post_id, t.status
),
fill AS (
  UPDATE public.post_targets t SET
    external_id = COALESCE(t.external_id, s.tiktok_post_id),
    permalink   = COALESCE(t.permalink, s.tiktok_post_url),
    updated_at  = now()
  FROM src s
  WHERE t.post_id = s.id AND t.platform = 'tiktok' AND t.status = 'publicado'
    AND ((t.external_id IS NULL AND s.tiktok_post_id IS NOT NULL)
         OR (t.permalink IS NULL AND s.tiktok_post_url IS NOT NULL))
  RETURNING t.post_id
)
SELECT jsonb_build_object(
  'remapped', (SELECT COALESCE(jsonb_agg(jsonb_build_object('post_id', post_id, 'status', status) ORDER BY post_id), '[]'::jsonb) FROM remap),
  'filled',   (SELECT COALESCE(jsonb_agg(post_id ORDER BY post_id), '[]'::jsonb) FROM fill)
) AS reconciled;
```

- [ ] **Step 4: Verify both scripts locally**

```bash
DB="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
npx supabase db reset
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/tiktok-p4-predeploy.sql

# Reconcile against a fixture: the "old function" writes frozen columns after the window opens.
SCRATCH="$(mktemp -d)"
sed "s/DEFINA-O-INSTANTE-DO-PASSO-2/2000-01-01T00:00:00Z/" scripts/tiktok-p4-reconcile.sql > "$SCRATCH/reconcile.sql"
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
\i supabase/tests/entitlements/_helpers.sql
begin;
create temp table p4_fix as select et_make_workspace('pro') as ws, gen_random_uuid() as uid;
insert into auth.users (id) select uid from p4_fix on conflict do nothing;
insert into clientes (conta_id, user_id, nome, sigla, cor) select ws, uid, 'C', 'C', '#000' from p4_fix;
insert into workflows (conta_id, cliente_id, user_id, titulo, status)
  select f.ws, c.id, f.uid, 'W', 'ativo' from p4_fix f join clientes c on c.conta_id = f.ws;
insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status, platform)
  select w.id, w.conta_id, 'old-failed', 'feed', 'falha_publicacao', 'tiktok'
    from workflows w join p4_fix f on f.ws = w.conta_id;
update workflow_posts set tiktok_publish_status = 'failed', tiktok_publish_id = 'pub-old',
       tiktok_publish_error = 'boom', tiktok_publish_retry_count = 1
 where titulo = 'old-failed';
commit;
SQL
psql "$DB" -v ON_ERROR_STOP=1 -f "$SCRATCH/reconcile.sql"
psql "$DB" -v ON_ERROR_STOP=1 -f "$SCRATCH/reconcile.sql"
psql "$DB" -v ON_ERROR_STOP=1 -f scripts/tiktok-p4-reconcile.sql || echo "unedited script refused, as intended"
npx supabase db reset
```

Run every command from the repo root: the fixture's `\i` path is relative to the CWD, as in `scripts/test-entitlements.sh`. `_helpers.sql` provides `et_make_workspace`, the same fixture helper `supabase/tests/tiktok_publishing_rpcs.sql` uses.

Expected:
1. The pre-deploy report prints JSON whose `in_flight_posts`, `duplicate_publish_ids`, `tiktok_targets_on_stories`, `tiktok_both_without_one_target`, `tiktok_target_on_other_post`, `instagram_post_without_target` and `instagram_target_on_other_post` are `[]` on the seed database.
2. The first reconcile run prints `remapped` with one `{"post_id": <id>, "status": "falha"}`.
3. The second run prints `{"filled": [], "remapped": []}` (idempotent).
4. The unedited script fails with `invalid input syntax for type timestamp with time zone: "DEFINA-O-INSTANTE-DO-PASSO-2"` and prints `unedited script refused, as intended`.
5. The final `db reset` removes the fixture.

- [ ] **Step 5: Commit**

```bash
git add scripts/tiktok-p4-predeploy.sql scripts/tiktok-p4-reconcile.sql
git commit -m "chore(ops): P4 pre-deploy report and reconcile scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Deploy runbook (OWNER-GATED: implementers stop here and hand this to the owner)**

The steps follow spec §5. Prod is `skjzpekeqefvlojenfsw` and staging is `wlyzhyfondykzpsiqsce` (memory `reference_supabase_project_refs`). Nothing below runs without the owner's explicit OK, step by step.

1. **Deploy from a guaranteed checkout.** Deploy from the PR branch head after it is rebased on `origin/main`, never from a stale worktree (memory `feedback_deploy_from_stale_worktree_regresses_prod`):

   ```bash
   git fetch origin main
   git diff --stat origin/main...HEAD -- supabase/functions/ supabase/migrations/ scripts/
   ```

   The diff must list only this plan's files.

2. **Pre-deploy report**, on prod, then staging:

   `db query --linked` runs against whichever project the worktree is linked to, so link first, exactly as step 3 does. Do not rely on `--project-ref` for `db query`. A fresh worktree is unlinked (memory `reference_edge_deploy_from_unlinked_worktree`).

   ```bash
   npx supabase link --project-ref skjzpekeqefvlojenfsw < /dev/null
   npx supabase db query --linked --file scripts/tiktok-p4-predeploy.sql
   npx supabase link --project-ref wlyzhyfondykzpsiqsce < /dev/null
   npx supabase db query --linked --file scripts/tiktok-p4-predeploy.sql
   ```

   - Act on the report as the script header says.
   - If `tiktok_targets_on_stories` is not empty, run the commented `DELETE` from the script as a separate file, with the owner's OK (link to that project first).
   - The owner holds off TikTok publishing (DK TESTE) from here until step 5 ends. Between the `db push` (step 3) and the reconcile (step 5), do not publish, cancel, move or reschedule TikTok posts: the reconcile's window cannot tell new-code writes from old-function writes on the same post, and a frozen legacy `processing`/`published` on a post the new code cancelled and the user rescheduled would still be remapped.
   - **Write down the current time** on prod. It is the reconcile `window_start`:

     ```bash
     npx supabase link --project-ref skjzpekeqefvlojenfsw < /dev/null
     printf 'select now();\n' > <scratch>/now.sql
     npx supabase db query --linked --file <scratch>/now.sql
     ```

3. **Migrations**, staging first, then prod. Check that the env is healthy first (memory `reference_staging_ops_management_api`):

   ```bash
   npx supabase link --project-ref wlyzhyfondykzpsiqsce < /dev/null
   npx supabase db push --linked --dry-run
   npx supabase db push --linked
   npx supabase link --project-ref skjzpekeqefvlojenfsw < /dev/null
   npx supabase db push --linked --dry-run
   npx supabase db push --linked
   ```

   The dry runs must list exactly `20261014000001`, `20261014000002` and `20261014000003`. If `db push` refuses because of drift, follow the out-of-band path in that memory. A parity exception aborts the whole migration: read the message, fix the data, retry. A `lock_timeout` abort on a busy DB is retried the same way as a parity abort.

   **Verify the push really applied the DDL**, on each project right after its `db push` (a committed version row with rolled-back DDL has happened before, memory `reference_db_push_batch_rollback_drift`):

   ```bash
   printf "select proname from pg_proc where proname in ('claim_tiktok_targets_for_publishing','begin_target_publish','mark_target_failed','requeue_target','cancel_target_publish','recompute_post_publish_status');\n" > <scratch>/ddl-check.sql
   npx supabase db query --linked --file <scratch>/ddl-check.sql
   ```

   Expect 6 rows. If fewer, stop and re-run the push before anything else.

   **Run the reconcile once now** (step 5 has the command), right after the DDL check passes on prod and before the function deploys. Until the new cron is live, an old publish-now can leave a `pendente` destination with no `publish_ref` that the new cron would re-publish; this first pass closes that window. The reconcile is idempotent, so step 5 runs it again.

4. **Functions, right away, on prod.** Check `verify_jwt` first:
   - `supabase/config.toml` has no `[functions.data-import]` and no `[functions.tiktok-publish]` entry, so both keep gateway JWT verification and deploy without `--no-verify-jwt`.
   - The other three have `verify_jwt = false`.

   ```bash
   npx supabase functions deploy tiktok-publish --project-ref skjzpekeqefvlojenfsw --use-api
   npx supabase functions deploy tiktok-publish-cron --project-ref skjzpekeqefvlojenfsw --use-api --no-verify-jwt
   npx supabase functions deploy tiktok-webhook --project-ref skjzpekeqefvlojenfsw --use-api --no-verify-jwt
   npx supabase functions deploy hub-posts --project-ref skjzpekeqefvlojenfsw --use-api --no-verify-jwt
   npx supabase functions deploy data-import --project-ref skjzpekeqefvlojenfsw --use-api
   ```

   Before deploying `data-import`, the owner confirms its live `verify_jwt` (Dashboard > Edge Functions > data-import > "Enforce JWT verification", on prod and on staging). If it is off, add `--no-verify-jwt` to its two deploy lines, so the deploy keeps the current value instead of flipping it (Deviation 8).

   Staging parity (staging has no TikTok functions):

   ```bash
   npx supabase functions deploy hub-posts --project-ref wlyzhyfondykzpsiqsce --use-api --no-verify-jwt
   npx supabase functions deploy data-import --project-ref wlyzhyfondykzpsiqsce --use-api
   ```

   Smoke-test each one with an invalid bearer. A healthy function answers 401 (or the webhook's 200 drop); a boot failure answers 5xx.

5. **Reconcile again** (prod; staging optional), after the function deploys of step 4. This is the second run (the first is in step 3); the reconcile is idempotent. Copy `scripts/tiktok-p4-reconcile.sql` to a scratch file, replace `DEFINA-O-INSTANTE-DO-PASSO-2` with the time from step 2, then run:

   ```bash
   npx supabase link --project-ref skjzpekeqefvlojenfsw < /dev/null
   npx supabase db query --linked --file <scratch>/reconcile.sql
   ```

   Run it once more right after: that run must return `{"filled": [], "remapped": []}`.

6. **Check that the CRM's double `post_targets` embed parses on real PostgREST, before merging.** `getActivePosts` in `apps/crm/src/store/posts.ts` selects `targets_state:post_targets(...)` and plain `post_targets(platform, status)` in one select. Verify it either with a Vercel preview of the PR (it only selects P1 columns, so it works against prod before or after the migration) or by running the PR branch's CRM against staging. Open Entregas visão geral, a post drawer and a client's posts tab with the network tab open. Any 400 on `workflow_posts` blocks the merge.

7. **Merge the PR.** The frontend deploys with the merge (memory `feedback_merge_deploys_frontend_migrations_first`).

8. **End-to-end check on prod with DK TESTE:**
   - a TikTok-only video post goes through publish-now, then schedule, then a forced failure (for example, media over the creator's duration limit), then Reenviar;
   - one Instagram+TikTok post goes through "Publicar agora";
   - one Instagram+TikTok post is moved back to draft mid-publish (after TikTok lands, before Instagram does), then rescheduled: scheduling succeeds, TikTok is not published again, and the post reaches `postado` when Instagram lands (Deviation 18).

   Confirm that the post status, the TikTok chip and the Hub link match `post_targets`:

   ```sql
   select post_id, status, publish_ref, external_id, permalink, error, retry_count from post_targets where platform = 'tiktok' order by updated_at desc limit 5;
   ```

**Emergency stop** (spec "Rollback"): unschedule the TikTok cron's `pg_cron` job. Instagram is unaffected. There is no down migration.

---

### Task 10: Final gates before the PR

**Files:**
- No new files. If a gate fails, fix the file it names, inside the task that owns that file (see the File map), and commit with that task's scope.
- Test: every CI gate from `.github/workflows/ci.yml` (CLAUDE.md "What CI actually runs").

**Interfaces:**
- Consumes: everything from Tasks 1-9, committed.
- Produces: a branch that passes every CI gate locally, with migration versions that don't collide with `origin/main`.

- [ ] **Step 1: Look for stale references and confirm they fail the audit**

```bash
grep -rn "claim_posts_for_tiktok_publishing\|tiktok_publish_status\|tiktok_publish_id\|tiktok_post_url" \
  supabase/functions --include=*.ts | grep -v "__tests__" || true
grep -rln "tiktok_publish_status\|claim_posts_for_tiktok_publishing\|mark_platform_published" \
  supabase/functions/__tests__ apps/crm/src/__tests__ apps/crm/src/store/__tests__ apps/hub/src 2>/dev/null || true
```

Expected before the fixes from Tasks 4-8: the first command lists writers in `tiktok-publish/handler.ts`, `tiktok-publish-cron/core.ts`, `tiktok-webhook/handler.ts` and `_shared/tiktok-publish-utils.ts`. After them, the only remaining hits are:
- `hub-posts/handler.ts`, where `tiktok_post_url` is the response key, not a column read;
- the CRM adapter's `tiktok_publish_*` field names in `apps/crm/src/store/posts.ts` (they are the legacy shape that Task 8's adapter fills in on purpose);
- in the Hub, `apps/hub/src/types.ts`, `PostTile.tsx` and `PostDetailDialog.tsx` read the `tiktok_post_url` field of the `hub-posts` response. That field keeps its name and is now filled from the destination's `permalink` (Task 7), so these are expected and need no change.

Any other hit is a missed writer or reader. Each test file from the second command must be one that Tasks 3-8 already updated (contract changes break tests in both suites, memory `feedback_contract_change_update_existing_tests`).

- [ ] **Step 2: Restore node_modules if a Deno run polluted it**

```bash
ls node_modules/.deno 2>/dev/null && npm ci || echo "node_modules clean"
git status --porcelain deno.lock
```

Expected: `node_modules clean` (or a finished `npm ci`), and no `deno.lock` line. If `deno.lock` shows up, run `git checkout deno.lock`.

- [ ] **Step 3: Run the Node gates**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: every command exits 0. If `format:check` fails, run `npm run format` and commit the result with the owning task's scope.

- [ ] **Step 4: Run the Deno gates (last, because they write to node_modules)**

```bash
npm run check:functions
npm run test:functions
git checkout deno.lock
ls node_modules/.deno 2>/dev/null && npm ci || echo "node_modules clean"
```

Expected: `check:functions` reports no type errors; `test:functions` reports `ok` with `0 failed`. After restoring, `git status --porcelain` lists nothing.

- [ ] **Step 5: Run the psql suites (needs Docker or colima, memory `reference_local_supabase_colima`)**

```bash
npx supabase db reset
bash scripts/test-entitlements.sh
```

Expected: one `PASS` per file, including `post_targets_publish_state.sql`, `tiktok_publishing_rpcs.sql`, `post_file_link_replace.sql`, `70_workflow_posts_avulsos.sql` and `99_post_targets.sql`, and exit 0. Without Docker, skip this step and say so in the PR. CI's `entitlement-tests` job gates it either way.

- [ ] **Step 6: Check migration versions against main right before opening the PR**

```bash
git fetch origin main
ls supabase/migrations/ | cut -d_ -f1 | sort | uniq -d
git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -1
```

Expected:
- the `uniq -d` command prints nothing;
- main's last migration sorts below `20261014000001`.

If main has moved past it (memory `feedback_migration_version_collision`), renumber the three migrations above main's tail with `git mv`, update every reference to the old file names in the plan and in comments, rerun Step 5, and commit with `chore(db): renumber P4 migrations above main`.

- [ ] **Step 7: Commit any fixes made by the gates**

```bash
git status --porcelain
```

Expected: nothing listed. If a gate made you change a file, it was committed in that step under the owning task's scope (for example `git add supabase/functions/tiktok-publish/handler.ts && git commit -m "fix(tiktok-publish): <what the gate caught>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`). The PR (with the body ending in the Claude Code attribution line) is opened by the owner or the orchestrator, not by this task. Deploy follows Task 9 Step 6, before the merge.
