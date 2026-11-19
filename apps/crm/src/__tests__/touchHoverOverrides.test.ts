import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/**
 * Hover-revealed controls of the desktop editors that touch tablets render (report editor,
 * Linha editorial) get a `@media (hover: none)` override that shows them. The override has the
 * same specificity as the base rule, so it only wins when it comes later in the same file:
 * placed before the base rule it is dead CSS and the control stays invisible on touch.
 */
const ROOT = path.resolve(__dirname, '../../../..');

const CASES: Array<{ file: string; selector: string }> = [
  { file: 'apps/crm/app.css', selector: '.rb-edit-toolbar' },
  { file: 'apps/crm/app.css', selector: '.rb-layers-add-between' },
  { file: 'apps/crm/src/pages/entregas/linha/linha.css', selector: '.linha-drag' },
];

const inHoverNone = (rule: postcss.Rule) =>
  rule.parent?.type === 'atrule' &&
  (rule.parent as postcss.AtRule).name === 'media' &&
  (rule.parent as postcss.AtRule).params.replace(/\s+/g, ' ').trim() === '(hover: none)';

const declares = (rule: postcss.Rule, prop: string, value: string) =>
  rule.nodes.some((n) => n.type === 'decl' && n.prop === prop && n.value === value);

describe('touch overrides of hover-revealed editor controls', () => {
  it.each(CASES)(
    '$selector in $file is shown on touch after its base rule',
    ({ file, selector }) => {
      const root = postcss.parse(readFileSync(path.join(ROOT, file), 'utf8'));
      const rules: postcss.Rule[] = [];
      root.walkRules((r) => {
        if (r.selectors.map((s) => s.trim()).includes(selector)) rules.push(r);
      });
      const order = (r: postcss.Rule) => r.source?.start?.offset ?? -1;
      const base = rules.filter((r) => r.parent?.type === 'root' && declares(r, 'opacity', '0'));
      const touch = rules.filter((r) => inHoverNone(r) && declares(r, 'opacity', '1'));
      expect(base, 'base rule hiding the control').toHaveLength(1);
      expect(touch, '(hover: none) override showing it').toHaveLength(1);
      expect(order(touch[0])).toBeGreaterThan(order(base[0]));
      if (declares(base[0], 'pointer-events', 'none')) {
        expect(declares(touch[0], 'pointer-events', 'auto')).toBe(true);
      }
    },
  );
});
