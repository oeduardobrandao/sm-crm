import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ can: makeCan(fakeMembership({ role: 'owner' })) })),
}));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMembros: vi.fn().mockResolvedValue([]),
  getClientes: vi.fn().mockResolvedValue([]),
  getTarefas: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/store/posts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  searchPostsForMention: vi.fn().mockResolvedValue([]),
}));
vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from 'sonner';
import { getMembros, getClientes, getTarefas } from '@/store';
import type { CommentThreadWithComments } from '@/store';
import { InstagramCaptionField, type InstagramCaptionFieldHandle } from '../InstagramCaptionField';

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const caption = 'hello brave new world';
const threadFor = (over = {}): CommentThreadWithComments => ({
  id: 1,
  post_id: 10,
  conta_id: 'c',
  quoted_text: 'brave',
  status: 'active',
  created_by: 'user-1',
  resolved_by: null,
  created_at: '2026-01-01T00:00:00Z',
  resolved_at: null,
  field: 'ig_caption',
  anchor_start: 6,
  anchor_end: 11,
  orphaned: false,
  post_comments: [
    {
      id: 1,
      thread_id: 1,
      author_id: 'user-1',
      content: 'trocar',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: null,
    },
  ],
  ...over,
});
const handlers = (over = {}) => ({
  membros: [],
  workspaceUsers: [],
  currentUserId: 'user-1',
  onCreateThread: vi.fn().mockResolvedValue(2),
  onReply: vi.fn(),
  onResolve: vi.fn(),
  onReopen: vi.fn(),
  onEditComment: vi.fn(),
  onDeleteComment: vi.fn(),
  ...over,
});
const textarea = () => screen.getByPlaceholderText(/Texto exato/) as HTMLTextAreaElement;
const select = (start: number, end: number) => {
  textarea().setSelectionRange(start, end);
  fireEvent.select(textarea());
};
const marks = () => document.querySelectorAll('.caption-mirror mark');

