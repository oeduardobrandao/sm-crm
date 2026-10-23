import { useWorkspaceLimits } from './useWorkspaceLimits';

/**
 * Whether the Financeiro v2 (rentabilidade) surfaces are on for this workspace:
 * the financeiro module must be available AND the rollout flag explicitly on.
 * `feature_financeiro_v2` is read only as `=== true` (fail-closed while the
 * workspace-limits function has not been redeployed with the column).
 */
export function useFinanceiroV2(): { ativo: boolean; isLoading: boolean } {
  const { features, isLoading } = useWorkspaceLimits();
  const ativo = features?.feature_financial !== false && features?.feature_financeiro_v2 === true;
  return { ativo, isLoading };
}
