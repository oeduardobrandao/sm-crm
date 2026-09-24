import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const store = vi.hoisted(() => ({ getActivePosts: vi.fn() }));
vi.mock('../../../../store', () => store);
vi.mock('../../../../lib/supabase');

import { useActivePosts } from '../useActivePosts';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('useActivePosts', () => {
  beforeEach(() => {
    store.getActivePosts.mockReset();
  });

  it('does not fetch while disabled and serves a stable empty array', () => {
    const { result, rerender } = renderHook(() => useActivePosts(false), { wrapper: wrapper() });
    const before = result.current.posts;
    expect(before).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    rerender();
    expect(result.current.posts).toBe(before);
    expect(store.getActivePosts).not.toHaveBeenCalled();
  });

  it('reports isError when the fetch rejects', async () => {
    store.getActivePosts.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useActivePosts(true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.posts).toEqual([]);
  });

  it('reports isPending before the first resolve and not after', async () => {
    let resolve!: (v: unknown) => void;
    store.getActivePosts.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useActivePosts(true), { wrapper: wrapper() });
    expect(result.current.isPending).toBe(true);
    resolve([{ id: 1, status: 'rascunho', scheduled_at: null }]);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.posts).toHaveLength(1);
  });

  it('returns the posts once resolved', async () => {
    store.getActivePosts.mockResolvedValue([{ id: 1, status: 'rascunho', scheduled_at: null }]);
    const { result } = renderHook(() => useActivePosts(true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(result.current.isError).toBe(false);
  });

  it('keeps isError false and the cached posts when a background refetch fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const w = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    store.getActivePosts.mockResolvedValueOnce([{ id: 1, status: 'rascunho', scheduled_at: null }]);
    const { result } = renderHook(() => useActivePosts(true), { wrapper: w });
    await waitFor(() => expect(result.current.posts).toHaveLength(1));

    store.getActivePosts.mockRejectedValueOnce(new Error('boom'));
    await client.refetchQueries({ queryKey: ['active-posts'] });
    await waitFor(() => expect(client.getQueryState(['active-posts'])?.status).toBe('error'));
    expect(result.current.isError).toBe(false);
    expect(result.current.posts).toHaveLength(1);
  });
});
