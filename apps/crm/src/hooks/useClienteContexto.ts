import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { isClientScoped } from '@/lib/permissions';
import { getClienteContexto, type ClienteContexto } from '@/store';

/**
 * Acesso por cliente: identity (nome, sigla, cor, foto) of the client an item belongs to,
 * for a member restricted to assigned clients whose item sits in a client outside their
 * scope, so that client is missing from their visible clients list.
 *
 * Runs only for a restricted member and only when the caller says the client is missing,
 * so unscoped members never call the RPC. `null` when not needed, not loaded yet, not
 * theirs, or on error: callers keep their current fallback. The key starts with
 * 'cliente', which the clientes revocation purge already removes.
 */
export function useClienteContexto(
  clienteId: number | null | undefined,
  missing: boolean,
): ClienteContexto | null {
  const { membership } = useAuth();
  const enabled = clienteId != null && missing && isClientScoped(membership);
  const { data } = useQuery({
    queryKey: ['cliente', 'contexto', clienteId],
    queryFn: () => getClienteContexto(clienteId as number),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return enabled ? (data ?? null) : null;
}
