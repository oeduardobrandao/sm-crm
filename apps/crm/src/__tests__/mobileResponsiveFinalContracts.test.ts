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
  it('clears the status bar through the phone header and the tab bar through the content padding', () => {
    // The phone shell header (bell, related articles) is fixed under the banners and
    // holds the status-bar inset; .main-content starts below it instead of padding
    // the inset itself.
    expect(lastValue('.phone-shell-header', 'display', 390)).toBe('flex');
    expect(lastValue('.phone-shell-header', 'display', 768)).toBe('none');
    expect(lastValue('.phone-shell-header', 'padding', 390)).toContain('safe-area-inset-top');
    expect(lastValue('.main-content', 'margin-top', 390)).toContain('--phone-header-height');
    expect(lastValue('.main-content', 'height', 390)).toContain('--phone-header-height');
    const padding = lastValue('.main-content', 'padding', 390);
    expect(padding).toContain('104px');
    expect(padding).toContain('safe-area-inset-bottom');
    // Tablet keeps its own shell: no phone header offset there.
    expect(lastValue('.main-content', 'margin-top', 800)).not.toContain('--phone-header-height');
  });

  it('keeps phone navigation below Radix sheets and keeps sheets clear of the status bar and home indicator', () => {
    expect(lastValue('.mobile-nav-glass', 'z-index', 390)).toBe('40');
    // Sheet's overlay/content used to both be z-50 (still > 40); bumped to
    // z-[9010]/z-[9011] (matching Dialog) so sheets clear the app's own
    // fixed .topbar (z-index: 110), which used to visually cover the top of
    // every open drawer. Either way, well above .mobile-nav-glass's 40.
    expect(sheetSource.match(/z-\[9010\]/g)?.length).toBeGreaterThanOrEqual(1);
    expect(sheetSource.match(/z-\[9011\]/g)?.length).toBeGreaterThanOrEqual(1);
    expect(lastValue('.phone-sheet', 'z-index', 390)).toBe('9011');
    // AUDIT #2: the Mais sheet reached under the status bar / Dynamic Island.
    expect(lastValue('.phone-sheet', 'max-height', 390)).toContain('safe-area-inset-top');
    expect(lastValue('.phone-sheet__body', 'padding', 390)).toContain('safe-area-inset-bottom');
  });

  it('scopes the Mais sheet to the phone breakpoint', () => {
    expect(lastValue('.phone-sheet', 'display', 390)).toBe('flex');
    expect(lastValue('.mobile-more-sheet', 'display', 390)).toBeUndefined();
    expect(lastValue('.mobile-more-sheet', 'display', 768)).toBe('none');
    expect(lastValue('.mobile-more-overlay', 'display', 768)).toBe('none');
  });

  it('defines phone tokens only under new --phone-* names, never redefining shared tokens (the Hub imports this file)', () => {
    const shared = ['--radius', '--bg-color', '--card-bg', '--background', '--primary', '--border'];
    root.walkRules((rule) => {
      const scoped = rule.selectors?.some(
        (sel) => sel.includes('.phone-kit') || sel.trim().endsWith('.app-container'),
      );
      if (!scoped) return;
      rule.walkDecls((decl) => {
        if (!decl.prop.startsWith('--')) return;
        if (rule.selectors.some((sel) => sel.includes('.phone-kit'))) {
          expect(decl.prop.startsWith('--phone-')).toBe(true);
        }
        expect(shared).not.toContain(decl.prop);
      });
    });
    expect(lastValue('.app-container', '--phone-bg', 390)).toBe('#f2f2f7');
    expect(lastValue('.app-container', '--phone-bg', 768)).toBeUndefined();
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
