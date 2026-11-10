// Connected-account summary shown by the Hub strip: one entry per Instagram/TikTok account the
// client has connected. Pure state/delta helpers plus the two loaders the handler calls.
import {
  loadFollowerHistory,
  loadTikTokAccount,
  loadVideosInWindow,
  type TikTokAccountRow,
} from "../_shared/tiktok-analytics/queries.ts";
import { windowFromDays } from "../_shared/tiktok-analytics/window.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type AccountState = "connected" | "needs_reconnect";
export interface FollowerPoint {
  date: string;
  follower_count: number;
}
export interface FollowersDelta {
  value: number;
  since: string;
  fullWindow: boolean;
}
export interface HubAccountSummary {
  platform: "instagram" | "tiktok";
  state: AccountState;
  username: string | null;
  followerCount: number | null;
  followersDelta: FollowersDelta | null;
  lastSyncedAt: string | null;
  instagram?: { reach28d: number | null; impressions28d: number | null; mediaCount: number | null };
  tiktok?: { views30d: number; likesTotal: number | null; videoCount: number | null };
}

export interface InstagramAccountRow {
  username?: string | null;
  authorization_status?: string | null;
  token_expires_at?: string | null;
  created_at?: string | null;
  follower_count?: number | null;
  media_count?: number | null;
  reach_28d?: number | null;
  impressions_28d?: number | null;
  last_synced_at?: string | null;
}

const DAY_MS = 86400 * 1000;
const SUMMARY_DAYS = 30;

/** null = the account gets no card. Order of tests: disconnected, then reconnect, then connected. */
export function instagramState(
  row: { authorization_status?: string | null; token_expires_at?: string | null },
  nowIso: string,
): AccountState | null {
  const status = row.authorization_status;
  if (status === "disconnected") return null;
  if (status === "revoked" || status === "expired") return "needs_reconnect";
  if (row.token_expires_at && Date.parse(row.token_expires_at) <= Date.parse(nowIso)) return "needs_reconnect";
  return "connected";
}

export function tiktokState(row: { authorization_status?: string | null }): AccountState | null {
  const status = row.authorization_status;
  if (status === "disconnected") return null;
  if (status === "revoked" || status === "expired") return "needs_reconnect";
  return "connected";
}

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Last minus first observed point with date >= windowStart and >= minDate. null with fewer than two. */
export function followersDelta(
  points: FollowerPoint[],
  windowStart: string,
  minDate?: string | null,
): FollowersDelta | null {
  const used = points
    .filter((p) => p.date >= windowStart && (!minDate || p.date >= minDate))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (used.length < 2) return null;
  const first = used[0];
  const last = used[used.length - 1];
  return {
    value: last.follower_count - first.follower_count,
    since: first.date,
    fullWindow: first.date <= addDays(windowStart, 1),
  };
}

/** `history` is the Instagram follower history (UTC days), possibly longer than 30 days. Only
 * points from the connection day on count: earlier ones are reconstructed from gross follows. */
export function instagramSummary(
  row: InstagramAccountRow,
  history: FollowerPoint[],
  nowIso: string,
): HubAccountSummary | null {
  const state = instagramState(row, nowIso);
  if (state === null) return null;
  const windowStart = new Date(Date.parse(nowIso) - SUMMARY_DAYS * DAY_MS).toISOString().slice(0, 10);
  const connectedOn = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : null;
  return {
    platform: "instagram",
    state,
    username: row.username ?? null,
    followerCount: row.follower_count ?? null,
    followersDelta: followersDelta(history, windowStart, connectedOn),
    lastSyncedAt: row.last_synced_at ?? null,
    instagram: {
      reach28d: row.reach_28d ?? null,
      impressions28d: row.impressions_28d ?? null,
      mediaCount: row.media_count ?? null,
    },
  };
}

/** TikTok card for the client, or null when there is no connected account or the workspace lacks
 * feature_tiktok. A failing entitlement lookup reads as "no". */
export async function loadTikTokSummary(
  db: Db,
  clienteId: number,
  contaId: string,
  now: Date,
  feature: (key: string) => Promise<boolean>,
): Promise<{ summary: HubAccountSummary; account: TikTokAccountRow } | null> {
  void contaId;
  const account = await loadTikTokAccount(db, clienteId);
  if (!account) return null;
  const state = tiktokState(account);
  if (state === null) return null;

  let enabled = false;
  try {
    enabled = await feature("feature_tiktok");
  } catch {
    enabled = false;
  }
  if (!enabled) return null;

  const w = windowFromDays(SUMMARY_DAYS, now);
  const [videos, history] = await Promise.all([
    loadVideosInWindow(db, account.id, w.start, w.end),
    loadFollowerHistory(db, account.id, w.start, w.end),
  ]);
  return {
    account,
    summary: {
      platform: "tiktok",
      state,
      username: account.username,
      followerCount: account.follower_count,
      followersDelta: followersDelta(history, w.start),
      lastSyncedAt: account.last_synced_at,
      tiktok: {
        views30d: videos.reduce((acc, v) => acc + (v.views || 0), 0),
        likesTotal: account.likes_count,
        videoCount: account.video_count,
      },
    },
  };
}
