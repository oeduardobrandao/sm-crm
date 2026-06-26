// Pure, deterministic client-health scoring. No I/O. Tuned via the constants below.
// Weights/thresholds are an internal heuristic — there is no authoritative external source.

export type HealthStatus =
  | 'em_alta'
  | 'saudavel'
  | 'estavel'
  | 'atencao'
  | 'em_queda'
  | 'inativo'
  | 'sem_dados'
  | 'sincronizando'
  | 'sem_sincronizar'
  | 'reconectar'
  | 'desconectado';

export interface HealthSignals {
  connected: boolean;
  authorizationStatus: string | null; // 'active' | 'expired' | 'revoked' | null
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  followerDeltaPct: number; // 28d %
  engagementRate: number; // %
  reachTrendPct: number; // current vs prior 28d %
  daysSinceLastPost: number | null;
  hasMinimumData: boolean;
  pipelineActive: boolean; // agendados + em_producao > 0
  nowMs: number; // injected for deterministic token/sync checks
}

export interface HealthResult {
  status: HealthStatus;
  score: number | null;
}

export const HEALTH_WEIGHTS = { growth: 0.35, engagement: 0.3, reachTrend: 0.2, recency: 0.15 };
export const SYNC_STALE_DAYS = 3;
export const INACTIVE_DAYS = 21;
export const ENGAGEMENT_FULL = 5; // engagement rate (%) that scores 100

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function growthScore(p: number): number {
  if (p <= -2) return 0;
  if (p < 0) return ((p + 2) / 2) * 50;
  if (p < 5) return 50 + (p / 5) * 50;
  return 100;
}

export function engagementScore(e: number): number {
  return clamp((e / ENGAGEMENT_FULL) * 100, 0, 100);
}

export function reachTrendScore(r: number): number {
  if (r <= -30) return 0;
  if (r < 0) return ((r + 30) / 30) * 50;
  if (r < 30) return 50 + (r / 30) * 50;
  return 100;
}

export function recencyScore(d: number | null): number {
  if (d === null) return 0;
  if (d <= 3) return 100;
  if (d <= 7) return 100 - ((d - 3) / 4) * 30; // 100 → 70
  if (d <= 14) return 70 - ((d - 7) / 7) * 30; // 70 → 40
  if (d <= 21) return 40 - ((d - 14) / 7) * 25; // 40 → 15
  if (d < 28) return 15 - ((d - 21) / 7) * 15; // 15 → 0
  return 0;
}

export function scoreClient(s: HealthSignals): HealthResult {
  if (!s.connected) return { status: 'desconectado', score: null };

  const tokenExpired = s.tokenExpiresAt ? Date.parse(s.tokenExpiresAt) < s.nowMs : false;
  if (s.authorizationStatus === 'revoked' || s.authorizationStatus === 'expired' || tokenExpired) {
    return { status: 'reconectar', score: null };
  }

  if (!s.lastSyncedAt) return { status: 'sincronizando', score: null };

  const daysSinceSync = (s.nowMs - Date.parse(s.lastSyncedAt)) / 86400000;
  if (daysSinceSync > SYNC_STALE_DAYS) return { status: 'sem_sincronizar', score: null };

  if (!s.hasMinimumData) return { status: 'sem_dados', score: null };

  if (s.daysSinceLastPost !== null && s.daysSinceLastPost > INACTIVE_DAYS && !s.pipelineActive) {
    return { status: 'inativo', score: null };
  }

  const score = Math.round(
    HEALTH_WEIGHTS.growth * growthScore(s.followerDeltaPct) +
      HEALTH_WEIGHTS.engagement * engagementScore(s.engagementRate) +
      HEALTH_WEIGHTS.reachTrend * reachTrendScore(s.reachTrendPct) +
      HEALTH_WEIGHTS.recency * recencyScore(s.daysSinceLastPost),
  );

  const status: HealthStatus =
    score >= 80
      ? 'em_alta'
      : score >= 60
        ? 'saudavel'
        : score >= 40
          ? 'estavel'
          : score >= 20
            ? 'atencao'
            : 'em_queda';

  return { status, score };
}
