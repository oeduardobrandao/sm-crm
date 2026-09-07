import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getPortalFill, type PortalFill } from '@/store';
import { useHubRoleRestricted } from './HubRoleGate';

/**
 * Backs the "O que o cliente vê" panel on AcessoPage. Same restriction as the
 * hub-token and workspace-slug queries next to it there: an agent must never
 * fetch this -- HubRoleGate hides the panel from them regardless, but firing
 * the request would still leak the shape of the client's portal fill into an
 * agent's network log and query cache. `enabled` follows
 * `useHubRoleRestricted()` directly so callers can't forget to gate it.
 * `HubRoleGate` stays the single definition of "restricted" -- this only
 * reads it, never reimplements it.
 */
export function usePortalFill(clienteId: number): UseQueryResult<PortalFill> {
  const isRestricted = useHubRoleRestricted();
  return useQuery({
    queryKey: ['hub-portal-fill', clienteId],
    queryFn: () => getPortalFill(clienteId),
    enabled: !isRestricted,
  });
}
