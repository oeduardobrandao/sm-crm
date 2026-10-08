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

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

  it('saveCaption toasts and rethrows on failure (draft stays)', async () => {
    vi.mocked(store.savePostCaption).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await expect(result.current.saveCaption('geral', 't')).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledWith('Não foi possível salvar a legenda.');
  });
});
