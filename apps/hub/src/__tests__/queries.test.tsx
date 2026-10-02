import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchBootstrap: vi.fn(),
  fetchPosts: vi.fn(),
  fetchOlderPosts: vi.fn(),
  fetchPostsInRange: vi.fn(),
  fetchPost: vi.fn(),
}));

import { fetchBootstrap, fetchOlderPosts, fetchPosts, fetchPostsInRange } from '../api';
import {
  createHubQueryClient,
  hubBootstrapQuery,
  hubPostsHistoryKey,
  hubPostsQuery,
  hubPostsRangeQuery,
  invalidateHubPosts,
  prefetchHubShell,
} from '../queries';

const mockedFetchBootstrap = vi.mocked(fetchBootstrap);
const mockedFetchPosts = vi.mocked(fetchPosts);

describe('prefetchHubShell', () => {
  beforeEach(() => {
    mockedFetchBootstrap.mockReset().mockResolvedValue({} as never);
    mockedFetchPosts.mockReset().mockResolvedValue({ posts: [] } as never);
  });

  it('starts bootstrap and posts for any route under a hub link', () => {
    const qc = createHubQueryClient();
    prefetchHubShell(qc, '/mesaas/hub/token-publico/aprovacoes/12');

    expect(mockedFetchBootstrap).toHaveBeenCalledWith('mesaas', 'token-publico');
    expect(mockedFetchPosts).toHaveBeenCalledWith('token-publico');
  });

  it('does nothing outside a hub link', () => {
    const qc = createHubQueryClient();
    prefetchHubShell(qc, '/relatorios/print/doc-1');
    prefetchHubShell(qc, '/');

    expect(mockedFetchBootstrap).not.toHaveBeenCalled();
    expect(mockedFetchPosts).not.toHaveBeenCalled();
  });

  it('a posts reader mounting after the prefetch landed does not refetch', async () => {
    const qc = createHubQueryClient();
    prefetchHubShell(qc, '/mesaas/hub/token-publico');
    await waitFor(() =>
      expect(qc.getQueryState(['hub-posts', 'token-publico'])?.status).toBe('success'),
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    // Same inline options the pages use.
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['hub-posts', 'token-publico'],
          queryFn: () => fetchPosts('token-publico'),
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isFetching).toBe(false);
    expect(mockedFetchPosts).toHaveBeenCalledTimes(1);
  });

  it('a failed bootstrap is not retried when HubShell mounts', async () => {
    mockedFetchBootstrap.mockRejectedValue(new Error('Link inválido.'));
    const qc = createHubQueryClient();
    prefetchHubShell(qc, '/mesaas/hub/token-ruim');
    await waitFor(() =>
      expect(qc.getQueryState(['hub-bootstrap', 'mesaas', 'token-ruim'])?.status).toBe('error'),
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useQuery(hubBootstrapQuery('mesaas', 'token-ruim')), {
      wrapper,
    });

    expect(result.current.error?.message).toBe('Link inválido.');
    expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateHubPosts', () => {
  it('refetches the shell but only marks loaded history pages and range months stale', async () => {
    mockedFetchPosts.mockReset().mockResolvedValue({ posts: [] } as never);
    const olderMock = vi
      .mocked(fetchOlderPosts)
      .mockReset()
      .mockResolvedValue({ posts: [], nextCursor: null } as never);
    const rangeMock = vi
      .mocked(fetchPostsInRange)
      .mockReset()
      .mockResolvedValue({ posts: [] } as never);
    const qc = createHubQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    renderHook(
      () => {
        useQuery(hubPostsQuery('tk'));
        useInfiniteQuery({
          queryKey: hubPostsHistoryKey('tk', 'c|0'),
          queryFn: ({ pageParam }) => fetchOlderPosts('tk', pageParam),
          initialPageParam: 'c|0',
          getNextPageParam: () => undefined,
        });
        useQuery(hubPostsRangeQuery('tk', '2025-11-01T03:00:00.000Z', '2025-12-01T03:00:00.000Z'));
      },
      { wrapper },
    );
    await waitFor(() => expect(rangeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(olderMock).toHaveBeenCalledTimes(1));

    await invalidateHubPosts(qc, 'tk');

    expect(mockedFetchPosts).toHaveBeenCalledTimes(2);
    expect(olderMock).toHaveBeenCalledTimes(1);
    expect(rangeMock).toHaveBeenCalledTimes(1);
    expect(qc.getQueryState(hubPostsHistoryKey('tk', 'c|0'))?.isInvalidated).toBe(true);
  });
});
