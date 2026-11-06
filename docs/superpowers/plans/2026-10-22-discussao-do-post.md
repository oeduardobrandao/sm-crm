# Discussão da equipe dentro do post: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every post an internal team discussion in the editor (general thread + text-anchored comment cards in one timeline), with participant notifications, per-user unread for participants, and a "Discutir no chat" bridge into the team chat.

**Architecture:** The general thread is a `post_comment_threads` row with `field = 'geral'`, guarded in the database by restrictive policies and triggers. Participation and read markers live per post in `post_discussao_participantes`, written only by SECURITY DEFINER RPCs and triggers. A coalescing `post_discussion` notification trigger ships in a separate migration applied after the frontend deploy. The frontend adds one timeline builder (pure), one hook (data + realtime + read marker), one desktop section, the phone Equipe/Cliente split, badges, a deep link, and the chat bridge.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS, realtime), React 19, TanStack Query, TipTap `MentionEditor`, Vitest + Testing Library, psql suites run by `scripts/test-entitlements.sh`.

**Spec:** `docs/superpowers/specs/2026-10-22-discussao-do-post-design.md` (read it before any task). Mockups: https://claude.ai/artifact/41GPU3e2Qaazsg3R72THuH

## Global Constraints

- All user-facing copy is pt-BR, sentence case, **no em dashes** (period or colon instead).
- Exact copy from the spec: "Discussão da equipe", "Só a equipe vê", "Seguindo" / "Seguir", "Discutir no chat", "Escreva para a equipe. Use @ para mencionar.", "Quem participa da discussão recebe aviso. Enter envia, Shift+Enter quebra a linha.", "Não lidas", "Ver no texto", "N respostas" / "N novas", "N comentários no texto resolvidos", "Excluir mensagem?", "Conversa com o cliente", "O cliente vê", "Equipe · N novas", "Cliente", "Só a equipe vê esta conversa.", "Mensagem para a equipe", "Levar este post para o chat", "A mensagem vai com um link para o post.", "Buscar conversa ou pessoa", "Grupos", "Pessoas", "Mensagem para <nome>", "Cancelar", "Enviar para <nome>", "Enviado para <nome>.", "Abrir conversa", "Não foi possível enviar. Tente novamente.", "Abrir na discussão do post", "Mensagem na discussão de um post".
- Message content: 1 to 4000 characters after trim.
- Icons `lucide-react` only; toasts via `toast()` from `sonner`; colours only via existing tokens (light and `[data-theme='dark']`).
- Migration versions must sort above main's tail (today `20261024000010`); renumber before `gh pr create` if main moved.
- Notification type lists are copied from the **latest** definition (today `20261021100000_equipe_chat_core.sql` and `20261021103000_team_message_inapp_pref.sql`) and only append `'post_discussion'`; `team_message` must survive.
- RPC grants: `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role;` then `GRANT EXECUTE … TO authenticated;`.
- Never `useBlocker`. Unsent draft or in-flight send in the drawer registers `useUnsavedWork` (`@mesaas/app-lifecycle`, see `packages/app-lifecycle/src/use-unsaved-work.ts`).
- "Discutir no chat" renders only when `isUnlimited || features?.feature_team_chat === true` (`useWorkspaceLimits()`), fail-closed.
- Phone panes stay mounted and hidden (never unmount a composer with a draft).
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`, and `bash scripts/test-entitlements.sh` (local Supabase on colima).

## Review Focus

1. **Send fails (network, RLS, deleted post):** the composer keeps the text, shows "Não foi possível enviar. Tente novamente.", and nothing is half-written. Test lives in Task 7.
2. **Switching between expanded posts quickly:** the realtime channel of the previous post is removed and no events for it invalidate the new post. Test in Task 6.
3. **Post with no responsável and nobody following:** sending works, no notification row is created, no warning-swallowed error leaves state inconsistent. Test in Task 3.
4. **A user removed from the workspace who still has a participant row:** gets no `post_discussion`, and `get_post_discussao_nao_lidas` called by them returns nothing for the old workspace. Test in Task 3 / Task 2.
5. **Editing a message to empty or deleting the last message of the general thread:** empty edit is refused in the UI (Salvar disabled); deleting the last message leaves the thread row and the timeline shows the empty state, no crash. Test in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261025000001_post_discussao_geral.sql` | `field = 'geral'`, constraint, unique index, restrictive policies, guard triggers |
| `supabase/migrations/20261025000002_post_discussao_participantes.sql` | participants table + RLS, the four RPCs, realtime publication, both notification type lists |
| `supabase/migrations/20261025000003_post_discussao_notify.sql` | **applied after the frontend deploy**: participant triggers, `post_discussion` notify trigger, `trg_notify_mention` link, backfill |
| `supabase/tests/entitlements/99_post_discussao.sql` | psql suite for all three migrations |
| `apps/crm/src/store/comments.ts` | types + discussion store functions |
| `apps/crm/src/pages/entregas/discussao/timeline.ts` | pure timeline builder |
| `apps/crm/src/pages/entregas/discussao/useDiscussao.ts` | participation query, realtime, read marker, send/follow mutations |
| `apps/crm/src/pages/entregas/discussao/usePostDiscussaoNaoLidas.ts` | batch unread query for drawers and board |
| `apps/crm/src/pages/entregas/discussao/DiscussaoEquipe.tsx` | desktop section (and the shared timeline list used on phone) |
| `apps/crm/src/pages/entregas/discussao/DiscutirNoChat.tsx` | bridge popover/sheet |
| `apps/crm/app.css` | new `.discussao-*` rules next to `.comment-summary` (signed-in only, so app.css per DESIGN_SYSTEM.md) |
| `apps/crm/src/pages/mensagens/components/PostChipsBelow.tsx` | post blocks under a chat message |

