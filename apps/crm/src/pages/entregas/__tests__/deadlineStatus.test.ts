import { describe, it, expect } from 'vitest';
import {
  classifyDeadline,
  computeDeadlineStats,
  DEADLINE_STATUS,
  DEADLINE_STATUS_ORDER,
} from '../deadlineStatus';
import type { BoardCard } from '../hooks/useEntregasData';

function card(deadline: Partial<BoardCard['deadline']>): BoardCard {
  return {
    deadline: {
      diasRestantes: 3,
      horasRestantes: 0,
      estourado: false,
      urgente: false,
      ...deadline,
    },
  } as BoardCard;
}

describe('classifyDeadline', () => {
  it('estourado wins over urgente', () => {
    expect(
      classifyDeadline({ diasRestantes: -2, horasRestantes: 0, estourado: true, urgente: true }),
    ).toBe('atrasado');
  });
  it('urgente when not estourado', () => {
    expect(
      classifyDeadline({ diasRestantes: 0, horasRestantes: 5, estourado: false, urgente: true }),
    ).toBe('urgente');
  });
  it('em_dia otherwise', () => {
    expect(
      classifyDeadline({ diasRestantes: 4, horasRestantes: 0, estourado: false, urgente: false }),
    ).toBe('em_dia');
  });
});

describe('computeDeadlineStats', () => {
  it('counts each bucket and totals match input length', () => {
    const cards = [
      card({ estourado: true }),
      card({ estourado: true, urgente: true }),
      card({ urgente: true }),
      card({}),
    ];
    const stats = computeDeadlineStats(cards);
    expect(stats).toEqual({ atrasado: 2, urgente: 1, em_dia: 1 });
  });
  it('empty input yields zeros', () => {
    expect(computeDeadlineStats([])).toEqual({ atrasado: 0, urgente: 0, em_dia: 0 });
  });
});

describe('DEADLINE_STATUS', () => {
  it('maps every status to a label and CSS var, in display order', () => {
    expect(DEADLINE_STATUS_ORDER).toEqual(['em_dia', 'urgente', 'atrasado']);
    expect(DEADLINE_STATUS.em_dia).toEqual({
      label: 'Em dia',
      cssVar: '--success',
      fallback: '#3ecf8e',
    });
    expect(DEADLINE_STATUS.urgente).toEqual({
      label: 'Urgente',
      cssVar: '--warning',
      fallback: '#f5a342',
    });
    expect(DEADLINE_STATUS.atrasado).toEqual({
      label: 'Atrasado',
      cssVar: '--danger',
      fallback: '#f55a42',
    });
  });
});
