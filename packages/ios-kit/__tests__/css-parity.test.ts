import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { readCrmCss } from '../../../apps/crm/src/test/readCrmCss';

const ROOT = path.resolve(__dirname, '../../..');
const kit = readFileSync(path.join(ROOT, 'packages/ios-kit/ios-kit.css'), 'utf8');
// The CRM kit sections are split rule by rule between apps/crm/style.css (rules the public
// pages' dialogs use) and apps/crm/app.css (the rest), so parity is checked per rule.
const crm = readCrmCss();

/** Splits at section header comments: a line starting with `/* ====` or `/* ----`. */
function sections(css: string): string[] {
  const lines = css.split('\n');
  const out: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\/\* (====|----)/.test(line) && current.length) {
      out.push(current.join('\n').trimEnd());
      current = [];
    }
    current.push(line);
  }
  if (current.length) out.push(current.join('\n').trimEnd());
  return (
    out
      // The file's own banner is not a copy.
      .filter((s) => !s.startsWith('/* ==== @ios-kit banner'))
      // An excerpt (rules lifted from inside a larger CRM section) carries its own header
      // line, which is not in the CRM file: compare only the rules under it.
      .map((s) =>
        s.startsWith('/* ---- @ios-kit excerpt') ? s.split('\n').slice(1).join('\n') : s,
      )
  );
}

/** Every rule, keyframes block and comment of a section, verbatim, descending into
 * @media/@supports (whose children may sit in different CRM files). */
function pieces(section: string): string[] {
  const out: string[] = [];
  const walk = (container: postcss.Container, wrapper: string | null) => {
    for (const node of container.nodes ?? []) {
      if (node.type === 'atrule' && ['media', 'supports'].includes(node.name)) {
        walk(node, `@${node.name} ${node.params} {`);
        continue;
      }
      out.push(node.toString());
      if (wrapper) out.push(wrapper);
    }
  };
  walk(postcss.parse(section), null);
  return out;
}

describe('ios-kit.css is a verbatim copy of the CRM kit sections', () => {
  const list = sections(kit);
  it('has sections', () => {
    expect(list.length).toBeGreaterThan(10);
  });
  it.each(list.map((s) => [s.split('\n')[0], s]))('%s', (_header, section) => {
    const all = pieces(section as string);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((piece) => !crm.includes(piece))).toEqual([]);
  });
});
