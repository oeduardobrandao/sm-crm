import { describe, it, expect } from 'vitest';
import { isInternalPlan, resolveCurrentPlanId, isPlanVisible, canUpgradeTo } from '../plan-display';

describe('plan-display', () => {
  describe('isInternalPlan', () => {
    it('treats lifetime as internal', () => {
      expect(isInternalPlan('lifetime')).toBe(true);
    });
    it('treats catalog plans as not internal', () => {
      expect(isInternalPlan('free')).toBe(false);
      expect(isInternalPlan('agency')).toBe(false);
      expect(isInternalPlan('scale')).toBe(false);
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
      expect(resolveCurrentPlanId(null, 'agency')).toBe('agency');
      expect(resolveCurrentPlanId(null, null)).toBe('free');
      expect(resolveCurrentPlanId(undefined, undefined)).toBe('free');
    });
  });

  describe('isPlanVisible', () => {
    it('hides lifetime from a workspace not on it', () => {
      expect(isPlanVisible('lifetime', 'agency')).toBe(false);
      expect(isPlanVisible('lifetime', 'free')).toBe(false);
    });
    it('shows lifetime to the workspace that is on it', () => {
      expect(isPlanVisible('lifetime', 'lifetime')).toBe(true);
    });
    it('always shows catalog plans', () => {
      expect(isPlanVisible('agency', 'free')).toBe(true);
      expect(isPlanVisible('free', 'lifetime')).toBe(true);
    });
  });

  describe('canUpgradeTo', () => {
    it('offers paid plans to a free workspace with no subscription', () => {
      expect(canUpgradeTo('agency', 'free', false)).toBe(true);
      expect(canUpgradeTo('scale', 'free', false)).toBe(true);
    });
    it('never offers an upgrade on the current plan', () => {
      expect(canUpgradeTo('free', 'free', false)).toBe(false);
      expect(canUpgradeTo('agency', 'agency', false)).toBe(false);
    });
    it('never offers free as an upgrade', () => {
      expect(canUpgradeTo('free', 'agency', false)).toBe(false);
    });
    it('offers no upgrades to a workspace on an internal/comp plan (lifetime)', () => {
      expect(canUpgradeTo('agency', 'lifetime', false)).toBe(false);
      expect(canUpgradeTo('scale', 'lifetime', false)).toBe(false);
    });
    it('offers no upgrades when there is an active subscription (managed via portal)', () => {
      expect(canUpgradeTo('scale', 'starter', true)).toBe(false);
    });
  });
});