describe('InstagramCaptionField', () => {
  // The global test setup resets mock implementations between tests, so the mention
  // sources must be re-armed here or useQuery sees `undefined` data.
  beforeEach(() => {
    vi.mocked(getMembros).mockResolvedValue([]);
    vi.mocked(getClientes).mockResolvedValue([]);
    vi.mocked(getTarefas).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('paints active highlights in the mirror', () => {
    render(<InstagramCaptionField value={caption} threads={[threadFor()]} onSave={vi.fn()} />);
    expect(document.querySelector('.caption-mirror mark[data-thread-ids="1"]')?.textContent).toBe(
      'brave',
    );
  });

  it('does not paint resolved or orphaned threads', () => {
    const { unmount } = render(
      <InstagramCaptionField
        value={caption}
        threads={[threadFor({ status: 'resolved' })]}
        onSave={vi.fn()}
      />,
    );
    expect(marks()).toHaveLength(0);
    unmount();
    render(
      <InstagramCaptionField
        value={caption}
        threads={[threadFor({ orphaned: true, anchor_start: null, anchor_end: null })]}
        onSave={vi.fn()}
      />,
    );
    expect(marks()).toHaveLength(0);
  });

  it('ignores content threads', () => {
    render(
      <InstagramCaptionField
        value={caption}
        threads={[threadFor({ field: 'conteudo', anchor_start: null, anchor_end: null })]}
        onSave={vi.fn()}
      />,
    );
    expect(marks()).toHaveLength(0);
  });

  it('disables Comentar without a selection and enables it with one', () => {
    render(
      <InstagramCaptionField value={caption} threads={[]} onSave={vi.fn()} comments={handlers()} />,
    );
    const btn = screen.getByRole('button', { name: /Comentar/ });
    expect(btn).toBeDisabled();
    select(6, 11);
    expect(btn).toBeEnabled();
  });

  it('creates an anchored thread', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const comments = handlers();
    render(
      <InstagramCaptionField value={caption} threads={[]} onSave={onSave} comments={comments} />,
    );
    select(6, 11);
    fireEvent.click(screen.getByRole('button', { name: /Comentar/ }));
    fireEvent.change(screen.getByPlaceholderText('Escreva seu comentário...'), {
      target: { value: 'ajustar' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Comentar' }).at(-1)!);
    await waitFor(() =>
      expect(comments.onCreateThread).toHaveBeenCalledWith('brave', 'ajustar', {
        field: 'ig_caption',
        start: 6,
        end: 11,
      }),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('flushes a pending edit before creating the thread', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const comments = handlers();
    render(
      <InstagramCaptionField value={caption} threads={[]} onSave={onSave} comments={comments} />,
    );
    fireEvent.change(textarea(), { target: { value: 'oh ' + caption } });
    select(9, 14);
    fireEvent.click(screen.getByRole('button', { name: /Comentar/ }));
    fireEvent.change(screen.getByPlaceholderText('Escreva seu comentário...'), {
      target: { value: 'ajustar' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Comentar' }).at(-1)!);
    await waitFor(() => expect(comments.onCreateThread).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0]).toMatch(/^oh hello/);
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
      comments.onCreateThread.mock.invocationCallOrder[0],
    );
  });

  it('aborts when the flush fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    const comments = handlers();
    render(
      <InstagramCaptionField value={caption} threads={[]} onSave={onSave} comments={comments} />,
    );
    fireEvent.change(textarea(), { target: { value: 'oh ' + caption } });
    select(9, 14);
    fireEvent.click(screen.getByRole('button', { name: /Comentar/ }));
    fireEvent.change(screen.getByPlaceholderText('Escreva seu comentário...'), {
      target: { value: 'ajustar' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Comentar' }).at(-1)!);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await act(async () => {});
    expect(comments.onCreateThread).not.toHaveBeenCalled();
  });

  it('toasts and keeps the popover open when creating the thread fails', async () => {
    const comments = handlers({ onCreateThread: vi.fn().mockRejectedValue(new Error('boom')) });
    render(
      <InstagramCaptionField
        value={caption}
        threads={[]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        comments={comments}
      />,
    );
    select(6, 11);
    fireEvent.click(screen.getByRole('button', { name: /Comentar/ }));
    fireEvent.change(screen.getByPlaceholderText('Escreva seu comentário...'), {
      target: { value: 'ajustar' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Comentar' }).at(-1)!);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível criar o comentário.'),
    );
    expect(screen.getByPlaceholderText('Escreva seu comentário...')).toBeInTheDocument();
  });

  it('opens the thread popover on a click inside a highlight', () => {
    render(
      <InstagramCaptionField
        value={caption}
        threads={[threadFor()]}
        onSave={vi.fn()}
        comments={handlers()}
      />,
    );
    const mark = document.querySelector('.caption-mirror mark')!;
    vi.spyOn(mark, 'getClientRects').mockReturnValue([
      { left: 0, right: 100, top: 0, bottom: 20 },
    ] as unknown as DOMRectList);
    textarea().setSelectionRange(8, 8);
    fireEvent.click(textarea(), { clientX: 10, clientY: 10 });
    expect(screen.getByText('trocar')).toBeInTheDocument();
  });

  it('does not open the popover for a click that ends a drag selection', () => {
    render(
      <InstagramCaptionField
        value={caption}
        threads={[threadFor()]}
        onSave={vi.fn()}
        comments={handlers()}
      />,
    );
    const mark = document.querySelector('.caption-mirror mark')!;
    vi.spyOn(mark, 'getClientRects').mockReturnValue([
      { left: 0, right: 100, top: 0, bottom: 20 },
    ] as unknown as DOMRectList);
    textarea().setSelectionRange(6, 11);
    fireEvent.click(textarea(), { clientX: 10, clientY: 10 });
    expect(screen.queryByText('trocar')).not.toBeInTheDocument();
  });

  it('locked field is readOnly, not disabled, and still allows commenting', () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <InstagramCaptionField
        value={caption}
        threads={[]}
        disabled
        lockedMessage="Cancelar agendamento para editar"
        onSave={onSave}
        comments={handlers()}
      />,
    );
    expect(textarea()).toHaveAttribute('readonly');
    expect(textarea()).not.toBeDisabled();
    expect(container.querySelector('svg.lucide-lock')).toBeInTheDocument();
    select(6, 11);
    expect(screen.getByRole('button', { name: /Comentar/ })).toBeEnabled();
    fireEvent.change(textarea(), { target: { value: caption + '!' } });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the char counter', () => {
    render(<InstagramCaptionField value={caption} threads={[]} onSave={vi.fn()} />);
    expect(screen.getByText('21 / 2200')).toBeInTheDocument();
  });

  it('keeps the highlight on its text after an edit', () => {
    render(<InstagramCaptionField value={caption} threads={[threadFor()]} onSave={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: 'oh ' + caption } });
    expect(document.querySelector('.caption-mirror mark[data-thread-ids="1"]')?.textContent).toBe(
      'brave',
    );
  });

  it('focusThread selects the anchored range and shows the thread popover', () => {
    const ref = createRef<InstagramCaptionFieldHandle>();
    render(
      <InstagramCaptionField
        ref={ref}
        value={caption}
        threads={[threadFor()]}
        onSave={vi.fn()}
        comments={handlers()}
      />,
    );
    act(() => ref.current!.focusThread(1));
    expect(textarea().selectionStart).toBe(6);
    expect(textarea().selectionEnd).toBe(11);
    expect(screen.getByText('trocar')).toBeInTheDocument();
  });
});
