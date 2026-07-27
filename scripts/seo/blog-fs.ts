/** Build-time post loader — the Node counterpart of blog.client.ts. */
import { readdirSync, readFileSync } from 'node:fs';
import { parsePost, type BlogPost } from '../../apps/crm/src/content/blog.schema';
import { sortPosts } from '../../apps/crm/src/content/blog';

const DIR = 'apps/crm/src/content/blog';

export function loadPostsFromDisk(): BlogPost[] {
  let entries: string[];
  try {
    entries = readdirSync(DIR);
  } catch (err) {
    throw new Error(
      `blog-fs: cannot read post directory "${DIR}" (${(err as Error).message}) — without it the build would silently ship a blog index and sitemap with zero posts`,
    );
  }
  const files = entries.filter((f) => f.endsWith('.md'));
  return sortPosts(
    files.map((f) => parsePost(readFileSync(`${DIR}/${f}`, 'utf8'), f.replace(/\.md$/, ''))),
  );
}
