// YouTube per-channel list for /analytics/youtube (2026-11-03 overview spec §5.2, §7).
//
// One row per channel of the workspace's active clients, each with ONLY its own numbers over ITS
// OWN window (its `data_through`, Pacific days, the client tab's `resolveYtWindow`). YouTube API
// policy forbids combining channels, so nothing here spans channels: no total, average, rank or
// shared window, and the response is `{ channels }` alone. The per-channel math is the client
// tab's (`computeYtKpis`, `computeYtSplit`); no previous window is read (the list shows no % change).
//
// Reads, in this fixed order (the handler tests queue mock pages per table in call order):
//   clientes (tenant, ativo) → youtube_channels (tenant only; channels of inactive clients are
//   dropped in code, so no id list rides the query string) → one youtube_channel_daily paged read
//   per distinct window (start, end) among the channels with data, oldest window first, one after
//   the other. Usually one or two reads, never one per channel, and a channel stuck months back
//   never widens the others' read. Each is tenant + content types all/shorts/long + that window's
//   days, plus `in channel_id` when the group is small (≤ PORTFOLIO_IN_LIMIT); a larger group reads
//   the tenant's days and keeps its own channels in code, so the URL stays short.
// Query errors throw; the handler answers a generic 500.
import { computeYtKpis, computeYtSplit, num, type YtChannelDailyRow } from "./kpis.ts";
import { resolveYtWindow, type YtWindow, type YtWindowRequest } from "./window.ts";
import { YOUTUBE_CHANNEL_COLUMNS, type YouTubeChannelRow } from "./queries.ts";
import { fetchAllRows } from "../paginate.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface YtPortfolioChannel {
  clientId: number;
  clientName: string;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
  subscriberCount: number | null;
  authorizationStatus: "active" | "revoked";
  lastSyncedAt: string | null;
  window: YtWindow | null; // null when the channel has no data (first sync, purged)
  metrics: {
    netSubscribers: number | null;
    views: number | null;
    watchMinutes: number | null;
    avgViewDurationS: number | null;
    shortsShare: number | null; // 0..1
  };
}

export interface YtPortfolio {
  channels: YtPortfolioChannel[];
}

/** `live` is left out: the list shows the `all` totals and the Shorts split (shorts vs long). */
const PORTFOLIO_CONTENT_TYPES = ["all", "shorts", "long"] as const;

/** Up to this many channel ids go in a read's `in channel_id`; past it, they are kept in code. */
export const PORTFOLIO_IN_LIMIT = 50;

/** queries.ts' channel daily columns plus `channel_id`, to group the workspace-wide reads. */
const PORTFOLIO_DAILY_COLUMNS =
  "channel_id, day, content_type, views, engaged_views, estimated_minutes_watched, likes, comments, shares, subscribers_gained, subscribers_lost, average_view_duration_s";

type PortfolioDailyRow = YtChannelDailyRow & { channel_id: string };

const inRange = (day: string, start: string, end: string) => day >= start && day <= end;

const NO_METRICS: YtPortfolioChannel["metrics"] = {
  netSubscribers: null,
  views: null,
  watchMinutes: null,
  avgViewDurationS: null,
  shortsShare: null,
};

