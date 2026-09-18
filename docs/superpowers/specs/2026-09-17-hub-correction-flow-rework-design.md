# Hub correction flow rework — Design

**Goal:** Replace the always-visible correction UI on all three Hub post cards with a collapsed Aprovar/Corrigir button pair. Corrigir expands a panel with two separate, explicit actions instead of always-visible autosave.

## Background

`TextPostCard.tsx`, `StoryPostCard.tsx` and `InstagramPostCard.tsx` share one pattern:

- `useEditSuggestion` makes content inline-editable when `isEditable`, saving a draft "sugestão" via `saveSuggestion(...)` for the team to review. All three cards use this, but each only renders its editor when there's something to edit: Text shows the rich `conteudo` editor when `draftConteudo` is truthy (else a non-editable plain paragraph if `conteudo_plain` exists, else nothing), and separately an `ig_caption` textarea only when `draftIgCaption || post.ig_caption` is truthy. Story shows its caption-overlay textarea only when the derived `caption` is truthy. A post with none of these has nothing to edit today, and won't gain an editor from this rework either.
- Independently, when `isPending` (`post.status === 'enviado_cliente'`), a `comentario` textarea + `CorrectionReasonChips` + Aprovar/Solicitar correção buttons are always rendered. `Solicitar correção` already requires an explicit click, gated today on both `comentario` and `motivo` being non-empty.
- `hub-approve/handler.ts`, for `action === "correcao"`: requires `motivo` be present and valid (400s otherwise); passes raw, untrimmed `comentario ?? null` straight to `record_client_approval` and the notification RPC — no length check, no empty-to-null normalization (that only exists for `action === "mensagem"`, via `mensagemText = typeof comentario === "string" ? comentario.trim() : ""`, which itself doesn't reject non-string input, it coerces to `""`).
- `useEditSuggestion` returns `{ isEditable, hasPendingSuggestion, wasRejected, saveSuggestion, saveState, approvalBlocked, draftConteudo, draftConteudoPlain, draftIgCaption }` — **`dirty` is computed internally but not currently exported.** `approvalBlocked` is `saveState === 'saving' || hasPendingSuggestion`; `saveState` only flips to `'saving'` after `saveSuggestion`'s internal 1500ms debounce fires, while `dirty` is set synchronously the instant `saveSuggestion` is called.
- `wasRejected` (`!hasPendingSuggestion && post.suggestion_rejected_at`) does not block editing — it shows a warning banner alongside a still-editable field, inviting a retry. Only `hasPendingSuggestion` actually blocks (replaces the buttons with "Sugestão enviada para revisão").

**Rejected design:** a single "Enviar correção" combining the content-edit save and the comentario/motivo submit into one action. `record_client_approval` changes `workflow_posts.status`, and `trg_auto_reject_pending_suggestion` ([20260521000001_post_edit_suggestions.sql:272](supabase/migrations/20260521000001_post_edit_suggestions.sql)) auto-rejects any pending suggestion on that post the instant its status changes — so a suggestion saved just before (or atomically with) a correction submit would be silently discarded. Decision: keep the two actions separate, at the UI level too, each with its own button.

## Approved design

**Collapsed state (default, per post card, when `isPending` and `!hasPendingSuggestion`):** just two buttons, Aprovar and Corrigir.

**Corrigir replaces the two buttons with a panel** (Aprovar is not shown while the panel is open):

1. **Content edit** — only rendered if the card already has an editor to show, per today's own truthy-guards (see Background): the existing inline editor for that card, staged in local component state instead of calling `saveSuggestion` per keystroke, with its own **"Salvar edição"** button. `wasRejected`'s existing warning banner renders here exactly as today. If a post has nothing editable today, this section is omitted and Corrigir shows only section 2.
   - `contentDirty` is a plain-text/string comparison, never a TipTap-JSON comparison: for Text, `stagedConteudoPlain !== draftConteudoPlain || stagedIgCaption !== (draftIgCaption ?? '')`; for Story/Instagram (caption-only), `stagedIgCaption !== (draftIgCaption ?? '')`. Fold `contentDirty` into the card's existing `useUnsavedWork(...)` call alongside today's `comentario.trim() !== '' || submitting`.
   - `useEditSuggestion.ts` gains one addition to its return object: `dirty`. No other change to the hook. Gate both "Enviar correção" and Aprovar on `dirty || approvalBlocked` (not `approvalBlocked` alone), closing the window where clicking Salvar edição then immediately Enviar correção/Aprovar — before the 1500ms debounce fires — would submit the correction, change `workflow_posts.status`, and cause the still-pending save to 409 once it finally flushes (swallowed silently into `dirty` staying true today).
2. **Correction request**: comentario textarea + `CorrectionReasonChips`, both optional now, with its own **"Enviar correção"** button that calls `submitApproval(token, post.id, 'correcao', comentario.trim(), motivo ?? undefined)`. An empty trimmed comentario is sent as `undefined`.
3. A single **"Fechar"** collapses the panel back to the two-button state (Aprovar reappears). If `contentDirty` or `comentario.trim() !== ''` or `motivo` is set, show a native `confirm()` before discarding; otherwise close immediately. Nothing already saved/submitted is affected.

`CorrectionReasonChips`'s `onChange` type needs `(value: CorrectionReason | null) => void` to support deselecting a chip (click again to clear).

**Aprovar**: single click, no panel, only visible in the collapsed state. Behavior unchanged: submit immediately, show the existing inline "Aprovado" `result` confirmation. Do not add an artificial delay.

**`hasPendingSuggestion`** still short-circuits the whole card to "Sugestão enviada para revisão" instead of any buttons, same as today, regardless of `isPending`.

## Backend change

`hub-approve/handler.ts`, for `action === 'correcao'`, mirroring `mensagem`'s existing pattern exactly (not inventing a stricter contract):
- `motivo` becomes optional: validate against `CORRECTION_REASONS` only when present (`motivo == null || CORRECTION_REASONS.includes(motivo)`), never require presence.
- Compute `const correcaoComentario = (typeof comentario === "string" ? comentario.trim() : "") || null;` — same coercion `mensagemText` already applies (non-string silently becomes `""`, never a 400; this is intentional, matching existing precedent), except the post-trim-empty result becomes `null` here instead of staying `""`, since an omitted/absent comentario is a valid, common case for `correcao` (unlike `mensagem`, which already requires a non-empty comentario). Reject only on length: if the pre-null-coercion trimmed string exceeds `MAX_COMMENT_LENGTH` (4000), 400 with the same message `mensagem` uses. Use `correcaoComentario` for both the `record_client_approval` RPC call and `create_post_approval_notification`, replacing today's raw `comentario ?? null`.
- No DB migration.

**Deploy ordering is the reverse of the original motivo rollout**: back then, the frontend had to ship before the strict handler because the strict handler would reject the not-yet-updated bundle. Now the handler is being *relaxed*, so a new Hub bundle that omits `motivo` would be rejected by the *old*, still-strict handler. **Deploy `hub-approve` to staging/production before the new Hub bundle**, and do not roll the handler back to the pre-this-change version once the new bundle is live (it would start 400ing every no-reason correction).

## Scope

Touches: `TextPostCard.tsx`, `StoryPostCard.tsx`, `InstagramPostCard.tsx`, `CorrectionReasonChips.tsx`, `hub-approve/handler.ts`, `useEditSuggestion.ts` (export `dirty`, one line), plus every test file covering these. No new files, no migration.
