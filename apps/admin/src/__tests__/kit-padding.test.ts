import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

/**
 * ios-kit.css is unlayered and loads after Tailwind, so its `padding: 0` on these kit classes
 * beats any Tailwind padding utility on the same element (the sweep found five rows with no
 * padding at all). jsdom never loads the kit CSS, so a computed-style test proves nothing:
 * this gate reads the source instead. Put the padding on an inner element, or use the kit's
 * own `.phone-cell__body`.
 */
const KIT_CLASSES = /\b(phone-group__list|phone-cell__main|phone-cell__body)\b/;
const PADDING = /(^|[\s'"`])-?p[xylrtbse]?-(\d|\[|px\b)/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...tsxFiles(p));
    } else if (name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

/** Every className string literal (quoted or template) in the file. */
function classStrings(source: string): string[] {
  const out: string[] = [];
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;
  for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

describe('kit padding gate', () => {
  it('no element pairs a padding-zeroing kit class with a Tailwind padding utility', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      for (const cls of classStrings(readFileSync(file, 'utf8'))) {
        if (KIT_CLASSES.test(cls) && PADDING.test(cls)) {
          offenders.push(`${path.relative(SRC, file)}: "${cls}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('catches the pattern it is meant to catch', () => {
    const bad = 'className="phone-group__list flex items-center gap-2 py-1 pl-4 pr-1"';
    const cls = classStrings(bad)[0];
    expect(KIT_CLASSES.test(cls) && PADDING.test(cls)).toBe(true);
    const ok = 'className="phone-group__list focus-within:ring-2"';
    const okCls = classStrings(ok)[0];
    expect(KIT_CLASSES.test(okCls) && PADDING.test(okCls)).toBe(false);
  });
});
