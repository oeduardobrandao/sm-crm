import { type Plan, RESOURCE_LIMIT_KEYS, RATE_LIMIT_KEYS, FEATURE_FLAG_KEYS } from '../lib/api';

const ALL_LIMIT_KEYS = [...RESOURCE_LIMIT_KEYS, ...RATE_LIMIT_KEYS];

export interface OverridesPayload {
  resource_overrides: Record<string, number>;
  feature_overrides: Record<string, boolean>;
}

// Always returns plain objects (never undefined for an empty diff) so the caller
// sends `{}` to clear stale overrides when an edit is toggled back to the plan's
// own default — omitting the key entirely leaves the previous override untouched
// server-side, which is what made deactivating a workspace-overridden feature
// (e.g. Estúdio) silently no-op.
export function computeOverridesPayload(
  plan: Plan,
  resourceEdits: Record<string, string>,
  featureEdits: Record<string, boolean>,
): OverridesPayload {
  const resource_overrides: Record<string, number> = {};
  for (const key of ALL_LIMIT_KEYS) {
    const parsed = parseInt(resourceEdits[key], 10);
    const planVal = (plan[key as keyof Plan] as number | null) ?? 0;
    if (!isNaN(parsed) && parsed !== planVal) {
      resource_overrides[key] = parsed;
    }
  }

  const feature_overrides: Record<string, boolean> = {};
  for (const key of FEATURE_FLAG_KEYS) {
    const planVal = (plan[key] as boolean) ?? false;
    if (featureEdits[key] !== planVal) {
      feature_overrides[key] = featureEdits[key];
    }
  }

  return { resource_overrides, feature_overrides };
}
