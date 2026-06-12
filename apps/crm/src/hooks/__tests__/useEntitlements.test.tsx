import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { computeAtLimit, useEntitlements } from '../useEntitlements';
import { useWorkspaceLimits } from '../useWorkspaceLimits';

vi.mock('../useWorkspaceLimits', () => ({
  useWorkspaceLimits: vi.fn(),
}));

const mockedUseWorkspaceLimits = vi.mocked(useWorkspaceLimits);

function setLimits(overrides: Record<string, unknown> = {}) {
  mockedUseWorkspaceLimits.mockReturnValue({
    limits: null,
    features: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
    ...overrides,
  } as never);
}

beforeEach(() => {
  setLimits();
});

describe('computeAtLimit', () => {
  it('true when count >= limit', () => {
    expect(computeAtLimit(2, 2)).toBe(true);
    expect(computeAtLimit(1, 2)).toBe(false);
  });
  it('null limit = unlimited => never at limit', () => {
    expect(computeAtLimit(999, null)).toBe(false);
  });
});

describe('useEntitlements.hasFeature', () => {
  it('returns true when the flag is enabled', () => {
    setLimits({ features: { feature_leads: true } });
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.hasFeature('feature_leads')).toBe(true);
  });

  it('returns false when the flag is explicitly disabled', () => {
    setLimits({ features: { feature_leads: false } });
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.hasFeature('feature_leads')).toBe(false);
  });

  it('falls back to true (not explicitly false) when the flag is missing from features', () => {
    setLimits({ features: { feature_leads: true } });
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.hasFeature('feature_unknown')).toBe(true);
  });

  it('falls back to true when the features object itself is null', () => {
    setLimits({ features: null });
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.hasFeature('feature_leads')).toBe(true);
  });
});

describe('useEntitlements.isAtLimit', () => {
  it('returns true when count reaches the limit', () => {
    setLimits({ limits: { max_clients: 3 } });
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.isAtLimit('max_clients', 3)).toBe(true);
    expect(result.current.isAtLimit('max_clients', 5)).toBe(true);
  });

  it('returns false when count is below the limit', () => {
    setLimits({ limits: { max_clients: 3 } });
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.isAtLimit('max_clients', 2)).toBe(false);
  });

  it('returns false when the limit is null (unlimited)', () => {
    setLimits({ limits: { max_clients: null } });
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.isAtLimit('max_clients', 9999)).toBe(false);
  });

  it('returns false when the limits object itself is null', () => {
    setLimits({ limits: null });
    const { result } = renderHook(() => useEntitlements());
    expect(result.current.isAtLimit('max_clients', 9999)).toBe(false);
  });
});
