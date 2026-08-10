import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { AuthContext } from '../context/AuthContext';

export interface WorkspaceUsage {
  clients: number;
  team_members: number;
  pending_invites: number;
  leads: number;
  hub_tokens: number;
  workflow_templates: number;
  instagram_accounts: number;
  mcp_keys: number;
  storage_used_bytes: number;
}

/**
 * Current usage counts from workspace_usage() (counts mirror the enforcement
 * triggers). Partial: a caller with no active workspace gets {}. Consumed only
 * by the Cobrança usage panel, so freshness rides on staleTime, not on
 * cross-page invalidation.
 */
export function useWorkspaceUsage() {
  // Same context pattern as useWorkspaceLimits: key by workspace, usable
  // outside an AuthProvider in isolated tests.
  const auth = useContext(AuthContext);
  const workspaceId = auth?.profile?.conta_id ?? null;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['workspace-usage', workspaceId],
    queryFn: async (): Promise<Partial<WorkspaceUsage>> => {
      const { data, error } = await supabase.rpc('workspace_usage');
      if (error) throw error;
      return (data ?? {}) as Partial<WorkspaceUsage>;
    },
    staleTime: 30 * 1000,
  });
  return { usage: data ?? null, isLoading, isError };
}
