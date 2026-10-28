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

// Rótulos: fonte única em supabase/functions/_shared/report-docs/tiktok-kpi-labels.ts (as metas
// da IA no servidor usam os mesmos). Tooltips iguais aos da aba Analytics do TikTok (spec §A3,
// packages/i18n/locales/pt/analyticsTiktok.json `kpi.*`; platform.test.ts confere a paridade).
export { TIKTOK_KPI_LABELS_PT } from '../../supabase/functions/_shared/report-docs/tiktok-kpi-labels';

const COUNTS_TOOLTIP =
  'Total atual dos vídeos publicados no período. Não comparamos com o período anterior porque vídeos mais antigos tiveram mais tempo para acumular números.';

export const TIKTOK_KPI_TOOLTIPS_PT: Partial<Record<TikTokKpiId, string>> = {
  views: 'Total atual dos vídeos publicados no período, não as visualizações recebidas no período.',
  engagement_rate:
    'Curtidas, comentários e compartilhamentos divididos pelas visualizações dos vídeos publicados no período. O TikTok não informa alcance, então não é comparável à taxa do Instagram.',
  likes: COUNTS_TOOLTIP,
  comments: COUNTS_TOOLTIP,
  shares: COUNTS_TOOLTIP,
};

/** Id do KPI de um bloco renderizado pela visão TikTok (tipo base "kpi_<id>"). */
export function tiktokKpiId(blockType: string): TikTokKpiId {
  return blockType.replace(/^kpi_/, '') as TikTokKpiId;
}

/** Conta da visão TikTok: handle e foto do TikTok sobre a conta da raiz
 * (specialty e client_name são do cliente, não da plataforma). */
function tiktokAccount(
  snapshot: ReportDocSnapshot,
  tiktok: NonNullable<ReportDocSnapshot['tiktok']>,
): ReportDocSnapshot['account'] {
  return {
    ...snapshot.account,
    handle: tiktok.account.handle,
    profile_picture_url: tiktok.account.avatar_url,
  };
}

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
      account: tiktokAccount(snapshot, tiktok),
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

export const PLATFORM_NAMES: Record<ReportPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

/** Kicker, handle e foto padrão da capa. Plataformas do layout sem dado no
 * snapshot (instagram_connected false, sem seção TikTok) saem antes: um layout
 * misto atualizado depois de desconectar o Instagram vira "· TikTok". Handle e
 * foto vêm da primeira plataforma restante. Nenhuma com dado (ou layout sem
 * plataforma) = Instagram, o comportamento de antes. */
export function coverDefaults(
  snapshot: ReportDocSnapshot,
  platforms: readonly ReportPlatform[] | undefined,
): { kicker: string; handle: string; avatarUrl: string | null } {
  const tiktok = snapshot.tiktok;
  const withData = (platforms ?? []).filter((p) =>
    p === 'tiktok' ? Boolean(tiktok) : snapshot.instagram_connected !== false,
  );
  const list: readonly ReportPlatform[] = withData.length ? withData : ['instagram'];
  const names = (['instagram', 'tiktok'] as const)
    .filter((p) => list.includes(p))
    .map((p) => PLATFORM_NAMES[p]);
  const account =
    list[0] === 'tiktok' && tiktok ? tiktokAccount(snapshot, tiktok) : snapshot.account;
  return {
    kicker: `Relatório mensal · ${names.join(' e ')}`,
    handle: account.handle,
    avatarUrl: account.profile_picture_url ?? null,
  };
}
