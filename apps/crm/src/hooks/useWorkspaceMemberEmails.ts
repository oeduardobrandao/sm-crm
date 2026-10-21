import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWorkspaceMemberEmails } from '@/store/workspace';
import { useAuth } from '@/context/AuthContext';

/**
 * Map of auth user id -> login e-mail for the active workspace's members.
 * Gated on equipe:editar, the same predicate the RPC enforces server-side, so
 * anyone else gets an empty map without a request. Pure enrichment: a failed
 * fetch also leaves the map empty instead of breaking the page.
 */
export function useWorkspaceMemberEmails(): Map<string, string> {
  const { can } = useAuth();
  const enabled = can('equipe', 'editar') === true;
  const { data } = useQuery({
    queryKey: ['workspace-member-emails'],
    queryFn: getWorkspaceMemberEmails,
    enabled,
  });
  return useMemo(
    () => new Map(enabled ? (data ?? []).map((r) => [r.user_id, r.email]) : []),
    [data, enabled],
  );
}
