import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ResourceLimits {
  max_clients: number | null;
  max_team_members: number | null;
  max_workflow_templates: number | null;
  max_active_workflows_per_client: number | null;
  max_instagram_accounts: number | null;
  max_leads: number | null;
  max_hub_tokens: number | null;
  storage_quota_bytes: number | null;
  max_custom_properties_per_template: number | null;
  max_posts_per_workflow: number | null;
  max_workspaces_per_user: number | null;
  rate_instagram_syncs_per_day: number | null;
  rate_ai_analyses_per_month: number | null;
  rate_report_generations_per_month: number | null;
}

export interface FeatureFlags {
  feature_instagram: boolean;
  feature_instagram_ai: boolean;
  feature_analytics_reports: boolean;
  feature_best_times: boolean;
  feature_audience_demographics: boolean;
  feature_hub_portal: boolean;
  feature_leads: boolean;
  feature_financial: boolean;
  feature_contracts: boolean;
  feature_ideas: boolean;
  feature_workflow_gantt: boolean;
  feature_workflow_recurrence: boolean;
  feature_csv_import: boolean;
  feature_custom_properties: boolean;
  feature_post_scheduling: boolean;
  feature_auto_sync_cron: boolean;
  feature_post_tagging: boolean;
  feature_brand_customization: boolean;
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
