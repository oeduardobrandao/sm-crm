import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  chipsFor,
  failingChecks,
  isLiveItem,
  isStale,
  itemPath,
  itemSlug,
  itemsFor,
  liveUrl,
  metricLine,
  noRecentDraft,
  parseSort,
  showsRetry,
  sortItems,
  sortQueue,
  withSort,
  type BlogListItem,
  type BlogPostRow,
  type PostMetrics,
  type FilePostRow,
} from '../blog-view';

const NOW = new Date('2026-10-23T12:00:00Z');
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const okChecks = {
  links: { ok: true, broken: [] },
  images: { ok: true, missing_license: [] },
  cover: true,
  copy: { em_dash: false, meta_endorsement: false },
  similar_titles: [],
};

function row(over: Partial<BlogPostRow> = {}): BlogPostRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'post',
    status: 'rascunho',
    category: 'guia',
    title: 'Título',
    h1: 'H1',
    description: 'Descrição',
    cover_image: null,
    sources: [],
    feature_slug: null,
    checks: okChecks,
    revision_note: null,
    revised_after_note: false,
    rejection_reason: null,
    date: null,
    updated: null,
    revision: 1,
    live_revision: null,
    publish_attempt_at: null,
    created_at: ago(HOUR),
    updated_at: ago(HOUR),
    approved_at: null,
    ...over,
  };
}

const labels = (r: BlogPostRow) => chipsFor(r, NOW).map((c) => c.label);

describe('isStale', () => {
  it('flags a noticia draft older than 3 days', () => {
    expect(isStale(row({ category: 'noticia', created_at: ago(73 * HOUR) }), NOW)).toBe(true);
    expect(
      isStale(
        row({ category: 'noticia', status: 'ajuste_solicitado', created_at: ago(80 * HOUR) }),
        NOW,
      ),
    ).toBe(true);
  });
  it('never flags evergreen, fresh news or a post past review', () => {
    expect(isStale(row({ category: 'guia', created_at: ago(200 * HOUR) }), NOW)).toBe(false);
    expect(isStale(row({ category: 'noticia', created_at: ago(71 * HOUR) }), NOW)).toBe(false);
    expect(
      isStale(row({ category: 'noticia', status: 'publicando', created_at: ago(200 * HOUR) }), NOW),
    ).toBe(false);
  });
});

describe('sortQueue', () => {
  it('puts fresh rows first, newest first, and stale ones last', () => {
    const stale = row({ id: 's', category: 'noticia', created_at: ago(100 * HOUR) });
    const older = row({ id: 'o', created_at: ago(10 * HOUR) });
    const newer = row({ id: 'n', created_at: ago(1 * HOUR) });
    const staleNewer = row({ id: 's2', category: 'noticia', created_at: ago(90 * HOUR) });
    expect(sortQueue([stale, older, staleNewer, newer], NOW).map((r) => r.id)).toEqual([
      'n',
      'o',
      's2',
      's',
    ]);
  });
});

describe('chipsFor', () => {
  it('counts sources, singular and plural', () => {
    expect(
      labels(row({ sources: [{ title: 'a', publisher: 'b', url: 'https://a.com' }] })),
    ).toEqual(['1 fonte']);
    const two = [
      { title: 'a', publisher: 'b', url: 'https://a.com' },
      { title: 'c', publisher: 'd', url: 'https://c.com' },
    ];
    expect(labels(row({ sources: two }))[0]).toBe('2 fontes');
  });

  it('names the weekly feature', () => {
    expect(labels(row({ feature_slug: 'portal-do-cliente' }))).toContain(
      'Post da semana: Portal do cliente',
    );
  });

  it('adds one red chip per failing check', () => {
    const checks = {
      links: { ok: false, broken: ['https://x.com'] },
      images: { ok: false, missing_license: ['capa'] },
      cover: false,
      copy: { em_dash: true, meta_endorsement: true },
      similar_titles: ['Outro post'],
    };
    const chips = chipsFor(row({ checks }), NOW);
    const danger = chips.filter((c) => c.tone === 'danger').map((c) => c.label);
    expect(danger).toEqual([
      'Link fora do ar',
      'Imagem sem licença',
      'Sem imagem de capa',
      'Travessão no texto',
      'Selo da Meta no texto',
      'Tema parecido com outro post',
    ]);
    expect(failingChecks(row({ checks }))).toEqual(danger);
  });

  it('has no check chips when checks are missing or all pass', () => {
    expect(chipsFor(row({ checks: null }), NOW)).toEqual([]);
    expect(chipsFor(row(), NOW)).toEqual([]);
  });

  it('shows the rewrite and stale chips', () => {
    expect(labels(row({ revised_after_note: true }))).toContain('Reescrito após sua nota');
    expect(labels(row({ category: 'noticia', created_at: ago(100 * HOUR) }))).toContain(
      'Desatualizado',
    );
  });

  it('shows Publicando… and then Publicação demorando after 30 min', () => {
    const recent = row({ status: 'publicando', publish_attempt_at: ago(29 * 60_000) });
    expect(labels(recent)).toContain('Publicando…');
    expect(labels(recent)).not.toContain('Publicação demorando');
    const slow = row({ status: 'publicando', publish_attempt_at: ago(31 * 60_000) });
    expect(labels(slow)).toContain('Publicação demorando');
    expect(labels(slow)).not.toContain('Publicando…');
  });
});

