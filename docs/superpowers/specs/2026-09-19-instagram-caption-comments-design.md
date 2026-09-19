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
        OR (anchor_start IS NOT NULL AND anchor_end > anchor_start AND anchor_start >= 0)))
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

`remapAnchors(oldText, newText, threads) -> threads` using a common-prefix /
common-suffix diff to find the edited window `[p, oldEnd)` replaced by `[p, newEnd)`,
delta `d = newEnd - oldEnd`:

- range entirely before `p`: unchanged.
- range entirely at/after `oldEnd`: shift by `d`.
- edit overlaps the range: clamp to the surviving parts; grow/shrink around the edit.
- surviving length 0 (whole passage removed): `orphaned = true`.
- Whole-text replacement (no common prefix/suffix, e.g. version restore or accepted
  Hub suggestion): keep a thread anchored only if `newText.slice(start, end) === quoted_text`
  at the stored range, else orphan.

Persistence: the caption text and the remapped anchors must commit atomically. The
generic `onFieldChange` is field-agnostic (`updateWorkflowPost(id, { [field]: value })`,
duplicated in both drawers) and stays untouched. Instead:

- New RPC `save_ig_caption(p_post_id bigint, p_caption text, p_anchors jsonb)`,
  `SECURITY INVOKER` (RLS applies), explicit `GRANT EXECUTE ... TO authenticated` and
  `REVOKE ... FROM anon`. One transaction updates `workflow_posts.ig_caption` and the
  `anchor_start/anchor_end/orphaned` of the listed threads (each thread must belong to
  `p_post_id`).
- New dedicated prop `onCaptionSave(text, anchors)` threaded to `InstagramCaptionField`
  (both drawers implement it; posts with no caption threads pass an empty `anchors`).
- `remapAnchors` always diffs from the **last persisted** caption (the baseline is
  advanced only after the RPC resolves), so a failed or out-of-order save never leaves
  anchors describing text the DB doesn't hold; the next save re-diffs from the
  baseline that matches the DB anchors.
- Caption changes from outside the field (Hub suggestion accept, version restore,
  MCP/other writers) bypass the RPC. The field, on receiving a new `value` prop that
  differs from its baseline, runs `remapAnchors(baseline, value, threads)` and persists
  the result through `updateThreadAnchors` (best effort, non-blocking); on any
  mismatch the quoted-text check orphans the thread.

## UI

`InstagramCaptionField`:

- The textarea keeps today's auto-grow (`resize-none overflow-hidden`, height from
  `scrollHeight`), so there is no inner scroll to sync. A mirror div, absolutely
  positioned behind a transparent-background textarea, uses identical font, padding and
  wrapping (`white-space: pre-wrap; overflow-wrap: anywhere`) and is re-rendered on
  every keystroke and on width change (the existing `ResizeObserver`). Paints
  `<mark class="comment-highlight">` for **active, non-orphaned** threads (union of
  overlaps). Resolved and orphaned threads are not painted.
- A "Comentar" button in the field header is enabled while the textarea has a
  non-empty selection (tracked via `selectionchange`, offsets captured on click). No
  floating button at the selection: a textarea exposes no selection pixel coordinates,
  multi-line selections have no single anchor point, and on touch the native selection
  menu would collide. The button opens the existing add-comment popover
  (`MentionTextarea`), anchored below the header.
- Click/caret inside a highlight opens `PostCommentPopover`, anchored to that `<mark>`'s
  bounding rect in the mirror (`getBoundingClientRect`, first line). Target resolution:
  most recently created thread covering the caret offset (pure helper, unit tested).
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
  `field === 'ig_caption'`; content threads stay a no-op.

## Wiring

- `store/comments.ts`: `createCommentThread(postId, quotedText, firstComment, anchor?)`
  where `anchor?: { field: 'ig_caption'; start: number; end: number }` (a 4th optional
  param; omitted means today's content thread). Add `updateThreadAnchors(threads)` and
  the `saveIgCaption(postId, text, anchors)` RPC wrapper. `getPostCommentThreads`
  already selects `*`.
- The callback `onCreateComment: (postId, quotedText, comment) => Promise<number>` gains
  the same optional 4th `anchor` param in `WorkflowDrawer` (`:1268`, `:769`),
  `StandalonePostDrawer` (`:425`) and `PostEditorBody` (`:119`, `:590`). `PostEditor`
  (content) keeps calling it without an anchor.
- Thread handlers in `WorkflowDrawer.tsx` and `StandalonePostDrawer.tsx` (duplicated
  today) are passed through `PostEditorBody.tsx` to the caption field. The content
  editor keeps filtering to `field = 'conteudo'` for its mark sync; caption threads
  never touch `PostEditor`'s resolve/delete mark logic.
- Deleting the last comment in a thread deletes the thread (unchanged).

## Testing

- Vitest: `remapAnchors` (insert before/inside/after, partial and full delete,
  replace-all, emoji/surrogate pairs), click-target resolver, overlap union.
- Component test: create a thread, type before the range, highlight shifts; delete the
  passage, thread orphaned and listed with badge.
- Entitlement SQL: new columns honor existing RLS; CHECK rejects a caption thread
  without valid offsets and a content thread with offsets.
- Browser verification (desktop + mobile): mirror/textarea alignment with wrapping,
  long words, scroll, emoji, locked state.

## Risks

- Mirror/textarea misalignment (font metrics, scrollbar width, iOS padding), and the
  mirror's soft-wrap points must match the textarea's on every keystroke, not just at
  rest; the click-to-open and `<mark>` rects depend on it. Mitigated by copying computed
  styles, re-rendering synchronously on input, and testing wrap edge cases.
- Concurrent edits by two members can desync offsets; the next save re-derives from the
  saved text, and the quoted-text check orphans clear mismatches.
