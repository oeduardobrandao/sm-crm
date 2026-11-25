import { useQuery } from '@tanstack/react-query';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { getEffectivePlanWithSource } from '@/services/billing';

export type ReadOnlyGrandfatherFlag = 'feature_financial' | 'feature_contracts';

export interface ReadOnlyGrandfatherState {
  /** The module opens for consultation only: flag off and the reverse trial ended by downgrade. */
  readOnly: boolean;
  /** Still deciding (flag off, effective plan loading): render a skeleton, not the paywall. */
  pending: boolean;
}

/**
 * Financeiro and Contratos after a reverse trial (spec Part 5): an ex-trial workspace on Free
 * (`reverse_trial_outcome = 'downgraded'`) keeps reading what it created there, with every
 * create, edit, delete and status action hidden. Other Free workspaces keep the locked screen.
 * The database enforces the edits too (`before update` plan triggers).
 */
export function useReadOnlyGrandfather(flag: ReadOnlyGrandfatherFlag): ReadOnlyGrandfatherState {
  const { features, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();
  const flagOff = !limitsLoading && !isUnlimited && features?.[flag] === false;
  const plan = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: getEffectivePlanWithSource,
    enabled: flagOff,
  });
  if (!flagOff) return { readOnly: false, pending: false };
  if (plan.data === undefined) return { readOnly: false, pending: !plan.isError };
  // Any plan without the flag, not only Free: an ex-trial workspace that later picks a plan
  // without Financeiro or Contratos keeps reading what it created during the trial.
  const rt = plan.data.reverseTrial;
  return {
    readOnly: rt?.outcome === 'downgraded' && plan.data.planSource !== 'trial',
    pending: false,
  };
}
