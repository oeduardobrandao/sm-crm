import { describe, expect, it } from 'vitest';
import type { PeriodoFinanceiro } from '@/store/financeiroV2';
import { periodoPadrao } from '../periodos';

const p = (inicio: string, status: PeriodoFinanceiro['status']): PeriodoFinanceiro => ({
  inicio,
  fim: inicio,
  rotulo: inicio,
  status,
  transicao: false,
});

describe('periodoPadrao', () => {
  it('prefers the aberto period in any order', () => {
    const a = [p('2026-09-01', 'reaberto'), p('2026-10-01', 'aberto'), p('2026-11-01', 'futuro')];
    expect(periodoPadrao(a)?.inicio).toBe('2026-10-01');
    expect(periodoPadrao([...a].reverse())?.inicio).toBe('2026-10-01');
  });

  it('else the latest non-futuro by inicio', () => {
    const a = [p('2026-08-01', 'fechado'), p('2026-09-01', 'reaberto'), p('2026-11-01', 'futuro')];
    expect(periodoPadrao(a)?.inicio).toBe('2026-09-01');
    expect(periodoPadrao([...a].reverse())?.inicio).toBe('2026-09-01');
  });

  it('else the earliest', () => {
    const a = [p('2026-12-01', 'futuro'), p('2026-11-01', 'futuro')];
    expect(periodoPadrao(a)?.inicio).toBe('2026-11-01');
  });

  it('is undefined for an empty list', () => {
    expect(periodoPadrao([])).toBeUndefined();
  });
});
