import { describe, expect, it } from 'vitest';
import { targetsInstagram, hasAutoPublishTarget } from '../platformTargets';

describe('platform predicates', () => {
  it('only instagram, both and the legacy default target Instagram', () => {
    expect(targetsInstagram('instagram')).toBe(true);
    expect(targetsInstagram('both')).toBe(true);
    expect(targetsInstagram(undefined)).toBe(true);
    expect(targetsInstagram(null)).toBe(true);
    expect(targetsInstagram('tiktok')).toBe(false);
    expect(targetsInstagram('other')).toBe(false);
  });

  it('other is the only value with nothing to publish', () => {
    expect(hasAutoPublishTarget('other')).toBe(false);
    for (const p of ['instagram', 'tiktok', 'both', undefined] as const) {
      expect(hasAutoPublishTarget(p)).toBe(true);
    }
  });
});
