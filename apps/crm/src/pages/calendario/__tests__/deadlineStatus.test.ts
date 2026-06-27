import { describe, expect, it } from 'vitest';

import { formatDeadlineStatus } from '../deadlineStatus';

describe('formatDeadlineStatus', () => {
  it('pluralizes days remaining when more than one day is left', () => {
    expect(formatDeadlineStatus(5, false)).toBe('5d restantes');
  });

  it('uses the singular form when exactly one day is left', () => {
    expect(formatDeadlineStatus(1, false)).toBe('1d restante');
  });

  it('shows "Vence hoje" when zero days remain', () => {
    expect(formatDeadlineStatus(0, false)).toBe('Vence hoje');
  });

  it('shows the overdue label when the deadline is blown', () => {
    expect(formatDeadlineStatus(-3, true)).toBe('3d atrasado');
  });

  it('returns "Sem prazo" instead of "undefined" when diasRestantes is missing', () => {
    expect(formatDeadlineStatus(undefined, undefined)).toBe('Sem prazo');
  });

  it('returns "Sem prazo" when diasRestantes is NaN', () => {
    expect(formatDeadlineStatus(NaN, false)).toBe('Sem prazo');
  });
});