/** One channel's row, from rows of that channel only (any days; clipped here to its window). */
export function channelPortfolioRow(
  channel: YouTubeChannelRow & { client_id: number },
  clientName: string,
  rows: YtChannelDailyRow[],
  window: YtWindow | null,
  hasData: boolean,
): YtPortfolioChannel {
  const w = hasData ? window : null;
  const base = {
    clientId: channel.client_id,
    clientName,
    title: channel.title,
    handle: channel.handle,
    avatarUrl: channel.avatar_url,
    subscriberCount: num(channel.subscriber_count),
    authorizationStatus: channel.authorization_status,
    lastSyncedAt: channel.last_synced_at,
  };
  if (!w) return { ...base, window: null, metrics: { ...NO_METRICS } };

  const allCurrent = rows.filter((r) => r.content_type === "all" && inRange(r.day, w.start, w.end));
  const kpis = computeYtKpis({
    current: allCurrent,
    prev: [],
    prevCovered: false,
    allCurrent,
    allPrev: [],
    allPrevCovered: false,
    subscriberCount: base.subscriberCount,
  });

  // The client tab's split: shorts vs long over the window clipped to content_type_through.
  const ctt = channel.content_type_through;
  let shortsShare: number | null = null;
  if (ctt && ctt >= w.start) {
    const splitEnd = ctt < w.end ? ctt : w.end;
    const { views } = computeYtSplit(rows.filter((r) => inRange(r.day, w.start, splitEnd)));
    const total = views.shorts + views.long;
    // The client tab's split card reads 0% on a zero total, not "sem dados": same here.
    shortsShare = total > 0 ? views.shorts / total : 0;
  }

  return {
    ...base,
    window: { start: w.start, end: w.end, prevStart: w.prevStart, prevEnd: w.prevEnd },
    metrics: {
      netSubscribers: kpis.net_subscribers.value,
      views: kpis.views.value,
      watchMinutes: kpis.watch_minutes.value,
      avgViewDurationS: kpis.avg_view_duration_s.value,
      shortsShare,
    },
  };
}

export async function buildYtPortfolio(db: Db, contaId: string, req: YtWindowRequest, now: Date): Promise<YtPortfolio> {
  const clients = await fetchAllRows<{ id: number; nome: string | null }>((from, to) =>
    db.from("clientes").select("id, nome")
      .eq("conta_id", contaId)
      .eq("status", "ativo")
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (clients.length === 0) return { channels: [] };
  const clientName = new Map(clients.map((c) => [c.id, c.nome ?? ""]));

  const channelRows = await fetchAllRows<YouTubeChannelRow>((from, to) =>
    db.from("youtube_channels").select(YOUTUBE_CHANNEL_COLUMNS)
      .eq("conta_id", contaId)
      .order("client_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  // Only channels of the active clients just read (the query carries the tenant alone).
  const channels = channelRows.filter((c) => clientName.has(c.client_id));
  if (channels.length === 0) return { channels: [] };

  const resolved = channels.map((c) => ({ channel: c, ...resolveYtWindow(req, c.data_through, now) }));

  // channel_id is unique per workspace, so a channel's rows come from its own group's read only.
  const groups = new Map<string, { start: string; end: string; ids: Set<string> }>();
  for (const r of resolved) {
    if (!r.hasData) continue;
    const key = `${r.window.start}|${r.window.end}`;
    const group = groups.get(key) ?? { start: r.window.start, end: r.window.end, ids: new Set<string>() };
    group.ids.add(r.channel.channel_id);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0
  );

  const rowsByChannel = new Map<string, PortfolioDailyRow[]>();
  for (const group of ordered) {
    const ids = [...group.ids];
    const byId = ids.length <= PORTFOLIO_IN_LIMIT;
    const rows = await fetchAllRows<PortfolioDailyRow>((from, to) => {
      let q = db.from("youtube_channel_daily").select(PORTFOLIO_DAILY_COLUMNS)
        .eq("conta_id", contaId);
      if (byId) q = q.in("channel_id", ids);
      return q.in("content_type", [...PORTFOLIO_CONTENT_TYPES])
        .gte("day", group.start)
        .lte("day", group.end)
        .order("channel_id", { ascending: true })
        .order("day", { ascending: true })
        .order("content_type", { ascending: true })
        .range(from, to);
    });
    for (const r of rows) {
      if (!group.ids.has(r.channel_id)) continue;
      const list = rowsByChannel.get(r.channel_id) ?? [];
      list.push(r);
      rowsByChannel.set(r.channel_id, list);
    }
  }

  return {
    channels: resolved.map(({ channel, window, hasData }) =>
      channelPortfolioRow(
        channel,
        clientName.get(channel.client_id) ?? "",
        rowsByChannel.get(channel.channel_id) ?? [],
        window,
        hasData,
      )
    ),
  };
}
