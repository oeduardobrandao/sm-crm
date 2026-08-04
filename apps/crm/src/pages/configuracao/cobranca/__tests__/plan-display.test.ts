import { describe, it, expect } from 'vitest';
import {
  isInternalPlan,
  resolveCurrentPlanId,
  isPlanVisible,
  canUpgradeTo,
  isSelectableTrialPlan,
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
});
