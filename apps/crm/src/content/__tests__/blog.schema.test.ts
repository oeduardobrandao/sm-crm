import { describe, expect, test } from 'vitest';
import {
  parseDbPost,
  parsePost,
  readingMinutes,
  splitFrontmatter,
  validateInfograficos,
  extractInfograficos,
} from '../blog.schema';
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

  test('accepts the news category', () => {
    expect(parsePost(raw({ category: 'noticia' }), 'x').category).toBe('noticia');
  });

  test('rejects an unknown category', () => {
    expect(() => parsePost(raw({ category: 'ia' }), 'x')).toThrow(/x\.md/);
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

const DB_META = {
  slug: 'instagram-muda-algoritmo',
  status: 'publicado',
  category: 'noticia',
  title: TITLE,
  h1: 'O Instagram mudou o algoritmo dos Reels',
  description: DESC,
  lede: 'O que muda para quem publica para clientes.',
  date: '2026-10-20',
  updated: '2026-10-21',
  author: 'equipe',
  cover: {
    url: 'https://cdn.example.com/capa.jpg',
    alt: 'Celular com o Instagram aberto',
    credit: 'Fulano / Unsplash',
    license: 'Unsplash License',
    source_url: 'https://unsplash.com/photos/abc',
  },
  images: [
    {
      key: 'grafico-1',
      url: 'https://cdn.example.com/grafico.jpg',
      alt: 'Gráfico de alcance',
      credit: 'Meta',
      license: 'Uso editorial',
      source_url: 'https://about.fb.com/news',
    },
  ],
  sources: [
    {
      title: 'Anúncio oficial',
      publisher: 'Meta',
      url: 'https://about.fb.com/news/x',
      published_at: '2026-10-19',
    },
  ],
  featureSlug: 'aprovacao-de-post',
  revision: 3,
  readingMinutes: 4,
};

describe('parseDbPost', () => {
  test('round-trips a fixture with every field', () => {
    const post = parseDbPost(DB_META, 'Corpo.');
    const { status: _status, ...rest } = DB_META;
    expect(post).toEqual({ ...rest, body: 'Corpo.' });
  });

  test('keeps a null body (lazy) and defaults updated to date', () => {
    const { updated: _u, ...meta } = DB_META;
    const post = parseDbPost(meta, null);
    expect(post.body).toBeNull();
    expect(post.updated).toBe('2026-10-20');
  });

  test.each([
    ['empty sources', { sources: [] }],
    ['image without credit', { images: [{ ...DB_META.images[0], credit: '' }] }],
    ['unknown featureSlug', { featureSlug: 'financeiro' }],
    ['draft status', { status: 'rascunho' }],
    ['non-http source url', { sources: [{ ...DB_META.sources[0], url: 'ftp://x.com/a' }] }],
    ['non-http image url', { images: [{ ...DB_META.images[0], url: 'javascript:alert(1)' }] }],
    ['relative image url', { images: [{ ...DB_META.images[0], url: '/x.jpg' }] }],
    ['non-http cover url', { cover: { ...DB_META.cover, url: 'data:image/png;base64,AAAA' } }],
    ['unknown key', { autor: 'equipe' }],
    ['zero reading minutes', { readingMinutes: 0 }],
  ])('rejects %s, naming the slug', (_label, override) => {
    expect(() => parseDbPost({ ...DB_META, ...override }, 'x')).toThrow(
      /^blog-db\/instagram-muda-algoritmo:/,
    );
  });

  test('names an unknown slug when meta is not an object', () => {
    expect(() => parseDbPost(null, 'x')).toThrow(/^blog-db\/\(desconhecido\):/);
  });
});

function fence(value: unknown): string {
  return '```infografico\n' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n```';
}

const BARRAS = {
  tipo: 'barras',
  titulo: 'Alcance por formato',
  fonte: 1,
  itens: [
    { rotulo: 'Reels', valor: 42, exibicao: '42%' },
    { rotulo: 'Carrossel', valor: 30 },
  ],
};

describe('extractInfograficos', () => {
  test('finds each fence in order, zero-based, tolerating CRLF', () => {
    const body = `Texto\r\n\r\n${fence(BARRAS)}\r\n\nMais\n\n${fence('{nao e json')}\n`.replace(
      '```infografico\n',
      '```infografico  \r\n',
    );
    const found = extractInfograficos(body);
    expect(found.map((f) => f.index)).toEqual([0, 1]);
    expect(found[0].value).toEqual(BARRAS);
    expect(found[1].error).toBeDefined();
  });

  test('an unclosed fence runs to the end of the body', () => {
    expect(extractInfograficos(`Texto\n\n\`\`\`infografico\n${JSON.stringify(BARRAS)}\n`)).toEqual([
      { index: 0, value: BARRAS },
    ]);
  });

  test('does not see an infographic quoted inside another code block', () => {
    const body = '````md\n```infografico\n{}\n```\n````';
    expect(extractInfograficos(body)).toEqual([]);
  });

  test('a backtick info string with a backtick is not a fence', () => {
    expect(extractInfograficos('```infografico `x`\n{}\n```')).toEqual([]);
  });

  test('ignores other code fences', () => {
    expect(extractInfograficos('```json\n{}\n```')).toEqual([]);
  });
});

