import { describe, expect, it } from 'vitest';
import { makeSnapshotFixture } from '../fixtures';
import { blockHasData } from '../data-presence';
import {
  TIKTOK_KPI_LABELS_PT,
  TIKTOK_KPI_TOOLTIPS_PT,
  coverDefaults,
  layoutPlatforms,
  tiktokBlockView,
} from '../platform';
import { TIKTOK_KPI_IDS } from '../types';
import ptTiktok from '../../i18n/locales/pt/analyticsTiktok.json';
import type { ReportBlock, ReportDocSnapshot, ReportLayout } from '../types';

const PT_KPI = ptTiktok.kpi;

const blk = (type: string, config?: Record<string, unknown>): ReportBlock =>
  ({ id: 'x', type, size: 'full', ...(config ? { config } : {}) }) as ReportBlock;
const l = (types: string[]): ReportLayout => ({
  version: 1,
  blocks: types.map((t, i) => ({ id: `b${i}`, type: t, size: 'full' }) as ReportBlock),
});

/** Snapshot de relatório só TikTok: raiz Instagram vazia + instagram_connected false. */
function tiktokOnlySnapshot(): ReportDocSnapshot {
  const base = makeSnapshotFixture();
  return {
    ...base,
    instagram_connected: false,
    kpis: Object.fromEntries(
      Object.entries(base.kpis).map(([k, e]) => [k, { ...e, value: null, prev: null }]),
    ) as ReportDocSnapshot['kpis'],
    follower_trend: [],
    content_breakdown: {},
    top_posts: [],
    audience: null,
    best_times: [],
    tags_performance: [],
  };
}

describe('TIKTOK_KPI_LABELS_PT', () => {
  it('rótulos exatos de cada KPI TikTok', () => {
    expect(TIKTOK_KPI_LABELS_PT).toEqual({
      followers_total: 'Seguidores',
      followers_gained: 'Novos seguidores',
      views: 'Visualizações',
      engagement_rate: 'Engajamento por visualização',
      likes: 'Curtidas',
      comments: 'Comentários',
      shares: 'Compartilhamentos',
      posts_count: 'Vídeos publicados',
      likes_total: 'Curtidas totais do perfil',
    });
    // Mesmo texto da aba Analytics (Part A), fonte packages/i18n.
    expect(PT_KPI.views.tooltip).toBe(
      'Total atual dos vídeos publicados no período, não as visualizações recebidas no período.',
    );
    expect(TIKTOK_KPI_TOOLTIPS_PT.likes).toBe(PT_KPI.countsTooltip);
    expect(TIKTOK_KPI_TOOLTIPS_PT.comments).toBe(PT_KPI.countsTooltip);
    expect(TIKTOK_KPI_TOOLTIPS_PT.shares).toBe(PT_KPI.countsTooltip);
    expect(TIKTOK_KPI_TOOLTIPS_PT.engagement_rate).toBe(PT_KPI.engagementTooltip);
    expect(TIKTOK_KPI_TOOLTIPS_PT.views).toBe(PT_KPI.views.tooltip);
  });
});

describe('tiktokBlockView', () => {
  it('null quando o snapshot não tem seção TikTok', () => {
    expect(tiktokBlockView(blk('tiktok_kpi_views'), makeSnapshotFixture({ tiktok: null }))).toBe(
      null,
    );
    expect(
      tiktokBlockView(blk('tiktok_kpi_views'), makeSnapshotFixture({ tiktok: undefined })),
    ).toBe(null);
  });

  it('troca o tipo pelo equivalente Instagram e a raiz pelos dados TikTok', () => {
    const snap = makeSnapshotFixture();
    const v = tiktokBlockView(blk('tiktok_top_posts', { count: 3 }), snap);
    expect(v).not.toBe(null);
    expect(v!.block.type).toBe('top_posts');
    expect(v!.block.config).toEqual({ count: 3 });
    expect(v!.snapshot.account.handle).toBe('seucliente');
    expect(v!.snapshot.follower_trend).toBe(snap.tiktok!.follower_trend);
    expect(v!.snapshot.best_times).toBe(snap.tiktok!.best_times);
    // Nada do Instagram vaza para a visão TikTok.
    expect(v!.snapshot.audience).toBe(null);
    expect(v!.snapshot.content_breakdown).toEqual({});
    expect(v!.snapshot.tags_performance).toEqual([]);
    const first = v!.snapshot.top_posts[0];
    const src = snap.tiktok!.top_posts[0];
    expect(first).toMatchObject({
      type: 'reel',
      reach: 0,
      saves: 0,
      views: src.views,
      likes: src.likes,
      comments: src.comments,
      shares: src.shares,
      caption_preview: src.caption_preview,
      permalink: src.permalink,
    });
  });

  it('tipo não-TikTok: null', () => {
    expect(tiktokBlockView(blk('kpi_views'), makeSnapshotFixture())).toBe(null);
  });
});

describe('layoutPlatforms', () => {
  it('ordem da primeira ocorrência, sem repetição, sem neutros', () => {
    expect(
      layoutPlatforms(l(['cover', 'tiktok_kpi_views', 'kpi_reach', 'tiktok_top_posts'])),
    ).toEqual(['tiktok', 'instagram']);
    expect(layoutPlatforms(l(['cover', 'text']))).toEqual([]);
  });
});

