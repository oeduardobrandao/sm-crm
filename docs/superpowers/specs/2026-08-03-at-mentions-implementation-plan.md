# @-Mentions — Implementation Plan

Source design: approved plan at `~/.claude/plans/i-d-like-for-users-stateful-flame.md` (summary below is self-contained; tasks do not need that file).

**Feature**: Google-Docs-style @-mentions in the CRM. Mentionable: membros (pessoas), posts, clientes, tarefas. Surfaces: TipTap post editor, post comments, tarefa descriptions. Effects: mention chips with deep links; in-app notification when a pessoa is mentioned; unread-only email (10-min delay, batched) via a new cron edge function.

## Global Constraints

- Work ONLY in the worktree `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/admin-portal-performance-f2a294` on branch `claude/at-mentions-feature-6da078`. Before any edit, run `pwd` and `git branch --show-current` and verify both.
- Portuguese user-facing copy. NEVER use em-dashes (—) in user-facing strings; use period, colon, or "·".
- TipTap node name is exactly `mention` with attrs `{ entityType: 'membro'|'post'|'cliente'|'tarefa', id: number, label: string, parentId: number|null }` everywhere (CRM editable, CRM readonly, Hub readonly). **Hub superset invariant**: any doc the CRM can persist must parse in the Hub's `richTextExtensions()` — an unknown node makes TipTap silently discard the ENTIRE document.
- Plain-text mention token syntax, everywhere: `@[Label](tipo:id)` for membro/cliente/tarefa and `@[Label](post:id:workflowId)` for posts (third segment = workflow id; may be absent in which case the chip renders without a link). Regex: `/@\[([^\]]+)\]\((membro|post|cliente|tarefa):(\d+)(?::(\d+))?\)/g`.
- Deep links (LIVE routes only): membro `/equipe/:id`, cliente `/clientes/:id`, tarefa `/tarefas?tarefa=:id`, post `/entregas?drawer=:workflowId`. Never emit `/workflows/...` (dead route).
- New npm deps must be pinned EXACT (no caret) — deno min-dep-age CI gate. Pin `@tiptap/suggestion` to the same 3.22.x version wave as the installed `@tiptap/react`.
- Migration prefix must be unique vs `git ls-tree origin/main:supabase/migrations` tail (currently `20260731000002`). Use prefix `20260803000001`. UPDATE (post-hoc): origin/main's tail advanced to `20260803000005` while this plan was in flight, colliding with this prefix and with Task 8's `20260803000002`; both migrations were renumbered to `20260803000006` (Task 1, `mencoes.sql`) and `20260803000007` (Task 8, `schedule_mention_email_cron.sql`) to sit after main's tail. The task sections below still name the original prefixes; treat every `20260803000001_mencoes.sql` reference as `20260803000006_mencoes.sql` and every `20260803000002_schedule_mention_email_cron.sql` reference as `20260803000007_schedule_mention_email_cron.sql`.
- Tenancy: `conta_id IN (SELECT public.get_my_conta_id())` subquery form; WITH CHECK EXISTS tenant guards on every cross-table pointer; qualify outer-row columns explicitly in subqueries (e.g. `mencoes.mentioned_membro_id`, never bare).
- Edge functions: never wildcard CORS; never return raw error details; crons verify `x-cron-secret` before executing.
- After running `deno test`, restore the lockfile: `git checkout -- deno.lock` (deno runs dirty it; never commit that diff). If deno polluted `node_modules`, run `npm ci`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- store.ts-layer functions are plain async functions (NOT hooks); UI wraps them with TanStack Query.

## Task 1: Migration — mencoes table, notify pipeline, sync RPC, emailed_at

