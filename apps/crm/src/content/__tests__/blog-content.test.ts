import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parsePost } from '../blog.schema';
import { PUBLIC_ROUTES } from '../site-meta';

const DIR = 'apps/crm/src/content/blog';
const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
const posts = files.map((f) =>
  parsePost(readFileSync(`${DIR}/${f}`, 'utf8'), f.replace(/\.md$/, '')),
);

/** Targets the blog pages link to besides other posts. */
const ALLOWED_EXTERNAL_TARGETS = ['/login?tab=register'];

describe('blog content', () => {
  test('there is at least one post', () => {
    expect(posts.length).toBeGreaterThan(0);
  });

  test('slugs are unique and kebab-case', () => {
    const slugs = posts.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test('bodies start their hierarchy at h2 (the page renders the only h1)', () => {
    for (const post of posts) {
      expect(post.body, `${post.slug}: body must not contain an h1`).not.toMatch(/^# /m);
      expect(post.body, `${post.slug}: body needs at least two h2 sections`).toMatch(/^## /m);
    }
  });

  test('internal links point at routes that exist', () => {
    const known = new Set([
      ...PUBLIC_ROUTES.map((r) => r.path),
      ...posts.map((p) => `/blog/${p.slug}`),
      ...ALLOWED_EXTERNAL_TARGETS,
    ]);
    for (const post of posts) {
      for (const [, href] of post.body.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        expect(known.has(href), `${post.slug}: dead internal link ${href}`).toBe(true);
      }
    }
  });

  test('every post links to at least one product page', () => {
    for (const post of posts) {
      expect(post.body, `${post.slug}: no internal product link`).toMatch(/\]\(\/(?!blog\/)/);
    }
  });

  test('money appears only inside labelled examples, never as a Mesaas plan price', () => {
    for (const post of posts) {
      for (const line of post.body.split('\n')) {
        if (!/R\$\s?\d/.test(line)) continue;
        expect(
          line,
          `${post.slug}: never quote Mesaas plan prices — link to /precos instead`,
        ).not.toMatch(/mesaas|plano\s+(free|start|pro|max)/i);
        const labelledExample = /^\s*>/.test(line) || /exemplo/i.test(line);
        expect(
          labelledExample,
          `${post.slug}: money outside a worked example — put it in a blockquote starting with "Exemplo:" (line: ${line.trim()})`,
        ).toBe(true);
      }
    }
  });

  test('no claims about features this repo does not ship', () => {
    for (const post of posts) {
      const body = post.body.toLowerCase();
      expect(body, `${post.slug}: TikTok is not launched`).not.toContain('tiktok');
      expect(body, `${post.slug}: there is no AI image generation`).not.toMatch(
        /gera(r|ção) de imagens? (com|por) ia/,
      );
    }
  });
});