---

### Task 1: Migration A, the general thread and its database guarantees

**Files:**
- Create: `supabase/migrations/20261025000001_post_discussao_geral.sql`
- Create: `supabase/tests/entitlements/99_post_discussao.sql` (sections 99.1–99.3)

**Interfaces:**
- Produces: `post_comment_threads.field` accepts `'geral'`; index `post_comment_threads_geral_uq`; restrictive policies `post_comment_threads_no_geral_insert`, `post_comments_author_is_self`, `post_comments_geral_author_update`, `post_comments_geral_author_delete`; trigger functions `trg_post_comment_threads_geral_guard_update()`, `trg_post_comment_threads_geral_guard_delete()`.

- [ ] **Step 1: Write the failing psql sections**

Follow `98_caption_comment_anchors.sql` (seed as postgres, impersonate with `set local role authenticated` + `request.jwt.claims`, `et_grant_hosted_parity()`, one `begin … rollback` per section, `raise notice 'PASS 99.x …'`).
- 99.1 constraint: as postgres, a `geral` row with `quoted_text = ''`, null anchors, `status = 'active'` inserts; `geral` with `quoted_text = 'x'`, with anchors, with `orphaned = true`, or with `status = 'resolved'` each raise `check_violation`; a second `geral` row for the same post raises `unique_violation`; legacy `conteudo` and `ig_caption` rows still insert.
- 99.2 guards as `authenticated` member of A: direct INSERT of a `geral` thread fails (`insufficient_privilege` / RLS); UPDATE of a `geral` thread's `field`, `status`, `post_id` or `conta_id` raises; UPDATE of a `conteudo` thread's `status` still works; DELETE of a `geral` thread raises while the post exists; `delete from workflow_posts where id = v_post` (as postgres) removes the `geral` thread by cascade.
- 99.3 comments as `authenticated`: INSERT into any thread with `author_id` of another user fails; with own `author_id` succeeds; UPDATE/DELETE of another user's message in a `geral` thread affects 0 rows; UPDATE of another user's message in a `conteudo` thread still succeeds (legacy, non-goal).

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh 2>&1 | grep 99_post_discussao`
Expected: FAIL on 99.1 (`geral` violates the old CHECK).

- [ ] **Step 3: Write the migration**

- Drop and re-add the `field` CHECK with `('conteudo','ig_caption','geral')`; drop and re-add `post_comment_threads_anchor_chk` with the existing two branches plus `(field = 'geral' AND anchor_start IS NULL AND anchor_end IS NULL AND NOT orphaned AND quoted_text = '' AND status = 'active')`. Find the auto-generated name of the inline `field` CHECK from `20260925000020` with a `DO` block over `pg_constraint` (it was declared inline, so it is not named).
- `CREATE UNIQUE INDEX post_comment_threads_geral_uq ON post_comment_threads (post_id) WHERE field = 'geral';`
- Restrictive policies `AS RESTRICTIVE … TO authenticated` as listed in Interfaces (insert check `field <> 'geral'`; comments insert check `author_id = auth.uid()`; geral update/delete using `author_id = auth.uid() OR thread_id NOT IN (SELECT id FROM post_comment_threads WHERE field = 'geral')`).
- Guard triggers `BEFORE UPDATE` / `BEFORE DELETE` on `post_comment_threads`, both functions `SECURITY DEFINER SET search_path = public` (so the EXISTS below is not filtered by `workflow_posts` RLS), raising `ERRCODE = '42501'` with messages `geral_thread_immutable` / `geral_thread_undeletable`. Delete guard allows the row when `NOT EXISTS (SELECT 1 FROM workflow_posts WHERE id = OLD.post_id)` (the cascade path: the FK cascade runs after the parent row is gone); verify with 99.2.
- The inline `field` CHECK from `20260925000020` is named `post_comment_threads_field_check`; the `DO` block that finds it must assert it found exactly one row.

- [ ] **Step 4: Run to verify it passes**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh 2>&1 | grep -E "99_post_discussao|98_caption|FAIL"`
Expected: `PASS 99_post_discussao.sql`, `98_caption_comment_anchors.sql` still PASS, no FAIL lines.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261025000001_post_discussao_geral.sql supabase/tests/entitlements/99_post_discussao.sql
git commit -m "feat(db): general discussion thread per post with database guards"
```

### Task 2: Migration B, participants, RPCs, realtime and notification types

**Files:**
- Create: `supabase/migrations/20261025000002_post_discussao_participantes.sql`
- Modify: `supabase/tests/entitlements/99_post_discussao.sql` (sections 99.4–99.8)

**Interfaces:**
- Consumes: Task 1 schema.
- Produces (all SECURITY DEFINER, `search_path = public`):
  - `post_discussao_enviar(p_post_id bigint, p_content text, p_thread_id bigint DEFAULT NULL) RETURNS post_comments`
  - `post_discussao_marcar_lido(p_post_id bigint, p_comment_id bigint) RETURNS void`
  - `post_discussao_seguir(p_post_id bigint, p_seguir boolean) RETURNS void`
  - `get_post_discussao_nao_lidas(p_post_ids bigint[] DEFAULT NULL, p_workflow_ids bigint[] DEFAULT NULL) RETURNS TABLE (post_id bigint, workflow_id bigint, total int, nao_lidas int)` (plan decision: `p_workflow_ids` lets the board ask per fluxo without knowing post ids; rows only for posts with `total > 0`)
  - `get_post_discussao_participacao(p_post_id bigint) RETURNS TABLE (seguindo boolean, last_seen_comment_id bigint, implicito boolean)` (one row always: `implicito = true` when the caller is the responsável without a row; `seguindo = false, last_seen = 0, implicito = false` when not a participant)
  - table `post_discussao_participantes` as in the spec, PK `(post_id, user_id)`, SELECT policy `user_id = auth.uid() AND conta_id IN (SELECT get_my_conta_id())`, no write grants to `authenticated`.

- [ ] **Step 1: Write the failing psql sections**

- 99.4 `enviar`: member of A sends to own post → returns row with `author_id` = caller and creates exactly one `geral` thread (with `created_by` = caller, `quoted_text = ''`); second send reuses it (sequential case only: the concurrency guarantee is the `ON CONFLICT … DO NOTHING` path, not provable in one psql session); `p_thread_id` of an active `conteudo` thread of the same post inserts there; `p_thread_id` of another post, a resolved thread, or a thread whose `conta_id` differs from its post's `conta_id` (seed it as postgres) raises; post of workspace B raises; `''`, `'   '` and 4001 chars raise; a `@[X](membro:<id>)` token creates a `mencoes` row in the same call (`sync_mentions` in-transaction); after the call `current_setting('app.discussao_via_rpc', true)` is `''` or NULL.
- 99.5 `marcar_lido`: advances `last_seen_comment_id`, never moves it back; comment id from another post raises; post of B raises.
- 99.6 `seguir` and `participacao`: `seguir` toggles the row; post of B raises. `get_post_discussao_participacao`: responsável without a row → `(true, 0, true)`; non-participant → `(false, 0, false)`; row with `seguindo = false` → `(false, <last_seen>, false)`; post of B raises.
- 99.7 `get_post_discussao_nao_lidas`: participant following with marker 0 sees `nao_lidas = total` minus own messages; non-participant sees `nao_lidas = 0` and correct `total`; `seguindo = false` sees 0; responsável without row sees all others' messages; counts include replies in `conteudo` threads; `p_workflow_ids` returns the fluxo's posts; member of B gets no rows for A's posts; removed member (row in participants, no `workspace_members`) gets no rows.
- 99.8 types: as postgres, insert one `notifications` row of type `team_message` and one of `post_discussion`, and one `notification_inapp_prefs` row of each; all succeed. Grants: `anon` has no EXECUTE on any of the five functions.

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh 2>&1 | grep 99_post_discussao`
Expected: FAIL at 99.4 (function does not exist).

