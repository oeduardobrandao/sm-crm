// One YouTube channel's sync, shared by youtube-sync-cron and the manual sync route
// (google-integration POST /sync/youtube/:clientId). Spec §5.1 / §5.3 / §4.6; Phase 2 plan
// Task 7 and the "Shared sync semantics" of its Global Constraints.
//
// Steps, each persisting before the next network call (spec §5.3):
//   1. Token: getFreshGoogleToken. REVOKED -> `revoked` (the RPC already purged; the caller marks
//      the connection so sibling channels skip their token call). TOKEN_INVALID / NOT_FOUND ->
//      `skipped` (re-auth needed; logged once, never a cron failure).
//   2. Channel info: channels.list -> cached counts, title, handle, avatar. A different channel id
//      (or none) -> `mismatch`: nothing written, the connection is NOT considered revoked.
//   3. Videos: uploads playlist newest-first until a stored id (1,000 ids max), then videos.list
//      for the new ids + stored videos of the last 90 days + the 200 most recent + the rotating
//      batch whose metadata is older than 25 days (§4.6's 30-day refresh). Requested ids the API
//      did not return are deleted with their daily rows.
//   4. Analytics (Pacific days, stored as returned): channel daily (all, then by content type),
//      traffic, the 28-day demographics snapshot (replaced), per-video daily (capped per run, P7).
//   5. last_synced_at.
// Quota (QUOTA_EXCEEDED, or NOT_APPROVED per P6) in steps 2-3 jumps to step 4; in step 4 it stops
// the remaining Analytics calls. Either way the outcome is `quota_skipped` with no last_synced_at.
//
// Write guard (review C2): every write is preceded, in the same step, by
// `UPDATE youtube_channels ... WHERE id = ? AND authorization_status = 'active'`. Zero rows means
// google_mark_revoked's purge (or an unlink) won the race: stop with `revoked`, write nothing else.
// Every history read, write and delete carries the channel's conta_id (Review Focus 3).

import { type DbClient, GoogleApiError } from "./google.ts";
import type * as YoutubeApiModule from "./youtube-api.ts";
import type { DateRange, YtChannelDailyRow, YtContentType, YtVideo } from "./youtube-api.ts";

/** P7: per-video daily reports per channel per run. */
export const MAX_VIDEO_REPORTS_PER_RUN = 40;

const BACKFILL_DAYS = 365;
const OVERLAP_DAYS = 7;
const DEMOGRAPHICS_DAYS = 28;
const VIDEO_WINDOW_DAYS = 90;
const RECENT_VIDEOS = 200;
const METADATA_REFRESH_DAYS = 25;
const ROTATING_BATCH = 50;
const MAX_UPLOAD_IDS = 1000;
const VIDEOS_PER_CALL = 50;
const CONTENT_TYPES_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `youtube_channels` columns the sync reads. The table holds no tokens (they live on
 * google_connections and are read only through getFreshGoogleToken). */
export const YOUTUBE_CHANNEL_SYNC_COLUMNS =
  "id, conta_id, client_id, connection_id, channel_id, title, handle, avatar_url, uploads_playlist_id, " +
  "subscriber_count, view_count, video_count, authorization_status, last_synced_at, last_sync_attempt_at, " +
  "data_through, content_type_through, traffic_through, videos_through";

export interface YoutubeChannelRow {
  id: string;
  conta_id: string;
  client_id: number;
  connection_id: string;
  channel_id: string;
  title: string | null;
  handle: string | null;
  avatar_url: string | null;
  uploads_playlist_id: string | null;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
  authorization_status: string;
  last_synced_at: string | null;
  last_sync_attempt_at: string | null;
  data_through: string | null;
  content_type_through: string | null;
  traffic_through: string | null;
  videos_through: string | null;
}

export type YoutubeApi = Pick<
  typeof YoutubeApiModule,
  | "getMyChannel"
  | "listUploads"
  | "getVideos"
  | "channelDaily"
  | "trafficDaily"
  | "demographics"
  | "videoDaily"
  | "videoContentTypes"
