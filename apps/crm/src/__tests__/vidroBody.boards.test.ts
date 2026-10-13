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

function expectStates(
  hasAll: (p: string[]) => boolean,
  hook: string,
  states = [':hover', ':focus-visible', ':disabled'],
) {
  for (const st of states) expect(hasAll([hook, st]), `${hook} ${st}`).toBe(true);
}

const { root, decl, hasAll } = loadFamily('boards');

describe('boards.css', () => {
  it('columns are tiles, cards are kcards', () => {
    expect(decl('.board-column', 'background').join()).toContain('var(--vd-tile)');
    expect(decl('.board-column', 'border-radius')).toContain('16px');
    expect(decl('.board-column-header', 'border-bottom')).toContain('0');
    expect(decl('.board-column-title', 'text-transform')).toContain('none');
    expect(decl('.board-column-title', 'letter-spacing')).toContain('0');
    expect(decl('.board-column-body', 'background')).toContain('transparent');
    expect(decl('.board-card', 'border-radius')).toContain('12px');
    expect(decl('.board-post-card', 'border-radius')).toContain('12px');
    expect(decl('.board-card', 'box-shadow').join()).toMatch(/none/);
    expect(decl('.board-card', 'background').join()).toContain('var(--vd-group)');
    expect(decl('.board-drop-slot', 'border-radius')).toContain('12px');
  });

  it('cards keep dnd-kit transforms alone and restate hover and focus', () => {
    expect(decl('.board-card', 'transform')).toEqual([]);
    expect(decl('.board-post-card', 'transform')).toEqual([]);
    expect(hasAll(['.board-card', ':hover'])).toBe(true);
    expect(hasAll(['.board-card', ':is(:focus-visible, :has(:focus-visible))'])).toBe(true);
    expect(
      decl(['.board-card', ':is(:focus-visible, :has(:focus-visible))'], 'box-shadow').join(),
    ).toContain('0 0 0 3px rgba(255, 191, 48, 0.55)');
  });

  it('drag clones are opaque and keep their shadow', () => {
    expect(decl('.board-post-card--overlay', 'background')).toContain('var(--vd-solid)');
    expect(decl('.vidro-drag-clone', 'background')).toContain('var(--vd-solid)');
    const kanban = readFileSync('apps/crm/src/pages/entregas/views/KanbanView.tsx', 'utf8');
    expect(kanban).toContain('<DragOverlay className="vidro-drag-clone">');
  });

  it('column header rounds its inline tint', () => {
    expect(decl('.board-column-header', 'border-radius')).toContain('10px');
  });

  it('today and selected compensate the thicker border; foreign cards keep their own border', () => {
    expect(decl(['.calendar-day', '.today'], 'padding').join()).toContain('calc(0.75rem - 1px)');
    expect(decl('.calendar-cell', 'padding')).toEqual(['7px', '6px']);
    expect(hasAll([':not(.foreign)', '.calendar-post-card', ':hover'])).toBe(true);
    expect(hasAll(['.calendar-day', ':hover:not(.empty)', ':not(:disabled):not('])).toBe(true);
    expect(hasAll(['.board-card', ':is(:focus-visible, :has(:focus-visible))'])).toBe(true);
    expect(hasAll([':focus-within'])).toBe(false);
  });

  it('drag-clone rules come after the card rule, so source order makes them win', () => {
    const order: string[] = [];
    root.walkRules((r) => {
      if (r.selectors.some((s) => /\.board-post-card--overlay|\.vidro-drag-clone/.test(s)))
        order.push('clone');
      else if (r.selectors.some((s) => /:is\(\.board-card, \.board-post-card\)$/.test(s.trim())))
        order.push('card');
    });
    expect(order.indexOf('card')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('clone')).toBeGreaterThan(order.lastIndexOf('card'));
  });

  it('keeps the floating overlay clone shadow', () => {
    expect(decl('.board-post-card--overlay', 'box-shadow').join()).toContain('rgba(0, 0, 0, 0.2)');
  });

  it('calendar cells', () => {
    expect(decl('.calendar-day', 'border-radius')).toContain('12px');
    expect(decl('.calendar-cell', 'border-radius')).toContain('12px');
    expect(decl('.calendar-day', 'border').join()).toContain('var(--vd-sep)');
    expect(
      decl(['.calendar-day', '.today'], 'border').join() +
        decl(['.calendar-day', '.today'], 'border-color').join(),
    ).toContain('#ffbf30');
    expect(decl(['.calendar-cell', '.today'], 'border').join()).toContain('#ffbf30');
    expect(decl(['.calendar-day', '.empty'], 'background')).toContain('transparent');
    expect(decl(['.calendar-day', '.empty'], 'border-color')).toContain('transparent');
    expect(decl(['.calendar-day', '.today'], 'background')).toEqual([]);
    expectStates(hasAll, '.calendar-day');
  });

  it('calendar and sidebar post cards', () => {
    expect(decl('.calendar-post-card', 'border-radius')).toContain('8px');
    expect(decl('.sidebar-post-card', 'border-color').join()).toContain('var(--vd-sep)');
    expectStates(hasAll, '.calendar-post-card', [':hover', ':focus-visible', '.selected']);
    expect(hasAll(['.sidebar-post-card', ':hover'])).toBe(true);
  });

  it('agenda-fc tokens', () => {
    expect(decl('.agenda-fc', '--fc-border-color').join()).toContain('var(--vd-sep)');
    expect(decl('.agenda-fc', '--fc-page-bg-color')).toContain('transparent');
    expect(decl('.agenda-fc', '--fc-neutral-bg-color').join()).toContain('var(--vd-fill)');
  });

  it('every rule uses the page-body prefix', () => {
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        const s = sel.replace(/\s+/g, ' ');
        expect(s, s).toMatch(
          /^html(\[data-theme='dark'\])?\[data-look='vidro'\] body:has\(\.app-container\) \.vidro-panel /,
        );
      }
    });
  });
});
