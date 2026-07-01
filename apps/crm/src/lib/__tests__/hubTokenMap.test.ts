import { describe, expect, it } from 'vitest';
import { buildUsableTokenMap } from '@/lib/hubTokenMap';

const now = '2026-07-01T00:00:00.000Z';

describe('buildUsableTokenMap', () => {
  it('includes unexpired tokens', () => {
    const m = buildUsableTokenMap([{ cliente_id: 1, token: 'a', expires_at: '2026-08-01T00:00:00Z' }], now);
    expect(m.get(1)).toBe('a');
  });
  it('excludes expired tokens', () => {
    const m = buildUsableTokenMap([{ cliente_id: 2, token: 'b', expires_at: '2026-06-01T00:00:00Z' }], now);
    expect(m.has(2)).toBe(false);
  });
  it('excludes rows with missing token or client id', () => {
    const m = buildUsableTokenMap(
      [{ cliente_id: null, token: 'c', expires_at: '2026-08-01T00:00:00Z' }, { cliente_id: 3, token: null, expires_at: '2026-08-01T00:00:00Z' }],
      now,
    );
    expect(m.size).toBe(0);
  });
});
