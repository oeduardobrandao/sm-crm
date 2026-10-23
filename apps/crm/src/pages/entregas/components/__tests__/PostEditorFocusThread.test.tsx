import { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentThreadWithComments } from '@/store';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { editorOf } from '@/test/mentionEditor';
import { PostEditor, type PostEditorHandle } from '../PostEditor';

// Mention data for the editor and the popover's reply box; never reached here.
vi.mock('@/store', () => ({
  getMembros: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  getTarefas: vi.fn(async () => []),
}));
vi.mock('@/store/posts', () => ({
  searchPostsForMention: vi.fn(async () => []),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ can: makeCan(fakeMembership({ role: 'owner' })) }),
}));

afterEach(() => vi.clearAllMocks());
// BubbleMenu leaves a 250ms debounce timer behind on destroy (see PostEditorLinkPopover).
afterAll(() => new Promise((resolve) => setTimeout(resolve, 300)));

const CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Olá ' },
        {
          type: 'text',
          text: 'trecho',
          marks: [{ type: 'commentHighlight', attrs: { threadId: 1, resolved: false } }],
        },
        { type: 'text', text: ' fim' },
      ],
    },
  ],
};

function thread(id: number, quoted: string): CommentThreadWithComments {
  return {
    id,
    post_id: 42,
    conta_id: 'ws-1',
    quoted_text: quoted,
    status: 'active',
    created_by: 'user-1',
    resolved_by: null,
    created_at: '2026-10-21T10:00:00Z',
    resolved_at: null,
    field: 'conteudo',
    anchor_start: null,
    anchor_end: null,
    orphaned: false,
    post_comments: [
      {
        id: id * 10,
        thread_id: id,
        author_id: 'user-1',
        content: `Comentário ${id}`,
        created_at: '2026-10-21T10:00:00Z',
        updated_at: null,
      },
    ],
  } as unknown as CommentThreadWithComments;
}

async function renderEditor(variant: 'default' | 'phone' = 'default') {
  const ref = createRef<PostEditorHandle>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PostEditor
          ref={ref}
          variant={variant}
          initialContent={CONTENT}
          onUpdate={vi.fn()}
          threads={[thread(1, 'trecho'), thread(2, 'apagado')]}
          membros={[]}
          currentUserId="user-1"
          currentUserRole="owner"
          onReplyToComment={vi.fn(async () => {})}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const mark = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('span.comment-highlight[data-thread-id="1"]');
    expect(el).not.toBeNull();
    return el!;
  });
  const editorDom = mark.closest<HTMLElement>('.ProseMirror')!;
  return { ref, editor: editorOf(editorDom) };
}

const popoverQuote = () => document.querySelector('.comment-popover-quoted');

describe('PostEditor focusThread', () => {
  it('puts a caret at the commented passage and opens its popover without focusing the editor', async () => {
    const { ref, editor } = await renderEditor();
    expect(popoverQuote()).toBeNull();

    act(() => ref.current!.focusThread(1));

    await waitFor(() => expect(popoverQuote()).toHaveTextContent('trecho'));
    // "Olá " is positions 1..4 inside the paragraph; the mark starts at "trecho".
    // A collapsed caret, unfocused: a focused range would let the next keystroke
    // replace the commented passage.
    expect(editor.state.selection.from).toBe(5);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.isFocused).toBe(false);
  });

  it('phone: opens the popover with a caret at the passage, no focus', async () => {
    const { ref, editor } = await renderEditor('phone');

    act(() => ref.current!.focusThread(1));

    await waitFor(() => expect(popoverQuote()).toHaveTextContent('trecho'));
    expect(editor.state.selection.from).toBe(5);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.isFocused).toBe(false);
  });

  it('opens an orphaned thread (no mark left in the text) anchored to the editor', async () => {
    const { ref } = await renderEditor();

    act(() => ref.current!.focusThread(2));

    await waitFor(() => expect(popoverQuote()).toHaveTextContent('apagado'));
  });
});
