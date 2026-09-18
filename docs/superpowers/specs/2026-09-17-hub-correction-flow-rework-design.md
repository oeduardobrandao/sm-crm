# Hub correction flow rework — Design

**Goal:** Replace the always-visible correction UI on all three Hub post cards with a collapsed Aprovar/Corrigir button pair. Corrigir expands a panel with two separate, explicit actions instead of always-visible autosave.

## Background

`TextPostCard.tsx`, `StoryPostCard.tsx` and `InstagramPostCard.tsx` share one pattern:

- `useEditSuggestion` makes `conteudo`/`ig_caption` inline-editable when `isEditable`. Every keystroke calls `saveSuggestion(...)`, persisting a draft "sugestão" for the team to review. Only `TextPostCard` and `StoryPostCard` expose this always-on; `InstagramPostCard` already gates it behind a `captionMode: 'preview' | 'edit'` toggle.
- Independently, when `isPending` (`post.status === 'enviado_cliente'`), a `comentario` textarea + `CorrectionReasonChips` + Aprovar/Solicitar correção buttons are always rendered. `Solicitar correção` already requires an explicit click, gated today on both `comentario` and `motivo` being non-empty.
- `hub-approve/handler.ts` requires `motivo` be present and valid for `action === 'correcao'` (400s otherwise).

**Rejected design:** a single "Enviar correção" combining the content-edit save and the comentario/motivo submit into one action. `record_client_approval` changes `workflow_posts.status`, and `trg_auto_reject_pending_suggestion` ([20260521000001_post_edit_suggestions.sql:272](supabase/migrations/20260521000001_post_edit_suggestions.sql)) auto-rejects any pending suggestion on that post the instant its status changes — so a suggestion saved just before (or even atomically with) a correction submit would be silently discarded. Fixing that needs a new backend RPC; out of scope for now. Decision: keep the two actions separate, at the UI level too.

## Approved design

**Collapsed state (default, per post card, when `isPending` and no pending/rejected suggestion blocks it):** just two buttons, Aprovar and Corrigir.

**Corrigir expands the card into a panel with two independent sections:**

1. **Content edit** (text/story cards only — media cards have no inline content to edit): the existing `conteudo`/`ig_caption` editors, but staged locally instead of autosaving per keystroke, with their own **"Salvar edição"** button. Clicking it calls `saveSuggestion(...)` once with the staged values. `saveSuggestion` is still debounced 1500ms internally (fire-and-forget, `void` return) — calling it once on click still means a ~1.5s delay before `saveState` flips to `'saving'`; this is an accepted quirk, not something to work around by touching `useEditSuggestion.ts`'s timer.
2. **Correction request**: comentario textarea + `CorrectionReasonChips`, both optional now, with its own **"Enviar correção"** button that calls `submitApproval(token, post.id, 'correcao', comentario.trim(), motivo ?? undefined)`. An empty trimmed comentario is sent as `undefined` (not `""`), matching how `motivo ?? undefined` already normalizes.
3. Instagram/Story media cards render only section 2 (no content editor) — same as today's caption handling for those cards outside of `captionMode: 'edit'`.
4. A single **"Fechar"** collapses the panel back to the two-button state without discarding anything already saved/submitted; unsaved staged content-edit text or an unsent comentario/motivo selection is cleared (with a native `confirm()` if either is non-empty, mirroring `useUnsavedWork`'s existing silent-update-safety pattern).

`CorrectionReasonChips`'s `onChange` type needs `(value: CorrectionReason | null) => void` to support deselecting a chip (click again to clear).

**Aprovar** stays a single click, no panel: submit immediately, show the existing inline "Aprovado" `result` confirmation. No timing change — the existing behavior (result replaces the buttons row on the next render, tied to the mutation's own resolution, not a fixed delay) already reads as immediate; do not add an artificial delay that would leave the UI showing stale controls if `onApprovalSubmitted`'s refetch settles first.

**Existing pending/rejected-suggestion states are unaffected:** `hasPendingSuggestion` still short-circuits to "Sugestão enviada para revisão"; `wasRejected` still shows its banner inside the expanded content-edit section.

## Backend change

`hub-approve/handler.ts`:
- `motivo` becomes optional for `action === 'correcao'`: validate the value against `CORRECTION_REASONS` only when present (`motivo == null || CORRECTION_REASONS.includes(motivo)`), never require presence.
- Apply the existing `MAX_COMMENT_LENGTH` (4000, trim, non-empty-if-present) check to `correcao`'s `comentario` too, not just `mensagem` — today it's `correcao`-exempt, and the new UI makes this textarea more prominent.
- No DB migration. Redeploy `hub-approve` to staging, then production (old and new bundles/handlers must keep tolerating each other, same as before).

## Scope

Touches: `TextPostCard.tsx`, `StoryPostCard.tsx`, `InstagramPostCard.tsx`, `CorrectionReasonChips.tsx`, `hub-approve/handler.ts`, plus every test file covering these. `useEditSuggestion.ts` itself is unchanged — `saveSuggestion` already works fine called once from an onClick instead of onChange. No new files, no migration.
