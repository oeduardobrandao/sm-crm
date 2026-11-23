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
    expect(
      declsIn(
        '.phone-an > .phone-an-half:not(.phone-an-half ~ .phone-an-half):not(:has(~ .phone-an-half))',
      )['grid-column'],
    ).toBe('1 / -1');
  });

  // Bare halves pair through grid auto-placement, so they only line up as two ADJACENT
  // siblings: a full-width child between them, or a third half, leaves an empty cell (the lone
  // rule above only catches a single half). Every other pair is an explicit .phone-an-pair
  // wrapper, matched at any depth (it also sits inside dimmed <div>s), with its own lone rule.
  it('lays every .phone-an-pair out as two columns, a lone half spanning both', () => {
    const pairRule = declsIn('.phone-an .phone-an-pair');
    expect(pairRule.display).toBe('grid');
    expect(pairRule['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    expect(
      declsIn(
        '.phone-an-pair > .phone-an-half:not(.phone-an-half ~ .phone-an-half):not(:has(~ .phone-an-half))',
      )['grid-column'],
    ).toBe('1 / -1');
  });

  it('keeps a ranked strip inside its column (no bleed into the page gutter)', () => {
    const strip = declsIn('.phone-an .phone-an-half .phone-an-strip');
    expect(strip['margin-inline']).toBe('0');
    expect(strip['padding-inline']).toBe('0');
  });

  it('caps KPI tiles at 4 per row, 2 in a column, instead of one swipeable row', () => {
    const grid = declsIn('.phone-an .phone-kit.phone-stat-grid');
    expect(grid.display).toBe('grid');
    expect(grid['grid-template-columns']).toContain('(100% - 30px) / 4');
    expect(declsIn('.phone-an .phone-an-half .phone-kit.phone-stat-grid')).toMatchObject({
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    });
    expect(
      declsIn('.phone-an .phone-stat-grid > .phone-stat-tile:last-child:nth-child(odd)')[
        'grid-column'
      ],
    ).toBe('auto');
  });
});

describe('analytics phone views on a phone', () => {
  it('keeps wrappers that sit in the flex .phone-an a flex column, so section spacing holds', () => {
    const stack: Record<string, string> = {};
    postcss.parse(css).walkRules('.phone-an-stack', (rule) => {
      if (rule.parent?.type !== 'root') return;
      rule.walkDecls((d) => {
        stack[d.prop] = d.value;
      });
    });
    expect(stack).toMatchObject({ display: 'flex', 'flex-direction': 'column' });
  });
});

/** Declarations of a top-level rule (outside any at-rule). */
function topLevelDecls(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent?.type !== 'root') return;
    if (!rule.selectors.map((s) => s.trim()).includes(selector)) return;
    rule.walkDecls((d) => {
      out[d.prop] = d.value;
    });
  });
  return out;
}

describe('post metrics on phones', () => {
  // Three equal segments leave ~102px of text at 390px; "Comentários · 142" measures 116px at 600.
  it('sizes the post sheet tabs to their labels so "Comentários · N" fits at 390px', () => {
    expect(
      topLevelDecls('.phone-an-sheet .post-metrics__segmented .phone-segmented__item'),
    ).toMatchObject({ flex: '1 1 auto', padding: '0 6px' });
  });

  it('lets a selectable strip card keep its slot in the strip, with the chip beside it', () => {
    expect(topLevelDecls('.phone-an-post-card-wrap')).toMatchObject({
      position: 'relative',
      flex: '0 0 112px',
      'scroll-snap-align': 'start',
    });
    expect(topLevelDecls('.phone-an-post-card__ig').position).toBe('absolute');
  });
});
