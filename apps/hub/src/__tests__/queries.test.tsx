import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  focusManager,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (importOriginal) => ({
  // Real HubApiError / isLoginRequired: the login handling matches on them.
  ...(await importOriginal<typeof import('../api')>()),
  fetchBootstrap: vi.fn(),
  fetchPosts: vi.fn(),
  fetchOlderPosts: vi.fn(),
  fetchPostsInRange: vi.fn(),
  fetchPost: vi.fn(),
}));

import {
  HubApiError,
  fetchBootstrap,
  fetchOlderPosts,
  fetchPosts,
  fetchPostsInRange,
  submitApproval,
  setLoginRequiredListener,
} from '../api';
import { HUB_SESSION_STORAGE_KEY } from '../lib/hubSession';
import {
  createHubQueryClient,
  HISTORY_OPTS,
  hubBootstrapQuery,
  hubPostsHistoryKey,
  hubPostsQuery,
  hubPostsRangeQuery,
  handleLoginRequired,
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

  it('prefetches with the hyphenated UUID when the link carries the compact token', () => {
    const qc = createHubQueryClient();
    prefetchHubShell(qc, '/mesaas/hub/b6a359fbaf56470a8f0a7e215a67b9b9/briefing');

    expect(mockedFetchBootstrap).toHaveBeenCalledWith(
      'mesaas',
      'b6a359fb-af56-470a-8f0a-7e215a67b9b9',
    );
    expect(mockedFetchPosts).toHaveBeenCalledWith('b6a359fb-af56-470a-8f0a-7e215a67b9b9');
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

describe('history and range options', () => {
  it('never go stale or refetch on window focus', () => {
    expect(HISTORY_OPTS).toMatchObject({ staleTime: Infinity, refetchOnWindowFocus: false });

    const range = hubPostsRangeQuery('tk', '2025-11-01T03:00:00.000Z', '2025-12-01T03:00:00.000Z');
    expect(range.staleTime).toBe(Infinity);
    expect(range.refetchOnWindowFocus).toBe(false);
    // One quick retry for ordinary failures, none for a missing login.
    const retry = range.retry as (failures: number, error: Error) => boolean;
    expect(retry(0, new Error('boom'))).toBe(true);
    expect(retry(1, new Error('boom'))).toBe(false);
    expect(retry(0, new HubApiError('Login necessário.', 401, 'login_required'))).toBe(false);
  });
});

const loginRequired = () => new HubApiError('Login necessário.', 401, 'login_required');

describe('login_required handling', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedFetchBootstrap.mockReset();
    mockedFetchPosts.mockReset();
  });

  function wrapperFor(qc: ReturnType<typeof createHubQueryClient>) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
  }

  it('with a stored session, clears it and refetches bootstrap once', async () => {
    window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
    mockedFetchBootstrap.mockResolvedValue({} as never);
    mockedFetchPosts.mockRejectedValue(loginRequired());
    const qc = createHubQueryClient();
    const wrapper = wrapperFor(qc);
    renderHook(() => useQuery(hubBootstrapQuery('mesaas', 'tk')), { wrapper });
    await waitFor(() => expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    renderHook(() => useQuery(hubPostsQuery('tk')), { wrapper });

    await waitFor(() => expect(window.localStorage.getItem(HUB_SESSION_STORAGE_KEY)).toBeNull());
    await waitFor(() => expect(mockedFetchBootstrap).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['hub-bootstrap'] });
    // login_required is not retried: one posts call, not four.
    expect(mockedFetchPosts).toHaveBeenCalledTimes(1);
  });

  it('with no stored session, leaves storage alone and does not refetch bootstrap', async () => {
    mockedFetchBootstrap.mockRejectedValue(loginRequired());
    const qc = createHubQueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useQuery(hubBootstrapQuery('mesaas', 'tk')), {
      wrapper: wrapperFor(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Let any (wrongly) scheduled refetch run before asserting it did not.
    await new Promise((r) => setTimeout(r, 30));

    expect(invalidate).not.toHaveBeenCalled();
    expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0);
  });

  it('also reacts to a failed mutation', async () => {
    window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
    const qc = createHubQueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => {
            throw loginRequired();
          },
        }),
      { wrapper: wrapperFor(qc) },
    );

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });

    expect(window.localStorage.getItem(HUB_SESSION_STORAGE_KEY)).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['hub-bootstrap'] });
  });

  it('ignores other errors', () => {
    window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
    const qc = createHubQueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    handleLoginRequired(qc, new HubApiError('Erro', 500));
    handleLoginRequired(qc, new Error('login_required'));
    expect(window.localStorage.getItem(HUB_SESSION_STORAGE_KEY)).toBe('sess-1');
    expect(invalidate).not.toHaveBeenCalled();
  });

  describe('a call awaited outside TanStack (plain await in a component)', () => {
    afterEach(() => {
      setLoginRequiredListener(null);
      vi.unstubAllGlobals();
    });

    const stub401 = () =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Login necessário.', code: 'login_required' }),
        })),
      );

    it('with a stored session, clears it and invalidates bootstrap', async () => {
      window.localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-1');
      const qc = createHubQueryClient();
      const invalidate = vi.spyOn(qc, 'invalidateQueries');
      stub401();

      await expect(submitApproval('tk', 1, 'aprovado')).rejects.toMatchObject({
        code: 'login_required',
      });

      expect(window.localStorage.getItem(HUB_SESSION_STORAGE_KEY)).toBeNull();
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['hub-bootstrap'] });
    });

    it('with no stored session, does nothing and bootstrap is fetched once', async () => {
      mockedFetchBootstrap.mockResolvedValue({} as never);
      const qc = createHubQueryClient();
      const invalidate = vi.spyOn(qc, 'invalidateQueries');
      renderHook(() => useQuery(hubBootstrapQuery('mesaas', 'tk')), { wrapper: wrapperFor(qc) });
      await waitFor(() => expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1));
      stub401();

      await expect(submitApproval('tk', 1, 'aprovado')).rejects.toMatchObject({
        code: 'login_required',
      });
      await new Promise((r) => setTimeout(r, 30));

      expect(invalidate).not.toHaveBeenCalled();
      expect(mockedFetchBootstrap).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps TanStack retries for other failures', () => {
    const qc = createHubQueryClient();
    const retry = qc.getDefaultOptions().queries?.retry as (n: number, e: Error) => boolean;
    expect(retry).toBeTypeOf('function');
    expect(retry(2, new HubApiError('Erro', 500))).toBe(true);
    expect(retry(3, new HubApiError('Erro', 500))).toBe(false);
    expect(retry(0, loginRequired())).toBe(false);
  });

  it('bootstrap refetches nothing on window focus', async () => {
    mockedFetchBootstrap.mockResolvedValue({} as never);
    const qc = createHubQueryClient();
    const { result } = renderHook(() => useQuery(hubBootstrapQuery('mesaas', 'tk')), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const callsBefore = mockedFetchBootstrap.mock.calls.length;

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(mockedFetchBootstrap.mock.calls.length).toBe(callsBefore);
  });
});
