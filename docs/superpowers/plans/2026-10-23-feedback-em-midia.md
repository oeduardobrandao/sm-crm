# Feedback em mídia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients pin notes to a carousel slide, a video moment and/or a spot on either from the Hub; the agency replies, resolves each note, and sees them in the post conversation; the team can pin internal notes.

**Architecture:** Three new tables (`post_media_notes`, `post_media_note_replies`, `post_approval_media_notes`) plus a security-invoker view `post_media_notes_v` that resolves each note's anchor against the post's current `post_file_links` (one source of truth for "current slide" vs "versão anterior"). Hub writes go through one new token-auth edge function calling SECURITY DEFINER RPCs that lock the post row; Hub reads ride on `hub-posts` and `hub-post-history`. CRM reads/writes are RLS-scoped calls in a by-path store module. Pin geometry is one shared module in `packages/ui`.

**Tech Stack:** Postgres (Supabase migrations, psql entitlement suites), Deno edge functions, React 19 + TanStack Query (CRM), React 19 (Hub), Vitest + Testing Library, i18next (Hub).

**Spec:** `docs/superpowers/specs/2026-10-22-feedback-em-midia-design.md` (read it first; the plan argues from it). Mockups: https://claude.ai/artifact/WeRBm4DBgqmKgUV9kSd3zb

## Global Constraints

