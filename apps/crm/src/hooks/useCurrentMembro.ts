import { useQuery } from '@tanstack/react-query';
import { getMembros, type Membro } from '@/store';
import { useAuth } from '@/context/AuthContext';

/**
 * Resolves the membro row linked to the logged-in user via membros.crm_user_id.
 * Returns null when the user has no linked membro (an admin links it in Equipe).
 */
export function useCurrentMembro(): { membro: Membro | null; isLoading: boolean } {
  const { user } = useAuth();
  const { data: membros, isLoading } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const membro = user ? (membros ?? []).find((m) => m.crm_user_id === user.id) ?? null : null;
  return { membro, isLoading };
}
