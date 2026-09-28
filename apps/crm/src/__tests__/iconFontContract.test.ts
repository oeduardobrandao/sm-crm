import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Font Awesome is not loaded anywhere in the CRM: no <link> in index.html, no
 * npm dependency, no @import in style.css. A `fa-brands fa-instagram` class
 * therefore renders as an empty box of whatever size its inline style asks for
 * (a 3rem blank gap above "Conectar Instagram" shipped that way). The icon font
 * the CRM does load is Phosphor (`<i class="ph ph-...">`, apps/crm/index.html);
 * React components use lucide-react.
 *
 * Phosphor also ships no spin helper, so `ph-spin` only animates because
 * apps/crm/style.css defines it.
 */
const SOURCE_ROOT = 'apps/crm/src';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const FONT_AWESOME_CLASS = /\bfa-(brands|solid|regular|light|thin|duotone|spin)\b/;

describe('icon font contract', () => {
  it('never uses Font Awesome classes (the font is not loaded)', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SOURCE_ROOT)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (FONT_AWESOME_CLASS.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }

    expect(
      offenders,
      `Use a Phosphor icon (<i class="ph ph-...">) or lucide-react instead.\n\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('defines the ph-spin animation that Phosphor spinners rely on', () => {
    const css = readFileSync('apps/crm/style.css', 'utf8');

    expect(css).toMatch(/@keyframes ph-spin\b/);
    expect(css).toMatch(/\.ph-spin\s*\{[^}]*animation:\s*ph-spin\b/);
    expect(css).toMatch(/\.ph-spin\s*\{[^}]*display:\s*inline-block/);
  });
});
