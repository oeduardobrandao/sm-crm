import { describe, expect, it } from 'vitest';
import { buildWorkspaceExportRows } from '../workspaces-export';
import type { WorkspaceSummary } from '../../lib/api';

function baseWorkspace(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'ws-1',
    name: 'Acme',
    logo_url: null,
    created_at: '2026-01-15T10:00:00Z',
    last_activity_at: '2026-08-20T12:00:00Z',
    owner: {
      name: 'Ana',
      email: 'ana@example.com',
      telefone: '11999999999',
      marketing_opt_in: true,
    },
    member_count: 3,
    client_count: 5,
    plan_name: 'Pro',
    has_overrides: false,
    subscription: {
      status: 'active',
      plan_name: 'Pro',
      billing_interval: 'month',
      amount_cents: 9900,
      currency: 'brl',
      interval: 'month',
      discount_label: null,
      failed_payment_count: 0,
      current_period_end: null,
    },
    ...overrides,
  };
}

describe('buildWorkspaceExportRows', () => {
  it('normalizes an annual subscription amount to a monthly figure, keeping the raw amount too', () => {
    const rows = buildWorkspaceExportRows([
      baseWorkspace({
        subscription: {
          status: 'active',
          plan_name: 'Pro',
          billing_interval: 'year',
          amount_cents: 180001,
          currency: 'brl',
          interval: 'year',
          discount_label: null,
          failed_payment_count: 0,
          current_period_end: null,
        },
      }),
    ]);
    expect(rows[0].billing_interval).toBe('year');
    expect(rows[0].subscription_amount_brl).toBe(1800.01);
    expect(rows[0].monthly_amount_brl).toBe(150);
  });

  it('keys billing_interval and amount fields off subscription.interval, not subscription.billing_interval', () => {
    // billing_interval and interval deliberately disagree here. If the mapping
    // function ever reads sub.billing_interval instead of sub.interval, this
    // test must fail -- unlike the other fixtures, which always set both
    // fields to the same value and so can't tell the two apart.
    const rows = buildWorkspaceExportRows([
      baseWorkspace({
        subscription: {
          status: 'active',
          plan_name: 'Pro',
          billing_interval: 'month',
          amount_cents: 120000,
          currency: 'brl',
          interval: 'year',
          discount_label: null,
          failed_payment_count: 0,
          current_period_end: null,
        },
      }),
    ]);
    expect(rows[0].billing_interval).toBe('year');
    expect(rows[0].subscription_amount_brl).toBe(1200);
    expect(rows[0].monthly_amount_brl).toBe(100);
  });

  it('keeps a monthly subscription amount equal to its normalized monthly amount', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace()]);
    expect(rows[0].subscription_amount_brl).toBe(99);
    expect(rows[0].monthly_amount_brl).toBe(99);
  });

  it('blanks contact and consent columns when the workspace has no owner', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace({ owner: null })]);
    expect(rows[0].owner_name).toBe('');
    expect(rows[0].owner_email).toBe('');
    expect(rows[0].owner_telefone).toBe('');
    expect(rows[0].owner_marketing_opt_in).toBe('no');
  });

  it('blanks subscription columns when the workspace has no subscription', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace({ subscription: null })]);
    expect(rows[0].subscription_status).toBe('');
    expect(rows[0].billing_interval).toBe('');
    expect(rows[0].subscription_amount_brl).toBe('');
    expect(rows[0].monthly_amount_brl).toBe('');
  });

  it('blanks all five subscription columns for a bare-customer row (status: null), not just a null subscription', () => {
    // A workspace_subscriptions row can exist (a Stripe customer with no real
    // subscription yet) with status: null. hasSubscription() gates on a truthy
    // status, not just on the object being non-null -- this must not export a
    // populated-looking row for a workspace that has no actual subscription.
    const rows = buildWorkspaceExportRows([
      baseWorkspace({
        subscription: {
          status: null,
          plan_name: null,
          billing_interval: null,
          amount_cents: null,
          currency: null,
          interval: null,
          discount_label: null,
          failed_payment_count: 0,
          current_period_end: null,
        },
      }),
    ]);
    expect(rows[0].subscription_status).toBe('');
    expect(rows[0].billing_interval).toBe('');
    expect(rows[0].subscription_amount_brl).toBe('');
    expect(rows[0].monthly_amount_brl).toBe('');
    expect(rows[0].discount_label).toBe('');
  });

  it('formats created/last-activity as plain ISO dates, not locale strings', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace()]);
    expect(rows[0].created_at).toBe('2026-01-15');
    expect(rows[0].last_activity_at).toBe('2026-08-20');
  });

  it('renders overrides as yes/no', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace({ has_overrides: true })]);
    expect(rows[0].has_overrides).toBe('yes');
  });
});
