// Daily per-video history for TikTok. importTikTokVideos (video.list) and
// refreshStoredPostMetrics (video.query) both persist current counts to tiktok_posts and then
// call recordVideoSnapshots, so every count write also lands today's tiktok_post_metrics_daily
// row (spec A1 "one write path for video counts"). Keyed by the TikTok video id, not an FK to
// tiktok_posts, so the history survives a disconnect/reconnect.

import { saoPauloDate } from "./sao-paulo-date.ts";

// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any };

export interface VideoCounts {
  tiktok_video_id: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

/**
 * Upserts today's (São Paulo date) tiktok_post_metrics_daily row for each video. A snapshot is
 * history on top of a count write that already succeeded, so this never throws: a failure is
 * logged and the result is 0. Returns the number of rows written.
 */
export async function recordVideoSnapshots(
  svc: DbClient,
  accountId: string,
  rows: VideoCounts[],
  now: Date = new Date(),
): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    const snapshotDate = saoPauloDate(now);
    // One upsert statement cannot touch the same key twice; the last entry for a video wins.
    const byVideo = new Map<string, VideoCounts>();
    for (const r of rows) byVideo.set(r.tiktok_video_id, r);

    const payload = [...byVideo.values()].map((r) => ({
      tiktok_account_id: accountId,
      tiktok_video_id: r.tiktok_video_id,
      snapshot_date: snapshotDate,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
    }));
    const { error } = await svc
      .from("tiktok_post_metrics_daily")
      .upsert(payload, { onConflict: "tiktok_account_id,tiktok_video_id,snapshot_date" });
    if (error) {
      console.error("[tiktok-video-metrics] snapshot upsert failed:", (error as { message?: string }).message);
      return 0;
    }
    return payload.length;
  } catch (e) {
    console.error("[tiktok-video-metrics] snapshot upsert threw:", (e as Error)?.message);
    return 0;
  }
}
