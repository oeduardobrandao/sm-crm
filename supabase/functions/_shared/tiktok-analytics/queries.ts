// TikTok analytics reads, shared by the tiktok-analytics function and the report snapshot loader
// (report-docs). Every function takes a service-role client: tiktok_account_metrics_daily and
// tiktok_post_metrics_daily are service-role only, and the caller has already confirmed the
// workspace owns the client. Query errors throw; callers answer a generic 500.
import { saoPauloDate } from "../sao-paulo-date.ts";
import type { KpiEntry } from "../report-docs/kpis.ts";
import { type AnalyticsWindow, spDayEndExclusiveIso, spDayStartIso } from "./window.ts";
import { computeTikTokKpis, type TikTokKpiId, type TikTokVideoRow, videoEngagementRate } from "./kpis.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface TikTokAccountRow {
  id: string;
  client_id: number;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number | null;
  likes_count: number | null;
  video_count: number | null;
  authorization_status: string;
  last_synced_at: string | null;
}

/** Explicit allowlist: the encrypted token columns never leave the database. */
export const TIKTOK_ACCOUNT_COLUMNS =
  "id, client_id, username, display_name, avatar_url, follower_count, likes_count, video_count, authorization_status, last_synced_at";

export interface TikTokVideoDetailRow extends TikTokVideoRow {
  title: string | null;
  video_description: string | null;
  duration: number | null;
  share_url: string | null;
  cover_image_url: string | null;
}

const VIDEO_COLUMNS =
  "tiktok_video_id, posted_at, views, likes, comments, shares, title, video_description, duration, share_url, cover_image_url";

export interface FollowerHistoryRow {
  date: string;
  follower_count: number;
  source: string;
}

export interface TikTokOverview {
  account: Pick<
    TikTokAccountRow,
    "username" | "display_name" | "avatar_url" | "authorization_status" | "last_synced_at" | "follower_count"
  >;
  window: AnalyticsWindow;
  kpis: Record<TikTokKpiId, KpiEntry>;
}

/** PostgREST caps a response at 1000 rows; long windows and multi-account reads go past it. */
const PAGE_SIZE = 1000;

// deno-lint-ignore no-explicit-any
async function selectAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0;; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

export async function loadTikTokAccount(db: Db, clientId: number): Promise<TikTokAccountRow | null> {
  const { data, error } = await db.from("tiktok_accounts").select(TIKTOK_ACCOUNT_COLUMNS).eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return (data as TikTokAccountRow | null) ?? null;
}

