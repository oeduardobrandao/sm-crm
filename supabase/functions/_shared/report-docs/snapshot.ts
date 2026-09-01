// Montagem PURA do data_snapshot: recebe resultados de query já buscados,
// devolve o documento congelado. Toda entrada suja (rows any do PostgREST) é
// normalizada aqui. Ordenação dos top posts: views desc, empate por reach —
// views por post = instagram_posts.impressions (mesma base da página de
// Analytics); tudo zerado degrada naturalmente para a ordem por reach.
import type {
  AudienceData, BestTimeSlot, FollowerTrendPoint, TagPerformance,
} from "../report-template/types.ts";
import { isEphemeralInstagramUrl } from "../instagram-thumbnail-cache.ts";
import { computeKpis, type KpiEntry, type KpiSources, type ReportKpiId } from "./kpis.ts";
import { monthWindow } from "./month-window.ts";

export interface SnapshotHubTheme {
  surface: "neutral" | "warm" | "cool";
  font_display: string;
  font_body: string;
  radius: "square" | "soft" | "pill";
  card_style: "filled" | "outline" | "tonal";
}

export interface SnapshotBranding {
  workspace_name: string;
  logo_url: string | null;
  splash_url: string | null;
  accent_color: string;
  hub_theme?: SnapshotHubTheme;
}

export interface SnapshotTopPost {
  type: "reel" | "carousel" | "image";
  /** Views do post (instagram_posts.impressions). Snapshots antigos não têm o
   * campo — widgets leem com guard e caem no reach. */
  views: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  caption_preview: string;
  date: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
}

/** Breakdown próprio do snapshot (não o ContentBreakdown legado): soma
 * avg_views para o líder de formato ser decidido por visualizações. */
export interface SnapshotFormatStats {
  count: number;
  avg_reach: number;
  avg_engagement: number;
  avg_views: number;
}
export type SnapshotContentBreakdown = {
  reels?: SnapshotFormatStats;
  carousels?: SnapshotFormatStats;
  images?: SnapshotFormatStats;
};

export interface ReportDocSnapshot {
  version: 1;
  period: {
    month: string;
    label: string;
    start: string;
    endExclusive: string;
    /** min(último dia do mês, dia da geração), congelado na montagem (spec
     * §4.3). Mês fechado -> último dia do mês; mês corrente (relatório
     * gerado em andamento) -> o dia da geração, pra nunca estampar um
     * período "01-31" que ainda não aconteceu inteiro. Snapshots antigos não
     * têm este campo -- leitores usam guard (mesmo precedente do campo
     * `views` dos top posts). */
    effectiveEnd: string;
  };
  /** Sinalização de outlier do mês ANTERIOR (spec §4.3): quando um post
   * sozinho respondeu por mais de 50% da soma de views (impressions) OU
   * reach por post daquele mês, pra narrativa da IA (ai-input.ts) não tratar
   * a queda pós-viral como fracasso de conteúdo. Ausente/null = mês anterior
   * sem posts ou fonte indisponível. Campo OPCIONAL (mesmo precedente de
   * `views` nos top posts): `version: 1` não muda. */
  comparison?: { prev_outlier: boolean; prev_top_share: number } | null;
  account: {
    handle: string;
    specialty: string;
    /** URL estável (cacheada no momento da geração; ver snapshot-source.ts).
     * Ausente/null = sem foto de perfil disponível. */
    profile_picture_url?: string | null;
    /** Nome do cliente (clientes.nome), pro fallback de iniciais do avatar da
     * capa. Ausente = snapshot gerado antes deste campo existir. */
    client_name?: string;
  };
  branding: SnapshotBranding;
  kpis: Record<ReportKpiId, KpiEntry>;
  follower_trend: FollowerTrendPoint[];
  content_breakdown: SnapshotContentBreakdown;
  top_posts: SnapshotTopPost[];
  audience: AudienceData | null;
  best_times: BestTimeSlot[];
  tags_performance: TagPerformance[];
}

