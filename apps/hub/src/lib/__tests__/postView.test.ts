import { afterEach, describe, expect, it } from 'vitest';
import {
  countPostsByMonth,
  deriveCaption,
  formatMonthKey,
  getPostCover,
  getPostMonthKey,
  groupPostsByMonth,
  getPostPublishState,
  hasDistinctPostText,
  isClientVisible,
  isInProduction,
  isPostClientVisible,
  clientStatusOf,
  pickPostCardKind,
  sortPostsChronologically,
  sortPostsByScheduled,
  STATUS_COLORS,
  VISIBLE_STATUSES,
} from '../postView';
import type { HubPost, HubPostMedia } from '../../types';

function media(over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 1,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn/a.jpg',
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'P',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('isClientVisible', () => {
  it('accepts client-visible statuses', () => {
    expect(isClientVisible('enviado_cliente')).toBe(true);
    expect(isClientVisible('postado')).toBe(true);
  });
  it('rejects internal statuses', () => {
    expect(isClientVisible('rascunho')).toBe(false);
    expect(isClientVisible('revisao_interna')).toBe(false);
    expect(isClientVisible('aprovado_interno')).toBe(false);
  });
  it('has exactly 6 members', () => {
    expect(VISIBLE_STATUSES.size).toBe(6);
  });
});

describe('pickPostCardKind (media-first)', () => {
  it('media-less stories render as text, not story', () => {
    expect(pickPostCardKind(post({ tipo: 'stories', media: [] }))).toBe('text');
  });
  it('stories with media render as story', () => {
    expect(pickPostCardKind(post({ tipo: 'stories', media: [media()] }))).toBe('story');
  });
  it('feed/carrossel with media render as instagram', () => {
    expect(pickPostCardKind(post({ tipo: 'feed', media: [media()] }))).toBe('instagram');
    expect(pickPostCardKind(post({ tipo: 'carrossel', media: [media()] }))).toBe('instagram');
  });
  it('media-less feed renders as text', () => {
    expect(pickPostCardKind(post({ tipo: 'feed', media: [] }))).toBe('text');
  });
});

describe('getPostCover', () => {
  it('prefers cover_media, then media[0], then null', () => {
    const cover = media({ id: 9 });
    expect(getPostCover(post({ cover_media: cover, media: [media({ id: 2 })] }))?.id).toBe(9);
    expect(getPostCover(post({ media: [media({ id: 2 })] }))?.id).toBe(2);
    expect(getPostCover(post())).toBeNull();
  });
});

describe('deriveCaption', () => {
  it('returns the explicit caption when present', () => {
    expect(deriveCaption(post({ conteudo_plain: 'x' }), 'Legenda explícita')).toBe(
      'Legenda explícita',
    );
  });
  it('extracts the text after LEGENDA from conteudo_plain', () => {
    expect(deriveCaption(post({ conteudo_plain: 'Roteiro\nLEGENDA: bora!' }), null)).toBe('bora!');
  });
  it('falls back to the whole conteudo_plain', () => {
    expect(deriveCaption(post({ conteudo_plain: 'só texto' }), '')).toBe('só texto');
  });
});

describe('getPostPublishState', () => {
  it('reports publicando for an agendado post whose time passed', () => {
    expect(
      getPostPublishState({ status: 'agendado', scheduled_at: '2000-01-01T00:00:00.000Z' }),
    ).toBe('publicando');
    expect(
      getPostPublishState({ status: 'agendado', scheduled_at: '2999-01-01T00:00:00.000Z' }),
    ).toBe('agendado');
  });
});

describe('sortPostsChronologically', () => {
  it('sorts by scheduled_at asc, nulls last, ordem as tiebreaker, without mutating', () => {
    const input = [
      post({ id: 1, scheduled_at: null, ordem: 2 }),
      post({ id: 2, scheduled_at: '2026-04-02T00:00:00.000Z', ordem: 1 }),
      post({ id: 3, scheduled_at: '2026-04-01T00:00:00.000Z', ordem: 5 }),
      post({ id: 4, scheduled_at: '2026-04-01T00:00:00.000Z', ordem: 1 }),
      post({ id: 5, scheduled_at: null, ordem: 1 }),
    ];
    const out = sortPostsChronologically(input);
    expect(out.map((p) => p.id)).toEqual([4, 3, 2, 5, 1]);
    expect(input[0].id).toBe(1);
  });
});

describe('sortPostsByScheduled', () => {
  const input = [
    post({ id: 1, scheduled_at: null, ordem: 2 }),
    post({ id: 2, scheduled_at: '2026-04-02T00:00:00.000Z', ordem: 1 }),
    post({ id: 3, scheduled_at: '2026-04-01T00:00:00.000Z', ordem: 5 }),
    post({ id: 4, scheduled_at: '2026-04-01T00:00:00.000Z', ordem: 1 }),
    post({ id: 5, scheduled_at: null, ordem: 1 }),
  ];

  it('asc matches sortPostsChronologically', () => {
    expect(sortPostsByScheduled(input, 'asc').map((p) => p.id)).toEqual(
      sortPostsChronologically(input).map((p) => p.id),
    );
  });

  it('desc is the exact reverse of asc (unscheduled first), without mutating', () => {
    const out = sortPostsByScheduled(input, 'desc');
    expect(out.map((p) => p.id)).toEqual([1, 5, 2, 3, 4]);
    expect(out.map((p) => p.id)).toEqual(
      sortPostsByScheduled(input, 'asc')
        .map((p) => p.id)
        .reverse(),
    );
    expect(input.map((p) => p.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('getPostMonthKey', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("returns 'none' when the post has no (or an unparseable) date", () => {
    expect(getPostMonthKey(post({ scheduled_at: null }))).toBe('none');
    expect(getPostMonthKey(post({ scheduled_at: 'not-a-date' }))).toBe('none');
  });

  it('returns YYYY-MM with a zero-padded month', () => {
    expect(getPostMonthKey(post({ scheduled_at: '2026-04-20T15:00:00.000Z' }))).toBe('2026-04');
    expect(getPostMonthKey(post({ scheduled_at: '2026-11-15T15:00:00.000Z' }))).toBe('2026-11');
  });

  it('buckets by the viewer local month, the same clock the tile date uses (behind UTC)', () => {
    process.env.TZ = 'America/Sao_Paulo';
    // 02:30Z on May 1 is still 23:30 on April 30 in Sao Paulo (UTC-3).
    expect(getPostMonthKey(post({ scheduled_at: '2026-05-01T02:30:00.000Z' }))).toBe('2026-04');
    expect(getPostMonthKey(post({ scheduled_at: '2026-05-01T03:30:00.000Z' }))).toBe('2026-05');
  });

  it('buckets by the viewer local month (ahead of UTC)', () => {
    process.env.TZ = 'Pacific/Auckland';
    // 12:30Z on April 30 is already 00:30 on May 1 in Auckland (UTC+12 in April).
    expect(getPostMonthKey(post({ scheduled_at: '2026-04-30T12:30:00.000Z' }))).toBe('2026-05');
    expect(getPostMonthKey(post({ scheduled_at: '2026-04-30T11:30:00.000Z' }))).toBe('2026-04');
  });
});

describe('countPostsByMonth / groupPostsByMonth', () => {
  const posts = [
    post({ id: 1, scheduled_at: '2026-04-20T15:00:00.000Z' }),
    post({ id: 2, scheduled_at: '2026-09-10T15:00:00.000Z' }),
    post({ id: 3, scheduled_at: null }),
    post({ id: 4, scheduled_at: '2026-09-25T15:00:00.000Z' }),
    post({ id: 5, scheduled_at: '2025-12-15T15:00:00.000Z' }),
  ];

  it('counts posts per month key, dateless ones under none', () => {
    expect(Object.fromEntries(countPostsByMonth(posts))).toEqual({
      '2026-04': 1,
      '2026-09': 2,
      none: 1,
      '2025-12': 1,
    });
  });

  it('orders newest month first with the dateless bucket last', () => {
    expect(groupPostsByMonth(posts)).toEqual([
      { key: '2026-09', count: 2 },
      { key: '2026-04', count: 1 },
      { key: '2025-12', count: 1 },
      { key: 'none', count: 1 },
    ]);
  });

  it('is empty for no posts and has no none bucket when every post is dated', () => {
    expect(groupPostsByMonth([])).toEqual([]);
    expect(groupPostsByMonth([posts[0]])).toEqual([{ key: '2026-04', count: 1 }]);
  });
});

describe('formatMonthKey', () => {
  it('capitalizes the localized long month and year', () => {
    expect(formatMonthKey('2026-09', 'pt-BR')).toBe('Setembro de 2026');
    expect(formatMonthKey('2026-01', 'en-US')).toBe('January 2026');
  });
});

describe('em produção', () => {
  it('isInProduction needs both an internal status and a reason', () => {
    expect(isInProduction(post({ status: 'rascunho', em_producao: 'proxima_aprovacao' }))).toBe(
      true,
    );
    expect(isInProduction(post({ status: 'revisao_interna', em_producao: 'correcao' }))).toBe(true);
    expect(isInProduction(post({ status: 'rascunho' }))).toBe(false);
    expect(isInProduction(post({ status: 'rascunho', em_producao: null }))).toBe(false);
    // A stale flag on a client-visible status never wins.
    expect(isInProduction(post({ status: 'enviado_cliente', em_producao: 'ajuste' }))).toBe(false);
  });

  it('isPostClientVisible adds in-production posts to the visible set', () => {
    expect(isPostClientVisible(post({ status: 'rascunho', em_producao: 'ajuste' }))).toBe(true);
    expect(isPostClientVisible(post({ status: 'rascunho' }))).toBe(false);
    expect(isPostClientVisible(post({ status: 'postado' }))).toBe(true);
  });

  it('getPostPublishState and clientStatusOf report em_producao', () => {
    const p = post({ status: 'aprovado_interno', em_producao: 'proxima_aprovacao' });
    expect(getPostPublishState(p)).toBe('em_producao');
    expect(clientStatusOf(p)).toBe('em_producao');
    expect(clientStatusOf(post({ status: 'agendado' }))).toBe('agendado');
    expect(STATUS_COLORS.em_producao).toBe('#8b5cf6');
  });
});

describe('hasDistinctPostText', () => {
  it('is true when the body has more than the caption', () => {
    expect(
      hasDistinctPostText(post({ conteudo_plain: 'Slide 1\nSlide 2', ig_caption: 'Legenda' })),
    ).toBe(true);
  });
  it('is false for an empty body', () => {
    expect(hasDistinctPostText(post({ conteudo_plain: '   ', ig_caption: 'Legenda' }))).toBe(false);
  });
  it('is false when the body is exactly what the Legenda tab already shows', () => {
    expect(hasDistinctPostText(post({ conteudo_plain: 'Texto simples', ig_caption: null }))).toBe(
      false,
    );
    expect(hasDistinctPostText(post({ conteudo_plain: ' Igual ', ig_caption: 'Igual' }))).toBe(
      false,
    );
  });
});
