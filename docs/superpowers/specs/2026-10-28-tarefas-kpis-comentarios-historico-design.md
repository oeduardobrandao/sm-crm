# Tarefas: KPI filters, comments, history, richer calendar chips

Date: 2026-10-28. Branch `claude/tarefas-page-enhancements-88621f`.

## Why

The Tarefas page shows four KPI cards (Abertas, Vencem hoje, Atrasadas, Concluídas hoje) that
are read-only, so seeing *which* tasks are late takes a trip through the filters. A task has no
place for the team to talk about it, and no record of who changed what. The month calendar's
chips show only a title, so telling whose task it is and for which client means opening it.

The user asked for four things:

1. KPI cards clickable, working as filters.
2. Clicking a task: a comment section similar to the post's team discussion.
3. A history button in the task that opens a timeline.
4. Month calendar chips with more information: the assignee's avatar, an at-a-glance client
   identifier, and on hover the tags and more detail, without taking much space.

The user skipped the design questions, so every call below that they did not state is marked
**(our call)**.

## Goals

- One click on a KPI card narrows every view (Lista, Por membro, Kanban, Calendário) to that
  bucket; a second click clears it.
- Team members comment on a task, mention colleagues with `@`, edit and delete their own
  comments, and the people involved in the task are notified.
- Every change made to a task from the moment this ships is recorded and shown as a timeline.
- Month calendar chips identify assignee and client at a glance; a hover card shows the rest.

## Non-goals

- Unread markers / "Não lidas" divider in task comments, follow/unfollow bells, the
  "Discutir no chat" bridge, threaded replies, reactions, attachments. **(our call)** The post
  discussion has these; tasks start with a flat thread.
- E-mail for the new notification type. `post_discussion` is in-app only today; `task_comment`
  matches it. No edge function changes.
- History before this ships. Past edits were never recorded and cannot be reconstructed. The
  migration backfills only what the row itself proves (see History → Backfill).
- KPI filtering on phones. The phone header shows the stats as a text line, not cards.
  **(our call)** Phones still get comments and history.
- Hover cards on phones (no hover). The phone month calendar is unchanged.

## Anti-goals

- A KPI filter that silently hides tasks with no visible way back. The active card must look
  active and the filters row must show a removable chip.
- History noise: saving the edit form without changing anything, or re-saving the same tags,
  must not add timeline entries.
- A notification for every comment flooding a person who already has an unread one for the
  same task.
- A broken page if the new columns/tables are missing: the migrations ship before the merge
  (see Rollout), and `getTarefas` is the one query the whole page depends on.

## 1. Clickable KPI cards

`StatCard` already supports `onClick` (renders a button) and `active` (ring). Nothing new in the
primitive.

- New page state `kpi: 'abertas' | 'vencemHoje' | 'atrasadas' | 'concluidasHoje' | null`,
  separate from `TarefaFilterState` so the stats keep counting the unfiltered scoped set.
- Predicate per bucket, defined next to `computeHeaderStats` in `tarefasLogic.ts` and sharing its
  date logic so a card's number always equals the number of tasks it shows (before the other
  filters apply):
  - `abertas`: `status !== 'concluida'`
  - `vencemHoje`: open and `data_limite` is today
  - `atrasadas`: open and `data_limite < today`
  - `concluidasHoje`: `status === 'concluida'` and `concluida_em` is today (local day)
- Applied after `applyTarefaFilters`, i.e. it intersects with search/membro/cliente/tag/status.
- Clicking the active card clears it; clicking another card switches. **(our call)** One KPI at
  a time.
