import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

export function loadFamily(name: string) {
  const root = postcss.parse(readFileSync(`apps/crm/src/styles/vidro-body/${name}.css`, 'utf8'));
  const decl = (parts: string | string[], prop: string): string[] => {
    const ps = Array.isArray(parts) ? parts : [parts];
    const out: string[] = [];
    root.walkRules((r: Rule) => {
      if (!r.selectors.some((s) => ps.every((p) => s.includes(p)))) return;
      r.walkDecls(prop, (d) => {
        out.push(d.value);
      });
    });
    return out;
  };
  // A selector matches when it contains EVERY part (in any order). This is what makes :is() groupings
  // testable: `:is(.a, .b):is(:hover, [data-state='open'])` satisfies hasAll(['.b', ':hover']).
  const hasAll = (parts: string | string[]) => {
    const ps = Array.isArray(parts) ? parts : [parts];
    let found = false;
    root.walkRules((r) => {
      if (r.selectors.some((s) => ps.every((p) => s.includes(p)))) found = true;
    });
    return found;
  };
  return { root, decl, hasAll };
}

export function expectStates(
  hasAll: (p: string[]) => boolean,
  hook: string,
  states = [':hover', ':focus-visible', ':disabled'],
) {
  for (const st of states) expect(hasAll([hook, st]), `${hook} ${st}`).toBe(true);
}

const { root, decl, hasAll } = loadFamily('cards');
const PB = "html[data-look='vidro'] body:has(.app-container) .vidro-panel";
const PB_DARK = "html[data-theme='dark'][data-look='vidro'] body:has(.app-container) .vidro-panel";
const PO_POPOVER = "html[data-look='vidro'] body:has(.app-container) [data-slot='popover-content']";
const PO_EMPTY = "html[data-look='vidro'] body:has(.app-container) .vidro-empty";

