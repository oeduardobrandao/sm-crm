import { readdirSync, readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const BODY_DIR = 'apps/crm/src/styles/vidro-body';
const FILES = [
  'apps/crm/src/styles/vidro.css',
  ...readdirSync(BODY_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => `${BODY_DIR}/${f}`),
];
const parsed = FILES.map((file) => ({ file, root: postcss.parse(readFileSync(file, 'utf8')) }));
const BODY_ORDER = [
  'tokens',
  'buttons',
  'tables',
  'cards',
  'badges',
  'forms',
  'controls',
  'boards',
  'overlays',
  'chat',
  'compositions',
];
const shell = parsed.find((p) => p.file.endsWith('/vidro.css'))!.root;
const main = readFileSync('apps/crm/src/main.tsx', 'utf8');
const CARD_CHAIN = ':not(.card-blue):not(.card-yellow):not(.card-teal):not(.card-dark)';

function enclosingMedia(rule: Rule): string[] {
  const params: string[] = [];
  let p = rule.parent;
  while (p) {
    if (p.type === 'atrule' && (p as AtRule).name === 'media') params.push((p as AtRule).params);
    p = p.parent;
  }
  return params;
}

const inKeyframes = (rule: Rule) =>
  rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'keyframes';

describe.each(parsed)('$file guards', ({ root }) => {
  it('has no @layer and no !important', () => {
    root.walkAtRules('layer', () => {
      throw new Error('@layer is not allowed in vidro stylesheets');
    });
    root.walkDecls((d) => expect(d.important, `${d.prop} in ${d.parent}`).toBeFalsy());
  });

  it('keeps every rule in the 1101px block, except the scoped Analytics de Fluxos print block', () => {
    root.walkRules((rule) => {
      if (inKeyframes(rule)) return;
      const media = enclosingMedia(rule);
      if (media.some((m) => m.trim() === 'print')) {
        for (const s of rule.selectors) expect(s).toContain('body:has(.analytics-fluxos-page)');
        return;
      }
      expect(
        media.some((m) => /min-width:\s*1101px/.test(m)),
        `outside the 1101px block: ${rule.selector}`,
      ).toBe(true);
    });
  });

  it('starts every selector with html carrying [data-look=vidro]', () => {
    root.walkRules((rule) => {
      if (inKeyframes(rule)) return;
      for (const s of rule.selectors) {
        const first = s.trim().split(/\s+/)[0];
        expect(first.startsWith('html'), s).toBe(true);
        expect(first.includes("[data-look='vidro']"), s).toBe(true);
      }
    });
  });

  it('never redefines shared tokens on a bare .app-container', () => {
    root.walkRules((rule) => {
      for (const s of rule.selectors) {
        if (s.trim() === '.app-container') throw new Error('bare .app-container selector');
      }
    });
  });

  it('gives any nested .card .card rule the :not() chain, or the group rule wins', () => {
    root.walkRules((rule) => {
      for (const s of rule.selectors) {
        const flat = s.replace(/\s+/g, ' ');
        if (/\.card \.card(?![\w-])/.test(flat)) expect(flat, flat).toContain(`.card${CARD_CHAIN}`);
      }
    });
  });
});

describe('vidro.css contracts', () => {
  it('resets the Vidro panel for the Analytics de Fluxos print', () => {
    let found = false;
    shell.walkRules((rule) => {
      if (!enclosingMedia(rule).some((m) => m.trim() === 'print')) return;
      if (!rule.selectors.some((s) => s.trim().endsWith('.vidro-panel'))) return;
      rule.walkDecls('position', (d) => {
        if (d.value === 'static') found = true;
      });
    });
    expect(found).toBe(true);
  });

  it('touches the print .app-container only when a Vidro panel is mounted', () => {
    shell.walkRules((rule) => {
      if (!enclosingMedia(rule).some((m) => m.trim() === 'print')) return;
      for (const s of rule.selectors) {
        if (/\.app-container(\s*$|:(?!has\(\.vidro-panel\)))/.test(s.trim())) {
          throw new Error(`print .app-container rule without :has(.vidro-panel): ${s}`);
        }
      }
    });
  });

  it('gives the nested card rule the same :not() chain as the group rule, or the group rule wins', () => {
    const selectors: string[] = [];
    shell.walkRules((rule) => {
      for (const s of rule.selectors) selectors.push(s.replace(/\s+/g, ' ').trim());
    });
    expect(selectors).toContain(`html[data-look='vidro'] .app-container .card${CARD_CHAIN}`);
    expect(selectors).toContain(`html[data-look='vidro'] .app-container .card .card${CARD_CHAIN}`);
  });

  it('is imported once, right after style.css', () => {
    expect(main).toMatch(/import '\.\.\/style\.css';\s*\nimport '\.\/styles\/vidro\.css';/);
  });

  it('declares the --vd-* tokens on body:has(.app-container), not .app-container', () => {
    let seen = 0;
    shell.walkDecls(/^--vd-/, (d) => {
      seen += 1;
      expect((d.parent as Rule).selector, d.prop).toContain('body:has(.app-container)');
    });
    expect(seen).toBeGreaterThan(0);
  });

  it('keeps the backdrop and --topbar-height on .app-container', () => {
    const decls: string[] = [];
    shell.walkRules((rule) => {
      if (rule.selector.trim() !== "html[data-look='vidro'] .app-container") return;
      rule.walkDecls((d) => {
        decls.push(d.prop);
      });
    });
    expect(decls.sort()).toEqual(['--topbar-height', 'background-color', 'background-image']);
  });

  it('no longer rounds every button into a pill (buttons.css owns button shape)', () => {
    shell.walkRules((rule) => {
      if (!rule.selectors.some((s) => s.includes("[data-slot='button']"))) return;
      rule.walkDecls('border-radius', (d) => {
        throw new Error(`button radius left in vidro.css: ${rule.selector} { ${d} }`);
      });
    });
  });
});

describe('vidro-body files', () => {
  it('has exactly the eleven family files', () => {
    expect(
      readdirSync(BODY_DIR)
        .filter((f) => f.endsWith('.css'))
        .map((f) => f.replace(/\.css$/, ''))
        .sort(),
    ).toEqual([...BODY_ORDER].sort());
  });

  it('imports every vidro-body file after vidro.css, in order', () => {
    const at = (name: string) => main.indexOf(`./styles/vidro-body/${name}.css`);
    expect(main.indexOf('./styles/vidro.css')).toBeGreaterThan(-1);
    let prev = main.indexOf('./styles/vidro.css');
    for (const name of BODY_ORDER) {
      expect(at(name), name).toBeGreaterThan(prev);
      prev = at(name);
    }
  });

  it('tokens.css declares every new and remapped token in light and dark', () => {
    const tokens = parsed.find((p) => p.file.endsWith('/tokens.css'))!.root;
    const light = new Set<string>();
    const dark = new Set<string>();
    tokens.walkRules((r) => {
      expect(r.selector, r.selector).toContain('body:has(.app-container)');
      const bucket = r.selector.includes("[data-theme='dark']") ? dark : light;
      r.walkDecls((d) => {
        if (d.prop.startsWith('--')) bucket.add(d.prop);
      });
    });
    for (const t of [
      '--vd-txt2',
      '--vd-icon',
      '--vd-cta',
      '--vd-cta-fg',
      '--vd-cta-hover',
      '--vd-ok',
      '--vd-warn',
      '--vd-tg-ok',
      '--vd-tg-ok-bg',
      '--vd-tg-bad',
      '--vd-tg-bad-bg',
      '--vd-tg-info',
      '--vd-tg-info-bg',
      '--vd-tg-warn',
      '--vd-tg-warn-bg',
      '--vd-tg-neutral',
      '--vd-tg-neutral-bg',
      '--vd-switch-on',
      '--vd-overlay',
      '--vd-menu',
      '--border-color',
      '--surface-main',
      '--surface-hover',
      '--surface-1',
      '--surface-2',
      '--surface-3',
      '--border',
      '--input',
      '--muted',
      '--accent',
      '--popover',
      '--card',
    ]) {
      expect(light.has(t), `light ${t}`).toBe(true);
      expect(dark.has(t), `dark ${t}`).toBe(true);
    }
  });

  it('tokens.css never remaps the tokens the spec keeps', () => {
    const tokens = parsed.find((p) => p.file.endsWith('/tokens.css'))!.root;
    const kept = [
      '--card-bg',
      '--text-main',
      '--text-muted',
      '--text-light',
      '--background',
      '--foreground',
      '--ring',
      '--primary',
      '--radius',
      '--bg-color',
    ];
    tokens.walkDecls((d) => {
      expect(kept.includes(d.prop), d.prop).toBe(false);
      expect(d.prop.startsWith('--danger'), d.prop).toBe(false);
      expect(d.prop.startsWith('--primary'), d.prop).toBe(false);
    });
  });

  it('declares shadcn HSL tokens as bare channel triplets', () => {
    const tokens = parsed.find((p) => p.file.endsWith('/tokens.css'))!.root;
    tokens.walkDecls(/^--(border|input|muted|accent|popover|card)$/, (d) => {
      expect(d.value, d.prop).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/);
    });
  });
});

