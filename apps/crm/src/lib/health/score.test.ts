import { describe, it, expect } from 'vitest';
import {
  growthScore,
  engagementScore,
  reachTrendScore,
  recencyScore,
  scoreClient,
  type HealthSignals,
} from './score';

const NOW = Date.UTC(2026, 5, 25); // fixed clock for deterministic override tests
const daysAgoIso = (d: number) => new Date(NOW - d * 86400000).toISOString();

const base: HealthSignals = {
  connected: true,
  authorizationStatus: 'active',
  tokenExpiresAt: daysAgoIso(-30), // 30 days in the future
  lastSyncedAt: daysAgoIso(0),
  followerDeltaPct: 0,
  engagementRate: 0,
  reachTrendPct: 0,
  daysSinceLastPost: 0,
  hasMinimumData: true,
  pipelineActive: false,
  nowMs: NOW,
};

describe('normalization', () => {
  it('growthScore is piecewise 0/50/100', () => {
    expect(growthScore(-3)).toBe(0);
    expect(growthScore(-1)).toBe(25);
    expect(growthScore(0)).toBe(50);
    expect(growthScore(2.5)).toBe(75);
    expect(growthScore(10)).toBe(100);
  });
  it('engagementScore caps at 5%', () => {
    expect(engagementScore(0)).toBe(0);
    expect(engagementScore(2.5)).toBe(50);
    expect(engagementScore(5)).toBe(100);
    expect(engagementScore(8)).toBe(100);
  });
  it('reachTrendScore is piecewise around ±30%', () => {
    expect(reachTrendScore(-30)).toBe(0);
    expect(reachTrendScore(-15)).toBe(25);
    expect(reachTrendScore(0)).toBe(50);
    expect(reachTrendScore(15)).toBe(75);
    expect(reachTrendScore(45)).toBe(100);
  });
  it('recencyScore decays with days since last post', () => {
    expect(recencyScore(null)).toBe(0);
    expect(recencyScore(2)).toBe(100);
    expect(recencyScore(7)).toBe(70);
    expect(recencyScore(14)).toBe(40);
    expect(recencyScore(21)).toBe(15);
    expect(recencyScore(40)).toBe(0);
  });
});

describe('scoreClient — override states (priority order)', () => {
  it('not connected → desconectado', () => {
    expect(scoreClient({ ...base, connected: false }).status).toBe('desconectado');
  });
  it('revoked → reconectar', () => {
    expect(scoreClient({ ...base, authorizationStatus: 'revoked' }).status).toBe('reconectar');
  });
  it('expired token date → reconectar', () => {
    expect(scoreClient({ ...base, tokenExpiresAt: daysAgoIso(1) }).status).toBe('reconectar');
  });
  it('never synced (null) → sincronizando, not stale', () => {
    expect(scoreClient({ ...base, lastSyncedAt: null }).status).toBe('sincronizando');
  });
  it('synced > 3d ago → sem_sincronizar', () => {
    expect(scoreClient({ ...base, lastSyncedAt: daysAgoIso(5) }).status).toBe('sem_sincronizar');
  });
  it('insufficient history → sem_dados', () => {
    expect(scoreClient({ ...base, hasMinimumData: false }).status).toBe('sem_dados');
  });
  it('dormant + empty pipeline → inativo', () => {
    expect(scoreClient({ ...base, daysSinceLastPost: 30, pipelineActive: false }).status).toBe(
      'inativo',
    );
  });
  it('dormant but pipeline active → scored, not inativo', () => {
    expect(scoreClient({ ...base, daysSinceLastPost: 30, pipelineActive: true }).status).not.toBe(
      'inativo',
    );
  });
});

describe('scoreClient — tiers', () => {
  it('strong signals → em_alta (100)', () => {
    const r = scoreClient({
      ...base,
      followerDeltaPct: 6,
      engagementRate: 5,
      reachTrendPct: 35,
      daysSinceLastPost: 2,
    });
    expect(r.score).toBe(100);
    expect(r.status).toBe('em_alta');
  });
  it('declining signals → em_queda (low score)', () => {
    const r = scoreClient({
      ...base,
      followerDeltaPct: -3,
      engagementRate: 1,
      reachTrendPct: -30,
      daysSinceLastPost: 18,
    });
    expect(r.status).toBe('em_queda');
    expect(r.score).toBeLessThan(20);
  });
});
