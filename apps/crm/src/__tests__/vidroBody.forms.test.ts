import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// prettier wraps long :is() lists; selector assertions compare with whitespace removed
const squash = (x: string) => x.replace(/\s+/g, '');

function loadFamily(name: string) {
  const root = postcss.parse(readFileSync(`apps/crm/src/styles/vidro-body/${name}.css`, 'utf8'));
  const decl = (parts: string | string[], prop: string): string[] => {
    const ps = (Array.isArray(parts) ? parts : [parts]).map(squash);
    const out: string[] = [];
    root.walkRules((r: Rule) => {
      if (!r.selectors.some((s) => ps.every((p) => squash(s).includes(p)))) return;
      r.walkDecls(prop, (d) => {
        out.push(d.value);
      });
    });
    return out;
  };
  // A selector matches when it contains EVERY part (in any order). This is what makes :is() groupings
  // testable: `:is(.a, .b):is(:hover, [data-state='open'])` satisfies hasAll(['.b', ':hover']).
  const hasAll = (parts: string | string[]) => {
    const ps = (Array.isArray(parts) ? parts : [parts]).map(squash);
    let found = false;
    root.walkRules((r) => {
      if (r.selectors.some((s) => ps.every((p) => squash(s).includes(p)))) found = true;
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

const { root, decl, hasAll } = loadFamily('forms');

const FIELD_HOOKS = [
  "[data-slot='input']",
  "[data-slot='textarea']",
  "[data-slot='select-trigger']",
  '.drawer-input',
  '.drawer-select',
  '.time-picker-select',
  '.form-input',
  '.comment-reply-input',
  '.comment-add-input',
  '.comment-edit-input',
  '.post-editor-link-input',
];

describe('forms.css', () => {
  it('fields: fill, transparent border, radius 10', () => {
    expect(decl("[data-slot='input']", 'background').join()).toContain('var(--vd-fill)');
    expect(decl("[data-slot='input']", 'border-radius')).toContain('10px');
    expect(hasAll(["[data-slot='input']", ':focus-visible'])).toBe(true);
  });

  it('covers every field hook from the spec, raw inputs included', () => {
    for (const h of FIELD_HOOKS) {
      expect(hasAll([h]), h).toBe(true);
      expect(hasAll([h, ':focus-visible']), `${h} focus`).toBe(true);
      expect(hasAll([h, ':disabled']), `${h} disabled`).toBe(true);
    }
    for (const t of ['text', 'search', 'email', 'url', 'number', 'date', 'tel']) {
      expect(hasAll([`[type='${t}']`, ':not([data-slot])']), t).toBe(true);
    }
    expect(hasAll(['select:not([data-slot])'])).toBe(true);
    expect(hasAll(['textarea:not([data-slot])'])).toBe(true);
  });

  it('field resting and focus values', () => {
    expect(decl("[data-slot='input']", 'border').join()).toContain('1px solid transparent');
    expect(decl("[data-slot='input']", 'min-height')).toContain('34px');
    expect(decl("[data-slot='input']", 'font-size')).toContain('13px');
    expect(decl("[data-slot='input']", 'color').join()).toContain('var(--text-main)');
    expect(decl(["[data-slot='input']", ':focus-visible'], 'background').join()).toContain(
      'var(--vd-group)',
    );
    expect(decl(["[data-slot='input']", ':focus-visible'], 'border-color').join()).toContain(
      'var(--vd-sep)',
    );
    expect(decl(["[data-slot='input']", ':focus-visible'], 'box-shadow').join()).toContain(
      '0 0 0 3px rgba(255, 191, 48, 0.45)',
    );
    expect(decl(["[data-slot='input']", ':disabled'], 'opacity')).toContain('0.5');
    expect(decl(["[data-slot='input']", ':disabled'], 'cursor')).toContain('not-allowed');
    expect(decl(["[data-slot='input']", "[aria-invalid='true']"], 'border-color').join()).toContain(
      'var(--vd-tg-bad)',
    );
    expect(decl(['::placeholder'], 'color').join()).toContain('var(--vd-txt3)');
  });

  it('textareas grow: auto height, 8px 12px padding, no fixed single-line height', () => {
    expect(decl("[data-slot='textarea']", 'height')).toEqual(['auto']);
    expect(decl("[data-slot='textarea']", 'padding')).toEqual(['8px 12px']);
    // a textarea keeps its own min-height (the 34px floor is single-line only)
    expect(decl("[data-slot='textarea']", 'min-height')).toEqual([]);
    expect(decl('textarea:not([data-slot])', 'height')).toEqual(['auto']);
    expect(decl('.comment-add-input', 'height')).toEqual(['auto']);
    expect(decl("[data-slot='input']", 'height')).toContain('34px');
    expect(decl("[data-slot='select-trigger']", 'height')).toContain('34px');
  });

  it('selects with a classic chevron keep their background-image', () => {
    for (const h of ['.drawer-select', '.form-input', 'select:not([data-slot])']) {
      expect(decl(h, 'background'), `${h} must not use the shorthand`).toEqual([]);
      expect(decl(h, 'background-color').join(), h).toContain('var(--vd-fill)');
    }
  });

  it('select placeholder and search pill', () => {
    expect(hasAll(["[data-slot='select-trigger']", '[data-placeholder]'])).toBe(true);
    expect(decl("[data-slot='select-trigger'][data-placeholder]", 'color').join()).toContain(
      'var(--vd-txt3)',
    );
    expect(decl("input[type='search']", 'border-radius')).toContain('999px');
    expect(decl("input[type='search']", 'height')).toContain('30px');
    expect(decl("input[type='search']", 'padding')).toContain('0 12px');
    const chevron = ["[data-slot='select-trigger']", '> svg:last-child'];
    expect(decl(chevron, 'color').join()).toContain('var(--vd-txt3)');
    expect(decl(chevron, 'opacity')).toContain('1');
    // Bare triggers (border-0, data-variant='bare') keep their own chevron colour.
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        if (sel.includes('> svg:last-child') && sel.includes("[data-slot='select-trigger']"))
          expect(sel, sel).toContain(':not(.border-0)');
      }
    });
  });

  it('an open select trigger keeps its focus border under the pointer', () => {
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        if (sel.includes(':hover') && sel.includes("[data-slot='select-trigger']"))
          expect(sel.replace(/\s+/g, ''), sel).toContain(":not([data-state='open'])");
      }
    });
  });

  it('form-input loses its monospace and letter spacing', () => {
    expect(decl('.form-input', 'font-family')).toContain('inherit');
    expect(decl('.form-input', 'letter-spacing')).toContain('0');
  });

  it('checkbox ink and switch geometry', () => {
    expect(
      decl(["[data-slot='checkbox']", "[data-state='checked']"], 'background').join(),
    ).toContain('var(--vd-cta)');
    expect(
      decl(["[data-slot='checkbox']", "[data-state='indeterminate']"], 'color').join(),
    ).toContain('var(--vd-cta-fg)');
    expect(decl("[data-slot='checkbox']", 'width')).toContain('16px');
    expect(decl("[data-slot='checkbox']", 'border-radius')).toContain('5px');
    expect(decl("[data-slot='checkbox']", 'border').join()).toContain('1.5px solid var(--vd-txt3)');
    expect(decl("[data-slot='switch']", 'width')).toContain('38px');
    expect(decl("[data-slot='switch']", 'height')).toContain('22px');
    expect(decl("[data-slot='switch']", 'border-width')).toContain('2px');
    expect(decl("[data-slot='switch']", 'background').join()).toContain('var(--vd-fill)');
    expect(decl(["[data-slot='switch']", "[data-state='checked']"], 'background').join()).toContain(
      'var(--vd-switch-on)',
    );
    expect(decl("[data-slot='switch-thumb']", 'width')).toContain('18px');
    expect(decl("[data-slot='switch-thumb']", 'height')).toContain('18px');
    expect(decl("[data-slot='switch-thumb']", 'background')).toContain('#fff');
    expect(decl("[data-slot='switch-thumb']", 'box-shadow').join()).toContain(
      '0 1px 2px rgba(0, 0, 0, 0.25)',
    );
    // the thumb travel comes from translate-x-4; the skin must not override it
    expect(decl("[data-slot='switch-thumb']", 'transform')).toEqual([]);
  });

  it('restates disabled and focus on switch and checkbox', () => {
    for (const h of ["[data-slot='switch']", "[data-slot='checkbox']"]) {
      expectStates(hasAll, h, [':hover', ':focus-visible', ':disabled']);
      expect(decl([h, ':disabled'], 'opacity')).toContain('0.5');
    }
    expect(decl(["[data-slot='switch']", ':focus-visible'], 'box-shadow').join()).toContain(
      'rgba(255, 191, 48, 0.55)',
    );
  });

  it('native radios use the ink accent', () => {
    expect(decl("input[type='radio']", 'accent-color').join()).toContain('var(--vd-cta)');
  });

  it('duplicates the field, checkbox and switch rules under the overlay-content list', () => {
    const OC = squash(
      "body:has(.app-container) :is([data-slot='dialog-content'], [data-slot='alert-dialog-content'], [data-slot='sheet-content'], [data-slot='popover-content'], .comment-popover, .comment-add-popover, .mention-suggestion-list)",
    );
    const underOC = (hook: string) => {
      let found = false;
      root.walkRules((r) => {
        if (r.selectors.some((s) => squash(s).includes(OC) && squash(s).includes(squash(hook))))
          found = true;
      });
      return found;
    };
    for (const h of [
      ...FIELD_HOOKS,
      'select:not([data-slot])',
      "input[type='search']",
      "input[type='radio']",
      "[data-slot='checkbox']",
      "[data-slot='switch']",
      "[data-slot='switch-thumb']",
    ]) {
      expect(underOC(h), `OC ${h}`).toBe(true);
    }
  });

  it('every rule is scoped to the vidro panel or the overlay-content list', () => {
    root.walkRules((r) => {
      for (const s of r.selectors) {
        expect(s.includes('.vidro-panel') || s.includes("[data-slot='dialog-content']"), s).toBe(
          true,
        );
      }
    });
  });

  it('search pill rules come after the field rules, so equal specificity resolves to the pill', () => {
    const order: string[] = [];
    root.walkRules((r) => {
      order.push(r.selector);
    });
    const search = order.findIndex((s) => s.includes("input[type='search']"));
    const fieldHeight = order.findIndex((s) => s.includes("[data-slot='input']"));
    expect(search).toBeGreaterThan(fieldHeight);
    expect(search).toBeGreaterThan(-1);
  });

  it('wraps raw-element arms and the exclusion chain in :where(), so they add no specificity', () => {
    let sawRaw = false;
    root.walkRules((r) => {
      for (const sel of r.selectors) {
        const flat = squash(sel);
        // every raw-element arm sits right after `:where(`
        for (const m of flat.matchAll(
          /(input:is\(|select:not\(\[data-slot\]|textarea:not\(\[data-slot\])/g,
        )) {
          sawRaw = true;
          expect(flat.slice(m.index! - 7, m.index!), sel).toBe(':where(');
        }
        // the :not(.border-0) chain never appears outside :where()
        for (const m of flat.matchAll(/:not\(\.border-0\)/g)) {
          const before = flat.slice(0, m.index!);
          const open = before.lastIndexOf(':where(');
          expect(open, sel).toBeGreaterThan(-1);
          // the :where( that encloses it has not been closed yet
          let depth = 0;
          for (const ch of before.slice(open + 6)) {
            if (ch === '(') depth += 1;
            if (ch === ')') depth -= 1;
          }
          expect(depth, sel).toBeGreaterThanOrEqual(1);
        }
      }
    });
    expect(sawRaw).toBe(true);
  });

  it('placeholder and open-state selectors outrank the resting list', () => {
    // resting arms are (0,1,0) or less; these are (0,2,0): a [data-placeholder] / [data-state] attribute
    // beside the hook, with no un-:where()d element+attribute pair in the resting list
    expect(hasAll(["[data-slot='select-trigger'][data-placeholder]"])).toBe(true);
    expect(hasAll(["[data-slot='select-trigger'][data-state='open']"])).toBe(true);
  });

  it('bare and inline editors are excluded from the field skin', () => {
    for (const ex of [
      ':not(.border-0)',
      ':not(.agenda-rapido__titulo)',
      ':not(.rb-editor-title-input)',
      ':not(.rb-section-input)',
      ":not([data-variant='bare'])",
    ]) {
      for (const h of ["[data-slot='input']", "[data-slot='select-trigger']", '.drawer-input']) {
        expect(hasAll([h, ex]), `${h} ${ex}`).toBe(true);
      }
    }
    // .bg-transparent is excluded on raw elements only: shadcn Input / SelectTrigger carry it in their base
    const excl = squash(
      ":not(.border-0):not(.agenda-rapido__titulo):not(.rb-editor-title-input):not(.rb-section-input):not([data-variant='bare'])",
    );
    expect(hasAll(["input:is([type='text']", `${excl}:not(.bg-transparent)`])).toBe(true);
    for (const h of [
      "[data-slot='input']",
      "[data-slot='select-trigger']",
      "[data-slot='textarea']",
    ]) {
      let withHook = false;
      let withBg = false;
      root.walkRules((r) => {
        for (const sel of r.selectors) {
          const flat = squash(sel);
          if (flat.includes(`${h}:where(${excl})`)) withHook = true;
          if (flat.includes(`${h}:where(${excl}:not(.bg-transparent))`)) withBg = true;
        }
      });
      expect(withHook, h).toBe(true);
      expect(withBg, `${h} must keep bg-transparent`).toBe(false);
    }
  });

  it('hover never hides an invalid border', () => {
    expect(hasAll(["[data-slot='input']", ':hover', "[aria-invalid='true']"])).toBe(true);
    root.walkRules((r) => {
      if (!r.selectors.some((s) => s.includes(':hover') && s.includes("[data-slot='input']")))
        return;
      for (const sel of r.selectors) {
        if (sel.includes(':hover')) expect(sel, sel).toContain("not([aria-invalid='true'])");
      }
    });
  });
});