Create `supabase/migrations/20260803000001_mencoes.sql` (shipped as `20260803000006_mencoes.sql` — see the Global Constraints update above). Before writing, READ these for exact conventions and signatures:
- `supabase/migrations/20260430000001_notifications.sql` (helpers `resolve_notification_targets`, `insert_notification_batch`, trigger style)
- `supabase/migrations/20260730000006_task_assigned_notification.sql` (LATEST `notifications_type_check` list — copy it verbatim; trigger template)
- `supabase/migrations/20260730000005_tarefas.sql` (RLS tenant-guard pattern + explanatory comment style)
- `supabase/migrations/20260423_post_comment_threads.sql` (post_comments schema: conta lives on the thread)

Migration contents, in order:

1. **Table**:
```sql
CREATE TABLE mencoes (
  id bigserial PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host_type text NOT NULL CHECK (host_type IN ('post_comment','tarefa','workflow_post')),
  host_id bigint NOT NULL,
  mentioned_membro_id bigint NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  author_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mencoes_uq UNIQUE (host_type, host_id, mentioned_membro_id)
);
```
Indexes: `(conta_id)`, `(host_type, host_id)`, `(mentioned_membro_id)`.

2. **RLS** (enable; two policies). `mencoes_tenant_all FOR ALL`: USING `conta_id IN (SELECT public.get_my_conta_id())`; WITH CHECK adds `author_id = auth.uid()` AND an EXISTS tenant guard on `mentioned_membro_id` against `membros` (comment WHY: `resolve_notification_targets` reads membros by id without conta check — a cross-tenant pointer leaks notification payloads; cite the tarefas migration precedent) AND a `CASE mencoes.host_type` with per-host EXISTS guards (`tarefas`, `workflow_posts`, and `post_comments` JOIN `post_comment_threads` for conta) `ELSE false END`. Plus `mencoes_service_role_bypass`.

3. **Type CHECK**: drop + re-add `notifications_type_check` with the 15 values from 20260730000006 PLUS `'mention'` (16 total). Keep the "copied from the LATEST definition (20260730000006), not the original" comment convention, and note this file is now the latest definition.

4. **Notify trigger** `trg_notify_mention()` + `CREATE TRIGGER notify_mention AFTER INSERT ON mencoes FOR EACH ROW`. SECURITY DEFINER, `SET search_path = public`, whole body inside `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING 'trg_notify_mention failed: % %', SQLERRM, SQLSTATE; END` so failures never roll back the insert. Logic:
   - Actor name: `SELECT nome FROM membros WHERE crm_user_id = NEW.author_id AND conta_id = NEW.conta_id LIMIT 1`; fallback `SELECT COALESCE(raw_user_meta_data->>'full_name', email) FROM auth.users WHERE id = NEW.author_id`.
   - Per `NEW.host_type`: `tarefa` → title from `tarefas.titulo`, link `/tarefas?tarefa=<host_id>`; `workflow_post` → title + `workflow_id` from `workflow_posts`, link `/entregas?drawer=<workflow_id>`; `post_comment` → join post_comments→threads→workflow_posts for post title, workflow_id, and `left(pc.content, 140)` excerpt, link `/entregas?drawer=<workflow_id>`.
   - Metadata: `jsonb_strip_nulls(jsonb_build_object('actor_name',…, 'host_type', NEW.host_type, 'host_id', NEW.host_id, 'context_title',…, 'excerpt',…, 'workflow_id',…, 'post_id',…, 'task_id',…))`.
   - Targets: `resolve_notification_targets(NEW.conta_id, NEW.mentioned_membro_id, NULL)`; then `insert_notification_batch(NEW.conta_id, targets, 'mention', link, metadata, NEW.author_id)` (excluding the author silences self-mention). Match the helpers' EXACT signatures from 20260430000001.

5. **Cleanup triggers**: `trg_cleanup_mencoes()` (SECURITY DEFINER, search_path=public) doing `DELETE FROM mencoes WHERE host_type = TG_ARGV[0] AND host_id = OLD.id; RETURN OLD;` + three `AFTER DELETE` triggers on `post_comments` ('post_comment'), `tarefas` ('tarefa'), `workflow_posts` ('workflow_post').

