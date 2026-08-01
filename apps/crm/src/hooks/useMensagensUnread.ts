import { useQuery } from '@tanstack/react-query';
import { getMensagensUnread } from '@/store';
import { unreadTotal } from '@/pages/mensagens/mensagensLogic';
import { useWorkspaceLimits } from './useWorkspaceLimits';

/** Total client-authored items newer than this user's read marker. Polled for
 * the sidebar badge; disabled while feature_mensagens is off or unknown. */
export function useMensagensUnread(): number {
  const { features } = useWorkspaceLimits();
  const enabled = features?.feature_mensagens === true;
  const { data } = useQuery({
    queryKey: ['mensagens-unread'],
    queryFn: getMensagensUnread,
    enabled,
    refetchInterval: 60_000,
  });
  return enabled && data ? unreadTotal(data) : 0;
}
