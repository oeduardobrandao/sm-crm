import { describe, expect, it } from 'vitest';
import { buildPayingWorkspaceExportRows, buildTrialExportRows } from '../dashboard-export';
import type { PayingWorkspace, TrialWorkspace } from '../../lib/api';

function payingWorkspace(overrides: Partial<PayingWorkspace> = {}): PayingWorkspace {
  return {
    workspace_id: 'ws-1',
    name: 'Acme',
    plan_name: 'Pro',
    status: 'active',
    interval: 'month',
    monthly_cents: 9900,
    discount_label: null,
    amount_source: 'stripe',
    owner_name: 'Ana',
    owner_email: 'ana@example.com',
    owner_telefone: '11999999999',
    owner_marketing_opt_in: true,
    ...overrides,
  };
}

function trialWorkspace(overrides: Partial<TrialWorkspace> = {}): TrialWorkspace {
  return {
    workspace_id: 'ws-2',
    name: 'Beta',
    plan_name: 'Pro',
    interval: 'year',
    trial_ends_at: '2026-09-05T00:00:00Z',
    monthly_cents: 8250,
    owner_name: 'Bruno',
    owner_email: 'bruno@example.com',
    owner_telefone: null,
    owner_marketing_opt_in: false,
    ...overrides,
  };
}

describe('buildPayingWorkspaceExportRows', () => {
  it('maps owner contact and consent, and converts monthly_cents to reais', () => {
    const rows = buildPayingWorkspaceExportRows([payingWorkspace()]);
    expect(rows[0].workspace_name).toBe('Acme');
    expect(rows[0].owner_name).toBe('Ana');
    expect(rows[0].owner_email).toBe('ana@example.com');
    expect(rows[0].owner_telefone).toBe('11999999999');
    expect(rows[0].owner_marketing_opt_in).toBe('yes');
    expect(rows[0].monthly_amount_brl).toBe(99);
  });

  it('blanks owner fields that are null', () => {
    const rows = buildPayingWorkspaceExportRows([
      payingWorkspace({ owner_name: null, owner_email: null, owner_telefone: null }),
    ]);
    expect(rows[0].owner_name).toBe('');
    expect(rows[0].owner_email).toBe('');
    expect(rows[0].owner_telefone).toBe('');
  });
});

describe('buildTrialExportRows', () => {
  it('maps owner contact/consent and formats trial_ends_at as a plain ISO date', () => {
    const rows = buildTrialExportRows([trialWorkspace()]);
    expect(rows[0].workspace_name).toBe('Beta');
    expect(rows[0].owner_name).toBe('Bruno');
    expect(rows[0].owner_email).toBe('bruno@example.com');
    expect(rows[0].owner_telefone).toBe('');
    expect(rows[0].owner_marketing_opt_in).toBe('no');
    expect(rows[0].trial_ends_at).toBe('2026-09-05');
    expect(rows[0].monthly_amount_brl).toBe(82.5);
  });

  it('blanks trial_ends_at when null', () => {
    const rows = buildTrialExportRows([trialWorkspace({ trial_ends_at: null })]);
    expect(rows[0].trial_ends_at).toBe('');
  });

  it('blanks monthly_amount_brl when monthly_cents is null', () => {
    const rows = buildTrialExportRows([trialWorkspace({ monthly_cents: null })]);
    expect(rows[0].monthly_amount_brl).toBe('');
  });
});
