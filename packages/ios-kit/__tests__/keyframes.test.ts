import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/** `animation` shorthand keywords that are not names. */
const KEYWORDS = new Set([
  'none',
  'inherit',
  'initial',
  'unset',
  'infinite',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
]);

/** Animation names referenced by `animation:` / `animation-name:` declarations. */
function usedAnimations(css: string): Set<string> {
  const names = new Set<string>();
  for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    for (const part of m[1].split(',')) {
      for (const token of part.trim().split(/\s+/)) {
        if (/^[a-z][a-z0-9-]*$/i.test(token) && !KEYWORDS.has(token)) names.add(token);
      }
    }
  }
  return names;
}

const defined = (css: string) =>
  new Set([...css.matchAll(/@keyframes\s+([a-z0-9-]+)/gi)].map((m) => m[1]));

// A closing Radix dialog waits for its [data-state=closed] animation to end. If the keyframes
// are missing the animation never runs, animationend never fires, and the sheet stays mounted
// on screen: every Admin bottom sheet was stuck open this way.
describe('every animation the Admin bundle uses has its @keyframes', () => {
  const bundle = [
    'packages/ios-kit/ios-kit.css',
    'apps/admin/src/globals.css',
    'apps/admin/src/ios/admin-kit.css',
  ].map(read);
  const all = bundle.join('\n');

  it('ios-kit.css is self-contained', () => {
    const kit = bundle[0];
    const missing = [...usedAnimations(kit)].filter((n) => !defined(kit).has(n));
    expect(missing).toEqual([]);
  });

  it('admin CSS defines every animation it uses', () => {
    const missing = [...usedAnimations(all)].filter((n) => !defined(all).has(n));
    expect(missing).toEqual([]);
  });
});
