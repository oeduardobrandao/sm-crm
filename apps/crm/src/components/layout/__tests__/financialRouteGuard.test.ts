import { describe, it, expect } from 'vitest';
import {
  isFinancialPath,
  isContractPath,
  isLayoutGuardedPath,
  financialGuardOutcome,
  contractGuardOutcome,
} from '../AppLayout';

describe('isFinancialPath', () => {
  it('matches the financial routes and their children', () => {
    expect(isFinancialPath('/financeiro')).toBe(true);
    expect(isFinancialPath('/financeiro/42')).toBe(true);
  });

  // /contratos used to be a FINANCIAL_PATHS entry, so the whole route was
  // decided by the FINANCEIRO capability while nav and RLS keyed on
  // CONTRATOS. It now has its own guard.
  it('no longer claims /contratos', () => {
    expect(isFinancialPath('/contratos')).toBe(false);
    expect(isFinancialPath('/contratos/42')).toBe(false);
  });

  it('does not match unrelated routes', () => {
    expect(isFinancialPath('/dashboard')).toBe(false);
    expect(isFinancialPath('/equipe')).toBe(false);
    expect(isFinancialPath('/clientes/1')).toBe(false);
  });

  // App.tsx declares routes lowercase with no `caseSensitive`, so React
  // Router itself renders /Financeiro the same as /financeiro. This guard
  // must treat the two identically instead of letting the capitalized form
  // slip past as "not a financial path".
  it('treats a capitalized path exactly like its lowercase form', () => {
    expect(isFinancialPath('/Financeiro')).toBe(true);
  });
});

describe('isContractPath', () => {
  it('matches the contract route and its children', () => {
    expect(isContractPath('/contratos')).toBe(true);
    expect(isContractPath('/contratos/42')).toBe(true);
  });

  it('does not match the financial route or unrelated routes', () => {
    expect(isContractPath('/financeiro')).toBe(false);
    expect(isContractPath('/dashboard')).toBe(false);
  });

  it('treats a capitalized path exactly like its lowercase form', () => {
    expect(isContractPath('/Contratos/42')).toBe(true);
  });
});

// ProtectedRoute skips its redirect gate on exactly these paths, because
// AppLayout renders a dedicated restriction screen for them instead.
describe('isLayoutGuardedPath', () => {
  it('covers both guarded route families', () => {
    expect(isLayoutGuardedPath('/financeiro')).toBe(true);
    expect(isLayoutGuardedPath('/contratos')).toBe(true);
    expect(isLayoutGuardedPath('/Contratos/42')).toBe(true);
  });

  it('does not cover ordinary routes', () => {
    expect(isLayoutGuardedPath('/dashboard')).toBe(false);
    expect(isLayoutGuardedPath('/equipe')).toBe(false);
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

  // The whole point of the split: a member with contratos but no financeiro
  // must not be bounced off /contratos by the financial guard.
  it('ignores /contratos entirely now', () => {
    expect(financialGuardOutcome('/contratos', false)).toBe('content');
  });
});

describe('contractGuardOutcome', () => {
  it('renders content on a non-contract route regardless of capability', () => {
    expect(contractGuardOutcome('/dashboard', false)).toBe('content');
    expect(contractGuardOutcome('/financeiro', false)).toBe('content');
  });

  it('renders content on the contract route when authorized', () => {
    expect(contractGuardOutcome('/contratos', true)).toBe('content');
    expect(contractGuardOutcome('/contratos/42', true)).toBe('content');
  });

  it('denies on the contract route when explicitly restricted', () => {
    expect(contractGuardOutcome('/contratos', false)).toBe('denied');
  });

  // Same neutral-on-unknown asymmetry as the financial guard above.
  it('shows loading, not denial, while the capability is unknown', () => {
    expect(contractGuardOutcome('/contratos', 'unknown')).toBe('loading');
  });
});
