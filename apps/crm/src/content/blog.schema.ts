/** Frontmatter contract for blog posts. Pure — no I/O, no Vite APIs: this
 * module is shared by the client loader and the prerender script, so it uses
 * relative imports only. */
import { z } from 'zod';

export const BLOG_CATEGORIES = ['comparativo', 'guia'] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The shape check alone lets `2026-02-30` and `2026-13-01` through, and
 * JavaScript then rolls them over in silence: the page would print "02 de
 * março" while the sitemap kept an impossible `lastmod`. Round-tripping the
 * parts through Date is what catches a typo the author would never see. */
function isRealCalendarDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
  );
}

const isoDate = z
  .string()
  .regex(DATE, 'must be YYYY-MM-DD')
  .refine(isRealCalendarDate, 'must be a real calendar date');

/** Ranges mirror the SERP limits enforced for static routes in site-meta.ts.
 * Strict on purpose: zod drops unknown keys silently, so a typo like `udpated`
 * would be discarded, `updated` would fall back to `date`, and a revised
 * article would ship a stale dateModified in its schema and its sitemap. */
export const blogFrontmatterSchema = z
  .object({
    title: z.string().min(50).max(60),
    h1: z.string().min(10).max(120),
    description: z.string().min(120).max(160),
    date: isoDate,
    updated: isoDate.optional(),
    category: z.enum(BLOG_CATEGORIES),
  })
  .strict()
  .refine((fm) => !fm.updated || fm.updated >= fm.date, {
    path: ['updated'],
    message: 'must not be earlier than date',
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
