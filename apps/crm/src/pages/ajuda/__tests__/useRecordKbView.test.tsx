import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/kbViews', () => ({ recordKbView: vi.fn() }));

import { recordKbView } from '@/store/kbViews';
import { recordKbViewSafely, useRecordArticleView } from '../useRecordKbView';

beforeEach(() => {
  vi.mocked(recordKbView).mockReset();
  vi.mocked(recordKbView).mockResolvedValue();
});

describe('useRecordArticleView', () => {
  it('records once per published article id', () => {
    const { rerender } = renderHook(({ a }) => useRecordArticleView(a), {
      initialProps: {
        a: { id: 'a1', status: 'published' } as { id: string; status: string } | null,
      },
    });
    rerender({ a: { id: 'a1', status: 'published' } });
    expect(recordKbView).toHaveBeenCalledTimes(1);
    expect(recordKbView).toHaveBeenCalledWith({ articleId: 'a1' });

    rerender({ a: { id: 'a2', status: 'published' } });
    expect(recordKbView).toHaveBeenCalledTimes(2);
    expect(recordKbView).toHaveBeenLastCalledWith({ articleId: 'a2' });
  });

  it('does not record a missing or draft article', () => {
    const { rerender } = renderHook(({ a }) => useRecordArticleView(a), {
      initialProps: { a: null as { id: string; status: string } | null | undefined },
    });
    rerender({ a: undefined });
    rerender({ a: { id: 'a3', status: 'draft' } });
    expect(recordKbView).not.toHaveBeenCalled();
  });
});

describe('recordKbViewSafely', () => {
  it('swallows a failed record', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(recordKbView).mockRejectedValue(new Error('offline'));
    expect(() => recordKbViewSafely({ videoId: 1 })).not.toThrow();
    await vi.waitFor(() => expect(debug).toHaveBeenCalled());
    debug.mockRestore();
  });
});
