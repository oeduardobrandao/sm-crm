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
- From the moment this ships, direct changes to a task's own fields, its subtasks, its tags
  and its attachment to a recurring series are recorded and shown as a timeline. Series-level
  actions (pausing, resuming, ending, editing the rule of a `tarefa_series`) are not task
  events and stay out.

## Delivery: two PRs

**(our call, from the external review)**

- **PR A, frontend only:** clickable KPI cards (§1) and the richer calendar chips (§4, without
  the comment count). Merges as soon as it is green; no migration.
- **PR B:** comments (§2) and history (§3), two migrations applied to staging and prod before
  its merge, plus the comment count on cards and in the calendar hover card. Comments and
  history stay together: they share the sheet's header and layout change and the same rollout
  window. PR B is cut from PR A's branch.
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
  The existing "clear filters" action in `TarefasFilters` (it resets to `EMPTY_TAREFA_FILTERS`)
  also clears it, so `TarefasFilters` gets the KPI and a clear callback as props.
- `ListView` with `concluidasHoje`: the "Concluídas" group starts expanded, otherwise the list
  would look empty. `showConcluidas` is internal state today (`ListView.tsx`), so it gets a
  prop that forces it open. With any other KPI it stays as today.
- The four cards become buttons: existing `getByRole('button', { name })` queries in
  `TarefasPage.test.tsx` must stay unambiguous.
- `escopo` (Minhas/Todas) still applies first; the stats already follow it.
- Not persisted across reloads. **(our call)**

## 2. Comments

### Data

New table `tarefa_comentarios`:

| column | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `conta_id` | uuid NOT NULL | `REFERENCES workspaces(id) ON DELETE CASCADE` |
| `tarefa_id` | bigint NOT NULL | composite FK `(tarefa_id, conta_id)` → `tarefas(id, conta_id)` ON DELETE CASCADE (existing `tarefas_id_conta_uq`) |
| `author_id` | uuid NULL | `REFERENCES auth.users ON DELETE SET NULL`, nullable so deleting a user keeps the thread; the UI shows "Usuário removido" **(our call)**. The RPC always writes `auth.uid()` |
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

Grants (Supabase grants ALL on new public tables by default): `REVOKE ALL ON TABLE
tarefa_comentarios FROM PUBLIC, anon, authenticated`; `GRANT SELECT, DELETE` and
`GRANT UPDATE (conteudo)` to `authenticated`; `GRANT ALL` to `service_role` (precedent
`20261025000002:33-36`). `edited_at` is set by a BEFORE UPDATE trigger (column grants check
the SET list, not trigger writes).

Add the table to the `supabase_realtime` publication.

`getTarefas` gains `tarefa_comentarios(count)` so cards can show a comment count
(`comentarios_total` on `TarefaWithRelations`, read as `row.tarefa_comentarios?.[0]?.count`,
the `ideia_files(count)` precedent in `store/ideias.ts`).

### Sending: RPC `tarefa_comentario_enviar(p_tarefa_id bigint, p_conteudo text)`

SECURITY DEFINER, `search_path = public`. `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon`
(name `anon` explicitly: revoking from PUBLIC alone leaves the role grants), `GRANT EXECUTE`
to `authenticated`. In one transaction:

1. Resolve the task the way `post_discussao_post_do_chamador` resolves a post
   (`20261025000002:49-69`): its `conta_id` must equal `get_my_conta_id()` (the caller's
   active workspace) and the caller must be in `workspace_members` for it; otherwise raise.
2. Insert the comment with `author_id = auth.uid()`.
3. Mentions are **parsed server-side from `p_conteudo`**, the same regexp as the post RPC
   (`'\]\(membro:([0-9]+)\)'`, `20261025000002:86`); the client sends no list. They are recorded
   with `PERFORM sync_mentions('tarefa_comentario', <comment id>, <ids>)`, which drops ids that
   are not the task workspace's membros. The existing `notify_mention` trigger sends the
   `mention` notification.
4. Notify participants (below) with type `task_comment`, excluding the users behind the
   membros that step 3 actually kept.
5. Return the new row.

Editing goes through a direct UPDATE (RLS) followed by the existing `syncMentions` RPC with the
new host type, so a newly added mention notifies and a removed one is pruned. That path runs
`sync_mentions` as the caller (SECURITY INVOKER), so it depends on the `mencoes_tenant_all`
change below.

### Mentions plumbing for the new host type

