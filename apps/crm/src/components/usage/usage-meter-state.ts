export type MeterState = 'ok' | 'warning' | 'danger' | 'blocked' | 'unlimited';

export interface MeterInfo {
  state: MeterState;
  /** 0-100, clamped. 0 when no bar is drawn (unlimited/blocked). */
  pct: number;
  /** Slots/bytes left. null when unlimited. */
  remaining: number | null;
  /** Upgrade nudge: usage above 75%, or any non-ok state. */
  showCta: boolean;
}

/**
 * Single source for meter thresholds (spec 2026-08-08 §3). limit semantics
 * follow the entitlement resolver: null = unlimited, 0 = blocked (fail-closed).
 */
export function computeMeterState(used: number, limit: number | null): MeterInfo {
  if (limit === null) return { state: 'unlimited', pct: 0, remaining: null, showCta: false };
  if (limit === 0) return { state: 'blocked', pct: 0, remaining: 0, showCta: true };
  const ratio = used / limit;
  const pct = Math.min(100, Math.round(ratio * 100));
  const remaining = Math.max(0, limit - used);
  const state: MeterState =
    used >= limit ? 'danger' : remaining <= 1 || ratio >= 0.8 ? 'warning' : 'ok';
  return { state, pct, remaining, showCta: ratio > 0.75 || state !== 'ok' };
}

export const METER_FILL: Record<MeterState, string> = {
  ok: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  blocked: 'var(--danger)',
  unlimited: 'var(--success)',
};

/** "4,2 GB" / "100 MB", pt-BR decimals. Same tiering as CobrancaPage.formatStorage. */
export function formatStorageBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) {
    const v = Number.isInteger(gb) ? gb : Number(gb.toFixed(1));
    return `${v.toLocaleString('pt-BR')} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
