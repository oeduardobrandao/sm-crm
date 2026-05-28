import { supabase, getCurrentProfile, clearProfileCache, getContaId } from './core';

export async function getWorkspaceUsers(): Promise<any[]> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workspace_members')
    .select('user_id, role, joined_at, profiles!inner(id, nome, avatar_url, created_at)')
    .eq('workspace_id', conta_id)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  // Flatten the join result to match the expected shape
  return (data || []).map((m: any) => ({
    id: m.profiles.id,
    nome: m.profiles.nome,
    role: m.role,
    avatar_url: m.profiles.avatar_url,
    created_at: m.profiles.created_at,
  }));
}

export async function getMyWorkspaces(): Promise<any[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces!inner(id, name, logo_url)')
    .eq('user_id', user.id);
  if (error) throw error;
  return (data || []).map((m: any) => ({
    id: m.workspaces.id,
    name: m.workspaces.name,
    logo_url: m.workspaces.logo_url,
    role: m.role,
  }));
}

export async function getCurrentWorkspace(): Promise<{ id: string; name: string; logo_url: string | null } | null> {
  const profile = await getCurrentProfile();
  if (!profile?.conta_id) return null;
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, logo_url')
    .eq('id', profile.conta_id)
    .single();
  if (error) return null;
  return data;
}

export async function updateWorkspace(workspaceId: string, updates: { name?: string; logo_url?: string | null }): Promise<void> {
  const { error } = await supabase
    .from('workspaces')
    .update(updates)
    .eq('id', workspaceId);
  if (error) throw error;
}

export async function getWorkspaceBranding(): Promise<{
  brand_color: string;
  report_secondary_color: string;
  report_accent_color: string;
  report_font_family: string;
  report_theme: string;
  send_report_email: boolean;
} | null> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspaces')
    .select('brand_color, report_secondary_color, report_accent_color, report_font_family, report_theme, send_report_email')
    .eq('id', contaId)
    .single();
  if (error) return null;
  return data;
}

export async function updateWorkspaceBranding(fields: {
  brand_color?: string;
  report_secondary_color?: string;
  report_accent_color?: string;
  report_font_family?: string;
  report_theme?: string;
  send_report_email?: boolean;
}) {
  const contaId = await getContaId();
  const { error } = await supabase
    .from('workspaces')
    .update(fields)
    .eq('id', contaId);
  if (error) throw error;
}

export async function switchWorkspace(workspaceId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');
  const { error } = await supabase
    .from('profiles')
    .update({ active_workspace_id: workspaceId, conta_id: workspaceId })
    .eq('id', user.id);
  if (error) throw error;
  // Clear cached profile so next call fetches fresh data
  clearProfileCache();
}

export async function callManageWorkspaceUser(action: string, targetUserId: string, extra?: Record<string, unknown>): Promise<void> {
  const session = (await supabase.auth.getSession()).data.session;
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-workspace-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ action, targetUserId, ...extra }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || `Erro HTTP ${response.status}`);
}

export async function updateWorkspaceUserRole(userId: string, role: string): Promise<void> {
  await callManageWorkspaceUser('update-role', userId, { role });
}

export async function removeWorkspaceUser(userId: string): Promise<void> {
  await callManageWorkspaceUser('remove', userId);
}
