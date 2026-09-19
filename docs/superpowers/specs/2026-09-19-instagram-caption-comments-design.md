# Comentários internos na legenda do Instagram

## Goal

Let agency members comment on selected passages of a post's Instagram caption
(`workflow_posts.ig_caption`) inside the post editor, the same way they comment
on the content editor (TipTap). Comments only: no formatting. Internal-only, never
shown in the Hub.

## Background

- Content comments live in TipTap as a `commentHighlight` mark. The DB
  (`post_comment_threads`, `post_comments`) stores only `quoted_text`; the anchor is
  the mark inside `workflow_posts.conteudo`.
- The caption is a plain `<Textarea>` (`InstagramCaptionField.tsx`), debounced 1.5s,
  2200-char cap, locked when status is `agendado`. A textarea holds no marks, so
  anchors must be stored in the DB and tracked by hand.

## Decisions

- Comments attach to **selected text with a visible highlight** (mirror overlay).
- On edit, anchors are **tracked**; if the whole passage is deleted the thread is
  **orphaned** (kept, badge "texto removido", still repliable/resolvable).
- Internal only. Hub never sees caption threads. Commenting stays enabled while the
  caption is locked (`agendado`). Overlapping ranges allowed.
- Out of scope: Hub commenting on captions, new notification types, TikTok captions.

## Data

