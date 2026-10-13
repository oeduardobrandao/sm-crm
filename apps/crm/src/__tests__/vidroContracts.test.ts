import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync('apps/crm/src/styles/vidro.css', 'utf8');
const root = postcss.parse(css);
const main = readFileSync('apps/crm/src/main.tsx', 'utf8');

function enclosingMedia(rule: Rule): string[] {
  const params: string[] = [];
  let p = rule.parent;
  while (p) {
    if (p.type === 'atrule' && (p as AtRule).name === 'media') params.push((p as AtRule).params);
    p = p.parent;
  }
  return params;
}

describe('vidro.css contracts', () => {
  it('has no @layer and no !important', () => {
    root.walkAtRules('layer', () => {
      throw new Error('@layer is not allowed in vidro.css');
    });
    root.walkDecls((d) => expect(d.important, `${d.prop} in ${d.parent}`).toBeFalsy());
  });

  it('keeps every rule in the 1101px block, except the scoped Analytics de Fluxos print block', () => {
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'keyframes') return;
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
      if (rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'keyframes') return;
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

  it('resets the Vidro panel for the Analytics de Fluxos print', () => {
    let found = false;
    root.walkRules((rule) => {
      if (!enclosingMedia(rule).some((m) => m.trim() === 'print')) return;
      if (!rule.selectors.some((s) => s.trim().endsWith('.vidro-panel'))) return;
      rule.walkDecls('position', (d) => {
        if (d.value === 'static') found = true;
      });
    });
    expect(found).toBe(true);
  });

  it('touches the print .app-container only when a Vidro panel is mounted', () => {
    root.walkRules((rule) => {
      if (!enclosingMedia(rule).some((m) => m.trim() === 'print')) return;
      for (const s of rule.selectors) {
        if (/\.app-container(\s*$|:(?!has\(\.vidro-panel\)))/.test(s.trim())) {
          throw new Error(`print .app-container rule without :has(.vidro-panel): ${s}`);
        }
      }
    });
  });

  it('gives the nested card rule the same :not() chain as the group rule, or the group rule wins', () => {
    const chain = ':not(.card-blue):not(.card-yellow):not(.card-teal):not(.card-dark)';
    const selectors: string[] = [];
    root.walkRules((rule) => {
      for (const s of rule.selectors) selectors.push(s.replace(/\s+/g, ' ').trim());
    });
    expect(selectors).toContain(`html[data-look='vidro'] .app-container .card${chain}`);
    expect(selectors).toContain(`html[data-look='vidro'] .app-container .card .card${chain}`);
  });

  it('is imported once, right after style.css', () => {
    expect(main).toMatch(/import '\.\.\/style\.css';\s*\nimport '\.\/styles\/vidro\.css';/);
  });
});
