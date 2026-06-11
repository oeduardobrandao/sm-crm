import { describe, it, expect } from 'vitest';
import { computeAtLimit } from '../useEntitlements';
describe('computeAtLimit', () => {
  it('true when count >= limit', () => {
    expect(computeAtLimit(2, 2)).toBe(true);
    expect(computeAtLimit(1, 2)).toBe(false);
  });
  it('null limit = unlimited => never at limit', () => {
    expect(computeAtLimit(999, null)).toBe(false);
  });
});