- [ ] **Step 3: Write the migration**

- Every function starts by loading `workflow_posts` by id and raising `post_not_found` (`P0002`) unless `conta_id IN (SELECT get_my_conta_id())` and the caller is in `workspace_members` of that `conta_id`.
- Helper `post_discussao_membro_ids(p_content text, p_conta_id uuid) RETURNS bigint[]` (STABLE, SECURITY DEFINER, no grant to `authenticated`): ids from `regexp_matches(p_content, '\]\(membro:([0-9]+)\)', 'g')` joined to `membros` with `conta_id = p_conta_id`. Task 3's trigger reuses it.
- `enviar`: trim check; on the `p_thread_id` path assert `thread.post_id = p_post_id AND thread.conta_id = wp.conta_id AND thread.status = 'active'` (because `sync_mentions` is SECURITY INVOKER by design and, called from this DEFINER function, no longer gets RLS as its tenant proof; `enviar` is that proof). Get-or-create the `geral` thread with `INSERT (post_id, conta_id, quoted_text, created_by, field) VALUES (p_post_id, wp.conta_id, '', auth.uid(), 'geral') ON CONFLICT (post_id) WHERE field = 'geral' DO NOTHING` then `SELECT`. Then `PERFORM set_config('app.discussao_via_rpc', '1', true)`, insert the comment with `author_id = auth.uid()`, immediately `PERFORM set_config('app.discussao_via_rpc', '', true)` (the GUC is transaction-scoped, so it must be reset right after the INSERT), then `sync_mentions('post_comment', v_comment.id, post_discussao_membro_ids(content, wp.conta_id))`. The GUC is harmless until Task 3's trigger reads it.
- `marcar_lido`: comment must belong to a thread with `post_id = p_post_id`; `INSERT … ON CONFLICT (post_id, user_id) DO UPDATE SET last_seen_comment_id = GREATEST(...)`, `updated_at = now()`.
- Realtime: add `post_comment_threads` and `post_comments` to `supabase_realtime` with the idempotent block + assertion copied from `20261021100000` lines ~265–288.
- Re-create `notifications_type_check` and `notification_inapp_prefs_type_check` copied from the latest definitions plus `'post_discussion'`; header comment "Este arquivo passa a ser a definicao mais recente".

- [ ] **Step 4: Run to verify it passes**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh 2>&1 | grep -E "FAIL|99_post_discussao|7[234]_equipe"`
Expected: 99 and 72–74 PASS, no FAIL.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261025000002_post_discussao_participantes.sql supabase/tests/entitlements/99_post_discussao.sql
git commit -m "feat(db): discussion participants, RPCs, realtime and post_discussion type"
```

### Task 3: Migration C, notifications, participant triggers, mention link, backfill

**Files:**
- Create: `supabase/migrations/20261025000003_post_discussao_notify.sql` (header comment: "APLICAR DEPOIS do deploy do frontend; ver Rollout na spec")
- Modify: `supabase/tests/entitlements/99_post_discussao.sql` (sections 99.9–99.12)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `trg_post_comments_discussao_insert()` (AFTER INSERT: participant rows + `post_discussion`), `trg_post_comments_discussao_update()` (AFTER UPDATE OF content: participant rows for newly mentioned, no notification), unique index `notifications_post_discussion_unread_uq ON notifications (user_id, ((metadata->>'post_id'))) WHERE type = 'post_discussion' AND read_at IS NULL AND dismissed_at IS NULL`, updated `trg_notify_mention` (`post_comment` branch only), one-off backfill.

