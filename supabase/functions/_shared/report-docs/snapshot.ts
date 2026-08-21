// Montagem PURA do data_snapshot: recebe resultados de query já buscados,
// devolve o documento congelado. Toda entrada suja (rows any do PostgREST) é
// normalizada aqui. Ordenação dos top posts: reach desc.
import type {
  AudienceData, BestTimeSlot, ContentBreakdown, FollowerTrendPoint, TagPerformance,
} from "../report-template/types.ts";
import { isEphemeralInstagramUrl } from "../instagram-thumbnail-cache.ts";
import { computeKpis, type KpiEntry, type KpiSources, type ReportKpiId } from "./kpis.ts";
import { monthWindow } from "./month-window.ts";

export interface SnapshotBranding {
  workspace_name: string;
  logo_url: string | null;
  splash_url: string | null;
  accent_color: string;
}

export interface SnapshotTopPost {
  type: "reel" | "carousel" | "image";
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  caption_preview: string;
  date: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
}

export interface ReportDocSnapshot {
  version: 1;
  period: { month: string; label: string; start: string; endExclusive: string };
  account: { handle: string; specialty: string };
  branding: SnapshotBranding;
  kpis: Record<ReportKpiId, KpiEntry>;
  follower_trend: FollowerTrendPoint[];
  content_breakdown: ContentBreakdown;
  top_posts: SnapshotTopPost[];
  audience: AudienceData | null;
  best_times: BestTimeSlot[];
  tags_performance: TagPerformance[];
}

export interface SnapshotPostRow {
  media_type: string | null;
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

export interface SnapshotInput {
  month: string;
  account: { handle: string; specialty: string };
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

export function assembleSnapshot(input: SnapshotInput): ReportDocSnapshot {
  const w = monthWindow(input.month);

  const breakdown: ContentBreakdown = {};
  for (const p of input.posts) {
    const key = postType(p.media_type) === "reel"
      ? "reels"
      : postType(p.media_type) === "carousel"
      ? "carousels"
      : "images";
    const bucket = breakdown[key] ?? { count: 0, avg_reach: 0, avg_engagement: 0 };
    // avg_* acumulam somas aqui e viram médias no fim.
    bucket.count += 1;
    bucket.avg_reach += p.reach ?? 0;
    bucket.avg_engagement += (p.likes ?? 0) + (p.comments ?? 0) + (p.saved ?? 0);
    breakdown[key] = bucket;
  }
  for (const key of ["reels", "carousels", "images"] as const) {
    const b = breakdown[key];
    if (b && b.count > 0) {
      b.avg_reach = Math.round(b.avg_reach / b.count);
      b.avg_engagement = Math.round(b.avg_engagement / b.count);
    }
  }

  const topPosts = [...input.posts]
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))
    .slice(0, MAX_SNAPSHOT_POSTS)
    .map((p): SnapshotTopPost => ({
      type: postType(p.media_type),
      reach: p.reach ?? 0,
      likes: p.likes ?? 0,
      comments: p.comments ?? 0,
      saves: p.saved ?? 0,
      caption_preview: (p.caption ?? "").slice(0, CAPTION_PREVIEW_MAX),
      date: p.posted_at,
      permalink: p.permalink,
      thumbnail_url: stableThumb(p.thumbnail_url, input.stableThumbnails),
    }));

  return {
    version: 1,
    period: { month: w.month, label: w.label, start: w.start, endExclusive: w.endExclusive },
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
