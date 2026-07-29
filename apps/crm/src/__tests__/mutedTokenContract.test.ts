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

// `text-muted` NOT followed by `-foreground`, and not preceded by `--` (which
// would be the unrelated, legitimate `var(--text-muted)` CSS variable).
const BAD_CLASS = /(?<!-)\btext-muted\b(?!-)/;

describe('muted token contract', () => {
  it('never uses the Tailwind class `text-muted` (a near-invisible surface token)', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SOURCE_ROOT)) {
      // This file necessarily spells the banned class out, in the doc comment
      // and in the matcher itself; it would otherwise be its own only offender.
      if (file.endsWith('mutedTokenContract.test.ts')) continue;
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, i) => {
        // Only class strings matter. `var(--text-muted)` is the legitimate
        // design-system variable and is explicitly allowed.
        const withoutCssVar = line.replace(/var\(--text-muted\)/g, '');
        if (BAD_CLASS.test(withoutCssVar)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      `Use "text-muted-foreground" instead. "text-muted" resolves to --muted ` +
        `(a near-white background token) and renders at ~1.1:1 contrast.\n\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
