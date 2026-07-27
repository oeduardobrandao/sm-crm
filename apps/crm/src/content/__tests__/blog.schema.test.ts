import { describe, expect, test } from 'vitest';
import { parsePost, readingMinutes, splitFrontmatter } from '../blog.schema';
import { blogPostRouteMeta, relatedPosts, sortPosts } from '../blog';

const TITLE = 'Mesaas ou Aprova Post: qual usar na sua agência em 2026';
const DESC =
  'Comparamos Mesaas e Aprova Post na aprovação de posts com o cliente: link sem login, fluxo de revisão, agendamento no Instagram e gestão da agência.';

function raw(overrides: Partial<Record<string, string>> = {}): string {
  const fm: Record<string, string> = {
    title: TITLE,
    h1: 'Mesaas ou Aprova Post',
    description: DESC,
    date: '2026-07-25',
    category: 'comparativo',
    ...overrides,
  };
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `---\n${lines}\n---\n\n## Uma seção\n\nCorpo do artigo.\n`;
}

describe('splitFrontmatter', () => {
  test('splits data from body and keeps colons inside values', () => {
    const { data, body } = splitFrontmatter(raw());
    expect(data.title).toBe(TITLE);
    expect(body.startsWith('## Uma seção')).toBe(true);
  });

  test('throws when the frontmatter block is missing', () => {
    expect(() => splitFrontmatter('# sem frontmatter')).toThrow(/frontmatter/);
  });

  test('tolerates CRLF line endings', () => {
    const { data, body } = splitFrontmatter(raw().replace(/\n/g, '\r\n'));
    expect(data.title).toBe(TITLE);
    expect(data.category).toBe('comparativo');
    expect(body.startsWith('## Uma seção')).toBe(true);
  });

  test('skips a blank line inside the frontmatter block', () => {
    const withBlankLine = `---\ntitle: ${TITLE}\n\nh1: Mesaas ou Aprova Post\ndescription: ${DESC}\ndate: 2026-07-25\ncategory: comparativo\n---\n\n## Uma seção\n\nCorpo do artigo.\n`;
    const { data } = splitFrontmatter(withBlankLine);
    expect(data.title).toBe(TITLE);
    expect(data.category).toBe('comparativo');
  });

  test('throws on a frontmatter line with no colon', () => {
    const malformed = '---\nesta linha nao tem separador\n---\n\nCorpo.\n';
    expect(() => splitFrontmatter(malformed)).toThrow(/malformed frontmatter line/);
  });
});

describe('parsePost', () => {
  test('defaults updated to date and computes reading time', () => {
    const post = parsePost(raw(), 'mesaas-vs-aprova-post');
    expect(post.slug).toBe('mesaas-vs-aprova-post');
    expect(post.updated).toBe('2026-07-25');
    expect(post.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  test('rejects a title outside the SERP range, naming the file', () => {
    expect(() => parsePost(raw({ title: 'Curto demais' }), 'curto')).toThrow(/curto\.md/);
  });

  test('rejects an unknown category', () => {
    expect(() => parsePost(raw({ category: 'noticia' }), 'x')).toThrow(/x\.md/);
  });

  test('prefixes a missing-frontmatter failure with the file path', () => {
    expect(() => parsePost('# sem frontmatter', 'no-front')).toThrow(/^blog\/no-front\.md:/);
  });
});

describe('readingMinutes', () => {
  test('never returns zero', () => {
    expect(readingMinutes('uma palavra')).toBe(1);
  });
});

describe('blog helpers', () => {
  const a = parsePost(raw({ date: '2026-07-20' }), 'a');
  const b = parsePost(raw({ date: '2026-07-25' }), 'b');
  const c = parsePost(raw({ date: '2026-07-22', category: 'guia' }), 'c');
  // Same category as `a` but older than everything else, so recency-only
  // sorting and same-category preference disagree on where it ranks.
  const d = parsePost(raw({ date: '2026-07-15' }), 'd');

  test('sortPosts puts the newest first', () => {
    expect(sortPosts([a, b, c]).map((p) => p.slug)).toEqual(['b', 'c', 'a']);
  });

  test('blogPostRouteMeta derives path, file and lastmod', () => {
    const meta = blogPostRouteMeta(b);
    expect(meta.path).toBe('/blog/b');
    expect(meta.file).toBe('blog/b.html');
    expect(meta.lastmod).toBe('2026-07-25');
    expect(meta.ogImage).toBe('https://www.mesaas.com.br/og/blog/b.png');
    expect(meta.ogType).toBe('article');
  });

  test('relatedPosts excludes the post itself and prefers the same category', () => {
    // Recency-only order would be [b, c, d] (b newest, then c, then d).
    // Same-category preference for `a` (comparativo) must instead surface
    // `d` (comparativo, oldest) ahead of `c` (guia, more recent than `d`).
    const related = relatedPosts(a, [a, b, c, d], 2);
    expect(related.map((p) => p.slug)).toEqual(['b', 'd']);
  });
});

describe('calendar dates', () => {
  test.each(['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29'])(
    'rejects the impossible date %s',
    (date) => {
      expect(() => parsePost(raw({ date }), 'x')).toThrow(/x\.md/);
    },
  );

  test.each(['2026-02-28', '2024-02-29', '2026-12-31'])('accepts the real date %s', (date) => {
    expect(parsePost(raw({ date }), 'x').date).toBe(date);
  });

  test('applies the same rule to updated', () => {
    expect(() => parsePost(raw({ updated: '2026-04-31' }), 'x')).toThrow(/x\.md/);
  });
});

describe('frontmatter contract strictness', () => {
  test('rejects an unknown key instead of dropping it', () => {
    // `udpated` silently discarded would ship a stale dateModified.
    expect(() => parsePost(raw({ udpated: '2026-08-01' }), 'x')).toThrow(/x\.md/);
  });

  test('rejects a comment written on the same line as a value', () => {
    expect(() => parsePost(raw({ date: '2026-07-25 # publicado' }), 'x')).toThrow(/x\.md/);
  });

  test('rejects updated earlier than date', () => {
    expect(() => parsePost(raw({ date: '2026-07-25', updated: '2026-07-20' }), 'x')).toThrow(
      /x\.md/,
    );
  });

  test('accepts updated on or after date', () => {
    expect(parsePost(raw({ date: '2026-07-25', updated: '2026-07-25' }), 'x').updated).toBe(
      '2026-07-25',
    );
    expect(parsePost(raw({ date: '2026-07-25', updated: '2026-08-02' }), 'x').updated).toBe(
      '2026-08-02',
    );
  });
});
