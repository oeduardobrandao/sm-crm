# PostEditor: Inline Comment Threads

## Summary

Add Google Docs-style inline commenting to the PostEditor. Team members can select text, attach a threaded conversation to it, and resolve threads when done. Comments are internal-only (not visible to clients in the Hub).

## Motivation

When multiple team members collaborate on social media post content, they need a way to discuss specific passages — ask questions, suggest changes, flag issues — without editing the post text directly. The existing `post_approvals` system handles post-level client feedback but doesn't support anchored, threaded internal discussion.

## Design

### Interaction flow

1. **Add comment:** User selects text in the editor → BubbleMenu appears → clicks the comment icon (MessageSquare) → a small popover opens with a text input → user writes comment and submits
2. **View thread:** Commented text has a subtle highlight. Clicking it opens a popover showing the full thread (all replies, timestamps, author names) and an input to reply
3. **Reply:** Type in the reply input at the bottom of the thread popover → submit
4. **Resolve:** Click a "Resolver" button in the thread popover header → thread status becomes resolved, highlight fades to a subtle gray
5. **Reopen:** Click "Reabrir" on a resolved thread to set it back to active
6. **Edit:** Click an edit icon on your own comment → inline edit mode → save
7. **Delete:** Click delete on your own comment (or any comment if you're owner/admin) → confirmation → removes the comment. If it's the only comment in the thread, the thread is also removed and the mark is cleared
8. **Summary list:** Below the editor, a collapsible section lists all threads with quoted text snippets, latest reply, and status. Clicking a thread scrolls to and highlights the anchored text

### Visual treatment

**Active comment highlight:** Subtle warm background (`rgba(234, 179, 8, 0.15)` — brand yellow at low opacity) with a thin bottom border. Cursor changes to pointer on hover.

**Resolved comment highlight:** Very faint gray background (`rgba(0, 0, 0, 0.05)` in light mode, `rgba(255, 255, 255, 0.05)` in dark mode). Still clickable to view the thread.

**Thread popover:** Positioned below the highlighted text. Dark surface in dark mode, white in light mode — same surface treatment as the BubbleMenu. Max height with scroll for long threads. Shows:
- Header: quoted text snippet (truncated) + resolve/reopen button
- Messages: author avatar/name, timestamp, content, edit/delete actions
- Footer: reply input + submit button

**Summary list:** Collapsible section below the editor titled "Comentários (N)". Each item shows:
- A colored dot (yellow for active, gray for resolved)
- Quoted text snippet (truncated, italic)
- First comment preview
- Reply count badge
- Author + relative timestamp

Default view shows active threads. A toggle to show resolved threads.

### Comment in BubbleMenu

Add a new comment button after a divider, at the end of the BubbleMenu:

```
[ B ] [ I ] [ U ] [ Link ] [ | ] [ A▾ ] [ H▾ ] [ | ] [ 💬 Comment ]
```

The comment button is only enabled when text is selected (which is always true when BubbleMenu is visible). If the selection already has a comment mark, clicking the button opens the existing thread instead of creating a new one.

### Disabled/readonly mode

When `disabled={true}` (HistoryDrawer), the BubbleMenu is hidden so no new comments can be added. However, existing comment highlights should still be visible and clickable to view threads (read-only). The summary list is also visible but without reply/resolve actions.

## Data model

### `post_comment_threads` table

```sql
CREATE TABLE post_comment_threads (
  id            bigserial PRIMARY KEY,
  post_id       bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  conta_id      uuid NOT NULL,
  quoted_text   text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  created_by    uuid NOT NULL,
  resolved_by   uuid,
  created_at    timestamptz DEFAULT now(),
  resolved_at   timestamptz
);

CREATE INDEX idx_post_comment_threads_post ON post_comment_threads(post_id);
```

- `quoted_text`: snapshot of the selected text at comment creation time. Serves as display text in the summary list and fallback if the mark is lost.
- `created_by` / `resolved_by`: `auth.uid()` values, joined with `profiles` or `membros` for display names.
- `conta_id`: workspace scoping for RLS.

### `post_comments` table

```sql
CREATE TABLE post_comments (
  id            bigserial PRIMARY KEY,
  thread_id     bigint NOT NULL REFERENCES post_comment_threads(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL,
  content       text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz
);

CREATE INDEX idx_post_comments_thread ON post_comments(thread_id);
```

- `author_id`: `auth.uid()` of the comment author.
- `updated_at`: set when a comment is edited, null otherwise.

### RLS policies

Follow the existing pattern using `get_my_conta_id()`:

- **Threads:** SELECT, INSERT, UPDATE, DELETE scoped to `conta_id IN (SELECT get_my_conta_id())`
- **Comments:** SELECT, INSERT, UPDATE, DELETE scoped via thread's conta_id: `thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT get_my_conta_id()))`
- Fine-grained delete/edit permissions (author-only, owner/admin override) enforced in the frontend since RLS can't easily check roles

### Notifications (future)

The schema supports adding a `post_comment_notifications` table later for tracking read/unread state and sending notifications. Not implemented now but the data model doesn't preclude it — `author_id` on comments and `created_by` on threads provide the identity needed.

## Text anchoring

### Custom TipTap mark extension: `commentHighlight`

A custom TipTap `Mark` extension that:
- Stores `threadId` (bigint) and `resolved` (boolean) as attributes
- Renders as `<span class="comment-highlight" data-thread-id="123" data-resolved="false">text</span>`
- Provides commands: `setCommentHighlight({ threadId })`, `unsetCommentHighlight(threadId)`
- Supports multiple overlapping marks (different threads on the same text)

The mark is persisted in the TipTap document JSON (`conteudo` column). When the document is saved, marks are included automatically.

### Resolving updates the mark

When a thread is resolved, the frontend:
1. Updates the thread status in the database
2. Finds all marks with that `threadId` and sets `resolved: true`
3. Saves the document (via the existing debounced save)

CSS targets `[data-resolved="true"]` for the faded style.

### Orphaned threads

If a user deletes the commented text, the mark is removed but the thread remains in the database. The summary list shows orphaned threads with their `quoted_text` and a note that the text was removed. Users can still resolve or delete orphaned threads.

## Component architecture

### New files

1. **`CommentHighlight.ts`** — Custom TipTap mark extension (in `entregas/components/`)
2. **`PostCommentPopover.tsx`** — Thread popover component (view/reply/resolve/edit/delete)
3. **`PostCommentSummary.tsx`** — Summary list below editor

### Modified files

1. **`PostEditor.tsx`** — Register CommentHighlight extension, add comment button to BubbleMenu, handle click on highlighted text to open popover, accept thread data as props
2. **`WorkflowDrawer.tsx`** — Fetch threads + comments for posts, pass data and callbacks to PostEditor and PostCommentSummary, orchestrate CRUD operations
3. **`HistoryDrawer.tsx`** — Pass threads for read-only display
4. **`store.ts`** — Add CRUD functions for threads and comments
5. **`style.css`** — Comment highlight styles, popover styles, summary list styles

### PostEditor new props

```typescript
interface PostEditorProps {
  initialContent: Record<string, unknown> | null;
  onUpdate: (json: Record<string, unknown>, plain: string) => void;
  disabled?: boolean;
  threads?: CommentThread[];
  onAddComment?: (threadId: number, quotedText: string, from: number, to: number) => void;
  onThreadClick?: (threadId: number) => void;
}
```

The PostEditor handles mark management and delegates comment CRUD to parent via callbacks. Thread/comment data flows down, user actions flow up.

### Store functions

```typescript
getPostCommentThreads(postIds: number[]): Promise<CommentThreadWithComments[]>
createCommentThread(postId: number, quotedText: string): Promise<{ id: number }>
addComment(threadId: number, content: string): Promise<void>
updateComment(commentId: number, content: string): Promise<void>
deleteComment(commentId: number): Promise<void>
resolveCommentThread(threadId: number): Promise<void>
reopenCommentThread(threadId: number): Promise<void>
deleteCommentThread(threadId: number): Promise<void>
```

## Permissions matrix

| Action | Agent | Admin | Owner |
|--------|-------|-------|-------|
| Add comment | Yes | Yes | Yes |
| Reply to thread | Yes | Yes | Yes |
| Edit own comment | Yes | Yes | Yes |
| Edit others' comment | No | No | No |
| Delete own comment | Yes | Yes | Yes |
| Delete others' comment | No | Yes | Yes |
| Resolve thread | Yes | Yes | Yes |
| Reopen thread | Yes | Yes | Yes |

## Testing

- Custom TipTap extension: mark creation, attribute persistence, command behavior
- Store functions: CRUD operations (mocked Supabase)
- PostCommentPopover: render thread, reply, resolve, edit, delete flows
- PostCommentSummary: render thread list, filter active/resolved, click to navigate
- PostEditor integration: comment button in BubbleMenu, mark application on comment creation
- Permissions: verify edit/delete visibility based on role and authorship
- Run `npm run build` to typecheck
- Run `npm run test` to verify no regressions