describe('coverDefaults', () => {
  /** Fixture com foto nas duas contas, para distinguir o avatar escolhido. */
  function withAvatars(over: Partial<ReportDocSnapshot> = {}): ReportDocSnapshot {
    const snap = makeSnapshotFixture(over);
    snap.account.profile_picture_url = 'https://x/ig.jpg';
    if (snap.tiktok) snap.tiktok.account.avatar_url = 'https://x/tt.jpg';
    return snap;
  }
  const IG = { handle: 'dra.exemplo', avatarUrl: 'https://x/ig.jpg' };
  const TT = { handle: 'seucliente', avatarUrl: 'https://x/tt.jpg' };

  it('sem plataformas: kicker, handle e avatar do Instagram (hoje)', () => {
    const snap = withAvatars();
    expect(coverDefaults(snap, undefined)).toEqual({
      kicker: 'Relatório mensal · Instagram',
      ...IG,
    });
    expect(coverDefaults(snap, [])).toEqual({ kicker: 'Relatório mensal · Instagram', ...IG });
  });

  it('TikTok primeiro: handle e avatar do TikTok; misto: Instagram e TikTok', () => {
    const snap = withAvatars();
    expect(coverDefaults(snap, ['tiktok'])).toEqual({ kicker: 'Relatório mensal · TikTok', ...TT });
    expect(coverDefaults(snap, ['tiktok', 'instagram'])).toEqual({
      kicker: 'Relatório mensal · Instagram e TikTok',
      ...TT,
    });
    expect(coverDefaults(snap, ['instagram', 'tiktok'])).toEqual({
      kicker: 'Relatório mensal · Instagram e TikTok',
      ...IG,
    });
  });

  it('layout misto atualizado depois de desconectar o Instagram: só TikTok', () => {
    const snap = withAvatars({ instagram_connected: false });
    expect(coverDefaults(snap, ['instagram', 'tiktok'])).toEqual({
      kicker: 'Relatório mensal · TikTok',
      ...TT,
    });
  });

  it('layout misto sem seção TikTok: só Instagram', () => {
    const snap = withAvatars({ tiktok: null });
    expect(coverDefaults(snap, ['tiktok', 'instagram'])).toEqual({
      kicker: 'Relatório mensal · Instagram',
      ...IG,
    });
  });

  it('nenhuma plataforma com dado: mantém o padrão de hoje (Instagram)', () => {
    const snap = withAvatars({ tiktok: null, instagram_connected: false });
    expect(coverDefaults(snap, ['tiktok'])).toEqual({
      kicker: 'Relatório mensal · Instagram',
      ...IG,
    });
  });

  it('sem foto: avatarUrl null', () => {
    expect(coverDefaults(makeSnapshotFixture(), ['tiktok']).avatarUrl).toBe(null);
    expect(coverDefaults(makeSnapshotFixture(), ['instagram']).avatarUrl).toBe(null);
  });
});

describe('blockHasData por plataforma', () => {
  it('blockHasData false for tiktok_* without tiktok section', () => {
    const snap = makeSnapshotFixture({ tiktok: null });
    for (const t of [
      'tiktok_kpi_views',
      'tiktok_kpi_likes_total',
      'tiktok_chart_followers',
      'tiktok_chart_best_times',
      'tiktok_top_posts',
      'tiktok_post_list',
    ]) {
      expect(blockHasData(blk(t), snap)).toBe(false);
    }
  });

  it('tiktok_* com seção TikTok: mesma checagem do tipo base contra a visão', () => {
    const snap = makeSnapshotFixture();
    expect(blockHasData(blk('tiktok_kpi_likes_total'), snap)).toBe(true);
    expect(blockHasData(blk('tiktok_top_posts'), snap)).toBe(true);
    snap.tiktok!.kpis.followers_gained = { value: null, unit: 'count', prev: null };
    snap.tiktok!.top_posts = [];
    expect(blockHasData(blk('tiktok_kpi_followers_gained'), snap)).toBe(false);
    expect(blockHasData(blk('tiktok_post_list'), snap)).toBe(false);
  });

  it('Instagram blocks with instagram_connected false and empty data → blockHasData false', () => {
    const snap = tiktokOnlySnapshot();
    for (const t of [
      'kpi_reach',
      'kpi_views',
      'chart_followers',
      'chart_formats',
      'chart_best_times',
      'audience_gender',
      'top_posts',
      'post_list',
      'tags_table',
    ]) {
      expect(blockHasData(blk(t), snap)).toBe(false);
    }
    // ...e os blocos TikTok seguem com dado.
    expect(blockHasData(blk('tiktok_kpi_views'), snap)).toBe(true);
  });
});

describe('makeSnapshotFixture: seção TikTok', () => {
  it('fixture tiktok kpis all non-null', () => {
    const tt = makeSnapshotFixture().tiktok!;
    for (const id of TIKTOK_KPI_IDS) {
      expect(tt.kpis[id], id).toBeDefined();
      expect(tt.kpis[id].value, id).not.toBe(null);
    }
    // Contagens somadas nunca comparam (spec A3).
    for (const id of ['views', 'likes', 'comments', 'shares', 'likes_total'] as const) {
      expect(tt.kpis[id].prev, id).toBe(null);
    }
    expect(tt.kpis.engagement_rate.unit).toBe('pct');
    expect(tt.account.handle).toBe('seucliente');
    expect(tt.top_posts.length).toBeGreaterThan(0);
    for (const p of tt.top_posts) {
      expect(p.permalink).toMatch(/^https:\/\/www\.tiktok\.com\/@seucliente\/video\/\d+$/);
    }
  });
});
