import { useQuery } from '@tanstack/react-query';
import { getDeposits } from '../../lib/api';
import { useIsPhone } from '../../hooks/useIsPhone';
import { DepositsDesktop } from './DepositsDesktop';
import { DepositsPhone } from './DepositsPhone';

const STALE_MS = 5 * 60 * 1000;

/**
 * Depósitos: when and how much each provider will deposit to the bank. Live read, nothing
 * persisted. Each provider card owns its state so a Pagar.me outage never hides Stripe.
 */
export function DepositsSection() {
  const isPhone = useIsPhone();
  const query = useQuery({
    queryKey: ['admin', 'deposits'],
    queryFn: getDeposits,
    staleTime: STALE_MS,
  });
  const view = {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: () => {
      void query.refetch();
    },
  };
  return isPhone ? <DepositsPhone {...view} /> : <DepositsDesktop {...view} />;
}
