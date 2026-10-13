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
  // A selector matches when it contains EVERY part (in any order).
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

const { root, decl, hasAll } = loadFamily('controls');
const TG_ITEM = [
  "[data-slot='toggle-group']:not(.agenda-segmented)",
  "[data-slot='toggle-group-item']",
];
const OC_MARK = "[data-slot='popover-content']";
const PB_MARK = '.vidro-panel';

describe('controls.css', () => {
  it('segmented capsule for vista-tabs, icon-seg, toggle-group', () => {
    expect(decl('.vista-tabs__group', 'border-radius')).toContain('999px');
    expect(decl('.vista-tabs__group', 'background')).toContain('var(--vd-fill)');
    expect(decl('.icon-seg', 'border-radius')).toContain('999px');
    expect(decl("[data-slot='toggle-group']:not(.agenda-segmented)", 'background')).toContain(
      'var(--vd-fill)',
    );
    expect(decl([...TG_ITEM, "[data-state='on']"], 'background').join()).toContain('var(--vd-sel)');
    expect(decl([...TG_ITEM, "[data-state='on']"], 'color').join()).toContain('var(--vd-sel-fg)');
    expect(decl([...TG_ITEM], 'height')).toContain('28px');
    expect(decl('.vista-tab--active', 'background').join()).toContain('var(--vd-sel)');
    expect(hasAll('.icon-seg__item')).toBe(true);
    expect(decl(['.icon-seg__item', "[data-state='on']"], 'background').join()).toContain(
      'var(--vd-sel)',
    );
    expect(decl('.vista-tab::after', 'display')).toContain('none');
    expect(hasAll(['.vista-tab--add', ':hover'])).toBe(true);
    expect(hasAll('.vista-tab-more')).toBe(true);
  });

  it('never reaches the toggle-group items or tracks the shell owns (.agenda-segmented)', () => {
    let toggleRules = 0;
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        if (sel.includes("[data-slot='toggle-group")) {
          toggleRules += 1;
          expect(sel, sel).toContain(':not(.agenda-segmented)');
        }
        // The shell's own hooks are never named, positively.
        expect(sel, sel).not.toMatch(/(?<!:not\()\.agenda-segmented/);
        expect(sel, sel).not.toContain('.vidro-seg');
      }
    });
    expect(toggleRules).toBeGreaterThan(0);
  });

  it('matches toggle-group items at any depth, never only as direct children', () => {
    let seen = 0;
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        if (!sel.includes("[data-slot='toggle-group-item']")) continue;
        seen += 1;
        expect(sel, sel).not.toMatch(/>\s*\[data-slot='toggle-group-item'\]/);
        expect(sel, sel).toContain(':not(.agenda-segmented)');
      }
    });
    expect(seen).toBeGreaterThan(0);
  });

  it('the .vista-tabs row itself is a plain transparent row, only the group is the capsule', () => {
    let seen = 0;
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        if (!/\.vista-tabs(?![\w-])/.test(sel)) continue;
        seen += 1;
        r.walkDecls((d) => {
          if (d.prop === 'background') expect(d.value, sel).toBe('transparent');
          if (d.prop === 'width') expect(d.value, sel).not.toBe('fit-content');
          expect(d.prop === 'display' && d.value === 'inline-flex', sel).toBe(false);
        });
      }
    });
    expect(seen).toBeGreaterThan(0);
    expect(decl('.vista-tabs__group', 'overflow-x')).toContain('auto');
  });

  it('keeps the agenda-rapido chips out of the capsule track', () => {
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        if (sel.includes("[data-slot='toggle-group"))
          expect(sel, sel).toContain(':not(.agenda-rapido__tipos)');
      }
    });
  });

  it('restates item states', () => {
    for (const hook of ['.vista-tab', '.icon-seg__item', ...TG_ITEM.slice(1)]) {
      expectStates(hasAll, hook);
    }
    expect(decl(['.icon-seg__item', ':focus-visible'], 'box-shadow').join()).toContain(
      'rgba(255, 191, 48, 0.55)',
    );
    expect(decl(['.icon-seg__item', ':disabled'], 'opacity')).toContain('0.5');
    expect(decl(['.icon-seg__item', ':disabled'], 'cursor')).toContain('not-allowed');
  });

  it('chips', () => {
    expect(decl('.today-chip', 'height')).toContain('28px');
    expect(decl('.today-chip', 'border-radius')).toContain('999px');
    expect(decl('.today-chip', 'background')).toContain('var(--vd-fill)');
    expect(hasAll(['.today-chip', "[aria-pressed='true']"])).toBe(true);
    expect(hasAll('.platform-chip--on')).toBe(true);
    for (const c of [
      '.today-chip',
      '.platform-chip',
      '.icon-chip',
      '.agenda-rapido__tipo',
      '.list-groups-toggle',
    ]) {
      expect(decl(c, 'height'), c).toContain('28px');
      expectStates(hasAll, c);
    }
    expect(decl(['.platform-chip--on', ':is('], 'background').join()).toContain('var(--vd-sel)');
    expect(decl(['.today-chip', "[data-state='on']"], 'color').join()).toContain(
      'var(--vd-sel-fg)',
    );
  });

  it('keeps the danger colour on the pressed overdue chip', () => {
    const sel = ['.today-chip.is-danger', "[aria-pressed='true']"];
    expect(decl(sel, 'background').join()).toContain('var(--vd-tg-bad-bg)');
    expect(decl(sel, 'color').join()).toContain('var(--vd-tg-bad)');
  });

  it('side navs take the quiet fill', () => {
    expect(decl(['.cliente-tabs-nav__item', '.active'], 'background').join()).toContain(
      'var(--vd-fill)',
    );
    expect(decl(['.config-nav-item', '.active'], 'background').join()).toContain('var(--vd-fill)');
    for (const n of ['.cliente-tabs-nav__item', '.config-nav-item']) {
      expect(decl(n, 'height'), n).toContain('30px');
      expect(decl(n, 'border-radius'), n).toContain('10px');
      expect(decl([n, '.active'], 'font-weight').join(), n).toContain('600');
      expect(decl([n, ':hover'], 'background').join(), n).toContain('var(--vd-fill)');
      expectStates(hasAll, n);
    }
  });

  it('duplicates segmented and chip rules for portaled content, side navs stay in the page body', () => {
    const under = (hook: string, mark: string) => hasAll([hook, mark]);
    for (const hook of [
      '.vista-tabs__group',
      '.icon-seg__item',
      TG_ITEM[1],
      '.today-chip',
      '.platform-chip--on',
      '.agenda-rapido__tipo',
    ]) {
      expect(under(hook, OC_MARK), `OC ${hook}`).toBe(true);
      expect(under(hook, PB_MARK), `PB ${hook}`).toBe(true);
    }
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        if (/cliente-tabs-nav__item|config-nav-item/.test(sel)) expect(sel, sel).toContain(PB_MARK);
      }
    });
  });

  it('mirrors the hover fills in dark', () => {
    expect(
      hasAll(["html[data-theme='dark'][data-look='vidro']", '.icon-seg__item', ':hover']),
    ).toBe(true);
    expect(hasAll(["html[data-theme='dark'][data-look='vidro']", '.today-chip', ':hover'])).toBe(
      true,
    );
  });
});
