import { useQuery } from '@tanstack/react-query';
import { fetchMensagensUnread } from '../api';

/** Polls the Mensagens unread count for the nav badge. Disabled when the
 * feature flag is off so gated workspaces never hit the endpoint. */
export function useMensagensUnreadCount(token: string, enabled: boolean): number {
  const { data } = useQuery({
    queryKey: ['hub-mensagens-count', token],
    queryFn: () => fetchMensagensUnread(token),
    enabled,
    refetchInterval: 60_000,
  });
  return data?.unread ?? 0;
}
