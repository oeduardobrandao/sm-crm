# PostEditor Inline Comment Threads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Docs-style inline threaded comments to the PostEditor, with comment highlights anchored to text, thread popovers, and a summary list below the editor.

**Architecture:** Custom TipTap mark extension stores thread IDs in the document JSON. Comment data lives in two new Supabase tables (`post_comment_threads`, `post_comments`). WorkflowDrawer orchestrates CRUD via store functions and passes data/callbacks to the editor and new UI components.

**Tech Stack:** TipTap custom Mark extension, React, Supabase (Postgres + RLS), TanStack Query, CSS custom properties for theming.

**Spec:** `docs/superpowers/specs/2026-04-23-post-inline-comments-design.md`

---

### Task 1: Database migration — tables + RLS

**Files:**
- Create: `supabase/migrations/20260423_post_comment_threads.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Inline comment threads anchored to text selections in PostEditor
CREATE TABLE IF NOT EXISTS post_comment_threads (
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

CREATE INDEX IF NOT EXISTS idx_post_comment_threads_post ON post_comment_threads(post_id);

CREATE TABLE IF NOT EXISTS post_comments (
  id            bigserial PRIMARY KEY,
  thread_id     bigint NOT NULL REFERENCES post_comment_threads(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL,
  content       text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_post_comments_thread ON post_comments(thread_id);

-- RLS for post_comment_threads
ALTER TABLE post_comment_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_comment_threads_select" ON post_comment_threads;
CREATE POLICY "post_comment_threads_select" ON post_comment_threads
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "post_comment_threads_insert" ON post_comment_threads;
CREATE POLICY "post_comment_threads_insert" ON post_comment_threads
  FOR INSERT WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "post_comment_threads_update" ON post_comment_threads;
CREATE POLICY "post_comment_threads_update" ON post_comment_threads
  FOR UPDATE USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS "post_comment_threads_delete" ON post_comment_threads;
CREATE POLICY "post_comment_threads_delete" ON post_comment_threads
  FOR DELETE USING (conta_id IN (SELECT public.get_my_conta_id()));

-- RLS for post_comments (scoped via thread's conta_id)
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_comments_select" ON post_comments;
CREATE POLICY "post_comments_select" ON post_comments
  FOR SELECT USING (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "post_comments_insert" ON post_comments;
CREATE POLICY "post_comments_insert" ON post_comments
  FOR INSERT WITH CHECK (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "post_comments_update" ON post_comments;
CREATE POLICY "post_comments_update" ON post_comments
  FOR UPDATE USING (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  )
  WITH CHECK (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );

DROP POLICY IF EXISTS "post_comments_delete" ON post_comments;
CREATE POLICY "post_comments_delete" ON post_comments
  FOR DELETE USING (
    thread_id IN (SELECT id FROM post_comment_threads WHERE conta_id IN (SELECT public.get_my_conta_id()))
  );
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260423_post_comment_threads.sql
git commit -m "feat: add post_comment_threads and post_comments tables with RLS"
```

---

### Task 2: TypeScript types + store CRUD functions

**Files:**
- Modify: `apps/crm/src/store.ts` (add interfaces + functions after the existing PostApproval section ~line 1530)
- Create: `apps/crm/src/__tests__/store.comments.test.ts`

- [ ] **Step 1: Add interfaces to store.ts**

Add these after the existing `PostApproval` interface (~line 1240):

```typescript
export interface CommentThread {
  id: number;
  post_id: number;
  conta_id: string;
  quoted_text: string;
  status: 'active' | 'resolved';
  created_by: string;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface PostComment {
  id: number;
  thread_id: number;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string | null;
}

export interface CommentThreadWithComments extends CommentThread {
  post_comments: PostComment[];
}
```

- [ ] **Step 2: Add store functions**

Add these after the existing `replyToPostApproval` function (~line 1540):

