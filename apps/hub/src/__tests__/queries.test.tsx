import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchBootstrap: vi.fn(),
  fetchPosts: vi.fn(),
}));

import { fetchBootstrap, fetchPosts } from '../api';
import { createHubQueryClient, hubBootstrapQuery, prefetchHubShell } from '../queries';

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
