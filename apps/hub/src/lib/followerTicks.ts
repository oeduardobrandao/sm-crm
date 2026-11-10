/** Compact "3.9k" form used for wide-range charts and tooltips. */
export function formatAbbrev(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** True when the visible follower range is narrow enough that "3.9k" would repeat on every tick. */
export function isNarrowRange(values: number[]): boolean {
  if (values.length === 0) return false;
  return Math.max(...values) - Math.min(...values) < 1000;
}

/**
 * Y-axis tick label: a full integer with the locale's grouping ("3.850") for a narrow range,
 * the compact form ("12k") otherwise.
 */
export function formatFollowerTick(value: number, narrow: boolean, locale: string): string {
  if (!narrow) return formatAbbrev(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value));
}
