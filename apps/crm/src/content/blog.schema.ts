/** Frontmatter contract for blog posts. Pure — no I/O, no Vite APIs: this
 * module is shared by the client loader and the prerender script, so it uses
 * relative imports only. */
import { z } from 'zod';

export const BLOG_CATEGORIES = ['comparativo', 'guia'] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Ranges mirror the SERP limits enforced for static routes in site-meta.ts. */
export const blogFrontmatterSchema = z.object({
  title: z.string().min(50).max(60),
  h1: z.string().min(10).max(120),
  description: z.string().min(120).max(160),
  date: z.string().regex(DATE),
  updated: z.string().regex(DATE).optional(),
  category: z.enum(BLOG_CATEGORIES),
});

export type BlogFrontmatter = z.infer<typeof blogFrontmatterSchema>;

export interface BlogPost extends BlogFrontmatter {
  slug: string;
  updated: string;
  body: string;
  readingMinutes: number;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Minimal `key: value` frontmatter reader — one entry per line, value is
 * everything after the first colon (so titles may contain colons). No YAML
 * dependency: values must not span lines, be quoted, or nest. */
export function splitFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = FRONTMATTER.exec(raw);
  if (!match) throw new Error('missing frontmatter block (--- ... ---) at the top of the file');
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    if (colon === -1) throw new Error(`malformed frontmatter line: ${line}`);
    data[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { data, body: raw.slice(match[0].length).trim() };
}

/** ~200 words per minute, the conventional reading-speed estimate. */
export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.trim().split(/\s+/).length / 200));
}

export function parsePost(raw: string, slug: string): BlogPost {
  let data: Record<string, string>;
  let body: string;
  try {
    ({ data, body } = splitFrontmatter(raw));
  } catch (err) {
    throw new Error(`blog/${slug}.md: ${(err as Error).message}`);
  }
  const parsed = blogFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`blog/${slug}.md: ${issues}`);
  }
  return {
    ...parsed.data,
    slug,
    updated: parsed.data.updated ?? parsed.data.date,
    body,
    readingMinutes: readingMinutes(body),
  };
}
