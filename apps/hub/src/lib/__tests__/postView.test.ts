import { describe, expect, it } from 'vitest';
import {
  deriveCaption,
  getPostCover,
  getPostPublishState,
  isClientVisible,
  pickPostCardKind,
  sortPostsChronologically,
  sortPostsByScheduled,
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

  it('desc puts the newest first, unscheduled still last, ordem descending as tiebreaker, without mutating', () => {
    const out = sortPostsByScheduled(input, 'desc');
    expect(out.map((p) => p.id)).toEqual([2, 3, 4, 1, 5]);
    expect(input.map((p) => p.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
