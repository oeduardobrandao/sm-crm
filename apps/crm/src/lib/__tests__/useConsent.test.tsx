import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setConsent } from '../consent';
import { useConsent } from '../useConsent';

describe('useConsent', () => {
  afterEach(() => localStorage.clear());

  it('is null when undecided and re-renders on a same-tab change', () => {
    localStorage.clear();
    const { result } = renderHook(() => useConsent());
    expect(result.current).toBeNull();
    act(() => setConsent({ analytics: true, support: false }));
    expect(result.current).toMatchObject({ analytics: true, support: false });
    act(() => setConsent({ analytics: false, support: false }));
    expect(result.current).toMatchObject({ analytics: false });
  });
});