- The filters row shows a chip "Atrasadas ×" (label = the card's label) while a KPI is active.
  The existing "clear filters" action, if present, also clears it.
- `ListView` with `concluidasHoje`: the "Concluídas" group starts expanded, otherwise the list
  would look empty. With any other KPI it stays as today.
- `escopo` (Minhas/Todas) still applies first; the stats already follow it.
- Not persisted across reloads. **(our call)**

## 2. Comments

### Data

New table `tarefa_comentarios`:

| column | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `conta_id` | uuid NOT NULL | |
| `tarefa_id` | bigint NOT NULL | composite FK `(tarefa_id, conta_id)` → `tarefas(id, conta_id)` ON DELETE CASCADE (existing `tarefas_id_conta_uq`) |
| `author_id` | uuid NOT NULL | `auth.users`; a NOT NULL FK must be ON DELETE CASCADE, never SET NULL (project lesson from the auth-user delete fix, #616) |
| `conteudo` | text NOT NULL | CHECK length 1..4000 (same cap as `DISCUSSAO_MAX_CHARS`) |
| `created_at` | timestamptz default now() | |
| `edited_at` | timestamptz NULL | set by trigger when `conteudo` changes |

Index `(tarefa_id, created_at)`.

RLS (`tarefas_tenant_all` pattern, `get_my_conta_id()`):
- SELECT: row's `conta_id` in the caller's workspaces.
- INSERT: denied to `authenticated` directly; only through the RPC below.
- UPDATE: author only (`author_id = auth.uid()`), only `conteudo` (column grant), conta check.
- DELETE: author only. **(our call)** Owners/admins cannot delete others' comments, same as the
  post's general thread.
- `service_role` bypass policy, as on `tarefas`.

Add the table to the `supabase_realtime` publication.

`getTarefas` gains `tarefa_comentarios(count)` so cards can show a comment count
(`comentarios_total` on `TarefaWithRelations`).

### Sending: RPC `tarefa_comentario_enviar(p_tarefa_id bigint, p_conteudo text, p_mencoes bigint[])`

SECURITY DEFINER, `search_path = public`, granted to `authenticated` only (REVOKE from PUBLIC
*and* name `anon` explicitly: revoking from PUBLIC alone leaves the role grants). In one
transaction:

1. Resolve the task; raise if it does not exist or its `conta_id` is not one of the caller's.
2. Insert the comment with `author_id = auth.uid()`.
3. Record mentions: `mencoes` rows with new `host_type = 'tarefa_comentario'`, `host_id` = the
   comment id, for each `p_mencoes` membro that belongs to the task's workspace (others are
   silently dropped). The existing `notify_mention` trigger sends the `mention` notification.
4. Notify participants (below) with type `task_comment`.
5. Return the new row.

Editing goes through a direct UPDATE (RLS) followed by the existing `syncMentions` RPC with the
new host type, so a newly added mention notifies and a removed one is pruned.

### Mentions plumbing for the new host type

`host_type = 'tarefa'` already means the task's *description*. Comments need a new value,
`'tarefa_comentario'`:
- extend the `mencoes.host_type` CHECK;
- extend the host validation inside `sync_mentions` (the comment must be in the caller's
  workspace and authored by the caller);
- a cleanup trigger on `tarefa_comentarios` DELETE (pattern of `cleanup_mencoes_tarefa`);
- a branch in `trg_notify_mention()` (latest definition in
  `20261025000003_post_discussao_notify.sql`) with link
  `/tarefas?tarefa=<tarefa_id>&comentarios=1` and metadata carrying `task_id`, `task_title`,
  and a snippet. Copy the whole current function body and add the branch; do not lose the
  `post_comment` / `geral` behaviour.
- frontend `HostType` in `store/mentions.ts`.

### Who is notified (`task_comment`)

Participants of a task **(our call)**: the assignee (`responsavel_id` → user via
`resolve_notification_targets`), the creator (`tarefas.user_id`), and every distinct previous
commenter. Minus the comment's author, minus anyone mentioned in this comment (they get
`mention` instead), minus users no longer in the workspace.

- New notification type `task_comment`. Add it to `notifications_type_check`,
  `notification_inapp_prefs_type_check` and `notification_email_prefs_type_check`, copying the
  lists from `20261031000003_linha_editorial_hub_notifications.sql` (its header says to).