- All user-facing copy pt-BR, sentence case, **no em dashes** (period or colon instead). Hub strings go through `useTranslation` with pt defaults AND both `packages/i18n/locales/pt/*.json` and `en/*.json` (parity test `apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`).
- An internal note (or a reply on one) must never appear in any Hub payload, Hub Mensagens RPC branch, client notification or client e-mail. Filter server-side, with a test per surface.
- Spot coordinates are fractions `0..1` of the **rendered media box** (letterbox excluded), never pixels.
- Hub note writes: hub token ownership (`post.conta_id`/`post.cliente_id`), status in `enviado_cliente, aprovado_cliente, correcao_cliente, agendado, postado, falha_publicacao`, rate-limit key `hub-write:hub-media-notes:${conta_id}:${cliente_id}` (60 per 3600s) and **no** `hub-read:` debit; bad token key `hub-badtoken:${ip}` 30/600s.
- Client never sends a `file_id`; Hub sends the `post_file_links.id` it shows (`HubPostMedia.id`).
- Only the agency resolves. A client reply on a resolved note reopens it. A client cannot reply to an internal note.
- Every plan, no entitlement flag. No client notification of agency replies/resolutions.
- Agency names in the Hub: team member name (`membros.nome` via `crm_user_id`), fallback `Equipe`.
- New migrations use version prefixes above `20261024000010` (this plan: `20261026000001`..`20261026000003`); re-check main's tail and renumber before `gh pr create`.
- Composers with unsent text outside a modal call `useUnsavedWork(active)` from `@mesaas/app-lifecycle`; never `useBlocker`.
- Edge functions: CORS only via `buildCorsHeaders(req)`, generic error messages to clients, `[functions.hub-media-notes] verify_jwt = false` in `supabase/config.toml`.
- Deploy order (prod and staging): migrations, then functions (`hub-media-notes` with `--no-verify-jwt`, `hub-posts`, `hub-post-history`, `hub-approve`, `mcp`), then merge (merge deploys the frontend immediately).
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`, `bash scripts/test-entitlements.sh` (local Supabase).

## Review Focus

1. **Swipe vs pin tap.** In pin mode a horizontal drag on the carousel must change slides and place no pin; a tap (< 8px, `crossedDragThreshold`) places one. Test in Task 11.
2. **Letterboxed media.** A portrait image in a square box: a tap in the letterbox bar places nothing; a tap at the image's center maps to `(0.5, 0.5)` and renders back at the same spot at another box size. Test in Task 7.
3. **Video element swap.** `VideoPlayer` recreates `<video>` on HLS to fallback switch (`key={mode}`); the element callback must fire again with the new element so pause/seek keep working. Test in Task 8.
4. **Post back in production.** A post visible in the Hub with an internal status ("em produção") shows its notes read-only: no Comentar button, and the endpoint refuses writes (400). Tests in Tasks 4 and 11.
5. **Media replaced or deleted under a note.** The note shows "versão anterior" with the snapshot label, keeps counting as open, and its pin is not drawn on the new file; a purged file leaves `file_id` null without deleting the note. Tests in Tasks 1 and 7.

---

### Task 1: Schema, view, RLS and the entitlement suite

**Files:**
- Create: `supabase/migrations/20261026000001_post_media_notes.sql`
- Create: `supabase/tests/entitlements/99_post_media_notes.sql`

**Interfaces:**
- Produces tables:
  - `post_media_notes(id bigserial pk, conta_id uuid not null → workspaces on delete cascade, post_id bigint not null, file_id bigint null, slide_index_at_creation int not null check >= 0, media_kind text not null check in ('image','video'), t_seconds numeric(8,2) null check >= 0, x real null, y real null, visibility text not null check in ('client','internal'), author_kind text not null check in ('client','team'), author_user_id uuid null, hub_token text null, body text not null check char_length between 1 and 2000, status text not null default 'open' check in ('open','resolved'), resolved_by uuid null, resolved_at timestamptz null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`
    - checks: `(x is null) = (y is null)`; `x`, `y` between 0 and 1; `media_kind = 'video' or t_seconds is null`; `(author_kind = 'client') = (visibility = 'client')`; `author_kind <> 'client' or (author_user_id is null and hub_token is not null)`; `author_kind <> 'team' or (hub_token is null and author_user_id is not null)`; `(status = 'resolved') = (resolved_at is not null)`.
    - `unique (id, conta_id)`; FK `(post_id, conta_id) → workflow_posts(id, conta_id) on delete cascade`; FK `(file_id, conta_id) → files(id, conta_id) on delete set null (file_id)`; index `(post_id)`, `(conta_id, created_at)`.
  - `post_media_note_replies(id bigserial pk, note_id bigint not null, conta_id uuid not null, author_kind, author_user_id, hub_token, body, created_at)` with the same author checks; FK `(note_id, conta_id) → post_media_notes(id, conta_id) on delete cascade`; index `(note_id)`.
  - `post_approval_media_notes(post_approval_id bigint → post_approvals on delete cascade, note_id bigint → post_media_notes on delete cascade, primary key (post_approval_id, note_id))`.
- Produces view `post_media_notes_v` (`with (security_invoker = true)`): every `post_media_notes` column plus `current_link_id bigint` (the `post_file_links.id` with same `post_id` and `file_id`, else null), `current_slide_index int` (0-based rank of that link by `(sort_order, id)` among the post's links, else null), `is_previous_version boolean` (`current_link_id is null`).
- Produces triggers: BEFORE UPDATE on notes sets `updated_at`, and on status change sets `resolved_by = auth.uid()`, `resolved_at = now()` (to `'resolved'`) or clears both (to `'open'`); AFTER INSERT on replies with `author_kind = 'client'` sets the parent note `status = 'open'`.
- RLS and grants (service-role bypass policy on all three tables; explicit REVOKE ALL from `public, anon, authenticated` then the grants below; `post_references` is SELECT-only, so do NOT copy its grants):
  - PERMISSIVE SELECT on notes and replies `USING (conta_id IN (SELECT public.get_my_conta_id()))`.
  - PERMISSIVE SELECT on `post_approval_media_notes` `USING (EXISTS (SELECT 1 FROM post_media_notes n WHERE n.id = note_id AND n.conta_id IN (SELECT public.get_my_conta_id())))` (the table has no `conta_id`; the CRM reads it through a PostgREST embed).
  - PERMISSIVE INSERT on notes `WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()) AND author_kind = 'team' AND visibility = 'internal' AND author_user_id = auth.uid())`.
  - PERMISSIVE INSERT on replies `WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()) AND author_kind = 'team' AND author_user_id = auth.uid())`.
  - PERMISSIVE UPDATE on notes `USING (tenant) WITH CHECK (tenant)`.
  - Grants: `GRANT SELECT, INSERT ON post_media_notes, post_media_note_replies TO authenticated; GRANT UPDATE (status) ON post_media_notes TO authenticated; GRANT SELECT ON post_approval_media_notes TO authenticated; GRANT USAGE, SELECT ON SEQUENCE post_media_notes_id_seq, post_media_note_replies_id_seq TO authenticated; GRANT SELECT ON post_media_notes_v TO authenticated, service_role`; service_role gets ALL on tables and sequences.
  - No authenticated DELETE anywhere; anon gets nothing.
- **The column list in `ON DELETE SET NULL (file_id)` is mandatory** (PG15+, already used in this repo). A plain `ON DELETE SET NULL` on the composite FK would try to null `conta_id` (NOT NULL) and from then on block every `DELETE FROM files` in the app (ideias, designs, post_references cleanups). Block (h) is the guard.

- [ ] **Step 1: Write the failing psql suite** `99_post_media_notes.sql` following `99_post_references.sql` (fixtures `pmn_env`, `pmn_post`, `pmn_file`, `pmn_link`, each block `begin; select et_grant_hosted_parity(array['post_media_notes','post_media_note_replies','post_approval_media_notes']); do $$ … $$; rollback;`). Blocks (each ends `raise notice 'PASS …'`):
  - (a) owner of workspace A sees A's notes, sees zero of workspace B's.
  - (b) in one block, as `authenticated`: insert of a `client` note fails with SQLSTATE `42501` (new row violates row-level security) or `23514` (check), asserted by code; insert of an `internal` team note with own uid succeeds AND the row is then visible on re-select (proves INSERT grant, policy and sequence USAGE together); a team reply insert also succeeds.
  - (c) a note with `x` but null `y` violates the check; `t_seconds` on an image violates the check; `author_kind='client', visibility='internal'` violates the check.
  - (d) authenticated UPDATE of `body` fails; UPDATE `status='resolved'` affects exactly 1 row (`get diagnostics`) and the row then has `resolved_by = <uid>` and `resolved_at` not null; back to `'open'` clears both; the same UPDATE on workspace B's note affects 0 rows. Authenticated SELECT through the `post_approval_media_notes` embed path sees own rows only.
  - (e) inserting a client reply (as service role) on a resolved note leaves the note `open`.
  - (f) a note whose `file_id` belongs to workspace B but `conta_id` A fails the composite FK.
  - (g) view: note on link at `sort_order` 2 of 3 → `current_slide_index = 2`, `is_previous_version = false`; after `post_file_link_replace`-style `update post_file_links set file_id = <new>` → `is_previous_version = true`, `current_link_id is null`; after reorder the index follows the link.
  - (h) `delete from files` of the noted file (after removing its link) leaves the note with `file_id is null`.
  - (i) anon selects zero rows from all three tables and the view.

- [ ] **Step 2: Run it, expect FAIL** — `bash scripts/test-entitlements.sh` → `FAIL supabase/tests/entitlements/99_post_media_notes.sql` (relation does not exist).

- [ ] **Step 3: Write the migration** with the tables, checks, FKs, view, triggers, policies and grants above. Header comment: purpose, spec path, rollback (`drop view post_media_notes_v; drop table post_approval_media_notes, post_media_note_replies, post_media_notes;`).

- [ ] **Step 4: Run it, expect PASS** — `npx supabase db reset` (local) then `bash scripts/test-entitlements.sh` → `PASS …99_post_media_notes.sql`, no other suite regresses.

- [ ] **Step 5: Commit** — `git add supabase/migrations/20261026000001_post_media_notes.sql supabase/tests/entitlements/99_post_media_notes.sql && git commit -m "feat(db): post_media_notes tables, anchor view and RLS"`

---

### Task 2: Write RPCs (Hub create/reply, approval with snapshot, team create) and notification link

**Files:**
- Create: `supabase/migrations/20261026000002_post_media_notes_rpcs.sql`
- Modify: `supabase/tests/entitlements/99_post_media_notes.sql` (append blocks)

**Interfaces:**
- Produces (all `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM public, anon, authenticated`, `GRANT EXECUTE … TO service_role` unless noted). Every Hub RPC first does `SELECT … FROM workflow_posts WHERE id = p_post_id FOR UPDATE` so all Hub writes and approvals on one post serialize.
  - `hub_create_media_note(p_conta_id uuid, p_cliente_id bigint, p_token text, p_post_id bigint, p_link_id bigint, p_t_seconds numeric, p_x real, p_y real, p_body text) returns bigint` — raises `post_not_found` (post not in conta/cliente), `post_not_visible` (status not in the Hub-visible list), `link_not_on_post` (link missing or on another post), `invalid_anchor` (t on image; t < 0 or > `files.duration_seconds + 1` when duration known; x/y pairing). Resolves `file_id`, `media_kind` from `files.kind`, `slide_index_at_creation` = rank of the link by `(sort_order, id)`. Inserts `author_kind='client', visibility='client', hub_token=p_token`.
  - `hub_add_media_note_reply(p_conta_id uuid, p_cliente_id bigint, p_token text, p_note_id bigint, p_body text) returns bigint` — locks the note's post; raises `note_not_found` if the note is internal, missing, or its post is not the token's; `post_not_visible` as above. Inserts a client reply (Task 1 trigger reopens).
  - `record_client_approval_with_notes(p_post_id bigint, p_conta_id uuid, p_token text, p_action text, p_comentario text, p_new_status text, p_motivo text default null) returns table(approval_id bigint, open_note_count int)` — locks post; raises `post_not_found` if `post.conta_id <> p_conta_id`; raises `post_not_pending` unless status in `('enviado_cliente','correcao_cliente')` **under the lock**; calls `record_client_approval(p_post_id, p_token, p_action, p_comentario, false, p_new_status, p_motivo)`; inserts into `post_approval_media_notes` every note of the post with `visibility='client' AND status='open'`; returns the approval id and that count.
  - `create_team_media_note(p_post_id bigint, p_link_id bigint, p_t_seconds numeric, p_x real, p_y real, p_body text) returns bigint` — **SECURITY INVOKER**, granted to `authenticated`; resolves link → file under the caller's RLS, raises `link_not_on_post` / `invalid_anchor` like above, inserts `author_kind='team', visibility='internal', author_user_id=auth.uid()`, `conta_id` from the post.
- Modifies `create_post_approval_notification` (copy its latest body from `20260830000003_avulso_notifications_folders_views.sql:39-112` verbatim) changing only the link to `CASE WHEN workflow_id IS NULL THEN '/entregas?post=' || p_post_id ELSE '/entregas?drawer=' || workflow_id || '&post=' || p_post_id END`, so note notifications open the post (spec call 5). Keep grants from `20260925000001`. The CRM already parses `drawer` + `post` together (`EntregasPage.tsx:512-530`); no CRM change is needed for this.

- [ ] **Step 1: Append failing blocks** to the suite:
  - (j) `hub_create_media_note` with a link of another post raises `link_not_on_post`; with a token whose cliente differs raises `post_not_found`; on a `rascunho` post raises `post_not_visible`; on `aprovado_cliente` succeeds.
  - (k) `hub_add_media_note_reply` on an internal note raises `note_not_found`.
  - (l) `record_client_approval_with_notes(..., 'aprovado', ...)` with 2 open client notes, 1 resolved client note, 1 open internal note → `open_note_count = 2`, exactly those 2 rows in `post_approval_media_notes`, post status `aprovado_cliente`; called again on the now-approved post raises `post_not_pending`.
  - (m) as `authenticated`, `create_team_media_note` on a post of another workspace raises (no row / `link_not_on_post`); on own post creates an internal note; `hub_create_media_note` is not executable by `authenticated`.
  - (n) `create_post_approval_notification(post_in_workflow, 'mensagem', 'x')` inserts a notification whose link ends `&post=<id>`.
- [ ] **Step 2: Run, expect FAIL** — `bash scripts/test-entitlements.sh` → FAIL (function does not exist).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run, expect PASS** — `npx supabase db reset && bash scripts/test-entitlements.sh`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): media note RPCs and atomic approval snapshot"`