const OVERLAY_HOOKS = [
  "[data-slot='dialog-overlay']",
  "[data-slot='dialog-content']",
  "[data-slot='alert-dialog-overlay']",
  "[data-slot='alert-dialog-content']",
  "[data-slot='sheet-overlay']",
  "[data-slot='sheet-content']",
  "[data-slot='popover-content']",
  "[data-slot='dropdown-menu-content']",
  "[data-slot='dropdown-menu-sub-content']",
  "[data-slot='select-content']",
  "[data-slot='command']",
  '[data-sonner-toast]',
];
it.each(parsed)('$file scopes overlay hooks with body:has(.app-container)', ({ root }) => {
  root.walkRules((rule) => {
    for (const s of rule.selectors) {
      if (OVERLAY_HOOKS.some((h) => s.includes(h)))
        expect(s, s).toContain('body:has(.app-container)');
    }
  });
});

const STICKY = [
  '.scheduled-panel',
  '.rb-editor-header',
  '.rb-layers-rail',
  '.callout-emoji-picker',
  '.drawer-selection-bar',
];
it.each(parsed)('$file keeps sticky surfaces opaque', ({ root }) => {
  root.walkRules((rule) => {
    // Whole class tokens only: `.drawer-selection-bar` must not match `.drawer-selection-bar-btn`.
    const hasClass = (c: string) =>
      new RegExp(`${c.replace(/[.-]/g, '\\$&')}(?![\\w-])`).test(rule.selector);
    if (!STICKY.some(hasClass)) return;
    rule.walkDecls(/^background(-color)?$/, (d) => {
      expect(d.value, rule.selector).not.toMatch(/--vd-(tile|fill|group|glass|panel|menu)/);
    });
  });
});