/** Videos posted in the inclusive São Paulo window [startDate, endDate], newest first. */
export async function loadVideosInWindow(
  db: Db,
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<TikTokVideoDetailRow[]> {
  return await selectAllPages<TikTokVideoDetailRow>((from, to) =>
    db.from("tiktok_posts").select(VIDEO_COLUMNS)
      .eq("tiktok_account_id", accountId)
      .gte("posted_at", spDayStartIso(startDate))
      .lt("posted_at", spDayEndExclusiveIso(endDate))
      .order("posted_at", { ascending: false })
      .order("tiktok_video_id", { ascending: true })
      .range(from, to)
  );
}

/** Observed follower points with `date` in [startDate, endDate] (a real date column), oldest first. */
export async function loadFollowerHistory(
  db: Db,
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<FollowerHistoryRow[]> {
  return await selectAllPages<FollowerHistoryRow>((from, to) =>
    db.from("tiktok_follower_history").select("date, follower_count, source")
      .eq("tiktok_account_id", accountId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true })
      .range(from, to)
  );
}

export async function buildOverview(db: Db, account: TikTokAccountRow, w: AnalyticsWindow, now: Date): Promise<TikTokOverview> {
  // Fixed order (window, previous window) per table: the handler tests queue mock rows in it.
  const [videos, prevVideos, history, prevHistory] = await Promise.all([
    loadVideosInWindow(db, account.id, w.start, w.end),
    loadVideosInWindow(db, account.id, w.prevStart, w.prevEnd),
    loadFollowerHistory(db, account.id, w.start, w.end),
    loadFollowerHistory(db, account.id, w.prevStart, w.prevEnd),
  ]);
  // The live count stands in only for a window ending on SP today that has no observed point yet.
  const windowEndsToday = w.end === saoPauloDate(now) && !history.some((p) => p.date === w.end);
  return {
    account: {
      username: account.username,
      display_name: account.display_name,
      avatar_url: account.avatar_url,
      authorization_status: account.authorization_status,
      last_synced_at: account.last_synced_at,
      follower_count: account.follower_count,
    },
    window: w,
    kpis: computeTikTokKpis({
      videos,
      prevVideos,
      history,
      prevHistory,
      currentFollowers: account.follower_count,
      windowEndsToday,
      likesTotal: account.likes_count,
    }),
  };
}

// ─── Portfolio (every connected account of a workspace) ─────────────────────────────

export interface PortfolioRow {
  client_id: number;
  client_name: string;
  especialidade: string | null;
  username: string | null;
  avatar_url: string | null;
  authorization_status: string;
  follower_count: number | null;
  followers_gained: number | null;
  views: number;
  engagement_rate: number | null;
  posts_count: number;
  last_posted_at: string | null;
}

export interface PortfolioVideo {
  client_id: number;
  client_name: string;
  tiktok_video_id: string;
  title: string | null;
  cover_image_url: string | null;
  share_url: string | null;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  engagement_rate: number | null;
}

export interface TikTokPortfolio {
  window: AnalyticsWindow;
  totals: { accounts: number; followers: number; views: number; engagement_rate: number | null; posts_count: number };
  accounts: PortfolioRow[];
  topVideos: PortfolioVideo[];
  bottomVideos: PortfolioVideo[];
}

const RANKED_VIDEOS = 5;
/** "Precisam de atenção" skips videos that have not had two days to collect views. */
const MIN_AGE_FOR_BOTTOM_MS = 48 * 3600 * 1000;
const NOT_CONNECTED = new Set(["disconnected", "revoked"]);

type PortfolioVideoRow = TikTokVideoDetailRow & { tiktok_account_id: string };
type PortfolioHistoryRow = { tiktok_account_id: string; date: string; follower_count: number };

const sumOf = (rows: TikTokVideoRow[], key: "views" | "likes" | "comments" | "shares") =>
  rows.reduce((acc, v) => acc + (v[key] || 0), 0);

/** Ratio of sums, the same definition as the Engajamento KPI; null on zero views. */
function ratioOfSums(rows: TikTokVideoRow[]): number | null {
  const views = sumOf(rows, "views");
  if (views <= 0) return null;
  return ((sumOf(rows, "likes") + sumOf(rows, "comments") + sumOf(rows, "shares")) / views) * 100;
}

/** Per-account rows, totals and ranked videos for the active clients of `contaId` with a
 * connected TikTok (expired accounts included, flagged by their status). */
export async function buildPortfolio(db: Db, contaId: string, w: AnalyticsWindow, now: Date): Promise<TikTokPortfolio> {
  const empty: TikTokPortfolio = {
    window: w,
    totals: { accounts: 0, followers: 0, views: 0, engagement_rate: null, posts_count: 0 },
    accounts: [],
    topVideos: [],
    bottomVideos: [],
  };

  const { data: clients, error: clientsError } = await db.from("clientes").select("id, nome, especialidade")
    .eq("conta_id", contaId).eq("status", "ativo");
  if (clientsError) throw clientsError;
  const clientList = (clients ?? []) as { id: number; nome: string | null; especialidade: string | null }[];
  if (clientList.length === 0) return empty;

  const { data: accountData, error: accountsError } = await db.from("tiktok_accounts").select(TIKTOK_ACCOUNT_COLUMNS)
    .in("client_id", clientList.map((c) => c.id));
  if (accountsError) throw accountsError;
  const accounts = ((accountData ?? []) as TikTokAccountRow[]).filter((a) => !NOT_CONNECTED.has(a.authorization_status));
  if (accounts.length === 0) return empty;

  const accountIds = accounts.map((a) => a.id);
  const [videos, history] = await Promise.all([
    selectAllPages<PortfolioVideoRow>((from, to) =>
      db.from("tiktok_posts").select(`tiktok_account_id, ${VIDEO_COLUMNS}`)
        .in("tiktok_account_id", accountIds)
        .gte("posted_at", spDayStartIso(w.start))
        .lt("posted_at", spDayEndExclusiveIso(w.end))
        .order("posted_at", { ascending: false })
        .order("tiktok_video_id", { ascending: true })
        .range(from, to)
    ),
    selectAllPages<PortfolioHistoryRow>((from, to) =>
      db.from("tiktok_follower_history").select("tiktok_account_id, date, follower_count")
        .in("tiktok_account_id", accountIds)
        .gte("date", w.start)
        .lte("date", w.end)
        .order("tiktok_account_id", { ascending: true })
        .order("date", { ascending: true })
        .range(from, to)
    ),
  ]);

  const clientById = new Map(clientList.map((c) => [c.id, c]));
  const videosByAccount = new Map<string, PortfolioVideoRow[]>();
  for (const v of videos) {
    const list = videosByAccount.get(v.tiktok_account_id) ?? [];
    list.push(v);
    videosByAccount.set(v.tiktok_account_id, list);
  }
  const historyByAccount = new Map<string, PortfolioHistoryRow[]>();
  for (const p of history) {
    const list = historyByAccount.get(p.tiktok_account_id) ?? [];
    list.push(p);
    historyByAccount.set(p.tiktok_account_id, list);
  }

  const rows: PortfolioRow[] = accounts.map((a) => {
    const own = videosByAccount.get(a.id) ?? [];
    const points = [...(historyByAccount.get(a.id) ?? [])].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const lastPosted = own.reduce<string | null>(
      (latest, v) => (v.posted_at && (!latest || v.posted_at > latest) ? v.posted_at : latest),
      null,
    );
    return {
      client_id: a.client_id,
      client_name: clientById.get(a.client_id)?.nome ?? "",
      especialidade: clientById.get(a.client_id)?.especialidade ?? null,
      username: a.username,
      avatar_url: a.avatar_url,
      authorization_status: a.authorization_status,
      follower_count: a.follower_count,
      // Observed points only, like the Novos seguidores KPI: fewer than two is "sem dados".
      followers_gained: points.length >= 2 ? points[points.length - 1].follower_count - points[0].follower_count : null,
      views: sumOf(own, "views"),
      engagement_rate: ratioOfSums(own),
      posts_count: own.length,
      last_posted_at: lastPosted,
    };
  });

  const clientIdByAccount = new Map(accounts.map((a) => [a.id, a.client_id]));
  const toPortfolioVideo = (v: PortfolioVideoRow): PortfolioVideo => {
    const clientId = clientIdByAccount.get(v.tiktok_account_id) as number;
    return {
      client_id: clientId,
      client_name: clientById.get(clientId)?.nome ?? "",
      tiktok_video_id: v.tiktok_video_id,
      title: v.title,
      cover_image_url: v.cover_image_url,
      share_url: v.share_url,
      posted_at: v.posted_at,
      views: v.views,
      likes: v.likes,
      engagement_rate: videoEngagementRate(v),
    };
  };

  const byViewsDesc = [...videos].sort((x, y) => (y.views || 0) - (x.views || 0));
  const cutoff = now.getTime() - MIN_AGE_FOR_BOTTOM_MS;
  const matured = videos.filter((v) => v.posted_at && Date.parse(v.posted_at) <= cutoff);
  const byViewsAsc = matured.sort((x, y) => (x.views || 0) - (y.views || 0));

  return {
    window: w,
    totals: {
      accounts: accounts.length,
      followers: accounts.reduce((acc, a) => acc + (a.follower_count || 0), 0),
      views: sumOf(videos, "views"),
      engagement_rate: ratioOfSums(videos),
      posts_count: videos.length,
    },
    accounts: rows,
    topVideos: byViewsDesc.slice(0, RANKED_VIDEOS).map(toPortfolioVideo),
    bottomVideos: byViewsAsc.slice(0, RANKED_VIDEOS).map(toPortfolioVideo),
  };
}