>;

export interface YoutubeSyncDeps {
  svc: DbClient;
  api: YoutubeApi;
  getFreshGoogleToken: (svc: DbClient, connectionId: string) => Promise<string>;
  /** Timestamps written (last_synced_at, metadata_refreshed_at). Day windows use opts.now. */
  now: () => Date;
}

export type YoutubeSyncStatus = "synced" | "revoked" | "quota_skipped" | "skipped" | "mismatch";

export interface YoutubeSyncOutcome {
  status: YoutubeSyncStatus;
  /** The run started from data_through = null (365-day window). */
  backfill: boolean;
  /** Set only when getFreshGoogleToken said REVOKED: the whole connection is dead, so the cron
   * skips every other channel on it. A guard miss (one unit revoked/unlinked) does not set it. */
  connectionRevoked?: true;
}

// --- Dates (Pacific days, YYYY-MM-DD, arithmetic in UTC so DST never moves a day) ---

const PACIFIC = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function pacificDate(now: Date): string {
  return PACIFIC.format(now);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function laterDay(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function earlierDay(a: string, b: string): string {
  return a < b ? a : b;
}

// --- Errors / control flow ---

/** The write guard updated zero rows: the unit was revoked or unlinked mid-run. */
class UnitGone extends Error {}

function isQuota(err: unknown): boolean {
  return err instanceof GoogleApiError && (err.code === "QUOTA_EXCEEDED" || err.code === "NOT_APPROVED");
}

function dbError(what: string, error: { message?: string }): Error {
  return new Error(`youtube-sync: ${what} failed: ${error.message ?? "unknown"}`);
}

interface Ctx {
  deps: YoutubeSyncDeps;
  channel: YoutubeChannelRow;
  token: string;
  now: Date;
  maxVideoReports: number;
  uploadsPlaylistId: string | null;
}

/** Runs the guarded channel update (optionally carrying a patch). Throws UnitGone on 0 rows. */
async function guard(ctx: Ctx, patch: Record<string, unknown> = {}): Promise<void> {
  const { data, error } = await ctx.deps.svc
    .from("youtube_channels")
    .update({ ...patch, updated_at: ctx.deps.now().toISOString() })
    .eq("id", ctx.channel.id)
    .eq("conta_id", ctx.channel.conta_id)
    .eq("authorization_status", "active")
    .select("id");
  if (error) throw dbError("channel update", error);
  if (!Array.isArray(data) || data.length === 0) throw new UnitGone();
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// --- Step 2 ---

/** Returns false on a channel-id mismatch (nothing written). */
async function syncChannelInfo(ctx: Ctx): Promise<boolean> {
  const { channel } = ctx;
  const info = await ctx.deps.api.getMyChannel(ctx.token);
  if (!info || info.id !== channel.channel_id) {
    console.error(
      `[youtube-sync] channel row ${channel.id}: token's channel ${info?.id ?? "(none)"} != stored ${channel.channel_id}; skipped`,
    );
    return false;
  }
  const patch: Record<string, unknown> = {};
  if (info.title !== null) patch.title = info.title;
  if (info.handle !== null) patch.handle = info.handle;
  if (info.avatarUrl !== null) patch.avatar_url = info.avatarUrl;
  if (info.uploadsPlaylistId !== null) patch.uploads_playlist_id = info.uploadsPlaylistId;
  // A hidden (null) subscriber count never overwrites the stored value.
  if (info.subscriberCount !== null) patch.subscriber_count = info.subscriberCount;
  if (info.viewCount !== null) patch.view_count = info.viewCount;
  if (info.videoCount !== null) patch.video_count = info.videoCount;
  await guard(ctx, patch);
  ctx.uploadsPlaylistId = info.uploadsPlaylistId ?? channel.uploads_playlist_id;
  return true;
}

// --- Step 3 ---

function history(ctx: Ctx, table: string) {
  return ctx.deps.svc.from(table);
}

async function knownVideoIds(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await history(ctx, "youtube_videos")
    .select("video_id")
    .eq("conta_id", ctx.channel.conta_id)
    .eq("channel_id", ctx.channel.channel_id)
    .in("video_id", ids);
  if (error) throw dbError("known videos read", error);
  return new Set(((data ?? []) as { video_id: string }[]).map((r) => r.video_id));
}

/** New upload ids, newest first, stopping at the first stored id (1,000 ids at most). */
async function listNewUploads(ctx: Ctx): Promise<string[]> {
  const playlistId = ctx.uploadsPlaylistId;
  if (!playlistId) return [];
  const seen = new Set<string>();
  const fresh: string[] = [];
  let pageToken: string | null = null;
  while (seen.size < MAX_UPLOAD_IDS) {
    let page: { videoIds: string[]; nextPageToken: string | null };
    try {
      page = await ctx.deps.api.listUploads(ctx.token, playlistId, pageToken ? { pageToken } : {});
    } catch (err) {
      // YouTube answers 404 playlistNotFound for the uploads playlist of a channel with no uploads.
      if (err instanceof GoogleApiError && err.code === "NOT_FOUND") break;
      throw err;
    }
    const ids = page.videoIds.filter((id) => !seen.has(id)).slice(0, MAX_UPLOAD_IDS - seen.size);
    for (const id of ids) seen.add(id);
    const known = await knownVideoIds(ctx, ids);
    for (const id of ids) if (!known.has(id)) fresh.push(id);
    if (known.size > 0 || !page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return fresh;
}

interface StoredVideoFlag {
  video_id: string;
  is_short: boolean | null;
}

async function storedVideosToRefresh(ctx: Ctx): Promise<StoredVideoFlag[]> {
  const { channel, now } = ctx;
  const cutoff90 = new Date(now.getTime() - VIDEO_WINDOW_DAYS * DAY_MS).toISOString();
  const cutoff25 = new Date(now.getTime() - METADATA_REFRESH_DAYS * DAY_MS).toISOString();
  const base = () =>
    history(ctx, "youtube_videos")
      .select("video_id, is_short")
      .eq("conta_id", channel.conta_id)
      .eq("channel_id", channel.channel_id);

  const recent90 = await base().gte("published_at", cutoff90);
  if (recent90.error) throw dbError("recent videos read", recent90.error);
  const latest = await base().order("published_at", { ascending: false, nullsFirst: false }).limit(RECENT_VIDEOS);
  if (latest.error) throw dbError("latest videos read", latest.error);
  const rotating = await base()
    .or(`metadata_refreshed_at.is.null,metadata_refreshed_at.lt.${cutoff25}`)
    .order("metadata_refreshed_at", { ascending: true, nullsFirst: true })
    .limit(ROTATING_BATCH);
  if (rotating.error) throw dbError("rotating videos read", rotating.error);

  return [
    ...(recent90.data ?? []),
    ...(latest.data ?? []),
    ...(rotating.data ?? []),
  ] as StoredVideoFlag[];
}

function shouldRefreshContentTypes(channel: YoutubeChannelRow, now: Date): boolean {
  if (!channel.last_synced_at) return true;
  const last = Date.parse(channel.last_synced_at);
  return Number.isNaN(last) || now.getTime() - last >= CONTENT_TYPES_MIN_INTERVAL_MS;
}

/**
 * is_short: the content-type report when it lists the video; live/upcoming or zero-duration
 * videos are never shorts by duration; when the report was not refreshed this run, a stored value
 * is kept; otherwise the duration fallback (S2).
 */
function classifyShort(
  video: YtVideo,
  types: Map<string, YtContentType> | null | undefined,
  stored: Map<string, boolean | null>,
): boolean {
  const reported = types?.get(video.id);
  if (reported) return reported === "shorts";
  if ((video.liveBroadcastContent !== null && video.liveBroadcastContent !== "none") || video.durationS === 0) {
    return false;
  }
  if (types === undefined) {
    const kept = stored.get(video.id);
    if (kept !== undefined && kept !== null) return kept;
  }
  return video.isShortByDuration;
}

async function syncVideos(ctx: Ctx): Promise<void> {
  const { channel, deps } = ctx;
  const fresh = await listNewUploads(ctx);
  const stored = await storedVideosToRefresh(ctx);
  const storedShort = new Map<string, boolean | null>();
  for (const v of stored) storedShort.set(v.video_id, v.is_short);
  const requested = [...new Set([...fresh, ...stored.map((v) => v.video_id)])];
  if (requested.length === 0) return;

  const today = pacificDate(ctx.now);
  let types: Map<string, YtContentType> | null | undefined = undefined;
  if (shouldRefreshContentTypes(channel, ctx.now)) {
    types = await deps.api.videoContentTypes(ctx.token, {
      start: addDays(today, -BACKFILL_DAYS),
      end: addDays(today, -1),
    });
  }

  for (const ids of chunks(requested, VIDEOS_PER_CALL)) {
    const videos = await deps.api.getVideos(ctx.token, ids);
    await guard(ctx);
    const refreshedAt = deps.now().toISOString();
    if (videos.length > 0) {
      const rows = videos.map((v) => ({
        conta_id: channel.conta_id,
        channel_id: channel.channel_id,
        video_id: v.id,
        title: v.title,
        published_at: v.publishedAt,
        duration_s: v.durationS,
        is_short: classifyShort(v, types, storedShort),
        thumbnail_url: v.thumbnailUrl,
        view_count: v.viewCount,
        like_count: v.likeCount,
        comment_count: v.commentCount,
        metadata_refreshed_at: refreshedAt,
      }));
      const { error } = await history(ctx, "youtube_videos").upsert(rows, {
        onConflict: "conta_id,channel_id,video_id",
      });
      if (error) throw dbError("videos upsert", error);
    }
    const returned = new Set(videos.map((v) => v.id));
    const missing = ids.filter((id) => !returned.has(id));
    if (missing.length > 0) {
      // Deleted or private at YouTube (§4.6): drop the metadata and its daily history.
      for (const table of ["youtube_video_daily", "youtube_videos"]) {
        const { error } = await history(ctx, table)
          .delete()
          .eq("conta_id", channel.conta_id)
          .eq("channel_id", channel.channel_id)
          .in("video_id", missing);
        if (error) throw dbError(`${table} delete`, error);
      }
    }
  }
}

// --- Step 4 ---

function channelDailyRows(ctx: Ctx, rows: YtChannelDailyRow[], contentType: (r: YtChannelDailyRow) => string) {
  return rows.map((r) => ({
    conta_id: ctx.channel.conta_id,
    channel_id: ctx.channel.channel_id,
    day: r.day,
    content_type: contentType(r),
    views: r.views,
    engaged_views: r.engagedViews,
    estimated_minutes_watched: r.estimatedMinutesWatched,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
    subscribers_gained: r.subscribersGained,
    subscribers_lost: r.subscribersLost,
    average_view_duration_s: r.averageViewDuration,
  }));
}

async function upsertRows(ctx: Ctx, table: string, rows: Record<string, unknown>[], onConflict: string) {
  if (rows.length === 0) return;
  const { error } = await history(ctx, table).upsert(rows, { onConflict });
  if (error) throw dbError(`${table} upsert`, error);
}

interface LaggingVideo {
  video_id: string;
  daily_through: string | null;
  published_at: string | null;
}

async function syncAnalytics(ctx: Ctx): Promise<void> {
  const { channel, deps, token } = ctx;
  const today = pacificDate(ctx.now);
  const yesterday = addDays(today, -1);
  let start = channel.data_through ? addDays(channel.data_through, -OVERLAP_DAYS) : addDays(today, -BACKFILL_DAYS);
  if (start > yesterday) start = yesterday;
  const range: DateRange = { start, end: yesterday };

  // Channel daily, all content. data_through = last returned day, never backwards.
  const allRows = await deps.api.channelDaily(token, range, false);
  let dataThrough = channel.data_through;
  if (allRows.length > 0) {
    await guard(ctx);
    await upsertRows(ctx, "youtube_channel_daily", channelDailyRows(ctx, allRows, () => "all"), "conta_id,channel_id,day,content_type");
    const lastDay = allRows.reduce((max, r) => (r.day > max ? r.day : max), allRows[0].day);
    const next = laterDay(channel.data_through, lastDay);
    if (next !== channel.data_through) {
      await guard(ctx, { data_through: next });
      dataThrough = next;
    }
  }
  // Split watermarks = min(window end, data_through as set in this run).
  const splitThrough = dataThrough ? earlierDay(yesterday, dataThrough) : null;

  // Channel daily by content type. A 400 (dimension unsupported, spike S2) means "no split".
  let split: YtChannelDailyRow[] | null = null;
  try {
    split = await deps.api.channelDaily(token, range, true);
  } catch (err) {
    if (!(err instanceof GoogleApiError && err.status === 400)) throw err;
    console.warn(`[youtube-sync] channel row ${channel.id}: content-type split unavailable (400)`);
  }
  if (split) {
    await guard(ctx);
    await upsertRows(
      ctx,
      "youtube_channel_daily",
      // channelDaily(…, true) already drops rows of an unknown type, so contentType is set.
      channelDailyRows(ctx, split.filter((r) => r.contentType !== null), (r) => r.contentType as string),
      "conta_id,channel_id,day,content_type",
    );
    // Zero rows is a success: a channel with no Shorts shows zeros, not "sem dados".
    if (splitThrough) await guard(ctx, { content_type_through: splitThrough });
  }

  // Traffic sources.
  const traffic = await deps.api.trafficDaily(token, range);
  await guard(ctx);
  await upsertRows(
    ctx,
    "youtube_traffic_daily",
    traffic.map((r) => ({
      conta_id: channel.conta_id,
      channel_id: channel.channel_id,
      day: r.day,
      source_type: r.source,
      views: r.views,
    })),
    "conta_id,channel_id,day,source_type",
  );
  if (splitThrough) await guard(ctx, { traffic_through: splitThrough });

  // Demographics: one 28-day snapshot per channel, replaced.
  const demo = await deps.api.demographics(token, { start: addDays(yesterday, -(DEMOGRAPHICS_DAYS - 1)), end: yesterday });
  await guard(ctx);
  {
    const { error } = await history(ctx, "youtube_demographics")
      .delete()
      .eq("conta_id", channel.conta_id)
      .eq("channel_id", channel.channel_id);
    if (error) throw dbError("demographics delete", error);
  }
  if (demo.length > 0) {
    const { error } = await history(ctx, "youtube_demographics").insert(
      demo.map((r) => ({
        conta_id: channel.conta_id,
        channel_id: channel.channel_id,
        window_end: yesterday,
        age_group: r.ageGroup,
        gender: r.gender,
        viewer_pct: r.viewerPercentage,
      })),
    );
    if (error) throw dbError("demographics insert", error);
  }

  // Per-video daily: videos published in the last 90 days whose daily_through lags data_through.
  if (!dataThrough || !splitThrough) return;
  const cutoff90 = new Date(ctx.now.getTime() - VIDEO_WINDOW_DAYS * DAY_MS).toISOString();
  const { data, error } = await history(ctx, "youtube_videos")
    .select("video_id, daily_through, published_at")
    .eq("conta_id", channel.conta_id)
    .eq("channel_id", channel.channel_id)
    .gte("published_at", cutoff90)
    .order("published_at", { ascending: false });
  if (error) throw dbError("lagging videos read", error);
  const lagging = ((data ?? []) as LaggingVideo[])
    .filter((v) => !v.daily_through || v.daily_through < dataThrough)
    // Never-reported first, then the most behind; ties keep newest-published first (stable sort).
    .sort((a, b) => (a.daily_through ?? "") < (b.daily_through ?? "") ? -1 : (a.daily_through ?? "") > (b.daily_through ?? "") ? 1 : 0);

  const batch = lagging.slice(0, Math.max(0, ctx.maxVideoReports));
  for (const video of batch) {
    const vStart = video.daily_through
      ? addDays(video.daily_through, -OVERLAP_DAYS)
      : addDays(today, -VIDEO_WINDOW_DAYS);
    const rows = await deps.api.videoDaily(token, video.video_id, { start: vStart, end: yesterday });
    await guard(ctx);
    await upsertRows(
      ctx,
      "youtube_video_daily",
      rows.map((r) => ({
        conta_id: channel.conta_id,
        channel_id: channel.channel_id,
        video_id: video.video_id,
        day: r.day,
        views: r.views,
        engaged_views: r.engagedViews,
        likes: r.likes,
        comments: r.comments,
        shares: r.shares,
        subscribers_gained: r.subscribersGained,
        average_view_duration_s: r.averageViewDuration,
        average_view_percentage: r.averageViewPercentage,
      })),
      "conta_id,channel_id,video_id,day",
    );
    const { error: advanceError } = await history(ctx, "youtube_videos")
      .update({ daily_through: splitThrough })
      .eq("conta_id", channel.conta_id)
      .eq("channel_id", channel.channel_id)
      .eq("video_id", video.video_id);
    if (advanceError) throw dbError("video daily_through update", advanceError);
  }
  if (lagging.length <= batch.length) await guard(ctx, { videos_through: splitThrough });
}

// --- Entry point ---

/**
 * Syncs one channel. Returns an outcome for every expected condition (revoked, re-auth needed,
 * quota, mismatch); throws only for unexpected failures, which the cron counts as `failed`.
 */
export async function syncYouTubeChannel(
  deps: YoutubeSyncDeps,
  channel: YoutubeChannelRow,
  opts: { now: Date; maxVideoReports: number },
): Promise<YoutubeSyncOutcome> {
  const backfill = channel.data_through === null;

  let token: string;
  try {
    token = await deps.getFreshGoogleToken(deps.svc, channel.connection_id);
  } catch (err) {
    if (err instanceof GoogleApiError) {
      if (err.code === "REVOKED") return { status: "revoked", backfill, connectionRevoked: true };
      if (err.code === "TOKEN_INVALID" || err.code === "NOT_FOUND") {
        console.error(`[youtube-sync] channel row ${channel.id}: token unavailable (${err.code}); skipped`);
        return { status: "skipped", backfill };
      }
    }
    throw err;
  }

  const ctx: Ctx = {
    deps,
    channel,
    token,
    now: opts.now,
    maxVideoReports: opts.maxVideoReports,
    uploadsPlaylistId: channel.uploads_playlist_id,
  };

  try {
    let quotaHit = false;
    try {
      if (!(await syncChannelInfo(ctx))) return { status: "mismatch", backfill };
      await syncVideos(ctx);
    } catch (err) {
      if (!isQuota(err)) throw err;
      quotaHit = true;
      console.warn(`[youtube-sync] channel row ${channel.id}: Data API quota; skipping to analytics`);
    }
    try {
      await syncAnalytics(ctx);
    } catch (err) {
      if (!isQuota(err)) throw err;
      quotaHit = true;
      console.warn(`[youtube-sync] channel row ${channel.id}: Analytics quota; remaining reports skipped`);
    }
    if (quotaHit) return { status: "quota_skipped", backfill };

    await guard(ctx, { last_synced_at: deps.now().toISOString() });
    return { status: "synced", backfill };
  } catch (err) {
    if (err instanceof UnitGone) return { status: "revoked", backfill };
    if (err instanceof GoogleApiError && err.code === "TOKEN_INVALID") {
      console.error(`[youtube-sync] channel row ${channel.id}: token rejected mid-run; skipped`);
      return { status: "skipped", backfill };
    }
    throw err;
  }
}
