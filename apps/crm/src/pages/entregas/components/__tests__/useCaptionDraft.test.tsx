import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentThread } from '@/store';
import { useCaptionDraft } from '../useCaptionDraft';

vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));

const thread = (over: Partial<CommentThread> = {}): CommentThread => ({
  id: 1,
  post_id: 10,
  conta_id: 'c',
  quoted_text: 'brave',
  status: 'active',
  created_by: 'u',
  resolved_by: null,
  created_at: '',
  resolved_at: null,
  field: 'ig_caption',
  anchor_start: 6,
  anchor_end: 11,
  orphaned: false,
  ...over,
});

describe('useCaptionDraft', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exposes the (validated) prop value and anchors before any edit', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello brave world', threads: [thread()], onSave: vi.fn() }),
    );
    expect(result.current.text).toBe('hello brave world');
    expect(result.current.anchors).toEqual([
      { id: 1, start: 6, end: 11, quotedText: 'brave', orphaned: false },
    ]);
  });

  it('remaps anchors while typing and saves once after the debounce', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello brave world', threads: [thread()], onSave }),
    );
    act(() => result.current.change('oh hello brave world'));
    expect(result.current.text).toBe('oh hello brave world');
    expect(result.current.anchors[0]).toMatchObject({ start: 9, end: 14 });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('oh hello brave world', [
      { id: 1, anchor_start: 9, anchor_end: 14, orphaned: false, quoted_text: 'brave' },
    ]);
  });

  it('saves the latest draft, not the keystroke that armed the timer', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCaptionDraft({ value: 'hello', threads: [], onSave }));
    act(() => result.current.change('hello a'));
    act(() => result.current.change('hello ab'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe('hello ab');
  });

  it('ignores inbound props while a draft is pending', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (p: { value: string }) => useCaptionDraft({ value: p.value, threads: [], onSave }),
      { initialProps: { value: 'hello' } },
    );
    act(() => result.current.change('hello there'));
    rerender({ value: 'server changed' });
    expect(result.current.text).toBe('hello there');
  });

  it('drops the draft and skips the save when typed back to the persisted text', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello brave world', threads: [thread()], onSave }),
    );
    act(() => result.current.change('hello  world')); // delete "brave" -> orphaned locally
    expect(result.current.anchors[0].orphaned).toBe(true);
    act(() => result.current.change('hello brave world')); // undo
    expect(result.current.anchors[0]).toMatchObject({ start: 6, end: 11, orphaned: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects text over 2200 chars', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'a', threads: [], onSave: vi.fn() }),
    );
    act(() => result.current.change('x'.repeat(2201)));
    expect(result.current.text).toBe('a');
  });

  it('flush saves immediately and resolves true; false when the save fails', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useCaptionDraft({ value: 'hello', threads: [], onSave }));
    act(() => result.current.change('hello 1'));
    let ok = false;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);

    act(() => result.current.change('hello 12'));
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(false);
    expect(result.current.text).toBe('hello 12'); // draft kept for the next attempt
  });

  it('serializes saves: a second save waits for the first', async () => {
    let release!: () => void;
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useCaptionDraft({ value: 'a', threads: [], onSave }));
    act(() => result.current.change('ab'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    act(() => result.current.change('abc'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledTimes(1); // second is queued behind the first
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toBe('abc');
  });

  it('adopts the server value again once props catch up with a saved draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (p: { value: string }) => useCaptionDraft({ value: p.value, threads: [], onSave }),
      { initialProps: { value: 'hello' } },
    );
    act(() => result.current.change('hello!'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    rerender({ value: 'hello!' });
    rerender({ value: 'hello! (edited elsewhere)' });
    expect(result.current.text).toBe('hello! (edited elsewhere)');
  });

  it('still saves when typed back to the persisted text before props reflect a save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCaptionDraft({ value: 'a', threads: [], onSave }));
    act(() => result.current.change('ab'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => result.current.change('a')); // props still say 'a': the server now holds 'ab'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toBe('a');
  });

  it('getText returns the draft text, else the prop value', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello', threads: [], onSave: vi.fn() }),
    );
    expect(result.current.getText()).toBe('hello');
    act(() => result.current.change('hello!'));
    expect(result.current.getText()).toBe('hello!');
  });
});
