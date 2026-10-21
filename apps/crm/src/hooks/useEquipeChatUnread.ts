import { useQuery } from '@tanstack/react-query';
import { getEquipeChatUnread } from '@/store';
import { useWorkspaceLimits } from './useWorkspaceLimits';

/** Total de mensagens de equipe nao lidas (badge). Poll de 60s; desligado
 * enquanto feature_team_chat esta off ou desconhecida. An unlimited workspace
 * never gets a `features` payload (see useWorkspaceLimits), so it's carved
 * out explicitly -- otherwise it'd read as off despite MensagensPage already
 * rendering team chat for it. */
export function useEquipeChatUnread(): number {
  const { features, isUnlimited } = useWorkspaceLimits();
  const enabled = isUnlimited || features?.feature_team_chat === true;
  const { data } = useQuery({
    queryKey: ['equipe-chat-unread'],
    queryFn: getEquipeChatUnread,
    enabled,
    refetchInterval: 60_000,
  });
  return enabled && data ? data : 0;
}
