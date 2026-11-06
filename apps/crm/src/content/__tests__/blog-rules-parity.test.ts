/** The edge functions can't import the CRM's blog model (Deno, `npm:zod@3`),
 * so `_shared/blog-rules.ts` and `_shared/blog-file-posts.ts` carry copies.
 * Read them as text and hold every copied constant to the CRM source. */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { BLOG_CATEGORIES, BLOG_LIMITS, BLOG_STATUSES, splitFrontmatter } from '../blog.schema';
import { BLOG_FEATURE_SLUGS } from '../blog.features';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const SHARED = resolve(ROOT, 'supabase/functions/_shared');
const BLOG_DIR = resolve(ROOT, 'apps/crm/src/content/blog');

/** Pulls the literal of `export const NAME = <literal>` (up to `as const`
 * or the closing `;`) and evaluates it. The mirror files keep these literals
 * JSON-like on purpose so this stays a text read, not a Deno import. */
function literal(source: string, name: string): unknown {
  const match = new RegExp(
    `export const ${name}(?::[^=]+)?\\s*=\\s*([\\s\\S]*?)(?:\\s+as const)?;`,
  ).exec(source);
  if (!match) throw new Error(`${name} not found`);
  return new Function(`return (${match[1]});`)();
}

describe('Deno blog-rules mirror', () => {
  const rules = readFileSync(resolve(SHARED, 'blog-rules.ts'), 'utf8');

  test('categories match', () => {
    expect(literal(rules, 'BLOG_CATEGORIES')).toEqual([...BLOG_CATEGORIES]);
  });

  test('limits match', () => {
    expect(literal(rules, 'BLOG_LIMITS')).toEqual(BLOG_LIMITS);
  });

  test('feature slugs match', () => {
    expect(literal(rules, 'BLOG_FEATURE_SLUGS')).toEqual([...BLOG_FEATURE_SLUGS]);
  });

  test('statuses match', () => {
    expect(literal(rules, 'BLOG_STATUSES')).toEqual([...BLOG_STATUSES]);
  });
});

/** Comments, whitespace and quote style are formatting, not behaviour; the
 * zod import differs by runtime on purpose. What remains must be identical.
 * Only block comments and whole-line `//` comments are stripped (a trailing
 * `//` could be inside a regex literal such as `/^https?:\/\//`). */
function normalize(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^import \{ z \} from .*$/m, '')
    .replace(/"/g, "'")
    .replace(/\s+/g, '');
}

/** From the first declaration both files share down to the end. */
function schemaSection(source: string): string {
  const start = source.search(/^const DATE\b/m);
  if (start === -1) throw new Error('const DATE not found');
  return normalize(source.slice(start));
}

describe('Deno blog-rules schemas and validator', () => {
  test('match packages/ui/blog/model.ts token for token', () => {
    const model = readFileSync(resolve(ROOT, 'packages/ui/blog/model.ts'), 'utf8');
    const mirror = readFileSync(resolve(SHARED, 'blog-rules.ts'), 'utf8');
    expect(schemaSection(mirror)).toBe(schemaSection(model));
  });

  test('the normalizer keeps a one-character drift visible', () => {
    const a = 'const DATE = 1;\n// nota\nconst x = z.string().max(90);\n';
    const b = 'const DATE = 1;\n/** doc */\nconst x = z.string().max(91);\n';
    expect(schemaSection(a)).not.toBe(schemaSection(b));
    expect(schemaSection(a)).toBe(schemaSection(b.replace('91', '90')));
  });
});

describe('Deno blog-file-posts mirror', () => {
  const source = readFileSync(resolve(SHARED, 'blog-file-posts.ts'), 'utf8');
  const mirrored = literal(source, 'BLOG_FILE_POSTS') as Array<{
    slug: string;
    title: string;
    description: string;
    category: string;
    date: string;
  }>;
  const files = readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  test('lists exactly the file posts', () => {
    expect(mirrored.map((p) => p.slug).sort()).toEqual(files.map((f) => f.replace(/\.md$/, '')));
  });

  test('carries each file post title from its frontmatter', () => {
    for (const post of mirrored) {
      const { data } = splitFrontmatter(readFileSync(resolve(BLOG_DIR, `${post.slug}.md`), 'utf8'));
      expect(post.title, post.slug).toBe(data.title);
    }
  });

  test('carries each file post date, category and description from its frontmatter', () => {
    for (const post of mirrored) {
      const { data } = splitFrontmatter(readFileSync(resolve(BLOG_DIR, `${post.slug}.md`), 'utf8'));
      expect(post.date, post.slug).toBe(String(data.date));
      expect(post.category, post.slug).toBe(data.category);
      expect(post.description, post.slug).toBe(data.description);
    }
  });
});
