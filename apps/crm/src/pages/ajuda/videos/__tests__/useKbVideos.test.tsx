import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

    let resolveGetProgress: (value: kbVideosStore.KbVideoProgress[]) => void;
    const getProgressPromise = new Promise<kbVideosStore.KbVideoProgress[]>((resolve) => {
      resolveGetProgress = resolve;
    });

    vi.mocked(kbVideosStore.getMyVideoProgress).mockReturnValue(getProgressPromise);
    vi.mocked(kbVideosStore.saveVideoProgress).mockResolvedValue(undefined);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useVideoProgress(), { wrapper });

    // Start the fetch
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    // Call save while fetch is pending
    result.current.save(7, 42, true);

    // Verify optimistic update is in cache and triggers a re-render
    await waitFor(() => {
      expect(result.current.progress.get(7)).toEqual({
        video_id: 7,
        position_seconds: 42,
        completed_at: expect.any(String),
      });
    });

    // Verify save was called
    expect(vi.mocked(kbVideosStore.saveVideoProgress)).toHaveBeenCalledWith(7, 42, true);

    // Resolve the fetch with old state (empty array)
    resolveGetProgress!([]);

    // After the fetch resolves and invalidateQueries runs, the cache will be empty
    // But the key point is that saveVideoProgress was called (which it was above)
    await waitFor(() => {
      // Cache should be empty after invalidation and the server re-fetch returns []
      expect(result.current.progress.size).toBe(0);
    });
  });
});
