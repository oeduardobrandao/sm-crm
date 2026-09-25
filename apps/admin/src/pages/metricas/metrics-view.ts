import type { BackfillReport, MetricsMonth, MetricsMovements } from '../../lib/api';
import { formatMonth } from './deposits-view';

export const MOVEMENT_KEYS = [
  'new',
  'expansion',
  'recovered',
  'switch',
  'contraction',
  'past_due',
  'churn',
] as const satisfies readonly (keyof MetricsMovements)[];

export type MovementKey = (typeof MOVEMENT_KEYS)[number];

export const MOVEMENT_LABELS: Record<MovementKey, string> = {
  new: 'Novo',
  expansion: 'Expansão',
  recovered: 'Recuperado',
  switch: 'Troca de provedor',
  contraction: 'Contração',
  past_due: 'Inadimplência',
  churn: 'Churn',
};

export const BACKFILL_NOTE =
  'Mês reconstruído dos provedores: inadimplência anterior conta como ativa e o valor é o preço de hoje.';

export function monthLabel(m: MetricsMonth): string {
  const base = formatMonth(m.month);
  if (m.missing) return `${base} (sem dados)`;
  return m.closed ? base : `${base} (até hoje)`;
}

export function formatPct(x: number | null): string {
  if (x == null) return 'n/d';
  return `${(x * 100).toFixed(1).replace('.', ',')}%`;
}

const reais = (cents: number) => cents / 100;

export function latestMonth(months: MetricsMonth[]): MetricsMonth | null {
  for (let i = months.length - 1; i >= 0; i--) if (!months[i].missing) return months[i];
  return null;
}

/** MRR change of the latest available month against the previous available one. */
export function mrrDelta(months: MetricsMonth[]): { cents: number; since: string } | null {
  const available = months.filter((m) => !m.missing);
  if (available.length < 2) return null;
  const cur = available[available.length - 1];
  const prev = available[available.length - 2];
  return { cents: (cur.mrr_cents ?? 0) - (prev.mrr_cents ?? 0), since: prev.month };
}

export interface RevenueSeries {
  labels: string[];
  series: { key: string; label: string; data: (number | null)[] }[];
}

export function revenueSeries(months: MetricsMonth[], mode: 'provider' | 'plan'): RevenueSeries {
  const labels = months.map(monthLabel);
  if (mode === 'provider') {
    return {
      labels,
      series: (['stripe', 'pagarme'] as const).map((key) => ({
        key,
        label: key === 'stripe' ? 'Stripe' : 'Pagar.me',
        data: months.map((m) => (m.by_provider ? reais(m.by_provider[key]) : null)),
      })),
    };
  }
  const plans = new Map<string, string>();
  for (const m of months) for (const p of m.by_plan ?? []) plans.set(p.plan_id ?? '', p.name);
  return {
    labels,
    series: [...plans.entries()].map(([key, label]) => ({
      key: key || 'sem-plano',
      label,
      data: months.map((m) => {
        if (!m.by_plan) return null;
        const hit = m.by_plan.find((p) => (p.plan_id ?? '') === key);
        return reais(hit?.mrr_cents ?? 0);
      }),
    })),
  };
}

export interface MovementSeries {
  months: MetricsMonth[];
  labels: string[];
  bars: { key: MovementKey; label: string; data: number[] }[];
  logoPct: (number | null)[];
  revenuePct: (number | null)[];
}

/** Only months that have movements (not the first, not missing). */
export function movementSeries(all: MetricsMonth[]): MovementSeries {
  const months = all.filter((m) => m.movements);
  const pct = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);
  return {
    months,
    labels: months.map(monthLabel),
    bars: MOVEMENT_KEYS.map((key) => ({
      key,
      label: MOVEMENT_LABELS[key],
      data: months.map((m) => reais(m.movements![key])),
    })),
    logoPct: months.map((m) => pct(m.churn?.logo_pct)),
    revenuePct: months.map((m) => pct(m.churn?.revenue_pct)),
  };
}

export function backfillToastMessage(r: BackfillReport): string {
  const ignored =
    r.skipped.stripe_unmapped + r.skipped.pagarme_unmapped + r.skipped.pagarme_divergent;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    `Histórico reconstruído: ${plural(r.months_written, 'mês gravado', 'meses gravados')}, ` +
    `${plural(r.months_kept_cron, 'mantido do cron diário', 'mantidos do cron diário')}, ` +
    `${plural(ignored, 'assinatura ignorada', 'assinaturas ignoradas')}.`
  );
}