```typescript
// ── Inline comment threads ──────────────────────────────────────

export async function getPostCommentThreads(postIds: number[]): Promise<CommentThreadWithComments[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_comment_threads')
    .select('*, post_comments(*)')
    .in('post_id', postIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const threads = (data || []) as CommentThreadWithComments[];
  for (const t of threads) {
    t.post_comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return threads;
}

export async function createCommentThread(
  postId: number,
  quotedText: string,
  firstComment: string,
): Promise<CommentThreadWithComments> {
  const profile = getCachedProfile();
  if (!profile) throw new Error('No profile');

  const { data: thread, error: threadErr } = await supabase
    .from('post_comment_threads')
    .insert({
      post_id: postId,
      conta_id: profile.conta_id,
      quoted_text: quotedText,
      created_by: profile.id,
    })
    .select()
    .single();
  if (threadErr) throw threadErr;

  const { data: comment, error: commentErr } = await supabase
    .from('post_comments')
    .insert({
      thread_id: thread.id,
      author_id: profile.id,
      content: firstComment,
    })
    .select()
    .single();
  if (commentErr) throw commentErr;

  return { ...thread, post_comments: [comment] } as CommentThreadWithComments;
}

export async function addPostComment(threadId: number, content: string): Promise<PostComment> {
  const profile = getCachedProfile();
  if (!profile) throw new Error('No profile');
  const { data, error } = await supabase
    .from('post_comments')
    .insert({ thread_id: threadId, author_id: profile.id, content })
    .select()
    .single();
  if (error) throw error;
  return data as PostComment;
}

export async function updatePostComment(commentId: number, content: string): Promise<void> {
  const { error } = await supabase
    .from('post_comments')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', commentId);
  if (error) throw error;
}

export async function deletePostComment(commentId: number): Promise<void> {
  const { error } = await supabase
    .from('post_comments')
    .delete()
    .eq('id', commentId);
  if (error) throw error;
}

export async function resolveCommentThread(threadId: number): Promise<void> {
  const profile = getCachedProfile();
  if (!profile) throw new Error('No profile');
  const { error } = await supabase
    .from('post_comment_threads')
    .update({ status: 'resolved', resolved_by: profile.id, resolved_at: new Date().toISOString() })
    .eq('id', threadId);
  if (error) throw error;
}

export async function reopenCommentThread(threadId: number): Promise<void> {
  const { error } = await supabase
    .from('post_comment_threads')
    .update({ status: 'active', resolved_by: null, resolved_at: null })
    .eq('id', threadId);
  if (error) throw error;
}

export async function deleteCommentThread(threadId: number): Promise<void> {
  const { error } = await supabase
    .from('post_comment_threads')
    .delete()
    .eq('id', threadId);
  if (error) throw error;
}
```

- [ ] **Step 3: Write tests**

