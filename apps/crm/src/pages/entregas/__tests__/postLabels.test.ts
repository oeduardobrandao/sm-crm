import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  getPostPublishState,
  TIPO_COLORS,
  TIPO_BADGE_COLORS,
  TIPO_ORDER,
  TIPO_LABELS,
  buildTipoDayMarkers,
} from '../postLabels';
import type { ClientePost } from '@/store/posts';

describe('tipo palette', () => {
  it('uses the CRM palette, not the Hub palette', () => {
    expect(TIPO_COLORS).toEqual({
      feed: '#eab308',
      reels: '#E1306C',
      stories: '#42c8f5',
      carrossel: '#3ecf8e',
    });
  });

  it('derives badge colors as text = solid hex, bg = hex + 25 alpha', () => {
    expect(TIPO_BADGE_COLORS.carrossel).toEqual({ bg: '#3ecf8e25', text: '#3ecf8e' });
    for (const tipo of TIPO_ORDER) {
      expect(TIPO_BADGE_COLORS[tipo].text).toBe(TIPO_COLORS[tipo]);
      expect(TIPO_BADGE_COLORS[tipo].bg).toBe(`${TIPO_COLORS[tipo]}25`);
    }
  });

  it('orders tipos feed, carrossel, reels, stories', () => {
    expect(TIPO_ORDER).toEqual(['feed', 'carrossel', 'reels', 'stories']);
  });

  it('covers every tipo that has a label', () => {
    expect(Object.keys(TIPO_COLORS).sort()).toEqual(Object.keys(TIPO_LABELS).sort());
    expect([...TIPO_ORDER].sort()).toEqual(Object.keys(TIPO_LABELS).sort());
  });
});

describe('getPostPublishState', () => {
  // ─── Pre-existing behavior (IG-only / no platform info) — must stay unchanged ──

  it('returns the raw status for non-agendado posts', () => {
    expect(getPostPublishState({ status: 'aprovado_cliente', scheduled_at: null })).toBe(
      'aprovado_cliente',
    );
  });

  it('returns agendado when scheduled_at is in the future', () => {
    expect(getPostPublishState({ status: 'agendado', scheduled_at: '2099-01-01T00:00:00Z' })).toBe(
      'agendado',
    );
  });

  it('returns publicando when scheduled_at is due', () => {
    expect(getPostPublishState({ status: 'agendado', scheduled_at: '2000-01-01T00:00:00Z' })).toBe(
      'publicando',
    );
  });

  it('returns agendado when scheduled_at is missing', () => {
    expect(getPostPublishState({ status: 'agendado', scheduled_at: null })).toBe('agendado');
  });

  // ─── TikTok extension ────────────────────────────────────────────────────────

  it.each(['initiated', 'processing'] as const)(
    'returns publicando for platform tiktok when tiktok_publish_status is %s, even if not due',
    (s) => {
      expect(
        getPostPublishState({
          status: 'agendado',
          scheduled_at: '2099-01-01T00:00:00Z',
          platform: 'tiktok',
          tiktok_publish_status: s,
        }),
      ).toBe('publicando');
    },
  );

  it('returns publicando for platform both when tiktok_publish_status is processing, even if not due', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'both',
        tiktok_publish_status: 'processing',
      }),
    ).toBe('publicando');
  });

  it('returns agendado for platform tiktok when tiktok_publish_status is null and not due', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'tiktok',
        tiktok_publish_status: null,
      }),
    ).toBe('agendado');
  });

  it('ignores tiktok_publish_status for platform instagram', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'instagram',
        tiktok_publish_status: 'processing',
      }),
    ).toBe('agendado');
  });

  it('ignores tiktok_publish_status when platform is undefined (defaults to instagram)', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        tiktok_publish_status: 'processing',
      }),
    ).toBe('agendado');
  });

  it('does not treat failed or published tiktok_publish_status as publicando', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'tiktok',
        tiktok_publish_status: 'failed',
      }),
    ).toBe('agendado');
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'tiktok',
        tiktok_publish_status: 'published',
      }),
    ).toBe('agendado');
  });

  it('due scheduled_at still wins even when tiktok_publish_status would say otherwise', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2000-01-01T00:00:00Z',
        platform: 'tiktok',
        tiktok_publish_status: 'failed',
      }),
    ).toBe('publicando');
  });
});

