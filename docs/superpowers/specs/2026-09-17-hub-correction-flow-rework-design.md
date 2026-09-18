# Hub correction flow rework — Design

**Goal:** Replace the always-visible correction UI on all three Hub post cards with a collapsed Aprovar/Corrigir button pair. Corrigir expands a panel with two separate, explicit actions instead of always-visible autosave.

## Background

`TextPostCard.tsx`, `StoryPostCard.tsx` and `InstagramPostCard.tsx` share one pattern:

- `useEditSuggestion` makes content inline-editable when `isEditable`, saving a draft "sugestão" via `saveSuggestion(...)` for the team to review. **All three cards have this today**: Text edits `conteudo`/`ig_caption` (always-on when editable), Story edits `ig_caption` as a caption overlay on the media (always-on when editable), Instagram edits `ig_caption` behind a `captionMode: 'preview' | 'edit'` toggle. There is no card without inline content editing.
- Independently, when `isPending` (`post.status === 'enviado_cliente'`), a `comentario` textarea + `CorrectionReasonChips` + Aprovar/Solicitar correção buttons are always rendered. `Solicitar correção` already requires an explicit click, gated today on both `comentario` and `motivo` being non-empty.
- `hub-approve/handler.ts` requires `motivo` be present and valid for `action === 'correcao'` (400s otherwise), and only trims/length-checks `comentario` for `action === 'mensagem'`.
- `useEditSuggestion` returns `dirty` (true the instant `saveSuggestion` is called, before its 1.5s debounce fires) and `approvalBlocked` (`saveState === 'saving' || hasPendingSuggestion` — does **not** include `dirty`). Only `approvalBlocked` is read by the cards today.
- `wasRejected` (`!hasPendingSuggestion && post.suggestion_rejected_at`) does not block editing — it shows a warning banner alongside an still-editable field, inviting a retry. Only `hasPendingSuggestion` actually blocks (replaces the buttons with "Sugestão enviada para revisão").

**Rejected design:** a single "Enviar correção" combining the content-edit save and the comentario/motivo submit into one action. `record_client_approval` changes `workflow_posts.status`, and `trg_auto_reject_pending_suggestion` ([20260521000001_post_edit_suggestions.sql:272](supabase/migrations/20260521000001_post_edit_suggestions.sql)) auto-rejects any pending suggestion on that post the instant its status changes — so a suggestion saved just before (or atomically with) a correction submit would be silently discarded. Decision: keep the two actions separate, at the UI level too, each with its own button.

## Approved design

**Collapsed state (default, per post card, when `isPending` and `!hasPendingSuggestion`):** just two buttons, Aprovar and Corrigir.

**Corrigir replaces the two buttons with a panel** (Aprovar is not shown while the panel is open — see below) with two independent sections, both present on **all three cards** (Text, Story, Instagram all have inline content to edit, per Background):

1. **Content edit**: the existing inline editor for that card (`RichTextContent`+`ig_caption` textarea for Text, caption-overlay textarea for Story, `captionMode: 'edit'` textarea for Instagram), staged in local component state instead of calling `saveSuggestion` per keystroke, with its own **"Salvar edição"** button. `wasRejected`'s existing warning banner renders here exactly as today (it doesn't block, just warns).
   - Track a local `contentDirty` boolean (staged value !== the original `draftConteudo`/`draftIgCaption`) and fold it into the card's existing `useUnsavedWork(...)` call alongside the current `comentario.trim() !== '' || submitting` condition, so an unsaved staged edit blocks silent reload same as an unsent comentario does today.
   - Clicking "Salvar edição" calls `saveSuggestion(...)` once with the staged values. `saveSuggestion` sets `dirty = true` synchronously but only flips `saveState` to `'saving'` after its internal 1500ms debounce fires (fire-and-forget, `void` return) — so **gate both "Enviar correção" and Aprovar on `dirty || approvalBlocked`, not `approvalBlocked` alone**, closing the window where a user could click Salvar edição then immediately Enviar correção/Aprovar before the debounce flushes (which would change `workflow_posts.status` and cause the delayed save to 409, silently swallowed into `dirty` staying true).
2. **Correction request**: comentario textarea + `CorrectionReasonChips`, both optional now, with its own **"Enviar correção"** button that calls `submitApproval(token, post.id, 'correcao', comentario.trim(), motivo ?? undefined)`. An empty trimmed comentario is sent as `undefined`.
3. A single **"Fechar"** collapses the panel back to the two-button state (Aprovar reappears). If `contentDirty` or `comentario.trim() !== ''` or `motivo` is set, show a native `confirm()` before discarding; otherwise close immediately. Nothing already saved/submitted is affected — this only discards *unsaved* staged state.

`CorrectionReasonChips`'s `onChange` type needs `(value: CorrectionReason | null) => void` to support deselecting a chip (click again to clear).

**Aprovar**: single click, no panel, only visible in the collapsed state (not while Corrigir's panel is open, so there's no path to lose staged drafts by approving underneath them — the user must Fechar first, which handles the discard confirmation). Behavior unchanged: submit immediately, show the existing inline "Aprovado" `result` confirmation. Do not add an artificial delay.

**`hasPendingSuggestion`** still short-circuits the whole card to "Sugestão enviada para revisão" instead of any buttons, same as today, regardless of `isPending`.

## Backend change

`hub-approve/handler.ts`, for `action === 'correcao'`:
- `motivo` becomes optional: validate against `CORRECTION_REASONS` only when present (`motivo == null || CORRECTION_REASONS.includes(motivo)`), never require presence.
- `comentario` gets the same normalization `mensagem` already has: reject non-string, trim, treat post-trim-empty as `null` (not `""`), and enforce `MAX_COMMENT_LENGTH` (4000) when non-empty. Use the normalized (trimmed-or-null) value for both the `record_client_approval` RPC call and `create_post_approval_notification`, not the raw input.
- No DB migration. Redeploy `hub-approve` to staging, then production (old and new bundles/handlers must keep tolerating each other, same as before).

## Scope

Touches: `TextPostCard.tsx`, `StoryPostCard.tsx`, `InstagramPostCard.tsx`, `CorrectionReasonChips.tsx`, `hub-approve/handler.ts`, plus every test file covering these. `useEditSuggestion.ts` itself is unchanged. No new files, no migration.
