import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { switchWorkspace } from '@/store/workspace';
import { clearVidroCache } from '../lib/vidroLook';

export interface WorkspaceOption {
  id: string;
  name: string;
}

/**
 * The workspaces the signed-in user belongs to, plus the switch action. Shared by the
 * desktop account menu (Sidebar) and the phone Mais sheet (MobileNav).
 */
export function useWorkspaceSwitcher() {
  const { user, profile } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(id, name)')
      .eq('user_id', userId)
      .then(({ data }) => {
        // An empty result leaves the initial [] as is.
        if (!data?.length) return;
        setWorkspaces(
          (data as any[]).map((m) => ({
            id: m.workspaces.id as string,
            name: (m.workspaces.name as string | null) || 'Workspace',
          })),
        );
      });
  }, [userId]);

  const activeWorkspaceId = profile?.active_workspace_id || profile?.conta_id || null;
  const activeWorkspaceName = workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? null;

  const switchTo = async (workspaceId: string) => {
    if (!user || workspaceId === activeWorkspaceId) return;
    try {
      await switchWorkspace(workspaceId);
      // The pre-paint cache belongs to the workspace being left.
      clearVidroCache();
      window.location.reload();
    } catch {
      // A refused switch must not look like a successful one (no reload).
      toast.error('Não foi possível trocar de workspace.');
    }
  };

  return { workspaces, activeWorkspaceId, activeWorkspaceName, switchTo };
}