- Dedupe: unique partial index on `(user_id, (metadata->>'task_id'))` where
  `type = 'task_comment' AND read_at IS NULL AND dismissed_at IS NULL`; the insert is
  `ON CONFLICT DO UPDATE` refreshing `created_at`, last author, snippet and a running `count`.
  Mirror `notifications_post_discussion_unread_uq` and how `20261025000003` writes it.
- Link `/tarefas?tarefa=<id>&comentarios=1`.
- Frontend: entries in `lib/notification-catalog.ts` and `lib/notification-config.ts`
  (in-app only, grouped with `task_assigned`), pt + en copy. Check `store/notifications.ts`
  for any type allowlist.

### UI (desktop sheet)

Layout of `TarefaDetailSheet` **(our call)**:

- Header: title + tags as today, plus a row of icon buttons on the right: **Histórico**
  (lucide `History`), **Editar** (`Pencil`), **Excluir** (`Trash2`). Each keeps its accessible
  name ("Histórico", "Editar", "Excluir") so existing tests by role/name keep working. The
  bottom Edit/Delete row goes away.
- Body unchanged down to the checklist, then a **Comentários (n)** section last, so the thread
  and composer sit at the bottom of the scroll.
- Message row: avatar, name, relative time ("há 5 min", ticking via `useMinuteClock`),
  "(editado)" when `edited_at`, body rendered with `MentionText`. Hover (desktop) shows an
  overflow menu with Editar / Excluir for the author's own comments; delete asks for
  confirmation.
- Composer: `MentionEditor` (same as the post discussion), Enter sends, Shift+Enter newline,
  4000-char cap with counter near the cap, disabled while sending, unsaved text registered with
  `useUnsavedWork` (CLAUDE.md: silent updates).
- Day dividers between messages from different days ("Hoje", "Ontem", date).
- Empty state: one muted line, "Nenhum comentário ainda. Use @ para mencionar alguém."
- Realtime: while the sheet is open, subscribe to `tarefa_comentarios` filtered by
  `tarefa_id=eq.<id>`; on any event invalidate `['tarefa-comentarios', id]` and the `tarefas`
  list (for counts). Use a unique channel topic per mount (the post discussion hit a bug from
  reusing a topic on resubscribe).
- Deep link `?tarefa=<id>&comentarios=1` opens the sheet scrolled to the comments section with
  the composer focused (desktop) **(our call)**.

Reuse vs. new: `MentionEditor`, `MentionText`, `useMinuteClock` and the composer behaviour from
`useDiscussaoComposer` are reused. The post's `DiscussaoTimeline` / `DiscussaoMessage` are
typed to post threads and carry passage-thread logic; build a small `TarefaComentarios`
component in `pages/tarefas/components/` that copies their visual structure (same classes where
they are generic) rather than generalising the post components. **(our call)** A shared
extraction can come later if a third host appears.

### UI (phone)

`TarefaDetailPhone` gets the same Comentários section at the bottom and a Histórico entry in
its actions menu, opening history as a pushed screen (existing phone sheet pattern). Composer
uses the same component.

### Cards

List rows, board cards and the calendar hover card show `MessageCircle n` when
`comentarios_total > 0`, next to the existing subtask counter.

## 3. History

### Data

New table `tarefa_eventos`:

| column | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `conta_id` | uuid NOT NULL | |
| `tarefa_id` | bigint NOT NULL | composite FK → `tarefas(id, conta_id)` ON DELETE CASCADE |
| `tipo` | text NOT NULL | CHECK in the list below |
| `actor_user_id` | uuid NULL | `auth.uid()` at write time; NULL = system (recurrence cron, service role). ON DELETE SET NULL is fine here (nullable) |
| `actor_nome` | text NULL | snapshot of the actor's membro name in that workspace at write time |
| `de` | jsonb NULL | previous value (shape per tipo) |
| `para` | jsonb NULL | new value |
| `txid` | bigint NOT NULL default `txid_current()` | lets the reader net out delete+reinsert pairs |
| `created_at` | timestamptz default now() | |

