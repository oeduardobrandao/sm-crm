import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  chipsFor,
  failingChecks,
  isStale,
  liveUrl,
  noRecentDraft,
  showsRetry,
  sortQueue,
  type BlogPostRow,
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