Create `apps/crm/src/__tests__/store.comments.test.ts` following the existing test pattern in `store.posts.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../store';
import { mockedSupabase, getCalls } from './helpers';

describe('Comment Thread Store', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('getPostCommentThreads returns empty for empty postIds', async () => {
    const result = await store.getPostCommentThreads([]);
    expect(result).toEqual([]);
  });

  it('getPostCommentThreads fetches threads with comments', async () => {
    const thread = {
      id: 1, post_id: 10, conta_id: 'conta-1', quoted_text: 'sample text',
      status: 'active', created_by: 'user-1', resolved_by: null,
      created_at: '2026-04-23T00:00:00Z', resolved_at: null,
      post_comments: [
        { id: 1, thread_id: 1, author_id: 'user-1', content: 'Fix this', created_at: '2026-04-23T00:00:00Z', updated_at: null },
      ],
    };
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'select', { data: [thread], error: null });
    const result = await store.getPostCommentThreads([10]);
    expect(result).toHaveLength(1);
    expect(result[0].quoted_text).toBe('sample text');
    expect(result[0].post_comments).toHaveLength(1);
  });

  it('createCommentThread inserts thread and first comment', async () => {
    const thread = { id: 5, post_id: 10, conta_id: 'conta-1', quoted_text: 'highlighted', status: 'active', created_by: 'user-1', resolved_by: null, created_at: '2026-04-23T00:00:00Z', resolved_at: null };
    const comment = { id: 1, thread_id: 5, author_id: 'user-1', content: 'Needs rework', created_at: '2026-04-23T00:00:00Z', updated_at: null };
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'insert', { data: thread, error: null });
    mockedSupabase.__queueSupabaseResult('post_comments', 'insert', { data: comment, error: null });
    const result = await store.createCommentThread(10, 'highlighted', 'Needs rework');
    expect(result.id).toBe(5);
    expect(result.post_comments).toHaveLength(1);
    expect(result.post_comments[0].content).toBe('Needs rework');
  });

  it('addPostComment inserts with author_id from profile', async () => {
    const comment = { id: 2, thread_id: 5, author_id: 'user-1', content: 'Agreed', created_at: '2026-04-23T00:00:00Z', updated_at: null };
    mockedSupabase.__queueSupabaseResult('post_comments', 'insert', { data: comment, error: null });
    const result = await store.addPostComment(5, 'Agreed');
    expect(result.content).toBe('Agreed');
    const call = getCalls('post_comments', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({ thread_id: 5, author_id: 'user-1' });
  });

  it('resolveCommentThread updates status', async () => {
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'update', { data: null, error: null });
    await store.resolveCommentThread(5);
    const call = getCalls('post_comment_threads', 'update').at(-1)!;
    expect(call.payload).toMatchObject({ status: 'resolved', resolved_by: 'user-1' });
  });

  it('deletePostComment calls delete', async () => {
    mockedSupabase.__queueSupabaseResult('post_comments', 'delete', { data: null, error: null });
    await store.deletePostComment(2);
    const call = getCalls('post_comments', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 2] });
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store.ts apps/crm/src/__tests__/store.comments.test.ts
git commit -m "feat: add comment thread types and store CRUD functions"
```

---

### Task 3: Custom TipTap CommentHighlight mark extension

**Files:**
- Create: `apps/crm/src/pages/entregas/components/CommentHighlight.ts`

- [ ] **Step 1: Create the custom mark extension**

```typescript
import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentHighlight: {
      setCommentHighlight: (attrs: { threadId: number }) => ReturnType;
      unsetCommentHighlight: (threadId: number) => ReturnType;
      updateCommentResolved: (threadId: number, resolved: boolean) => ReturnType;
    };
  }
}

export const CommentHighlight = Mark.create({
  name: 'commentHighlight',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-thread-id')),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-thread-id': attrs.threadId }),
      },
      resolved: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-resolved') === 'true',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-resolved': String(attrs.resolved) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-thread-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'comment-highlight',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentHighlight:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetCommentHighlight:
        (threadId) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state;
          const markType = state.schema.marks[this.name];
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type === markType && mark.attrs.threadId === threadId) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
              }
            });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      updateCommentResolved:
        (threadId, resolved) =>
        ({ tr, state, dispatch }) => {
          const { doc } = state;
          const markType = state.schema.marks[this.name];
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type === markType && mark.attrs.threadId === threadId) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
                tr.addMark(pos, pos + node.nodeSize, markType.create({ ...mark.attrs, resolved }));
              }
            });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
```

- [ ] **Step 2: Run build to typecheck**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/CommentHighlight.ts
git commit -m "feat: add CommentHighlight custom TipTap mark extension"
```

---

### Task 4: CSS styles for comments

**Files:**
- Modify: `apps/crm/style.css` (add after the existing PostEditor section, before `/* ── Edit Workflow Modal footer */`)

- [ ] **Step 1: Find insertion point**

Search for `/* ── Edit Workflow Modal footer */` or the last PostEditor rule in style.css. Insert new CSS before it.

- [ ] **Step 2: Add comment highlight styles**

```css
/* ── PostEditor: Inline comment highlights ─────────────────── */
.comment-highlight {
  background-color: rgba(234, 179, 8, 0.15);
  border-bottom: 2px solid rgba(234, 179, 8, 0.4);
  cursor: pointer;
  border-radius: 2px;
  transition: background-color 0.15s ease;
}
.comment-highlight:hover {
  background-color: rgba(234, 179, 8, 0.25);
}
.comment-highlight[data-resolved="true"] {
  background-color: rgba(0, 0, 0, 0.04);
  border-bottom-color: rgba(0, 0, 0, 0.1);
}
.comment-highlight[data-resolved="true"]:hover {
  background-color: rgba(0, 0, 0, 0.08);
}

