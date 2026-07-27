import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parsePost } from '../blog.schema';

const DIR = 'apps/crm/src/content/blog';
const posts = readdirSync(DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => parsePost(readFileSync(`${DIR}/${f}`, 'utf8'), f.replace(/\.md$/, '')));

describe('blog OG images', () => {
  test('every post has a committed OG image', () => {
    for (const post of posts) {
      expect(
        existsSync(`public/og/blog/${post.slug}.png`),
        `missing OG image for ${post.slug} — run npm run og:image`,
      ).toBe(true);
    }
  });

  test('the site-wide default image still exists', () => {
    expect(existsSync('public/og-image.png')).toBe(true);
  });
});