---

### Task 3: Shared note loader for edge functions

**Files:**
- Create: `supabase/functions/_shared/media-notes.ts`
- Test: `supabase/functions/__tests__/media-notes_test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HubMediaNoteReplyDTO { id: number; author: "client" | "team"; author_name: string | null; body: string; created_at: string }
  export interface HubMediaNoteDTO {
    id: number; post_id: number; media_kind: "image" | "video";
    link_id: number | null;          // current_link_id; null = versão anterior
    slide_index: number;             // current_slide_index when current, else slide_index_at_creation
    is_previous_version: boolean;
    t_seconds: number | null; x: number | null; y: number | null;
    author: "client" | "team"; author_name: string | null;
    body: string; status: "open" | "resolved"; resolved_at: string | null; created_at: string;
    replies: HubMediaNoteReplyDTO[];
  }
  export function buildHubMediaNotes(notes: NoteViewRow[], replies: ReplyRow[], namesByUserId: Map<string, string>): HubMediaNoteDTO[]  // drops any row whose visibility !== "client" (defense in depth)
  export async function loadClientMediaNotes(db: { from: (table: string) => any }, contaId: string, postIds: number[]): Promise<HubMediaNoteDTO[]>
  ```
  (`db` is typed with `from` only because `hub-post-history`'s `DbClient` has no `rpc`.) The query mock is at the repo root, `test/shared/supabaseMock.ts`, imported from `supabase/functions/__tests__/` as `../../../test/shared/supabaseMock.ts`.
  `loadClientMediaNotes` selects `post_media_notes_v` with `.eq("conta_id").in("post_id").eq("visibility","client")` ordered `created_at, id`; replies `.in("note_id")` ordered `created_at, id`; names from `membros` (`crm_user_id, nome`) `.eq("conta_id")`; never selects `hub_token`. Returns `[]` for empty `postIds` without querying.

- [ ] **Step 1: Write failing tests** (`createSupabaseQueryMock` from `test/shared/supabaseMock.ts`):
  - `buildHubMediaNotes maps a current note`: view row with `current_link_id 41, current_slide_index 2` → `link_id 41, slide_index 2, is_previous_version false`.
  - `buildHubMediaNotes keeps snapshot index for versão anterior`: `current_link_id null, slide_index_at_creation 1` → `link_id null, slide_index 1, is_previous_version true`.
  - `team reply gets member name, falls back to null`: name map hit → `"Bianca"`; miss → `null`.
  - `loadClientMediaNotes filters visibility client`: assert the recorded call on `post_media_notes_v` has an `eq` modifier `["visibility","client"]` and select string does not contain `hub_token`.
  - `loadClientMediaNotes skips queries for no posts`: `db.calls.length === 0`.
- [ ] **Step 2: Run, expect FAIL** — `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/media-notes_test.ts`.
- [ ] **Step 3: Implement** in `_shared/media-notes.ts`.
- [ ] **Step 4: Run, expect PASS**, plus `npm run check:functions`.
- [ ] **Step 5: Commit** — `git commit -m "feat(functions): shared client media-note loader"`

---

### Task 4: `hub-media-notes` edge function

**Files:**
- Create: `supabase/functions/hub-media-notes/index.ts`, `supabase/functions/hub-media-notes/handler.ts`
- Modify: `supabase/config.toml` (add `[functions.hub-media-notes]` / `verify_jwt = false`)
- Test: `supabase/functions/__tests__/hub-media-notes_test.ts`

**Interfaces:**
- Consumes: `resolveHubToken`, `getClientIP`, `createJsonResponder`, `buildCorsHeaders`, RPCs from Task 2, `create_post_approval_notification`.
- Produces: `createHubMediaNotesHandler(deps: { buildCorsHeaders; createDb; now; rateLimit })` (same deps shape as `hub-approve/handler.ts:128-133`). Routes (JSON body, all POST):
  - `{ token, op: "create", post_id, link_id, t_seconds?, x?, y?, body }` → `200 { ok: true, note_id }`
  - `{ token, op: "reply", note_id, body }` → `200 { ok: true, reply_id }`
  - Validation 400 `"Dados inválidos."`: body trimmed 1..2000, ids positive ints, `x`/`y` both or neither in 0..1, `t_seconds` ≥ 0.
  - RPC error mapping: `post_not_found`/`note_not_found` → 404 `"Post não encontrado."`; `post_not_visible` → 400 `"Post ainda não foi enviado para o cliente."`; `link_not_on_post`/`invalid_anchor` → 400 `"Dados inválidos."`; else 500 `"Erro ao salvar comentário."` (log detail, never return it).
  - After success: `rpc("create_post_approval_notification", { p_post_id, p_action: "mensagem", p_comentario: body })` for create and reply; a failure only logs.
  - Rate limits: bad token as in Global Constraints; write key `hub-write:hub-media-notes:${conta_id}:${cliente_id}` 60/3600; never a `hub-read:` key.

- [ ] **Step 1: Write failing tests** (style of `hub-functions_test.ts` hub-approve block, fake deps inline):
  - `create calls hub_create_media_note with token-derived conta and cliente` (assert RPC params, including `p_link_id`, and that no `p_file_id` exists).
  - `create never debits hub-read` (recorder sees only `hub-badtoken`-free path keys starting `hub-write:hub-media-notes:`).
  - `post_not_visible maps to 400` and `note_not_found maps to 404`.
  - `rejects x without y` → 400 and no RPC call.
  - `reply notifies with action mensagem`.
  - `unknown token returns 404 Link inválido` (bad-token limiter consulted).
  - `CORS preflight returns 200 with buildCorsHeaders`.
- [ ] **Step 2: Run, expect FAIL** — `deno test … supabase/functions/__tests__/hub-media-notes_test.ts`.
- [ ] **Step 3: Implement** handler and index (index wires `checkRateLimit` like `hub-approve/index.ts`).
- [ ] **Step 4: Run, expect PASS**, plus `npm run check:functions`.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub-media-notes): token-auth create and reply"`