describe('noRecentDraft', () => {
  it('warns only past 36 hours', () => {
    expect(noRecentDraft(ago(35 * HOUR), NOW)).toBe(false);
    expect(noRecentDraft(ago(37 * HOUR), NOW)).toBe(true);
  });
  it('stays quiet with no draft at all (nothing to date the banner)', () => {
    expect(noRecentDraft(null, NOW)).toBe(false);
  });
});

describe('actionsFor', () => {
  it('follows the row status, not the tab', () => {
    expect(actionsFor(row({ status: 'rascunho' }))).toEqual([
      'reject',
      'edit',
      'request',
      'approve',
    ]);
    expect(actionsFor(row({ status: 'ajuste_solicitado' }))).toEqual([
      'reject',
      'edit',
      'request',
      'approve',
    ]);
    expect(actionsFor(row({ status: 'publicando' }))).toEqual(['edit', 'retry']);
    expect(actionsFor(row({ status: 'publicado' }))).toEqual(['edit', 'unpublish']);
    expect(actionsFor(row({ status: 'despublicado' }))).toEqual(['retry', 'republish']);
    expect(actionsFor(row({ status: 'rejeitado' }))).toEqual([]);
  });
});

describe('showsRetry', () => {
  it('shows on a publicando row only once it is slow', () => {
    expect(
      showsRetry(row({ status: 'publicando', publish_attempt_at: ago(10 * 60_000) }), NOW),
    ).toBe(false);
    expect(
      showsRetry(row({ status: 'publicando', publish_attempt_at: ago(31 * 60_000) }), NOW),
    ).toBe(true);
  });
  it('always shows on a despublicado row (nothing confirms the page left the air)', () => {
    expect(showsRetry(row({ status: 'despublicado', publish_attempt_at: null }), NOW)).toBe(true);
  });
  it('never shows on other statuses', () => {
    for (const status of ['rascunho', 'ajuste_solicitado', 'publicado', 'rejeitado'] as const) {
      expect(showsRetry(row({ status, publish_attempt_at: ago(2 * HOUR) }), NOW)).toBe(false);
    }
  });
});

describe('liveUrl', () => {
  it('builds the canonical URL', () => {
    expect(liveUrl('mesaas-vs-mlabs')).toBe('https://www.mesaas.com.br/blog/mesaas-vs-mlabs');
    expect(liveUrl('a b')).toBe('https://www.mesaas.com.br/blog/a%20b');
    expect(liveUrl('x', { fromAdmin: true })).toBe('https://www.mesaas.com.br/blog/x?ref=admin');
  });
});

function fileRow(over: Partial<FilePostRow> = {}): FilePostRow {
  return {
    kind: 'arquivo',
    slug: 'post-a-mao',
    title: 'Post escrito à mão',
    description: 'Descrição',
    category: 'guia',
    date: '2026-10-25',
    ...over,
  };
}

describe('itemsFor', () => {
  it('merges file and DB posts on Publicados, newest date first', () => {
    const items = itemsFor(
      'publicados',
      [row({ id: 'db1', status: 'publicado', date: '2026-10-20' })],
      [
        fileRow({ slug: 'velho', date: '2026-07-01' }),
        fileRow({ slug: 'novo', date: '2026-10-25' }),
      ],
      NOW,
    );
    expect(items.map((i) => i.kind)).toEqual(['arquivo', 'rotina', 'arquivo']);
    expect(items.map(itemSlug)).toEqual(['novo', 'post', 'velho']);
  });

  it('dates a DB row without a date by approved_at, then created_at', () => {
    const items = itemsFor(
      'publicados',
      [
        row({ id: 'a', slug: 'aprovado', date: null, approved_at: '2026-10-22T12:00:00Z' }),
        row({ id: 'b', slug: 'criado', date: null, approved_at: null, created_at: '2026-10-21' }),
      ],
      [fileRow({ slug: 'arq', date: '2026-10-21T20:00:00Z' })],
      NOW,
    );
    expect(items.map(itemSlug)).toEqual(['aprovado', 'arq', 'criado']);
  });

  it('keeps sortQueue order on the review tabs and ignores file posts there', () => {
    const fresh = row({ id: 'f', slug: 'f', created_at: ago(HOUR) });
    const older = row({ id: 'o', slug: 'o', created_at: ago(5 * HOUR) });
    for (const tab of ['aguardando', 'rejeitados'] as const) {
      const items = itemsFor(tab, [older, fresh], [fileRow()], NOW);
      expect(items.map(itemSlug)).toEqual(['f', 'o']);
      expect(items.every((i) => i.kind === 'rotina')).toBe(true);
    }
  });
});

