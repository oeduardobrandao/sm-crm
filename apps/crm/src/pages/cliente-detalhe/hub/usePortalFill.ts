import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getPortalFill, type PortalFill } from '@/store';
import { useHubPortalDataEnabled } from './HubRoleGate';

/**
 * Backs the "O que o cliente vê" panel on AcessoPage. Same restriction as the
 * hub-token and workspace-slug queries next to it there: an agent must never
 * fetch this -- HubRoleGate hides the panel from them regardless, but firing
 * the request would still leak the shape of the client's portal fill into an
 * agent's network log and query cache. `enabled` follows
 * `useHubPortalDataEnabled()` directly so callers can't forget to gate it --
 * and that hook is tri-state-aware: it is only `true` once
 * `can('configuracoes','editar')` has actually resolved to `true`, so the
 * request also stays parked while membership is still 'unknown'.
 * `HubRoleGate` stays the single definition of "restricted" -- this only
 * reads it, never reimplements it.
 */
export function usePortalFill(clienteId: number): UseQueryResult<PortalFill> {
  const canLoadPortalData = useHubPortalDataEnabled();
  return useQuery({
    queryKey: ['hub-portal-fill', clienteId],
    queryFn: () => getPortalFill(clienteId),
    enabled: canLoadPortalData,
  });
}