---

### Task 5: Hub reads (`hub-posts`, `hub-post-history`) and `hub-approve` snapshot

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts` (Promise.all ~:362-439, response ~:575-594)
- Modify: `supabase/functions/hub-post-history/handler.ts` (~:170-190, response)
- Modify: `supabase/functions/hub-approve/handler.ts` (~:234-262)
- Test: `supabase/functions/__tests__/hub-functions_test.ts`, `supabase/functions/__tests__/hub-post-history_test.ts`

**Interfaces:**
- Consumes: `loadClientMediaNotes` (Task 3), `record_client_approval_with_notes` (Task 2).
- Produces:
  - `hub-posts` response gains `mediaNotes: HubMediaNoteDTO[]` for `visibleIds` only.
  - `hub-post-history` response gains `media_notes: HubMediaNoteDTO[]` and each approval gains `open_note_count: number` (count of its `post_approval_media_notes` rows; 0 when none).
  - `hub-approve` aprovado/correcao branch calls `record_client_approval_with_notes` instead of `record_client_approval` (same params plus `p_conta_id: hubToken.conta_id`, without `p_is_workspace_user`); maps `post_not_pending` → 409 `"Post não está mais aguardando aprovação."`; keeps `pending_suggestion` → 409; uses the returned `approval_id` for `linkReferencesToApproval`.

- [ ] **Step 1: Write failing tests:**
  - hub-posts: `mediaNotes only for visible posts and only client visibility` (queue a view response; assert the `eq("visibility","client")` modifier and that a note for a non-visible post id is not returned).
  - hub-posts: `hub-posts payload never contains internal notes` — queue view rows where one has `visibility: "internal"` returned by a misbehaving mock; assert the handler's output excludes it (Task 3's `buildHubMediaNotes` already drops non-client rows).
  - hub-post-history: `media_notes included and approvals carry open_note_count`; `hub-post-history never serializes an internal note` (view row with `visibility: "internal"` returned by the mock is absent from the output).
  - hub-approve: `aprovado uses record_client_approval_with_notes` (assert rpc name and `p_conta_id`), `post_not_pending maps to 409`.
- [ ] **Step 2: Run, expect FAIL** — `deno test … supabase/functions/__tests__/hub-functions_test.ts supabase/functions/__tests__/hub-post-history_test.ts`.
- [ ] **Step 3: Implement.** Existing hub-approve tests that queue `record_client_approval` move to the new RPC name and row shape `[{ approval_id, open_note_count }]`.
- [ ] **Step 4: Run, expect PASS** — full `npm run test:functions` and `npm run check:functions`.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): notes in hub-posts/history, approval snapshot"`

---

### Task 6: Mensagens RPCs and MCP feedback

**Files:**
- Create: `supabase/migrations/20261026000003_mensagens_media_notes.sql`
- Modify: `supabase/tests/entitlements/99_post_media_notes.sql` (append)
- Modify: `supabase/functions/mcp/content.ts` (~:446-552), `supabase/functions/mcp/queries.ts` (~:977-1048)
- Test: `supabase/functions/__tests__/mcp-feedback_test.ts`, `supabase/functions/__tests__/mcp-content_test.ts`

**Interfaces:**
- `get_mensagens_feed`, `get_mensagens_unread`, `get_mensagens_conversas` (copy latest bodies from `20260830000003:885-1160`, signatures and RETURNS unchanged) gain two `UNION ALL` branches in their `feed` CTEs, **client visibility only** (`n.visibility = 'client'`):
  - `source 'media_note'`: from `post_media_notes`, `item_id = n.id`, `action = 'nota'`, `content = left(n.body, 280)`, `is_workspace_user = false`, `author_user_id = null`.
  - `source 'media_note_reply'`: from replies joined to client notes, `item_id = r.id`, `action = 'resposta_nota'`, `is_workspace_user = (r.author_kind = 'team')`, `author_user_id = r.author_user_id`.
  - Unread: CRM branch counts client notes and client replies; Hub branch counts team replies on client notes.
- MCP: `PostFeedbackItem` gains `media_notes: { id; anchor: string; status: "open" | "resolved"; body; author: "client" | "workspace"; created_at; replies: { body; author; created_at }[] }[]` where `anchor` is `"slide N"` (1-based) plus `" · 0:42"` for videos plus `" · ponto"` when `x` is set, and `" (versão anterior)"` when previous. **Client notes only** (`visibility = 'client'`): `listPostFeedback` reads only `post_approvals` and `post_status_events`, never internal threads, so by spec call 9 internal notes are excluded. `buildPostFeedback(feedbackRows, statusEvents, mediaNotes = [])` takes the notes as an optional third argument so existing calls compile. Phase 1 post selection also scans `post_media_notes` with `.eq("conta_id", d.ctx.conta_id).eq("visibility","client")` so posts with notes but no approvals are eligible.

- [ ] **Step 1: Failing tests:**
  - psql (o): `get_mensagens_feed(p_conta_id, p_cliente_id)` as service role returns the client note and the team reply on it, and **zero** rows for an internal note and its replies; `get_mensagens_unread` Hub branch counts the team reply (1).
  - deno `mcp-content_test.ts`: `buildPostFeedback includes media notes with anchor labels` (`"slide 3 · ponto"`, `"slide 1 · 0:42 (versão anterior)"`).
  - deno `mcp-feedback_test.ts`: `post with notes and no approvals is listed`; `internal notes are not returned`.
- [ ] **Step 2: Run, expect FAIL** — `bash scripts/test-entitlements.sh`; `deno test … supabase/functions/__tests__/mcp-*_test.ts`.
- [ ] **Step 3: Implement** the migration and MCP changes.
- [ ] **Step 4: Run, expect PASS** — both commands plus `npm run check:functions`.
- [ ] **Step 5: Commit** — `git commit -m "feat(mensagens,mcp): client media notes in inbox and feedback tool"`

---

### Task 7: Shared pin geometry and note helpers

**Files:**
- Create: `packages/ui/mediaPins/geometry.ts`, `packages/ui/mediaPins/__tests__/geometry.test.ts`

