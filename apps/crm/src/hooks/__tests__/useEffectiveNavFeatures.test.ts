import { describe, expect, it } from 'vitest';
import { buildEffectiveNavFeatures } from '../useEffectiveNavFeatures';

describe('buildEffectiveNavFeatures', () => {
  it('keeps the nav item off when the flag is off and there are no automations', () => {
    const result = buildEffectiveNavFeatures({ feature_instagram_automation: false }, false);
    expect(result).toEqual({ feature_instagram_automation: false });
  });

  it('turns the nav item on when the flag is off but the workspace already has automations', () => {
    const result = buildEffectiveNavFeatures({ feature_instagram_automation: false }, true);
    expect(result).toEqual({ feature_instagram_automation: true });
  });

  it('keeps the nav item on when the flag is already on, regardless of automation count', () => {
    const onNoAutomations = buildEffectiveNavFeatures(
      { feature_instagram_automation: true },
      false,
    );
    const onWithAutomations = buildEffectiveNavFeatures(
      { feature_instagram_automation: true },
      true,
    );
    expect(onNoAutomations).toEqual({ feature_instagram_automation: true });
    expect(onWithAutomations).toEqual({ feature_instagram_automation: true });
  });

  it('passes null features through unchanged (still loading / unlimited workspace)', () => {
    expect(buildEffectiveNavFeatures(null, true)).toBeNull();
  });

  it('leaves every other feature flag untouched', () => {
    const result = buildEffectiveNavFeatures(
      { feature_instagram_automation: false, feature_leads: true, feature_financial: false },
      true,
    );
    expect(result).toEqual({
      feature_instagram_automation: true,
      feature_leads: true,
      feature_financial: false,
    });
  });
});