[data-theme="dark"] .comment-highlight {
  background-color: rgba(234, 179, 8, 0.12);
  border-bottom-color: rgba(234, 179, 8, 0.35);
}
[data-theme="dark"] .comment-highlight:hover {
  background-color: rgba(234, 179, 8, 0.2);
}
[data-theme="dark"] .comment-highlight[data-resolved="true"] {
  background-color: rgba(255, 255, 255, 0.04);
  border-bottom-color: rgba(255, 255, 255, 0.08);
}
[data-theme="dark"] .comment-highlight[data-resolved="true"]:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

/* ── Comment thread popover ─────────────────────────────────── */
.comment-popover-anchor {
  position: relative;
}
.comment-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 60;
  width: 320px;
  max-height: 400px;
  display: flex;
  flex-direction: column;
  background: var(--surface-main);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  font-size: 0.82rem;
  overflow: hidden;
}
[data-theme="dark"] .comment-popover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.comment-popover-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
}
.comment-popover-quoted {
  font-style: italic;
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.4;
  flex: 1;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.comment-popover-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}
.comment-popover-action-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.2rem;
  border-radius: 4px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.comment-popover-action-btn:hover {
  background: var(--surface-hover);
  color: var(--text-main);
}

.comment-popover-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.comment-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.comment-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
.comment-item-author {
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--text-main);
}
.comment-item-date {
  font-size: 0.68rem;
  color: var(--text-muted);
}
.comment-item-content {
  color: var(--text-main);
  line-height: 1.45;
  white-space: pre-wrap;
  margin: 0;
}
.comment-item-edited {
  font-size: 0.65rem;
  color: var(--text-muted);
  font-style: italic;
}
.comment-item-actions {
  display: flex;
  gap: 0.25rem;
  margin-top: 0.1rem;
}
.comment-item-action {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: 4px;
  font-size: 0.7rem;
  color: var(--text-muted);
  transition: background 0.15s ease, color 0.15s ease;
}
.comment-item-action:hover {
  background: var(--surface-hover);
  color: var(--text-main);
}
.comment-item-action--danger:hover {
  color: var(--danger);
}

.comment-popover-footer {
  display: flex;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-color);
}
.comment-reply-input {
  flex: 1;
  background: var(--surface-hover);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  font-family: var(--font-main);
  color: var(--text-main);
  resize: none;
  min-height: 32px;
  max-height: 80px;
}
.comment-reply-input:focus {
  outline: none;
  border-color: var(--primary-color);
}
.comment-reply-submit {
  background: var(--primary-color);
  color: #12151a;
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-end;
  transition: opacity 0.15s ease;
}
.comment-reply-submit:hover {
  opacity: 0.85;
}
.comment-reply-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Edit mode inline input */
.comment-edit-input {
  width: 100%;
  background: var(--surface-hover);
  border: 1px solid var(--primary-color);
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  font-family: var(--font-main);
  color: var(--text-main);
  resize: none;
  min-height: 28px;
}
.comment-edit-actions {
  display: flex;
  gap: 0.3rem;
  margin-top: 0.2rem;
}
.comment-edit-save,
.comment-edit-cancel {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
}
.comment-edit-save {
  color: var(--primary-color);
}
.comment-edit-save:hover { opacity: 0.8; }
.comment-edit-cancel {
  color: var(--text-muted);
}
.comment-edit-cancel:hover { opacity: 0.8; }

/* ── Add comment popover (from BubbleMenu) ─────────────────── */
.comment-add-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 55;
  width: 280px;
  background: var(--surface-main);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
