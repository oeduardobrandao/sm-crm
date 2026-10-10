import type { CommissionRule } from '@/services/affiliates';

/** Uma linha da tabela de comissões, já com nome e mensalidade do plano. */
export interface CommissionTableRow {
  planId: string;
  planName: string;
  /** Mensalidade em centavos. */
  priceCents: number;
  rateBps: number;
  months: number;
  /** Comissão por mês de um indicado nesse plano (mensal). */
  perMonthCents: number;
  /** Comissão total de um indicado nesse plano ao longo da janela. */
  perReferralCents: number;
}

export function commissionPerMonth(priceCents: number, rateBps: number): number {
  if (!Number.isFinite(priceCents) || !Number.isFinite(rateBps)) return 0;
  if (priceCents <= 0 || rateBps <= 0) return 0;
  return Math.floor((priceCents * rateBps) / 10_000);
}

/**
 * Junta planos pagos e regras, na ordem dos planos. Plano sem regra fica de fora: ele não
 * gera comissão.
 */
export function buildCommissionTable(
  plans: Array<{ id: string; name: string; price_brl: number | null }>,
  rules: CommissionRule[],
): CommissionTableRow[] {
  const byPlan = new Map(rules.map((r) => [r.plan_id, r]));
  const rows: CommissionTableRow[] = [];
  for (const p of plans) {
    const rule = byPlan.get(p.id);
    const price = p.price_brl ?? 0;
    if (!rule || price <= 0 || rule.rate_bps <= 0) continue;
    const perMonth = commissionPerMonth(price, rule.rate_bps);
    rows.push({
      planId: p.id,
      planName: p.name,
      priceCents: price,
      rateBps: rule.rate_bps,
      months: rule.months,
      perMonthCents: perMonth,
      perReferralCents: perMonth * rule.months,
    });
  }
  return rows;
}

/** Total estimado para uma carteira: Σ indicados × comissão por indicado. */
export function simulateCommission(rows: CommissionTableRow[], counts: Record<string, number>) {
  let total = 0;
  let firstMonth = 0;
  for (const row of rows) {
    const n = Math.floor(counts[row.planId] ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    total += row.perReferralCents * n;
    firstMonth += row.perMonthCents * n;
  }
  return { totalCents: total, firstMonthCents: firstMonth };
}

export function formatRate(rateBps: number): string {
  const pct = rateBps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toLocaleString('pt-BR')}%`;
}

/** "nos 3 primeiros meses" / "no primeiro mês". */
export function monthsPhrase(months: number): string {
  return months === 1 ? 'no primeiro mês' : `nos ${months} primeiros meses`;
}

/** Resumo para o título da página: maior percentual e a janela (se for a mesma em todos). */
export function headlineFor(rows: CommissionTableRow[]): string | null {
  if (rows.length === 0) return null;
  const maxRate = Math.max(...rows.map((r) => r.rateBps));
  const months = new Set(rows.map((r) => r.months));
  const window = months.size === 1 ? ` ${monthsPhrase(rows[0].months)}` : '';
  return `Ganhe até ${formatRate(maxRate)} de cada assinatura${window}`;
}
