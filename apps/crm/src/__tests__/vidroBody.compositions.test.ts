import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

function loadFamily(name: string) {
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

const { decl, hasAll } = loadFamily('compositions');

describe('compositions.css', () => {
  it('tables inside cards, buttons in rows, badges in kanban, cards in dialogs', () => {
    expect(hasAll(["[data-slot='card']", ":has(> [data-slot='table-container'])"])).toBe(true);
    expect(hasAll(["[data-slot='table-cell']", "[data-slot='button']"])).toBe(true);
    expect(hasAll(['.board-card', '.badge'])).toBe(true);
    expect(hasAll(["[data-slot='dialog-content']", "[data-slot='card']"])).toBe(true);
    expect(hasAll(['.vidro-toolbar', '.cliente-detalhe-header__back'])).toBe(true);
  });

  it('uses the brief values', () => {
    expect(decl(":has(> [data-slot='table-container'])", 'padding')).toContain('4px');
    expect(decl(['.vidro-toolbar', '.cliente-detalhe-header__back'], 'width')).toContain('36px');
    expect(decl(['.vidro-toolbar', '.cliente-detalhe-header__back'], 'height')).toContain('36px');
    expect(decl(["[data-slot='table-cell']", "[data-slot='button']"], 'width')).toContain('28px');
    expect(decl(['.board-card', '.badge'], 'font-size')).toContain('10px');
    expect(decl(['.board-card', '.badge'], 'padding')).toContain('1px 7px');
    expect(decl(["[data-slot='dialog-content']", "[data-slot='card']"], 'background')).toContain(
      'var(--vd-tile)',
    );
  });

  it('only pads down a card whose sole content is the table', () => {
    expect(
      hasAll([
        ":has(> [data-slot='table-container'])",
        ":not(:has(> :not([data-slot='table-container'])))",
      ]),
    ).toBe(true);
    expect(hasAll(':has(> .data-table:only-child)')).toBe(true);
    expect(hasAll(':has(> :only-child > .data-table)')).toBe(true);
    expect(hasAll(':has(.data-table)')).toBe(false);
  });

  it('lifts the panel over the sidebar and the banner while an unportaled drawer is open', () => {
    expect(hasAll(['.vidro-panel:has(', '.drawer-panel', '.drawer-overlay'])).toBe(true);
    // Above .banner-container (115, rendered outside the panel), below the lowest portaled layer (9005).
    const z = decl(['.vidro-panel:has(', '.drawer-panel'], 'z-index');
    expect(z).toEqual(['200']);
    expect(Number(z[0])).toBeGreaterThan(115);
    expect(Number(z[0])).toBeLessThan(9005);
  });

  it('keeps the sticky fluxo selection bar opaque in dark (main remaps --surface-2 translucent)', () => {
    const { decl } = loadFamily('compositions');
    expect(decl(["[data-theme='dark']", '.drawer-selection-bar'], 'background')).toEqual([
      'var(--vd-solid)',
    ]);
  });

  it('hides the icon-only twin of a header action (the full button shows beside it)', () => {
    const { decl } = loadFamily('compositions');
    expect(
      decl(["[data-slot='button'][data-size='icon']", '.header-actions-icon-only'], 'display'),
    ).toEqual(['none']);
  });

  it('restates the field fill on hover for the raw h-7 input', () => {
    expect(decl(['input.h-7.border-input.bg-transparent:hover'], 'background')).toContain(
      'var(--vd-fill)',
    );
  });

  it('compact h-7 fields keep 28px and the raw ones take the field look with every state', () => {
    expect(decl(["[data-slot='select-trigger'].h-7"], 'height')).toContain('28px');
    const raw = 'input.h-7.border-input.bg-transparent';
    expect(decl([raw], 'background').join()).toContain('var(--vd-fill)');
    expect(hasAll([raw, ':focus-visible'])).toBe(true);
    expect(decl([raw, ':focus-visible'], 'box-shadow')).toContain(
      '0 0 0 3px rgba(255, 191, 48, 0.45)',
    );
    expect(decl([raw, ':disabled'], 'opacity')).toContain('0.5');
    for (const part of ["[data-slot='select-trigger'].h-7", raw]) {
      expect(hasAll(['.vidro-panel', part]), `PB ${part}`).toBe(true);
      expect(hasAll(["[data-slot='dialog-content']", part]), `OC ${part}`).toBe(true);
    }
  });

  it('keeps circular toggle items round inside the segmented capsule', () => {
    const parts = ["[data-slot='toggle-group-item'].rounded-full", ':not(.agenda-rapido__tipos)'];
    expect(decl(parts, 'width')).toContain('28px');
    expect(decl(parts, 'padding')).toContain('0');
    expect(hasAll(["[data-slot='dialog-content']", ...parts])).toBe(true);
  });

  it('out-ranks the 32px icon circle in buttons.css (0,6,2) instead of relying on source order', () => {
    // The back button is a Button size="icon"; its selector chains the slot and size hooks.
    expect(
      hasAll([
        '.vidro-toolbar',
        ".cliente-detalhe-header__back[data-slot='button'][data-size='icon']",
      ]),
    ).toBe(true);
    expect(
      hasAll([
        "[data-slot='table-cell']",
        "[data-slot='button'][data-size='icon']:not([data-variant='link'])",
      ]),
    ).toBe(true);
  });
});
