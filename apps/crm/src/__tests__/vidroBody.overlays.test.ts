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

const { root, decl, hasAll } = loadFamily('overlays');
const PO = "html[data-look='vidro'] body:has(.app-container)";
const PO_DARK = "html[data-theme='dark'][data-look='vidro'] body:has(.app-container)";

describe('overlays.css', () => {
  it('dialogs: panel glass, radius 20, fullscreen excluded', () => {
    expect(decl("[data-slot='dialog-content']", 'border-radius')).toContain('20px');
    expect(hasAll(":not([data-layout='fullscreen'])")).toBe(true);
    expect(decl('.drawer-panel', 'background').join()).toContain('var(--vd-panel)');
    expect(decl("[data-slot='alert-dialog-content']", 'box-shadow').join()).toContain(
      'var(--vd-shadow)',
    );
  });

  it('never styles the fullscreen dialog', () => {
    root.walkRules((r) => {
      for (const s of r.selectors) {
        if (!s.includes("[data-slot='dialog-content']")) continue;
        expect(s, s).toContain("[data-slot='dialog-content']:not([data-layout='fullscreen'])");
      }
    });
  });

  it('blurs the post drawer through ::before, never on .drawer-panel itself', () => {
    // backdrop-filter makes an element the containing block of position: fixed descendants, and the
    // drawer hosts a non-portaled dnd-kit DragOverlay and .time-picker-overlay (WorkflowCalendarView).
    root.walkRules((r) => {
      for (const s of r.selectors) {
        if (!/\.drawer-panel(?![\w-])/.test(s) || s.includes('::before')) continue;
        r.walkDecls(/backdrop-filter$/, (d) => {
          throw new Error(`${d.prop} on .drawer-panel itself: ${s}`);
        });
      }
    });
    expect(decl('.drawer-panel::before', 'backdrop-filter').join()).toContain('blur(30px)');
    expect(decl('.drawer-panel.fullscreen', 'border-radius')).toContain('0');
  });

  it('never puts a pseudo-element inside :is() (it would drop the whole selector list)', () => {
    root.walkRules((r) => {
      for (const s of r.selectors) {
        expect(/:is\([^)]*::/.test(s.replace(/\s+/g, ' ')), s).toBe(false);
      }
    });
  });

  it('overlays: dim + light blur', () => {
    for (const hook of [
      "[data-slot='dialog-overlay']",
      "[data-slot='alert-dialog-overlay']",
      "[data-slot='sheet-overlay']",
      '.drawer-overlay',
    ]) {
      expect(decl(hook, 'background').join(), hook).toContain('var(--vd-overlay)');
    }
  });

  it('sheets: panel glass with the radius on the inner edge only', () => {
    expect(decl("[data-slot='sheet-content']", 'background').join()).toContain('var(--vd-panel)');
    expect(decl("[data-slot='sheet-content']", 'border-color').join()).toContain(
      'var(--vd-glass-bd)',
    );
    expect(decl('.sheet-pane--right', 'border-radius')).toContain('20px 0 0 20px');
    expect(decl('.sheet-pane--left', 'border-radius')).toContain('0 20px 20px 0');
    expect(decl('.sheet-pane--bottom', 'border-radius')).toContain('20px 20px 0 0');
    expect(decl('.sheet-pane--top', 'border-radius')).toContain('0 0 20px 20px');
  });

  it('menus and items', () => {
    expect(decl("[data-slot='dropdown-menu-content']", 'background').join()).toContain(
      'var(--vd-menu)',
    );
    expect(hasAll(["[data-slot='dropdown-menu-sub-trigger']", "[data-state='open']"])).toBe(true);
    expect(hasAll('[data-highlighted]')).toBe(true);
    expect(hasAll('[data-disabled]')).toBe(true);
    expect(decl('.callout-emoji-picker', 'background').join()).toContain('var(--vd-solid)');
  });

  it('never pads popover-content (popovers lay out their own padding)', () => {
    root.walkRules((r) => {
      if (!r.selectors.some((s) => s.includes("[data-slot='popover-content']"))) return;
      r.walkDecls('padding', (d) => {
        throw new Error(`padding on popover-content: ${r.selector} { ${d} }`);
      });
    });
    expect(decl("[data-slot='select-content']", 'padding')).toContain('5px');
  });

  it('keeps enabled cmdk items (data-disabled="false") at full opacity', () => {
    // cmdk renders data-disabled="false" on every enabled item; a bare [data-disabled] dims them all.
    root.walkRules((r) => {
      for (const s of r.selectors) {
        if (!s.includes('[data-disabled]')) continue;
        expect(s, s).toContain(":not([data-disabled='false'])");
      }
    });
  });

  it('item interaction states', () => {
    for (const hook of [
      "[data-slot='dropdown-menu-item']",
      "[data-slot='dropdown-menu-sub-trigger']",
      "[data-slot='select-item']",
      "[data-slot='command-item']",
    ]) {
      expect(hasAll([hook, '[data-highlighted]']), hook).toBe(true);
      expect(hasAll([hook, ':focus-visible']), hook).toBe(true);
      expect(hasAll([hook, '[data-disabled]']), hook).toBe(true);
    }
    expect(hasAll(["[data-slot='command-item']", "[aria-selected='true']"])).toBe(true);
  });

  it('clears the Command background only inside a non-fullscreen dialog', () => {
    root.walkRules((r) => {
      for (const s of r.selectors) {
        if (!s.includes("[data-slot='command']")) continue;
        expect(s, s).toContain("[data-slot='dialog-content']:not([data-layout='fullscreen'])");
      }
    });
    expect(decl("[data-slot='command']", 'background')).toContain('transparent');
  });

  it('toasts and fallbacks', () => {
    expect(hasAll('[data-sonner-toast]')).toBe(true);
    expect(decl(['.toaster', '[data-sonner-toast]'], 'border-radius')).toContain('14px');
    let reduced = false;
    let supports = false;
    loadFamily('overlays').root.walkAtRules((a) => {
      if (a.name === 'media' && a.params.includes('prefers-reduced-transparency')) reduced = true;
      if (a.name === 'supports' && a.params.startsWith('not')) supports = true;
    });
    expect(reduced && supports).toBe(true);
  });

  it('fallbacks make the dialog, sheet, menu and toast surfaces solid', () => {
    const solid: string[] = [];
    root.walkAtRules((a) => {
      const fallback =
        (a.name === 'media' && a.params.includes('prefers-reduced-transparency')) ||
        a.name === 'supports';
      if (!fallback) return;
      a.walkRules((r) => {
        r.walkDecls('background', (d) => {
          if (d.value === 'var(--vd-solid)') solid.push(...r.selectors);
        });
      });
    });
    for (const hook of [
      "[data-slot='dialog-content']",
      "[data-slot='alert-dialog-content']",
      '.drawer-panel',
      "[data-slot='sheet-content']",
      "[data-slot='dropdown-menu-content']",
      "[data-slot='popover-content']",
      '[data-sonner-toast]',
    ]) {
      expect(
        solid.some((s) => s.includes(hook)),
        hook,
      ).toBe(true);
    }
  });

  it('toast action is the CTA, cancel is ghost, both with states', () => {
    // sonner puts data-button on both buttons; the action must exclude the cancel one.
    expect(decl('[data-button]:not([data-cancel])', 'background').join()).toContain(
      'var(--vd-cta)',
    );
    expect(decl('[data-cancel]', 'background').join()).toContain('transparent');
    expectStates(hasAll, '[data-button]:not([data-cancel])');
    expectStates(hasAll, '[data-cancel]');
  });

  it('scopes every rule with the PO prefix', () => {
    root.walkRules((r) => {
      for (const raw of r.selectors) {
        const s = raw.replace(/\s+/g, ' ').trim();
        expect(s.startsWith(PO) || s.startsWith(PO_DARK), s).toBe(true);
      }
    });
  });
});
