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

const { root, decl, hasAll } = loadFamily('buttons');

const PB = "html[data-look='vidro'] body:has(.app-container) .vidro-panel";
const OC =
  "html[data-look='vidro'] body:has(.app-container) :is([data-slot='dialog-content'], [data-slot='alert-dialog-content'], [data-slot='sheet-content'], [data-slot='popover-content'], .comment-popover, .comment-add-popover, .mention-suggestion-list)";

/** A selector with prettier's line breaks folded back to one line. */
const flat = (sel: string) =>
  sel
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/,?\s+\)/g, ')');

/** hasAll over flattened selectors. */
function hasAllFlat(parts: string[]): boolean {
  let found = false;
  root.walkRules((r) => {
    if (r.selectors.some((s) => parts.every((p) => flat(s).includes(p)))) found = true;
  });
  return found;
}

/** decl over flattened selectors. */
function declFlat(parts: string[], prop: string): string[] {
  const out: string[] = [];
  root.walkRules((r) => {
    if (!r.selectors.some((s) => parts.every((p) => flat(s).includes(p)))) return;
    r.walkDecls(prop, (d) => {
      out.push(d.value);
    });
  });
  return out;
}

/** Source-order index of the first rule whose flattened selector contains every part. */
function ruleIndexFlat(parts: string[]): number {
  let i = 0;
  let found = -1;
  root.walkRules((r) => {
    if (found === -1 && r.selectors.some((s) => parts.every((p) => flat(s).includes(p)))) found = i;
    i += 1;
  });
  return found;
}

/** Source-order index of the first rule with a selector containing every part. */
function ruleIndex(parts: string[]): number {
  let i = 0;
  let found = -1;
  root.walkRules((r) => {
    if (found === -1 && r.selectors.some((s) => parts.every((p) => s.includes(p)))) found = i;
    i += 1;
  });
  return found;
}