[data-theme="dark"] .comment-add-popover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.comment-add-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
}
.comment-add-input {
  background: var(--surface-hover);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  font-size: 0.8rem;
  font-family: var(--font-main);
  color: var(--text-main);
  resize: none;
  min-height: 48px;
}
.comment-add-input:focus {
  outline: none;
  border-color: var(--primary-color);
}
.comment-add-submit {
  align-self: flex-end;
  background: var(--primary-color);
  color: #12151a;
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.8rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}
.comment-add-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Comment summary list (below editor) ───────────────────── */
.comment-summary {
  margin-top: 0.75rem;
}
.comment-summary-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.4rem 0;
  user-select: none;
}
.comment-summary-header:hover {
  opacity: 0.8;
}
.comment-summary-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
}
.comment-summary-count {
  font-size: 0.68rem;
  color: var(--text-light);
  font-weight: 500;
}
.comment-summary-toggle {
  margin-left: auto;
  font-size: 0.68rem;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  transition: background 0.15s ease;
}
.comment-summary-toggle:hover {
  background: var(--surface-hover);
}
.comment-summary-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.4rem;
}
.comment-summary-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  border: 1px solid transparent;
}
.comment-summary-item:hover {
  background: var(--surface-hover);
  border-color: var(--border-color);
}
.comment-summary-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 0.3rem;
  flex-shrink: 0;
}
.comment-summary-dot--active {
  background: var(--primary-color);
}
.comment-summary-dot--resolved {
  background: var(--text-muted);
  opacity: 0.4;
}
.comment-summary-content {
  flex: 1;
  min-width: 0;
}
.comment-summary-quote {
  font-size: 0.72rem;
  font-style: italic;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comment-summary-preview {
  font-size: 0.78rem;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 0.1rem;
}
.comment-summary-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.15rem;
}
.comment-summary-author {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-muted);
}
.comment-summary-date {
  font-size: 0.65rem;
  color: var(--text-light);
}
.comment-summary-replies {
  font-size: 0.65rem;
  color: var(--text-muted);
  margin-left: auto;
}
```

- [ ] **Step 3: Run build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add apps/crm/style.css
git commit -m "style: add inline comment highlight, popover, and summary CSS"
```

---

### Task 5: PostCommentPopover component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PostCommentPopover.tsx`

**Context:** This component renders a popover showing a comment thread — header with quoted text, list of comments with edit/delete actions, and a reply input. It receives the thread data, current user info (userId, role), and callbacks for CRUD operations. It uses the `Membro` type from store.ts to resolve author names.

The popover is positioned via CSS (see `.comment-popover` in style.css). The parent component controls visibility and positioning.

**Props:**

```typescript
interface PostCommentPopoverProps {
  thread: CommentThreadWithComments;
  membros: Membro[];
  currentUserId: string;
  currentUserRole: 'owner' | 'admin' | 'agent';
  onReply: (threadId: number, content: string) => Promise<void>;
  onResolve: (threadId: number) => Promise<void>;
  onReopen: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
  onClose: () => void;
  readOnly?: boolean;
}
```

**Key behaviors:**
- Shows each comment with author name (resolved from `membros` via `user_id` match to `author_id`), relative timestamp, and content
- Edit button visible only on user's own comments; shows inline textarea with save/cancel
- Delete button visible on own comments or if user is owner/admin
- Resolve/Reopen button in header
- Reply input at bottom with Enter to submit (Shift+Enter for newline)
- If `readOnly`, hide reply input, resolve/reopen, edit/delete
- Close on Escape key or clicking the X button
- Shows "(editado)" label if `updated_at` is set on a comment
- Fallback author name: "Membro" if user_id not found in membros list

- [ ] **Step 1: Create the component**

Implement the full component with all the behaviors described above. Use lucide-react icons: `X`, `Check`, `RotateCcw`, `Pencil`, `Trash2`. Import `CommentThreadWithComments`, `PostComment`, `Membro` from `@/store`.

- [ ] **Step 2: Run build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostCommentPopover.tsx
git commit -m "feat: add PostCommentPopover thread view component"
```

---

### Task 6: PostCommentSummary component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PostCommentSummary.tsx`

**Context:** This component renders a collapsible list of all comment threads for a post, shown below the PostEditor. Each thread item displays a colored dot (yellow active / gray resolved), quoted text, first comment preview, author name, timestamp, and reply count.

