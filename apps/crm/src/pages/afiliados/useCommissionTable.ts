import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listPublicPricingPlans } from '@/services/billing';
import { listCommissionRules } from '@/services/affiliates';
import { buildCommissionTable } from './simulator';

/** Tabela de comissões por plano (preços reais + regras do programa). */
export function useCommissionTable() {
  const plans = useQuery({
    queryKey: ['public-pricing-plans'],
    queryFn: listPublicPricingPlans,
    staleTime: 10 * 60 * 1000,
  });
  const rules = useQuery({
    queryKey: ['affiliate-commission-rules'],
    queryFn: listCommissionRules,
    staleTime: 10 * 60 * 1000,
  });
  const rows = useMemo(
    () => buildCommissionTable(plans.data ?? [], rules.data ?? []),
    [plans.data, rules.data],
  );
  return {
    rows,
    isLoading: plans.isLoading || rules.isLoading,
    isError: plans.isError || rules.isError,
  };
}
