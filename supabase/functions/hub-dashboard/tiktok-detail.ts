// TikTok detail of the Hub dashboard (ranked videos, per-day views) and platform resolution.
import { videoEngagementRate } from "../_shared/tiktok-analytics/kpis.ts";
import type { TikTokVideoDetailRow } from "../_shared/tiktok-analytics/queries.ts";
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";

export interface DashboardTopVideo {
  id: string;
  coverUrl: string | null;
  shareUrl: string | null;
  postedAt: string | null;
  durationSeconds: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** One decimal. */
  engagementRate: number | null;
}

const TOP_VIDEOS = 5;

/** Views > 0, most viewed first, ties newest first, at most five. */
export function topVideos(videos: TikTokVideoDetailRow[]): DashboardTopVideo[] {
  return videos
    .filter((v) => (v.views || 0) > 0)
    .sort((a, b) => (b.views || 0) - (a.views || 0) || (b.posted_at ?? "").localeCompare(a.posted_at ?? ""))
    .slice(0, TOP_VIDEOS)
    .map((v) => {
      const rate = videoEngagementRate(v);
      return {
        id: v.tiktok_video_id,
        coverUrl: v.cover_image_url ?? null,
        shareUrl: v.share_url ?? null,
        postedAt: v.posted_at ?? null,
        durationSeconds: v.duration ?? null,
        views: v.views || 0,
        likes: v.likes || 0,
        comments: v.comments || 0,
        shares: v.shares || 0,
        engagementRate: rate === null ? null : Math.round(rate * 10) / 10,
      };
    });
}

/** Views summed by São Paulo posting day, ascending. Videos without a posting date are skipped. */
export function viewsHistory(videos: TikTokVideoDetailRow[]): { date: string; views: number }[] {
  const byDay = new Map<string, number>();
  for (const v of videos) {
    if (!v.posted_at) continue;
    const day = saoPauloDate(new Date(v.posted_at));
    byDay.set(day, (byDay.get(day) ?? 0) + (v.views || 0));
  }
  return [...byDay.entries()].map(([date, views]) => ({ date, views })).sort((a, b) => a.date.localeCompare(b.date));
}

export function resolvePlatform(
  requested: string | null,
  accounts: { platform: "instagram" | "tiktok" }[],
): "instagram" | "tiktok" {
  if (requested === "instagram" || requested === "tiktok") return requested;
  return accounts[0]?.platform ?? "instagram";
}
