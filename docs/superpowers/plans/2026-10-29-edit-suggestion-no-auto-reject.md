# Edit suggestions survive team edits: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team edit never silently discards a client's Hub edit suggestion. Edits to different fields combine, and a same-field clash is decided by a person in the CRM.

**Architecture:** The auto-reject trigger is replaced by one that only closes a suggestion on publication. `original_*` becomes a per-field base the Hub supplies on first touch, so conflicts are computed at read time (live ≠ base). Accept applies only the fields the caller names and refuses to guess on conflict. The CRM review card shows per-field state, a choice dialog on conflict, and guards before status moves.

**Tech Stack:** Postgres (plpgsql, SQL entitlement suites via psql), Deno edge function, React 19 + TanStack Query (CRM, Hub), Vitest, i18next (`packages/i18n`, pt + en).

**Spec:** `docs/superpowers/specs/2026-10-29-edit-suggestion-no-auto-reject-design.md` (APPROVED v3). Mockups: https://claude.ai/artifact/MEBmjJBNoriqTfTu9bDqyo

## Global Constraints

- All user-facing copy pt-BR, with an `en` twin in `packages/i18n/locales/en/*`. No em dashes in UI copy.
- Logical fields: `texto` = `conteudo` + `conteudo_plain`; `legenda` = `ig_caption`. `changed_fields` keeps storing `conteudo`, `conteudo_plain`, `ig_caption`.
- texto changed = `COALESCE(plain,'')` differs OR `conteudo` jsonb `IS DISTINCT FROM` (jsonb, never `::text`). texto conflict = `COALESCE(plain,'')` differs OR inline-image key set differs. legenda: `COALESCE(x,'')` both ways.
- Lock order in every writer: `workflow_posts` row, then `post_edit_suggestions` row.
- `accept_edit_suggestion` and `reject_edit_suggestion` keep the workspace check from migration `20261105000003` (PR #771): `Suggestion not found` unless `auth.role() = 'service_role'` or `conta_id = get_my_conta_id()`.
- Error codes (P0001 messages): `post_not_pending`, `suggestion_changed`, `suggestion_conflict`, `no_fields`, `base_required`.
- Migration version prefixes unique and above main's tail; the hotfix holds `20261105000003`. Use `20261106000001`..`20261106000003`; renumber before opening the PR if main moved.
- Deploy order (spec): migrations → `hub-edit-suggestion` → merge. The three migrations go out in ONE `db push`, never `…0001` alone: without the trigger and before the new accept, the old accept writes `ig_caption` unconditionally. Nothing is applied to staging or prod by the implementer.
- The legacy path (`p_touched_fields` NULL) keeps today's `::text` jsonb compare on purpose (it must behave exactly as today); the jsonb rule above is for the new path only.
- Name the field type `SuggestionField = 'texto' | 'legenda'` everywhere (Hub `types.ts`, CRM `store/posts.ts`, Deno handler literal).

---

### Task 0: Base the branch on the hotfix

- [ ] **Step 1:** If PR #771 is merged, rebase this branch onto `origin/main`. If not, cherry-pick its commit (`git log origin/claude/fix-edit-suggestion-rpc-tenant-check -1`) so `supabase/migrations/20261105000003_edit_suggestion_rpcs_workspace_check.sql` and suite `101_edit_suggestion_rpcs_workspace_check.sql` exist here; drop the cherry-pick at rebase time once #771 lands.
- [ ] **Step 2:** `ls supabase/migrations | tail -3` shows `20261105000003_…` and nothing at or above `20261106000001`; otherwise renumber this plan's migrations above the tail.
- Never use `useBlocker`. Dialogs use the existing shadcn `AlertDialog`/`Dialog` primitives.

## Review Focus

1. A Hub tab open across a team caption edit, client then edits the caption: accept must report a caption conflict, never apply silently (Task 2 test 103.4, Task 5 CorrectionPanel test).
2. A suggestion with NULL `suggested_conteudo` (caption-only Story suggestion) accepted with texto in `p_fields`: live `conteudo` stays, no mention wipe (Task 3 test 104.6, Task 7 drawer test).
3. A post that carries a `custom_status_id` and is then published (`status := 'postado'`, the z1 trigger clears the pointer) closes the suggestion as `superseded` (Task 1 test 102.5). Custom statuses can never behave as `postado` (`20260805000001_post_status_definitions.sql:21-24`).
4. A legacy (no `touched_fields`) save after a team caption edit produces a conflict at accept, not a silent overwrite (Task 2 test 103.6).
5. Accept from the old CRM (two args) on a conflicting suggestion raises `suggestion_conflict` and changes nothing (Task 3 test 104.3).

---

### Task 1: Trigger, `superseded` status, backfill

**Files:**
- Create: `supabase/migrations/20261106000001_edit_suggestion_superseded_trigger.sql`
- Create: `supabase/tests/entitlements/102_edit_suggestion_trigger.sql`

**Interfaces:**
- Produces: `post_edit_suggestions.status` ∈ `pending | accepted | rejected | superseded`; trigger `trg_close_suggestion_on_publish` (AFTER UPDATE OF status, custom_status_id ON workflow_posts) calling `close_suggestion_on_publish()`.

- [ ] **Step 1: Write the failing suite `102_edit_suggestion_trigger.sql`** (pattern: `101_edit_suggestion_rpcs_workspace_check.sql` from PR #771, `et_make_workspace`, begin/rollback per case). Cases, each asserting the pending row's `status` afterwards:
  - 102.1 `update workflow_posts set ig_caption = 'nova'` → still `pending`.
  - 102.2 `update ... set conteudo_plain = 'x', conteudo = '{"type":"doc"}'` → still `pending`.
  - 102.3 `update ... set status = 'revisao_interna'` then `'agendado'` → still `pending`.
  - 102.4 `update ... set status = 'postado'` → `superseded`, `reviewed_by` NULL, `reviewed_at` not NULL.
  - 102.5 post with a `custom_status_id` pointing at a `post_status_definitions` row (`behaves_as = 'aprovado_cliente'`), then `update ... set status = 'postado'` → `superseded` and `custom_status_id` cleared by z1.
  - 102.6 backfill: the migration's UPDATE has already run when the suite runs, so insert `status='rejected', reviewed_by=NULL` and `status='rejected', reviewed_by=<user>` and run the backfill statement copied verbatim from the migration; assert the first → `superseded`, the second stays `rejected`.
- [ ] **Step 2: Run it, expect FAIL** (102.1 fails: today's trigger rejects). Local stack per `reference_local_supabase_colima` memory: worktree under `~`, port overrides, then
  `psql postgresql://postgres:postgres@127.0.0.1:54722/postgres -q -f supabase/tests/entitlements/102_edit_suggestion_trigger.sql`
- [ ] **Step 3: Write the migration.** Drop `CHECK` and re-add with `superseded`; `drop trigger auto_reject_pending_suggestion on workflow_posts; drop function trg_auto_reject_pending_suggestion();`; create `close_suggestion_on_publish()` (SECURITY DEFINER, `search_path = public`, returns trigger) that, when `NEW.status = 'postado' AND OLD.status IS DISTINCT FROM 'postado'` and `app.accepting_edit_suggestion` is unset, sets pending rows of `NEW.id` to `superseded`, `reviewed_at = now()`; `AFTER UPDATE OF status ... FOR EACH ROW` (AFTER, so it reads `NEW.status` after z1's reconcile; `custom_status_id` is not needed in the OF list because no custom status behaves as `postado`). The header also records that `record_client_approval`'s comment about the auto-reject trigger (`20260928150001` §3b) is stale; do not re-create that function. Add `close_suggestion_on_publish()` to suite 96's allowlist to pin the revokes. Backfill `update post_edit_suggestions set status = 'superseded' where status = 'rejected' and reviewed_by is null;`. Revoke EXECUTE on the trigger function from `public, anon, authenticated`. Do not edit the applied migration `20260923000004`; note in this migration's header that `original_*` now means per-field base.
- [ ] **Step 4: Run suite 102 and suites 95, 96, 101 → all PASS.**
- [ ] **Step 5: Commit** `feat(sugestoes): trigger só fecha sugestão na publicação; status superseded`.

### Task 2: `upsert_edit_suggestion` with touched fields and bases

**Files:**
- Create: `supabase/migrations/20261106000002_edit_suggestion_upsert_bases.sql`
- Create: `supabase/tests/entitlements/103_edit_suggestion_upsert_bases.sql`
- Modify: `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql:51` (signature pin)

**Interfaces:**
- Produces: `upsert_edit_suggestion(p_post_id bigint, p_conta_id uuid, p_token text, p_suggested_conteudo jsonb, p_suggested_conteudo_plain text, p_suggested_ig_caption text, p_touched_fields text[] DEFAULT NULL, p_bases jsonb DEFAULT NULL) RETURNS jsonb` (same return shape as today). `p_touched_fields` values: `'texto'`, `'legenda'`. `p_bases` keys: `conteudo`, `conteudo_plain`, `ig_caption`.
- Produces: `_tiptap_inline_image_keys(jsonb) RETURNS text[]` (sorted, distinct; `IMMUTABLE`; r2Key of every node with `type = 'inlineImage'`, mirrors `extractR2Keys` in `hub-edit-suggestion/handler.ts`). Task 3 uses it.

- [ ] **Step 1: Write the failing suite `103_...sql`** (call the RPC directly as postgres, it is service_role-only). Post starts `enviado_cliente`, `conteudo_plain='T0'`, `ig_caption='L0'`.
  - 103.1 new row, touched `{texto}`, bases `{conteudo_plain:'T0', conteudo:<doc>, ig_caption:'L0'}`, suggested texto `'T1'`, caption `'L0'` → `changed_fields` has `conteudo_plain`, not `ig_caption`; `original_conteudo_plain='T0'`.
  - 103.2 the 11807 shape: after 103.1, `update workflow_posts set ig_caption='L-team'`; second save touched `{texto}` with suggested texto `'T2'`, caption `'L0'` (stale) → `ig_caption` NOT in changed_fields, `suggested_ig_caption='L-team'`, `original_ig_caption='L-team'`.
  - 103.3 touched field, first touch without the base KEY → raises `base_required`; with the key present and value `null` (Story post, `conteudo` NULL) → accepted. Presence is tested with `p_bases ? 'conteudo_plain'` / `? 'ig_caption'`, never non-null.
  - 103.4 stale-panel (Review Focus 1): text-only pending, team sets caption `'L-team'`, save touched `{legenda}` with base `ig_caption:'L0'` and suggested `'L-cliente'` → `original_ig_caption='L0'`, `ig_caption` in changed_fields (Task 3 then sees a conflict).
  - 103.5a partial revert: texto AND legenda pending, team edits texto to `'T-team'`, client saves touched `{texto}` with suggested texto equal to stored `original_conteudo_plain` → row survives (legenda), texto drops out of changed_fields, `original_conteudo_plain = suggested_conteudo_plain = 'T-team'`.
  - 103.5b full revert: texto-only pending, client reverts texto → `action='deleted'`, no pending row.
  - 103.6 legacy (Review Focus 4): first a texto-only pending row from a new-path save, then the team sets caption `'L-team'`, then a legacy save (`p_touched_fields` NULL) carrying caption `'L0'` → `ig_caption` in changed_fields and `original_ig_caption` still `'L0'` (first-save snapshot), so Task 3 sees a conflict. (On a brand-new legacy row `original_*` = live, as today; deploy-window only.)
  - 103.7 formatting-only texto change (same plain, different jsonb) with touched `{texto}` → `conteudo` in changed_fields, row kept.
  - 103.8 `post_not_pending` still raised when status ≠ `enviado_cliente`.
- [ ] **Step 2: Run, expect FAIL** (function signature does not exist).
- [ ] **Step 3: Write the migration.** `drop function upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text);` then create the 8-arg version implementing spec §1 for non-NULL `p_touched_fields` and today's body (from `20260928150001` §3a) for NULL. Keep `FOR UPDATE` on the post and the `post_not_pending` check. Grants: `revoke all ... from public, anon, authenticated; grant execute ... to service_role;`. Add `_tiptap_inline_image_keys` (non-STRICT, returns `'{}'` for NULL; jsonpath `lax $.** ? (@.type == "inlineImage" && @.attrs.r2Key != null).attrs.r2Key` or a recursive walk); callers compare its results with `IS DISTINCT FROM`, since rows with NULL jsonb on both sides exist (95.5, 101.2).
- [ ] **Step 4: Update the 96 pin** to `'public.upsert_edit_suggestion(bigint, uuid, text, jsonb, text, text, text[], jsonb)'`. Run 103, 96, 95, 102 → PASS.
- [ ] **Step 5: Commit** `feat(sugestoes): upsert mede mudanças por campo contra a base enviada pelo Hub`.

### Task 3: `accept_edit_suggestion` with `p_fields` and conflicts

**Files:**
- Create: `supabase/migrations/20261106000003_edit_suggestion_accept_fields.sql`
- Create: `supabase/tests/entitlements/104_edit_suggestion_accept_fields.sql`
- Modify: `supabase/tests/entitlements/95_post_content_versions_coalescing.sql:227` only if the call no longer resolves (it should: defaults).

**Interfaces:**
- Consumes: `_tiptap_inline_image_keys(jsonb)` (Task 2).
- Produces: `accept_edit_suggestion(p_suggestion_id bigint, p_expected_updated_at timestamptz DEFAULT NULL, p_fields text[] DEFAULT NULL) RETURNS void`, values in `p_fields`: `'texto'`, `'legenda'`. Grants: `authenticated, service_role`; revoked from `public, anon`.

- [ ] **Step 1: Write the failing suite `104_...sql`**, run as `authenticated` with `et_grant_hosted_parity()` (pattern of 101):
  - 104.1 no conflict, `p_fields` NULL, texto-only suggestion after a team caption edit → post has client texto + team caption (the 11807 regression).
  - 104.2 conflict on legenda, `p_fields = {texto}` → texto applied, caption stays team's, suggestion `accepted`.
  - 104.3 conflict, `p_fields` NULL → raises `suggestion_conflict`, post and suggestion unchanged (Review Focus 5).
  - 104.4 conflict, `p_fields = {texto, legenda}` → client caption applied.
  - 104.5 `p_fields = {legenda}` on a texto-only suggestion → raises `no_fields`.
  - 104.6 NULL `suggested_conteudo`, `p_fields = {texto}` → `conteudo` unchanged (COALESCE), `conteudo_plain` applied (Review Focus 2).
  - 104.7 team adds an inline image to texto (same plain) → texto counts as conflict; team bolds a word only (jsonb differs, same plain and keys) → not a conflict.
  - 104.8 other workspace → `Suggestion not found` (kept from #771).
  - 104.9 `suggestion_changed` still raised on stale `p_expected_updated_at`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Write the migration.** `drop function accept_edit_suggestion(bigint, timestamptz);` create the 3-arg version: #771's body (workspace check, lock order, `suggestion_changed`, `app.*` settings) plus: compute changed logical fields from `changed_fields`; conflict per Global Constraints against live; resolve the apply set; update only those columns (texto: `conteudo = coalesce(suggested_conteudo, conteudo), conteudo_plain = coalesce(suggested_conteudo_plain, conteudo_plain)`; legenda: `ig_caption = suggested_ig_caption`). Restate grants.
- [ ] **Step 4: Run 104, 101, 95, 96, 102, 103 → PASS.**
- [ ] **Step 5: Commit** `feat(sugestoes): aceitar aplica só os campos escolhidos e recusa conflito sem escolha`.

### Task 4: `hub-edit-suggestion` forwards touched fields and bases

**Files:**
- Modify: `supabase/functions/hub-edit-suggestion/handler.ts:57-140`
- Test: `supabase/functions/__tests__/hub-functions_test.ts` (section `// hub-edit-suggestion`, line ~3434)

**Interfaces:**
- Consumes: Task 2's RPC.
- Produces: request body accepts optional `touched_fields: SuggestionField[]` and `bases: { conteudo?: object|null; conteudo_plain?: string|null; ig_caption?: string|null } | null`; forwarded as `p_touched_fields` / `p_bases` (omitted when absent, so old Hubs hit the legacy path). `bases.conteudo` gets the same treatment as `suggested_conteudo`: `contas/<conta>/` prefix check and `stripSignedUrls` (hub-posts injects signed `src` into the `post.conteudo` the Hub fetched, `hub-posts/handler.ts:567-570`; unstripped, the jsonb compare never matches). New 400 `"Campos inválidos."` for any other value in `touched_fields`; `base_required` from the RPC maps to 400 `"Erro ao salvar sugestão."` and is logged.

- [ ] **Step 1: Write failing Deno tests** in the existing section (`supabase/functions/__tests__/hub-functions_test.ts` ~3434), using the file's fake db: (a) body with `touched_fields:['texto'], bases:{...}` → rpc called with `p_touched_fields:['texto']` and `p_bases` equal; (b) body without them → rpc params have no `p_touched_fields` key; (c) `touched_fields:['outro']` → 400; (d) `touched_fields:['legenda']` with a `suggested_conteudo` carrying an image key (with the `contas/<conta>/` prefix) missing from live `post.conteudo` → NOT 400, rpc called; (e) `bases.conteudo` with `attrs.src` on an inline image → forwarded `p_bases.conteudo` has no `src`.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/hub-functions_test.ts --filter hub-edit-suggestion` → FAIL.
- [ ] **Step 3: Implement** in the handler: parse/validate, run `hasNewInlineImages` only when `touched_fields` is absent or includes `'texto'`, pass the two params. Update the comment in `hub-approve/handler.ts:251-256` that cites the auto-reject trigger.
- [ ] **Step 4: Run the filter again → PASS; then `npm run check:functions`.**
- [ ] **Step 5: Commit** `feat(hub-edit-suggestion): repassa campos tocados e bases`.

### Task 5: Hub sends touched fields and bases, seeds from live

**Files:**
- Modify: `apps/hub/src/api.ts:186-197`, `apps/hub/src/hooks/useEditSuggestion.ts` (Payload type ~line 137, `saveSuggestion` ~333, drafts ~172-186), `apps/hub/src/lib/postView.ts:178-184`, `apps/hub/src/components/posts/CorrectionPanel.tsx:295-312`, `apps/hub/src/components/PostCard.tsx:419`
- Test: `apps/hub/src/__tests__/api.test.ts`, `apps/hub/src/hooks/__tests__/useEditSuggestion.test.tsx`, `apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx`, a new case in `apps/hub/src/lib/__tests__/postView*.test.ts` (create `postView.suggestionCaption.test.ts` if none fits)

**Interfaces:**
- Consumes: Task 4's body contract.
- Produces (in `apps/hub/src/types.ts`): `export type SuggestionField = 'texto' | 'legenda'; export interface SuggestionBases { conteudo?: Record<string, unknown> | null; conteudo_plain?: string | null; ig_caption?: string | null }`. For every touched field its keys are sent explicitly, `null` included (`JSON.stringify` drops `undefined`, and the RPC tests key presence): texto → `conteudo` + `conteudo_plain`, legenda → `ig_caption`.
- `submitEditSuggestion(token, post_id, suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption, touched_fields: SuggestionField[], bases: SuggestionBases | null)`.
- `saveSuggestion(conteudo, conteudoPlain, igCaption, touch: { fields: SuggestionField[]; bases: SuggestionBases })`. Coalescing onto the same pending entry unions `fields` and keeps the FIRST base per key.
- `suggestionAwareCaption(post, suggestion)` returns `suggestion.suggested_ig_caption` only when `suggestion.changed_fields` includes `'ig_caption'`; otherwise `deriveCaption(post, post.ig_caption)`. Draft texto in the hook seeds from the suggestion only when `changed_fields` has `conteudo` or `conteudo_plain`.

- [ ] **Step 1: Write failing tests:**
  - api: body includes `touched_fields` and `bases` exactly as passed (update `api.test.ts:261`).
  - hook: two `saveSuggestion` calls inside the debounce, first `{fields:['texto'], bases:{conteudo_plain:'A'}}`, second `{fields:['legenda'], bases:{ig_caption:'L', conteudo_plain:'B'}}` → one request with `touched_fields` `['texto','legenda']` and bases `{conteudo_plain:'A', ig_caption:'L'}`.
  - hook: a pending suggestion whose `changed_fields` is `['conteudo_plain']` and `suggested_ig_caption:'old'`, post `ig_caption:'new'` → `draftIgCaption === 'new'`.
  - postView: `suggestionAwareCaption` returns live-derived caption when `changed_fields` lacks `ig_caption`.
  - CorrectionPanel: editing only the caption sends `fields:['legenda']` and `bases.ig_caption` equal to the raw `post.ig_caption` captured when the panel opened (null on a media post with LEGENDA, not the derived text); editing only the body sends `fields:['texto']` with `bases.conteudo` / `conteudo_plain` from the post as fetched. Update the existing `saveSuggestion` call assertions at `CorrectionPanel.test.tsx:162,293,435,592,609` and the 26 `saveSuggestion(` calls in `useEditSuggestion.test.tsx` to the new 4th argument.
- [ ] **Step 2: Run** `npx vitest run apps/hub/src` → FAIL on the new cases.
- [ ] **Step 3: Implement.** CorrectionPanel captures `seedBasesRef` when the panel opens (raw `post.conteudo`, `post.conteudo_plain`, `post.ig_caption`), keeps a sticky per-session `touchedRef: Set<SuggestionField>` (body edited → `texto`, caption edited → `legenda`), and passes both on every save. `PostCard.tsx:419`: `<PostCard` is not rendered anywhere in `apps/hub/src` (only `formatDate` / `getPlatformLabel` are imported from it), so pass `{ fields: ['texto'], bases: { conteudo: post.conteudo, conteudo_plain: post.conteudo_plain } }` only to keep it compiling, and say so in the commit.
- [ ] **Step 4: Run** `npx vitest run apps/hub/src` and `npx tsc -p apps/hub/tsconfig.json --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(hub): sugestão informa campos tocados e bases; campo não sugerido mostra o texto atual`.

### Task 6: CRM store and per-field state helper

**Files:**
- Modify: `apps/crm/src/store/posts.ts:1517-1557`
- Create: `apps/crm/src/pages/entregas/editSuggestionFields.ts`
- Test: `apps/crm/src/__tests__/store.editSuggestions.test.ts`, create `apps/crm/src/pages/entregas/__tests__/editSuggestionFields.test.ts`

**Interfaces:**
- Produces:
  - `export type SuggestionField = 'texto' | 'legenda'` lives in `store/posts.ts` (the store needs it and must not import from `pages/`); `editSuggestionFields.ts` re-exports it.
  - `PostEditSuggestion` gains `original_conteudo: Record<string, unknown> | null; original_conteudo_plain: string | null; original_ig_caption: string | null`; `status` union gains `'superseded'`.
  - `getPostEditSuggestions` selects the three `original_*` columns.
  - `acceptEditSuggestion(id: number, expectedUpdatedAt: string | undefined, fields: SuggestionField[]): Promise<void>` sends `p_fields`.
  - In `editSuggestionFields.ts`: `export interface SuggestionFieldState { field: SuggestionField; changed: boolean; conflict: boolean }`; `export function suggestionFieldStates(post: Pick<WorkflowPost,'conteudo'|'conteudo_plain'|'ig_caption'>, s: PostEditSuggestion): SuggestionFieldState[]` (always two entries, texto first; rules from Global Constraints, image keys via `extractR2Keys` from `apps/crm/src/services/inlineImage.ts`); `export function teamOnlyChangedFields(post, s): SuggestionField[]` (fields not changed by the client whose live value differs from `original_*`, for the card footer).

- [ ] **Step 1: Write failing tests:** store payload `{ p_suggestion_id, p_expected_updated_at, p_fields: ['texto'] }` (update `store.editSuggestions.test.ts:87,99`, and the interim drawer call breaks `WorkflowDrawer.test.tsx:507,523,545,603,684`, which assert `toHaveBeenCalledWith(200, '2026-08-01T00:00:00Z')`: add the fields argument there); helper cases: 11807 shape → texto `{changed:true, conflict:false}`, legenda `{changed:false}`, `teamOnlyChangedFields` = `['legenda']`; same-field caption clash → legenda conflict; bold-only team drift → no texto conflict; team image added → texto conflict; `original_*` NULL (legacy row created before this change) → treat base as `''` and flag conflict when live is non-empty.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/__tests__/store.editSuggestions.test.ts apps/crm/src/pages/entregas/__tests__/editSuggestionFields.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` will fail at the two drawer call sites until Task 7: pass `fields` there now as `suggestionFieldStates(...).filter(s => s.changed).map(s => s.field)` so the tree compiles.**
- [ ] **Step 5: Commit** `feat(crm): estado por campo da sugestão e aceitar com campos`.

### Task 7: CRM review card, accept dialog, mentions

**Files:**
- Create: `apps/crm/src/pages/entregas/components/AcceptSuggestionDialog.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx:1564-1620`, `apps/crm/src/pages/entregas/components/postEditorPhone/PhoneSheets.tsx` (`PhoneSuggestionSheet`; it calls `closeThen(() => onAccept(suggestion))` at `:135`, so the dialog opens after the sheet closes), `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:945-1000`, `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx:528-575`, `packages/i18n/locales/{pt,en}/workflows.json` (`workflowDrawer.*`, ~123-124), `packages/i18n/locales/{pt,en}/postEditor.json` (`standalonePostDrawer.*` / `shared.*`, ~96-97)
- Test: `apps/crm/src/pages/entregas/components/__tests__/AcceptSuggestionDialog.test.tsx` (new), `WorkflowDrawer.test.tsx`, `StandalonePostDrawer.test.tsx`, `PostEditorBody.phone.test.tsx`

**Interfaces:**
- Consumes: `suggestionFieldStates`, `teamOnlyChangedFields`, `acceptEditSuggestion(id, updatedAt, fields)` (Task 6).
- Produces: `onAcceptSuggestion: (suggestion: PostEditSuggestion, fields: SuggestionField[]) => void` (prop on `PostEditorBody` and `PhoneSuggestionSheet`, replacing the one-argument form). `<AcceptSuggestionDialog open conflicts={SuggestionField[]} applied={SuggestionField[]} onConfirm={(fields) => void} onOpenChange>`.

Copy (pt; en twin in the same commit):
- conflict line: "A equipe editou o texto depois desta sugestão." / "A equipe editou a legenda depois desta sugestão."
- toggle: "O que muda ao aceitar" / "Só o que o cliente mudou"
- footer (team-only fields): "Aceitar aplica só {o texto do post | a legenda}. {A legenda | O texto} que a equipe editou fica como está."
- dialog: title "Aceitar a sugestão?", body "A equipe editou {campo} depois que o cliente enviou a sugestão. Escolha qual versão fica.", options "Manter a versão da equipe" (default) / "Usar a versão do cliente", applied line "Só o cliente mudou. Será aplicado.", buttons "Cancelar" / "Aceitar sugestão"; confirm disabled when the apply set is empty.
- accept button label with conflicts: "Aceitar…"
- toast for `suggestion_conflict`: "O post mudou desde que você abriu. Revise a sugestão de novo."

- [ ] **Step 1: Write failing tests:** dialog default keeps team version and confirms `['texto']` for a legenda conflict + texto change; choosing client version confirms `['texto','legenda']`; confirm disabled when only a conflicting field exists and it is set to team. Drawer: no-conflict accept calls `acceptEditSuggestion(id, updated_at, ['texto'])` without opening the dialog; mention sync runs only when `'texto'` is in the applied fields AND `suggested_conteudo != null` (Review Focus 2); `suggestion_conflict` error shows the new toast and refetches. Card: conflict line and footer render for the 11807 fixture and the clash fixture.
- [ ] **Step 2: Run** the four test files → FAIL.
- [ ] **Step 3: Implement** to match the mockups (boards 1-3). Set `original_*` equal to the live post in every existing `PostEditSuggestion` test fixture (drawer, phone and card suites); without it the helper's NULL → `''` rule turns every fixture into a conflict. The card diff for a conflict field defaults to live → suggested; the toggle switches to `original_*` → suggested.
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/pages/entregas` and the CRM tsc → PASS.
- [ ] **Step 5: Commit** `feat(crm): revisão da sugestão por campo com escolha no conflito`.

### Task 8: CRM guards: caption note, status moves, bulk approve count

**Files:**
- Create: `apps/crm/src/pages/entregas/hooks/useSuggestionMoveGuard.tsx`
- Modify: `apps/crm/src/store/posts.ts` (two count readers), `InstagramCaptionField` usage in `PostEditorBody.tsx:688-700`, `WorkflowDrawer.tsx:640-680`, `StandalonePostDrawer.tsx:415-450`, `views/PostsKanbanView.tsx:820-880`, `cliente-detalhe/tabs/EntregasTab.tsx:405-420`, `components/ScheduleButton.tsx` (schedule and publish-now confirm paths), `components/ApprovalExitDialog.tsx` + `hooks/useWorkflowStageCommands.tsx` (counts fetched on open), i18n `{pt,en}`
- Test: `apps/crm/src/pages/entregas/hooks/__tests__/useSuggestionMoveGuard.test.tsx` (new), plus one assertion per call site in its existing test file where one exists (`WorkflowDrawer.test.tsx`, `StandalonePostDrawer.test.tsx`, Kanban view test, `EntregasTab` test, `ApprovalExitDialog` test)

**Interfaces:**
- Produces:
  - `hasPendingEditSuggestion(postId: number): Promise<boolean>` and `countPendingEditSuggestionsInWorkflow(workflowId: number): Promise<number>` in `store/posts.ts` (head-count selects on `post_edit_suggestions` with `status = 'pending'`; the workflow one joins through `workflow_posts!inner(workflow_id, status)` and counts only posts with `status NOT IN ('aprovado_cliente','agendado','postado','falha_publicacao')`, the set `aprovar_todos` moves, `20261023000001:147-150`).
  - `useSuggestionMoveGuard(): { confirmMove: (postId: number, targetCanonical: WorkflowPost['status']) => Promise<boolean>; dialog: JSX.Element }`. Resolves `true` immediately when `targetCanonical` is not one of `aprovado_cliente | agendado | postado` or the post has no pending suggestion; otherwise opens an `AlertDialog` and resolves with the user's choice.
- Copy (pt; en twin): dialog title "Mover para {Aprovado pelo cliente | Agendado | Postado}?", body "Há uma sugestão do cliente não revisada neste post.", buttons "Cancelar" / "Mover mesmo assim"; caption note "O cliente sugeriu uma nova legenda. Revise a sugestão antes de editar." with link "Ver sugestão"; ApprovalExitDialog line "{n} post(s) com sugestão do cliente não revisada." (i18next plural keys).

- [ ] **Step 1: Write failing tests:** guard resolves true without a dialog for `revisao_interna`; with a pending suggestion and `agendado` shows the dialog and resolves false on Cancelar, true on "Mover mesmo assim"; drawer status select to a custom key whose canonical is `aprovado_cliente` awaits the guard before `updateWorkflowPost`; Kanban drop awaits it before `updateStatus.mutate`; ApprovalExitDialog shows the count line only when the count > 0; caption note renders only when the pending suggestion's `changed_fields` includes `ig_caption`.
- [ ] **Step 2: Run** the new and touched test files → FAIL.
- [ ] **Step 3: Implement.** Every manual status write found by `rg -U "updateWorkflowPost\([^;]*status|statusKeyToPatch\(" apps/crm/src` (multi-line, so `post-express/ExpressPostPage.tsx:366-370` shows up) plus `ScheduleButton`'s schedule/publish paths and `useUpdatePostStatus` callers goes through `confirmMove` first. Express is reviewed and skipped: it writes a post it just created, which has no suggestion; say so in the commit. Leave automations, MCP and the publisher untouched. Compose with the existing `statusChangeNeedsConfirm` flow in both drawers: the suggestion guard runs after that confirm, not instead of it.
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe` and the CRM tsc → PASS.
- [ ] **Step 5: Commit** `feat(crm): avisa antes de mover post com sugestão do cliente pendente`.

### Task 9: Mensagens label for `superseded`

**Files:**
- Modify: `apps/crm/src/pages/mensagens/mensagensLogic.ts:57`, `packages/i18n/locales/{pt,en}/messages.json:35-40`
- Test: `apps/crm/src/pages/mensagens/__tests__/mensagensLogic.test.ts`, `mensagensLogic.i18n.test.ts`

- [ ] **Step 1: Failing test:** an `edit_suggestion` item with action `superseded` renders "Sugestão de edição não revisada" (pt) and "Edit suggestion not reviewed" (en).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/mensagens` → FAIL.
- [ ] **Step 3: Add `'superseded'` to `SUGGESTION_ACTIONS` and the two locale keys.**
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(mensagens): rótulo para sugestão não revisada`.

### Task 10: Full gates and PR

- [ ] **Step 0:** Rebase onto `origin/main` (drops Task 0's cherry-pick once #771 is merged).
- [ ] **Step 1:** In a clean worktree with its own `npm ci` (memory: symlinked lanes give false vitest failures): `npm run lint`, `npm run format:check`, the four `tsc` commands from CLAUDE.md, `npm run test`, `npm run check:functions`, `npm run test:functions`, and the entitlements suites 95, 96, 101-104 against a local stack. All green.
- [ ] **Step 2:** Browser check against the local stack (memory `reference_local_supabase_colima` E2E notes): CRM drawer shows the 11807 card and footer; conflict dialog; status guard; Hub panel seeds the team's caption after a team edit. Screenshots for the PR.
- [ ] **Step 3:** Renumber migrations if main's tail moved, then open the PR with the spec's deploy order: migrations → `npx supabase functions deploy hub-edit-suggestion --no-verify-jwt` (`supabase/config.toml:189-190` has `verify_jwt = false`; it is token-auth) → merge. State that nothing was applied to staging or prod and that #771 must be on prod first.