export interface SnapshotPostRow {
  media_type: string | null;
  /** Views do post; a coluna chama impressions (baseline 20260301:203). */
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  /** Exigido por KpiSources.allPosts (posts entram lá direto); vem no select("*"). */
  shares: number | null;
  caption: string | null;
  posted_at: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
}

/** Post do mês ANTERIOR reduzido aos campos que o cálculo de outlier usa.
 * `views` = `instagram_posts.impressions` (mesma base dos top posts). */
export interface SnapshotPrevMonthPost {
  views: number | null;
  reach: number | null;
}

export interface SnapshotInput {
  month: string;
  /** ISO timestamp do momento da geração -- alimenta `period.effectiveEnd`.
   * Congelado pelo CHAMADOR (nunca `new Date()` aqui dentro: assembleSnapshot
   * é puro e determinístico para os mesmos argumentos, precisa pra teste). */
  nowIso: string;
  /** Posts do mês ANTERIOR (não os do mês do relatório -- esses já vêm em
   * `posts`), só pro cálculo de `comparison`. Vazio/null = mês anterior sem
   * dado -> `comparison` sai null. */
  prevMonthPosts: SnapshotPrevMonthPost[] | null;
  account: {
    handle: string;
    specialty: string;
    /** URL estável (cacheada no momento da geração; ver snapshot-source.ts).
     * Ausente/null = sem foto de perfil disponível. */
    profile_picture_url?: string | null;
    /** Nome do cliente (clientes.nome), pro fallback de iniciais do avatar da
     * capa. Ausente = snapshot gerado antes deste campo existir. */
    client_name?: string;
  };
  branding: SnapshotBranding;
  kpiSources: KpiSources;
  followerTrend: FollowerTrendPoint[];
  /** Todos os posts do mês, qualquer ordem. */
  posts: SnapshotPostRow[];
  /** URL original -> URL estável cacheada (resultado de cachePostThumbnail). */
  stableThumbnails: Map<string, string>;
  audience: AudienceData | null;
  bestTimes: BestTimeSlot[];
  tagsPerformance: TagPerformance[];
}

export const MAX_SNAPSHOT_POSTS = 12;
const CAPTION_PREVIEW_MAX = 140;

// Mesmo mapeamento do gerador v2 (index.ts §7 typeMapping): REEL/VIDEO viram
// reels, CAROUSEL_ALBUM carousels, resto images. Confirme contra
// instagram-report-generator-v2/index.ts:828-861 antes de alterar.
function postType(mediaType: string | null): SnapshotTopPost["type"] {
  if (mediaType === "REEL" || mediaType === "VIDEO") return "reel";
  if (mediaType === "CAROUSEL_ALBUM") return "carousel";
  return "image";
}

function stableThumb(
  url: string | null,
  stable: Map<string, string>,
): string | null {
  if (!url) return null;
  const cached = stable.get(url);
  if (cached && !isEphemeralInstagramUrl(cached)) return cached;
  // A regra da spec §5: URL efêmera do CDN nunca congela no snapshot.
  return isEphemeralInstagramUrl(url) ? null : url;
}

const DAY_MS = 86_400_000;

// min(último dia do mês, agora): mês fechado -> now sempre depois do último
// dia -> vence o último dia; mês em curso -> now ainda dentro do mês ->
// vence now. Uma única fórmula cobre os dois casos da spec §4.3.
function computeEffectiveEnd(w: { endExclusive: string }, nowIso: string): string {
  const lastDayMs = Date.parse(w.endExclusive) - DAY_MS;
  const nowMs = Date.parse(nowIso);
  return new Date(Math.min(lastDayMs, nowMs)).toISOString();
}