describe('validateInfograficos', () => {
  test('accepts a valid barras', () => {
    expect(validateInfograficos(fence(BARRAS), 2)).toEqual([]);
  });

  test('accepts valid numeros and etapas', () => {
    const numeros = {
      tipo: 'numeros',
      titulo: 'Em números',
      fonte: 0,
      itens: [
        { valor: '2 bi', legenda: 'usuários ativos' },
        { valor: '38%', legenda: 'do tempo em Reels' },
      ],
    };
    const etapas = {
      tipo: 'etapas',
      titulo: 'Como aprovar',
      itens: [{ rotulo: 'Envie o link' }, { rotulo: 'Cliente revisa' }, { rotulo: 'Aprovado' }],
    };
    expect(validateInfograficos(`${fence(numeros)}\n\n${fence(etapas)}`, 1)).toEqual([]);
  });

  test('flags fonte outside sources', () => {
    expect(validateInfograficos(fence({ ...BARRAS, fonte: 3 }), 2)).toEqual([
      'infografico[0].fonte: índice 3 fora de sources (0..1)',
    ]);
  });

  test('indexes the second infographic as [1]', () => {
    const body = `${fence(BARRAS)}\n\n${fence({ ...BARRAS, fonte: 3 })}`;
    expect(validateInfograficos(body, 2)).toEqual([
      'infografico[1].fonte: índice 3 fora de sources (0..1)',
    ]);
  });

  test('flags fonte when the post has no sources', () => {
    expect(validateInfograficos(fence({ ...BARRAS, fonte: 0 }), 0)).toEqual([
      'infografico[0].fonte: índice 0 fora de sources (nenhuma fonte)',
    ]);
  });

  test('flags empty itens', () => {
    expect(validateInfograficos(fence({ ...BARRAS, itens: [] }), 2)).toEqual([
      'infografico[0].itens: mínimo de 2 itens',
    ]);
  });

  test('flags a text valor on barras', () => {
    const bad = { ...BARRAS, itens: [{ rotulo: 'Reels', valor: 'dez' }, BARRAS.itens[1]] };
    expect(validateInfograficos(fence(bad), 2)).toEqual([
      'infografico[0].itens[0].valor: deve ser número',
    ]);
  });

  test('flags invalid JSON inside the fence', () => {
    expect(validateInfograficos(fence('{"tipo": "barras",'), 2)).toEqual([
      'infografico[0]: JSON inválido',
    ]);
  });

  test('flags an unknown tipo', () => {
    expect(validateInfograficos(fence({ ...BARRAS, tipo: 'pizza' }), 2)).toEqual([
      'infografico[0].tipo: deve ser barras, numeros ou etapas',
    ]);
  });

  test('flags an unknown key and a too-long title', () => {
    const bad = { ...BARRAS, titulo: 'x'.repeat(91), cor: 'azul' };
    expect(validateInfograficos(fence(bad), 2).sort()).toEqual([
      'infografico[0].titulo: máximo de 90 caracteres',
      'infografico[0]: chave desconhecida: cor',
    ]);
  });

  test.each([
    ['a tilde fence', (json: string) => `~~~infografico\n${json}\n~~~`],
    ['4 backticks', (json: string) => `\`\`\`\`infografico\n${json}\n\`\`\`\``],
    ['a 2-space indent', (json: string) => `  \`\`\`infografico\n${json}\n  \`\`\``],
    ['an info string after the word', (json: string) => `\`\`\`infografico json\n${json}\n\`\`\``],
    ['an unclosed fence', (json: string) => `Texto\n\n\`\`\`infografico\n${json}\n`],
  ])('validates the block in %s', (_label, wrap) => {
    expect(validateInfograficos(wrap(JSON.stringify(BARRAS)), 2)).toEqual([]);
    expect(validateInfograficos(wrap(JSON.stringify({ ...BARRAS, fonte: 3 })), 2)).toEqual([
      'infografico[0].fonte: índice 3 fora de sources (0..1)',
    ]);
  });

  test('a longer closing fence closes; a shorter one does not', () => {
    const body = `\`\`\`\`infografico\n${JSON.stringify(BARRAS)}\n\`\`\`\n\`\`\`\`\`\n\nDepois`;
    // The 3-backtick line is content, so the JSON is followed by a stray line.
    expect(validateInfograficos(body, 2)).toEqual(['infografico[0]: JSON inválido']);
  });

  test('flags an empty fence', () => {
    expect(validateInfograficos('```infografico\n```', 2)).toEqual([
      'infografico[0]: JSON inválido',
    ]);
    expect(validateInfograficos('```infografico\n   \n```', 2)).toEqual([
      'infografico[0]: JSON inválido',
    ]);
  });

  test('flags an unclosed fence with broken JSON', () => {
    expect(validateInfograficos('```infografico\n{"tipo": "barras",\n', 2)).toEqual([
      'infografico[0]: JSON inválido',
    ]);
  });

  test('flags a non-integer fonte', () => {
    expect(validateInfograficos(fence({ ...BARRAS, fonte: 0.5 }), 2)).toEqual([
      'infografico[0].fonte: deve ser número inteiro',
    ]);
  });
});
