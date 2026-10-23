/** Frontmatter contract for blog posts. Pure — no I/O, no Vite APIs: this
 * module is shared by the client loader and the prerender script, so it uses
 * relative imports only. */
import { z } from 'zod';
import {
  BLOG_CATEGORIES,
  BLOG_LIMITS,
  BLOG_LIVE_STATUSES,
  blogImageSchema,
  blogSourceSchema,
  isoDate,
  type BlogImage,
  type BlogSource,
} from '../../../../packages/ui/blog/model';
import { BLOG_FEATURE_SLUGS, type FeatureSlug } from './blog.features';

export {
  BLOG_CATEGORIES,
  BLOG_LIMITS,
  BLOG_LIVE_STATUSES,
  BLOG_STATUSES,
  blogImageSchema,
  blogSourceSchema,
  extractInfograficos,
  infograficoSchema,
  validateInfograficos,
  type BlogCategory,
  type BlogImage,
  type BlogSource,
  type BlogStatus,
  type ExtractedInfografico,
  type Infografico,
} from '../../../../packages/ui/blog/model';

/** Ranges mirror the SERP limits enforced for static routes in site-meta.ts.
 * Strict on purpose: zod drops unknown keys silently, so a typo like `udpated`
 * would be discarded, `updated` would fall back to `date`, and a revised
 * article would ship a stale dateModified in its schema and its sitemap. */
export const blogFrontmatterSchema = z
  .object({
    title: z.string().min(BLOG_LIMITS.title[0]).max(BLOG_LIMITS.title[1]),
    h1: z.string().min(BLOG_LIMITS.h1[0]).max(BLOG_LIMITS.h1[1]),
    description: z.string().min(BLOG_LIMITS.description[0]).max(BLOG_LIMITS.description[1]),
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

/** One shape for both origins: file posts (`blog/*.md`, hand-written) and DB
 * posts (`blog-db/*.json`, written by scripts/seo/blog-sync.ts). The optional
 * fields only DB posts carry today. */
export interface BlogPost extends BlogFrontmatter {
  slug: string;
  updated: string;
  /** null = a DB post whose body is loaded lazily (client bundle). */
  body: string | null;
  readingMinutes: number;
  author?: 'equipe';
  lede?: string;
  cover?: Omit<BlogImage, 'key'> | null;
  images?: BlogImage[];
  sources?: BlogSource[];
  featureSlug?: FeatureSlug | null;
  revision?: number;
}

/** A synced DB post's metadata (`blog-db/<slug>.json`). Strict for the same
 * reason as the frontmatter: a misspelt key must fail the build, not vanish.
 * `readingMinutes` is computed by blog-sync from the body, so a post whose
 * body loads lazily still shows its reading time. */
export const dbPostSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
    status: z.enum(BLOG_LIVE_STATUSES),
    category: z.enum(BLOG_CATEGORIES),
    title: z.string().min(BLOG_LIMITS.title[0]).max(BLOG_LIMITS.title[1]),
    h1: z.string().min(BLOG_LIMITS.h1[0]).max(BLOG_LIMITS.h1[1]),
    description: z.string().min(BLOG_LIMITS.description[0]).max(BLOG_LIMITS.description[1]),
    lede: z.string().min(1).max(300),
    date: isoDate,
    updated: isoDate.optional(),
    author: z.literal('equipe'),
    cover: blogImageSchema.omit({ key: true }).nullable(),
    images: z.array(blogImageSchema),
    sources: z.array(blogSourceSchema).min(1),
    featureSlug: z.enum(BLOG_FEATURE_SLUGS).nullable(),
    revision: z.number().int().min(1),
    readingMinutes: z.number().int().min(1),
  })
  .strict()
  .refine((post) => !post.updated || post.updated >= post.date, {
    path: ['updated'],
    message: 'must not be earlier than date',
  });

export type DbPost = z.infer<typeof dbPostSchema>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** `meta` is a `blog-db/<slug>.json` as read from disk; `body` is its
 * Markdown, or null when the caller loads it lazily. */
export function parseDbPost(meta: unknown, body: string | null): BlogPost {
  const slugHint =
    meta && typeof meta === 'object' && typeof (meta as { slug?: unknown }).slug === 'string'
      ? (meta as { slug: string }).slug
      : '(desconhecido)';
  const parsed = dbPostSchema.safeParse(meta);
  if (!parsed.success) throw new Error(`blog-db/${slugHint}: ${formatIssues(parsed.error)}`);
  const { status: _status, ...post } = parsed.data;
  return { ...post, updated: post.updated ?? post.date, body };
}

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
  if (!parsed.success) throw new Error(`blog/${slug}.md: ${formatIssues(parsed.error)}`);
  return {
    ...parsed.data,
    slug,
    updated: parsed.data.updated ?? parsed.data.date,
    body,
    readingMinutes: readingMinutes(body),
  };
}
