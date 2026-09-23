import { useQuery } from '@tanstack/react-query';
import { getMembros, type Membro } from '@/store';
import { useAuth } from '@/context/AuthContext';

/**
 * Resolves the membro row linked to the logged-in user via membros.crm_user_id.
 * Returns null when the user has no linked membro (an admin links it in Equipe).
 * `isSuccess`/`isError` are the ['membros'] query's own flags: "no membro" only
 * means something once `isSuccess` is true (Minha fila reads them to know when
 * a `membro=<id>` deep link can be validated against the list).
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
    isError,
    isSuccess,
  } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const membro = user ? ((membros ?? []).find((m) => m.crm_user_id === user.id) ?? null) : null;
  return { membro, isLoading, isError, isSuccess };
}
