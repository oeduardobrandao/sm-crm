import { afterEach, describe, expect, it } from 'vitest';
import { localMonthRange } from '../postView';

describe('localMonthRange', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it('returns the local month boundaries as ISO instants', () => {
    process.env.TZ = 'America/Sao_Paulo';
    expect(localMonthRange(2025, 10)).toEqual({
      from: '2025-11-01T03:00:00.000Z',
      to: '2025-12-01T03:00:00.000Z',
    });
    expect(localMonthRange(2025, 11).to).toBe('2026-01-01T03:00:00.000Z');
  });
});