Index `(tarefa_id, created_at)`.

RLS: SELECT for the workspace (same predicate as `tarefas`). No INSERT/UPDATE/DELETE for
`authenticated` or `anon`; only the SECURITY DEFINER trigger functions write. **(our call)**
History is visible to every member who can see the task, unlike `audit_log` (owner/admin only),
which is why `audit_log` is not used.

### Event types and how they are written

Trigger functions are SECURITY DEFINER, `search_path = public`, AFTER ROW.

On `tarefas`:
- INSERT → `criada` (`para`: `{ "serie": true }` when `serie_id` is set, so the reader can say
  "criada pela recorrência").
- UPDATE, one event per changed field (IS DISTINCT FROM):
  - `status` → `status` (`de`/`para`: status strings)
  - `responsavel_id` → `responsavel` (`{id, nome}` snapshots from `membros`, either may be null)
  - `data_limite` → `prazo` (date strings or null)
  - `titulo` → `titulo` (strings)
  - `descricao` or `descricao_rich` → `descricao` (no values stored; "editou a descrição")
  - `cliente_id` → `cliente` (`{id, nome}` snapshots from `clientes`)

On `subtarefas`: INSERT → `subtarefa_adicionada`, UPDATE of `concluida` →
`subtarefa_concluida` / `subtarefa_reaberta`, DELETE → `subtarefa_removida`; `para` =
`{titulo}`.

On `tarefa_tag_links`: INSERT → `tag_adicionada`, DELETE → `tag_removida`; `para` =
`{id, nome, cor}` snapshot.

Comments are not history events: the thread is already its own record.

Cascades: deleting a task cascades to subtarefas and tag links, whose DELETE triggers would try
to insert events for a task that no longer exists. Those trigger functions must return early
when the parent task row is gone (and an FK violation must not be possible on that path); the
history goes with the task anyway. Same for `conta` deletion.

### Noise control

- Field events only fire on real changes, so an unchanged form save writes nothing.
- `setTarefaTags` in `store/tarefas.ts` changes from delete-all + reinsert to a diff (delete
  removed ids, insert added ids). The series RPC (`20260925000030`, delete-all + reinsert in one
  transaction) is not touched; the reader drops a `tag_removida` + `tag_adicionada` pair for the
  same tag id and the same `txid`.
- Consecutive events of the same `tipo` by the same actor within 2 minutes collapse in the UI
  into one entry showing the first `de` and the last `para` (e.g. dragging a task across three
  days). **(our call)** Reader-side only; rows stay raw.

### Backfill

