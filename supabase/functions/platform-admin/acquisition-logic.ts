// Pure aggregation behind get-acquisition-channels (spec §4). No I/O here.

export type ChannelBucket = string; // classifier value | 'unknown' | 'demo' | 'no_data'

export interface AcqWorkspace {
  id: string;
  created_at: string;
  demo_created_at: string | null;
  is_internal: boolean;
}
export interface AcqRow {
  workspace_id: string;
  channel: string;
  campaign: string | null;
}
export interface ChannelTotals {
  signups: number;
  ever_paid: number;
  paying_now: number;
  mrr_cents: { brl: number; usd: number };
}
export interface ChannelRow extends ChannelTotals {
  channel: ChannelBucket;
  campaigns: ({ campaign: string | null } & ChannelTotals)[];
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 24;
const SP_OFFSET = "-03:00";

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1);

/** São Paulo-midnight bounds, both months inclusive; null when the range is invalid. */
export function monthBounds(
  from: string,
  to: string,
): { startIso: string; endIso: string } | null {
  if (typeof from !== "string" || typeof to !== "string") return null;
  if (!MONTH_RE.test(from) || !MONTH_RE.test(to)) return null;
  const span = monthIndex(to) - monthIndex(from);
  if (span < 0 || span + 1 > MAX_MONTHS) return null;
  const next = monthIndex(to) + 1;
  const y = Math.floor(next / 12);
  const m = (next % 12) + 1;
  return {
    startIso: `${from}-01T00:00:00${SP_OFFSET}`,
    endIso: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01T00:00:00${SP_OFFSET}`,
  };
}

/** Demo wins (durable marker), then the stored channel, then no_data (no row). */
export function bucketOf(ws: AcqWorkspace, acq: AcqRow | undefined): ChannelBucket {
  if (ws.demo_created_at) return "demo";
  return acq?.channel ?? "no_data";
}

const emptyTotals = (): ChannelTotals => ({
  signups: 0,
  ever_paid: 0,
  paying_now: 0,
  mrr_cents: { brl: 0, usd: 0 },
});

export function aggregateChannels(input: {
  workspaces: AcqWorkspace[];
  acquisition: Map<string, AcqRow>;
  priced: { workspace_id: string; currency: "brl" | "usd"; monthly_cents: number }[];
  everPaidIds: Set<string>;
}): ChannelRow[] {
  const pricedByWs = new Map<string, { brl: number; usd: number }>();
  for (const p of input.priced) {
    const cur = pricedByWs.get(p.workspace_id) ?? { brl: 0, usd: 0 };
    cur[p.currency === "usd" ? "usd" : "brl"] += p.monthly_cents;
    pricedByWs.set(p.workspace_id, cur);
  }

  const add = (t: ChannelTotals, id: string) => {
    const paying = pricedByWs.get(id);
    t.signups += 1;
    if (paying) {
      t.paying_now += 1;
      t.mrr_cents.brl += paying.brl;
      t.mrr_cents.usd += paying.usd;
    }
    if (paying || input.everPaidIds.has(id)) t.ever_paid += 1;
  };

  const channels = new Map<string, { totals: ChannelTotals; campaigns: Map<string | null, ChannelTotals> }>();
  for (const w of input.workspaces) {
    if (w.is_internal) continue;
    const acq = input.acquisition.get(w.id);
    const key = bucketOf(w, acq);
    let ch = channels.get(key);
    if (!ch) {
      ch = { totals: emptyTotals(), campaigns: new Map() };
      channels.set(key, ch);
    }
    add(ch.totals, w.id);
    const campaign = acq?.campaign ?? null;
    let c = ch.campaigns.get(campaign);
    if (!c) {
      c = emptyTotals();
      ch.campaigns.set(campaign, c);
    }
    add(c, w.id);
  }

  return [...channels.entries()]
    .map(([channel, { totals, campaigns }]) => ({
      channel,
      ...totals,
      campaigns: [...campaigns.entries()]
        .map(([campaign, t]) => ({ campaign, ...t }))
        .sort((a, b) => {
          if ((a.campaign === null) !== (b.campaign === null)) return a.campaign === null ? 1 : -1;
          return b.signups - a.signups;
        }),
    }))
    .sort((a, b) => b.signups - a.signups);
}
