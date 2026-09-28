# Hub: editar sugestão pendente + diff das alterações

Status: DRAFT v2 (after Fable + Codex review)
Date: 2026-09-28

## Context

Incident 2026-09-28 (prod, post 6573, suggestion 4429): a client's copy suggestion "disappeared".
It had been auto-rejected by `trg_auto_reject_pending_suggestion` when a team member added blank
lines to the caption; the row was restored to `pending` by hand. The product asks for:

1. When a client already has a pending suggestion and wants to change it further, the same pending
   suggestion is updated and carries all old + new changes.
2. In the Hub, the client sees a diff of their suggestion so changes are easy to spot.
3. A clear "Editar sugestão" button to edit the suggestion from there.
4. Both the post text (`conteudo` / `conteudo_plain`) and the caption (`ig_caption`) are covered.
5. The team is notified again each time the client updates a pending suggestion.

## Current state (verified in code)

- `upsert_edit_suggestion` (`20260521000001:112-150`) upserts the single pending row per post,
  replacing `suggested_*` with the full new snapshot, keeping `original_*` from the first
  submission, recomputing `changed_fields` against the LIVE post, and deleting the pending row when
  nothing differs. Every save is a full snapshot, so old + new changes merge as long as the editor
  starts from the suggestion.
- `useEditSuggestion.ts:103-114` seeds `draft*` from `post.pending_suggestion`.
- Editing is blocked only in the UI:
  - `PostDetailDialog.tsx:785` footer "Corrigir" is disabled when `edit.hasPendingSuggestion`.
  - `CorrectionPanel.tsx:296` early-returns `<SuggestionPendingNotice />`.
  - `PostDetailDialog.tsx:311` `showSaveInFooter` excludes `hasPendingSuggestion`, so the save slot
    never mounts and `CorrectionPanel` renders no Save button (`:321-333`).
- Reading view toggle `Sua sugestão | Original` (`CorrectionPanel.tsx:60-89`), no diff.
- `@mesaas/text-diff` `computeWordDiff` is used by `PostHistoryPanel.tsx:41-52` (`<del>`/`<ins>`).
- `hub-posts/handler.ts:189` returns live `conteudo_plain` / `ig_caption` plus the pending row's
  `suggested_*` / `changed_fields` (not `original_*`).
- `hub-edit-suggestion/handler.ts:146` notifies only on `is_new`. Latest RPC body
  `20260830000003`; grants `20260925000001:115-116`; pinned by
  `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql:43` as `(bigint)`.
- Locales: `packages/i18n/locales` ships `pt` and `en`.

## Design

### 1. "Editar sugestão" (Hub)

- Footer: when `isPending && edit.hasPendingSuggestion`, "Corrigir" is replaced by an enabled
  **"Editar sugestão"** button (lucide `PencilLine`) that opens the panel.
- `CorrectionPanel` drops the `hasPendingSuggestion` early return. A one-line note at the top:
  "Você está editando a sugestão que já enviou. As alterações anteriores continuam valendo."
- `showSaveInFooter` drops its `!edit.hasPendingSuggestion` term so Salvar edição renders.
- Section 2 (correction request) stays visible but **disabled with a reason** while a suggestion is
  pending ("Para pedir correção, aguarde a equipe revisar sua sugestão."). It is already
  disabled via `approvalBlocked` (`CorrectionPanel.tsx:456`); the change is the explanatory line.
  Rationale: `correcao` changes post status (`hub-approve/handler.ts:183-195`) and the auto-reject
  trigger would silently reject the suggestion.
- **Caption seeding fix.** `deriveCaption` treats `''` as missing (`postView.ts:136`), so a stored
  `suggested_ig_caption = ''` would re-seed the caption field with LEGENDA-derived body text and a
  text-only re-save would submit it as the caption. When a suggestion exists, the caption baseline
  is `suggestion.suggested_ig_caption ?? deriveCaption(post, post.ig_caption)`, in the panel and in
  the reading view.
- **Post-save state.** `useEditSuggestion` exposes the `pending_suggestion` returned by the save
  (today discarded at `:190-196`); the dialog prefers it over `post.pending_suggestion` until the
  refetch catches up, so the diff and notice are correct immediately.
- **Close after save.** After a successful save the panel closes through `closePanel()` (the
  guarded path), only when nothing else is unsent (no comentário / motivo typed). Otherwise it
  stays open. Applies to the first save as well.
- **Re-sync.** `hasPendingSuggestion` re-syncs from the prop whenever nothing is queued or in
  flight for the post, so if the team accepts/rejects (or a team edit auto-rejects) while the panel
  is open, the note and diff go away instead of lingering over reverted text.
- Revert-to-original: the RPC deletes the row when nothing differs (`action: 'deleted'`) and the
  post returns to normal. Not guaranteed for rich `conteudo` byte equality (TipTap round-trip can
  leave `conteudo` in `changed_fields` with identical plain text); see the diff guard below.
- Aprovar stays blocked while a suggestion is pending (unchanged, UI-only as today).

### 2. Diff view (Hub reading view)

- Toggle becomes **Alterações | Sua sugestão | Original**, default `Alterações`
  (`SuggestionView` gains `'diff'`). Keeps `role=group` + `aria-pressed`; add a visible focus ring
  and `aria-live="polite"` on the detail line.
