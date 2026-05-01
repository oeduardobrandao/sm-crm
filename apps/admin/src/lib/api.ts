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
  resolved_limits: Record<string, number> | null;
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
  resource_limits: Record<string, number>;
  feature_flags: Record<string, boolean>;
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

export function createPlan(params: { name: string; resource_limits: Record<string, number>; feature_flags: Record<string, boolean>; is_default?: boolean }) {
  return adminApi<{ plan: Plan }>('create-plan', params);
}

export function updatePlan(params: { plan_id: string; name?: string; resource_limits?: Record<string, number>; feature_flags?: Record<string, boolean>; is_default?: boolean }) {
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
