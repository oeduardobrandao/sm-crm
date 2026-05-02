import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ─── Types ────────────────────────────────────────────────────

export interface WorkspaceSummary {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  owner: { name: string; email: string } | null;
  member_count: number;
  client_count: number;
  plan_name: string | null;
  has_overrides: boolean;
}

export interface WorkspaceDetail {
  workspace: { id: string; name: string; logo_url: string | null; created_at: string };
  owner: MemberInfo | null;
  members: MemberInfo[];
  plan: { id: string; name: string } | null;
  override: {
    resource_overrides: Record<string, number> | null;
    feature_overrides: Record<string, boolean> | null;
    notes: string | null;
  } | null;
  resolved_limits: Record<string, number | null> | null;
  resolved_features: Record<string, boolean> | null;
  usage: { client_count: number; member_count: number; integration_count: number };
}

export interface MemberInfo {
  user_id: string;
  name: string;
  email: string;
  role: string;
  joined_at: string;
}

export interface Plan {
  id: string;
  name: string;
  price_brl: number | null;
  price_brl_annual: number | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_id_annual: string | null;
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
  rate_instagram_syncs_per_day: number | null;
  rate_ai_analyses_per_month: number | null;
  rate_report_generations_per_month: number | null;
  sort_order: number;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  workspace_count: number;
}

export interface PlatformAdmin {
  id: string;
  user_id: string;
  email: string;
  invited_by: string | null;
  invited_by_email: string | null;
  created_at: string;
}

// ─── Column definitions ─────────────────────────────────────

export const RESOURCE_LIMIT_KEYS = [
  'max_clients', 'max_team_members', 'max_workflow_templates',
  'max_active_workflows_per_client', 'max_instagram_accounts', 'max_leads',
  'max_hub_tokens', 'storage_quota_bytes', 'max_custom_properties_per_template',
  'max_posts_per_workflow', 'max_workspaces_per_user',
] as const;

export const RESOURCE_LIMIT_LABELS: Record<string, string> = {
  max_clients: 'Max Clients',
  max_team_members: 'Max Team Members',
  max_workflow_templates: 'Max Workflow Templates',
  max_active_workflows_per_client: 'Max Workflows/Client',
  max_instagram_accounts: 'Max Instagram Accounts',
  max_leads: 'Max Leads',
  max_hub_tokens: 'Max Hub Tokens',
  storage_quota_bytes: 'Storage (bytes)',
  max_custom_properties_per_template: 'Max Custom Props/Template',
  max_posts_per_workflow: 'Max Posts/Workflow',
  max_workspaces_per_user: 'Max Workspaces/User',
};

export const FEATURE_FLAG_KEYS = [
  'feature_instagram', 'feature_instagram_ai', 'feature_analytics_reports',
  'feature_best_times', 'feature_audience_demographics', 'feature_hub_portal',
  'feature_leads', 'feature_financial', 'feature_contracts', 'feature_ideas',
  'feature_workflow_gantt', 'feature_workflow_recurrence', 'feature_csv_import',
  'feature_custom_properties', 'feature_post_scheduling', 'feature_auto_sync_cron',
  'feature_post_tagging', 'feature_brand_customization',
] as const;

export const FEATURE_FLAG_LABELS: Record<string, string> = {
  feature_instagram: 'Instagram',
  feature_instagram_ai: 'Instagram AI',
  feature_analytics_reports: 'Analytics Reports',
  feature_best_times: 'Best Times',
  feature_audience_demographics: 'Audience Demographics',
  feature_hub_portal: 'Hub Portal',
  feature_leads: 'Leads',
  feature_financial: 'Financial',
  feature_contracts: 'Contracts',
  feature_ideas: 'Ideas',
  feature_workflow_gantt: 'Workflow Gantt',
  feature_workflow_recurrence: 'Workflow Recurrence',
  feature_csv_import: 'CSV Import',
  feature_custom_properties: 'Custom Properties',
  feature_post_scheduling: 'Post Scheduling',
  feature_auto_sync_cron: 'Auto Sync Cron',
  feature_post_tagging: 'Post Tagging',
  feature_brand_customization: 'Brand Customization',
};

export const RATE_LIMIT_KEYS = [
  'rate_instagram_syncs_per_day', 'rate_ai_analyses_per_month',
  'rate_report_generations_per_month',
] as const;

export const RATE_LIMIT_LABELS: Record<string, string> = {
  rate_instagram_syncs_per_day: 'Instagram Syncs/Day',
  rate_ai_analyses_per_month: 'AI Analyses/Month',
  rate_report_generations_per_month: 'Report Generations/Month',
};

// ─── API Call ─────────────────────────────────────────────────

async function adminApi<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...params }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ─── Exported Functions ───────────────────────────────────────

export function verifyAdmin() {
  return adminApi<{ is_admin: boolean }>('verify-admin');
}

export function listWorkspaces(params?: { search?: string; plan_id?: string; offset?: number; limit?: number }) {
  return adminApi<{ workspaces: WorkspaceSummary[]; total: number }>('list-workspaces', params || {});
}

export function getWorkspace(workspace_id: string) {
  return adminApi<WorkspaceDetail>('get-workspace', { workspace_id });
}

export function listPlans() {
  return adminApi<{ plans: Plan[] }>('list-plans');
}

export function createPlan(params: Record<string, unknown>) {
  return adminApi<{ plan: Plan }>('create-plan', params);
}

export function updatePlan(params: Record<string, unknown>) {
  return adminApi<{ plan: Plan }>('update-plan', params);
}

export function deletePlan(plan_id: string) {
  return adminApi<{ message: string }>('delete-plan', { plan_id });
}

export function setWorkspacePlan(workspace_id: string, plan_id: string) {
  return adminApi<{ message: string }>('set-workspace-plan', { workspace_id, plan_id });
}

export function setWorkspaceOverrides(params: { workspace_id: string; resource_overrides?: Record<string, number>; feature_overrides?: Record<string, boolean>; notes?: string }) {
  return adminApi<{ message: string }>('set-workspace-overrides', params);
}

export function clearWorkspaceOverrides(workspace_id: string) {
  return adminApi<{ message: string }>('clear-workspace-overrides', { workspace_id });
}

export function listAdmins() {
  return adminApi<{ admins: PlatformAdmin[] }>('list-admins');
}

export function inviteAdmin(email: string) {
  return adminApi<{ admin: PlatformAdmin }>('invite-admin', { email });
}

export function removeAdmin(admin_id: string) {
  return adminApi<{ message: string }>('remove-admin', { admin_id });
}
