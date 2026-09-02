import { useQuery } from '@tanstack/react-query';
import { getEquipeChatUnread } from '@/store';
import { useWorkspaceLimits } from './useWorkspaceLimits';

/** Total de mensagens de equipe nao lidas (badge). Poll de 60s; desligado
 * enquanto feature_team_chat esta off ou desconhecida. */
export function useEquipeChatUnread(): number {
  const { features } = useWorkspaceLimits();
  const enabled = features?.feature_team_chat === true;
  const { data } = useQuery({
    queryKey: ['equipe-chat-unread'],
    queryFn: getEquipeChatUnread,
    enabled,
    refetchInterval: 60_000,
  });
  return enabled && data ? data : 0;
}
