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

const { decl, hasAll } = loadFamily('tables');

describe('tables.css', () => {
  it('header cells: 11px/600 txt3, no uppercase', () => {
    expect(decl("[data-slot='table-head']", 'font-size')).toContain('11px');
    expect(decl("[data-slot='table-head']", 'text-transform')).toContain('none');
    expect(decl('.data-table th', 'color').join()).toContain('var(--vd-txt3)');
  });
  it('body cells: 46px rows with --vd-sep separators', () => {
    expect(decl("[data-slot='table-cell']", 'height')).toContain('46px');
    expect(decl("[data-slot='table-cell']", 'border-bottom').join()).toContain('var(--vd-sep)');
  });
  it('row hover, selected and last-row states', () => {
    expect(hasAll(["[data-slot='table-row']", ':hover'])).toBe(true);
    expect(hasAll(["[data-slot='table-row']", "[data-state='selected']"])).toBe(true);
    expect(hasAll(['tr:last-child', '> td'])).toBe(true);
    expect(decl(['tr:last-child', '> td'], 'border-bottom')).toContain('0');
  });
  it('pairs the shadcn Table with the legacy .data-table', () => {
    expect(hasAll(["[data-slot='table']", '.data-table'])).toBe(true);
    expect(hasAll(["[data-slot='table'] th", '.data-table th'])).toBe(true);
    expect(hasAll(["[data-slot='table'] td", '.data-table td'])).toBe(true);
  });
  it('tables use separate borders so the rounded hover pill renders', () => {
    const collapse = decl("[data-slot='table']", 'border-collapse');
    expect(collapse).toContain('separate');
    expect(collapse).not.toContain('collapse');
    expect(decl("[data-slot='table']", 'border-spacing')).toContain('0');
    expect(decl('td:first-child', 'border-radius')).toContain('10px 0 0 10px');
    expect(decl('td:last-child', 'border-radius')).toContain('0 10px 10px 0');
  });
  it('cell padding breathes vertically and checkbox columns keep padding-right 0', () => {
    expect(decl("[data-slot='table-cell']", 'padding')).toContain('8px 12px');
    expect(decl("[role='checkbox']", 'padding-right')).toContain('0');
  });
  it('list rows', () => {
    for (const c of [
      '.today-row',
      '.fila-row',
      '.config-member-row',
      '.concluded-wf-row',
      '.rb-layers-row',
    ]) {
      expect(hasAll(c), c).toBe(true);
      expect(hasAll([c, ':hover']), `${c} :hover`).toBe(true);
    }
  });
  it('list rows use sep borders, 12px radius, fill hover; fila-row.is-top keeps its inset rail', () => {
    expect(decl('.today-row', 'border-radius')).toContain('12px');
    expect(decl('.today-row', 'border-color').join()).toContain('var(--vd-sep)');
    expect(decl(['.today-row', ':hover'], 'background').join()).toContain('var(--vd-fill)');
    expect(decl('.fila-row', 'box-shadow')).toEqual([]);
  });
  it('hides the separator under the hover pill and rings the focusable today-row', () => {
    expect(
      decl(["tr:is(:hover, [data-state='selected'])", '> td'], 'border-bottom-color'),
    ).toContain('transparent');
    expect(decl(['.today-row', ':focus-visible'], 'box-shadow')).toContain(
      '0 0 0 3px rgba(255, 191, 48, 0.55)',
    );
  });
});
