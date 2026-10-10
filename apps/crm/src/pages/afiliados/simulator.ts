/** Percentual padrão do programa (basis points). O valor real de cada afiliado vem do painel. */
export const DEFAULT_COMMISSION_RATE_BPS = 2000;

export interface SimulatorItem {
  /** Mensalidade do plano em centavos. */
  priceCents: number;
  /** Quantos indicados pagando esse plano. */
  count: number;
}

/** Comissão mensal e anual em centavos para uma carteira de indicados pagando no mensal. */
export function simulateCommission(items: SimulatorItem[], rateBps = DEFAULT_COMMISSION_RATE_BPS) {
  let monthly = 0;
  for (const { priceCents, count } of items) {
    if (!Number.isFinite(priceCents) || !Number.isFinite(count) || priceCents <= 0 || count <= 0) {
      continue;
    }
    monthly += Math.floor((priceCents * rateBps) / 10_000) * Math.floor(count);
  }
  return { monthlyCents: monthly, yearlyCents: monthly * 12 };
}

export function formatRate(rateBps: number): string {
  const pct = rateBps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toLocaleString('pt-BR')}%`;
}
