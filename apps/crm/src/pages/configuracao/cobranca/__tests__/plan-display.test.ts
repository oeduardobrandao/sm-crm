import { describe, it, expect } from 'vitest';
import {
  isInternalPlan,
  resolveCurrentPlanId,
  isPlanVisible,
  canUpgradeTo,
  isSelectableTrialPlan,
  checkoutBlocked,
  switchEligible,
  ceilPeriodEndToUtcDate,
} from '../plan-display';

describe('plan-display', () => {
  describe('isInternalPlan', () => {
    it('treats lifetime as internal', () => {
      expect(isInternalPlan('lifetime')).toBe(true);
    });
    it('treats catalog plans as not internal', () => {
      expect(isInternalPlan('free')).toBe(false);
      expect(isInternalPlan('pro')).toBe(false);
      expect(isInternalPlan('max')).toBe(false);
    });
    it('handles null/undefined', () => {
      expect(isInternalPlan(null)).toBe(false);
      expect(isInternalPlan(undefined)).toBe(false);
    });
  });

  describe('resolveCurrentPlanId', () => {
    it('prefers the effective plan id (incl. comp overrides like lifetime)', () => {
      // Lifetime has no Stripe subscription, so the subscription plan is null.
      expect(resolveCurrentPlanId('lifetime', null)).toBe('lifetime');
    });
    it('falls back to the subscription plan, then free', () => {
      expect(resolveCurrentPlanId(null, 'pro')).toBe('pro');
      expect(resolveCurrentPlanId(null, null)).toBe('free');
      expect(resolveCurrentPlanId(undefined, undefined)).toBe('free');
    });
  });

  describe('isPlanVisible', () => {
    it('hides lifetime from a workspace not on it', () => {
      expect(isPlanVisible('lifetime', 'pro')).toBe(false);
      expect(isPlanVisible('lifetime', 'free')).toBe(false);
    });
    it('shows lifetime to the workspace that is on it', () => {
      expect(isPlanVisible('lifetime', 'lifetime')).toBe(true);
    });
    it('always shows catalog plans', () => {
      expect(isPlanVisible('pro', 'free')).toBe(true);
      expect(isPlanVisible('free', 'lifetime')).toBe(true);
    });
  });

  describe('canUpgradeTo', () => {
    it('offers paid plans to a free workspace with no subscription', () => {
      expect(canUpgradeTo('pro', 'free', false)).toBe(true);
      expect(canUpgradeTo('max', 'free', false)).toBe(true);
    });
    it('never offers an upgrade on the current plan', () => {
      expect(canUpgradeTo('free', 'free', false)).toBe(false);
      expect(canUpgradeTo('pro', 'pro', false)).toBe(false);
    });
    it('never offers free as an upgrade', () => {
      expect(canUpgradeTo('free', 'pro', false)).toBe(false);
    });
    it('offers no upgrades to a workspace on an internal/comp plan (lifetime)', () => {
      expect(canUpgradeTo('pro', 'lifetime', false)).toBe(false);
      expect(canUpgradeTo('max', 'lifetime', false)).toBe(false);
    });
    it('offers no upgrades when there is an active subscription (managed via portal)', () => {
      expect(canUpgradeTo('max', 'start', true)).toBe(false);
    });
  });

  describe('isSelectableTrialPlan', () => {
    it('accepts a paid self-serve plan', () => {
      expect(isSelectableTrialPlan({ id: 'pro', price_brl: 9990, price_brl_annual: null })).toBe(
        true,
      );
    });

    it('rejects Free — declining is a link, not a card', () => {
      expect(isSelectableTrialPlan({ id: 'free', price_brl: 0, price_brl_annual: null })).toBe(
        false,
      );
    });

    it('rejects internal comp plans', () => {
      expect(isSelectableTrialPlan({ id: 'lifetime', price_brl: 0, price_brl_annual: null })).toBe(
        false,
      );
    });

    it('rejects a zero-priced plan that is not Free', () => {
      expect(isSelectableTrialPlan({ id: 'beta', price_brl: 0, price_brl_annual: null })).toBe(
        false,
      );
    });

    it('rejects a plan with no price configured', () => {
      expect(isSelectableTrialPlan({ id: 'beta', price_brl: null, price_brl_annual: null })).toBe(
        false,
      );
    });

    it('accepts an annual-only plan (monthly price is zero)', () => {
      expect(isSelectableTrialPlan({ id: 'pro', price_brl: 0, price_brl_annual: 95900 })).toBe(
        true,
      );
    });

    it('accepts a plan with a price on either interval', () => {
      expect(isSelectableTrialPlan({ id: 'max', price_brl: 19990, price_brl_annual: 219890 })).toBe(
        true,
      );
    });
  });

  describe('checkoutBlocked', () => {
    const now = new Date('2026-08-13T00:00:00.000Z');

    it('handles no subscription (never subscribed)', () => {
      expect(checkoutBlocked(null, now)).toBe(false);
      expect(checkoutBlocked(undefined, now)).toBe(false);
    });

    it('blocks in-force statuses regardless of provider', () => {
      expect(checkoutBlocked({ status: 'active' }, now)).toBe(true);
      expect(checkoutBlocked({ status: 'trialing' }, now)).toBe(true);
      expect(checkoutBlocked({ status: 'past_due' }, now)).toBe(true);
    });

    it('blocks unpaid (Stripe terminal dunning, still an existing subscription)', () => {
      expect(checkoutBlocked({ status: 'unpaid' }, now)).toBe(true);
    });

    it('blocks a canceled row that is still paid through the current period', () => {
      expect(
        checkoutBlocked(
          {
            status: 'canceled',
            cancel_at_period_end: true,
            current_period_end: '2026-09-12T00:00:00.000Z',
          },
          now,
        ),
      ).toBe(true);
    });

    it('does not block a canceled row without cancel_at_period_end', () => {
      expect(
        checkoutBlocked(
          {
            status: 'canceled',
            cancel_at_period_end: false,
            current_period_end: '2026-09-12T00:00:00.000Z',
          },
          now,
        ),
      ).toBe(false);
    });

    it('does not block a canceled row whose current_period_end already passed', () => {
      expect(
        checkoutBlocked(
          {
            status: 'canceled',
            cancel_at_period_end: true,
            current_period_end: '2026-01-01T00:00:00.000Z',
          },
          now,
        ),
      ).toBe(false);
    });

    it('does not block a canceled row with no current_period_end', () => {
      expect(
        checkoutBlocked(
          { status: 'canceled', cancel_at_period_end: true, current_period_end: null },
          now,
        ),
      ).toBe(false);
    });

    it('does not block a malformed current_period_end (degrades to not-blocked, never throws)', () => {
      expect(
        checkoutBlocked(
          { status: 'canceled', cancel_at_period_end: true, current_period_end: 'not-a-real-date' },
          now,
        ),
      ).toBe(false);
    });

    it('does not block other terminal statuses (free to re-subscribe)', () => {
      expect(checkoutBlocked({ status: 'incomplete_expired' }, now)).toBe(false);
      expect(checkoutBlocked({ status: null }, now)).toBe(false);
    });
  });

  describe('switchEligible', () => {
    const base = { provider: 'stripe', status: 'active', billingInterval: 'month' };
    it('mensal stripe active/trialing é elegível (provider null = stripe legado)', () => {
      expect(switchEligible(base)).toBe(true);
      expect(switchEligible({ ...base, status: 'trialing' })).toBe(true);
      expect(switchEligible({ ...base, provider: null })).toBe(true);
      expect(switchEligible({ ...base, billingInterval: null })).toBe(true);
    });
    it('past_due, pagarme, anual e ausência nunca são elegíveis', () => {
      expect(switchEligible({ ...base, status: 'past_due' })).toBe(false);
      expect(switchEligible({ ...base, status: 'unpaid' })).toBe(false);
      expect(switchEligible({ ...base, status: 'canceled' })).toBe(false);
      expect(switchEligible({ ...base, provider: 'pagarme' })).toBe(false);
      expect(switchEligible({ ...base, billingInterval: 'year' })).toBe(false);
      expect(switchEligible(null)).toBe(false);
    });
  });

  describe('ceilPeriodEndToUtcDate', () => {
    // MESMOS casos do teste Deno de ceilToUtcMidnightDate: as duas implementações precisam
    // concordar ou a data prometida no form diverge do start_at real.
    it('meio-dia sobe para o próximo midnight UTC', () => {
      expect(ceilPeriodEndToUtcDate('2026-09-15T14:23:11Z')).toBe('2026-09-16');
    });
    it('midnight exato fica', () => {
      expect(ceilPeriodEndToUtcDate('2026-09-15T00:00:00.000Z')).toBe('2026-09-15');
    });
    it('virada de mês', () => {
      expect(ceilPeriodEndToUtcDate('2026-08-31T23:59:59Z')).toBe('2026-09-01');
    });
    it('iso inválido -> null', () => {
      expect(ceilPeriodEndToUtcDate('not-a-date')).toBeNull();
    });
  });
});
