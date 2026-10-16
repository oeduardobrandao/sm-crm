import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { describe, it, expect } from 'vitest';

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

const { root, decl, hasAll } = loadFamily('chat');

describe('chat.css', () => {
  it('bubbles', () => {
    expect(decl('.vidro-bubble', 'border-radius')).toContain('18px');
    expect(decl('.vidro-bubble', 'padding')).toContain('9px 13px');
    expect(decl('.vidro-bubble', 'font-size')).toContain('13px');
    expect(decl('.vidro-bubble', 'line-height')).toContain('1.4');
    expect(decl('.vidro-bubble--me', 'background').join()).toContain('var(--vd-sel)');
    expect(decl('.vidro-bubble--me', 'color').join()).toContain('var(--vd-sel-fg)');
    expect(decl('.vidro-bubble--me', 'border-bottom-right-radius')).toContain('6px');
    expect(decl('.vidro-bubble--them', 'background').join()).toContain('var(--vd-fill)');
    expect(decl('.vidro-bubble--them', 'color').join()).toContain('var(--text-main)');
    expect(decl('.vidro-bubble--them', 'border-bottom-left-radius')).toContain('6px');
  });

  it('approval bubbles take the me/them looks and keep their margins', () => {
    expect(decl('.approval-bubble--team', 'background').join()).toContain('var(--vd-sel)');
    expect(decl('.approval-bubble--team', 'color').join()).toContain('var(--vd-sel-fg)');
    expect(decl('.approval-bubble--client', 'background').join()).toContain('var(--vd-fill)');
    expect(decl('.approval-bubble--client', 'color').join()).toContain('var(--text-main)');
    expect(decl('.approval-bubble--team', 'border')).toContain('0');
    expect(decl('.approval-bubble--client', 'border')).toContain('0');
    expect(decl('.approval-bubble--team', 'border-radius')).toContain('18px');
    expect(decl('.approval-bubble--client', 'border-radius')).toContain('18px');
    expect(decl('.approval-bubble--team', 'margin-left')).toEqual([]);
    expect(decl('.approval-bubble--client', 'margin-right')).toEqual([]);
  });

  it('keeps nested text legible on the ink own bubble', () => {
    expect(decl(['.vidro-bubble--me', '.vidro-bubble__meta'], 'color')).toContain(
      'rgba(255, 255, 255, 0.72)',
    );
    expect(decl(['.vidro-bubble--me', ' a'], 'color')).toContain('var(--text-main)');
  });

  it('puts the shared approval rule before the me/them tails', () => {
    const order: string[] = [];
    root.walkRules((r) => {
      if (r.selector.includes(':is(.approval-bubble--team')) order.push('shared');
      else if (r.selector.includes('.vidro-bubble--me,')) order.push('me');
      else if (r.selector.includes('.vidro-bubble--them,')) order.push('them');
    });
    expect(order).toEqual(['shared', 'me', 'them']);
  });

  it('is scoped to the panel body', () => {
    expect(hasAll(['body:has(.app-container) .vidro-panel', '.vidro-bubble'])).toBe(true);
  });
});
