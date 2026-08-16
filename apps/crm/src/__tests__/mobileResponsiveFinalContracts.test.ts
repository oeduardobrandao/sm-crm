import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync('apps/crm/style.css', 'utf8');
const sheetSource = readFileSync('apps/crm/src/components/ui/sheet.tsx', 'utf8');
const root = postcss.parse(css);

function mediaApplies(rule: Rule, width: number): boolean {
  let ancestor = rule.parent;
  while (ancestor) {
    if (ancestor.type === 'atrule' && (ancestor as AtRule).name === 'media') {
      const params = (ancestor as AtRule).params;
      const min = params.match(/min-width:\s*(\d+)px/)?.[1];
      const max = params.match(/max-width:\s*(\d+)px/)?.[1];
      if ((min && width < Number(min)) || (max && width > Number(max))) return false;
    }
    ancestor = ancestor.parent;
  }
  return true;
}

function lastValue(selector: string, property: string, width: number): string | undefined {
  let value: string | undefined;
  root.walkRules((rule) => {
    if (!rule.selectors?.map((item) => item.trim()).includes(selector)) return;
    if (!mediaApplies(rule, width)) return;
    rule.walkDecls(property, (declaration) => {
      value = declaration.value;
    });
  });
  return value;
}

describe('final mobile responsive CSS contracts', () => {
  it('leaves one authoritative phone padding shorthand with top and bottom safe-area clearance', () => {
    const padding = lastValue('.main-content', 'padding', 390);
    expect(padding).toContain('safe-area-inset-top');
    expect(padding).toContain('104px');
    expect(padding).toContain('safe-area-inset-bottom');
  });

  it('keeps phone navigation below Radix sheets and preserves More-sheet safe padding', () => {
    expect(lastValue('.mobile-nav-glass', 'z-index', 390)).toBe('40');
    expect(sheetSource.match(/z-50/g)?.length).toBeGreaterThanOrEqual(2);
    expect(lastValue('.mobile-more-sheet', 'padding-bottom', 390)).toContain(
      'safe-area-inset-bottom',
    );
  });

  it('scopes More sheet portal layers to the phone breakpoint', () => {
    expect(lastValue('.mobile-more-sheet', 'display', 390)).toBe('block');
    expect(lastValue('.mobile-more-overlay', 'display', 390)).toBe('block');
    expect(lastValue('.mobile-more-sheet', 'display', 768)).toBe('none');
    expect(lastValue('.mobile-more-overlay', 'display', 768)).toBe('none');
  });

  it('stacks the carousel header on phones while retaining touch-sized pagination', () => {
    expect(lastValue('.instagram-post-carousel__header', 'flex-direction', 390)).toBe('column');
    expect(lastValue('.latest-instagram-posts__pagination button', 'min-width', 390)).toBe('44px');
    expect(lastValue('.latest-instagram-posts__pagination button', 'min-height', 390)).toBe('44px');
  });

  it('does not reintroduce position: sticky or a fixed rail for the routed client tab shell', () => {
    // The old floating anchor-scroll rail (class prefix removed below) relied
    // on position: sticky/fixed and per-section scroll-margin-top; both were
    // removed when the tabs became real routes (.cliente-tabs-nav /
    // .cliente-tabs-shell). Guard against either reappearing — walking parsed
    // rule selectors (not the raw source) so an unrelated code comment
    // mentioning the old class name for context can't trip this up.
    let foundOldRailSelector = false;
    root.walkRules((rule) => {
      if (rule.selectors?.some((s) => s.includes('cliente-detalhe-nav'))) {
        foundOldRailSelector = true;
      }
    });
    expect(foundOldRailSelector).toBe(false);
    expect(lastValue('.cliente-tabs-nav', 'position', 390)).not.toBe('sticky');
    expect(lastValue('.cliente-tabs-nav', 'position', 1200)).not.toBe('fixed');
  });
});
