# Tarefas: comentários e histórico (PR B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A flat team comment thread with @mentions and `task_comment` notifications on every task, and a history timeline recording task, subtask, tag and series-attachment changes from deploy onward.

**Architecture:** Two migrations: `tarefa_comentarios` (written only through a SECURITY DEFINER RPC that parses mentions server-side and upserts deduped notifications) and `tarefa_eventos` (written only by tenant-scoped, exception-swallowing AFTER triggers, backfilled with `criada`/`concluida`). Frontend: store functions, a pure timeline builder, a comments component with realtime, both mounted in the desktop sheet (header buttons, body swap for history) and the phone detail.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql, realtime), React 19, TanStack Query, Vitest + Testing Library, psql entitlement suites, i18next (`@mesaas/i18n`).

**Spec:** `docs/superpowers/specs/2026-10-28-tarefas-kpis-comentarios-historico-design.md` (sections 2, 3, Rollout, Tests). PR A (sections 1 and 4) is built separately on the same branch; this plan starts from its tip.

## Global Constraints

- User-facing copy pt-BR (plus en mirror in `packages/i18n/locales/en/`), sentence case, **no em dashes**.
- Migrations: `supabase/migrations/20261104000001_tarefa_comentarios.sql`, `supabase/migrations/20261104000002_tarefa_eventos.sql`. Before opening the PR, renumber above `origin/main`'s highest prefix if it moved.
- Every new table: `conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`, composite FK `(tarefa_id, conta_id) → tarefas(id, conta_id) ON DELETE CASCADE`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` then explicit grants, `service_role` bypass policy.
- Every new function: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon` (and `authenticated` unless it is the RPC).
- Comment cap 4000 chars (`DISCUSSAO_MAX_CHARS`). Mention regexp `'\]\(membro:([0-9]+)\)'`.
- New notification type `task_comment`, in-app only: touch `notifications_type_check` and `notification_inapp_prefs_type_check` (lists copied from `20261031000003_linha_editorial_hub_notifications.sql:29-68`); never `notification_email_prefs_type_check` nor `claim_notification_emails`.
- Links: `/tarefas?tarefa=<id>&comentarios=1`.
- Timeline footnote constant: "Histórico registrado a partir de 28/10/2026". Unknown actor label "Automação"; missing author "Usuário removido".
- CSS for new classes goes in `apps/crm/app.css` (signed-in only).
- Unsaved composer text: `useUnsavedWork(text.trim().length > 0 || sending)`.
- Prettier only on changed files. Typecheck all four projects before pushing.

## Review Focus

1. A comment sent while the recipient already has an unread `task_comment` for that task: must update the existing notification (count +1), never fail the send. → Task 1 SQL test `second_comment_upserts`.
2. A task whose `responsavel_id`/`cliente_id` points at another workspace (service-role write): history must store `nome: null`, not the foreign name. → Task 2 SQL test `snapshot_is_tenant_scoped`.
3. Deleting a task with subtasks and tags: must succeed with no FK error and leave no events. → Task 2 SQL test `cascade_delete_clean`.
4. Re-saving the edit form with the same tags (old two-request path and new diff path): no tag entries in the timeline. → Task 5 test `nets_same_tag_pairs`.
5. Opening `/tarefas?tarefa=<id>&comentarios=1` while the page is already mounted: sheet opens with comments focused once, and does not refocus on later renders. → Task 7 test `deep_link_focuses_comments_once`.

---

### Task 1: Migration `tarefa_comentarios` (table, RPC, mentions, notifications)

**Files:**
- Create: `supabase/migrations/20261104000001_tarefa_comentarios.sql`
- Test: `supabase/tests/entitlements/99_tarefa_comentarios.sql` (model on `99_post_discussao.sql`; call `et_grant_hosted_parity()` before raw selects as `authenticated`)

