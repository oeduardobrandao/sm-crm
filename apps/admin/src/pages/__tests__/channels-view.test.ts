import { describe, expect, it } from 'vitest';
import type { AcquisitionChannelRow } from '../../lib/api';
import { defaultRange, formatCents, toDisplayRows } from '../metricas/channels-view';

const t = (signups: number, ever_paid: number, paying_now: number, brl: number, usd: number) => ({
  signups,
  ever_paid,
  paying_now,
  mrr_cents: { brl, usd },
});
const row = (
  channel: string,
  totals: ReturnType<typeof t>,
  campaigns: AcquisitionChannelRow['campaigns'] = [],
): AcquisitionChannelRow => ({ channel, ...totals, campaigns });

const RANGE = { from: '2026-11', to: '2026-11' };

describe('toDisplayRows', () => {
  const rows = [
    row('meta_ads', t(10, 4, 3, 30000, 0), [{ campaign: 'black', ...t(10, 4, 3, 30000, 0) }]),
    row('direct', t(5, 1, 1, 10000, 500), [{ campaign: null, ...t(5, 1, 1, 10000, 500) }]),
    row('unknown', t(2, 0, 0, 0, 0)),
    row('demo', t(1, 0, 0, 0, 0)),
    row('no_data', t(0, 0, 0, 0, 0)),
  ];

  it('merges direct and unknown with the split for the tooltip', () => {
    const out = toDisplayRows(rows, RANGE);
    const merged = out.find((r) => r.key === 'direct_unknown')!;
    expect(merged.label).toBe('Direto / desconhecido');
    expect(merged.signups).toBe(7);
    expect(merged.mrr_cents).toEqual({ brl: 10000, usd: 500 });
    expect(merged.split).toEqual([
      { label: 'Direto', signups: 5 },
      { label: 'Não capturado', signups: 2 },
    ]);
    expect(out.some((r) => r.key === 'direct' || r.key === 'unknown')).toBe(false);
  });

  it('keeps demo, drops a zero no_data and totals every column per currency', () => {
    const out = toDisplayRows(rows, RANGE);
    expect(out.map((r) => r.key)).toEqual(['meta_ads', 'direct_unknown', 'demo', 'total']);
    const total = out[out.length - 1];
    expect(total.isTotal).toBe(true);
    expect(total.signups).toBe(18);
    expect(total.ever_paid).toBe(5);
    expect(total.paying_now).toBe(4);
    expect(total.mrr_cents).toEqual({ brl: 40000, usd: 500 });
  });

  it('keeps no_data when it has signups', () => {
    const out = toDisplayRows([row('no_data', t(3, 0, 0, 0, 0))], RANGE);
    expect(out.map((r) => r.key)).toEqual(['no_data', 'total']);
  });

  it('returns only a zero total for an empty response', () => {
    const out = toDisplayRows([], RANGE);
    expect(out).toHaveLength(1);
    expect(out[0].signups).toBe(0);
  });
});

describe('defaultRange', () => {
  it('uses the current São Paulo month at both ends', () => {
    // 2026-12-01T01:00Z is still 30 Nov 22:00 in São Paulo.
    expect(defaultRange(new Date('2026-12-01T01:00:00Z'))).toEqual({
      from: '2026-11',
      to: '2026-11',
    });
    expect(defaultRange(new Date('2026-12-01T04:00:00Z'))).toEqual({
      from: '2026-12',
      to: '2026-12',
    });
  });
});

describe('formatCents', () => {
  it('formats BRL and USD, with a dash for zero USD', () => {
    expect(formatCents(12345, 'brl')).toContain('123,45');
    expect(formatCents(12345, 'usd')).toContain('123,45');
    expect(formatCents(0, 'usd')).toBe('-');
    expect(formatCents(0, 'brl')).toContain('0,00');
  });
});