`host_type = 'tarefa'` already means the task's *description*. Comments need a new value,
`'tarefa_comentario'`:
- extend the `mencoes.host_type` CHECK;
- DROP + CREATE `mencoes_tenant_all` (`20260803000006:37-80`, never redefined since) adding
  `WHEN 'tarefa_comentario' THEN EXISTS (SELECT 1 FROM tarefa_comentarios tc WHERE tc.id =
  mencoes.host_id AND tc.conta_id = mencoes.conta_id)`; every other arm copied verbatim;
- extend the host validation inside `sync_mentions`: the comment exists, is in the caller's
  workspace, **and `tc.author_id = auth.uid()`** (the SELECT policy does not prove authorship).
  The RPC calls it as definer, where `auth.uid()` is still the caller, so the same check holds;
- a cleanup trigger on `tarefa_comentarios` DELETE (pattern of `cleanup_mencoes_tarefa`);
- a branch in `trg_notify_mention()` (latest definition in
  `20261025000003_post_discussao_notify.sql`), using the keys the `mention` card already reads
  (`notification-config.ts:360-366`): `v_context_title` = the task's title via the comment's
  `tarefa_id` (with `tc.conta_id = NEW.conta_id`), `v_excerpt = left(tc.conteudo, 140)`,
  `v_task_id`, early `RETURN NEW` when the title is NULL like the other branches, link
  `/tarefas?tarefa=<tarefa_id>&comentarios=1`. Copy the whole current function body and add the
  branch; do not lose the `post_comment` / `geral` behaviour;
- frontend `MentionHostType` in `store/mentions.ts`.

### Who is notified (`task_comment`)

Participants of a task **(our call)**: the assignee (`responsavel_id` → user via
`resolve_notification_targets`), the creator (`tarefas.user_id`), and every distinct previous
commenter. Minus the comment's author, minus anyone mentioned in this comment (they get
`mention` instead), minus users no longer in the task's workspace (`workspace_members`).

- New notification type `task_comment`, **in-app only**. Add it to `notifications_type_check`
  and `notification_inapp_prefs_type_check` (keep `'__all__'`), copying both lists from
  `20261031000003_linha_editorial_hub_notifications.sql` (the latest definition). Do **not**
  touch `notification_email_prefs_type_check` or `claim_notification_emails`: in-app-only types
  (`post_discussion`, `team_message`) are absent from them.