**Interfaces:**
- Produces: table `tarefa_comentarios(id bigserial, conta_id uuid, tarefa_id bigint, author_id uuid NULL → auth.users ON DELETE SET NULL, conteudo text CHECK (char_length BETWEEN 1 AND 4000), created_at timestamptz, edited_at timestamptz NULL)`, index `(tarefa_id, created_at)`.
- Produces: `public.tarefa_comentario_enviar(p_tarefa_id bigint, p_conteudo text) RETURNS tarefa_comentarios`.
- Produces: `mencoes.host_type` value `'tarefa_comentario'`; notification type `'task_comment'` with metadata `{task_id text, task_title, author_name, authors, count, preview}`.

- [ ] **Step 1: Write the failing SQL suite** with these named cases (each a `DO` block raising on failure, as in `99_post_discussao.sql`):
  - `foreign_workspace_cannot_read`: user of workspace B selects 0 rows of A's comments.
  - `rpc_rejects_foreign_task`: B calls the RPC on A's task → exception.
  - `direct_insert_denied`: `authenticated` INSERT into `tarefa_comentarios` → permission error.
  - `only_author_updates_and_deletes`: second member of A updates/deletes the first's comment → 0 rows affected; author → 1; `edited_at` set after the author's update.
  - `participants_notified_once`: assignee + creator + earlier commenter each get one unread `task_comment`, the author none.
  - `second_comment_upserts`: second comment → still one unread row per recipient, `metadata->>'count' = '2'`.
  - `mentioned_gets_mention_not_task_comment`: content with `@[X](membro:<id>)` of the assignee → assignee has a `mention`, and no new/updated `task_comment`.
  - `foreign_membro_mention_dropped`: mention of a B membro → no `mencoes` row.
  - `edit_adds_mention`: author UPDATEs content then calls `sync_mentions('tarefa_comentario', id, ARRAY[m])` as `authenticated` → `mencoes` row exists (proves the `mencoes_tenant_all` arm).
  - `non_author_sync_rejected`: another member calls `sync_mentions` on that comment → exception, no row.
  - `cleanup_on_delete`: deleting the comment removes its `mencoes` rows.
  - `oversized_mention_token_ignored`: content with `@[X](membro:99999999999999999999)` sends fine, no `mencoes` row.
  - `author_cannot_update_author_id`: author `UPDATE ... SET author_id = ...` → `insufficient_privilege`.
  - In the blocks that assert grants (`direct_insert_denied`, `author_cannot_update_author_id`, `only_author_updates_and_deletes`) call `et_grant_hosted_parity(ARRAY['tarefa_comentarios'])` so the helper does not re-grant the table under test (`_helpers.sql:28-31`).

- [ ] **Step 2: Run it to verify it fails**
  Run: `bash scripts/test-entitlements.sh` (needs Docker/colima; see memory on local Supabase). Expected: fails on missing relation `tarefa_comentarios`. If Docker is unavailable, note it and rely on CI's `entitlement-tests`.