describe('isLiveItem / itemPath', () => {
  it('treats file posts, publicado and publicando as live', () => {
    expect(isLiveItem({ kind: 'arquivo', row: fileRow() })).toBe(true);
    expect(isLiveItem({ kind: 'rotina', row: row({ status: 'publicando' }) })).toBe(true);
    expect(isLiveItem({ kind: 'rotina', row: row({ status: 'publicado' }) })).toBe(true);
    expect(isLiveItem({ kind: 'rotina', row: row({ status: 'despublicado' }) })).toBe(false);
    expect(isLiveItem({ kind: 'rotina', row: row({ status: 'rascunho' }) })).toBe(false);
  });

  it('routes file posts to the arquivo path and DB posts to their id', () => {
    expect(itemPath({ kind: 'arquivo', row: fileRow({ slug: 'a b' }) }, 'publicados')).toBe(
      '/admin/blog/arquivo/a%20b?tab=publicados',
    );
    expect(itemPath({ kind: 'rotina', row: row({ id: 'db1' }) }, 'publicados')).toBe(
      '/admin/blog/db1?tab=publicados',
    );
  });
});

const pm = (over: Partial<PostMetrics> = {}): PostMetrics => ({
  views_7d: 0,
  views_30d: 0,
  views_total: 0,
  search: null,
  index: null,
  ...over,
});
const search = (clicks: number, position: number | null = null) => ({
  clicks,
  impressions: 100,
  ctr: 0.1,
  position,
});

describe('metricLine', () => {
  it('joins views, clicks and position with Brazilian number formatting', () => {
    expect(metricLine(pm({ views_30d: 1240, search: search(38, 12.4) }), true)).toBe(
      '1.240 views (30d) · 38 cliques · posição 12,4',
    );
  });

  it('shows only views while Search Console is not ready', () => {
    expect(metricLine(pm({ views_30d: 1240, search: search(38, 12.4) }), false)).toBe(
      '1.240 views (30d)',
    );
  });

  it('shows zero views for a slug with no metrics and skips a missing position', () => {
    expect(metricLine(undefined, true)).toBe('0 views (30d)');
    expect(metricLine(pm({ views_30d: 5, search: search(1, null) }), true)).toBe(
      '5 views (30d) · 1 clique',
    );
  });
});

describe('parseSort', () => {
  it('accepts the three sorts and falls back to recentes', () => {
    expect(parseSort('vistos')).toBe('vistos');
    expect(parseSort('cliques')).toBe('cliques');
    expect(parseSort('recentes')).toBe('recentes');
    expect(parseSort('x')).toBe('recentes');
    expect(parseSort(null)).toBe('recentes');
  });
});

describe('sortItems', () => {
  const mk = (slug: string): BlogListItem => ({
    kind: 'arquivo',
    row: {
      kind: 'arquivo',
      slug,
      title: slug,
      description: '',
      category: 'guia',
      date: '2026-10-01',
    },
  });
  const items = [mk('a'), mk('b'), mk('c'), mk('d')];
  const metrics = {
    a: pm({ views_30d: 10, search: search(1) }),
    b: pm({ views_30d: 50, search: search(9) }),
    c: pm({ views_30d: 10 }),
    // d has no metrics at all
  };
  const slugs = (xs: BlogListItem[]) => xs.map((i) => i.row.slug);

  it('keeps the incoming (date) order for recentes', () => {
    expect(slugs(sortItems(items, metrics, 'recentes'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('orders by 30-day views, ties keeping date order', () => {
    expect(slugs(sortItems(items, metrics, 'vistos'))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('orders by clicks, null counting as zero', () => {
    expect(slugs(sortItems(items, metrics, 'cliques'))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('does not mutate its input', () => {
    sortItems(items, metrics, 'vistos');
    expect(slugs(items)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('withSort', () => {
  it('appends ordem to a path that already has a query, and skips the default', () => {
    expect(withSort('/admin/blog/x?tab=publicados', 'vistos')).toBe(
      '/admin/blog/x?tab=publicados&ordem=vistos',
    );
    expect(withSort('/admin/blog', 'cliques')).toBe('/admin/blog?ordem=cliques');
    expect(withSort('/admin/blog/x?tab=publicados', 'recentes')).toBe(
      '/admin/blog/x?tab=publicados',
    );
  });
});
