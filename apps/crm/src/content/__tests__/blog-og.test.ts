import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseDbPost, parsePost } from '../blog.schema';
import { blogPostRouteMeta, postOgImage } from '../blog';
import { DEFAULT_OG_IMAGE } from '../site-meta';
import { DB_POST_BODY, DB_POST_META } from './blogDbFixture';

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

  test('a file post points at its committed OG image', () => {
    for (const post of posts) {
      expect(postOgImage(post)).toBe(`https://www.mesaas.com.br/og/blog/${post.slug}.png`);
      expect(blogPostRouteMeta(post).ogImage).toBe(postOgImage(post));
    }
  });

  test('a DB post uses its cover photo', () => {
    const post = parseDbPost(DB_POST_META, DB_POST_BODY);
    expect(postOgImage(post)).toBe(DB_POST_META.cover.url);
  });

  test('a DB post without a cover falls back to the site-wide image', () => {
    const post = parseDbPost({ ...DB_POST_META, cover: null }, DB_POST_BODY);
    expect(postOgImage(post)).toBe(DEFAULT_OG_IMAGE);
  });
});
