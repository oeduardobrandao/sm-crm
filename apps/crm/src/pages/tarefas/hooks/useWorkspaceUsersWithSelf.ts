import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { getWorkspaceUsers } from '../../../store';

export interface WorkspaceUserLite {
  id: string;
  nome: string;
  avatar_url: string | null;
}

/**
 * The active workspace's users (`['workspace-users']`, shared with the post editor) plus the
 * signed-in user from their own profile when the list lacks them. A failed or still-loading
 * roster query must never label the viewer's own comments and history entries as a removed
 * account.
 */
export function useWorkspaceUsersWithSelf(): WorkspaceUserLite[] {
  const { user, profile } = useAuth();
  const { data: workspaceUsers = [] } = useQuery<WorkspaceUserLite[]>({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });
  const selfId = user?.id ?? null;
  const selfNome = profile?.nome ?? null;
  const selfAvatar = profile?.avatar_url ?? null;
  return useMemo(() => {
    if (!selfId || !selfNome || workspaceUsers.some((u) => u.id === selfId)) return workspaceUsers;
    return [...workspaceUsers, { id: selfId, nome: selfNome, avatar_url: selfAvatar }];
  }, [workspaceUsers, selfId, selfNome, selfAvatar]);
}
