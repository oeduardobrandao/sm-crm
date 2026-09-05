import { describe, expect, it } from 'vitest';
import { describeDrift, formatCard, formatDay } from '../workspace-subscription';

describe('formatDay', () => {
  it('renders dd/MM/yyyy in pt-BR', () => {
    // Midday UTC so the calendar day is the same in every timezone the tests may run in.
    expect(formatDay('2026-09-03T12:00:00Z')).toBe('03/09/2026');
  });
  it('renders a dash for null, empty or unparsable input', () => {
    expect(formatDay(null)).toBe('—');
    expect(formatDay(undefined)).toBe('—');
    expect(formatDay('')).toBe('—');
    expect(formatDay('not-a-date')).toBe('—');
  });
});

describe('formatCard', () => {
  it('renders brand, masked last four and MM/AA expiry', () => {
    expect(formatCard({ brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028 })).toBe(
      'Visa •••• 4242 · 12/28',
    );
  });
  it('zero-pads the month and accepts a two-digit year', () => {
    expect(formatCard({ brand: 'mastercard', last4: '0001', exp_month: 3, exp_year: 27 })).toBe(
      'Mastercard •••• 0001 · 03/27',
    );
  });
  it('drops the expiry when either part is missing', () => {
    expect(formatCard({ brand: 'visa', last4: '4242', exp_month: null, exp_year: 2028 })).toBe(
      'Visa •••• 4242',
    );
  });
  it('drops the brand when missing and keeps the last four', () => {
    expect(formatCard({ brand: null, last4: '4242', exp_month: 12, exp_year: 2028 })).toBe(
      '•••• 4242 · 12/28',
    );
  });
  it('renders a dash when nothing is known', () => {
    expect(formatCard(null)).toBe('—');
    expect(formatCard(undefined)).toBe('—');
    expect(formatCard({ brand: null, last4: null, exp_month: null, exp_year: null })).toBe('—');
  });
});

describe('describeDrift', () => {
  it('returns nothing when there is no drift', () => {
    expect(describeDrift(null)).toEqual([]);
    expect(describeDrift(undefined)).toEqual([]);
    expect(describeDrift({ status: null, period: null })).toEqual([]);
  });
  it('describes a status drift with both labels', () => {
    expect(describeDrift({ status: { mirror: 'active', live: 'canceled' }, period: null })).toEqual(
      ['Status: espelho Ativo, Pagar.me Cancelado'],
    );
  });
  it('describes a period drift with both dates', () => {
    expect(
      describeDrift({
        status: null,
        period: { mirror: '2026-10-03T12:00:00Z', live: '2027-10-03T12:00:00Z' },
      }),
    ).toEqual(['Período: espelho 03/10/2026, Pagar.me 03/10/2027']);
  });
  it('describes both, status first', () => {
    const lines = describeDrift({
      status: { mirror: null, live: 'active' },
      period: { mirror: null, live: '2027-10-03T12:00:00Z' },
    });
    expect(lines).toEqual([
      'Status: espelho —, Pagar.me Ativo',
      'Período: espelho —, Pagar.me 03/10/2027',
    ]);
  });
});
