import { supabase, getContaId } from './core';

export interface WorkspaceRole {
  id: string;
  nome: string;
  permissions: Record<string, string>;
  created_at: string;
}

export async function getWorkspaceRoles(): Promise<WorkspaceRole[]> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspace_roles')
    .select('id, nome, permissions, created_at')
    .eq('conta_id', contaId)
    .order('nome', { ascending: true });
  if (error) throw error;
  return (data ?? []) as WorkspaceRole[];
}

/**
 * Member counts per custom role, keyed by role_id. Used by PapeisTab to show
 * "N membros" per papel and to block/warn on edit-in-use. A dedicated select
 * on workspace_members rather than reusing getWorkspaceUsers (workspace.ts):
 * that function doesn't project role_id, and extending it is a Task 13
 * concern (getWorkspaceUsers grows a role_id column for the MembrosTab
 * função-select). Rows without a role_id (legacy owner/admin/agent, no
 * custom papel) are skipped — they never count toward any papel's total.
 */
export async function getWorkspaceRoleMemberCounts(): Promise<Record<string, number>> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspace_members')
    .select('user_id, role_id')
    .eq('workspace_id', contaId);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { user_id: string; role_id: string | null }[]) {
    if (!row.role_id) continue;
    counts[row.role_id] = (counts[row.role_id] ?? 0) + 1;
  }
  return counts;
}

async function callManageWorkspaceRoles(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const session = (await supabase.auth.getSession()).data.session;
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-workspace-roles`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Erro HTTP ${response.status}`);
  return result;
}

export async function createWorkspaceRole(
  nome: string,
  permissions: Record<string, string>,
): Promise<void> {
  await callManageWorkspaceRoles({ action: 'create', nome, permissions });
}

export async function updateWorkspaceRole(
  roleId: string,
  nome: string,
  permissions: Record<string, string>,
): Promise<void> {
  await callManageWorkspaceRoles({ action: 'update', roleId, nome, permissions });
}

export async function deleteWorkspaceRole(roleId: string): Promise<void> {
  await callManageWorkspaceRoles({ action: 'delete', roleId });
}
