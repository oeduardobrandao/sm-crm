import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, afterAll } from 'vitest';
import { PostEditor } from '../PostEditor';

vi.mock('@/store', () => ({
  getMembros: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  getTarefas: vi.fn(async () => []),
}));
vi.mock('@/store/posts', () => ({
  searchPostsForMention: vi.fn(async () => []),
}));

// Same BubbleMenu debounce drain as PostEditorLinkPopover.test.tsx.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 300)));

const CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
};

/**
 * TipTap v3's `setEditable(editable, emitUpdate = true)` emits `update`, and PostEditor's
 * editability effect called it bare. In a real browser the editor's deferred `create`
 * (a setTimeout(0)) usually lands before that effect, so every open reached onUpdate and
 * the drawers autosaved the post (a new post_content_versions row, with the injected
 * signed image URL persisted). jsdom flushes the effect first, so a plain mount can't
 * reproduce it; flushing the `create` timer and then toggling `disabled` drives the same
 * setEditable call after the editor is initialized.
 */
describe('PostEditor: editability changes are not content edits', () => {
  it('does not call onUpdate on mount or when disabled toggles, but does on a real edit', async () => {
    const onUpdate = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (disabled: boolean) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PostEditor initialContent={CONTENT} onUpdate={onUpdate} disabled={disabled} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const { rerender } = render(wrap(false));
    await screen.findByRole('textbox');
    // Let the editor's deferred `create` fire so PostEditor's isInitialized guard is open.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    rerender(wrap(true));
    rerender(wrap(false));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(onUpdate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('textbox'));
    await userEvent.keyboard('x');
    expect(onUpdate).toHaveBeenCalled();
  });
});