**Props:**

```typescript
interface PostCommentSummaryProps {
  threads: CommentThreadWithComments[];
  membros: Membro[];
  onThreadClick: (threadId: number) => void;
  readOnly?: boolean;
}
```

**Key behaviors:**
- Collapsible via a chevron icon in the header — collapsed by default if no active threads
- Header shows "Comentários internos (N)" where N is total thread count
- Toggle button to show/hide resolved threads — default shows active only
- Each item is clickable → calls `onThreadClick(threadId)` so the parent can scroll to the text and open the popover
- Resolve author names from membros (match `thread.created_by` to `membro.user_id`)
- Use `date-fns` `formatDistanceToNow` with `{ locale: ptBR, addSuffix: true }` for relative timestamps
- If no threads exist, don't render anything

- [ ] **Step 1: Create the component**

Implement the full component. Use lucide-react icons: `MessageSquare`, `ChevronDown`, `ChevronRight`. Import types from `@/store`.

- [ ] **Step 2: Run build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostCommentSummary.tsx
git commit -m "feat: add PostCommentSummary collapsible thread list component"
```

---

### Task 7: PostEditor integration — extension, BubbleMenu button, click handling

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostEditor.tsx`

**Context:** The PostEditor currently has a BubbleMenu with inline formatting buttons (bold, italic, underline, link, text color, highlight). We need to:

1. Register the `CommentHighlight` extension
2. Add a comment button (MessageSquare icon) after a second divider in the BubbleMenu
3. Add an "add comment" popover that opens when the comment button is clicked
4. Handle click events on comment-highlighted text to notify the parent
5. Add new props for thread data and callbacks

**Current PostEditor props (to be extended):**

```typescript
interface PostEditorProps {
  initialContent: Record<string, unknown> | null;
  onUpdate: (json: Record<string, unknown>, plain: string) => void;
  disabled?: boolean;
  // New props:
  threads?: CommentThreadWithComments[];
  membros?: Membro[];
  currentUserId?: string;
  currentUserRole?: 'owner' | 'admin' | 'agent';
  onCreateComment?: (quotedText: string, comment: string, from: number, to: number) => Promise<number>;
  onReplyToComment?: (threadId: number, content: string) => Promise<void>;
  onResolveThread?: (threadId: number) => Promise<void>;
  onReopenThread?: (threadId: number) => Promise<void>;
  onEditComment?: (commentId: number, content: string) => Promise<void>;
  onDeleteComment?: (commentId: number, threadId: number) => Promise<void>;
}
```

**Changes to make:**

1. Import `CommentHighlight` from `./CommentHighlight` and add to the extensions array
2. Import `MessageSquare` from lucide-react
3. Import `PostCommentPopover` from `./PostCommentPopover`
4. Add state: `commentAddOpen` (boolean), `commentAddText` (string), `activeThreadId` (number | null), `activeThreadPos` (DOMRect | null)
5. Add the comment button after a second `<div className="post-editor-divider" />` at the end of BubbleMenu, wrapped in a `.comment-add-wrapper` (position: relative) div
6. When comment button is clicked: save the current selection range, open the add-comment popover
7. When add-comment is submitted: call `onCreateComment` with the quoted text and comment → receives the new threadId → apply `setCommentHighlight({ threadId })` mark to the saved selection range → close popover
8. Register a click handler on the editor content: when a click lands on a `span.comment-highlight`, extract the `data-thread-id` and set `activeThreadId` → show the `PostCommentPopover` positioned near the clicked element
9. When a thread is resolved/reopened, call `editor.commands.updateCommentResolved(threadId, resolved)` to update the mark
10. When a thread is deleted (last comment removed), call `editor.commands.unsetCommentHighlight(threadId)` to remove the mark
11. Close the popover when clicking outside it (reuse the outside-click pattern from the color dropdowns)

**BubbleMenu layout after changes:**

```
[ B ] [ I ] [ U ] [ Link ] [ | ] [ A▾ ] [ H▾ ] [ | ] [ 💬 ]
```

