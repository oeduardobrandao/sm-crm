import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as kbVideosStore from '@/store/kbVideos';
import { useVideoProgress } from '../useKbVideos';

vi.mock('@/store/kbVideos');

describe('useVideoProgress', () => {
  it('does not discard optimistic save when in-flight fetch resolves with old state', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    let resolveStaleFetch: (value: kbVideosStore.KbVideoProgress[]) => void;
    const staleFetch = new Promise<kbVideosStore.KbVideoProgress[]>((resolve) => {
      resolveStaleFetch = resolve;
    });

    // Initial fetch returns stale data (deferred); follow-up fetch after invalidation returns updated data
    vi.mocked(kbVideosStore.getMyVideoProgress)
      .mockReturnValueOnce(staleFetch)
      .mockResolvedValueOnce([
        { video_id: 7, position_seconds: 42, completed_at: '2026-09-28T12:00:00.000Z' },
      ]);
    vi.mocked(kbVideosStore.saveVideoProgress).mockResolvedValue(undefined);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useVideoProgress(), { wrapper });

    // Start the fetch
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    // Call save while fetch is pending
    result.current.save(7, 42, true);

    // Verify optimistic update is in cache
    await waitFor(() => {
      expect(result.current.progress.get(7)).toEqual({
        video_id: 7,
        position_seconds: 42,
        completed_at: expect.any(String),
      });
    });

    // Resolve the stale fetch with old state (empty array)
    resolveStaleFetch!([]);

    // Right after stale fetch resolves, optimistic row should still be in cache
    // (This is what cancelQueries + setQueryData before the initial fetch resolution prevents)
    await act(async () => {});
    expect(result.current.progress.get(7)).toBeDefined();
    expect(result.current.progress.get(7)!.video_id).toBe(7);

    // After invalidateQueries runs, the follow-up fetch resolves with the saved row
    await waitFor(() => {
      // Cache should now have the row from the server
      expect(result.current.progress.get(7)).toEqual({
        video_id: 7,
        position_seconds: 42,
        completed_at: '2026-09-28T12:00:00.000Z',
      });
    });

    // Verify save was called
    expect(vi.mocked(kbVideosStore.saveVideoProgress)).toHaveBeenCalledWith(7, 42, true);
  });

  it('does not refetch on successful save when nothing is in flight', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.mocked(kbVideosStore.getMyVideoProgress).mockResolvedValue([]);
    vi.mocked(kbVideosStore.saveVideoProgress).mockResolvedValue(undefined);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useVideoProgress(), { wrapper });

    // Initial fetch completes
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Call save with no fetch in flight
    result.current.save(7, 42, false);

    // Wait for save RPC to complete
    await waitFor(() => {
      expect(vi.mocked(kbVideosStore.saveVideoProgress)).toHaveBeenCalledWith(7, 42, false);
    });

    // getMyVideoProgress should only have been called once (initial fetch)
    // not twice (initial + invalidation refetch)
    expect(vi.mocked(kbVideosStore.getMyVideoProgress)).toHaveBeenCalledTimes(1);
  });
});