// Outlier do mês ANTERIOR (spec §4.3): um post sozinho respondendo por >50%
// da soma de views OU reach por post daquele mês. prev_top_share é sempre o
// MAIOR dos dois shares, exposto mesmo quando <=50% (a UI/IA decide o que
// fazer com o número; só a flag prev_outlier é o corte). null = mês anterior
// sem posts (vazio ou fonte indisponível -- o chamador já normaliza os dois
// casos pra este mesmo formato).
function computeComparison(
  prevMonthPosts: SnapshotPrevMonthPost[] | null,
): ReportDocSnapshot["comparison"] {
  if (!prevMonthPosts || prevMonthPosts.length === 0) return null;

  let sumViews = 0;
  let maxViews = 0;
  let sumReach = 0;
  let maxReach = 0;
  for (const p of prevMonthPosts) {
    const views = p.views ?? 0;
    const reach = p.reach ?? 0;
    sumViews += views;
    if (views > maxViews) maxViews = views;
    sumReach += reach;
    if (reach > maxReach) maxReach = reach;
  }
  const viewsShare = sumViews > 0 ? maxViews / sumViews : 0;
  const reachShare = sumReach > 0 ? maxReach / sumReach : 0;
  const topShare = Math.max(viewsShare, reachShare);

  return { prev_outlier: topShare > 0.5, prev_top_share: topShare };
}

export function assembleSnapshot(input: SnapshotInput): ReportDocSnapshot {
  const w = monthWindow(input.month);

  const breakdown: SnapshotContentBreakdown = {};
  for (const p of input.posts) {
    const key = postType(p.media_type) === "reel"
      ? "reels"
      : postType(p.media_type) === "carousel"
      ? "carousels"
      : "images";
    const bucket = breakdown[key] ??
      { count: 0, avg_reach: 0, avg_engagement: 0, avg_views: 0 };
    // avg_* acumulam somas aqui e viram médias no fim.
    bucket.count += 1;
    bucket.avg_reach += p.reach ?? 0;
    bucket.avg_views += p.impressions ?? 0;
    // Engagement rate per post: (likes + comments + saved + shares) / reach, or 0 if reach is 0 or missing
    const reach = p.reach ?? 0;
    const eng = reach > 0
      ? ((p.likes ?? 0) + (p.comments ?? 0) + (p.saved ?? 0) + (p.shares ?? 0)) / reach
      : 0;
    bucket.avg_engagement += eng;
    breakdown[key] = bucket;
  }
  for (const key of ["reels", "carousels", "images"] as const) {
    const b = breakdown[key];
    if (b && b.count > 0) {
      b.avg_reach = Math.round(b.avg_reach / b.count);
      b.avg_views = Math.round(b.avg_views / b.count);
      b.avg_engagement = b.avg_engagement / b.count; // NO rounding for engagement rate
    }
  }

  const topPosts = [...input.posts]
    .sort((a, b) =>
      (b.impressions ?? 0) - (a.impressions ?? 0) || (b.reach ?? 0) - (a.reach ?? 0)
    )
    .slice(0, MAX_SNAPSHOT_POSTS)
    .map((p): SnapshotTopPost => ({
      type: postType(p.media_type),
      views: p.impressions ?? 0,
      reach: p.reach ?? 0,
      likes: p.likes ?? 0,
      comments: p.comments ?? 0,
      saves: p.saved ?? 0,
      shares: p.shares ?? 0,
      caption_preview: (p.caption ?? "").slice(0, CAPTION_PREVIEW_MAX),
      date: p.posted_at,
      permalink: p.permalink,
      thumbnail_url: stableThumb(p.thumbnail_url, input.stableThumbnails),
    }));

  return {
    version: 1,
    period: {
      month: w.month, label: w.label, start: w.start, endExclusive: w.endExclusive,
      effectiveEnd: computeEffectiveEnd(w, input.nowIso),
    },
    comparison: computeComparison(input.prevMonthPosts),
    account: input.account,
    branding: input.branding,
    kpis: computeKpis(input.kpiSources),
    follower_trend: input.followerTrend,
    content_breakdown: breakdown,
    top_posts: topPosts,
    audience: input.audience,
    best_times: input.bestTimes,
    tags_performance: input.tagsPerformance,
  };
}
