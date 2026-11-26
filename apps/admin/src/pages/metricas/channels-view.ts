import type { AcquisitionChannelRow, AcquisitionChannelTotals } from '../../lib/api';
import { channelLabel } from '../../lib/acquisition-channels';
import { formatMoney } from '../../lib/subscription';

export interface MonthRange {
  from: string;
  to: string;
}

export interface DisplayCampaign extends AcquisitionChannelTotals {
  key: string;
  label: string;
}

export interface DisplayRow extends AcquisitionChannelTotals {
  key: string;
  /** Raw channel for the badge tone; null for the merged and total rows. */
  channel: string | null;
  label: string;
  campaigns: DisplayCampaign[];
  /** direct + unknown only: how the merged signups split. */
  split?: { label: string; signups: number }[];
  isTotal?: boolean;
}

const MONTH_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
});

/** The current São Paulo month at both ends of the range (YYYY-MM). */
export function defaultRange(now: Date): MonthRange {
  const parts = MONTH_FMT.formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return { from: `${y}-${m}`, to: `${y}-${m}` };
}

export function formatCents(cents: number, currency: 'brl' | 'usd'): string {
  if (currency === 'usd' && cents === 0) return '-';
  return formatMoney(cents, currency);
}

const zero = (): AcquisitionChannelTotals => ({
  signups: 0,
  ever_paid: 0,
  paying_now: 0,
  mrr_cents: { brl: 0, usd: 0 },
});

function add(a: AcquisitionChannelTotals, b: AcquisitionChannelTotals): AcquisitionChannelTotals {
  return {
    signups: a.signups + b.signups,
    ever_paid: a.ever_paid + b.ever_paid,
    paying_now: a.paying_now + b.paying_now,
    mrr_cents: { brl: a.mrr_cents.brl + b.mrr_cents.brl, usd: a.mrr_cents.usd + b.mrr_cents.usd },
  };
}

function totalsOf(r: AcquisitionChannelTotals): AcquisitionChannelTotals {
  return {
    signups: r.signups,
    ever_paid: r.ever_paid,
    paying_now: r.paying_now,
    mrr_cents: r.mrr_cents,
  };
}

function mergeCampaigns(rows: AcquisitionChannelRow[]): DisplayCampaign[] {
  const byKey = new Map<string, DisplayCampaign>();
  for (const r of rows) {
    for (const c of r.campaigns) {
      const key = c.campaign ?? '';
      const prev = byKey.get(key);
      byKey.set(key, {
        key,
        label: c.campaign ?? '(sem campanha)',
        ...add(prev ?? zero(), c),
      });
    }
  }
  return [...byKey.values()];
}

/**
 * Report rows: direct + unknown shown as one row, a `no_data` row only when it has signups
 * (the range reaches before the capture launch), and a Total last. Money is summed per
 * currency, never across.
 */
export function toDisplayRows(rows: AcquisitionChannelRow[], _range?: MonthRange): DisplayRow[] {
  const out: DisplayRow[] = [];
  const merged = rows.filter((r) => r.channel === 'direct' || r.channel === 'unknown');
  let mergedPlaced = false;
  for (const r of rows) {
    if (r.channel === 'direct' || r.channel === 'unknown') {
      if (mergedPlaced) continue;
      mergedPlaced = true;
      const sum = merged.reduce((acc, m) => add(acc, m), zero());
      out.push({
        key: 'direct_unknown',
        channel: null,
        label: 'Direto / desconhecido',
        ...sum,
        campaigns: mergeCampaigns(merged),
        split: merged.map((m) => ({ label: channelLabel(m.channel), signups: m.signups })),
      });
      continue;
    }
    if (r.channel === 'no_data' && r.signups === 0) continue;
    out.push({
      key: r.channel,
      channel: r.channel,
      label: channelLabel(r.channel),
      ...totalsOf(r),
      campaigns: r.campaigns.map((c) => ({
        key: c.campaign ?? '',
        label: c.campaign ?? '(sem campanha)',
        ...totalsOf(c),
      })),
    });
  }
  const total = out.reduce<AcquisitionChannelTotals>((acc, r) => add(acc, r), zero());
  out.push({
    key: 'total',
    channel: null,
    label: 'Total',
    ...total,
    campaigns: [],
    isTotal: true,
  });
  return out;
}
