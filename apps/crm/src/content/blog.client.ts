/** Client-side post loader. Vite-only (`import.meta.glob`) — the prerender
 * script uses scripts/seo/blog-fs.ts instead and must never import this file.
 * Imported only by the lazily loaded blog pages, so post bodies stay out of
 * the main bundle. */
import { parsePost, type BlogPost } from './blog.schema';
import { sortPosts } from './blog';

const files = import.meta.glob('./blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const BLOG_POSTS: BlogPost[] = sortPosts(
  Object.entries(files).map(([path, raw]) =>
    parsePost(raw, path.replace(/^\.\/blog\//, '').replace(/\.md$/, '')),
  ),
);

export function postBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
