import { describe, it, expect } from 'vitest';
import { resolveTargetSlugs } from '../upload-kb-images.mjs';

const AVAILABLE = ['como-usar-o-post-express', 'como-agendar-seu-primeiro-post'];

describe('resolveTargetSlugs', () => {
  it('returns only the requested slug', () => {
    expect(resolveTargetSlugs(['como-agendar-seu-primeiro-post'], AVAILABLE)).toEqual([
      'como-agendar-seu-primeiro-post',
    ]);
  });

  it('refuses to run with no slug, rather than defaulting to every slug on disk', () => {
    // The dangerous behavior must not be the default: e2e/.shots is gitignored
    // and persists across runs, so "all" means "publish whatever is lying
    // around", including unreviewed PNGs, to a public bucket.
    expect(() => resolveTargetSlugs([], AVAILABLE)).toThrow(/slug/i);
  });

  it('refuses a slug that has no directory on disk', () => {
    expect(() => resolveTargetSlugs(['nao-existe'], AVAILABLE)).toThrow(/nao-existe/);
  });

  it('accepts more than one slug', () => {
    expect(resolveTargetSlugs(AVAILABLE, AVAILABLE)).toEqual(AVAILABLE);
  });
});
