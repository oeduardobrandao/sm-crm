import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@mesaas/app-lifecycle', () => ({ trackUnsavedWork: vi.fn((p: Promise<unknown>) => p) }));
vi.mock('@/store', () => ({
  getPostTargets: vi.fn(async () => [
    { id: 1, post_id: 42, platform: 'instagram', status: 'pendente', caption: null },
  ]),
  getBoardPlatforms: vi.fn(async () => ['instagram', 'geral']),
  addPostDestination: vi.fn(async () => {}),
  removePostDestination: vi.fn(async () => {}),
  savePostCaption: vi.fn(async () => {}),
}));

import { toast } from 'sonner';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import * as store from '@/store';
import { usePostDestinations } from '../usePostDestinations';
import type { WorkflowPost } from '@/store/posts';

const post = {
  id: 42,
  conta_id: 'ws-1',
  workflow_id: 10,
  cliente_id: 7,
} as WorkflowPost;

function wrapper(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('usePostDestinations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not query anything while disabled (flag off)', () => {
    renderHook(() => usePostDestinations(post, false, vi.fn()), { wrapper: wrapper() });
    expect(store.getPostTargets).not.toHaveBeenCalled();
    expect(store.getBoardPlatforms).not.toHaveBeenCalled();
  });

  it('loads targets and board platforms when enabled', async () => {
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.targets?.map((t) => t.platform)).toEqual(['instagram']);
    expect(result.current.boardPlatforms).toEqual(['instagram', 'geral']);
  });

  it('refetches targets when the derived platform changes (z7 dropped TikTok on stories)', async () => {
    const { result, rerender } = renderHook(
      ({ p }: { p: WorkflowPost }) => usePostDestinations(p, true, vi.fn()),
      { wrapper: wrapper(), initialProps: { p: { ...post, platform: 'both' } as WorkflowPost } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ p: { ...post, platform: 'instagram' } as WorkflowPost });
    await waitFor(() => expect(store.getPostTargets).toHaveBeenCalledTimes(2));
  });

  it('toggle on adds with the seed and refreshes the post', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePostDestinations(post, true, onRefresh), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.toggle.mutateAsync({ platform: 'geral', on: true, seedCaption: 'oi' });
    });
    expect(store.addPostDestination).toHaveBeenCalledWith({
      postId: 42,
      contaId: 'ws-1',
      platform: 'geral',
      seedCaption: 'oi',
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it('registers the toggle write as unsaved work while it is in flight', async () => {
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.toggle.mutateAsync({ platform: 'geral', on: true, seedCaption: null });
    });
    expect(trackUnsavedWork).toHaveBeenCalledTimes(1);
  });

  it('toggle off removes', async () => {
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.toggle.mutateAsync({ platform: 'geral', on: false, seedCaption: null });
    });
    expect(store.removePostDestination).toHaveBeenCalledWith(42, 'geral');
  });

  it('onSettled invalidates post-targets and refreshes the post, also on error', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePostDestinations(post, true, onRefresh), {
      wrapper: wrapper(qc),
    });
    await act(async () => {
      await result.current.toggle.mutateAsync({ platform: 'geral', on: false, seedCaption: null });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-targets', 42] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['active-posts'] });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    spy.mockClear();
    vi.mocked(store.removePostDestination).mockRejectedValueOnce(new Error('x'));
    await act(async () => {
      await result.current.toggle
        .mutateAsync({ platform: 'geral', on: false, seedCaption: null })
        .catch(() => {});
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-targets', 42] });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('onError toasts the destinations failure', async () => {
    vi.mocked(store.addPostDestination).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.toggle
        .mutateAsync({ platform: 'geral', on: true, seedCaption: null })
        .catch(() => {});
    });
    expect(toast.error).toHaveBeenCalledWith('Não foi possível atualizar os destinos.');
  });

  it('toggle.isPending stays true until the post-targets refetch resolves', async () => {
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let release!: (rows: Awaited<ReturnType<typeof store.getPostTargets>>) => void;
    vi.mocked(store.getPostTargets).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    act(() => {
      result.current.toggle.mutate({ platform: 'geral', on: true, seedCaption: null });
    });
    await waitFor(() => expect(store.addPostDestination).toHaveBeenCalled());
    // A escrita terminou e o refetch está em voo (promessa pendente): ainda pendente.
    await waitFor(() => expect(store.getPostTargets).toHaveBeenCalledTimes(2));
    expect(result.current.toggle.isPending).toBe(true);
    await act(async () => {
      release([]);
    });
    await waitFor(() => expect(result.current.toggle.isPending).toBe(false));
  });

  it('exposes isError and a refetch for both queries', async () => {
    vi.mocked(store.getPostTargets).mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    vi.mocked(store.getPostTargets).mockResolvedValue([]);
    const calls = vi.mocked(store.getBoardPlatforms).mock.calls.length;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(vi.mocked(store.getBoardPlatforms).mock.calls.length).toBe(calls + 1);
  });

  it('saveCaption toasts and rethrows on failure (draft stays)', async () => {
    vi.mocked(store.savePostCaption).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await expect(result.current.saveCaption('geral', 't')).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledWith('Não foi possível salvar a legenda.');
  });

  it('saveCaption is silent when the Geral row is gone (turned off mid-debounce)', async () => {
    const gone = Object.assign(new Error('gone'), { name: 'DestinationGoneError' });
    vi.mocked(store.savePostCaption).mockRejectedValueOnce(gone);
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await expect(result.current.saveCaption('geral', 't')).resolves.toBeUndefined();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
