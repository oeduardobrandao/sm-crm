# Posts aguardando material — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The team asks a client for named items on a post; the client answers each item in Hub › Aprovações › Material; the request closes itself (or by "Enviei o que tenho") and notifies the team.

**Architecture:** Two service-role-only tables (`post_material_requests`, `post_material_items`) plus `post_references.material_item_id`, all writes through SECURITY DEFINER RPCs under the post row lock. The Hub reads requests through a new `GET /requests` on `hub-post-references` (never through `hub-posts`); the CRM reads and writes through new routes on `post-references`. Completion and its notification happen inside the upload RPC.

**Tech Stack:** Postgres (Supabase migrations, psql entitlement suites), Deno edge functions, React 19 + TanStack Query (Hub and CRM), i18next (`packages/i18n/locales/{pt,en}`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-posts-aguardando-material-design.md` (read it in full before any task; it carries the reasons this plan does not repeat).

## Global Constraints

- SQL suites: apply the migration to the local stack first (`npx supabase db reset`, local only; colima, see CLAUDE.md), then run one file with `psql "$DB" -v ON_ERROR_STOP=1 -f <file>` where `DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres`. `bash scripts/test-entitlements.sh` (no arguments) runs everything.

- One migration file: `supabase/migrations/<VERSION>_post_material_requests.sql`. Pick `<VERSION>` above main's highest prefix at the time you create it (today's tail is `20261120000001`, so start at `20261121000001`) and re-check before the PR (`migration-version-guard`).
- New tables: RLS on, `REVOKE ALL … FROM PUBLIC, anon, authenticated` (all three named), no policies, service role only.
- Every new RPC: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`, and takes `SELECT … FROM workflow_posts … FOR UPDATE` before reading request/item/reference state.
- Limits: ≤ 10 items per request; items + free-form references (`material_item_id IS NULL`) ≤ 10; label 1–120 chars after trim; detail ≤ 300 chars; the existing 10-reference cap and storage quota stay unchanged.
- Request statuses `aberto | concluido | cancelado`; `closed_by` `auto | client | team | system`, NULL iff `aberto`.
- Notification type `post_material_complete`, metadata `{ post_id, closed_by, done, total }`; in-app + push; no e-mail; no coalescing.
- Error codes (exact strings and HTTP status): `item_required` 409, `request_closed` 409, `nothing_sent` 409, `too_many_items` 409, `items_required` 400, `post_not_requestable` 409, `invalid_item` 400.
- UI copy is Portuguese, exact strings from the spec; no em-dashes in user-facing copy; every new string goes in both `pt` and `en` locale files.
- Hub drafts expose only `post_id, titulo, tipo, scheduled_at, platform, client_visible` + items. `hub-posts` is not touched.
- Edge functions never return raw error details; log internally, answer with the codes above.
- `useUnsavedWork` around CRM saves in flight; uploads already go through `trackUnsavedWork`.
- Before pushing: `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions` (CLAUDE.md "What CI actually runs").

## Review Focus

1. **Two uploads finishing the last two items at the same time** must produce exactly one `concluido` transition and one notification (the post lock serialises them; the second sees the request already closed only if it targets a closed request, otherwise it just adds a file). Test owned by Task 2.
2. **A post moved to another client** (`workflow_posts.cliente_id` changed) must vanish from the old client's `GET /requests` and refuse their uploads with 404. Test owned by Task 5.
3. **An upload aimed at a request that was cancelled meanwhile** (team switched it off, or the post became `agendado`) must answer `request_closed`, and the Hub must refetch requests and show "Este pedido foi encerrado pela equipe." instead of a generic error. Tests owned by Task 2 (RPC) and Task 8 (Hub).
4. **A post in `enviado_cliente` with an open request** appears in both the Posts and the Material sections; free-form uploads from the Referências tab keep working and never tick an item. Tests owned by Task 2 (RPC) and Task 7 (Hub list).
5. **CRM saving `open: true` with every item row empty or removed** must never reach the server as a zero-item open: the editor disables Save and shows "Adicione pelo menos um item."; the server still answers `items_required` if it does. Tests owned by Task 2 (RPC) and Task 10 (CRM).

---

### Task 1: Schema, integrity and access

**Files:**
- Create: `supabase/migrations/<VERSION>_post_material_requests.sql` (sections 1–2 of the file; later tasks append sections)
- Modify: `supabase/tests/entitlements/99_acesso_por_cliente_drift.sql:75` (add both tables to `v_exempt_no_policy` with a comment)
- Test: `supabase/tests/entitlements/99_post_material_requests.sql` (new; header comment listing sections (a)…(n) like `99_post_references.sql`)

**Interfaces:**
- Produces: tables `post_material_requests(id, post_id, conta_id, status, closed_by, closed_at, opened_by, opened_at, created_at, updated_at)`, `post_material_items(id, request_id, post_id, conta_id, label, detail, position, created_at, updated_at)`, column `post_references.material_item_id bigint NULL`. Unique keys `post_material_requests (post_id)`, `(id, post_id, conta_id)`; `post_material_items (id, post_id, conta_id)`.

- [ ] **Step 1: Write the failing SQL test, section (a) schema/ACL.** Reuse the `pg_temp.pr_env` helper pattern from `99_post_references.sql:23-36`. Assert:
  - `has_table_privilege('authenticated', 'post_material_requests', 'SELECT')` is false, same for `post_material_items`, same for `anon`.
  - inserting an item whose `(request_id, post_id, conta_id)` does not match its request fails with `foreign_key_violation`.
  - inserting a `post_references` row with `material_item_id` of an item on **another post** fails with `foreign_key_violation`.
  - deleting an item leaves its reference row with `material_item_id IS NULL` and `post_id`, `conta_id` unchanged.
  - deleting the post cascades both tables.
  - `status = 'aberto'` with non-null `closed_by` fails the CHECK; `status = 'concluido'` with NULL `closed_at` fails it.
- [ ] **Step 2: Run it and see it fail.** `supabase start` (colima, see memory) then `psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_material_requests.sql` → FAIL: relation does not exist.
- [ ] **Step 3: Write migration sections 1–2.** Columns, CHECKs and keys exactly as the spec's Data model tables. `post_references` FK: `FOREIGN KEY (material_item_id, post_id, conta_id) REFERENCES post_material_items(id, post_id, conta_id) ON DELETE SET NULL (material_item_id)`. `updated_at` triggers like `set_post_references_updated_at`. Indexes: `(conta_id, status)` on requests, `(request_id, position)` on items, `(material_item_id) WHERE material_item_id IS NOT NULL` on references. RLS enable + REVOKE per Global Constraints.
- [ ] **Step 4: Add the drift exemption** (`'post_material_requests', 'post_material_items'` with comment "pedido de material: só service role; edges aplicam o escopo via _shared/client-scope.ts").
- [ ] **Step 5: Run both suites.** `psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_material_requests.sql && psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_acesso_por_cliente_drift.sql && psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_references.sql` → PASS.
- [ ] **Step 6: Commit** `feat(material): tabelas do pedido de material e vínculo com referências`.

### Task 2: RPCs and status trigger

**Files:**
- Modify: `supabase/migrations/<VERSION>_post_material_requests.sql` (section 3)
- Test: `supabase/tests/entitlements/99_post_material_requests.sql` (sections (b)…(k))

**Interfaces:**
- Consumes: Task 1 tables.
- Produces (all return types exact):
  - `post_material_request_save(p_conta uuid, p_post bigint, p_user uuid, p_open boolean, p_items jsonb) RETURNS jsonb` → `{ id, status, closed_by, closed_at, opened_by, opened_at, items: [{id, label, detail, position, file_count}] }`. Raises `P0001` with messages `post_not_found`, `post_not_requestable`, `items_required`, `too_many_items`, `invalid_item`.
  - `post_reference_file_insert(p jsonb)` / `post_reference_link_insert(p jsonb)` accept `material_item_id`; new raises `item_required`, `request_closed`.
  - `post_material_client_close(p_conta uuid, p_cliente bigint, p_post bigint) RETURNS text` ∈ `ok | not_found | request_closed | nothing_sent`.
  - `post_reference_team_delete(p_conta uuid, p_ref_id bigint) RETURNS text` ∈ `ok | not_found`.
  - `post_reference_list(p_post_id bigint, p_conta uuid)` gains column `material_item_id bigint` (append last; DROP + CREATE + re-grant).
  - `post_material_requests_for(p_conta uuid, p_cliente bigint) RETURNS TABLE (post_id bigint, request jsonb)`: open requests whose post's `cliente_id = p_cliente` (request jsonb same shape as save, items with `done boolean`).
  - `post_material_summary(p_conta uuid, p_post_ids bigint[]) RETURNS TABLE (post_id bigint, status text, done int, total int)`.
  - internal helper `_post_material_complete_check(p_request_id bigint, p_notify boolean, p_closed_by text) RETURNS boolean` (true when it closed the request); not granted to anyone.
  - internal `create_post_material_notification(p_post bigint, p_closed_by text, p_done int, p_total int)` (body in Task 3).

- [ ] **Step 1: Write failing SQL tests**, one `do $$` block each:
  - (b) save: opens with 2 items → `status='aberto'`, positions 0,1, `opened_by = p_user`; second save with first id kept + one new + one dropped → dropped item's reference has `material_item_id IS NULL`; `p_open=false` → `cancelado/team`, items kept; reopen by another user rewrites `opened_by` and `opened_at`, clears `closed_*`.
  - (c) save errors: zero items open → `items_required`; 11 items → `too_many_items`; 8 items with 3 free-form refs → `too_many_items`; label `'   '` → `invalid_item`; 121-char label → `invalid_item`; post `agendado` → `post_not_requestable`.
  - (d) draft upload: `rascunho` post with open request, file insert without `material_item_id` → `item_required`; with an item of this post → ok; with an item of a cancelled request → `request_closed`.
  - (e) auto-complete: 2 items, upload to item 1 → still `aberto`, 0 notifications of the new type; upload to item 2 → `concluido/auto`, exactly 1 `post_material_complete` with metadata `done=2,total=2`; a further upload to item 1 → `request_closed`, still 1 notification. (Review Focus 1.)
  - (f) `enviado_cliente` post with open request: free-form upload (no item) → ok, request still `aberto`, item done counts unchanged. (Review Focus 4.)
  - (g) client close: zero done → `nothing_sent`; one of three done → `ok`, `concluido/client`, notification metadata `done=1,total=3`; second close → `request_closed`; wrong `p_cliente` → `not_found`.
  - (h) `can_remove`: item file on a `rascunho` post removable while `aberto`, not after `concluido`; `post_reference_client_update` follows the same answer.
  - (i) team delete: on a `concluido` request, deleting the only file of an item → request back to `aberto`, `closed_*` NULL, no new notification.
  - (j) status trigger: `aberto` request, post updated to `agendado` → `cancelado/system`; same for `postado`.
  - (k) team save removing the last missing item of an `aberto` request where the rest are done → `concluido/auto`, zero notifications; team save adding an item to a `concluido` request → `aberto`.
  - (l) `post_material_requests_for`: excludes `concluido`/`cancelado`, excludes posts of another client, includes a `rascunho` post; `post_material_summary` returns `done/total` for listed ids only.
- [ ] **Step 2: Run, see failures** (`psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_material_requests.sql` → FAIL: function does not exist).
- [ ] **Step 3: Implement section 3.** Notes the signatures don't determine:
  - `post_reference_file_insert` / `link_insert`: replace the whole bodies with `CREATE OR REPLACE` copies of `20261011000001_post_references.sql:357-443` / `445-484`; change the status gate to `v_status = 'enviado_cliente' OR v_req.status = 'aberto'`; when `v_status <> 'enviado_cliente'` and no `material_item_id` → `item_required`; validate the item by `(id, post_id, conta_id)` and its request `aberto`; after the reference insert call `_post_material_complete_check(v_req.id, true, 'auto')`.
  - `post_reference_can_remove`: OR a branch "`r.material_item_id IS NOT NULL` and the item's request is `aberto`".
  - `post_reference_team_delete`: lock, delete, then if the request was `concluido` and some item now has zero references, reopen (no notification).
  - Status trigger `AFTER UPDATE OF status ON workflow_posts WHEN (NEW.status IN ('agendado','postado') AND OLD.status IS DISTINCT FROM NEW.status)`.
- [ ] **Step 4: Run** `psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_material_requests.sql && psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_post_references.sql` → PASS (the old suite proves the redefined RPCs kept their behaviour).
- [ ] **Step 5: Commit** `feat(material): RPCs do pedido, conclusão automática e gatilho de status`.

### Task 3: Notification type, push lists

**Files:**
- Modify: `supabase/migrations/<VERSION>_post_material_requests.sql` (section 4)
- Modify: `supabase/functions/_shared/notification-render.ts:164` (new case)
- Test: `supabase/tests/entitlements/99_post_material_requests.sql` section (m); `supabase/functions/__tests__/notification-render_test.ts`

**Interfaces:**
- Consumes: Task 2 calls `create_post_material_notification`.
- Produces: type `post_material_complete` accepted by `notifications_type_check`, `notification_inapp_prefs_type_check`, `claim_notification_pushes`, `push_badge_counts`.

- [ ] **Step 1: Failing tests.** SQL (m): `create_post_material_notification` inserts one row per target with `cliente_id` set and metadata keys `post_id, closed_by, done, total`; a push claim (`claim_notification_pushes`) returns it. Deno: `renderNotification({ type: 'post_material_complete', metadata: { closed_by: 'auto', … } })` title/body contain "enviou todos os itens pedidos"; `closed_by: 'client', done: 1, total: 3` contains "enviou o que tinha (1 de 3 itens)".
- [ ] **Step 2: Run, see failures** (`deno test --no-check supabase/functions/__tests__/notification-render_test.ts`; SQL suite).
- [ ] **Step 3: Implement.** Copy each list/function from its latest definition (`grep -l <name> supabase/migrations/* | tail -1`; today the type checks live in `20261117000011_acesso_por_cliente_f_notificacoes.sql` and the push functions in `20261120000001_push_acesso_por_cliente.sql`) and only append the type. Targets/link/advisory lock: copy `create_post_reference_notification` (from its latest definition) minus the 15-minute coalescing filter.
- [ ] **Step 4: Run both** → PASS. Also `psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_push_notifications.sql && psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/73_notification_center.sql` → PASS.
- [ ] **Step 5: Commit** `feat(material): notificação post_material_complete (in-app e push)`.

### Task 4: Shared Deno contract

**Files:**
- Modify: `supabase/functions/_shared/post-references.ts` (`ReferenceErrorCode`, `REFERENCE_ERROR_STATUS` at :60-79, `mapReferenceRpcError` at :324, `ReferenceItem` + `toReferenceItem`, `finalizeReferenceFile`, `insertReferenceLink`)
- Create: `supabase/functions/_shared/material-requests.ts`
- Test: `supabase/functions/__tests__/post-references-shared_test.ts`, `supabase/functions/__tests__/material-requests_test.ts` (new)

**Interfaces:**
- Consumes: Task 2 RPC names and shapes.
- Produces:
  - `ReferenceItem.material_item_id: number | null`.
  - `finalizeReferenceFile` / `insertReferenceLink` read optional `input.material_item_id` (validated with `parsePositiveId`; invalid → `invalid_item`) and pass it to the RPC.
  - `material-requests.ts`:
    - `interface MaterialItemDTO { id: number; label: string; detail: string | null; position: number; done: boolean; file_count: number }`
    - `interface MaterialRequestDTO { id: number; post_id: number; status: 'aberto' | 'concluido' | 'cancelado'; closed_by: 'auto' | 'client' | 'team' | 'system' | null; closed_at: string | null; opened_by: string | null; opened_at: string; items: MaterialItemDTO[] }`
    - `normalizeMaterialItems(raw: unknown): { ok: true; items: { id?: number; label: string; detail: string | null }[] } | { ok: false; code: 'invalid_item' | 'too_many_items' }`
    - `saveMaterialRequest(db, a: { conta_id: string; post_id: number; user_id: string; open: boolean; items: … }): Promise<{ ok: true; request: MaterialRequestDTO } | { ok: false; result: ReferenceResult }>`
    - `loadOpenRequestsForClient(db, conta_id: string, cliente_id: number): Promise<Map<number, MaterialRequestDTO>>`
    - `loadMaterialSummary(db, conta_id: string, post_ids: number[]): Promise<{ post_id: number; status: string; done: number; total: number }[]>`

- [ ] **Step 1: Failing tests.** For each of the seven codes: `referenceError(code).status` equals the Global Constraints status; `mapReferenceRpcError({ message: 'item_required' })` → 409 `item_required` (same for every RPC-raised code); `normalizeMaterialItems` rejects 11 items (`too_many_items`), blank label and 121 chars (`invalid_item`), trims labels, turns `''` detail into `null`, rejects non-array.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/post-references-shared_test.ts supabase/functions/__tests__/material-requests_test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run check:functions` → clean.
- [ ] **Step 5: Commit** `feat(material): contrato compartilhado de erros e pedidos`.

### Task 5: `hub-post-references` routes

**Files:**
- Modify: `supabase/functions/hub-post-references/handler.ts`
- Test: `supabase/functions/__tests__/hub-post-references_test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces (HTTP):
  - `GET /requests?token=` → `{ requests: [{ post_id, titulo, tipo, scheduled_at, platform, client_visible, request: MaterialRequestDTO, files_by_item: Record<number, ReferenceItem[]> }] }`, ordered `scheduled_at` asc nulls last, then `opened_at`.
  - `GET ?post_id` → adds `request: MaterialRequestDTO | null`; items carry `material_item_id`.
  - `POST /upload-url|files|links` accept `material_item_id`.
  - `POST /requests/:postId/close` → `{ ok: true }` or error codes.

- [ ] **Step 1: Failing tests** (mock db like the existing file):
  - `/requests` response objects have exactly the keys above (assert `Object.keys` sorted), no `ig_caption`, `conteudo`, `media`.
  - `client_visible` true for `enviado_cliente`, false for a never-sent `rascunho` (uses `isHubVisiblePost` + `computeEmProducaoByPost` from `hub-posts/em-producao.ts`).
  - a post whose `cliente_id` differs from the token is absent from `/requests` and its upload answers 404. (Review Focus 2.)
  - `/requests` debits `hub-read:`; `/close` debits `hub-write:hub-post-references:`.
  - `/files` on a `rascunho` post with open request passes the handler gate and forwards `material_item_id`; on a `rascunho` without request → 409 `post_not_pending`.
  - close outcomes `nothing_sent`, `request_closed` → 409 with that code; `not_found` → 404.
  - after a successful item upload the handler still calls `create_post_reference_notification`.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/hub-post-references_test.ts` → FAIL.
- [ ] **Step 3: Implement.** Routes join `resolveRoute`; `GET /requests` = `loadOpenRequestsForClient` + one `workflow_posts` select of the listed ids (`id, titulo, tipo, scheduled_at, platform, status`, filtered by `cliente_id`/`conta_id`) + one `post_status_events` select for `client_visible` + one `post_reference_list` per post with an open request (bounded by open requests; fine). Handler gate becomes `owned.status === 'enviado_cliente' || request?.status === 'aberto'`.
- [ ] **Step 4: Run** → PASS; `npm run check:functions` → clean.
- [ ] **Step 5: Commit** `feat(material): rotas do Hub para pedidos de material`.

### Task 6: `post-references` (CRM) routes

**Files:**
- Modify: `supabase/functions/post-references/handler.ts` (CORS at :42, routes, DELETE path at :93-137)
- Test: `supabase/functions/__tests__/post-references_test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces (HTTP, JWT):
  - `GET ?post_id` → adds `request: (MaterialRequestDTO & { opened_by_name: string | null }) | null`.
  - `PUT /requests/:postId` body `{ open: boolean, items: [{ id?, label, detail? }] }` → 200 `{ request }`; 400 bad body / `invalid_item` / `items_required`; 403 `forbidden`; 404; 409 state codes.
  - `GET /requests/summary?post_ids=1,2` (≤ 200) → `{ summary: [{ post_id, status, done, total }] }`.
  - `DELETE /:id` → calls `post_reference_team_delete`.

- [ ] **Step 1: Failing tests:** OPTIONS answers `Access-Control-Allow-Methods` containing `PUT`; PUT without `entregas:editar` → 403; PUT by an own-only member on their own post → 403 (`rowVisibility` !== full); PUT happy path returns `request.items`; `post_ids` with 201 ids → 400; summary drops ids outside the caller's scope; DELETE calls the RPC (not `from('post_references').delete()`).
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/post-references_test.ts` → FAIL.
- [ ] **Step 3: Implement.** `opened_by_name` from `profiles`/`membros` the way other CRM routes resolve a user name (grep `nome` lookups in `post-references` or `_shared`); keep 404-not-403 for out-of-scope posts as today.
- [ ] **Step 4: Run** → PASS; `npm run check:functions`.
- [ ] **Step 5: Commit** `feat(material): rotas do CRM (PUT do pedido, resumo, delete sob lock)`.

### Task 7: Hub data layer, badge and Aprovações Material section

**Files:**
- Modify: `apps/hub/src/services/postReferences.ts` (`ERROR_CODES` at :45, `ReferenceItem` type, `uploadPostReference`/`addPostReferenceLink` opts gain `materialItemId?: number`)
- Create: `apps/hub/src/services/materialRequests.ts`
- Modify: `apps/hub/src/queries.ts` (new query), `apps/hub/src/hooks/usePendingApprovalsCount.ts`, `apps/hub/src/pages/AprovacoesPage.tsx`
- Create: `apps/hub/src/pages/aprovacoes/MaterialTab.tsx`, `apps/hub/src/pages/aprovacoes/MaterialTile.tsx`
- Modify: `packages/i18n/locales/{pt,en}/hubLinha.json` (pill label `abas.material`), new `packages/i18n/locales/{pt,en}/hubMaterial.json` (register the namespace where the others are registered)
- Test: `apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx`, `apps/hub/src/pages/aprovacoes/__tests__/materialTab.test.tsx` (new), `apps/hub/src/shell/__tests__/HubSidebar.test.tsx`

**Interfaces:**
- Consumes: Task 5 HTTP shapes.
- Produces:
  - `fetchMaterialRequests(token: string): Promise<HubMaterialRequest[]>` and `closeMaterialRequest(token: string, postId: number): Promise<void>` (throws `PostReferenceError` with the code).
  - `type HubMaterialRequest = { post_id: number; titulo: string; tipo: string; scheduled_at: string | null; platform: string | null; client_visible: boolean; request: MaterialRequestDTO; files_by_item: Record<number, ReferenceItem[]> }` (mirror the Deno DTO in `services/materialRequests.ts`).
  - `HUB_MATERIAL_KEY = 'hub-material'`, `hubMaterialRequestsQuery(token)` (staleTime 30 s).
  - `usePendingApprovalsCount` returns posts + linhas + open requests.

- [ ] **Step 1: Failing tests:**
  - sidebar badge = 2 pending posts + 3 requests → `5`.
  - Aprovações with flag linha off and 2 requests shows pills "Posts · N" and "Material · 2"; with zero requests and flag off shows no tab bar (today's behaviour).
  - `?aba=material` renders `MaterialTab`; header reads "2 posts esperando sua aprovação e 3 pedidos de material."; with zero pending posts reads "3 pedidos de material." (pick the exact pt strings, singular forms included, in `hubMaterial.json`).
  - tile shows "1 de 3 itens enviados", progressbar `aria-valuenow=1 aria-valuemax=3`, done items with `line-through` and the "Aguardando material" pill.
  - a post in `enviado_cliente` with an open request appears in both Posts and Material. (Review Focus 4.)
- [ ] **Step 2: Run** `npx vitest run apps/hub/src/pages apps/hub/src/shell` → FAIL.
- [ ] **Step 3: Implement.** Pills use `FILTER_PILL_CLASS` / `filterPillStyle`; tab bar shows when ≥ 2 pills would show. Tiles follow `Main.dc.html` in the canvas (classic look); pauta look gets the same component through its existing pill styling.
- [ ] **Step 4: Run** → PASS; `npx tsc -p apps/hub/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** `feat(hub): seção Material em Aprovações e badge`.

### Task 8: Hub request dialog and `PostDetailDialog` notice

**Files:**
- Create: `apps/hub/src/components/material/MaterialRequestDialog.tsx`, `apps/hub/src/components/material/MaterialItemRow.tsx`
- Modify: `apps/hub/src/hooks/usePostReferences.ts` (`addFiles`/link methods accept `materialItemId`), `apps/hub/src/components/posts/references/referenceErrors.ts` (copy for the new codes), `apps/hub/src/components/posts/PostDetailDialog.tsx` (notice above tabs at ~:468; item name on reference tiles), `apps/hub/src/pages/aprovacoes/MaterialTab.tsx` (opens the dialog)
- Test: `apps/hub/src/components/material/__tests__/MaterialRequestDialog.test.tsx` (new), `apps/hub/src/components/posts/references/__tests__/referenceErrors.test.ts`

**Interfaces:**
- Consumes: Task 7 query + services; `usePostReferences(token, postId)`.
- Produces: `<MaterialRequestDialog token={string} entry={HubMaterialRequest} open onOpenChange />`.

- [ ] **Step 1: Failing tests:**
  - each item row has an "Enviar" button; choosing a file calls `uploadPostReference` with `materialItemId` of that row.
  - "Enviei o que tenho" is disabled with zero done; with one done, clicking opens a confirm; confirming calls `closeMaterialRequest` and invalidates `hub-material`, `hub-post-references/<id>` and the badge.
  - "Histórico e comentários" tab exists when `client_visible`, absent otherwise; drafts show "Este post ainda está em produção".
  - an upload failing with `request_closed` shows "Este pedido foi encerrado pela equipe." and refetches requests. (Review Focus 3.)
  - `referenceErrors` returns pt copy for all seven codes (no generic fallback).
  - `PostDetailDialog` with an open request for its post shows "A equipe pediu material para este post · Ver itens".
- [ ] **Step 2: Run** `npx vitest run apps/hub/src/components` → FAIL.
- [ ] **Step 3: Implement** following `HubChecklistC.dc.html` / `HubPhone.dc.html` from the canvas. Reuse `ReferencePicker`, `ReferenceLinkForm`, `ReferenceTiles`; footer copy "Quando os {{n}} itens tiverem arquivo, a equipe é avisada. Não tem algum?"; limits line "Fotos e PDFs até 25 MB, vídeos até 200 MB."; at the 10-file cap disable "Enviar" with "Este post chegou ao limite de 10 arquivos. Envie o resto como link ou toque em Enviei o que tenho."
- [ ] **Step 4: Run** → PASS; hub `tsc`.
- [ ] **Step 5: Commit** `feat(hub): diálogo de itens pedidos`.

### Task 9: Hub Home banner

**Files:**
- Modify: `apps/hub/src/pages/HomePage.tsx`, `apps/hub/src/pages/HomePagePauta.tsx`, `packages/i18n/locales/{pt,en}/hubHome.json`
- Test: `apps/hub/src/pages/__tests__/homeCalendarRange.test.tsx` (or a new `homeMaterial.test.tsx`), `apps/hub/src/pages/__tests__/homePauta.test.tsx`

**Interfaces:** Consumes `hubMaterialRequestsQuery`.

- [ ] **Step 1: Failing tests:** 3 requests with 5 missing items → "A equipe está esperando 5 itens seus em 3 posts", link to `aprovacoes?aba=material`; 1/1 → "A equipe está esperando 1 item seu em 1 post"; zero → no banner. Same in pauta.
- [ ] **Step 2: Run** `npx vitest run apps/hub/src/pages/__tests__/home*` → FAIL.
- [ ] **Step 3: Implement** under the approvals banner (`HubHome.dc.html`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(hub): aviso de material no Início`.

### Task 10: CRM editor section

**Files:**
- Modify: `apps/crm/src/store/postReferences.ts` (`callPostReferences` method union → `'GET' | 'DELETE' | 'PUT'` with optional JSON body; `ReferenceItem.material_item_id`; new `saveMaterialRequest(postId, body)`, `getMaterialSummary(postIds)`, types mirroring Task 6)
- Create: `apps/crm/src/pages/entregas/components/references/MaterialRequestEditor.tsx`
- Modify: `apps/crm/src/pages/entregas/components/references/PostClientReferences.tsx` (always render for `can('entregas','editar')`; mount the editor; item name on tiles), `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (header badge), `packages/i18n/locales/{pt,en}/postPanels.json`
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostClientReferences.test.tsx`, new `MaterialRequestEditor.test.tsx` beside it

**Interfaces:**
- Consumes: Task 6 HTTP.
- Produces: `saveMaterialRequest(postId: number, body: { open: boolean; items: { id?: number; label: string; detail?: string | null }[] }): Promise<CrmMaterialRequest>`, `getMaterialSummary(postIds: number[]): Promise<MaterialSummaryRow[]>`, query keys `['post-material', postId]` and `['post-material-summary', workflowId]`.

- [ ] **Step 1: Failing tests:**
  - with `entregas:editar` and no references and no request the section renders the switch "Pedir material ao cliente" off.
  - toggling on shows one empty item row and Save disabled with "Adicione pelo menos um item."; typing a label enables Save; Save calls `saveMaterialRequest(postId, { open: true, items: [{ label: 'Foto', detail: null }] })`. (Review Focus 5.)
  - "Adicionar item" hidden when items + free-form references reach 10.
  - rows show "1 arquivo" / "Falta" badges from `file_count`; header "Itens pedidos · 1 de 3 com arquivo"; footer "Pedido por Ana em 06/11".
  - without `entregas:editar` and no request: nothing renders; with a request: read-only (no inputs).
  - a save in flight registers `useUnsavedWork(true)`.
  - editor header badge: "Aguardando material" (warning) when `aberto`; "Material recebido" (success) when `concluido` and post `rascunho`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/components` → FAIL.
- [ ] **Step 3: Implement** after `CrmEditor.dc.html`; drag reorder with whatever the drawer already uses for sortable lists (grep `@dnd-kit` in `pages/entregas`); explicit Save button (my call: avoids autosaving half-typed items to the client).
- [ ] **Step 4: Run** → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** `feat(crm): pedir material ao cliente no editor do post`.

### Task 11: CRM card badges, filter, notification

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:505-520` (summary query next to `post-reference-counts`, badge on the collapsed row), `apps/crm/src/pages/entregas/views/PostsListView.tsx` and the kanban card component it shares (badge), `apps/crm/src/pages/entregas/components/EntregasFilters.tsx` (`FilterState.filterMaterial: ('aguardando' | 'recebido')[]`, posts mode only, counted in `countActiveFilters`), the filtering function that reads `postStageOf` in `apps/crm/src/pages/entregas/EntregasPage.tsx`, `apps/crm/src/lib/notification-catalog.ts:72` + `notification-config.ts`, `packages/i18n/locales/{pt,en}/entregas.json` and the notifications namespace
- Test: `apps/crm/src/lib/__tests__/notification-config.post-material-complete.test.ts` (new, copy the `post-client-reference` one), existing `EntregasFilters`/`PostsListView` tests

**Interfaces:** Consumes `getMaterialSummary` (Task 10).

- [ ] **Step 1: Failing tests:** badge "Material · 1 de 3 itens" for `aberto`; "Material recebido · 3 de 3 itens" for `concluido` on an internal-status post; none for `concluido` on `enviado_cliente` or `cancelado`; filter "Aguardando material" keeps only `aberto` posts and adds 1 to the active count; notification renders both copies with the post link.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas apps/crm/src/lib` → FAIL.
- [ ] **Step 3: Implement.** One summary request per list (ids chunked by 200), never per card.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(crm): selos, filtro e notificação de material`.

### Task 12: Full gate and rollout notes

**Files:**
- Modify: `CLAUDE.md` (one Gotchas bullet: tables, deploy order, "service role only; Hub reads via GET /requests")

- [ ] **Step 1: Run the CI set:** `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`, `bash scripts/test-entitlements.sh` → all green. Grep both `__tests__` trees for reference list fixtures missing `material_item_id` and fix them.
- [ ] **Step 2: Browser check** (CRM + Hub against local or staging, see memory on seed login and Hub port 5175): open a request on a draft, see it in Hub Aprovações › Material, upload to each item, see the CRM notification and the badge flip to "Material recebido".
- [ ] **Step 3: Add the CLAUDE.md bullet** with the deploy order: migration → `hub-post-references` (`--no-verify-jwt`) + `post-references` + `notification-push-cron` → merge.
- [ ] **Step 4: Commit** `docs: pedido de material no CLAUDE.md`.