describe('buttons.css', () => {
  it('CTA: ink pill', () => {
    expect(decl("[data-variant='default']", 'background').join()).toContain('var(--vd-cta)');
    expect(decl('.btn-primary', 'border-radius')).toContain('999px');
    expect(decl("[data-variant='default']", 'height')).toContain('36px');
  });

  it('glass, ghost, danger looks exist', () => {
    expect(decl("[data-variant='outline']", 'background').join()).toContain('var(--vd-cap)');
    expect(decl("[data-variant='ghost']", 'background').join()).toMatch(/transparent/);
    expect(decl("[data-variant='destructive']", 'background').join()).toContain(
      'var(--vd-tg-bad-bg)',
    );
  });

  it('restates hover, focus-visible, disabled on every look', () => {
    for (const h of [
      "[data-variant='default']",
      "[data-variant='outline']",
      "[data-variant='ghost']",
      "[data-variant='destructive']",
      '.btn-primary',
      '.btn-secondary',
      '.post-editor-btn',
      '.vidro-cal-day',
    ]) {
      expectStates(hasAll, h);
    }
  });

  it('keeps the toolbar button margin rule out of this file', () => {
    expect(hasAll('.sidebar')).toBe(false);
    expect(hasAll('.vidro-capsule')).toBe(false);
  });

  it('duplicates the page-body rules for portaled overlay content', () => {
    for (const h of [
      "[data-variant='default']",
      "[data-variant='outline']",
      "[data-variant='ghost']",
      "[data-variant='destructive']",
      '.vidro-cal-day',
    ]) {
      expect(hasAllFlat([PB, h]), `PB ${h}`).toBe(true);
      expect(hasAllFlat([OC, h]), `OC ${h}`).toBe(true);
    }
  });

  it('paints the destructive AlertDialogAction call sites with the danger look, after the CTA', () => {
    for (const hook of ['.bg-destructive', "[class*='bg-[var(--danger)]']"]) {
      expect(hasAll(["[data-variant='destructive']", hook]), hook).toBe(true);
      expect(hasAll(["[data-variant='destructive']", hook, ':hover']), `${hook} :hover`).toBe(true);
      expect(decl(["[data-variant='destructive']", hook], 'background').join()).toContain(
        'var(--vd-tg-bad-bg)',
      );
    }
    // Both :is() lists peak at (0,2,0), so the danger rules win by coming later.
    expect(ruleIndex(["[data-variant='destructive']", '.bg-destructive'])).toBeGreaterThan(
      ruleIndex(["[data-variant='default']", ':focus-visible']),
    );
  });

  it('gives danger a dark hover that clears AA', () => {
    expect(
      decl(["html[data-theme='dark'][data-look='vidro']", '.btn-danger', ':hover'], 'background'),
    ).toContain('var(--danger)');
  });

  it('puts dark ink on the dark danger hover fill (white on --danger is about 3.3:1)', () => {
    expect(
      decl(["html[data-theme='dark'][data-look='vidro']", '.btn-danger', ':hover'], 'color'),
    ).toEqual(['#12151a']);
  });

  it('keeps the modifier classes out of their base look', () => {
    expect(hasAll('.calendar-detail-btn:not(.calendar-detail-btn--primary')).toBe(true);
    expect(hasAll('.btn-instagram-action:not(.btn-instagram-action--danger)')).toBe(true);
    expect(hasAll('.drawer-selection-bar-btn:not(.drawer-selection-bar-btn--ghost)')).toBe(true);
    expect(hasAll('.vidro-board-action:not(.vidro-board-action--complete')).toBe(true);
  });

  it('sets border 0 and padding on board-card actions so style.css loses, without touching flex', () => {
    expect(decl("[data-variant='ghost']", 'border')).toContain('0');
    expect(decl('.board-card-actions button', 'padding').length).toBeGreaterThan(0);
    expect(decl('.board-card-actions button', 'flex')).toEqual([]);
  });

  it('makes every icon-size Button a 32px circle with no padding', () => {
    expect(decl("[data-size='icon']", 'width')).toContain('32px');
    expect(decl("[data-size='icon']", 'padding')).toContain('0');
  });

  it('keys the day picker states on the DayPicker td modifiers', () => {
    expect(decl(["td[data-selected='true']", '> .vidro-cal-day'], 'background')).toContain(
      'var(--vd-cta)',
    );
    expect(decl(["td[data-today='true']", '> .vidro-cal-day'], 'box-shadow').join()).toContain(
      'inset 0 0 0 2px #ffbf30',
    );
    expect(decl(["td[data-outside='true']", '> .vidro-cal-day'], 'color')).toContain(
      'var(--vd-txt3)',
    );
    expect(hasAllFlat([OC, "td[data-selected='true'] > .vidro-cal-day"])).toBe(true);
  });

  it('keys the editor toolbar pressed state on the class the markup renders', () => {
    expect(decl(['.post-editor-btn', '.active'], 'background')).toContain('var(--vd-fill)');
  });
});

