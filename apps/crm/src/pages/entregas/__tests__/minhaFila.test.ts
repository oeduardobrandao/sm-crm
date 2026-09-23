import { describe, expect, it, vi } from 'vitest';
// minhaFila.ts imports ASSIGNEE_PENDING_POST_STATUSES from the store (Task 2),
// which pulls the supabase client; the auto-mock keeps that import inert.
vi.mock('../../../lib/supabase');
import { FILA_BUCKET_ORDER, FILA_BUCKET_LABELS, filaBucketOf, margemOf } from '../minhaFila';
import type { DeadlineInfo } from '../etapaPrazo';

// Fixed "now": Wednesday 2026-09-23 10:00 local.
const NOW = new Date(2026, 8, 23, 10, 0, 0);
const OK: DeadlineInfo = { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false };
const LATE: DeadlineInfo = {
  diasRestantes: -1,
  horasRestantes: 0,
  estourado: true,
  urgente: false,
};
/** Local date `n` days from NOW's day at hour `h`. */
const day = (n: number, h = 9) => new Date(2026, 8, 23 + n, h, 0, 0);

describe('FILA_BUCKET_ORDER', () => {
  it('has the six buckets in display order with pt-BR labels', () => {
    expect(FILA_BUCKET_ORDER).toEqual([
      'atrasado',
      'hoje',
      'amanha',
      'proximos7',
      'depois',
      'sem_prazo',
    ]);
    expect(FILA_BUCKET_LABELS.proximos7).toBe('Próximos 7 dias');
    expect(FILA_BUCKET_LABELS.sem_prazo).toBe('Sem prazo');
  });
});

describe('filaBucketOf', () => {
  it('estourado wins even when the deadline day is today', () => {
    expect(filaBucketOf(day(0, 23), LATE, NOW)).toBe('atrasado');
  });

  it('a deadline day in the past without estourado (stale cache) is still atrasado', () => {
    expect(filaBucketOf(day(-1), OK, NOW)).toBe('atrasado');
  });

  it('today is hoje regardless of the hour, tomorrow is amanha', () => {
    expect(filaBucketOf(day(0, 0), OK, NOW)).toBe('hoje');
    expect(filaBucketOf(day(0, 23), OK, NOW)).toBe('hoje');
    expect(filaBucketOf(day(1), OK, NOW)).toBe('amanha');
  });

  it('proximos7 is +2..+7 exclusive of hoje/amanha, depois is +8 and beyond', () => {
    expect(filaBucketOf(day(2), OK, NOW)).toBe('proximos7');
    expect(filaBucketOf(day(7), OK, NOW)).toBe('proximos7');
    expect(filaBucketOf(day(8), OK, NOW)).toBe('depois');
  });

  it('null prazoDate is sem_prazo, even when the fallback DeadlineInfo carries days', () => {
    expect(filaBucketOf(null, { ...OK, diasRestantes: 5 }, NOW)).toBe('sem_prazo');
  });

  it('bucketing at 23:59 gives the same answer as at 10:00 (local day, not ms)', () => {
    const lateNow = new Date(2026, 8, 23, 23, 59, 0);
    expect(filaBucketOf(day(1, 0), OK, lateNow)).toBe('amanha');
    expect(filaBucketOf(day(7, 23), OK, lateNow)).toBe('proximos7');
  });
});

describe('margemOf', () => {
  const prazo = new Date(2026, 8, 22, 23, 59);
  it('counts local calendar days between deadline and publish date, hours ignored', () => {
    expect(margemOf(new Date(2026, 8, 23, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 1,
    });
    expect(margemOf(new Date(2026, 8, 24, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 2,
    });
    expect(margemOf(new Date(2026, 8, 25, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 3,
    });
  });

  it('zero or negative days is sem_margem', () => {
    expect(margemOf(new Date(2026, 8, 22, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'sem_margem',
      dias: 0,
    });
    expect(margemOf(new Date(2026, 8, 20, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'sem_margem',
      dias: -2,
    });
  });

  it('no publish date is sem_data; no deadline is sem_prazo (checked first)', () => {
    expect(margemOf(null, prazo)).toEqual({ kind: 'sem_data' });
    expect(margemOf(new Date(2026, 8, 25).toISOString(), null)).toEqual({ kind: 'sem_prazo' });
    expect(margemOf(null, null)).toEqual({ kind: 'sem_prazo' });
  });
});