6. **RPC** `sync_mentions(p_host_type text, p_host_id bigint, p_membro_ids bigint[]) RETURNS void`, SECURITY INVOKER (plpgsql default; add a comment that RLS enforces tenancy), `SET search_path = public`:
   - Validate `p_host_type IN ('post_comment','tarefa','workflow_post')` else RAISE.
   - Resolve `v_conta` from the host under the caller's RLS (CASE per host type; post_comment via thread join). `IF v_conta IS NULL THEN RAISE EXCEPTION 'host not found'; END IF;`
   - `DELETE FROM mencoes WHERE host_type = p_host_type AND host_id = p_host_id AND mentioned_membro_id <> ALL (COALESCE(p_membro_ids, '{}'::bigint[]));`
   - `INSERT INTO mencoes (conta_id, host_type, host_id, mentioned_membro_id) SELECT v_conta, p_host_type, p_host_id, s.m FROM (SELECT DISTINCT unnest(p_membro_ids) AS m) s JOIN membros mb ON mb.id = s.m AND mb.conta_id = v_conta ON CONFLICT ON CONSTRAINT mencoes_uq DO NOTHING;` — the JOIN silently drops fabricated, deleted, or cross-tenant membro ids (a hand-typed or legacy token must not poison the whole batch); RLS WITH CHECK remains as belt-and-suspenders.
   - `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated;` (also re-grant to service_role explicitly — REVOKE FROM PUBLIC strips it).

7. **Email groundwork**: `ALTER TABLE notifications ADD COLUMN emailed_at timestamptz;` + partial index on `(created_at) WHERE type = 'mention' AND emailed_at IS NULL AND read_at IS NULL AND dismissed_at IS NULL`. Comment: written only by service_role (mention-email-cron); intentionally NOT added to the authenticated UPDATE column grant.

Verification: `bash -n`-style sanity is not enough for SQL; re-read the migration against each referenced object's definition (helper signatures, column names: `tarefas.titulo`, `workflow_posts.titulo`/`workflow_id`, `post_comments.content`/`thread_id`, `post_comment_threads.post_id`/`conta_id`, `membros.crm_user_id`/`nome`). Do NOT run db push. Commit.

## Task 2: TipTap mention node (CRM + Hub) with schema-superset test

READ first: `apps/crm/src/pages/entregas/components/CommentHighlight.ts` and `CalloutExtension.tsx` (extension patterns), `apps/hub/src/components/CalloutReadonly.tsx` + `apps/hub/src/components/RichTextContent.tsx` (hub duplication pattern + superset invariant comment at top), `apps/crm/src/pages/entregas/components/ReadOnlyTipTap.tsx`, `apps/crm/src/pages/entregas/components/PostEditor.tsx` (extensions array ~L112-137).

