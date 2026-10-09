import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  limitCaption,
  overrideCount,
  visibleConnections,
} from '../workspace-detail-view';

describe('formatBytes', () => {
  it('formats with a pt-BR decimal comma on 1024 steps', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1,3 GB');
    expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB');
  });
  it('treats negative and non-finite input as zero', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('limitCaption', () => {
  it('reads null as unlimited', () => {
    expect(limitCaption(null)).toBe('sem limite');
    expect(limitCaption(undefined)).toBe('sem limite');
  });
  it('formats the limit', () => {
    expect(limitCaption(10)).toBe('de 10');
    expect(limitCaption(1024, formatBytes)).toBe('de 1 KB');
  });
});

describe('overrideCount', () => {
  it('counts keys and tolerates null', () => {
    expect(overrideCount(null)).toBe(0);
    expect(overrideCount({ max_clients: 5, max_leads: 0 })).toBe(2);
  });
});

describe('visibleConnections', () => {
  const items = [
    { id: 'a', revoked_at: '2026-01-01' },
    { id: 'b', revoked_at: null },
    { id: 'c', revoked_at: null },
  ];
  it('hides revoked rows by default', () => {
    const r = visibleConnections(items, false);
    expect(r.visible.map((i) => i.id)).toEqual(['b', 'c']);
    expect(r.activeCount).toBe(2);
    expect(r.revokedCount).toBe(1);
  });
  it('appends revoked rows after active ones when asked', () => {
    expect(visibleConnections(items, true).visible.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
  it('handles an unloaded list', () => {
    expect(visibleConnections(undefined, false)).toEqual({
      visible: [],
      activeCount: 0,
      revokedCount: 0,
    });
  });
});
