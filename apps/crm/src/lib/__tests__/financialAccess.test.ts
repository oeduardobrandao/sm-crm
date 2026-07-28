import { describe, it, expect } from 'vitest';
import { formatFinancialBRL, MASKED_BRL, deriveFinancialAccess } from '../financialAccess';
import type { MyMembership } from '@/store/workspace';

describe('formatFinancialBRL', () => {
  it('formats the value when access is literally true', () => {
    expect(formatFinancialBRL(1234.5, true)).toBe(
      (1234.5).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    );
  });

  it('masks when access is false', () => {
    expect(formatFinancialBRL(1234.5, false)).toBe(MASKED_BRL);
  });

  // Values fail CLOSED: rendering a real figure to someone who may be
  // restricted is the harm, so anything that is not literal `true` masks.
  it('masks while access is still unknown', () => {
    expect(formatFinancialBRL(1234.5, 'unknown')).toBe(MASKED_BRL);
  });

  it('treats null and undefined as zero when authorized', () => {
    const zero = (0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    expect(formatFinancialBRL(null, true)).toBe(zero);
    expect(formatFinancialBRL(undefined, true)).toBe(zero);
  });

  it('masks null when not authorized rather than showing R$ 0', () => {
    expect(formatFinancialBRL(null, false)).toBe(MASKED_BRL);
  });
});

// Frontend mirror of the SQL truth table for `public.can_see_financials()`:
// owners always see financials regardless of the column, agents never do
// regardless of the column, admins follow the column, and no membership is
// 'unknown'. `can_see_financials` on workspace_members is meaningful for
// admins ONLY — assigning it raw for any other role is the bug this guards.
describe('deriveFinancialAccess', () => {
  it('owner sees financials even when the column is false', () => {
    const membership: MyMembership = { role: 'owner', can_see_financials: false };
    expect(deriveFinancialAccess(membership)).toBe(true);
  });

  it('owner sees financials when the column is true', () => {
    const membership: MyMembership = { role: 'owner', can_see_financials: true };
    expect(deriveFinancialAccess(membership)).toBe(true);
  });

  it('admin follows the column when true', () => {
    const membership: MyMembership = { role: 'admin', can_see_financials: true };
    expect(deriveFinancialAccess(membership)).toBe(true);
  });

  it('admin follows the column when false', () => {
    const membership: MyMembership = { role: 'admin', can_see_financials: false };
    expect(deriveFinancialAccess(membership)).toBe(false);
  });

  it('agent never sees financials even when the column is true (the shipped bug)', () => {
    const membership: MyMembership = { role: 'agent', can_see_financials: true };
    expect(deriveFinancialAccess(membership)).toBe(false);
  });

  it('agent never sees financials when the column is false', () => {
    const membership: MyMembership = { role: 'agent', can_see_financials: false };
    expect(deriveFinancialAccess(membership)).toBe(false);
  });

  it('no membership resolves to unknown', () => {
    expect(deriveFinancialAccess(null)).toBe('unknown');
  });

  it('denies rather than falls through for a role outside the three known ones', () => {
    const membership = { role: 'superadmin', can_see_financials: true } as unknown as MyMembership;
    expect(deriveFinancialAccess(membership)).toBe(false);
  });
});
