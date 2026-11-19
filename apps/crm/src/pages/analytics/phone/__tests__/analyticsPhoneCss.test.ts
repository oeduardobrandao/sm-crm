import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const WIDE_TOUCH = '(hover: none) and (pointer: coarse) and (min-width: 1000px)';

const css = readFileSync(path.join(__dirname, '..', 'analyticsPhone.css'), 'utf8');

function declsIn(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkAtRules('media', (at) => {
    if (at.params.replace(/\s+/g, ' ').trim() !== WIDE_TOUCH) return;
    at.walkRules((rule) => {
      if (rule.selectors.map((s) => s.trim()).includes(selector)) {
        rule.walkDecls((d) => {
          out[d.prop] = d.value;
        });
      }
    });
  });
  return out;
}

describe('analytics phone views on wide touch screens', () => {
  it('lays .phone-an out as two equal columns', () => {
    const root = declsIn('.phone-an');
    expect(root.display).toBe('grid');
    expect(root['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('keeps the header, filters and every other direct child full width by default', () => {
    expect(declsIn('.phone-an > *')['grid-column']).toBe('1 / -1');
  });

  it('lets ranked-post strips sit side by side, and a lone one stay full width', () => {
    expect(declsIn('.phone-an > .phone-an-half')['grid-column']).toBe('auto');
    const lone = Object.keys(
      declsIn(
        '.phone-an > .phone-an-half:not(.phone-an-half ~ .phone-an-half):not(:has(~ .phone-an-half))',
      ),
    );
    expect(lone).toContain('grid-column');
  });
});