For each existing task: one `criada` event at `created_at` with `actor_user_id = user_id` and
`actor_nome` from the creator's membro row, and, when `status = 'concluida'` and
`concluida_em` is set, one `status` event (`de` null, `para` 'concluida') at `concluida_em`,
actor NULL. Nothing else is inferable. The timeline shows a muted footnote under the oldest
entry: "Histórico registrado a partir de 28/10/2026" (the migration's date, as a constant)
**(our call)**.

### UI

The **Histórico** header button swaps the sheet body for the timeline, with a back arrow
("Voltar") in the header; the sheet does not close **(our call)**. A popover was rejected: the
sheet is 440px wide and a timeline can be long.

- Reuse the `.history-timeline` / `.history-step-*` markup and CSS that `PostTimelineList`
  (`pages/entregas/components/PostTimelinePopover.tsx`) uses; a `TarefaHistoryList` renders
  nodes built by a pure `buildTarefaTimeline(events, membros, now)` in
  `pages/tarefas/tarefaTimeline.ts`.
- Newest first. Each entry: icon by tipo, a sentence ("Ana mudou o status de Pendente para Em
  andamento", "Bruno moveu o prazo de 12/10 para 15/10", "Recorrência criou a tarefa"),
  relative time with absolute date on hover (`title`). Actor name: current membro name by
  `actor_user_id` (via `membros.crm_user_id`), else `actor_nome`, else "Sistema".
- Loading skeleton, error line with retry, empty state impossible after backfill but still
  handled ("Sem histórico").
- Query key `['tarefa-eventos', id]`; fetched when the history view opens and invalidated after
  local mutations made from the sheet. No realtime subscription for history: it is only visible
  while the user looks at it **(our call)**.

## 4. Richer month-calendar chips (desktop)

Applies to `TarefaChip` in `views/CalendarView.tsx` (day cells, "Sem data" rail and the drag
overlay).

- Left bar colour: the **client's** colour (`cliente_cor`), not the first tag's. No client →
  neutral `var(--border-color)` bar. **(our call)** The client is the at-a-glance identifier the
  user asked for; tags move to the hover card.
- Right edge: assignee avatar, `PessoaAvatar` at 16px; none when unassigned.
- Still one line, same height, title ellipsised between bar and avatar.
- A tiny client initial badge was considered and rejected as unreadable at 0.62rem.
- Hover card (desktop, pointer only), opening after ~400ms, closing on leave, never while
  dragging (close on drag start, suppress until drop): title; client (colour dot + name);
  assignee (avatar + name, or "Sem responsável"); prazo with the existing `dueBadge`; status;
  tags as `TagPill`s; subtasks `x/y`; comments count; recurrence icon + rule when part of a
  series. Built on Radix Popover controlled by hover or `@radix-ui/react-hover-card` if already
  installed (check `package.json`; do not add a dependency for this if Popover/Tooltip can do
  it). Must not steal the click: clicking the chip still opens the detail sheet.
- Keyboard: the chip is focusable; focus shows the same card, Enter opens the task.
  **(our call)**

## Rollout

Two migrations, versions above main's tail (renumber before opening the PR if main moved):

1. `2026110300000x_tarefa_comentarios.sql`: table, RLS, grants, realtime publication, RPC,
   `mencoes` host type + `sync_mentions` + cleanup trigger + `trg_notify_mention` branch,
   `task_comment` type in the three CHECK lists, dedupe index.
2. `2026110300000y_tarefa_eventos.sql`: table, RLS, triggers, backfill.

Both must be applied to staging and prod **before** merging: the frontend's `getTarefas`
selects `tarefa_comentarios(count)` and would 400 the whole page otherwise (merging deploys the
frontend immediately). No edge function deploys.

Rollback: frontend first; the tables can stay.

## Tests

- `tarefasLogic`: KPI predicates match `computeHeaderStats` counts on the same fixture
  (property: for each bucket, `filter(pred).length === stats[bucket]`).
- `TarefasPage`: clicking a card filters the list, marks the card active, shows the chip;
  clicking again clears; `concluidasHoje` expands the Concluídas group.
- `tarefaTimeline`: sentence per tipo, actor resolution fallbacks, tag txid netting, 2-minute
  collapse, backfill footnote.
- `TarefaComentarios`: renders messages and day dividers, sends via the store function, author
  sees edit/delete and others do not, empty state.
- `TarefaDetailSheet`: header buttons by accessible name; Histórico swaps the body and Voltar
  returns.
- `CalendarView`: chip shows avatar and client-colour bar; hover card shows tags.
- Entitlement/RLS SQL suite (`supabase/tests/entitlements/`): another workspace cannot read
  comments or events, cannot call the RPC on a foreign task, cannot update/delete someone
  else's comment, cannot insert into `tarefa_eventos`; participants get exactly one unread
  `task_comment`; a mentioned participant gets `mention` and not `task_comment`.

## Left to the builder

- Exact copy beyond the strings quoted here, in pt and en (`tasksForm`, `tasks`, `tasksPhone`
  namespaces).
- Icon choice per history tipo.
- Whether the comment/history store functions live in `store/tarefas.ts` or a new
  `store/tarefaComentarios.ts`.
