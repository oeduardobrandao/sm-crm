import { renderHook } from '@testing-library/react';
import type { SyntheticEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toProgressMap } from '../playlist';
import { SAVE_INTERVAL_MS, usePlaybackProgress } from '../usePlaybackProgress';

function ev(currentTime: number, duration = 100) {
  return {
    currentTarget: { currentTime, duration },
  } as unknown as SyntheticEvent<HTMLVideoElement>;
}

const NONE = toProgressMap([]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('usePlaybackProgress', () => {
  it('saves at most once per interval while playing', () => {
    const save = vi.fn();
    const { result } = renderHook(() => usePlaybackProgress(7, NONE, save));
    result.current.handlers.onTimeUpdate(ev(5));
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAVE_INTERVAL_MS);
    result.current.handlers.onTimeUpdate(ev(15));
    expect(save).toHaveBeenCalledWith(7, 15, false);
  });

  it('marks completion once at 90% of the duration', () => {
    const save = vi.fn();
    const { result } = renderHook(() => usePlaybackProgress(7, NONE, save));
    result.current.handlers.onTimeUpdate(ev(90, 100));
    result.current.handlers.onTimeUpdate(ev(91, 100));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(7, 90, true);
  });

  it('resumes from the saved position only on the first loadedmetadata', () => {
    const progress = toProgressMap([{ video_id: 7, position_seconds: 42, completed_at: null }]);
    const { result } = renderHook(() => usePlaybackProgress(7, progress, vi.fn()));
    const first = ev(0);
    result.current.handlers.onLoadedMetadata(first);
    expect((first.currentTarget as HTMLVideoElement).currentTime).toBe(42);
    const second = ev(0);
    result.current.handlers.onLoadedMetadata(second);
    expect((second.currentTarget as HTMLVideoElement).currentTime).toBe(0);
  });

  it('flushes the position on pagehide and on unmount', () => {
    const save = vi.fn();
    const { result, unmount } = renderHook(() => usePlaybackProgress(7, NONE, save));
    result.current.handlers.onTimeUpdate(ev(12));
    window.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenLastCalledWith(7, 12, false);
    save.mockClear();
    unmount();
    expect(save).toHaveBeenCalledWith(7, 12, false);
  });

  it('ended saves completion and calls the callback', () => {
    const save = vi.fn();
    const onEnded = vi.fn();
    const { result } = renderHook(() => usePlaybackProgress(7, NONE, save, onEnded));
    result.current.handlers.onEnded(ev(100, 100));
    expect(save).toHaveBeenCalledWith(7, 100, true);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
