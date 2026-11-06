/** Client-side post loader. Vite-only (`import.meta.glob`) — the prerender
 * script uses scripts/seo/blog-fs.ts instead and must never import this file.
 * Imported only by the lazily loaded blog pages, so post bodies stay out of
 * the main bundle. File posts carry their body; database posts (synced into
 * `blog-db/` at build time) carry metadata only and load the body on demand
 * through `loadPostBody`. */
import { parseDbPost, parsePost, type BlogPost } from './blog.schema';
import { sortPosts } from './blog';

const files = import.meta.glob('./blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const dbMetas = import.meta.glob('./blog-db/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, unknown>;

const dbBodies = import.meta.glob('./blog-db/*.body.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const filePosts = Object.entries(files).map(([path, raw]) =>
  parsePost(raw, path.replace(/^\.\/blog\//, '').replace(/\.md$/, '')),
);
const dbPosts = Object.values(dbMetas).map((meta) => parseDbPost(meta, null));

const slugs = new Set<string>();
for (const p of [...filePosts, ...dbPosts]) {
  if (slugs.has(p.slug)) throw new Error(`blog: duplicate post slug "${p.slug}"`);
  slugs.add(p.slug);
}

export const BLOG_POSTS: BlogPost[] = sortPosts([...filePosts, ...dbPosts]);

export function postBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/** Body of any post: immediate for file posts, a lazy chunk for database ones. */
export async function loadPostBody(slug: string): Promise<string> {
  const post = postBySlug(slug);
  if (!post) throw new Error(`blog: unknown post "${slug}"`);
  if (post.body !== null) return post.body;
  const load = dbBodies[`./blog-db/${slug}.body.md`];
  if (!load) throw new Error(`blog: missing body for post "${slug}"`);
  return load();
}