- Not via `insert_notification_batch` (a plain INSERT: the second unread comment would raise
  `unique_violation` against the dedupe index). A hand-written
  `INSERT ... ON CONFLICT (user_id, (metadata->>'task_id')) WHERE type = 'task_comment' AND
  read_at IS NULL AND dismissed_at IS NULL DO UPDATE`, copied from `20261025000003:109-150`;
  the recipient set built with `UNION` (distinct; duplicates make the upsert raise "cannot
  affect row a second time"); `task_id` stored as text. Metadata reuses the post_discussion
  keys (`author_name`, `authors`, `count`, `preview`) plus `task_id`, `task_title`, so the
  config can reuse the `postDiscussionDisplay` shape (`notification-config.ts:71-104`).
- The notification block is wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING`
  so a notification failure never rolls back the comment.
- Dedupe index: unique partial on `(user_id, (metadata->>'task_id'))` with that WHERE, like
  `notifications_post_discussion_unread_uq`.
- Link `/tarefas?tarefa=<id>&comentarios=1`.
- Frontend: the `NotificationType` union in `store/notifications.ts`, entries in
  `lib/notification-catalog.ts` and `lib/notification-config.ts` (in-app only, grouped with
  `task_assigned`), and the preference label in `packages/i18n/locales/{pt,en}/settings.json`.

### UI (desktop sheet)

Layout of `TarefaDetailSheet` **(our call)**:

- Header: title + tags as today, plus a row of icon buttons on the right: **Histórico**
  (lucide `History`), **Editar** (`Pencil`), **Excluir** (`Trash2`). Each keeps its accessible
  name ("Histórico", "Editar", "Excluir") so existing tests by role/name keep working. The
  bottom Edit/Delete row goes away.
- Body unchanged down to the checklist, then a **Comentários (n)** section last, so the thread
  and composer sit at the bottom of the scroll.
- Author identity: resolved like the post discussion's `resolveAuthor`
  (`pages/entregas/discussao/DiscussaoEquipe.tsx:50`): first the membro whose `crm_user_id` is
  the author, else the workspace user (the same workspace-users source the discussion uses,
  scoped to the active workspace), else "Usuário removido" when `author_id` is NULL or unknown.
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
  reusing a topic on resubscribe). DELETE events do not match the filter under the default
  replica identity; mirror the post discussion (`useDiscussao.ts:175-182`): refetch on window
  focus, and the deleting client invalidates locally. No `REPLICA IDENTITY FULL`.
- Deep link `?tarefa=<id>&comentarios=1` opens the sheet scrolled to the comments section with
  the composer focused (desktop) **(our call)**. `TarefasPage` today clears the search params as
  soon as it parses `tarefa` (`TarefasPage.tsx:72-86`), so the same effect reads `comentarios`
  in that tick and stores it next to `pendingTarefaId`; the sheet receives a `focusComments`
  prop that is consumed once.

Reuse vs. new: `MentionEditor`, `MentionText`, `useMinuteClock` and the composer behaviour from
`useDiscussaoComposer` are reused. `useDiscussaoComposer` is typed to `UseDiscussaoResult` and
uses only `send`/`sending` plus the `postPanels` toast namespace
(`useDiscussaoActions.ts:45-85`): narrow its parameter to `{ send, sending }` and its toast copy
to a passed-in message, rather than copying it. The post's `DiscussaoTimeline` / `DiscussaoMessage` are
typed to post threads and carry passage-thread logic; build a small `TarefaComentarios`
component in `pages/tarefas/components/` that copies their visual structure (same classes where
they are generic) rather than generalising the post components. **(our call)** A shared
extraction can come later if a third host appears.

### UI (phone)

`TarefaDetailPhone` gets the same Comentários section at the bottom. Its nav bar
(`PhoneNavBar trailing`, `TarefaDetailPhone.tsx:138-156`) holds a delete icon button and an
"Editar" text button; Histórico becomes a third `PhoneIconButton` there (lucide `History`,
`aria-label="Histórico"`), and opens the history as a pushed screen. The phone tests query
`{ name: 'Editar' }` / `{ name: 'Excluir' }` (`TarefaDetailSheet.phone.test.tsx`), so those
names stay. The composer is the same component.

### Cards

List rows, board cards and the calendar hover card show `MessageCircle n` when
`comentarios_total > 0`, next to the existing subtask counter.

## 3. History

### Data

New table `tarefa_eventos`:

| column | type | notes |
|---|---|---|
| `id` | bigserial PK | |
| `conta_id` | uuid NOT NULL | `REFERENCES workspaces(id) ON DELETE CASCADE` |
| `tarefa_id` | bigint NOT NULL | composite FK → `tarefas(id, conta_id)` ON DELETE CASCADE |
| `tipo` | text NOT NULL | CHECK in the list below |
| `actor_user_id` | uuid NULL | `REFERENCES auth.users ON DELETE SET NULL`. `auth.uid()` at write time; NULL = system (the recurrence pg_cron, and the MCP edge function, which writes with a service-role client) |
| `actor_nome` | text NULL | snapshot of the actor's membro name in that workspace at write time |
| `de` | jsonb NULL | previous value (shape per tipo) |
| `para` | jsonb NULL | new value |
| `txid` | bigint NOT NULL default `txid_current()` | lets the reader net out delete+reinsert pairs |
| `created_at` | timestamptz default now() | |

Index `(tarefa_id, created_at)`.

RLS: SELECT for the workspace (same predicate as `tarefas`). Grants: `REVOKE ALL ON TABLE
tarefa_eventos FROM PUBLIC, anon, authenticated`, `GRANT SELECT` to `authenticated`, `GRANT
ALL` to `service_role`. Only the SECURITY DEFINER trigger functions write. **(our call)**
History is visible to every member who can see the task, unlike `audit_log` (owner/admin only),
which is why `audit_log` is not used.

### Event types and how they are written

Trigger functions are SECURITY DEFINER, `search_path = public`, AFTER ROW. Each body is
wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING ... END` like every
notification trigger in the repo (`20260803000006:104-110`): a history bug must never fail a
task write, a series RPC or the cron.

**Every snapshot lookup is tenant-scoped.** `tarefas.responsavel_id` and `cliente_id` are
single-column FKs, and service-role or legacy writes can bypass the RLS WITH CHECK that pins
them to the task's workspace. A definer trigger reading `membros` / `clientes` /
`tarefa_tags` / the actor's membro by id alone could copy another workspace's name into this
one's history. So every lookup adds `AND conta_id = NEW.conta_id` (or `OLD.conta_id`), and a
miss stores `{id, nome: null}`.

Actor: `auth.uid()`; `actor_nome` = the name of the membro with `crm_user_id = auth.uid()` and
`conta_id` = the task's. For `criada`, `COALESCE(auth.uid(), NEW.user_id)` so MCP-created tasks
credit their creator. MCP *updates* stay actor NULL and render as "Automação" **(our call)**;
a per-call actor for the MCP is a later change.

On `tarefas`:
- INSERT → `criada` (`para`: `{ "serie": true }` when `serie_id` is set). The reader says
  "criada pela recorrência" from `para.serie`, not from a NULL actor: `ao_concluir`
  materialisation runs inside the completing user's transaction, so it carries their uid.
- UPDATE, declared `AFTER UPDATE OF status, responsavel_id, data_limite, titulo, descricao,
  descricao_rich, cliente_id, serie_id` so `updated_at`-only writes never enter it; one event
  per changed field (IS DISTINCT FROM):
  - `status` → `status` (`de`/`para`: status strings)
  - `responsavel_id` → `responsavel` (`{id, nome}` snapshots from `membros`, either may be null)
  - `data_limite` → `prazo` (date strings or null)
  - `titulo` → `titulo` (strings)
  - `descricao` or `descricao_rich` → `descricao` (no values stored; "editou a descrição")
  - `cliente_id` → `cliente` (`{id, nome}` snapshots from `clientes`)
  - `serie_id` → `recorrencia` (`de`/`para`: series id or null; "passou a repetir" /
    "deixou de repetir")

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
  same tag id and the same `txid`. Between migration 2 and the merge the live frontend still
  does delete-all then insert as two requests (two txids), so the reader also drops a
  same-tag remove + add pair by the same actor within 5 seconds, whatever the txid.
- Consecutive events of the same `tipo` by the same actor within 2 minutes collapse in the UI
  into one entry showing the first `de` and the last `para` (e.g. dragging a task across three
  days). **(our call)** Reader-side only; rows stay raw.

### Backfill

For each existing task: one `criada` event at `created_at`. `tarefas.user_id` has no FK and
deleted-user drift is real on prod (`20261001000001`), so the backfill takes the actor through
`LEFT JOIN auth.users u ON u.id = t.user_id` and writes `u.id` (NULL when the user is gone);
`actor_nome` still comes from the membro with `crm_user_id = t.user_id` in the task's
workspace. And, when `status = 'concluida'` and
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
  `actor_user_id` (via `membros.crm_user_id`), else `actor_nome`, else "Automação".
- `.history-timeline` CSS lives in `app.css` (signed-in only), which is right for the sheet;
  any new comment/history classes go there too (the CSS split boundary test).
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
  series (the comment count arrives with PR B). Built on Radix Tooltip (installed;
  `@radix-ui/react-hover-card` is not, and Popover's trigger toggles on click and would eat the
  chip click): `delayDuration` ≈ 400, one `Tooltip.Provider` for the grid, **controlled**
  `open` forced false while a drag is active (dnd-kit will not close it), no tooltip on the
  `DragOverlay` chip. Remove the native `title={tarefa.titulo}` or two tooltips show.
- Keyboard: dnd-kit's `attributes` already make the wrapper `role=button`, `tabIndex=0`, and no
  `KeyboardSensor` is registered, so focus shows the card and an explicit `onKeyDown` opens the
  task on Enter/Space **(our call)**.

## Rollout

Two migrations, versions above main's tail (renumber before opening the PR if main moved):

1. `2026110300000x_tarefa_comentarios.sql`: table, RLS, grants, realtime publication, RPC,
   `mencoes` host type + `sync_mentions` + cleanup trigger + `trg_notify_mention` branch,
   `task_comment` type in the three CHECK lists, dedupe index.
2. `2026110300000y_tarefa_eventos.sql`: table, RLS, triggers, backfill.

Both must be applied to staging and prod **before** merging PR B: the frontend's `getTarefas`
selects `tarefa_comentarios(count)` and would 400 the whole page otherwise (merging deploys the
frontend immediately). Apply them close to the merge to keep the window where the old
frontend writes tags in two requests short. No edge function deploys. PR A has no rollout
steps.

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
- Entitlement/RLS SQL suite (`supabase/tests/entitlements/`, call `et_grant_hosted_parity()`
  before raw selects as `authenticated`): another workspace cannot read
  comments or events, cannot call the RPC on a foreign task, cannot update/delete someone
  else's comment, cannot insert into `tarefa_eventos`; participants get exactly one unread
  `task_comment`, a second comment updates it instead of failing; a mentioned participant
  gets `mention` and not `task_comment`; editing a comment to add a mention records it
  (`mencoes_tenant_all` arm); a history snapshot never carries a name from another workspace;
  a task UPDATE still succeeds when the history trigger errors.

## Left to the builder

- Exact copy beyond the strings quoted here, in pt and en (`tasksForm`, `tasks`, `tasksPhone`
  namespaces).
- Icon choice per history tipo.
- Whether the comment/history store functions live in `store/tarefas.ts` or a new
  `store/tarefaComentarios.ts`.