Migration `20260925000016_post_comment_threads_caption_anchors.sql` (main's tail is
already `20260925000015`; re-check and renumber above main's tail at PR-open time):

```sql
ALTER TABLE post_comment_threads
  ADD COLUMN field text NOT NULL DEFAULT 'conteudo'
    CHECK (field IN ('conteudo','ig_caption')),
  ADD COLUMN anchor_start int,
  ADD COLUMN anchor_end int,
  ADD COLUMN orphaned boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT post_comment_threads_anchor_chk CHECK (
    (field = 'conteudo' AND anchor_start IS NULL AND anchor_end IS NULL AND NOT orphaned)
    OR (field = 'ig_caption' AND (orphaned
        OR (anchor_start IS NOT NULL AND anchor_end IS NOT NULL
            AND anchor_start >= 0 AND anchor_end > anchor_start)))
  );
```

- Offsets are **UTF-16 code-unit indices** into the caption string (JS `String`
  indices, what `selectionStart/End` return). Never code points.
- Orphaning is terminal: `remapAnchors` never flips `orphaned` back to false. Because
  remap runs against the last *persisted* caption (see Persistence), an undo inside the
  1.5s debounce window never reaches the DB, so it never orphans.
- Orphaned threads ignore their offsets; `quoted_text` is the display fallback.
- RLS, `post_comments`, mentions and notification triggers unchanged.
- Existing rows default to `field='conteudo'`. `data-import` guard unaffected.

## Anchor tracking

Pure module `apps/crm/src/pages/entregas/utils/captionAnchors.ts`:

Two mechanisms, both pure and unit tested:

**1. `remapAnchors(oldText, newText, threads) -> threads`** (live typing). Common-prefix /
common-suffix diff, with the suffix bound `suffix <= min(oldLen, newLen) - prefix` (so
`"aa"` -> `"aaa"` is an insertion, not a delete). Edited window `[p, oldEnd)` replaced by
`[p, newEnd)`, delta `d = newEnd - oldEnd`:

- range entirely before `p`: unchanged.
- range entirely at/after `oldEnd`: shift by `d`.
- edit overlaps the range: clamp to the surviving parts; grow/shrink around the edit.
- surviving length 0 (whole passage removed): `orphaned = true`.
- Boundaries match the content editor's mark: an insertion exactly at `anchor_start`
  shifts the range (does not grow it); an insertion exactly at `anchor_end` grows it.
- Repeated text is ambiguous for a prefix/suffix diff (`"abcabc"` -> `"abc"` always
  reads as deleting the second copy). Accepted for typing; mechanism 2 catches drift.

**2. `validateAnchors(text, threads)`** (any time text arrives that wasn't remapped
edit-by-edit: drawer open, an inbound `value` change, MCP `update_post`, Hub suggestion
accept). For each active caption thread check `text.slice(start, end) === quoted_text`.
On mismatch: if `quoted_text` occurs exactly once in `text`, re-anchor there; otherwise
`orphaned = true`. This replaces any "whole-text replacement" special case, and it is the
only defence against writers that never touch the field (`supabase/functions/mcp/queries.ts`
writes `ig_caption` with no drawer open). Concurrent editors stay last-write-wins on
text and offsets, as the caption already is; validation is the mitigation.

**`quoted_text` is refreshed** to the current `text.slice(start, end)` in every save that
carries anchors (an in-range edit would otherwise make every later validation fail and
orphan the thread). The first-comment display keeps the original quote in the comment
thread UI only via the summary's current `quoted_text`; that is acceptable.

Persistence: the caption text and the remapped anchors must commit atomically. The
generic `onFieldChange` is field-agnostic (`updateWorkflowPost(id, { [field]: value })`,
duplicated in both drawers) and stays untouched. Instead:

- New RPC `save_ig_caption(p_post_id bigint, p_caption text, p_anchors jsonb)`,
  `SECURITY INVOKER` (RLS applies), explicit `GRANT EXECUTE ... TO authenticated` and
  `REVOKE ... FROM anon`. One transaction updates `workflow_posts.ig_caption` and the
  `anchor_start/anchor_end/orphaned` of the listed threads (each thread must belong to
  `p_post_id`).
- New dedicated prop `onSaveCaption(text, anchors)` threaded to `InstagramCaptionField`
  (both drawers implement it; posts with no caption threads pass an empty `anchors`).
- The debounced save reads the current `(text, anchors, quoted_text)` at fire time (not
  the closure of the keystroke that armed it). While a save is pending, inbound
  `threads`/`value` props (e.g. a `refresh()` from an earlier save) must not overwrite
  local text or anchors; `InstagramCaptionField` clears/re-arms `timerRef` when it
  adopts a new `value`. **Creating a thread flushes the pending save first**, so the new
  thread never references text the server doesn't have. After the RPC resolves the
  drawer awaits it *before* `refresh()`, so highlights don't snap back to old offsets.
- `remapAnchors` runs incrementally on each change (from the previous local text).
  Because text and anchors commit atomically, a failed save leaves the DB consistent
  (old text + old anchors) and the next save writes a consistent pair. When the local
  text becomes exactly equal to the last persisted `value` (e.g. an undo inside the
  debounce window), the draft is dropped and anchors reset to the persisted ones, so
  nothing is saved and nothing is orphaned.
- Caption changes from outside the field (Hub suggestion accept, MCP `update_post`,
  other writers; there is no version restore, `PostVersionHistorySheet` is read-only)
  bypass the RPC. On drawer open and whenever an inbound `value` differs from the
  baseline, the field runs `validateAnchors`; corrected anchors/orphans are persisted by
  the next save through the same RPC (nothing is written just from viewing).

## UI

`InstagramCaptionField`:

- The textarea keeps today's auto-grow (`resize-none overflow-hidden`, height from
  `scrollHeight`), so there is no inner scroll to sync. A mirror div, absolutely
  positioned behind a transparent-background textarea, uses identical font, padding and
  wrapping (`white-space: pre-wrap`, `overflow-wrap` and all metrics) copied from the textarea's computed style, `aria-hidden`, `pointer-events: none`,
  `color: transparent` on text with only the `<mark>` background visible, and a trailing
  zero-width space so a final newline gets a line box; it is re-rendered on
  every keystroke and on width change (the existing `ResizeObserver`). Paints
  `<mark class="comment-highlight">` for **active, non-orphaned** threads (union of
  overlaps). Resolved and orphaned threads are not painted.
- A "Comentar" button in the field header is enabled while the textarea has a
  non-empty selection (tracked via `selectionchange`, offsets captured on click). No
  floating button at the selection: a textarea exposes no selection pixel coordinates,
  multi-line selections have no single anchor point, and on touch the native selection
  menu would collide. The button opens an add-comment popover; that UI is inline JSX in `PostEditor.tsx:756-795`
  today, so it gets extracted into a shared `AddCommentPopover` used by both editors
  (`MentionTextarea`), anchored below the header.
