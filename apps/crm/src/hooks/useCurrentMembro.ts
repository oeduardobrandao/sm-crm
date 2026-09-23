import { useQuery } from '@tanstack/react-query';
import { getMembros, type Membro } from '@/store';
import { useAuth } from '@/context/AuthContext';

/**
 * Resolves the membro row linked to the logged-in user via membros.crm_user_id.
 * Returns null when the user has no linked membro (an admin links it in Equipe).
 * `isSuccess` is the ['membros'] query's own flag: "no membro" only means
 * something once it is true (Minha fila reads it to know when a `membro=<id>`
 * deep link can be validated against the list). `isError` is TanStack's
 * `isLoadingError`: an error with NO cached list. A failed background refetch
 * keeps the cached list usable instead of flipping consumers to an error state.
 */
export function useCurrentMembro(): {
  membro: Membro | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
} {
  const { user } = useAuth();
  const {
    data: membros,
    isLoading,
    isLoadingError: isError,
    isSuccess,
  } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const membro = user ? ((membros ?? []).find((m) => m.crm_user_id === user.id) ?? null) : null;
  return { membro, isLoading, isError, isSuccess };
}
