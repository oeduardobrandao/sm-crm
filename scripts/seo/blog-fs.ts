/** Build-time post loader — the Node counterpart of blog.client.ts. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseDbPost, parsePost, type BlogPost } from '../../apps/crm/src/content/blog.schema';
import { sortPosts } from '../../apps/crm/src/content/blog';

const DIR = 'apps/crm/src/content/blog';
export const DB_DIR = 'apps/crm/src/content/blog-db';

export function loadPostsFromDisk(dbDir: string = DB_DIR): BlogPost[] {
  let entries: string[];
  try {
    entries = readdirSync(DIR);
  } catch (err) {
    throw new Error(
      `blog-fs: cannot read post directory "${DIR}" (${(err as Error).message}) — without it the build would silently ship a blog index and sitemap with zero posts`,
    );
  }
  const files = entries.filter((f) => f.endsWith('.md'));
  const filePosts = files.map((f) =>
    parsePost(readFileSync(`${DIR}/${f}`, 'utf8'), f.replace(/\.md$/, '')),
  );
  // blog-sync owns this directory; it is absent when the sync step never ran.
  const dbPosts = existsSync(dbDir)
    ? readdirSync(dbDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const slug = f.replace(/\.json$/, '');
          const metaPath = `${dbDir}/${f}`;
          let meta: unknown;
          try {
            meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          } catch (err) {
            throw new Error(`blog-fs: ${metaPath} is not valid JSON (${(err as Error).message})`, {
              cause: err,
            });
          }
          // blog-sync writes both files; prerendering an empty article would ship (and the
          // Admin's live check would then confirm) a post with no body.
          const bodyPath = `${dbDir}/${slug}.body.md`;
          if (!existsSync(bodyPath)) {
            throw new Error(
              `blog-fs: ${bodyPath} is missing (blog-sync writes it next to ${metaPath}); re-run npm run blog:sync`,
            );
          }
          return parseDbPost(meta, readFileSync(bodyPath, 'utf8'));
        })
    : [];
  const seen = new Set<string>();
  for (const p of [...filePosts, ...dbPosts]) {
    if (seen.has(p.slug)) throw new Error(`blog-fs: duplicate post slug "${p.slug}"`);
    seen.add(p.slug);
  }
  return sortPosts([...filePosts, ...dbPosts]);
}
