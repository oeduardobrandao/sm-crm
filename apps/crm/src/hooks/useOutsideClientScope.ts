import { useAuth } from '@/context/AuthContext';
import { isClientScoped } from '@/lib/permissions';

/**
 * Acesso por cliente: true when a member restricted to assigned clients sees this item only
 * because it is theirs ("é dele"): its client is not among `membership.cliente_ids`.
 * Writes that need full visibility (the post-references PUT/DELETE answer 403 there) stay
 * read-only for them. Owners and unrestricted members always get false.
 */
export function useOutsideClientScope(clienteId: number | null | undefined): boolean {
  const { membership } = useAuth();
  if (clienteId == null || !isClientScoped(membership)) return false;
  return !(membership?.cliente_ids ?? []).includes(clienteId);
}
