// Plataforma dos blocos (spec 2026-10-28 §B2): os tipos tiktok_* reaproveitam
// os componentes do Instagram por uma "visão" do snapshot montada a partir de
// snapshot.tiktok. Só importa de ./types: BlockRenderer, data-presence e os
// blocos importam este módulo, então nada de importar blocos aqui (ciclo).
import { TIKTOK_BLOCK_PREFIX, blockPlatform } from './types';
import type {
  BlockType,
  ReportBlock,
  ReportDocSnapshot,
  ReportLayout,
  SnapshotTopPost,
  TikTokKpiId,
} from './types';

export type ReportPlatform = NonNullable<ReturnType<typeof blockPlatform>>;

export const TIKTOK_KPI_LABELS_PT: Record<TikTokKpiId, string> = {
  followers_total: 'Seguidores totais',
  followers_gained: 'Novos seguidores',
  views: 'Visualizações',
  // TikTok não dá alcance: a taxa é sobre visualizações e nunca se compara
  // como o mesmo número da taxa do Instagram (spec §A3).
  engagement_rate: 'Engajamento por visualização',
  likes: 'Curtidas',
  comments: 'Comentários',
  shares: 'Compartilhamentos',
  posts_count: 'Vídeos publicados',
  likes_total: 'Curtidas totais do perfil',
};

export const TIKTOK_KPI_TOOLTIPS_PT: Partial<Record<TikTokKpiId, string>> = {
  views: 'Total atual dos vídeos publicados no mês, não as visualizações recebidas no mês.',
};

/** For a tiktok_* block: the equivalent Instagram block type and a
 * ReportDocSnapshot-shaped view built from snapshot.tiktok. null when the
 * snapshot has no TikTok section (or the block is not a TikTok one). */
export function tiktokBlockView(
  block: ReportBlock,
  snapshot: ReportDocSnapshot,
): { block: ReportBlock; snapshot: ReportDocSnapshot } | null {
  const tiktok = snapshot.tiktok;
  if (!tiktok || !block.type.startsWith(TIKTOK_BLOCK_PREFIX)) return null;
  // tiktok_kpi_likes -> kpi_likes: os KPIs só do TikTok (likes, comments,
  // shares, likes_total) não existem no BlockType do Instagram. O cast é seguro
  // porque KpiCardBlock tira o "kpi_" e, com platform="tiktok", lê as tabelas
  // TikTok; os demais tipos base (top_posts, chart_followers...) existem.
  const baseType = block.type.slice(TIKTOK_BLOCK_PREFIX.length) as BlockType;
  const top_posts: SnapshotTopPost[] = tiktok.top_posts.map((p) => ({
    // reach/saves zerados: a Display API não os dá, e os componentes com
    // platform="tiktok" não os mostram.
    type: 'reel',
    views: p.views,
    reach: 0,
    likes: p.likes,
    comments: p.comments,
    saves: 0,
    shares: p.shares,
    caption_preview: p.caption_preview,
    date: p.date,
    permalink: p.permalink,
    thumbnail_url: p.thumbnail_url,
  }));
  return {
    block: { ...block, type: baseType },
    snapshot: {
      ...snapshot,
      account: {
        ...snapshot.account,
        handle: tiktok.account.handle,
        profile_picture_url: tiktok.account.avatar_url,
      },
      // Record<TikTokKpiId, KpiEntry> no lugar de Record<ReportKpiId, KpiEntry>:
      // mesmo formato de entrada, chaves diferentes. Só KpiCardBlock e
      // blockHasData leem kpis, ambos pelo id do tipo do bloco.
      kpis: tiktok.kpis as unknown as ReportDocSnapshot['kpis'],
      follower_trend: tiktok.follower_trend,
      best_times: tiktok.best_times,
      top_posts,
      // Nada do Instagram vaza para a visão TikTok.
      content_breakdown: {},
      audience: null,
      tags_performance: [],
      // A visão é o dado da plataforma: o flag do Instagram não se aplica a ela
      // (sem isto, blockHasData do tipo base daria false num relatório só TikTok).
      instagram_connected: undefined,
      tiktok: undefined,
    },
  };
}

/** Bloco Instagram num relatório sem Instagram (instagram_connected false):
 * não renderiza, mesmo que a raiz traga algum número. */
export function instagramAbsent(type: string, snapshot: ReportDocSnapshot): boolean {
  return snapshot.instagram_connected === false && blockPlatform(type) === 'instagram';
}

/** Plataformas presentes no layout, na ordem da primeira ocorrência. */
export function layoutPlatforms(layout: ReportLayout): ReportPlatform[] {
  const out: ReportPlatform[] = [];
  for (const b of layout.blocks) {
    const p = blockPlatform(b.type);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

const PLATFORM_NAMES: Record<ReportPlatform, string> = { instagram: 'Instagram', tiktok: 'TikTok' };

/** Kicker e handle padrão da capa. Sem plataformas (ou vazio) = Instagram, o
 * comportamento de antes. O handle vem da primeira plataforma do layout, com
 * o @ do Instagram como reserva. */
export function coverDefaults(
  snapshot: ReportDocSnapshot,
  platforms: readonly ReportPlatform[] | undefined,
): { kicker: string; handle: string } {
  const list: readonly ReportPlatform[] = platforms && platforms.length ? platforms : ['instagram'];
  const names = (['instagram', 'tiktok'] as const)
    .filter((p) => list.includes(p))
    .map((p) => PLATFORM_NAMES[p]);
  const handle =
    list[0] === 'tiktok' && snapshot.tiktok?.account.handle
      ? snapshot.tiktok.account.handle
      : snapshot.account.handle;
  return { kicker: `Relatório mensal · ${names.join(' e ')}`, handle };
}
