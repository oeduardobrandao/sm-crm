// YouTube per-channel list for /analytics/youtube (2026-11-03 overview spec §5.2, §7).
//
// One row per channel of the workspace's active clients, each with ONLY its own numbers over ITS
// OWN window (its `data_through`, Pacific days, the client tab's `resolveYtWindow`). YouTube API
// policy forbids combining channels, so nothing here spans channels: no total, average, rank or
// shared window, and the response is `{ channels }` alone. The per-channel math is the client
// tab's (`computeYtKpis`, `computeYtSplit`); no previous window is read (the list shows no % change).
//
// Reads, in this fixed order (the handler tests queue mock pages per table in call order):
//   clientes (tenant, ativo) → youtube_channels (tenant, in client_id) → ONE youtube_channel_daily
//   paged read (tenant, in channel_id, content types all/shorts/long, day between the earliest
//   window start and the latest window end of the channels with data). Never one read per channel.
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

/** queries.ts' channel daily columns plus `channel_id`, to group the one workspace-wide read. */
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
    shortsShare = total > 0 ? views.shorts / total : null;
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
      .in("client_id", clients.map((c) => c.id))
      .order("client_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  // Belt and braces on top of the `in` filter: only channels of the clients just read.
  const channels = channelRows.filter((c) => clientName.has(c.client_id));
  if (channels.length === 0) return { channels: [] };

  const resolved = channels.map((c) => ({ channel: c, ...resolveYtWindow(req, c.data_through, now) }));
  const withData = resolved.filter((r) => r.hasData);

  const rowsByChannel = new Map<string, PortfolioDailyRow[]>();
  if (withData.length > 0) {
    let start = withData[0].window.start;
    let end = withData[0].window.end;
    for (const { window: w } of withData) {
      if (w.start < start) start = w.start;
      if (w.end > end) end = w.end;
    }
    const channelIds = [...new Set(withData.map((r) => r.channel.channel_id))];
    const rows = await fetchAllRows<PortfolioDailyRow>((from, to) =>
      db.from("youtube_channel_daily").select(PORTFOLIO_DAILY_COLUMNS)
        .eq("conta_id", contaId)
        .in("channel_id", channelIds)
        .in("content_type", [...PORTFOLIO_CONTENT_TYPES])
        .gte("day", start)
        .lte("day", end)
        .order("channel_id", { ascending: true })
        .order("day", { ascending: true })
        .order("content_type", { ascending: true })
        .range(from, to)
    );
    for (const r of rows) {
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
