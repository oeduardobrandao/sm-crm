import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({ fetchPosts: vi.fn(), fetchOlderPosts: vi.fn() }));

import { fetchOlderPosts, fetchPosts } from '../../api';
import { useHubPosts } from '../useHubPosts';

const shellPost = (id: number) => ({ id, status: 'enviado_cliente', titulo: `S${id}` });
const oldPost = (id: number) => ({ id, status: 'postado', titulo: `O${id}` });
const approval = (id: number, post_id: number) => ({ id, post_id, action: 'aprovado' });

const posts = vi.mocked(fetchPosts);
const older = vi.mocked(fetchOlderPosts);

function setup(shell: Record<string, unknown>) {
  posts.mockResolvedValue(shell as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => useHubPosts('tk', { history: true }), { wrapper }) };
}

describe('useHubPosts', () => {
  beforeEach(() => {
    posts.mockReset();
    older.mockReset();
  });

  it('makes no history request on mount, even with an olderCursor', async () => {
    const { result } = setup({ posts: [shellPost(1)], postApprovals: [], olderCursor: 'c|0' });
    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(result.current.hasOlder).toBe(true);
    expect(older).not.toHaveBeenCalled();
  });

  it('loads pages on demand and merges posts and approvals, the shell winning', async () => {
    older
      .mockResolvedValueOnce({
        posts: [oldPost(1), oldPost(2)],
        postApprovals: [approval(20, 2)],
        nextCursor: 'n|2',
      } as never)
      .mockResolvedValueOnce({ posts: [oldPost(3)], postApprovals: [], nextCursor: null } as never);
    const { result } = setup({
      posts: [shellPost(1)],
      postApprovals: [approval(10, 1)],
      olderCursor: 'c|0',
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual([1, 2]));
    expect(older).toHaveBeenLastCalledWith('tk', 'c|0');
    expect(result.current.posts[0].titulo).toBe('S1');
    expect(result.current.postApprovals.map((a) => a.id)).toEqual([10, 20]);
    expect(result.current.hasOlder).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual([1, 2, 3]));
    expect(older).toHaveBeenLastCalledWith('tk', 'n|2');
    expect(result.current.hasOlder).toBe(false);
  });

  it('keeps hasOlder after a failed first page and retries on the next loadOlder', async () => {
    older
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ posts: [oldPost(2)], postApprovals: [], nextCursor: null } as never);
    const { result } = setup({ posts: [shellPost(1)], postApprovals: [], olderCursor: 'c|0' });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.olderError).toBe(true), { timeout: 3000 });
    expect(result.current.hasOlder).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual([1, 2]));
    expect(result.current.olderError).toBe(false);
  });

  it('treats a response without olderCursor (old backend) as complete', async () => {
    const { result } = setup({ posts: [shellPost(1)], postApprovals: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.hasOlder).toBe(false);
    act(() => result.current.loadOlder());
    expect(older).not.toHaveBeenCalled();
  });

  it('starts a fresh history when the shell comes back with a new cursor', async () => {
    older.mockResolvedValue({ posts: [oldPost(2)], postApprovals: [], nextCursor: null } as never);
    const { result, qc } = setup({ posts: [shellPost(1)], postApprovals: [], olderCursor: 'c|0' });
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.posts).toHaveLength(2));

    posts.mockResolvedValue({
      posts: [shellPost(1)],
      postApprovals: [],
      olderCursor: 'd|0',
    } as never);
    await act(() => qc.refetchQueries({ queryKey: ['hub-posts', 'tk'], exact: true }));

    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(result.current.hasOlder).toBe(true);
    act(() => result.current.loadOlder());
    await waitFor(() => expect(older).toHaveBeenLastCalledWith('tk', 'd|0'));
  });
});
