# Hub correction flow rework — Design

**Goal:** Replace the always-visible correction UI (inline caption/content editing that autosaves as a "sugestão" per keystroke, plus a separate comentario+motivo block) on all three Hub post cards with a collapsed Aprovar/Corrigir button pair. Corrigir expands a single correction panel with an explicit submit, so clients always know what they have and haven't sent.

## Background

`TextPostCard.tsx`, `StoryPostCard.tsx` and `InstagramPostCard.tsx` currently share one pattern:

- `useEditSuggestion` makes `conteudo`/`ig_caption` inline-editable when `isEditable` (no pending/rejected suggestion blocking it). Every keystroke calls `saveSuggestion(...)`, persisting a draft "sugestão" for the team to review — this is the auto-save the client-facing confusion is about.
- Independently, when `isPending` (`post.status === 'enviado_cliente'`), a `comentario` textarea + `CorrectionReasonChips` + Aprovar/Solicitar correção buttons are always rendered. `Solicitar correção` is already gated on both `comentario` and `motivo` being non-empty, and already requires an explicit click — this part already works like a submit, but it stays visible even when the client isn't correcting anything, and it's disconnected from the inline content edits above.
- `hub-approve/handler.ts` server-side validates `motivo` as one of `CORRECTION_REASONS` and currently **requires** it be present for `action === 'correcao'` (400s otherwise).

## Approved design (see mockup, agreed in conversation)

**Collapsed state (default, per post card, when `isPending`):** just two buttons, Aprovar and Corrigir. No comentario field, no chips, no editable content visible.

**Corrigir expands the card** into a correction panel:
- Media cards (Instagram/Story): the existing media/caption view stays read-only; the panel adds `CorrectionReasonChips` (now optional — no chip pre-selected, and clicking a selected chip deselects it) + a comentario textarea, both optional. A "Legenda" chip is still one of the four reasons — media-card caption changes go through the comentario field, not inline editing.
- Text card: the panel makes the existing `conteudo`/`ig_caption` fields inline-editable (same editor as today) **plus** a separate comentario textarea, both optional, **plus** the same optional reason chips.
- All three: "Enviar correção" (primary) and "Cancelar" (secondary) buttons.

**Enviar correção is one combined submit:** in the same click, (a) if the inline content was edited (text card only), stage it into one `saveSuggestion(...)` call — not per-keystroke — and (b) submit the `correcao` approval via `submitApproval` with whatever `comentario`/`motivo` were provided (both optional now). A correction with no content edit, no comentario, and no motivo is still a valid empty-reason correction request (matches today's "just click Solicitar correção" affordance, now reachable with nothing filled in).

**Cancelar** discards any staged inline edits (revert the editor to the last-saved draft/post content) and clears comentario/motivo, then collapses back to the two-button state. No `saveSuggestion` or `submitApproval` call.

**Aprovar** stays a single click, no panel. On click: submit immediately, then show a brief inline "Aprovado" confirmation (existing `result` state, already implemented) before the card settles into its collapsed/read-only state — this part doesn't change from today's behavior, just needs to read as "brief" rather than replacing the buttons row instantly (cosmetic: keep both visible for ~1s, per the mockup).

**Existing pending/rejected-suggestion states are unaffected:** if `hasPendingSuggestion` is true, the card still shows "Sugestão enviada para revisão da equipe" instead of the Aprovar/Corrigir buttons, same as today. `wasRejected` still shows its banner once the client re-opens Corrigir to try again.

## Backend change

`hub-approve/handler.ts`: `motivo` becomes fully optional for `action === 'correcao'` — validate the value against `CORRECTION_REASONS` only when present (`motivo == null || CORRECTION_REASONS.includes(motivo)`), never require presence. No DB migration needed (the CHECK constraint is already permissive on presence). Requires redeploying `hub-approve` to staging, then production, same deploy-ordering discipline as before (old and new `hub-approve` must both tolerate whatever the currently-live Hub bundle sends).

## Scope

Touches: `TextPostCard.tsx`, `StoryPostCard.tsx`, `InstagramPostCard.tsx`, `CorrectionReasonChips.tsx` (deselect support), `supabase/functions/hub-approve/handler.ts`, plus their test suites. No new files, no migration, no change to `postHistory.ts`'s state machine (approvals/events already tolerate `motivo: null`).
