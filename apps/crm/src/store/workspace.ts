import { supabase, getCurrentProfile, clearProfileCache, getContaId } from './core';

export async function getWorkspaceUsers(): Promise<any[]> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workspace_members')
    .select(
      'user_id, role, joined_at, can_see_financials, profiles!inner(id, nome, avatar_url, created_at)',
    )
    .eq('workspace_id', conta_id)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  // Flatten the join result to match the expected shape
  return (data || []).map((m: any) => ({
    id: m.profiles.id,
    nome: m.profiles.nome,
    role: m.role,
    can_see_financials: m.can_see_financials,
    avatar_url: m.profiles.avatar_url,
    created_at: m.profiles.created_at,
  }));
}

export async function getMyWorkspaces(): Promise<any[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

export async function getCurrentWorkspace(): Promise<{
  id: string;
  name: string;
  logo_url: string | null;
} | null> {
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

export async function updateWorkspace(
  workspaceId: string,
  updates: { name?: string; logo_url?: string | null; report_splash_url?: string | null },
): Promise<void> {
  const { error } = await supabase.from('workspaces').update(updates).eq('id', workspaceId);
  if (error) throw error;
}

// Report v2 whitelabel surface: a single accent colour (shared with the client
// Hub) plus an optional cover splash image. Typography/theme are part of the
// report design now, so the legacy report_* columns are no longer read here.
// Throws on failure rather than returning null: a swallowed error here left the
// settings form showing its hardcoded defaults, and "Salvar" then wrote those
// defaults over the workspace's real branding.
export async function getWorkspaceBranding(): Promise<{
  brand_color: string;
  report_splash_url: string | null;
  send_report_email: boolean;
}> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspaces')
    .select('brand_color, report_splash_url, send_report_email')
    .eq('id', contaId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkspaceBranding(fields: { send_report_email?: boolean }) {
  const contaId = await getContaId();
  const { error } = await supabase.from('workspaces').update(fields).eq('id', contaId);
  if (error) throw error;
}

// Hub white-label surface (Personalizar Hub, Configurações → Hub). `brand_color` lives
// here too, not in updateWorkspaceBranding above: it drives the Hub calendar AND the
// report accent, but this is its ONE writer — updateWorkspaceBranding above no longer
// accepts it, so a report-tab edit can never race a hub-tab edit for the same column.
// Throws on failure rather than returning defaults: same discipline as
// getWorkspaceBranding above, for the same reason (a swallowed error here once caused
// defaults to overwrite real data, silently reverting a workspace's Hub customization).
export interface HubBranding {
  brand_color: string;
  hub_surface_theme: string;
  hub_font_display: string;
  hub_font_body: string;
  hub_radius: string;
  hub_card_style: string;
  hub_logo_style: string;
  hub_logo_dark_url: string | null;
  hub_hide_branding: boolean;
  hub_default_appearance: string;
}

export async function getHubBranding(): Promise<HubBranding> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspaces')
    .select(
      'brand_color, hub_surface_theme, hub_font_display, hub_font_body, hub_radius, hub_card_style, hub_logo_style, hub_logo_dark_url, hub_hide_branding, hub_default_appearance',
    )
    .eq('id', contaId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateHubBranding(fields: Partial<HubBranding>): Promise<void> {
  const contaId = await getContaId();
  const { error } = await supabase.from('workspaces').update(fields).eq('id', contaId);
  if (error) throw error;
}

export async function switchWorkspace(workspaceId: string): Promise<void> {
  // Goes through the RPC, not a direct UPDATE: profiles.active_workspace_id and
  // profiles.conta_id are not writable by the client, because conta_id is the
  // tenant selector the legacy RLS policies and ~15 edge functions read.
  // See migration 20260729000002.
  const { error } = await supabase.rpc('switch_workspace', {
    p_workspace: workspaceId,
  });
  if (error) throw error;
  // Clear cached profile so next call fetches fresh data
  clearProfileCache();
}

export async function callManageWorkspaceUser(
  action: string,
  targetUserId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const session = (await supabase.auth.getSession()).data.session;
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-workspace-user`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ action, targetUserId, ...extra }),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || result.message || `Erro HTTP ${response.status}`);
}

export async function updateWorkspaceUserRole(userId: string, role: string): Promise<void> {
  await callManageWorkspaceUser('update-role', userId, { role });
}

export async function removeWorkspaceUser(userId: string): Promise<void> {
  await callManageWorkspaceUser('remove', userId);
}

export async function setWorkspaceUserFinancialAccess(
  userId: string,
  value: boolean,
): Promise<void> {
  await callManageWorkspaceUser('set-financial-access', userId, { value });
}

export interface MyMembership {
  role: 'owner' | 'admin' | 'agent';
  can_see_financials: boolean;
}

/**
 * The caller's membership row for the ACTIVE workspace.
 *
 * Read from workspace_members rather than profiles: no workspace-switch path
 * writes profiles.role, so a user who is owner in A and agent in B keeps
 * `owner` after switching. This is the same staleness the SQL predicate avoids.
 *
 * Throws on a query error — the caller must be able to tell "no membership"
 * (null) from "could not determine" (throw), because those resolve to different
 * capability states.
 */
export async function getMyMembership(): Promise<MyMembership | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // getContaId() throws rather than returning a falsy value when there is no
  // active workspace, so "no active workspace" surfaces as a rejection here
  // (getMyMembership() throws too), never as this function returning null.
  const conta_id = await getContaId();

  const { data, error } = await supabase
    .from('workspace_members')
    .select('role, can_see_financials')
    .eq('user_id', user.id)
    .eq('workspace_id', conta_id)
    .maybeSingle();

  if (error) throw error;
  return (data as MyMembership | null) ?? null;
}
