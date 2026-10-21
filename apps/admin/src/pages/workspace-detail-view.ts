// Pure view helpers for WorkspaceDetailPage (brand metrics, override summaries, MCP lists).

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1024-based, pt-BR decimal comma: 0 B, 512 KB, 1,5 GB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const text = value.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return `${text} ${UNITS[unit]}`;
}

/** "de 10" / "sem limite" caption under a usage number; null limit means unlimited. */
export function limitCaption(
  limit: number | null | undefined,
  format: (n: number) => string = String,
): string {
  return limit == null ? 'sem limite' : `de ${format(limit)}`;
}

export function overrideCount(overrides: Record<string, unknown> | null | undefined): number {
  return overrides ? Object.keys(overrides).length : 0;
}

/**
 * Splits a revocable list (MCP keys, OAuth grants) into what to render and how many revoked
 * rows are hidden. Active rows always come first; revoked ones only when asked for.
 */
export function visibleConnections<T extends { revoked_at: string | null }>(
  items: readonly T[] | undefined,
  showRevoked: boolean,
): { visible: T[]; activeCount: number; revokedCount: number } {
  const all = items ?? [];
  const active = all.filter((i) => !i.revoked_at);
  const revoked = all.filter((i) => !!i.revoked_at);
  return {
    visible: showRevoked ? [...active, ...revoked] : active,
    activeCount: active.length,
    revokedCount: revoked.length,
  };
}