describe('cards.css', () => {
  it('groups, tiles and inner items', () => {
    expect(decl("[data-slot='card']", 'background').join()).toContain('var(--vd-group)');
    expect(decl('.config-shell', 'background').join()).toContain('var(--vd-tile)');
    expect(decl('.scheduled-item', 'border-radius')).toContain('12px');
  });

  it('sticky .scheduled-panel is opaque', () => {
    expect(decl('.scheduled-panel', 'background').join()).toContain('var(--vd-solid)');
  });

  it('report editor chrome and empty states are covered', () => {
    for (const c of [
      '.rb-edit-toolbar',
      '.rb-text-toolbar',
      '.rb-img-panel',
      '.rb-layers-rail',
      '.vidro-empty',
      '.board-empty',
      '.drawer-empty',
      '.cliente-finance-empty',
    ]) {
      expect(hasAll(c), c).toBe(true);
    }
  });

  it('keeps the fixed layers rail and the stuck editor header on --vd-solid', () => {
    expect(decl('.rb-layers-rail', 'background')).toEqual(['var(--vd-solid)']);
    expect(decl(['.rb-editor-header', '[data-stuck]'], 'background')).toEqual(['var(--vd-solid)']);
  });

  it('gives the report edit toolbar ink text on the light glass (style.css paints it #fff)', () => {
    expect(decl('.rb-edit-toolbar', 'background').join()).toContain('var(--vd-menu)');
    expect(decl('.rb-edit-toolbar', 'color').join()).toContain('var(--text-main)');
  });

  it('styles the EmptyStateGuide surface, title and body', () => {
    expect(decl('.vidro-empty', 'background').join()).toContain('var(--vd-tile)');
    expect(decl(['.vidro-empty', 'span.font-semibold'], 'color')).toContain('var(--text-main)');
    expect(decl(['.vidro-empty', 'p'], 'color')).toContain('var(--vd-txt2)');
  });

  it('restates the hover, focus and selection states the group rule would otherwise kill', () => {
    expectStates(hasAll, "button[data-slot='card']", [':hover', ':focus-visible']);
    expect(decl(["button[data-slot='card']", '.ring-2'], 'box-shadow').join()).toContain(
      'var(--primary-color)',
    );
    expectStates(hasAll, '.concluded-client-card', [':hover', ':focus-visible']);
    expectStates(hasAll, '.fila-top', [':focus-visible']);
    expect(hasAll(['.niche-month-card', ':hover'])).toBe(true);
    expect(hasAll(['.analytics-post-card', ':hover'])).toBe(true);
    expect(hasAll(['.drawer-post-item', '.expanded'])).toBe(true);
    expect(hasAll(['.rb-layers-row', ':hover'])).toBe(true);
    expect(hasAll('.rb-layers-row-active')).toBe(true);
  });

  it('scopes page-body rules to .vidro-panel; the image panel and the empty guide also live in portals', () => {
    let rules = 0;
    root.walkRules((r) => {
      for (const s of r.selectors) {
        rules += 1;
        const flat = s.replace(/\s+/g, ' ').trim();
        const prefix = s.includes('.rb-img-panel')
          ? [PO_POPOVER]
          : s.includes('.vidro-empty')
            ? [PO_EMPTY]
            : [PB, PB_DARK];
        expect(
          prefix.some((p) => flat.startsWith(p)),
          flat,
        ).toBe(true);
      }
    });
    expect(rules).toBeGreaterThan(0);
  });

  describe('fix round 1', () => {
    it('gives the analytics post card link a focus ring, alone and combined with hover', () => {
      expectStates(hasAll, '.analytics-post-card', [':hover', ':focus-visible']);
      expect(decl(['.analytics-post-card', ':focus-visible'], 'box-shadow').join()).toContain(
        '0 0 0 3px rgba(255, 191, 48, 0.55)',
      );
      const combined = decl(['.analytics-post-card', ':hover', ':focus-visible'], 'box-shadow');
      expect(combined.length).toBeGreaterThan(0);
      for (const v of combined) {
        expect(v).toContain('0 0 0 3px rgba(255, 191, 48, 0.55)');
        expect(v).toContain('var(--vd-cards-shadow-');
      }
    });

    it('keeps the primary wash and border on tinted shadcn cards', () => {
      expect(decl(["[data-slot='card']", "[class*='bg-primary/']"], 'background').join()).toContain(
        'hsl(var(--primary) / 0.05)',
      );
      expect(
        decl(["[data-slot='card']", "[class*='border-primary/']"], 'border-color').join(),
      ).toContain('hsl(var(--primary) / 0.3)');
    });

    it('takes every hover shadow from a variable that has a dark mirror', () => {
      const hoverShadows: string[] = [];
      root.walkRules((r) => {
        if (!r.selector.includes(':hover')) return;
        r.walkDecls('box-shadow', (d) => {
          hoverShadows.push(d.value);
        });
      });
      expect(hoverShadows.length).toBeGreaterThan(0);
      for (const v of hoverShadows) expect(v, v).not.toMatch(/rgba\(18, 21, 26/);
      for (const token of ['--vd-cards-shadow-hover', '--vd-cards-shadow-lift']) {
        const light: string[] = [];
        const dark: string[] = [];
        root.walkDecls(token, (d) => {
          const sel = (d.parent as Rule).selector;
          (sel.includes("[data-theme='dark']") ? dark : light).push(d.value);
        });
        expect(light, `light ${token}`).toHaveLength(1);
        expect(dark, `dark ${token}`).toHaveLength(1);
        expect(dark[0]).not.toBe(light[0]);
      }
    });
  });

  it('makes the report toolbars solid under both glass fallbacks', () => {
    const hits = { reduced: 0, supports: 0 };
    root.walkAtRules((a) => {
      const kind =
        a.name === 'media' && a.params.includes('prefers-reduced-transparency')
          ? 'reduced'
          : a.name === 'supports' && a.params.startsWith('not')
            ? 'supports'
            : null;
      if (!kind) return;
      a.walkRules((r) => {
        const sel = r.selectors.join(' ');
        if (!sel.includes('.rb-edit-toolbar') || !sel.includes('.rb-text-toolbar')) return;
        let solid = false;
        let unblurred = false;
        r.walkDecls((d) => {
          if (d.prop === 'background' && d.value === 'var(--vd-solid)') solid = true;
          if (d.prop === 'backdrop-filter' && d.value === 'none') unblurred = true;
        });
        if (solid && unblurred) hits[kind] += 1;
      });
    });
    expect(hits).toEqual({ reduced: 1, supports: 1 });
  });
});
