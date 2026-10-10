/** 2000 → "20%", 1250 → "12,5%". */
export function formatRateBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toLocaleString('pt-BR')}%`;
}

/** "19,98" / "19.98" / "R$ 1.234,56" → centavos; null se inválido ou não positivo. */
export function parseBRLToCents(raw: string): number | null {
  const cleaned = raw.replace(/[R$\s]/g, '');
  if (!cleaned) return null;
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