- [ ] **Step 1: Write the failing psql sections**

- 99.9 recipients (users: author U, follower F, unfollowed N, responsável R without row, mentioned M, removed ex-member X with a row): U sends via `enviar` with `@M`: notifications exist for F and R only; none for U, N, M, X; M has a `mention` row whose `link` is `/entregas?drawer=<wf>&post=<post>&discussao=1`.
- 99.10 coalescing: two more messages from another author → F still has exactly one unread `post_discussion` with `metadata->>'count' = '3'`, `metadata->'authors'` has ≤ 3 names, `preview` has no raw `@[` token; after F marks it read, the next message creates a new row.
- 99.11 edge cases: insert by postgres with no JWT (`auth.uid()` null) creates no notification; post with no responsável and no participants: `enviar` succeeds, zero notifications; first message of a new `conteudo` thread via direct inserts (legacy path) with `@M` still notifies F and does not exclude M; edit adding `@Y` creates Y's participant row and no `post_discussion`; avulso post (no `workflow_id`) link is `/entregas?post=<id>&discussao=1`.
- 99.9 also: a responsável who also has a following participant row receives exactly one `post_discussion` row (no "cannot affect row a second time").
- 99.11 also: the "no JWT" case runs `reset role` and `set_config('request.jwt.claims', '', true)` first (or runs before any impersonation in its section).
- 99.12 backfill: call `post_discussao_backfill_participantes()` on a seeded post with one active and one resolved `conteudo` thread: only authors of the active thread get rows, `last_seen_comment_id` = the post's max comment id; a post whose `conta_id` has no `workspaces` row is skipped without error.

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh 2>&1 | grep 99_post_discussao`
Expected: FAIL at 99.9.

- [ ] **Step 3: Write the migration**

- Both triggers SECURITY DEFINER, whole body in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING '…: % %', SQLERRM, SQLSTATE; END;`, skip when `auth.uid() IS NULL` or thread `conta_id` ≠ post `conta_id`.
- Mentioned users come from `post_discussao_membro_ids(NEW.content, post.conta_id)` → `membros.crm_user_id` (the `mencoes` rows do not exist yet when this AFTER INSERT trigger fires). They are excluded from recipients only when `current_setting('app.discussao_via_rpc', true) = '1'` (NULL and `''` mean "not via RPC"; Task 2's `enviar` already sets and resets it).
- Build the recipient set with `UNION` (followers with `seguindo = true` UNION the implicit responsável), never `UNION ALL`, so a user appears once; `ON CONFLICT DO UPDATE` raises if one statement hits the same row twice.
- Store `metadata->>'post_id'` as text (`post_id::text`), like `conversa_id` in `team_message`.
- Notification insert: `ON CONFLICT (user_id, ((metadata->>'post_id'))) WHERE type = 'post_discussion' AND read_at IS NULL AND dismissed_at IS NULL DO UPDATE SET metadata = …, created_at = now()` keeping `count`, `authors` (dedup, max 3), `author_name`, `preview` (mention tokens replaced like `20261021103000` part b, then `left(…, 280)`), `post_id`, `workflow_id`, `post_titulo`, `thread_field`, `quoted_text`.
- `trg_notify_mention`: copy the latest definition (find it: `grep -l "FUNCTION trg_notify_mention" supabase/migrations/* | sort | tail -1`), change only the `post_comment` branch's `v_link`.
- Backfill as specified in the spec ("Participantes de fios antigos"), wrapped in `post_discussao_backfill_participantes() RETURNS int` (SECURITY DEFINER, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`), joining `workspaces` so orphan posts are skipped, called once at the end of the migration.

- [ ] **Step 4: Run to verify it passes**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh`
Expected: every file PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261025000003_post_discussao_notify.sql supabase/tests/entitlements/99_post_discussao.sql
git commit -m "feat(db): post_discussion notifications, participant triggers and mention deep link"
```

### Task 4: Store layer

**Files:**
- Modify: `apps/crm/src/store/comments.ts`
- Modify: callers of `addPostComment` (`WorkflowDrawer.tsx:988`, `StandalonePostDrawer.tsx:577`)
- Modify: `apps/crm/src/pages/entregas/components/PostCommentPopover.tsx` (~313-324: show the reply `MentionEditor` only when `thread.status === 'active'`; resolved threads show no reply box, since the RPC rejects replies to resolved threads)
- Test: `apps/crm/src/store/__tests__/comments.discussao.test.ts`; update `apps/crm/src/__tests__/store.comments.test.ts:204-270` (asserts the old direct insert + `sync_mentions` for `addPostComment`); extend `components/__tests__/PostCommentPopover.test.tsx` (no reply box on a resolved thread). Drawer tests that mock `addPostComment` (`WorkflowDrawer*.test.tsx`, `StandalonePostDrawer*.test.tsx`) must keep passing with the new 3-argument call.

**Interfaces:**
- Produces:
  - `CommentThread.field: 'conteudo' | 'ig_caption' | 'geral'`
  - `sendDiscussaoMessage(postId: number, content: string, threadId?: number): Promise<PostComment>` (rpc `post_discussao_enviar`)
  - `addPostComment(postId: number, threadId: number, content: string): Promise<PostComment>` now delegates to `sendDiscussaoMessage(postId, content, threadId)` (no client-side `syncMentions`)
  - `markDiscussaoLida(postId: number, commentId: number): Promise<void>`
  - `setDiscussaoSeguindo(postId: number, seguir: boolean): Promise<void>`
  - `getDiscussaoParticipacao(postId: number): Promise<{ seguindo: boolean; lastSeenCommentId: number; implicito: boolean }>`
  - `interface DiscussaoNaoLidas { postId: number; workflowId: number | null; total: number; naoLidas: number }`
  - `getDiscussaoNaoLidas(args: { postIds?: number[]; workflowIds?: number[] }): Promise<DiscussaoNaoLidas[]>`
  - `isGeralThread(t: CommentThread): boolean`

- [ ] **Step 1: Write the failing tests** with the `lib/__mocks__/supabase.ts` mock: each function calls the right RPC with the right `p_*` params; `addPostComment` calls `post_discussao_enviar` with `p_thread_id` and never `sync_mentions`; `getDiscussaoNaoLidas({})` with both lists empty returns `[]` without calling the RPC; RPC errors reject.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/store/__tests__/comments.discussao.test.ts` → FAIL.
- [ ] **Step 3: Implement**, update the two callers: the handlers only have `threadId` in scope, so pass `commentThreads.find((t) => t.id === threadId)?.post_id` (throw a clear error if not found).
- [ ] **Step 4: Run** the new test plus `npx vitest run apps/crm/src/__tests__/store.comments.test.ts apps/crm/src/pages/entregas` → PASS.
- [ ] **Step 5: Commit** `feat(entregas): discussion store functions; replies go through post_discussao_enviar`.

### Task 5: Timeline builder (pure)

**Files:**
- Create: `apps/crm/src/pages/entregas/discussao/timeline.ts`
- Test: `apps/crm/src/pages/entregas/discussao/__tests__/timeline.test.ts`

**Interfaces:**
- Consumes: `CommentThreadWithComments`, `isGeralThread`.
- Produces:
```ts
export type TimelineItem =
  | { kind: 'day'; key: string; label: string }            // "Hoje", "Ontem", "22 de outubro"
  | { kind: 'unread'; key: 'unread' }
  | { kind: 'message'; key: string; comment: PostComment }
  | { kind: 'thread'; key: string; thread: CommentThreadWithComments; replies: number; novas: number }
  | { kind: 'resolved'; key: 'resolved'; threads: CommentThreadWithComments[] };
export function buildTimeline(args: {
  threads: CommentThreadWithComments[];
  lastSeenCommentId: number | null;   // null = not a participant: no 'unread', novas = 0
  currentUserId: string;
  now: Date;
}): TimelineItem[];
```

- [ ] **Step 1: Write the failing tests**: messages of the `geral` thread and active anchored threads interleave by `created_at` (thread card at its thread's `created_at`); day dividers "Hoje"/"Ontem"/`d 'de' MMMM` (date-fns `ptBR`); `unread` sits before the first `geral` message with `id > lastSeenCommentId` not authored by `currentUserId`, and never appears when `lastSeenCommentId` is `null` or nothing is newer; `replies` = comments − 1; `novas` = replies with `id > lastSeen` from others (0 when `null`); resolved threads collapse into one trailing `resolved` item, absent when none; empty input → `[]`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/discussao/__tests__/timeline.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS (run with `TZ=UTC` as well; see memory note on pinned `now`).
- [ ] **Step 5: Commit** `feat(entregas): discussion timeline builder`.

### Task 6: `useDiscussao` hook (data, realtime, read marker, mutations)

**Files:**
- Create: `apps/crm/src/pages/entregas/discussao/useDiscussao.ts`
- Test: `apps/crm/src/pages/entregas/discussao/__tests__/useDiscussao.test.tsx`

**Interfaces:**
- Consumes: Task 4 functions. Both drawers key the threads query under the prefix `['post-comment-threads', …]` and already invalidate that prefix (`WorkflowDrawer.tsx:510`, `StandalonePostDrawer.tsx:292`); the hook invalidates the prefix, so no query key is threaded through `PostEditorBody` and lane A never edits the drawers for this.
- Produces:
```ts
export function useDiscussao(args: {
  postId: number;
  threads: CommentThreadWithComments[];   // this post's threads, from the drawer query
  currentUserId: string;
}): {
  participacao: { seguindo: boolean; lastSeenCommentId: number; implicito: boolean } | undefined;
  isParticipant: boolean;                  // seguindo || implicito
  naoLidas: number;                        // comments of all the post's threads with id > lastSeenCommentId and author_id !== currentUserId; 0 when !isParticipant
  unreadAnchorId: number | null;           // lastSeen frozen at mount, for the 'unread' divider
  send: (content: string) => Promise<void>; // throws on failure
  sending: boolean;
  toggleSeguir: () => Promise<void>;
  sectionRef: (el: HTMLElement | null) => void; // IntersectionObserver target
};
```
- Behaviour: realtime channel `post-discussao-<postId>` with `postgres_changes` on `post_comment_threads` (`post_id=eq.<id>`) and on `post_comments` (`thread_id=in.(<ids>)`, re-subscribed when the id set changes); every event invalidates `{ queryKey: ['post-comment-threads'] }` and `{ queryKey: ['post-discussao-nao-lidas'] }`; channel removed on unmount and on `postId` change; refetch on window focus. When `sectionRef`'s element is ≥ 50% visible, after 800 ms, call `markDiscussaoLida(postId, maxCommentIdOfPost)` if it is greater than the last value sent. `unreadAnchorId` captured once per `postId`.

- [ ] **Step 1: Write the failing tests**: subscribes with both filters; changing `postId` removes the old channel before creating the new one (Review Focus 2); an INSERT event invalidates both prefixes; `naoLidas` counts others' comments above the marker across all threads and is 0 for a non-participant; visibility (mock IntersectionObserver) marks read once with the max id and not again for the same id; `unreadAnchorId` does not move after marking read; `send` rejects and leaves `sending = false` when the RPC errors; `toggleSeguir` calls `setDiscussaoSeguindo(postId, !seguindo)`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/discussao/__tests__/useDiscussao.test.tsx` → FAIL.
- [ ] **Step 3: Implement** (model the channel code on `hooks/useEquipeChatRealtime.ts`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(entregas): useDiscussao with realtime and read marker`.

### Task 7: Desktop section and client relabel

**Files:**
- Create: `apps/crm/src/pages/entregas/discussao/DiscussaoEquipe.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (replace `<PostCommentSummary …/>` at ~1619; relabel the `drawer-approval-thread` header at ~1642)
- Modify: `apps/crm/app.css` (new `.discussao-*` rules inserted directly after the `.comment-summary*` block, never at EOF: lanes cherry-pick into the same file)
- Test: `apps/crm/src/pages/entregas/discussao/__tests__/DiscussaoEquipe.test.tsx`; update `PostEditorBody` tests that assert "Comentários internos" or "Comentários".

**Interfaces:**
- Consumes: Tasks 5–6, `MentionEditor`, `MentionText`, `useWorkspaceLimits`, `useUnsavedWork`, `onThreadClick` (existing handler in PostEditorBody). The bridge is a slot: `chatBridge?: ReactNode`, rendered in the header only when the flag check passes; Task 13 passes `<DiscutirNoChat …/>` into it.
- Produces: `<DiscussaoEquipe discussao={ReturnType<typeof useDiscussao>} threads membros workspaceUsers currentUserId onThreadClick chatBridge?: ReactNode />` (PostEditorBody calls `useDiscussao({ postId: post.id, threads: commentThreads, currentUserId })` ONCE, above the desktop/phone split, and passes the result to both layouts) and an exported `<DiscussaoTimeline items … />` reused by phone (Task 8) and HistoryDrawer (Task 12).

- [ ] **Step 1: Write the failing tests**: header shows "Discussão da equipe" and "Só a equipe vê"; bell label "Seguindo" when following and "Seguir" when not; "Discutir no chat" absent when `features.feature_team_chat !== true` and not unlimited, present otherwise; messages render name, time and mention chips; thread card shows the quote, "2 respostas" or "1 novas"/"N novas", "Ver no texto" calls `onThreadClick(id)`; resolved group "1 comentário no texto resolvido" expands; "Não lidas" divider only for participants; Enter sends trimmed text and clears, Shift+Enter does not send, IME composing does not send; send failure keeps the text and toasts "Não foi possível enviar. Tente novamente." (Review Focus 1); own message menu: edit disables Salvar on empty text, delete asks "Excluir mensagem?" (Review Focus 5); deleting the last message shows only the composer; `useUnsavedWork(true)` while the draft is non-empty. PostEditorBody: section title "Conversa com o cliente" and "O cliente vê" present; "Comentários internos" absent.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/discussao apps/crm/src/pages/entregas/components/__tests__/PostEditorBody` → FAIL.
- [ ] **Step 3: Implement** per the mockup "Depois" board (panel `surface-1`, 12px radius, rows not bubbles). CSS in `app.css`, both themes via tokens.
- [ ] **Step 4: Run** the same command plus `npx vitest run apps/crm/src/__tests__/cssSplitBoundary.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(entregas): Discussão da equipe in the post editor`.

### Task 8: Phone Comentários tab

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/postEditorPhone/PhoneComments.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (phone branch ~660: `commentCount`)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.phone.test.tsx` (extend) and `postEditorPhone/__tests__/PhoneComments.test.tsx` (create if absent)

**Interfaces:**
- Consumes: Tasks 6–7 (`useDiscussao`, `DiscussaoTimeline`).
- Produces: `PhoneComments` props gain `postId`, `currentUserId`, `chatBridge?: ReactNode` (same slot as Task 7, filled by Task 13b); `PhoneComments` also receives `discussao` (the same `useDiscussao` result Task 7 computes once in `PostEditorBody`) and `naoLidasEquipe = discussao.naoLidas`, so the tab count and the pill agree; the tab count is `naoLidasEquipe + approvals.length`. Also in this task: phone `captionThreadCount` (~664) and `activeThreads` skip `isGeralThread`.

- [ ] **Step 1: Write the failing tests**: pills "Equipe · N novas" (or "Equipe" when 0) and "Cliente"; only one composer is in the DOM-visible state at a time (`placeholder` "Mensagem para a equipe" vs "Responder ao cliente…"); initial pill rule: Equipe if `naoLidasEquipe > 0`, else Cliente when the newest approval is from the client, else Equipe; "Só a equipe vê esta conversa." line with the bell icon button (40px, `aria-label`) and the `chatBridge` slot rendered (test passes a stub button); both panes stay mounted when switching; tab count = unread + `approvals.length`; `captionThreadCount` ignores a `geral` thread.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/components` → FAIL.
- [ ] **Step 3: Implement.** Find how an approval is marked as from the client by reading `.approval-bubble--client` usage in `PostEditorBody.tsx` (`PostApprovalBubble`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(entregas): Equipe/Cliente split in the phone Comentários tab`.

### Task 9: Unread badges (drawer trigger and board)

**Files:**
- Create: `apps/crm/src/pages/entregas/discussao/usePostDiscussaoNaoLidas.ts`
- Modify: `WorkflowDrawer.tsx` (~1954 `drawer-post-comment-badge`), `StandalonePostDrawer.tsx` (same badge if present), `phone/FluxoPhone.tsx` (~542), `components/WorkflowCard.tsx`, `components/PostProcessCard.tsx`, `phone/PhoneBoardCards.tsx`, `views/KanbanView.tsx` (fetch once per board load and pass props)
- Modify: `apps/crm/app.css` only if a new rule is needed: insert next to `.drawer-post-comment-badge` (never at EOF)
- Test: `discussao/__tests__/usePostDiscussaoNaoLidas.test.tsx`, extend `WorkflowCard.badge.test.tsx`, `WorkflowDrawer.test.tsx`; the KanbanView batching test copies the harness of an existing `views/__tests__/Kanban*.test.tsx` (e.g. `KanbanFullColumnOrder.test.tsx`; there is no `KanbanView.test.tsx`)
- Note: the drawer trigger badge changes meaning on purpose: today it counts `commentThreads.length` (threads); it now shows unread or total **comments** across all threads (RPC `total`). Update the existing assertion in `WorkflowDrawer.test.tsx` deliberately, and say so in the commit body.
- Board: fluxo cards ask by `workflowIds` (the board knows workflow ids, not post ids); post cards (filter "Posts", avulsos) ask by `postIds`; one hook call per board load.

**Interfaces:**
- Produces: `usePostDiscussaoNaoLidas(args: { postIds?: number[]; workflowIds?: number[] }): { byPost: Map<number, DiscussaoNaoLidas>; byWorkflow: Map<number, number> }` (query key `['post-discussao-nao-lidas', sortedPostIds, sortedWorkflowIds]`, prefix invalidated by Task 6); props `discussaoNaoLidas?: number` on `WorkflowCard`, `PostProcessCard`, phone board cards.

- [ ] **Step 1: Write the failing tests**: trigger badge shows unread count with a dot class when > 0, total without dot when unread is 0, nothing when total is 0 and there are no threads; `aria-label` "N mensagens novas na discussão"; WorkflowCard shows the badge only when `discussaoNaoLidas > 0`; KanbanView calls the RPC once for all visible cards.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(entregas): discussion unread badges on drawer and board`.

### Task 10: Deep link `discussao=1`

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (param handling near `postParam`, ~512), `WorkflowDrawer.tsx`, `StandalonePostDrawer.tsx` (accept `focusDiscussao` and scroll), `DiscussaoEquipe.tsx` (`autoFocus` prop), `PhoneComments.tsx` (open Equipe pill)
- Test: extend `apps/crm/src/pages/entregas/__tests__/` EntregasPage deep-link test (find the existing `?post=` test and add cases)

**Interfaces:**
- Produces: `focusDiscussao?: boolean` prop on both drawers and `PostEditorBody`; `DiscussaoEquipe` `autoFocus?: boolean`.

- [ ] **Step 1: Write the failing tests**: `/entregas?drawer=W&post=P&discussao=1` expands P, calls `scrollIntoView` on the section and focuses the composer; on phone opens Comentários on Equipe without focusing (no keyboard); the `discussao` param is removed from the URL after use, like `post`; avulso `/entregas?post=P&discussao=1` works.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(entregas): discussao=1 deep link`.

### Task 11: Notification type in the frontend

**Files:**
- Modify: `apps/crm/src/store/notifications.ts`, `apps/crm/src/lib/notification-catalog.ts`, `apps/crm/src/lib/notification-config.ts`
- Test: `apps/crm/src/lib/__tests__/notification-config.post-discussion.test.ts`

**Interfaces:**
- Produces: `NotificationType` includes `'post_discussion'`; catalog entry `{ category: 'equipe', label: 'Mensagem na discussão de um post', when: 'alguém escreve na discussão de um post que você segue', recipients: 'quem escreveu, foi mencionado ou é responsável pelo post e segue a discussão', emailEligible: false }`.

- [ ] **Step 1: Write the failing tests**: single author → title `"<autor> escreveu na discussão de <post_titulo>"`; `authors` length 2 with `count` 3 → `"<autor> e mais 1 pessoa escreveram na discussão de <post_titulo>"` and body containing the preview and "3 mensagens"; `thread_field` not `geral` with `quoted_text` → `"<autor> respondeu no trecho “<quoted_text>”"`; preview with a raw token renders `@Nome`; missing metadata falls back without throwing.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/lib/__tests__/notification-config.post-discussion.test.ts` → FAIL.
- [ ] **Step 3: Implement** (icon `MessagesSquare`, tone like `team_message`).
- [ ] **Step 4: Run** plus the notification settings tests (`pages/configuracao/__tests__/NotificacoesTab*.test.tsx`) → PASS.
- [ ] **Step 5: Commit** `feat(notifications): post_discussion type`.

### Task 12: HistoryDrawer read-only discussion

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/HistoryDrawer.tsx` (~257)
- Test: `components/__tests__/HistoryDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**: a post with a `geral` thread shows its messages via `DiscussaoTimeline` with no composer, no bell, no "Discutir no chat"; `PostCommentSummary` there ignores `geral` threads.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(entregas): read-only discussion in history`.

Also in this task: grep for remaining `commentThreads` consumers that count or list threads (`PostEditor.tsx` highlight sync, `captionAnchors.ts`, `PostCommentSummary.tsx`; the phone `captionThreadCount` was done in Task 8) and make each skip `isGeralThread`; add one assertion per consumer to its existing test.

### Task 13: "Discutir no chat" bridge

**Files:**
- Create: `apps/crm/src/pages/entregas/discussao/DiscutirNoChat.tsx` (component only; mounting it is Task 13b, after Tasks 7, 8 and 13 have landed)
- Test: `discussao/__tests__/DiscutirNoChat.test.tsx`
- Pessoas: built from `getEquipeChatMembers()` minus self; each person maps to the DM in `getEquipeConversas()` whose `dm_user_id` matches (send to its `conversa_id`), else `createEquipeConversa('dm', null, [user_id])` on send. `getEquipeConversas()` does not list colleagues without a DM and DMs must not also appear as a separate row (see how `EquipeConversationList`'s Equipe tab merges them). Grupos: conversations with `tipo = 'grupo'`.

**Interfaces:**
- Consumes: `getEquipeConversas`, `getEquipeChatMembers`, `createEquipeConversa('dm', null, [userId])`, `sendEquipeMensagem(conversaId, content)` from `store/equipeChat.ts` (query keys `['equipe-conversas']`, `['equipe-chat-members']`).
- Produces: `<DiscutirNoChat post={{ id, titulo, workflowId }} variant="popover" | "sheet" />`; content built by `buildBridgeMessage(text: string, post): string` = `${text.trim()}\n@[${titulo}](post:${id}:${workflowId})` (no `:workflowId` for avulso; no leading newline when text is empty).

- [ ] **Step 1: Write the failing tests**: lists Grupos (only `tipo = 'grupo'`, with "N pessoas") and Pessoas (members without self, with or without DM); search filters both; selecting a person with no DM calls `createEquipeConversa` then `sendEquipeMensagem` with `buildBridgeMessage`; with a DM uses its `conversa_id`; success toasts "Enviado para <nome>." with action "Abrir conversa" → `/mensagens/equipe/<id>` and closes; failure toasts "Não foi possível enviar. Tente novamente." and keeps the text; "Enviar para <nome>" disabled until a target is selected; `buildBridgeMessage` cases (empty text, avulso).
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(entregas): Discutir no chat bridge`.

### Task 13b: Mount the bridge

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (pass `chatBridge` to `DiscussaoEquipe` and `PhoneComments`)
- Test: extend `discussao/__tests__/DiscussaoEquipe.test.tsx` or the PostEditorBody tests

**Interfaces:**
- Consumes: Task 7/8 `chatBridge?: ReactNode` slots, Task 13 `<DiscutirNoChat post variant />`.

- [ ] **Step 1: Write the failing test**: in PostEditorBody desktop, with `feature_team_chat: true` the "Discutir no chat" button opens the popover with "Levar este post para o chat"; on phone the icon button opens the sheet; with the flag off neither renders.
- [ ] **Step 2–4:** run → FAIL, wire `variant="popover"` (desktop) / `"sheet"` (phone) with `post={{ id: post.id, titulo: post.titulo, workflowId: post.workflow_id ?? null }}`, run → PASS.
- [ ] **Step 5: Commit** `feat(entregas): mount Discutir no chat in the editor`.

### Task 14: Post blocks in the team chat

**Files:**
- Create: `apps/crm/src/pages/mensagens/components/PostChipsBelow.tsx`
- Modify: `pages/mensagens/components/EquipeThread.tsx` (~172), `pages/mensagens/phone/EquipeThreadPhone.tsx`, `pages/mensagens/components/PostChip.tsx` (preview: "N mensagens na discussão" from `getDiscussaoNaoLidas({ postIds: [id] })` `total`, and link "Abrir na discussão do post" to `postChipHref(...) + '&discussao=1'`)
- Test: `pages/mensagens/components/__tests__/EquipeThread.test.tsx` (extend), `PostChipsBelow.test.tsx`
- `getDiscussaoNaoLidas` returns no row for a post with no comments: treat "no row" as 0 and hide "N mensagens na discussão". Fetch it inside the existing `usePostPreview` `enabled` gate (only while the preview is open).
- CSS, if any: insert next to the existing `.post-chip` rules (never at EOF).

**Interfaces:**
- Produces: `<PostChipsBelow text={m.content} variant="desktop" | "phone" />`: renders `PostChip` (desktop) or `PostChipPhone` (phone) for up to 3 distinct `post` mentions parsed with `parseMentionTokens`; renders nothing when none.

- [ ] **Step 1: Write the failing tests**: message with text + one post token renders the text with an inline chip and one block below; message that is only the token renders only the block; four distinct posts render inline chips and no blocks (above 3); duplicate token renders one block; the preview link carries `&discussao=1`; phone thread renders the phone chip.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(mensagens): post blocks under team chat messages`.

### Task 15: Full verification and browser check

- [ ] **Step 1:** `npm run lint && npm run format:check` → no errors.
- [ ] **Step 2:** `npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json` → no output.
- [ ] **Step 3:** `TZ=UTC npm run test` and `npm run test` → all pass.
- [ ] **Step 4:** `npm run check:functions && npm run test:functions` → pass (no edge function changed; confirms nothing broke). Then `git status` to catch `deno.lock` churn and `npm ci` if `node_modules/.deno` appeared.
- [ ] **Step 5:** `npx supabase db reset && bash scripts/test-entitlements.sh` → every file PASS.
- [ ] **Step 6:** Browser pane against local Supabase (seed login, stub `workspace-limits` per the memory notes): desktop and 375px, light and dark. Send a message, receive it in a second tab via realtime, see the "Não lidas" divider and the badge clear, toggle the bell, open a text comment from its card, send to a group via "Discutir no chat", follow the chip back to the discussion. Screenshot each state.
- [ ] **Step 7: Commit** any fixes, then report the rollout order from the spec (migrations 1–2 before merge, migration 3 right after deploy).
