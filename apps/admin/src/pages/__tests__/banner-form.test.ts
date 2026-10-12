import { describe, expect, it } from 'vitest';
import { LINK_PATTERN } from '../banners/banner-form';

// Browsers compile the `pattern` attribute with the `v` flag and silently ignore it if it throws.
const anchored = (flags: string) => new RegExp(`^(?:${LINK_PATTERN})$`, flags);

describe('LINK_PATTERN', () => {
  it('compiles under the v flag', () => {
    expect(() => anchored('v')).not.toThrow();
  });

  it.each([
    ['https://x', true],
    ['/ok', true],
    ['//evil', false],
    ['/\\evil', false],
    ['ftp://x', false],
  ])('%s -> %s (same under u and v)', (input, ok) => {
    expect(anchored('v').test(input)).toBe(ok);
    expect(anchored('u').test(input)).toBe(ok);
  });
});
