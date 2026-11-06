import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadPostsFromDisk } from '../blog-fs';
import { DB_POST_BODY, DB_POST_META } from '../../../apps/crm/src/content/__tests__/blogDbFixture';

const slug = DB_POST_META.slug;
const dbDir = () => mkdtempSync(join(tmpdir(), 'blogfs-'));

describe('loadPostsFromDisk', () => {
  test('loads a synced database post with its body', () => {
    const dir = dbDir();
    writeFileSync(join(dir, `${slug}.json`), JSON.stringify(DB_POST_META));
    writeFileSync(join(dir, `${slug}.body.md`), DB_POST_BODY);
    const post = loadPostsFromDisk(dir).find((p) => p.slug === slug);
    expect(post?.body).toBe(DB_POST_BODY);
  });

  test('a missing body file throws naming it, instead of prerendering an empty article', () => {
    const dir = dbDir();
    writeFileSync(join(dir, `${slug}.json`), JSON.stringify(DB_POST_META));
    expect(() => loadPostsFromDisk(dir)).toThrow(`${dir}/${slug}.body.md`);
  });

  test('unparseable JSON throws naming the file', () => {
    const dir = dbDir();
    writeFileSync(join(dir, `${slug}.json`), '{not json');
    writeFileSync(join(dir, `${slug}.body.md`), DB_POST_BODY);
    expect(() => loadPostsFromDisk(dir)).toThrow(`${dir}/${slug}.json`);
  });
});
