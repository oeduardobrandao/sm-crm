import { describe, it, expect } from 'vitest';
import { isFinancialPath, financialGuardOutcome } from '../AppLayout';

describe('isFinancialPath', () => {
  it('matches the financial routes and their children', () => {
    expect(isFinancialPath('/financeiro')).toBe(true);
    expect(isFinancialPath('/contratos')).toBe(true);
    expect(isFinancialPath('/contratos/42')).toBe(true);
  });

  it('does not match unrelated routes', () => {
    expect(isFinancialPath('/dashboard')).toBe(false);
    expect(isFinancialPath('/equipe')).toBe(false);
    expect(isFinancialPath('/clientes/1')).toBe(false);
  });
});

describe('financialGuardOutcome', () => {
  it('renders content on a non-financial route regardless of capability', () => {
    expect(financialGuardOutcome('/dashboard', false)).toBe('content');
    expect(financialGuardOutcome('/dashboard', 'unknown')).toBe('content');
  });

  it('renders content on a financial route when authorized', () => {
    expect(financialGuardOutcome('/financeiro', true)).toBe('content');
  });

  it('denies on a financial route when explicitly restricted', () => {
    expect(financialGuardOutcome('/financeiro', false)).toBe('denied');
  });

  // The route screen fails NEUTRAL, unlike value masking which fails closed.
  // Writing this as `!== true` would show an owner the restriction screen during
  // hydration or a transient membership-lookup failure. The loading state leaks
  // nothing: route content is unrendered either way and the database denies
  // regardless.
  it('shows loading, not denial, while the capability is unknown', () => {
    expect(financialGuardOutcome('/financeiro', 'unknown')).toBe('loading');
  });
});
