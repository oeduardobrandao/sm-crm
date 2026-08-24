const countFmt = new Intl.NumberFormat('pt-BR');

export function fmtCount(n: number): string {
  return countFmt.format(Math.round(n));
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

/** Delta percentual value vs prev; null quando não computável (prev <= 0). */
export function deltaPct(value: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return ((value - prev) / prev) * 100;
}