- `Alterações` renders a new `SuggestionDiff`: word diff via `computeWordDiff`, rose strikethrough
  for removed, emerald for added, `whitespace-pre-wrap`. One block per field that actually differs:
  - **Texto do post**: `post.conteudo_plain` → `suggested_conteudo_plain`, shown only when
    `suggested_conteudo_plain != null` and the plain text differs. If `changed_fields` has
    `conteudo` but the plain text is identical, show "Alterações somente de formatação."
  - **Legenda**: `deriveCaption(post, post.ig_caption)` → `suggested_ig_caption`, shown only when
    `suggested_ig_caption != null` and it differs. Using `deriveCaption` for "before" matches what
    the client actually edited on media posts without `ig_caption` (LEGENDA fallback).
- **Baseline = live post**, not `original_*`. It is what `changed_fields` is computed against and
  exactly what accepting would overwrite, so the diff shows what acceptance will change. (Codex
  noted the trigger ignores `conteudo_plain`-only team updates, so live can drift from `original_*`;
  the live baseline is still the right one for "what will change". No API change.)
- `<del>`/`<ins>` rendering is extracted from `PostHistoryPanel.tsx` into a shared Hub `WordDiff`.
- Plain-text diff: formatting is not compared (`Sua sugestão` still renders rich text).
- `postText` tab in `Alterações` shows the suggested version.

### 3. Notify the team on updates (no signature change)

- New migration `20260928000001_edit_suggestion_notification_updated.sql` (above main's tail
  `20260925130002`; re-check at PR time): `CREATE OR REPLACE` the existing
  `create_edit_suggestion_notification(bigint)` with the body from `20260830000003` plus
  `metadata.updated := exists(pending row for p_post_id where updated_at > created_at)`.
  `CREATE OR REPLACE` keeps the grants and the `(bigint)` signature, so test 96 and PostgREST
  calls are untouched. On insert `created_at = updated_at = now()`; the BEFORE UPDATE trigger bumps
  `updated_at` on the upsert's `DO UPDATE`.
- `hub-edit-suggestion`: call the RPC on every save whose `action !== 'deleted'` (not just
  `is_new`). Gate on `!== 'deleted'` because Deno fixtures return `action: "insert"`
  (`hub-functions_test.ts:2600,2637,2700`).
- CRM `notification-config.ts` (+ `notification-catalog.ts` if it carries copy): title
  **"Sugestão de edição atualizada"** when `metadata.updated`.
- One notification per explicit save; no dedupe.
- Withdrawal (`action: 'deleted'`) sends no notification (see Out of scope).
- Rollback: re-apply the `20260830000003` body with `CREATE OR REPLACE` (same signature, grants
  unaffected) and redeploy the previous `hub-edit-suggestion`. Either half can be rolled back alone.

### 4. i18n

New Hub strings via `t('…', 'fallback')` in `hubPosts`, keys in `packages/i18n/locales/{pt,en}`.

## Testing

- Vitest (Hub), new:
  - `CorrectionPanel` with a pending suggestion: editor seeded with suggested text/caption, note
    shown, section 2 disabled with reason, `''` suggested caption does not fall back to body.
  - `PostDetailDialog`: "Editar sugestão" enabled when pending; Salvar edição renders in the footer
    in edit mode; saving an edited pending suggestion calls `submitEditSuggestion` with the merged
    content; reading view defaults to `Alterações`; returned `pending_suggestion` is shown before
    refetch; panel closes after save only when no comentário/motivo is typed.
  - `SuggestionDiff`: only differing fields render; null suggested value renders nothing;
    formatting-only line; LEGENDA-fallback caption baseline.
  - `useEditSuggestion`: `hasPendingSuggestion` re-syncs from the prop when idle.
- Vitest, existing tests to update: `CorrectionPanel.test.tsx:489-500`,
  `PostDetailDialog.test.tsx:995-999`, `:1004-1040` (default view becomes `diff`), `:1210`;
  `PostHistoryPanel` tests after the `WordDiff` extraction.
- Deno: `hub-edit-suggestion` calls the notification RPC on update as well as on insert, and not
  on `deleted`.
- psql: a check that `metadata.updated` is false on first insert and true after an upsert update
  (added to an existing entitlements suite or a new one).
- CRM: notification-config title for `updated`.

## Deploy order

1. `npx supabase db push` (migration; compatible with the current function).
2. Deploy `hub-edit-suggestion` (`--no-verify-jwt`, `--use-api`).
3. Merge (frontend deploys on merge).

## Out of scope

- Narrowing `trg_auto_reject_pending_suggestion` / labelling auto-rejects in the CRM (separate
  follow-up task). Until then a team edit to content/caption/status still silently rejects a
  pending suggestion.
- Notifying/retracting when the client withdraws a suggestion by reverting it. The CRM only reads
  pending rows, so the team's earlier notification leads to a post with no suggestion, not a
  broken state.
- Stale "sugestão rejeitada" notice resurfacing after a client-initiated revert
  (`hub-posts/handler.ts:345` has no recency check).
- Server-side guard against approving with a pending suggestion (`hub-approve`).
- "Descartar sugestão" button; rich-text (TipTap) diff in the Hub.
