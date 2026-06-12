import { describe, it, expect } from 'vitest';
import { mapEntitlementError } from '../entitlement-errors';

describe('mapEntitlementError', () => {
  it('maps a raised count-limit message', () => {
    const r = mapEntitlementError({ message: 'plan_limit_exceeded:max_clients' });
    expect(r).toEqual({ kind: 'limit', key: 'max_clients', label: 'clientes' });
  });
  it('maps a 403 feature_disabled JSON body', () => {
    const r = mapEntitlementError({ error: 'feature_disabled', feature: 'feature_leads' });
    expect(r).toEqual({ kind: 'feature', key: 'feature_leads', label: 'Leads' });
  });
  it('maps a quota_exceeded body', () => {
    const r = mapEntitlementError({ error: 'quota_exceeded', used: 9, quota: 10 });
    expect(r).toEqual({
      kind: 'quota',
      key: 'storage',
      label: 'armazenamento',
      used: 9,
      quota: 10,
    });
  });
  it('returns null for unrelated errors', () => {
    expect(mapEntitlementError({ message: 'network error' })).toBeNull();
    expect(mapEntitlementError(null)).toBeNull();
  });
});
