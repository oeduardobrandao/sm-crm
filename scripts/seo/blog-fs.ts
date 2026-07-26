/** Build-time post loader — the Node counterpart of blog.client.ts. */
import { readdirSync, readFileSync } from 'node:fs';
import { parsePost, type BlogPost } from '../../apps/crm/src/content/blog.schema';
import { sortPosts } from '../../apps/crm/src/content/blog';

const DIR = 'apps/crm/src/content/blog';

export function loadPostsFromDisk(): BlogPost[] {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
  return sortPosts(
    files.map((f) => parsePost(readFileSync(`${DIR}/${f}`, 'utf8'), f.replace(/\.md$/, ''))),
  );
}