**Interfaces:**
- Produces (imported as `@mesaas/ui/mediaPins/geometry`):
  ```ts
  export interface Box { left: number; top: number; width: number; height: number }
  export function containedRect(box: Box, naturalW: number, naturalH: number): Box  // object-contain rendered rect; falls back to box when natural size unknown/0
  export function toRelative(clientX: number, clientY: number, rendered: Box): { x: number; y: number } | null  // null outside rendered rect; rounded to 4 decimals
  export function toPercentStyle(p: { x: number; y: number }, box: Box, rendered: Box): { left: string; top: string }  // CSS % within the full box
  export function pinNumbers<T extends { id: number; x: number | null; created_at: string }>(notes: T[], linkOf: (n: T) => number | null): Map<number, number>  // note id → 1-based number per link (by created_at then id); only current notes (linkOf non-null) with x
  // Hub passes n => n.link_id, CRM passes n => n.current_link_id
  export function formatMoment(t: number): string  // 42 → "0:42", 125.4 → "2:05"
  export function isNearMoment(t: number, now: number, windowSeconds = 1): boolean
  ```

- [ ] **Step 1: Failing tests:**
  - `containedRect letterboxes a portrait image in a square box`: box 400×400, natural 1080×1350 → `{ left: 40, top: 0, width: 320, height: 400 }`.
  - `toRelative returns null in the letterbox bar` (clientX 20) and `{ x: 0.5, y: 0.5 }` at (200, 200).
  - `round trip at another size`: relative from box 400×400 rendered back into box 800×600 lands at the image center (`toPercentStyle` gives `left: "50%", top: "50%"`).
  - `pinNumbers numbers per link and skips whole-slide notes`.
  - `formatMoment` cases above; `isNearMoment(42, 42.9)` true, `(42, 43.5)` false.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/ui/mediaPins` (`vitest.config.ts` already includes `packages/**/__tests__/**`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): media pin geometry helpers"`

---

### Task 8: `VideoPlayer` exposes its element

**Files:**
- Modify: `packages/ui/VideoPlayer/index.tsx`
- Test: `packages/ui/VideoPlayer/__tests__/index.test.tsx`

**Interfaces:**
- Produces: `VideoPlayerProps` gains `onVideoElement?: (el: HTMLVideoElement | null) => void`, called with the mounted `<video>` and again (null, then the new element) whenever `key={mode}` recreates it. Implement with a callback ref that sets the private `videoRef` and forwards (`VideoPlayerProps` has no `ref`, so nothing else changes).

- [ ] **Step 1: Failing tests:** `onVideoElement receives the video element`; `onVideoElement fires again after fallback switch` (trigger `onFatalError` path that flips mode to `fallback`, assert two non-null calls with different elements).
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/ui/VideoPlayer`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, plus `npx vitest run apps/hub/src/components/__tests__/PostMediaLightbox.test.tsx apps/crm/src/pages/entregas/components/__tests__/PostMediaLightbox.test.tsx`.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): VideoPlayer onVideoElement callback"`

---

### Task 9: Hub data layer

**Files:**
- Modify: `apps/hub/src/types.ts` (add `HubMediaNote`, `HubMediaNoteReply` mirroring Task 3 DTOs; `HubPostsResponse.mediaNotes: HubMediaNote[]`; `PostHistoryResponse.media_notes`; `PostHistoryApproval.open_note_count?: number`; `MensagemFeedItem.source` adds `'media_note' | 'media_note_reply'`)
- Create: `apps/hub/src/services/mediaNotes.ts`, `apps/hub/src/lib/mediaNotes.ts`
- Modify: `apps/hub/src/hooks/useHubPosts.ts` (~:70-77: merge `mediaNotes` from the shell response and the `fetchOlderPosts` pages with the same `mergeById` pattern as `posts`/`postApprovals`, and return it)
- Test: `apps/hub/src/services/__tests__/mediaNotes.test.ts`, `apps/hub/src/lib/__tests__/mediaNotes.test.ts`, `apps/hub/src/hooks/__tests__/useHubPosts.test.tsx` (add: `older pages contribute their mediaNotes`)

**Interfaces:**
- Produces:
  ```ts
  // services/mediaNotes.ts (wrap writes in trackUnsavedWork from @mesaas/app-lifecycle)
  export function createMediaNote(token: string, input: { post_id: number; link_id: number; t_seconds?: number; x?: number; y?: number; body: string }): Promise<{ ok: true; note_id: number }>
  export function replyMediaNote(token: string, note_id: number, body: string): Promise<{ ok: true; reply_id: number }>
  // lib/mediaNotes.ts
  export function notesForPost(all: HubMediaNote[], postId: number): HubMediaNote[]
  export function openNoteCount(notes: HubMediaNote[]): number
  export function openCountByLink(notes: HubMediaNote[]): Map<number, number>
  export function canWriteNotes(post: HubPost): boolean  // status in the Hub-visible list AND !post.em_producao
  export function anchorLabel(note: HubMediaNote, t: TFunction<'hubPosts'>): string  // "Slide 3 · ponto 1", "0:42 · ponto na cena", "Slide 2 (versão anterior)"
  ```
  Both services post to `hub-media-notes` via the `post<T>` helper in `api.ts` (`{ token, op, ... }`).
- Copy (pt defaults, add pt+en JSON under `hubPosts.mediaNotes`): `title "Comentários na mídia"`, `openCount "{{count}} em aberto"`, `slide "Slide {{n}}"`, `point "ponto {{n}}"`, `pointInScene "ponto na cena"`, `previousVersion "versão anterior"`, `statusOpen "Em aberto"`, `statusResolved "Resolvido"`, `comment "Comentar"`, `commentWholeSlide "Comentar o slide inteiro"`, `commentAtMoment "Comentar em {{time}}"`, `tapHint "Toque na imagem para marcar um ponto"`, `composerPoint "Comentário no ponto marcado do slide {{n}}"`, `composerSlide "Comentário sobre o slide {{n}} inteiro"`, `composerMoment "Comentário em {{time}}"`, `composerMomentPoint "Comentário em {{time}}, no ponto marcado"`, `placeholder "O que você quer mudar aqui?"`, `send "Enviar comentário"`, `cancel "Cancelar"`, `reply "Responder"`, `sendError "Não foi possível enviar. Tente novamente."`, `approveConfirmTitle "Você tem {{count}} comentários em aberto"`, `approveConfirmBody "Aprovar mesmo assim? Os comentários continuam visíveis para a equipe."`, `approveConfirm "Aprovar mesmo assim"`, `team "Equipe"`.

- [ ] **Step 1: Failing tests:** `createMediaNote posts op create to hub-media-notes` (mock `fetch`); `canWriteNotes false for em_producao and for rascunho`; `openCountByLink ignores resolved and previous-version notes` (previous-version open notes are excluded from per-link counts but included in `openNoteCount`); `anchorLabel` three cases; locale parity test passes with the new keys.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/hub/src/services/__tests__/mediaNotes.test.ts apps/hub/src/lib/__tests__/mediaNotes.test.ts apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, plus `npx tsc -p apps/hub/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): media note types, services and helpers"`

---

### Task 10: Hub note components

**Files:**
- Create: `apps/hub/src/components/posts/mediaNotes/MediaPinLayer.tsx`, `MediaNoteComposer.tsx`, `MediaNotesList.tsx`
- Test: `apps/hub/src/components/posts/mediaNotes/__tests__/*.test.tsx`

**Interfaces:**
- `MediaPinLayer({ notes: HubMediaNote[]; naturalWidth: number | null; naturalHeight: number | null; placing: boolean; pending: { x: number; y: number } | null; onPlace(p: { x: number; y: number }): void; onPinClick?(noteId: number): void })` — absolutely fills its parent; measures itself (ResizeObserver) and uses `containedRect`/`toRelative`/`toPercentStyle`; when `placing`, a full-size transparent `<button aria-label={t('mediaNotes.tapHint')}>` captures taps (pointerdown/up distance < 8px, reuse `crossedDragThreshold` from `lib/carouselGesture.ts`; a drag does not place and does not `stopPropagation`, so the carousel still swipes). Pins: open = ink fill + white ring, resolved = light; pending = `+`. Pins are `role="img"` with the note body as label.
- `MediaNoteComposer({ open; title: string; onSubmit(body: string): Promise<void>; onCancel(): void; onOverlayChange(open: boolean): void })` — renders inside `HubDialog` (bottom sheet on phone, centered on md+), textarea 16px, `useUnsavedWork(body.trim() !== '' || sending)`, inline `sendError` on failure, keeps text on failure.
- `MediaNotesList({ notes; canReply: boolean; onJump(note): void; onReply(noteId, body): Promise<void> })` — the side list from the mockup: anchor chip (button, calls `onJump`), `formatDistance`-style time, status pill (the Hub's `StatusPill`, `apps/hub/src/components/StatusPill.tsx`), body, replies (team author `author_name ?? t('mediaNotes.team')`, client "Você"), a reply field when `canReply`.

- [ ] **Step 1: Failing tests:**
  - `MediaPinLayer`: `tap places a pin at relative coords` (mock `getBoundingClientRect` 400×400, natural 1080×1350, click at (200,200) → `onPlace({x:0.5,y:0.5})`); `tap in the letterbox places nothing`; `drag beyond 8px places nothing`; `not placing renders no capture button`.
  - `MediaNoteComposer`: `submits trimmed body`; `keeps text and shows error when onSubmit rejects`; `calls onOverlayChange(true) when open`.
  - `MediaNotesList`: `shows Em aberto / Resolvido`, `team reply shows Equipe fallback`, `no reply field when canReply false`, `anchor chip calls onJump`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/hub/src/components/posts/mediaNotes`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): pin layer, composer and notes list"`

---

### Task 11: Wire notes into the Hub post dialog, carousel, stories and approve

**Files:**
- Modify: `apps/hub/src/components/posts/PostMediaPane.tsx`, `apps/hub/src/components/posts/PostDetailDialog.tsx`, `apps/hub/src/pages/PostagensPage.tsx` (~:314), `apps/hub/src/pages/AprovacoesPage.tsx` (~:258)
- Test: `apps/hub/src/components/posts/__tests__/PostMediaPane.test.tsx`, `apps/hub/src/components/posts/__tests__/PostDetailDialog.mediaNotes.test.tsx` (new file; reuse `renderDialog` setup from `PostDetailDialog.test.tsx`)

**Interfaces:**
- `PostDetailDialogProps` gains `mediaNotes: HubMediaNote[]` (pages pass the merged `mediaNotes` returned by `useHubPosts` from Task 9, so notes of posts loaded via older pages arrive too); after a note/reply succeeds the dialog calls the existing `onApprovalSubmitted()` (which invalidates `hub-posts`).
- `PostMediaPane` gains `{ notes: HubMediaNote[]; placing: boolean; pending: {x,y}|null; onPlace(linkId: number, p): void; currentIndexChange?(i: number): void }`. When `placing`: slide buttons do not open the lightbox, story tap zones are disabled, `MediaPinLayer` overlays the current image slide. Video slides never enter placing (video notes live in the lightbox, Task 12). Thumbnail dots/slides show `openCountByLink` badges.
- Dialog behaviour (decision: pin placement is an explicit mode so a plain tap still opens the lightbox):
  - A `Comentar` button over the media (visible when `canWriteNotes(post)` and the current slide is an image and not `media_lost_at`) toggles placing; the hint `tapHint` shows while placing; `Comentar o slide inteiro` beside it opens the composer with no point.
  - Tap → pending pin → composer (`composerPoint`); submit → `createMediaNote({ post_id, link_id, x, y, body })`; cancel clears pending.
  - `MediaNotesList` renders in the content tab after `{autoPublishNote}` (~:925) when the post has any media; `onJump` moves the pane to that link (or opens the lightbox at it for videos); `canReply = canWriteNotes(post)`; hidden notes for `is_previous_version` show without jump.
  - Aprovar (~:984): when `openNoteCount(notes) > 0`, open `HubConfirmDialog` (`approveConfirmTitle`/`approveConfirmBody`/`approveConfirm`/`cancel`) first; confirm calls `submit('aprovado')`. Composer and confirm call `handleOverlayChange`.
  - Story branch: same placing behaviour on image frames.

- [ ] **Step 1: Failing tests:**
  - PostMediaPane: `placing disables lightbox on tap and places a pin`; `swipe in placing mode changes slide without placing` (pointer events 60px horizontal); `story tap zones disabled while placing`; `slide badge shows open count`.
  - Dialog: `Comentar hidden when post is em_producao` (Review Focus 4); `pin then send calls createMediaNote with link id and coords, then onApprovalSubmitted`; `Aprovar with 2 open notes asks for confirmation, confirm calls submitApproval aprovado`; `Aprovar with no open notes approves directly`; `notes list renders in content tab`.
  Mock `../../../services/mediaNotes` like the file mocks `../../../api`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/hub/src/components/posts/__tests__/PostMediaPane.test.tsx apps/hub/src/components/posts/__tests__/PostDetailDialog.mediaNotes.test.tsx`.
- [ ] **Step 3: Implement.** Existing `PostDetailDialog*.test.tsx` renders get `mediaNotes={[]}`.
- [ ] **Step 4: Run, expect PASS** — `npx vitest run apps/hub` and `npx tsc -p apps/hub/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): comment on slides and spots from the post dialog"`

---

### Task 12: Hub video notes in the lightbox

**Files:**
- Modify: `apps/hub/src/components/PostMediaLightbox.tsx`
- Modify: `apps/hub/src/components/posts/PostDetailDialog.tsx` (pass notes/handlers to the lightbox)
- Test: `apps/hub/src/components/__tests__/PostMediaLightbox.test.tsx`

**Interfaces:**
- `PostMediaLightbox` gains optional `{ notes?: HubMediaNote[]; canWrite?: boolean; onCreateNote?(input: { link_id: number; t_seconds?: number; x?: number; y?: number; body: string }): Promise<void>; initialSeek?: number }`. Without `notes` it behaves exactly as today.
- For a video item (uses `onVideoElement` from Task 8): a `Comentar em {{time}}` button pauses and opens the composer (`composerMoment`); tapping the frame while `canWrite` pauses, places a pending pin over the video box (`MediaPinLayer` with the file's natural size) and opens the composer (`composerMomentPoint`). A row of timeline markers (one button per note, positioned at `t / duration`) seeks on click; spot pins render only while `isNearMoment(note.t, currentTime)`. `initialSeek` seeks after `loadedmetadata`.
- For image items: existing pins render read-only.

- [ ] **Step 1: Failing tests:** `Comentar em pauses and passes current time` (stub `HTMLMediaElement.prototype.pause`, set `currentTime = 42`, submit → `onCreateNote({ link_id, t_seconds: 42, body })`); `marker click seeks`; `spot pin hidden away from its moment`; `no comment controls when canWrite false`; `without notes prop renders no note UI` (regression).
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/hub/src/components/__tests__/PostMediaLightbox.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — `npx vitest run apps/hub`.
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): comment on video moments and spots"`

---

### Task 13: Hub history and Mensagens

**Files:**
- Modify: `apps/hub/src/lib/postHistory.ts`, `apps/hub/src/components/PostHistoryPanel.tsx`, `apps/hub/src/pages/MensagensPage.tsx`
- Modify: `packages/i18n/locales/{pt,en}/hubPosts.json`, `packages/i18n/locales/{pt,en}/hubMessages.json`
- Test: `apps/hub/src/lib/__tests__/postHistory.test.ts`, `apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx`, `apps/hub/src/pages/__tests__/MensagensPage.test.tsx`

**Interfaces:**
- `HistoryEntry` gains `{ kind: 'note'; key; at; note: HubMediaNote }`; `KIND_ORDER.note = 1.5` (between approval and status); `buildHistoryEntries(history, opts)` pushes one entry per `history.media_notes` item at `created_at`.
- Approval entries for `correcao`/`aprovado` with `open_note_count > 0` render `history.openNotes` = `"{{count}} comentários na mídia em aberto"` under the comment.
- `PostHistoryPanel` renders note entries with `anchorLabel`, status pill and body (no reply here).
- `MensagensPage`: `itemKey`, `isEventRow` (false for both new sources), and labels: `media_note` → `hubMessages.mediaNote "Comentário na mídia"`, `media_note_reply` → `hubMessages.mediaNoteReply "Resposta a um comentário na mídia"`, both with the post chip.

- [ ] **Step 1: Failing tests:** `buildHistoryEntries interleaves notes by time`; `correction entry shows open note count`; `MensagensPage renders media_note with label and post chip`.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run apps/hub/src/lib/__tests__/postHistory.test.ts apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx apps/hub/src/pages/__tests__/MensagensPage.test.tsx`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** (plus the locale parity test).
- [ ] **Step 5: Commit** — `git commit -m "feat(hub): media notes in history and Mensagens"`

---

### Task 14: CRM store

**Files:**
- Create: `apps/crm/src/store/mediaNotes.ts` (import by path, **not** re-exported from `store/index.ts`, so drawer tests mocking `@/store` are untouched)
- Modify: `apps/crm/src/store/posts.ts` (`PostApproval` gains `author_user_id: string | null` and `media_note_ids: number[]`; `getPostApprovals` selects `'*, post_approval_media_notes(note_id)'` and flattens)
- Test: `apps/crm/src/store/__tests__/mediaNotes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MediaNoteReply { id: number; note_id: number; author_kind: 'client' | 'team'; author_user_id: string | null; body: string; created_at: string }
  export interface MediaNote {
    id: number; post_id: number; media_kind: 'image' | 'video'; visibility: 'client' | 'internal';
    author_kind: 'client' | 'team'; author_user_id: string | null;
    current_link_id: number | null; current_slide_index: number | null; slide_index_at_creation: number; is_previous_version: boolean;
    t_seconds: number | null; x: number | null; y: number | null;
    body: string; status: 'open' | 'resolved'; resolved_by: string | null; resolved_at: string | null; created_at: string;
    replies: MediaNoteReply[];
  }
  export const mediaNotesKey = (postIds: number[]) => ['media-notes', postIds.join(',')] as const
  export function getMediaNotes(postIds: number[]): Promise<MediaNote[]>       // view + replies; never selects hub_token
  export function createInternalMediaNote(input: { postId: number; linkId: number; tSeconds?: number; x?: number; y?: number; body: string }): Promise<number>  // rpc create_team_media_note
  export function replyToMediaNote(noteId: number, body: string): Promise<void>  // insert reply, author_kind 'team', author_user_id = current user, conta_id from profile
  export function setMediaNoteStatus(noteIds: number[], status: 'open' | 'resolved'): Promise<void>
  export function openNotesOnLink(notes: MediaNote[], linkId: number): MediaNote[]   // open, current, on that link
  ```

- [ ] **Step 1: Failing tests** (pattern of `store.comments.test.ts` with `vi.mock('../../lib/supabase')` helpers): `getMediaNotes reads the view and groups replies`; `getMediaNotes select string excludes hub_token`; `createInternalMediaNote calls create_team_media_note with p_link_id`; `setMediaNoteStatus updates only status for the ids`; `openNotesOnLink excludes resolved and previous-version notes`; `getPostApprovals flattens media_note_ids`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/crm/src/store/__tests__/mediaNotes.test.ts apps/crm/src/__tests__/store.posts*.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, plus `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(crm): media notes store"`

---

### Task 15: CRM client conversation with notes

**Files:**
- Create: `apps/crm/src/pages/entregas/components/mediaNotes/ClientConversation.tsx`, `MediaNoteCard.tsx`, `conversationItems.ts`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (desktop thread ~:1641-1676), `apps/crm/src/pages/entregas/components/postEditorPhone/PhoneComments.tsx` ("Com o cliente" channel), `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`, `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` (fetch `mediaNotesKey`, pass down, invalidate on change)
- Test: `apps/crm/src/pages/entregas/components/mediaNotes/__tests__/*.test.tsx`

**Interfaces:**
- `buildConversationItems(approvals: PostApproval[], notes: MediaNote[], media: PostMedia[]): ConversationItem[]` — chronological; item kinds `'approval' | 'note'`; only `visibility === 'client'` notes; for an approval with `media_note_ids.length > 0` attaches `noteSummary: string` = `"2 comentários na mídia em aberto: slides 3, 4"` (snapshot ids, 1-based slides from the notes' current or snapshot index); an `aprovado` with a non-empty snapshot is labelled `"Aprovado com {{n}} comentários em aberto"`.
- `ClientConversation({ approvals, notes, media, workspaceUsers, membros, replyText, sendingReply, onReplyChange, onReplySend, onNoteReply(noteId, body), onNoteStatus(noteIds, status), onSelectMedia(linkId) })` — filter segmented control `Tudo` / `Em aberto (N)` / `Na mídia`; the generic reply input keeps today's behaviour and is labelled `Responder ao cliente`.
- `MediaNoteCard` — anchor chip (`Slide 3 · ponto 1`, `0:42`, `(versão anterior)`), author (client name; team via `resolveAuthorName`, export it from `PostCommentSummary.tsx`), status badge, replies, reply field `Responder ao cliente` with `useUnsavedWork(text.trim() !== '')`, `Marcar como resolvido` / `Reabrir`.
- Both drawers: `useQuery({ queryKey: mediaNotesKey(postIds), queryFn: () => getMediaNotes(postIds) })`; handlers await the store call then `invalidateQueries({ queryKey: ['media-notes'] })` and `['post-approvals']`.

- [ ] **Step 1: Failing tests:** `buildConversationItems interleaves and excludes internal notes`; `aprovado with snapshot gets the open-comments label`; `ClientConversation Em aberto filter shows only open notes`; `Marcar como resolvido calls onNoteStatus([id],'resolved')`; `reply box label is Responder ao cliente`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/crm/src/pages/entregas/components/mediaNotes`.
- [ ] **Step 3: Implement**; existing drawer tests: add `vi.mock('@/store/mediaNotes', …)` returning `getMediaNotes: async () => []` where the drawers are rendered.
- [ ] **Step 4: Run, expect PASS** — `npx vitest run apps/crm/src/pages/entregas` and `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(crm): client conversation interleaves media notes"`

---

### Task 16: CRM pins, internal notes, replace/remove prompt and the approved flag

**Files:**
- Create: `apps/crm/src/pages/entregas/components/mediaNotes/CrmPinLayer.tsx`, `OpenNotesBadge.tsx`, `ResolveNotesPrompt.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx`, `PostMediaGallery.tsx` (tiles ~:1169, phone strip ~:997, `handleDelete` ~:516, `handleUseAsReelCover` ~:478, adjustment `onUpdated` ~:929), `WorkflowDrawer.tsx` (post row near `AutoScheduleBadge` ~:1984), `StandalonePostDrawer.tsx` (header ~:1087), `postEditorPhone/PhoneEditorHeader.tsx` (~:76)
- Test: `apps/crm/src/pages/entregas/components/mediaNotes/__tests__/*.test.tsx`, `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`

**Interfaces:**
- `PostMediaGallery` gains `notes?: MediaNote[]` and `onNotesChanged?(): void` (passed from `PostEditorBody`, which receives `notes` from the drawers). Deliberate v1 scope: `ExpressPostPage`/`ExpressPostPhone` pass nothing (express posts publish immediately and never reach client approval), and the Estúdio/design flows and MCP `set_post_media` get no resolve prompt; their notes still show "versão anterior" correctly through the view.
- Tiles show an open-note count badge (client + internal, current only).
- `PostMediaLightbox` gains optional `{ notes?: MediaNote[]; onCreateInternalNote?(input): Promise<void> }`: renders all current pins on that item (client = ink, internal = a distinct outline with `Interno` in its label); a `Nota interna` button enters placing (images: tap places; videos: pause + tap, `t_seconds` from `onVideoElement`), composer title `Nota interna no slide {{n}}`, submit → `createInternalMediaNote`. Reuses `@mesaas/ui/mediaPins/geometry`.
- `ResolveNotesPrompt({ open, count, onConfirm, onCancel })` — AlertDialog, title `Marcar como resolvidos os {{count}} comentários deste slide?`, confirm `Marcar como resolvidos`, cancel `Agora não`. In the gallery: before replace (`MediaAdjustmentDialog` opens) and before delete/`handleUseAsReelCover`, capture `openNotesOnLink(notes, linkId)`; after the operation succeeds and the list is non-empty, show the prompt; confirm → `setMediaNoteStatus(ids, 'resolved')` then `onNotesChanged()`.
- `OpenNotesBadge({ approvals: PostApproval[]; notes: MediaNote[] })` — renders `Aprovado com {{n}} comentários em aberto` (`n` = live open client notes) only when the post's latest client `aprovado` approval has a non-empty `media_note_ids` and `n > 0`; Badge `variant="warning"`, with an icon (color is never the only signal).

- [ ] **Step 1: Failing tests:** `OpenNotesBadge hidden without snapshot`, `shows live count`, `hidden when all resolved`; `gallery delete with open notes shows prompt and confirm resolves them` (mock `@/services/postMedia` `deletePostMedia` and `@/store/mediaNotes`); `adjust replace with open notes shows prompt`; `no prompt when no open notes on that link`; `lightbox internal note sends link id and coords` (letterboxed rect mock).
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/crm/src/pages/entregas/components/mediaNotes apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — `npx vitest run apps/crm` and `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(crm): pins, internal notes, resolve prompt, approved flag"`

---

### Task 17: CRM Mensagens and notifications copy

**Files:**
- Modify: `apps/crm/src/store/mensagens.ts` (`MensagemFeedItem.source` union), `apps/crm/src/pages/mensagens/mensagensLogic.ts` (`matchesTipo`, `isEventRow`, `eventLabel`, `conversaPreview`), `apps/crm/src/pages/mensagens/components/ConversationThread.tsx`, `apps/crm/src/pages/mensagens/phone/ConversationThreadPhone.tsx`
- Test: `apps/crm/src/pages/mensagens/__tests__/mensagensLogic.test.ts`; Create: `apps/crm/src/pages/mensagens/__tests__/ConversationThread.test.tsx`

**Interfaces:**
- `media_note` bubbles show the label `Comentário na mídia` above the body and the `PostChip`; `media_note_reply` shows `Resposta a um comentário na mídia`. The `Responder` button on them keeps today's behaviour (reply via `replyToPostApproval` to the post). `conversaPreview` prefixes `Comentário na mídia: `.
- `matchesTipo` (filters `'todas' | 'mensagens' | 'aprovacoes' | 'sugestoes'`): both note sources match `'todas'` and `'aprovacoes'` (the filter that covers `post_feedback`).

- [ ] **Step 1: Failing tests:** `conversaPreview for media_note`; `ConversationThread renders media_note label and chip`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/crm/src/pages/mensagens`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(crm): media notes in Mensagens"`

---

### Task 18: Full verification, browser check and deploy notes

**Files:**
- Modify: `CLAUDE.md` (Gotchas: add `hub-media-notes` to the `--no-verify-jwt` list)

- [ ] **Step 1: Run every gate** — `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run check:functions`, `npm run test:functions`, `bash scripts/test-entitlements.sh`. All green. If `test:functions` dirtied `deno.lock` or `node_modules/.deno` appeared, `git checkout deno.lock` / `npm ci`.
- [ ] **Step 2: Browser check** against local Supabase (migrations applied, functions served): Hub carousel pin + send, video moment + spot in the lightbox, phone width 375px composer sheet, approve-with-open-notes confirm; CRM conversation shows the notes, resolve/reopen, internal pin in the lightbox, replace prompt, approved flag. Screenshot each.
- [ ] **Step 3: Renumber migrations** if main's tail moved past `20261026000003`.
- [ ] **Step 4: Commit** — `git commit -m "docs: hub-media-notes deploy flag"`
- [ ] **Step 5: Deploy order note in the PR body**: staging then prod: `npx supabase db push --linked`; `npx supabase functions deploy hub-media-notes --no-verify-jwt --use-api`; `hub-posts`, `hub-post-history`, `hub-approve` (all `--no-verify-jwt`), `mcp`; only then merge.