- A click (not caret movement, so arrowing through a highlight doesn't pop it) inside a
  highlight opens `PostCommentPopover`, anchored to that `<mark>`'s
  bounding rect in the mirror (`getBoundingClientRect`, first line). Target resolution
  is a pointer hit-test against the mirror `<mark>` client rects (a caret offset is
  ambiguous at range edges); among overlapping hits the newest thread (highest id)
  wins (`pickThreadId`, unit tested). A click that ends a drag-selection is ignored.
- Locked caption (`agendado`): swap the native `disabled` for `readOnly` on the
  textarea. A `disabled` control can't be focused or selected, which would make
  commenting and highlight clicks unreachable. shadcn's `Textarea` styles the locked look
  off `:disabled`, which `readOnly` doesn't trigger, so add `read-only:opacity-70
  read-only:cursor-default` (Tailwind `read-only:` variant) to keep the affordance. The
  lock icon and tooltip stay.
- **Deliberate divergence from `PostEditor`**, where `disabled` also hides the comment
  toolbar and passes `readOnly={disabled}` to `PostCommentPopover`. For the caption the
  popover is never `readOnly` because of the lock; commenting is allowed in every
  status. (Do not copy that `PostEditor` wiring.)
- `PostCommentSummary`: "Legenda" chip on caption threads, "texto removido" badge for
  orphans. `onThreadClick` is a no-op for every thread today (`PostEditorBody.tsx:662`);
  this work makes it functional for caption threads only: `InstagramCaptionField` is a
  `forwardRef` exposing `focusThread(threadId)` (scroll into view, focus the textarea,
  select the range, open the popover). `PostEditorBody` calls it when the clicked thread's
  `field === 'ig_caption'`; content threads stay a no-op. Where `InstagramCaptionField` is
  not mounted (`HistoryDrawer`'s read-only summary, posts without an Instagram account,
  story posts) the ref is absent, so the click is a no-op and the row still shows the
  "Legenda" chip and quoted text.

## Wiring

- `store/comments.ts`: `createCommentThread(postId, quotedText, firstComment, anchor?)`
  where `anchor?: { field: 'ig_caption'; start: number; end: number }` (a 4th optional
  param; omitted means today's content thread). Add the
  `saveIgCaption(postId, text, anchors)` RPC wrapper. There is no separate
  `updateThreadAnchors`: corrections from `validateAnchors` are computed on load and
  persisted by the next save through the RPC (nothing is written just from viewing). `getPostCommentThreads`
  already selects `*`.
- The callback `onCreateComment: (postId, quotedText, comment) => Promise<number>` gains
  the same optional 4th `anchor` param in `WorkflowDrawer` (`:1268`, `:769`),
  `StandalonePostDrawer` (`:425`) and `PostEditorBody` (`:119`, `:590`). `PostEditor`
  (content) keeps calling it without an anchor.
- Thread handlers in `WorkflowDrawer.tsx` and `StandalonePostDrawer.tsx` (duplicated
  today) are passed through `PostEditorBody.tsx` to the caption field. `PostEditor` uses
  `threads` only for popover lookup and the delete-last-comment count; it applies marks
  from its own document, so caption threads are inert there (`unsetCommentHighlight` on
  one is a harmless no-op). The comment-count badge (`WorkflowDrawer.tsx:1408`)
  counting caption threads is intended.
- Deleting the last comment in a thread deletes the thread (unchanged).

## Testing

- Existing tests call/mock `createCommentThread` positionally
  (`store.comments.test.ts`, `WorkflowDrawer*.test.tsx`, `StandalonePostDrawer.test.tsx`);
  the optional 4th param keeps them green.
- Vitest: `validateAnchors` (mismatch re-anchors on unique match, orphans otherwise),
  `quoted_text` refresh, `"aa"` -> `"aaa"`, boundary inserts; `remapAnchors` (insert before/inside/after, partial and full delete,
  replace-all, emoji/surrogate pairs), click-target resolver, overlap union.
- Component test: create a thread, type before the range, highlight shifts; delete the
  passage, thread orphaned and listed with badge.
- Entitlement SQL (call `et_grant_hosted_parity()` first, per suite convention): new columns honor existing RLS; CHECK rejects a caption thread
  with a NULL `anchor_end` or missing offsets and a content thread with offsets.
- Browser verification (desktop + mobile): mirror/textarea alignment with wrapping,
  long words, scroll, emoji, locked state.

## Risks

- Mirror/textarea misalignment (font metrics, scrollbar width, iOS padding), and the
  mirror's soft-wrap points must match the textarea's on every keystroke, not just at
  rest; the click-to-open and `<mark>` rects depend on it. Mitigated by copying computed
  styles, re-rendering synchronously on input, and testing wrap edge cases.
- Concurrent edits by two members, and out-of-band writers (MCP `update_post`), can
  desync offsets. Last-write-wins as today; `validateAnchors` re-anchors or orphans.
