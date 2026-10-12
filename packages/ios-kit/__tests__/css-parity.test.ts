import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const kit = readFileSync(path.join(ROOT, 'packages/ios-kit/ios-kit.css'), 'utf8');
const crm = readFileSync(path.join(ROOT, 'apps/crm/style.css'), 'utf8');

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

describe('ios-kit.css is a verbatim copy of the CRM kit sections', () => {
  const list = sections(kit);
  it('has sections', () => {
    expect(list.length).toBeGreaterThan(10);
  });
  it.each(list.map((s) => [s.split('\n')[0], s]))('%s', (_header, section) => {
    expect(crm.includes(section as string)).toBe(true);
  });
});
