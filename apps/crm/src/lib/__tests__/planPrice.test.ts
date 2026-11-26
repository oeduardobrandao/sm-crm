import { describe, expect, it } from 'vitest';
import {
  formatPlanPrice,
  planAnnualCents,
  planMonthlyCents,
  toBillingCurrency,
} from '../planPrice';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

const plan = {
  price_brl: 9990,
  price_brl_annual: 99900,
  price_usd: 2900,
  price_usd_annual: 29000,
};

describe('formatPlanPrice', () => {
  it('formats USD cents as en-US dollars', () => {
    expect(formatPlanPrice(2900, 'usd')).toBe('$29.00');
  });

  it('formats BRL cents exactly like the old pt-BR formatter', () => {
    const legacy = (9990 / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    expect(formatPlanPrice(9990, 'brl')).toBe(legacy);
    expect(nbsp(formatPlanPrice(9990, 'brl'))).toBe('R$ 99,90');
  });

  it('renders zero without decimals', () => {
    expect(nbsp(formatPlanPrice(0, 'brl'))).toBe('R$ 0');
    expect(formatPlanPrice(0, 'usd')).toBe('$0');
  });

  it('honours an explicit locale override', () => {
    const legacy = (9990 / 100).toLocaleString('en-US', { style: 'currency', currency: 'BRL' });
    expect(formatPlanPrice(9990, 'brl', 'en-US')).toBe(legacy);
  });
});

describe('planMonthlyCents / planAnnualCents', () => {
  it('reads the BRL columns for brl', () => {
    expect(planMonthlyCents(plan, 'brl')).toBe(9990);
    expect(planAnnualCents(plan, 'brl')).toBe(99900);
  });

  it('reads the USD columns for usd', () => {
    expect(planMonthlyCents(plan, 'usd')).toBe(2900);
    expect(planAnnualCents(plan, 'usd')).toBe(29000);
  });

  it('returns null when the USD columns are missing', () => {
    const brlOnly = { price_brl: 9990, price_brl_annual: 99900 };
    expect(planMonthlyCents(brlOnly, 'usd')).toBeNull();
    expect(planAnnualCents(brlOnly, 'usd')).toBeNull();
  });
});

describe('toBillingCurrency', () => {
  it('maps only usd to usd', () => {
    expect(toBillingCurrency('usd')).toBe('usd');
    expect(toBillingCurrency('USD')).toBe('usd');
    expect(toBillingCurrency('brl')).toBe('brl');
    expect(toBillingCurrency(null)).toBe('brl');
    expect(toBillingCurrency('eur')).toBe('brl');
  });
});
