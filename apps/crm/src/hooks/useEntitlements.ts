import { useWorkspaceLimits } from './useWorkspaceLimits';

export function computeAtLimit(count: number, limit: number | null): boolean {
  if (limit === null) return false; // unlimited
  return count >= limit;
}

/** Thin wrapper over useWorkspaceLimits adding feature + at-limit helpers. */
export function useEntitlements() {
  const { limits, features, planName, isLoading } = useWorkspaceLimits();
  return {
    isLoading,
    planName,
    features,
    limits,
    hasFeature: (flag: string): boolean => features?.[flag as keyof typeof features] !== false,
    isAtLimit: (limitKey: string, count: number): boolean =>
      computeAtLimit(count, (limits?.[limitKey as keyof typeof limits] as number | null) ?? null),
  };
}