The `💬` button opens the add-comment popover below it. When text already has a comment mark, clicking it opens the thread popover instead.

- [ ] **Step 1: Update PostEditor with new props, imports, and state**
- [ ] **Step 2: Register CommentHighlight extension**
- [ ] **Step 3: Add comment button to BubbleMenu with add-comment popover**
- [ ] **Step 4: Add click handler for comment-highlighted text → show PostCommentPopover**
- [ ] **Step 5: Wire resolve/reopen/delete to update marks via editor commands**
- [ ] **Step 6: Run build**

```bash
npm run build
```

- [ ] **Step 7: Run tests**

```bash
npm run test
```

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostEditor.tsx
git commit -m "feat: integrate inline comments into PostEditor with BubbleMenu and popovers"
```

---

### Task 8: WorkflowDrawer + HistoryDrawer integration

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`
- Modify: `apps/crm/src/pages/entregas/components/HistoryDrawer.tsx`

**Context:** WorkflowDrawer renders PostEditor inside a `SortablePostItem` accordion for each post. It already fetches `membros` and `approvals` via React Query. HistoryDrawer renders PostEditor in disabled mode with approval threads.

**WorkflowDrawer changes:**

1. Import store functions: `getPostCommentThreads`, `createCommentThread`, `addPostComment`, `updatePostComment`, `deletePostComment`, `resolveCommentThread`, `reopenCommentThread`, `deleteCommentThread`
2. Import `PostCommentSummary` from `./PostCommentSummary`
3. Import `CommentThreadWithComments` type
4. Add React Query for comment threads (similar pattern to approvals):

```typescript
const { data: commentThreads = [], refetch: refetchComments } = useQuery({
  queryKey: ['post-comment-threads', postIds.join(',')],
  queryFn: () => getPostCommentThreads(postIds),
  enabled: postIds.length > 0,
});
```

5. Get `user` and `role` from `useAuth()`
6. Create handler functions that call store functions and refetch:

```typescript
const handleCreateComment = async (postId: number, quotedText: string, comment: string, from: number, to: number) => {
  const thread = await createCommentThread(postId, quotedText, comment);
  await refetchComments();
  return thread.id;
};
// ... similar for reply, resolve, reopen, edit, delete
```

7. Pass new props to PostEditor in the SortablePostItem render:

```typescript
<PostEditor
  initialContent={post.conteudo}
  onUpdate={onContentUpdate}
  disabled={isReadonly}
  threads={commentThreads.filter(t => t.post_id === post.id)}
  membros={membros}
  currentUserId={user?.id}
  currentUserRole={role}
  onCreateComment={(qt, c, f, t) => handleCreateComment(post.id!, qt, c, f, t)}
  onReplyToComment={handleReply}
  onResolveThread={handleResolve}
  onReopenThread={handleReopen}
  onEditComment={handleEditComment}
  onDeleteComment={handleDeleteComment}
/>
```

8. Add PostCommentSummary below the PostEditor for each post:

```typescript
<PostCommentSummary
  threads={commentThreads.filter(t => t.post_id === post.id)}
  membros={membros}
  onThreadClick={(threadId) => { /* scroll to comment in editor */ }}
/>
```

**HistoryDrawer changes:**

1. Import `getPostCommentThreads` and `PostCommentSummary`
2. Add React Query for comment threads (same pattern)
3. Pass `threads` and `membros` to PostEditor (already disabled)
4. Add PostCommentSummary below PostEditor with `readOnly` prop

- [ ] **Step 1: Update WorkflowDrawer with comment thread fetching and handlers**
- [ ] **Step 2: Pass new props to PostEditor in WorkflowDrawer**
- [ ] **Step 3: Add PostCommentSummary to WorkflowDrawer**
- [ ] **Step 4: Update HistoryDrawer with read-only comment threads**
- [ ] **Step 5: Run build**

```bash
npm run build
```

- [ ] **Step 6: Run tests**

```bash
npm run test
```

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/pages/entregas/components/HistoryDrawer.tsx
git commit -m "feat: integrate inline comment threads into WorkflowDrawer and HistoryDrawer"
```