type P = Pick<ClientePost, 'id' | 'tipo' | 'scheduled_at'>;
// Local-noon timestamps keep the assertions timezone-independent.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0).toISOString();

describe('buildTipoDayMarkers', () => {
  it('returns an empty map for no posts', () => {
    expect(buildTipoDayMarkers([]).size).toBe(0);
  });

  it('skips posts with no scheduled_at', () => {
    const posts: P[] = [{ id: 1, tipo: 'feed', scheduled_at: null }];
    expect(buildTipoDayMarkers(posts).size).toBe(0);
  });

  it('emits one dot per distinct tipo, not per post', () => {
    const posts: P[] = [
      { id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 2, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 3, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
    ];
    const marker = buildTipoDayMarkers(posts).get('2026-07-24');
    expect(marker?.colors).toEqual(['#eab308']);
    expect(marker?.label).toBe('3 Feed');
  });

  it('orders dots feed, carrossel, reels, stories regardless of input order', () => {
    const posts: P[] = [
      { id: 1, tipo: 'stories', scheduled_at: at(2026, 7, 24) },
      { id: 2, tipo: 'reels', scheduled_at: at(2026, 7, 24) },
      { id: 3, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 4, tipo: 'carrossel', scheduled_at: at(2026, 7, 24) },
    ];
    const marker = buildTipoDayMarkers(posts).get('2026-07-24');
    expect(marker?.colors).toEqual(['#eab308', '#3ecf8e', '#E1306C', '#42c8f5']);
    expect(marker?.label).toBe('1 Feed · 1 Carrossel · 1 Reels · 1 Stories');
  });

  describe('local vs UTC day keys', () => {
    // A local-time key and a `toISOString().slice(0, 10)` key only diverge when the process
    // offset is non-zero. CI runners default to TZ=UTC, where the two coincide — so without
    // pinning an offset here this test would be inert in exactly the environment that gates
    // merges. Pin UTC-3 (no DST year-round) so local 23:00 lands on the NEXT UTC day.
    const realTZ = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'America/Sao_Paulo';
    });
    afterAll(() => {
      process.env.TZ = realTZ;
    });

    it('groups by local date, not UTC date', () => {
      // Local 2026-07-24 23:00 at UTC-3 is 2026-07-25T02:00:00.000Z. A UTC-based key would
      // land on '2026-07-25'; the correct local-date grouping keys it '2026-07-24'.
      const posts: P[] = [
        { id: 1, tipo: 'feed', scheduled_at: new Date(2026, 6, 24, 23, 0, 0).toISOString() },
      ];
      const keys = [...buildTipoDayMarkers(posts).keys()];
      expect(keys).toEqual(['2026-07-24']);
    });
  });

  it('separates distinct days', () => {
    const posts: P[] = [
      { id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 2, tipo: 'reels', scheduled_at: at(2026, 7, 25) },
    ];
    const map = buildTipoDayMarkers(posts);
    expect(map.get('2026-07-24')?.colors).toEqual(['#eab308']);
    expect(map.get('2026-07-25')?.colors).toEqual(['#E1306C']);
  });

  it('excludes the post being edited so it does not warn about itself', () => {
    const posts: P[] = [
      { id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 2, tipo: 'reels', scheduled_at: at(2026, 7, 24) },
    ];
    const marker = buildTipoDayMarkers(posts, { excludePostId: 1 }).get('2026-07-24');
    expect(marker?.colors).toEqual(['#E1306C']);
    expect(marker?.label).toBe('1 Reels');
  });

  it('drops a day entirely when the excluded post was its only one', () => {
    const posts: P[] = [{ id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) }];
    expect(buildTipoDayMarkers(posts, { excludePostId: 1 }).size).toBe(0);
  });
});
