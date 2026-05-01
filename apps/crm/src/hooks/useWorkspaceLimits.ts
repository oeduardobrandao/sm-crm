import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ResourceLimits {
  max_clients: number;
  max_members: number;
  max_instagram_accounts: number;
  max_storage_mb: number;
}

export interface FeatureFlags {
  analytics: boolean;
  post_express: boolean;
  briefing: boolean;
  ideias: boolean;
}

interface WorkspaceLimitsResponse {
  plan_name: string | null;
  limits: ResourceLimits | null;
  features: FeatureFlags | null;
}

async function fetchWorkspaceLimits(): Promise<WorkspaceLimitsResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${url}/functions/v1/workspace-limits`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!res.ok) throw new Error('Failed to fetch workspace limits');
  return res.json();
}

export function useWorkspaceLimits() {
  const { data, isLoading } = useQuery({
    queryKey: ['workspace-limits'],
    queryFn: fetchWorkspaceLimits,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  return {
    limits: data?.limits ?? null,
    features: data?.features ?? null,
    planName: data?.plan_name ?? null,
    isLoading,
    isUnlimited: !isLoading && data?.limits === null,
  };
}