- [ ] **Step 3: Write the migration**, in this order:
  1. Table, index, `edited_at` BEFORE UPDATE trigger (sets `now()` when `conteudo` changes), RLS on, policies: SELECT `conta_id IN (SELECT get_my_conta_id())`; UPDATE/DELETE that plus `author_id = auth.uid()`; service_role bypass. Grants: `SELECT, DELETE`, `UPDATE (conteudo)` to `authenticated`; `ALL` to `service_role`. Realtime: add to `supabase_realtime` inside the `DO ... IF NOT EXISTS (SELECT 1 FROM pg_publication_tables ...)` guard used at `20261021100000:263-275`.
  2. `mencoes`: drop `mencoes_host_type_check` (the inline CHECK's auto-name; only `20260803000006` defines it) and re-add it with `'tarefa_comentario'`; DROP + CREATE `mencoes_tenant_all` copying `20260803000006_mencoes.sql:37-80` verbatim plus the arm `WHEN 'tarefa_comentario' THEN EXISTS (SELECT 1 FROM tarefa_comentarios tc WHERE tc.id = mencoes.host_id AND tc.conta_id = mencoes.conta_id)`.
  3. `CREATE OR REPLACE sync_mentions` from `20260803000006:249-325`: add `'tarefa_comentario'` to the `NOT IN` guard at `:267` **and** a `CASE` branch resolving `conta_id` from `tarefa_comentarios` with `AND tc.author_id = auth.uid()` (no row → the existing `host not found` raise); keep its grants.
  4. Cleanup trigger `cleanup_mencoes_tarefa_comentario` AFTER DELETE on `tarefa_comentarios` (pattern `20260803000006:229-240`).
  5. `CREATE OR REPLACE trg_notify_mention()` copied whole from `20261025000003_post_discussao_notify.sql:234-end-of-function` plus a `'tarefa_comentario'` branch: `v_context_title` = task title via `tc.tarefa_id` with `tc.conta_id = NEW.conta_id AND t.conta_id = NEW.conta_id`, `v_excerpt := left(tc.conteudo, 140)`, `v_task_id`, link `/tarefas?tarefa=<tarefa_id>&comentarios=1`, `RETURN NEW` early when the title is NULL.
  6. Notification type lists (both CHECKs) with `task_comment` added; dedupe index `notifications_task_comment_unread_uq ON notifications (user_id, (metadata->>'task_id')) WHERE type = 'task_comment' AND read_at IS NULL AND dismissed_at IS NULL`.
  7. RPC `tarefa_comentario_enviar`: tenant check like `post_discussao_post_do_chamador` (`20261025000002:49-69`); insert; `PERFORM sync_mentions('tarefa_comentario', v_id, post_discussao_membro_ids(p_conteudo, v_conta))` (existing helper, `20261025000002:69-84`: length guard against bigint overflow + conta scoping; callable from a DEFINER RPC as `post_discussao_enviar` does at `:168-169`); then inside `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING` an upsert **adapted** from `20261025000003:109-150` (that block references `wp.*`, `v_via_rpc`, `v_mencionados`, `post_discussao_participantes`, none of which apply), recipients = `UNION` of `unnest(resolve_notification_targets(conta, responsavel_id, NULL))`, `tarefas.user_id`, distinct earlier `author_id`s; `EXCEPT` the author and the `crm_user_id`s of the membros `mencoes` actually holds for this comment; filtered to `workspace_members` of the task's conta. `REVOKE ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO authenticated`.

- [ ] **Step 4: Run the suite to verify it passes**
  Run: `bash scripts/test-entitlements.sh`. Expected: every case passes, existing suites (`99_post_discussao.sql` especially) still pass.

- [ ] **Step 5: Commit** — `feat(tarefas): tabela e RPC de comentários com menções e notificação`

### Task 2: Migration `tarefa_eventos` (table, triggers, backfill)

**Files:**
- Create: `supabase/migrations/20261104000002_tarefa_eventos.sql`
- Test: `supabase/tests/entitlements/99_tarefa_eventos.sql`

**Interfaces:**
- Produces: table `tarefa_eventos(id bigserial, conta_id uuid, tarefa_id bigint, tipo text, actor_user_id uuid NULL, actor_nome text NULL, de jsonb NULL, para jsonb NULL, txid bigint NOT NULL DEFAULT txid_current(), created_at timestamptz DEFAULT now())`, index `(tarefa_id, created_at)`.
- `tipo` CHECK: `criada, status, responsavel, prazo, titulo, descricao, cliente, recorrencia, subtarefa_adicionada, subtarefa_concluida, subtarefa_reaberta, subtarefa_removida, tag_adicionada, tag_removida`.
- Value shapes: `status`/`titulo`/`prazo` → JSON strings or null; `responsavel`/`cliente` → `{id, nome}`; `recorrencia` → series id or null; `subtarefa_*` → `para = {titulo}`; `tag_*` → `para = {id, nome, cor}`; `criada` → `para = {serie: bool}`; `descricao` → both null.

- [ ] **Step 1: Write the failing SQL suite** with cases:
  - `insert_logs_criada` (actor = caller; with `serie_id` set → `para.serie = true`).
  - `update_logs_each_changed_field_only`: change status + prazo → exactly 2 events; re-saving identical values → 0; touching only `updated_at` → 0.
  - `responsavel_snapshot`: `{id, nome}` with the membro's name.
  - `snapshot_is_tenant_scoped`: as service_role set `responsavel_id` to a B membro on an A task → event `para->>'nome' IS NULL`.
  - `subtask_and_tag_events`: add/toggle/remove a subtask and add/remove a tag → the six expected tipos.
  - `cascade_delete_clean`: delete a task that has subtasks and tags → succeeds; 0 events left for it.
  - `trigger_error_never_blocks`: temporarily `ALTER TABLE tarefa_eventos ADD CONSTRAINT x CHECK (false) NOT VALID`, update a task → update succeeds; drop the constraint.
  - `foreign_workspace_cannot_read` and `authenticated_cannot_write` (INSERT/UPDATE/DELETE all raise `insufficient_privilege`; call `et_grant_hosted_parity(ARRAY['tarefa_eventos'])` in that block).
  - `criada_with_gone_creator`: service-role insert of a task whose `user_id` is not in `auth.users` → `criada` row with `actor_user_id` NULL.
  - `backfill_shape`: insert a concluded task, delete its trigger-made events, call `_tarefa_eventos_backfill()`, assert one `criada` and one `status` (`para = '"concluida"'`, actor NULL). (No task exists before the migration in the test DB, so the backfill is a function.)

- [ ] **Step 2: Run it to verify it fails** — `bash scripts/test-entitlements.sh`, expected: missing relation.

- [ ] **Step 3: Write the migration:** table + RLS (SELECT by `get_my_conta_id()`, service_role bypass) + grants (`SELECT` to `authenticated`); helper `_tarefa_evento_registrar(p_conta uuid, p_tarefa bigint, p_tipo text, p_de jsonb, p_para jsonb)` (DEFINER, revoked from everyone but owner) that resolves `actor_user_id = auth.uid()` and `actor_nome` from `membros WHERE crm_user_id = auth.uid() AND conta_id = p_conta`, and inserts; triggers, each body wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING`:
  - `tarefas_evento_insert` AFTER INSERT (`criada`, actor `COALESCE(auth.uid(), CASE WHEN EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN NEW.user_id END)`; `tarefas.user_id` has no FK).
  - `tarefas_evento_update` `AFTER UPDATE OF status, responsavel_id, data_limite, titulo, descricao, descricao_rich, cliente_id, serie_id`, one call per `IS DISTINCT FROM` field; `membros`/`clientes` lookups `AND conta_id = NEW.conta_id`.
  - `subtarefas_evento` AFTER INSERT/UPDATE OF concluida/DELETE; `tarefa_tag_links_evento` AFTER INSERT/DELETE (tag lookup `AND conta_id = ...`). Both return early when `NOT EXISTS (SELECT 1 FROM tarefas WHERE id = <tarefa_id> AND conta_id = <conta_id>)`.
  - Backfill as `_tarefa_eventos_backfill()` (DEFINER, revoked from all API roles), called once at the end of the migration: `criada` per task at `created_at` with actor via `LEFT JOIN auth.users u ON u.id = t.user_id` and `actor_nome` from the creator's membro in that conta; plus `status` (`de` null, `para` `"concluida"`) at `concluida_em` for concluded tasks, actor NULL.

- [ ] **Step 4: Run the suite** — all pass, plus `99_tarefa_series_*` still pass (series RPCs write tasks).

- [ ] **Step 5: Commit** — `feat(tarefas): histórico de alterações por trigger`

### Task 3: Store layer

**Files:**
- Create: `apps/crm/src/store/tarefaComentarios.ts`
- Modify: `apps/crm/src/store/tarefas.ts` (`getTarefas` select + mapping, `setTarefaTags` diff, `TarefaWithRelations.comentarios_total`), `apps/crm/src/store/mentions.ts` (`MentionHostType`), `apps/crm/src/store/comments.ts` (export `membroMentionIds`), `apps/crm/src/store/index.ts` (`export *` of the new module)
- Test: `apps/crm/src/__tests__/store.tarefaComentarios.test.ts` and a new `apps/crm/src/__tests__/store.tarefas.test.ts` for getTarefas/setTarefaTags; mock pattern from `store.tarefas.mentions.test.ts:3-27` (`vi.mock('../lib/supabase')`, `__queueSupabaseResult`, `__queueSupabaseRpc`)

**Interfaces:**
- Produces:
  ```ts
  export interface TarefaComentario { id: number; conta_id: string; tarefa_id: number; author_id: string | null; conteudo: string; created_at: string; edited_at: string | null }
  export type TarefaEventoTipo = 'criada' | 'status' | 'responsavel' | 'prazo' | 'titulo' | 'descricao' | 'cliente' | 'recorrencia' | 'subtarefa_adicionada' | 'subtarefa_concluida' | 'subtarefa_reaberta' | 'subtarefa_removida' | 'tag_adicionada' | 'tag_removida'
  export interface TarefaEvento { id: number; tarefa_id: number; tipo: TarefaEventoTipo; actor_user_id: string | null; actor_nome: string | null; de: unknown; para: unknown; txid: number; created_at: string }
  getTarefaComentarios(tarefaId: number): Promise<TarefaComentario[]>        // ordered created_at asc
  enviarTarefaComentario(tarefaId: number, conteudo: string): Promise<TarefaComentario>  // rpc tarefa_comentario_enviar
  updateTarefaComentario(id: number, conteudo: string): Promise<void>          // update + syncMentions('tarefa_comentario', id, membroMentionIds(conteudo))
  deleteTarefaComentario(id: number): Promise<void>
  getTarefaEventos(tarefaId: number): Promise<TarefaEvento[]>                  // ordered created_at desc
  TAREFA_COMENTARIO_MAX_CHARS = 4000
  ```
  `MentionHostType` gains `'tarefa_comentario'`. `TarefaWithRelations.comentarios_total: number`.
- `membroMentionIds` lives in `store/comments.ts:5`; export and reuse it rather than duplicating.

- [ ] **Step 1: Failing tests** (mock supabase the way neighbouring store tests do): `enviar calls rpc with p_tarefa_id/p_conteudo`; `update syncs mentions with parsed ids`; `update with no mentions syncs []`; `getTarefas maps tarefa_comentarios(count) to comentarios_total (0 when absent)`; `setTarefaTags deletes only removed and inserts only added` (current `[1,2]`, next `[2,3]` → delete `in (1)`, insert `3`; identical sets → no write).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/__tests__/store.tarefaComentarios.test.ts <tarefas store test>` — expect FAIL.
- [ ] **Step 3: Implement.** `setTarefaTags` reads current links (`select tag_id`) then diffs.
- [ ] **Step 4: Run** — PASS. Also `npx vitest run apps/crm/src/pages/tarefas` (mock fixtures may need `comentarios_total: 0`).
- [ ] **Step 5: Commit** — `feat(tarefas): store de comentários e eventos`

### Task 4: `task_comment` notification in the frontend

**Files:**
- Modify: `apps/crm/src/store/notifications.ts` (`NotificationType` union), `apps/crm/src/lib/notification-catalog.ts` (entry next to `task_assigned` ~:135), `apps/crm/src/lib/notification-config.ts` (display reusing `postDiscussionDisplay` shape ~:71-104; in-app only, like `post_discussion` ~:320/:382), `packages/i18n/locales/{pt,en}/settings.json` (preference label next to post_discussion's), the notification copy namespace the catalog already uses.
- Test: the existing notification-config / catalog tests (`grep -rl "post_discussion" apps/crm/src --include=*.test.*`).

**Interfaces:** Consumes metadata keys from Task 1. Produces display: title "Novo comentário em <task_title>" (or "N novos comentários em ..." when `count > 1`), body = `preview`, link from the row.

- [ ] **Step 1: Failing tests** (model: `notification-config.post-discussion.test.ts`): `task_comment renders title with task title`; `count 3 renders plural`; `task_comment catalog entry has emailEligible: false` (as `:152-158`). `notification-catalog.i18n.test.ts:17-45` already enforces pt+en `settings.json` keys for every catalog entry.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(notificacoes): tipo task_comment`

### Task 5: Timeline builder and list

**Files:**
- Create: `apps/crm/src/pages/tarefas/tarefaTimeline.ts`, `apps/crm/src/pages/tarefas/components/TarefaHistoryList.tsx`
- Modify: `packages/i18n/locales/{pt,en}/tasksForm.json` (new `historico` section). Tones map onto the existing `history-step-icon--*` / `history-step-line--*` classes (`app.css:10105-10127`: `ok`, `neutral`, `late`, `published`, `approved`, `correction`, `failed`); no new CSS. Use `ok` for `success`, `late` for `warning`, `published` for `info`, `approved` for `primary`, `neutral` for `neutral`.
- Test: `apps/crm/src/pages/tarefas/__tests__/tarefaTimeline.test.ts`, `.../TarefaHistoryList.test.tsx`

**Interfaces:**
- Consumes: `TarefaEvento`, `Membro` (`crm_user_id`, `nome`).
- Produces:
  ```ts
  export interface TarefaTimelineNode { key: string; tipo: TarefaEventoTipo; text: string; actorLabel: string; at: string; tone: 'neutral' | 'success' | 'warning' | 'info' | 'primary' }
  export function buildTarefaTimeline(eventos: TarefaEvento[], membros: Membro[], formatDate: (isoDate: string) => string): TarefaTimelineNode[]  // newest first; sentences via i18n.t('tasksForm:historico.*'); no `now` param on purpose (collapse uses deltas between events)
  export const HISTORICO_DESDE = '28/10/2026'
  export function TarefaHistoryList(props: { nodes: TarefaTimelineNode[] }): JSX.Element
  ```
- Rules: actor = membro by `crm_user_id` → `actor_nome` → "Automação"; `criada` with `para.serie` → "Recorrência criou a tarefa"; tag netting (same tag id, remove+add, same txid **or** same actor within 5 s → both dropped); same tipo + same actor within 2 min collapse into one node with the first `de` and last `para`; dates via `useIntlLocale` formatting in the component, raw ISO in nodes.
- Markup: `.history-timeline` / `.history-step` / `.history-step-track` / `.history-step-icon--{tone}` / `.history-step-name` / `.history-step-detail` as in `PostTimelinePopover.tsx:30`; lucide icon per tipo; `title` attribute with the absolute date; footnote "Histórico registrado a partir de 28/10/2026." under the list.

- [ ] **Step 1: Failing tests:** `status sentence` ("Ana mudou o status de Pendente para Em andamento"); `prazo sentence with dd/MM`; `responsavel from null`; `actor falls back to actor_nome then Automação`; `recurrence-created criada`; `nets_same_tag_pairs` (same txid; and different txids 2 s apart same actor); `collapses prazo moves within 2 min` (3 events → 1 node, first de/last para); `does not collapse across actors`; list renders footnote and one item per node.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(tarefas): linha do tempo do histórico`

### Task 6: Comments component and hook

**Files:**
- Create: `apps/crm/src/pages/tarefas/components/TarefaComentarios.tsx`, `apps/crm/src/pages/tarefas/hooks/useTarefaComentarios.ts`
- Modify: `apps/crm/src/pages/entregas/discussao/useDiscussaoActions.ts` (narrow `useDiscussaoComposer` to `{ send, sending }` + toast message param; update its callers), `apps/crm/app.css` (comment classes), `packages/i18n/locales/{pt,en}/tasksForm.json` (`comentarios` section)
- Test: `apps/crm/src/pages/tarefas/__tests__/TarefaComentarios.test.tsx`; existing discussao tests must still pass.

**Interfaces:**
- Consumes: Task 3 store functions; `getWorkspaceUsers` with key `['workspace-users']` (as `StandalonePostDrawer.tsx:246`); `resolveAuthor`-style logic (`DiscussaoEquipe.tsx:50`, copy it to a small local function in the same order as the original, workspace users first, then membros, else "Usuário removido"); `MentionEditor`, `MentionText`, `useMinuteClock`.
- Produces:
  ```ts
  export function useTarefaComentarios(tarefaId: number): { comentarios: TarefaComentario[]; isLoading: boolean; send: (conteudo: string) => Promise<void>; sending: boolean; update: (id: number, conteudo: string) => Promise<void>; remove: (id: number) => Promise<void> }  // every mutation invalidates ['tarefa-comentarios', tarefaId] and ['tarefas']
  export function TarefaComentarios(props: { tarefaId: number; membros: Membro[]; autoFocus?: boolean; onCountChange?: () => void }): JSX.Element
  ```
- Hook: query `['tarefa-comentarios', tarefaId]`; a `window` `focus` listener that invalidates it (global `staleTime` is 30 s, so `refetchOnWindowFocus` alone would not refetch; pattern `useDiscussao.ts:175-186`); realtime channel with a per-mount unique topic from a module-level counter (`channelSeq`, as `useDiscussao.ts:146-147`), `postgres_changes` on `tarefa_comentarios` filter `tarefa_id=eq.${tarefaId}`, invalidating that key and `['tarefas']`; removes the channel on unmount.
- Component: section heading "Comentários" + count; day dividers (Hoje / Ontem / date); rows (avatar, name, time, "(editado)", `MentionText`); author-only overflow menu Editar (inline `MentionEditor`, Salvar/Cancelar) / Excluir (AlertDialog "Excluir comentário?" / "Excluir"); empty line "Nenhum comentário ainda. Use @ para mencionar alguém."; composer via narrowed `useDiscussaoComposer` (Enter sends, Shift+Enter newline, counter near 4000, `useUnsavedWork`). Container gets `id="tarefa-comentarios"` for the deep-link scroll.

- [ ] **Step 1: Failing tests:** `renders comments with day dividers`; `send calls enviarTarefaComentario and clears the editor`; `author sees Editar/Excluir, others do not`; `delete asks for confirmation`; `empty state copy`; `unknown author shows Usuário removido`; `realtime channel removed on unmount` (spy `supabase.removeChannel`).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** this file and `npx vitest run apps/crm/src/pages/entregas/discussao` — PASS.
- [ ] **Step 5: Commit** — `feat(tarefas): seção de comentários`

### Task 7: Desktop sheet integration and deep link

**Files:**
- Modify: `apps/crm/src/pages/tarefas/components/TarefaDetailSheet.tsx`, `apps/crm/src/pages/tarefas/TarefasPage.tsx`, `packages/i18n/locales/{pt,en}/tasksForm.json`
- Test: `apps/crm/src/pages/tarefas/__tests__/TarefaDetailSheet.test.tsx`, `.../TarefasPage.test.tsx`

**Interfaces:**
- Consumes: `TarefaComentarios`, `TarefaHistoryList`, `buildTarefaTimeline`, `getTarefaEventos`.
- Produces: `TarefaDetailSheet` prop `focusComments?: boolean` (consumed once: scroll `#tarefa-comentarios` into view and autofocus the composer). Desktop only: the phone branch (`TarefaDetailSheet.tsx:229-252`) does not receive it.

- [ ] **Step 1: Failing tests:** `header has Histórico, Editar, Excluir buttons by name` and no bottom action row; `Histórico swaps body to the timeline and Voltar returns`; `history shows loading then nodes, and an error line with Tentar novamente on failure`; `comments section renders last`; TarefasPage `deep_link_focuses_comments_once` (`/tarefas?tarefa=1&comentarios=1` → sheet open with `focusComments`, params cleared, rerender does not refocus); `deep link without comentarios opens without focus`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Sheet: `view: 'detalhe' | 'historico'` state reset when `tarefa.id` changes; history query `['tarefa-eventos', id]` enabled only in history view; invalidate it inside the existing handlers that call `onRefresh`. Page: derive `const comentariosParam = searchParams.get('comentarios')` next to `tarefaParam`, add it to the effect's deps, read it before clearing and keep it in a `pendingFocusComments` ref/state next to `pendingTarefaId`, cleared when the sheet closes.
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/pages/tarefas` — PASS.
- [ ] **Step 5: Commit** — `feat(tarefas): comentários e histórico no detalhe da tarefa`

### Task 8: Phone detail

**Files:**
- Modify: `apps/crm/src/pages/tarefas/phone/TarefaDetailPhone.tsx`, `packages/i18n/locales/{pt,en}/tasksPhone.json`
- Test: `apps/crm/src/pages/tarefas/__tests__/TarefaDetailSheet.phone.test.tsx`

- [ ] **Step 1: Failing tests:** `nav bar has Histórico icon button` (and `Editar`/`Excluir` still found by name); `Histórico pushes the history screen and back returns`; `comments section at the bottom`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** with `PhoneIconButton` (from `@/components/mobile/LargeTitleHeader`) in `PhoneNavBar trailing` (`TarefaDetailPhone.tsx:138-156`). There is no pushed-screen pattern in tarefas phone: add `view: 'detalhe' | 'historico'` state in `DetailBody`, swapping the `PhoneNavBar` (back button → `setView('detalhe')`, title "Histórico") and the body, mirroring the desktop sheet. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(tarefas): comentários e histórico no celular`

### Task 9: Comment count on cards

**Files:**
- Modify: `apps/crm/src/pages/tarefas/components/TarefaCard.tsx`, `apps/crm/src/pages/tarefas/views/ListView.tsx` (row), PR A's calendar hover card (`components/TarefaCalendarChip.tsx`, check the path after PR A lands)
- Test: `TarefaCard.test.tsx`, `CalendarView.test.tsx`, ListView coverage in `TarefasPage.test.tsx`

- [ ] **Step 1: Failing tests:** `shows MessageCircle count when comentarios_total > 0`; `hides it at 0`; calendar hover card shows "3 comentários".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** next to the existing subtask counter, `aria-label` "N comentários". **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(tarefas): contador de comentários nos cards`

### Task 10: Whole-branch gate

- [ ] Run, from the worktree: `npm run lint`; `npx prettier --check` on changed files; the four `tsc` commands from CLAUDE.md; `npm run test` (and `TZ=UTC npm run test` if a date test fails); `bash scripts/test-entitlements.sh` when Docker is available. Expected: all green.
- [ ] Browser check against **staging** with migrations applied there (never prod): send a comment with a mention, edit, delete, open history after status/prazo/tag/subtask changes, open a `task_comment` notification link.
- [ ] Commit any fixes — `fix(tarefas): ajustes da verificação`
- [ ] Rollout (needs the user's go-ahead; not part of implementation): apply both migrations to staging, then to prod close to the merge, then merge. `getTarefas` selects `tarefa_comentarios(count)`, so merging first 400s the Tarefas page. Rollback: frontend first; tables stay.
