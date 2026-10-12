import { describe, expect, it } from 'vitest';
import type { MetricsMonth } from '../../lib/api';
import {
  backfillToastMessage,
  formatPct,
  latestMonth,
  monthLabel,
  movementNet,
  movementSeries,
  mrrDelta,
  prevCalendarMonth,
  revenueSeries,
  signedMoney,
} from '../metricas/metrics-view';

const month = (over: Partial<MetricsMonth>): MetricsMonth => ({
  month: '2026-08',
  missing: false,
  close_date: '2026-08-31',
  closed: true,
  source: 'cron',
  mrr_cents: 10000,
  arr_cents: 120000,
  paying_count: 1,
  by_provider: { stripe: 10000, pagarme: 0 },
  by_plan: [{ plan_id: 'pro', name: 'Pro', mrr_cents: 10000 }],
  movements_since: null,
  movements: null,
  churn: null,
  ...over,
});

describe('metrics-view', () => {
  it('labels closed, open and missing months', () => {
    expect(monthLabel(month({}))).toBe('Agosto de 2026');
    expect(monthLabel(month({ month: '2026-09', closed: false }))).toBe(
      'Setembro de 2026 (até hoje)',
    );
    expect(monthLabel(month({ month: '2026-07', missing: true }))).toBe(
      'Julho de 2026 (sem dados)',
    );
  });

  it('formats fractions as Brazilian percentages and null as n/d', () => {
    expect(formatPct(0.0526)).toBe('5,3%');
    expect(formatPct(0)).toBe('0,0%');
    expect(formatPct(null)).toBe('n/d');
  });

  it('latestMonth skips missing months; mrrDelta compares with the previous available one', () => {
    const months = [
      month({ month: '2026-07', mrr_cents: 8000 }),
      month({ month: '2026-08', missing: true, mrr_cents: null }),
      month({ month: '2026-09', closed: false, mrr_cents: 10000 }),
    ];
    expect(latestMonth(months)?.month).toBe('2026-09');
    expect(mrrDelta(months)).toEqual({ cents: 2000, since: '2026-07' });
    expect(mrrDelta([month({})])).toBeNull();
  });

  it('revenueSeries by provider and by plan, in reais, null for missing months', () => {
    const months = [
      month({}),
      month({ month: '2026-09', missing: true, mrr_cents: null, by_provider: null, by_plan: null }),
    ];
    const byProvider = revenueSeries(months, 'provider');
    expect(byProvider.labels).toEqual(['Agosto de 2026', 'Setembro de 2026 (sem dados)']);
    expect(byProvider.series).toEqual([
      { key: 'stripe', label: 'Stripe', data: [100, null] },
      { key: 'pagarme', label: 'Pagar.me', data: [0, null] },
    ]);
    const byPlan = revenueSeries(months, 'plan');
    expect(byPlan.series).toEqual([{ key: 'pro', label: 'Pro', data: [100, null] }]);
  });

  it('movementSeries keeps signs and skips the first month (no movements)', () => {
    const months = [
      month({}),
      month({
        month: '2026-09',
        movements: {
          new: 5000,
          expansion: 0,
          contraction: -1000,
          past_due: 0,
          recovered: 0,
          churn: -2000,
          switch: 0,
        },
        churn: {
          logos: 1,
          lost_cents: 2000,
          base_logos: 4,
          base_cents: 20000,
          logo_pct: 0.25,
          revenue_pct: 0.15,
        },
      }),
    ];
    const s = movementSeries(months);
    expect(s.labels).toEqual(['Setembro de 2026']);
    expect(s.bars.find((b) => b.key === 'new')?.data).toEqual([50]);
    expect(s.bars.find((b) => b.key === 'churn')?.data).toEqual([-20]);
    expect(s.logoPct).toEqual([25]);
    expect(s.revenuePct).toEqual([15]);
  });

  it('builds the backfill toast in Portuguese without em-dashes', () => {
    const msg = backfillToastMessage({
      months_written: 3,
      months_kept_cron: 1,
      rows_written: 40,
      skipped: { stripe_unmapped: 2, pagarme_unmapped: 0, pagarme_divergent: 1 },
    });
    expect(msg).toBe(
      'Histórico reconstruído: 3 meses gravados, 1 mantido do cron diário, 3 assinaturas ignoradas.',
    );
    expect(msg).not.toContain('—');
  });

  it('sums the signed movements into the net MRR change of a month', () => {
    const m = month({
      movements: {
        new: 5000,
        expansion: 1000,
        contraction: -500,
        past_due: -1000,
        recovered: 200,
        churn: -2000,
        switch: 0,
      },
    });
    expect(movementNet(m)).toBe(2700);
    expect(movementNet(month({ movements: null }))).toBe(0);
  });

  it('signs only gains and finds the previous calendar month', () => {
    expect(signedMoney(76000)).toContain('+');
    expect(signedMoney(-12000)).not.toContain('+');
    expect(signedMoney(0)).not.toContain('+');
    expect(prevCalendarMonth('2026-01')).toBe('2025-12');
    expect(prevCalendarMonth('2026-10')).toBe('2026-09');
  });
});