describe('buttons.css fix round 1', () => {
  const DANGER_TEXT = [
    '.text-destructive',
    "[class~='text-[var(--danger-text)]']",
    "[class~='text-[var(--danger)]']",
  ];
  const GHOST_REST = ruleIndexFlat(["[data-slot='button'][data-variant='ghost']"]);
  const GLASS_REST = ruleIndexFlat(["[data-variant='outline'], [data-variant='secondary']"]);
  const CTA_REST = ruleIndexFlat(["[data-variant='default'], [data-variant='ink']"]);

  it('keeps danger-coloured text on ghost and glass Buttons, in PB and OC', () => {
    for (const hook of DANGER_TEXT) {
      expect(declFlat(["[data-slot='button']:is(", hook], 'color'), hook).toContain(
        'var(--vd-tg-bad)',
      );
      expect(hasAllFlat([PB, "[data-slot='button']:is(", hook]), `PB ${hook}`).toBe(true);
      expect(hasAllFlat([OC, "[data-slot='button']:is(", hook]), `OC ${hook}`).toBe(true);
    }
    // Ties the ghost and glass lists at (0,2,0): it must come after both, and before the CTA and
    // danger pills so those keep their own colours.
    const at = ruleIndexFlat(["[data-slot='button']:is(.text-destructive"]);
    expect(at).toBeGreaterThan(GHOST_REST);
    expect(at).toBeGreaterThan(GLASS_REST);
    expect(at).toBeLessThan(CTA_REST);
  });

  it('hovers danger-coloured Buttons in the danger tint, keeping the danger colour', () => {
    expect(declFlat(['.text-destructive', ':hover'], 'background')).toContain(
      'var(--vd-tg-bad-bg)',
    );
    expect(declFlat(['.text-destructive', ':hover'], 'color')).toContain('var(--vd-tg-bad)');
  });

  it('keeps the muted placeholder colour on picker triggers', () => {
    expect(declFlat(["[data-slot='button'].text-muted-foreground"], 'color')).toContain(
      'var(--vd-txt3)',
    );
    const at = ruleIndexFlat(["[data-slot='button'].text-muted-foreground"]);
    expect(at).toBeGreaterThan(GLASS_REST);
    expect(at).toBeGreaterThan(GHOST_REST);
    expect(at).toBeLessThan(CTA_REST);
  });

  it('shows the on/open state of outline toggles (ListToolbar)', () => {
    for (const hook of ["[aria-pressed='true']", '.bg-accent']) {
      expectStates(hasAll, hook);
      expect(
        declFlat(["[data-slot='button'][data-variant='outline']:is(", hook], 'background'),
      ).toContain('var(--vd-sel)');
    }
    expect(
      declFlat(["[data-slot='button'][data-variant='outline']:is(", ':hover'], 'background'),
    ).toContain('var(--vd-sel)');
  });

  it('keeps the kanban history button at its classic 28px, after the icon circle rule', () => {
    const parts = ['.board-card-actions .drawer-post-history-btn'];
    expect(declFlat(parts, 'width')).toContain('28px');
    expect(declFlat(parts, 'height')).toContain('28px');
    expect(ruleIndexFlat(parts)).toBeGreaterThan(
      ruleIndexFlat(["[data-slot='button'][data-size='icon']"]),
    );
  });

  it('paints range middle days as a soft band, not ink circles', () => {
    const MID = "td.vidro-cal-range-middle[data-selected='true']";
    expect(declFlat([MID, '> .vidro-cal-day'], 'background')).toContain('transparent');
    expect(declFlat([MID, '> .vidro-cal-day'], 'color')).toContain('var(--text-main)');
    expect(declFlat([MID + ':has(> .vidro-cal-day)'], 'background')).toContain('var(--vd-fill)');
    // The selected-day hover sets the ink foreground; the middle hover must restate the colour.
    expect(declFlat([MID, '> .vidro-cal-day', ':hover'], 'color')).toContain('var(--text-main)');
    expect(hasAllFlat([OC, MID])).toBe(true);
    // Later than the selected-day ink rule, so the middle wins where both match.
    expect(ruleIndexFlat([MID, '> .vidro-cal-day'])).toBeGreaterThan(
      ruleIndexFlat(["td[data-selected='true'] > .vidro-cal-day"]),
    );
  });
  it('muted ghost Buttons and kanban footer actions darken on hover (Task 11)', () => {
    expect(decl(["[data-variant='ghost'].text-muted-foreground", ':hover'], 'color')).toContain(
      'var(--text-main)',
    );
    expect(decl(['.board-card-actions', 'button:not('], 'color')).toContain('var(--vd-icon)');
    expect(decl(['.board-card-actions', 'button:not(', ':hover'], 'color')).toContain(
      'var(--text-main)',
    );
  });
});
