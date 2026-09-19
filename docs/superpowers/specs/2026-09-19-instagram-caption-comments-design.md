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

Migration (unique timestamp above main's tail, currently `20260925000015`; renumber
again at PR-open time if main has moved):

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

Persistence: offsets/orphaned flags update in the same debounced save as the caption
(`updateThreadAnchors(threads)` batch, sent alongside `onFieldChange('ig_caption', ...)`)
so text and anchors cannot drift. Caption changes originating outside the field
(Hub suggestion accept, version restore) run the same remap against the server-returned text.

## UI

`InstagramCaptionField`:

- Mirror div behind a transparent-background textarea: identical font, padding,
  wrapping (`white-space: pre-wrap; overflow-wrap: anywhere`), scroll synced. Paints
  `<mark class="comment-highlight">` for **active, non-orphaned** threads (union of
  overlaps). Resolved and orphaned threads are not painted.
- Selecting text (non-empty selection) shows a "Comentar" button near the selection;
  it opens the existing add-comment popover (`MentionTextarea`) and calls
  `createCommentThread({ field: 'ig_caption', anchorStart, anchorEnd })`.
- Click/caret inside a highlight opens `PostCommentPopover`. Target resolution: most
  recently created thread covering the caret offset (pure helper, unit tested).
- Locked caption: textarea read-only; commenting and highlights still work.
- `PostCommentSummary`: "Legenda" chip on caption threads, "texto removido" badge for
  orphans; `onThreadClick` scrolls to and focuses the caption highlight (currently a
  no-op).

## Wiring

- `store/comments.ts`: extend `createCommentThread` with `{ field, anchorStart, anchorEnd }`;
  add `updateThreadAnchors`. `getPostCommentThreads` already selects `*`.
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

- Mirror/textarea misalignment (font metrics, scrollbar width, iOS padding). Mitigated
  by copying computed styles and testing wrap edge cases.
- Concurrent edits by two members can desync offsets; the next save re-derives from the
  saved text, and the quoted-text check orphans clear mismatches.
