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

const { root, decl, hasAll } = loadFamily('badges');

const PB = "html[data-look='vidro'] body:has(.app-container) .vidro-panel";
const OC_HOOKS = [
  "[data-slot='dialog-content']",
  "[data-slot='alert-dialog-content']",
  "[data-slot='sheet-content']",
  "[data-slot='popover-content']",
  '.comment-popover',
  '.comment-add-popover',
  '.mention-suggestion-list',
];

describe('badges.css', () => {
  it('tg geometry', () => {
    expect(decl('.badge', 'font-size')).toContain('11px');
    expect(decl('.badge', 'border-radius')).toContain('999px');
    expect(decl('.badge', 'border-color')).toContain('transparent');
    expect(decl('.badge', 'padding')).toContain('2px 9px');
    expect(decl('.badge', 'white-space')).toContain('nowrap');
  });

  it('tones', () => {
    expect(decl('.badge-success', 'color').join()).toContain('var(--vd-tg-ok)');
    expect(decl('.badge-success', 'background').join()).toContain('var(--vd-tg-ok-bg)');
    expect(decl('.badge-danger', 'background').join()).toContain('var(--vd-tg-bad-bg)');
    expect(decl('.badge-info', 'color').join()).toContain('var(--vd-tg-info)');
    expect(decl('.badge-warning', 'color').join()).toContain('var(--vd-tg-warn)');
    expect(decl('.badge-neutral', 'color').join()).toContain('var(--vd-tg-neutral)');
    expect(decl('.badge-primary', 'color')).toEqual(expect.arrayContaining(['#92400e', '#f5b041']));
    expect(decl('.badge-primary', 'background')).toEqual(
      expect.arrayContaining(['#fff3dc', 'rgba(245, 163, 66, 0.18)']),
    );
  });

  it('keeps solid colours, outline border and the sm size', () => {
    // Tone rules must not repaint a solid badge.
    root.walkRules((r) => {
      for (const s of r.selectors) {
        if (!/\.badge-(success|warning|danger|info|primary)\b/.test(s)) continue;
        if (!r.some((d) => d.type === 'decl' && /^(color|background)$/.test(d.prop))) continue;
        expect(s, s).toMatch(/:not\([^)]*\.badge--solid/);
      }
    });
    root.walkRules((r) => {
      for (const s of r.selectors) {
        const positive = s.replace(/:not\([^)]*\)/g, '');
        if (!positive.includes('.badge--solid')) continue;
        r.walkDecls(/^(color|background)$/, (d) => {
          throw new Error(`solid repainted: ${s} { ${d.prop} }`);
        });
      }
    });
    expect(decl('.badge-outline', 'border-color')).toContain('var(--vd-sep)');
    expect(decl('.badge--sm', 'font-size')).toContain('10px');
    expect(decl('.badge--sm', 'padding')).toContain('1px 7px');
  });

  it('geometry-only pills and plain counts', () => {
    for (const c of [
      '.post-status-chip',
      '.post-tipo-badge',
      '.board-card-deadline',
      '.post-fluxo-tag',
      '.fila-pill',
      '.fila-tag',
      '.auto-schedule-badge',
      '.tag-pill',
      '.board-card-approval-badge',
      '.history-step-badge',
      '.post-production-state',
      '.board-card-type-status-chip',
      '.board-card-posts-chip',
      '.comment-summary-chip',
      '.event-pill',
    ]) {
      expect(hasAll(c), c).toBe(true);
    }
    expect(decl('.board-column-count', 'background').join()).toMatch(/transparent|none/);
    for (const c of ['.board-column-count', '.today-group-count', '.list-group-count']) {
      expect(decl(c, 'border').join(), c).toMatch(/0/);
      expect(decl(c, 'color'), c).toContain('var(--vd-txt3)');
      expect(decl(c, 'padding'), c).toContain('0');
    }
    expect(decl('.event-pill', 'border-radius')).toContain('6px');
    expect(decl('.event-pill', 'font-family')).toContain('inherit');
  });

  it('pills do not repaint their own colours', () => {
    for (const c of ['.post-status-chip', '.fila-pill', '.tag-pill', '.board-card-deadline']) {
      root.walkRules((r) => {
        if (!r.selectors.some((s) => s.includes(c))) return;
        r.walkDecls(/^(background|background-color|color)$/, (d) => {
          throw new Error(`${c} repainted: ${r.selector} { ${d.prop}: ${d.value} }`);
        });
      });
    }
  });

  it('keeps the avulso dashed border, the icon-only tag and the lg sizes', () => {
    root.walkRules((r) => {
      if (!r.some((d) => d.type === 'decl' && d.prop === 'border-color')) return;
      for (const s of r.selectors) {
        if (s.includes('.post-fluxo-tag') && !s.includes('.badge-outline'))
          expect(s, s).toContain(':not(.post-fluxo-tag--avulso)');
      }
    });
    expect(hasAll(['.post-fluxo-tag--icon-only'])).toBe(true);
    expect(hasAll(['.badge--lg'])).toBe(true);
    expect(hasAll(['.fila-pill--lg'])).toBe(true);
  });

  it('restates the focus ring and disabled state on the interactive pills', () => {
    for (const c of ['.post-fluxo-tag', '.board-card-posts-chip', '.board-card-deadline-toggle']) {
      expect(hasAll([c, ':focus-visible']), c).toBe(true);
      expect(hasAll([c, ':disabled']), c).toBe(true);
    }
    expect(decl(':focus-visible', 'box-shadow').join()).toContain('rgba(255, 191, 48, 0.55)');
  });

  it('duplicates the badge rules under the overlay-content prefix', () => {
    const selectors: string[] = [];
    root.walkRules((r) => {
      selectors.push(...r.selectors);
    });
    expect(selectors.some((s) => s.startsWith(PB) && s.includes('.badge-success'))).toBe(true);
    for (const hook of OC_HOOKS) {
      expect(
        selectors.some((s) => !s.startsWith(PB) && s.includes(hook) && s.includes('.badge')),
        hook,
      ).toBe(true);
    }
  });

  it('mirrors badge-primary for dark', () => {
    expect(hasAll(["html[data-theme='dark'][data-look='vidro']", '.badge-primary'])).toBe(true);
  });
});