1. Pin dep: read the exact installed version in `node_modules/@tiptap/react/package.json`, then `npm install --save-exact @tiptap/suggestion@<that exact version>` (root package.json; must appear WITHOUT caret).
2. `apps/crm/src/components/mentions/types.ts`: `export type MentionEntityType = 'membro' | 'post' | 'cliente' | 'tarefa'; export interface MentionRef { entityType: MentionEntityType; id: number; label: string; parentId?: number | null }`.
3. `apps/crm/src/components/mentions/MentionNode.ts`: `Node.create({ name: 'mention', inline: true, group: 'inline', atom: true, selectable: true })`. Attrs per Global Constraints, persisted as `data-entity-type`, `data-id`, `data-label` (or text content), `data-parent-id` on a `span[data-mention]`. `parseHTML` matches `span[data-mention]`; `renderHTML` outputs `['span', {...mergeAttributes, 'data-mention': '', class: 'mention-chip mention-chip--<entityType>' }, '@' + label]`; `renderText: ({ node }) => '@' + node.attrs.label`. No NodeView needed (plain styled span).
4. `apps/hub/src/components/MentionReadonly.ts`: same node name + IDENTICAL attrs + parseHTML/renderHTML/renderText, non-interactive (no handlers). Header comment pointing at the CRM source file (match CalloutReadonly's convention). Register it inside `richTextExtensions()` in `RichTextContent.tsx`.
5. Register `MentionNode` in `PostEditor.tsx` extensions and in `ReadOnlyTipTap.tsx`.
6. **Superset test** (Vitest): locate the hub test setup (`apps/hub/**/__tests__` or vitest config include). Test: build a TipTap doc JSON containing a paragraph with a `mention` node (all four entityTypes), run it through the hub's `richTextExtensions()` via `generateHTML` (from `@tiptap/core` or `@tiptap/html`) or a headless Editor, assert output contains the labels (proves the doc is not silently discarded). Mirror test on CRM side for `ReadOnlyTipTap`'s extension list if that list is exported/exportable.

Verification: `npm run test` (new tests pass), `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`. Commit.

## Task 3: Chip styling + navigation helper

1. `apps/crm/src/components/mentions/mentionHref.ts`: `mentionHref(ref: MentionRef): string | null` → membro `/equipe/<id>`; cliente `/clientes/<id>`; tarefa `/tarefas?tarefa=<id>`; post: `parentId ? '/entregas?drawer=' + parentId : null` (null = render unlinked).
2. `apps/crm/src/components/mentions/MentionChip.tsx`: presentational chip used OUTSIDE TipTap (by MentionText in Task 5). Lucide icons: membro `User`, post `FileText`, cliente `Building2`, tarefa `CheckSquare`. Renders `@Label`; wraps in react-router `<Link>` when `mentionHref` returns non-null, else a plain span.
3. CSS in `apps/crm/style.css` near the editor block (~line 6679, `.post-editor-content` area): `.mention-chip` (inline chip: subtle tinted bg using existing tokens, e.g. `--surface-2`/`--primary-color` tints, radius, padding 1px 6px, no underline) + per-type accent classes `.mention-chip--membro|--post|--cliente|--tarefa`. Must look right in dark mode (`[data-theme='dark']`) and in the Hub (hub imports this stylesheet; keep it token-based).
4. In-editor click navigation in `PostEditor.tsx`: extend the existing DOM click handling on the editor (see the comment-highlight click listener pattern ~L247-272) to detect clicks on `span[data-mention]`, build the href from its data-attrs, and `navigate(href)` via react-router. Readonly CRM renderer (`ReadOnlyTipTap`) gets the same treatment ONLY if it already has a click-handler pattern; otherwise skip (chips there are informational).

Verification: `npm run test`, CRM tsc. Commit.

## Task 4: @ suggestion dropdown in PostEditor

READ first: `PostEditor.tsx` (BubbleMenu + link popover positioning pattern ~L177-201, comment popover clamp math ~L543-601; props `membros`, `workspaceUsers`), `apps/crm/src/store/team.ts` (Membro type), `apps/crm/src/store/clients.ts` + `apps/crm/src/store/tarefas.ts` (list fns + queryKeys used by pages), `apps/crm/src/store/posts.ts`.

1. `searchPostsForMention(term: string)` in `store/posts.ts`: supabase `from('workflow_posts').select('id, titulo, workflow_id').ilike('titulo', '%term%').limit(5)` (escape `%_` in term).
2. `apps/crm/src/components/mentions/useMentionSearch.ts`: input = query string. Sections: **Pessoas** from `useQuery(['membros'], getMembros)` (reuse the EXISTING queryKey shape used elsewhere — check `useTarefasData.ts`); **Clientes** from the existing clientes list query; **Tarefas** from the existing tarefas list query; **Posts** async via `searchPostsForMention` debounced ~200ms (only when query length ≥ 1). Client-side filter: accent-insensitive (`String.normalize('NFD').replace(/\p{Diacritic}/gu,'')`), case-insensitive, cap 5 per section. Empty query → Pessoas only. Each result maps to `MentionRef` (posts get `parentId = workflow_id`).
3. `apps/crm/src/components/mentions/MentionList.tsx`: portal-rendered dropdown (createPortal to document.body, `position: fixed`, clamp to viewport — copy the popover math pattern). Section headers Pessoas / Posts / Clientes / Tarefas (only non-empty sections). Rows: avatar (membros, reuse existing avatar rendering pattern) or entity icon + label. Keyboard: ArrowUp/ArrowDown/Enter/Escape via an imperative handle (standard TipTap suggestion pattern). Empty state: "Nenhum resultado".
4. `apps/crm/src/components/mentions/mentionSuggestion.ts`: `@tiptap/suggestion` config factory — `char: '@'`, `items` from the search hook's imperative fetcher, `render()` lifecycle mounting/updating/destroying MentionList at `props.clientRect`, `command` inserts the `mention` node (`{ type: 'mention', attrs: ref }` + trailing space). Wire as a plugin of MentionNode (`addProseMirrorPlugins` or `Extension`) but ONLY on the editable CRM editor (PostEditor) — the hub/readonly nodes must NOT gain the suggestion plugin. Suggestion needs the search data: pass membros etc. via editor storage or a React-side config injected in `PostEditor` (`useEditor` deps).
5. Dropdown must work inside the entregas drawer (overflow-clipped container) — the fixed-position portal handles this; verify z-index above the drawer.

Verification: `npm run test`, CRM tsc, plus a Vitest test for the accent-insensitive filter + section capping in `useMentionSearch` (pure helper extraction is fine). Commit.

## Task 5: Plain-text mention tokens (comments + tarefas)

READ first: `apps/crm/src/pages/entregas/components/PostCommentPopover.tsx` (textareas at ~L159 edit / ~L315 reply; comment body render ~L181), `PostEditor.tsx` add-comment textarea ~L579, `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx` (~L217 descricao Textarea), `TarefaDetailSheet.tsx` (~L306 descricao render).

1. `apps/crm/src/components/mentions/mentionTokens.ts`:
   - `MENTION_TOKEN_RE` per Global Constraints.
   - `parseMentionTokens(text): Array<{ kind: 'text', value: string } | { kind: 'mention', ref: MentionRef }>`.
   - `formatMentionToken(ref): string` → `@[Label](tipo:id)` / `@[Label](post:id:parentId)`.
   - `extractMentionsFromText(text): MentionRef[]` (deduped by `entityType:id`).
   - `extractMentionsFromDoc(docJson): MentionRef[]` — recursive walk over TipTap JSON collecting `type === 'mention'` node attrs, deduped.
2. `apps/crm/src/components/mentions/MentionText.tsx`: renders a string via `parseMentionTokens` → text segments + `MentionChip`s, preserving `whitespace-pre-wrap`.
3. `apps/crm/src/components/mentions/MentionTextarea.tsx`: controlled textarea drop-in (same props surface as a normal textarea + `onValueChange`). Detects an active `@query` immediately before the caret, shows `MentionList` (reuse from Task 4) anchored to the textarea's bottom edge (fixed, portal), keyboard nav; selecting inserts `formatMentionToken(ref)` at the trigger position. Escape closes. It uses `useMentionSearch`.
4. Wire in:
   - PostCommentPopover reply + edit textareas → `MentionTextarea`; comment body render → `MentionText`.
   - PostEditor add-comment textarea → `MentionTextarea`.
   - TarefaFormDialog descricao → `MentionTextarea`.
   - TarefaDetailSheet descricao render → `MentionText`.
5. Tests (Vitest): token round-trip (`formatMentionToken` → `parseMentionTokens`), post token with and without workflow segment, `extractMentionsFromText` dedup, `extractMentionsFromDoc` on a nested doc, plain text without tokens passes through untouched.

Verification: `npm run test`, CRM tsc. Commit.

## Task 6: Notification type + bell display

READ first: `apps/crm/src/store/notifications.ts` (NotificationType union, line ~3), `apps/crm/src/lib/notification-config.ts` (getNotificationDisplay switch + `s()` coercer + defensive default), any existing tests for notification-config.

1. Add `| 'mention'` to the union.
2. Add `case 'mention'` in `getNotificationDisplay`: icon `AtSign` (lucide), tone matching an existing informational tone, title `` `${s(metadata.actor_name, 'Alguém')} mencionou você` ``, body: `metadata.excerpt` fallback `metadata.context_title` fallback ''. NO em-dash in copy.
3. Test: `getNotificationDisplay('mention', {...})` renders title/body; unknown-type default still works.

Verification: `npm run test`, CRM tsc. Commit.

## Task 7: syncMentions store wiring

READ first: `apps/crm/src/store/comments.ts` (createCommentThread ~L49, addPostComment ~L83, updatePostComment ~L95), `apps/crm/src/store/tarefas.ts` (addTarefa ~L76, updateTarefa ~L97), `apps/crm/src/store/posts.ts` (updateWorkflowPost ~L558), call sites of these fns in components (PostCommentPopover, PostEditor, TarefaFormDialog, WorkflowDrawer or wherever post content saves), `supabase/functions/data-import/handler.ts` doc block ~L167-220.

1. `apps/crm/src/store/mentions.ts`: `export type MentionHostType = 'post_comment' | 'tarefa' | 'workflow_post'; export async function syncMentions(hostType, hostId, membroIds: number[]): Promise<void>` — calls `supabase.rpc('sync_mentions', { p_host_type, p_host_id, p_membro_ids })`, catches + `console.error`s, NEVER throws (mention failure must not fail the save). Call it even with an empty array (clears removed mentions on edit).
2. Wire the call sites; each computes membro ids from content. Token trust model: any `@[label](membro:id)` string in content is treated as a mention attempt; the `sync_mentions` RPC drops ids that don't exist in the caller's workspace, so hand-typed or stale tokens are harmless. Call sites:
   - `createCommentThread`/`addPostComment`/`updatePostComment`: after the comment row exists, `extractMentionsFromText(content)` → filter `entityType === 'membro'` → `syncMentions('post_comment', commentId, ids)`. (For createCommentThread: host is the created comment's id.)
   - `addTarefa`/`updateTarefa`: when `descricao` is written, extract from descricao → `syncMentions('tarefa', tarefaId, ids)`.
   - `updateWorkflowPost`: when the patch includes `conteudo`, `extractMentionsFromDoc(conteudo)` → `syncMentions('workflow_post', postId, ids)`.
   - **Edit-suggestion acceptance**: the store fn that calls `supabase.rpc('accept_edit_suggestion', ...)` (find it via `apps/crm/src/__tests__/store.editSuggestions.test.ts`) updates `workflow_posts.conteudo` server-side, bypassing `updateWorkflowPost`. After a successful accept, extract from the accepted `suggested_conteudo` doc (available at the call site) → `syncMentions('workflow_post', postId, ids)`.
   - **Solicitação→tarefa conversion**: `apps/crm/src/store/ideias.ts` ~L111 calls `supabase.rpc('convert_solicitacao_em_tarefa', ...)` creating a tarefa with a descricao outside `addTarefa`. After the RPC returns the new tarefa id, extract from the descricao text → `syncMentions('tarefa', tarefaId, ids)`.
   Keep extraction INSIDE the store fns (no signature changes needed for callers) — simpler than the optional-param contract, and content is already in hand. Deletion paths need nothing (DB cleanup triggers).
3. `data-import/handler.ts` doc block: add one sentence recording `mencoes` as intentionally excluded (derived notification ledger, trigger-cleaned, not imported).
4. Tests: mock `supabase.rpc`; assert `addPostComment('… @[Ana](membro:5) …')` fires `sync_mentions` with `[5]`; assert rpc rejection does not reject the save; assert updateWorkflowPost with a doc containing mention nodes fires with the right ids.

Verification: `npm run test`, CRM tsc. Commit.

## Task 8: mention-email-cron edge function

READ first: `supabase/functions/notification-deadline-cron/` (entire folder: auth pattern, service-role client, structure, and its tests if any under `supabase/functions/__tests__/` or sibling), `supabase/functions/_shared/lifecycle-emails.ts` + `_shared/invite-email.ts` (Resend fetch pattern), `_shared/cors.ts`, `supabase/migrations/20260730000002_schedule_lifecycle_email_cron.sql` (cron-schedule migration pattern), and `supabase/config.toml` (per-function `verify_jwt` entries).

0. **config.toml**: add a `[functions.mention-email-cron]` / `verify_jwt = false` entry mirroring `[functions.notification-deadline-cron]` — a pg_cron request carries only `x-cron-secret` and dies at the gateway if JWT verification stays on.
0b. **Scheduling migration** `supabase/migrations/20260803000002_schedule_mention_email_cron.sql` (shipped as `20260803000007_schedule_mention_email_cron.sql` — see the Global Constraints update above), mirroring 20260730000002: idempotent (`cron.unschedule` if exists, then `cron.schedule`), cadence **every 5 minutes**, secret via vault following the existing pattern exactly (remember: `vault.decrypted_secrets` is a VIEW). Add a header comment: deploy the edge function BEFORE applying this migration; rollback = `SELECT cron.unschedule(...)` before undeploying.

1. `supabase/functions/_shared/mention-email.ts`: `sendMentionEmail({ to, mentions: Array<{actorName, contextTitle, excerpt?, link}> })` — PT-BR copy, subject `Você foi mencionado no Mesaas` (or `${n} novas menções`), simple HTML listing each mention ("<actor> mencionou você em «<title>»") with absolute CRM links (base from an env var used by existing emails — check `invite-email.ts`/`lifecycle-emails.ts` for the base-URL convention). Direct Resend fetch, `RESEND_API_KEY` from env; if unset, return `{ skipped: true }` without sending. NO em-dashes in copy. Escape interpolated user data with the existing escapeHTML helper used by other _shared emails (check; if none exists there, write a local escape fn).
2. `supabase/functions/mention-email-cron/index.ts` (+ handler split if that's the deadline cron's structure): verify `x-cron-secret` against `CRON_SECRET` (401 otherwise, generic body). Service-role client. **Claim-first semantics** (at-most-once; prevents double-emails from overlapping/crashed runs — email is a courtesy copy, the bell is the reliable channel): if `RESEND_API_KEY` is unset, return `{ skipped: true }` immediately WITHOUT claiming anything. Otherwise atomically claim: `UPDATE notifications SET emailed_at = now() WHERE type = 'mention' AND read_at IS NULL AND dismissed_at IS NULL AND emailed_at IS NULL AND created_at <= now() - interval '10 minutes' AND created_at >= now() - interval '24 hours' RETURNING id, user_id, metadata, link, created_at` (single statement — the emailed_at IS NULL predicate makes concurrent runs disjoint). Group claimed rows by `user_id`; resolve each user's email via `auth.admin.getUserById`; one email per user per run. If a user's send FAILS, best-effort reset `emailed_at = NULL` for that user's claimed ids (a crash between claim and send loses that email — accepted). **Every I/O call (supabase queries and the Resend fetch) gets an `AbortSignal.timeout(...)`** — repo rule: a hung call can kill the isolate outside catch. Return counts `{ claimed, emailed, failed, skipped }`; log details internally only.
3. Deno tests mirroring the deadline cron's test style: missing secret → 401; claim honors all five filters (mock/fake supabase per existing test conventions); one email per user; failed send resets that user's claims; RESEND_API_KEY absent → returns skipped WITHOUT claiming.

Verification: `deno test supabase/functions/` (or the repo's `npm run test:functions`), then `git checkout -- deno.lock`; `npx tsc -p tsconfig.scripts.json` unaffected but run the four tsc configs anyway. Commit.

## Task 9: Full verification sweep

No new features. Run and fix anything broken:
- `npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json`
- `npm run test`
- `npm run test:functions` then `git checkout -- deno.lock`
- `npm run lint`
- `npm run format:check` (run `npm run format` first to auto-fix)
Commit any fixes.
