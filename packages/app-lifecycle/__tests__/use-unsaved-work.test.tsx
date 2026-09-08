import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { hasUnsavedWork, resetUnsavedWorkForTests } from '../src/unsaved-work';
import { useUnsavedWork } from '../src/use-unsaved-work';

beforeEach(() => resetUnsavedWorkForTests());

describe('useUnsavedWork', () => {
  it('holds only while active', () => {
    const { rerender } = renderHook(({ active }) => useUnsavedWork(active), {
      initialProps: { active: false },
    });
    expect(hasUnsavedWork()).toBe(false);
    rerender({ active: true });
    expect(hasUnsavedWork()).toBe(true);
    rerender({ active: false });
    expect(hasUnsavedWork()).toBe(false);
  });

  it('releases on unmount', () => {
    const { unmount } = renderHook(() => useUnsavedWork(true));
    expect(hasUnsavedWork()).toBe(true);
    unmount();
    expect(hasUnsavedWork()).toBe(false);
  });
});
