import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `text-muted` is ALWAYS a bug, and a silent one.
 *
 * tailwind.config.js maps `muted.DEFAULT` to `hsl(var(--muted))`, and in
 * apps/crm/style.css `--muted` is `240 4.8% 95.9%` — a near-white SURFACE token
 * meant for backgrounds (`bg-muted`). Used as a text color it paints
 * rgb(244,244,245) on a white card: a measured contrast ratio of 1.10:1, below
 * even the 3:1 large-text floor, so the text is effectively invisible.
 *
 * The readable token is `--muted-foreground` (rgb(113,113,122), 4.83:1), i.e.
 * the class `text-muted-foreground`.
 *
 * The trap is that the mistake looks right: this design system ALSO has a
 * CSS variable named `--text-muted` (DESIGN_SYSTEM.md, `#374151`) which IS a
 * readable text color and is used correctly as `style={{ color:
 * 'var(--text-muted)' }}` in ~330 places. Two differently-scoped tokens with
 * near-identical names; `className="text-muted"` reads like the readable one
 * and resolves to the invisible one.
 *
 * This shipped to production on the import wizard (26 strings) and sat unnoticed
 * on the error boundary and both paywall screens, because those are screens
 * nobody looks at twice.
 */
const SOURCE_ROOT = 'apps/crm/src';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// `text-muted` NOT followed by `-foreground`, and not preceded by `-` (which
// would be the unrelated, legitimate `var(--text-muted)` CSS variable).
const BAD_CLASS = /(?<!-)\btext-muted\b(?!-)/;

/**
 * Only `className` / `class` VALUES are scanned, never whole lines.
 *
 * Scanning lines would fail on any comment, doc string, or unrelated literal
 * that merely names the class — including this file's own header, which is why
 * an earlier draft had to exclude itself. A guard that trips on prose about the
 * rule is a guard that gets deleted the first time it blocks someone.
 *
 * Returns each value region with the offset it started at, so an offender can
 * still be reported as file:line.
 */
/**
 * Blanks comment bodies, preserving length so byte offsets still map to lines.
 *
 * Needed because comments legitimately contain example markup: this file's own
 * header explains the rule by quoting `className="text-muted"`, and without
 * this the guard reports its own documentation as the violation.
 *
 * A regex cannot do this safely (`'https://x'` contains `//`), so this walks
 * the source tracking string, template and comment state.
 */
function blankComments(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Keep newlines so line numbering downstream stays correct.
      for (; i < stop; i += 1) if (source[i] !== '\n') out[i] = ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function classValueRegions(source: string): Array<{ text: string; index: number }> {
  const regions: Array<{ text: string; index: number }> = [];
  const attr = /\bclass(?:Name)?\s*=\s*/g;
  let m: RegExpExecArray | null;

  while ((m = attr.exec(source)) !== null) {
    let i = m.index + m[0].length;
    const opener = source[i];

    if (opener === '"' || opener === "'") {
      const end = source.indexOf(opener, i + 1);
      if (end === -1) continue;
      regions.push({ text: source.slice(i + 1, end), index: i + 1 });
      attr.lastIndex = end;
    } else if (opener === '{') {
      // Balanced-brace scan: className={cond ? 'a' : 'b'} and template literals
      // both nest braces, so a naive indexOf('}') would truncate the value and
      // silently stop checking the rest of it.
      let depth = 0;
      const start = i;
      for (; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      regions.push({ text: source.slice(start + 1, i), index: start + 1 });
      attr.lastIndex = i;
    }
  }
  return regions;
}

const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;

describe('muted token contract', () => {
  it('never uses the Tailwind class `text-muted` (a near-invisible surface token)', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SOURCE_ROOT)) {
      const source = blankComments(readFileSync(file, 'utf8'));
      for (const region of classValueRegions(source)) {
        // `var(--text-muted)` is the legitimate design-system variable and is
        // explicitly allowed; it can legally appear inside a style-ish value.
        if (!BAD_CLASS.test(region.text.replace(/var\(--text-muted\)/g, ''))) continue;
        const line = lineOf(source, region.index);
        offenders.push(`${file}:${line}: ${region.text.trim().replace(/\s+/g, ' ')}`);
      }
    }

    expect(
      offenders,
      `Use "text-muted-foreground" instead. "text-muted" resolves to --muted ` +
        `(a near-white background token) and renders at ~1.1:1 contrast.\n\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
