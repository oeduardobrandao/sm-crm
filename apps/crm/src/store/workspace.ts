import { supabase, getCurrentProfile, clearProfileCache, getContaId } from './core';

export type ClientScope = 'todos' | 'atribuidos';

/**
 * Normalizes a `workspace_members.client_scope` value read from the database
 * or a realtime payload.
 *
 * - `'atribuidos'` -> `'atribuidos'`.
 * - `'todos'` or `undefined` -> `'todos'`. `undefined` means the key is
 *   ABSENT from the row: the column does not exist in the database this
 *   client is talking to (pre-migration realtime payload / lower fallback
 *   tier), which is exactly the pre-feature behaviour.
 * - anything else (`null`, an unknown string) -> `'atribuidos'`. The column
 *   is NOT NULL with a CHECK, so this never happens on a healthy database;
 *   if it does, the client fails CLOSED (spec "Anti-objetivos": an escopo
 *   nulo must never fall open to "todos").
 */
export function normalizeClientScope(value: unknown): ClientScope {
  if (value === undefined || value === 'todos') return 'todos';
  return 'atribuidos';
}

/** `client_scope_rev` is a bigint; PostgREST/realtime deliver it as a number. Absent -> 0. */
export function normalizeClientScopeRev(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when the error says the CLIENT-SCOPE schema (acesso por cliente:
 * `workspace_members.client_scope` / `client_scope_rev` or the
 * `workspace_member_clientes` relationship) is missing from the database.
 * Same codes as isMissingRolesSchemaError below; the message probe is what
 * lets a caller step down ONE tier (drop the client-scope fields, keep the
 * roles select) instead of jumping to the legacy select, which would zero
 * `role_id`/`permissions` for a custom-role member.
 */
function isMissingClientScopeSchemaError(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? '';
  // Code AND message: a permission error (42501) that merely mentions the
  // column must throw, not step down to a tier that resolves 'todos'.
  const schemaCode =
    error.code === '42703' ||
    error.code === '42P01' ||
    error.code === 'PGRST200' ||
    error.code === 'PGRST204';
  return (
    schemaCode &&
    (message.includes('client_scope') || message.includes('workspace_member_clientes'))
  );
}

/** The error message names the roles schema (role_id / workspace_roles) specifically. */
function isRolesMention(error: { message?: string }): boolean {
  const message = error.message ?? '';
  return message.includes('workspace_roles') || message.includes('role_id');
}

/**
 * True when a select error is any of the missing-schema shapes (roles or
 * client scope), i.e. one we degrade from instead of throwing.
 */
function isMissingSchemaError(error: { code?: string; message?: string }): boolean {
  return isMissingClientScopeSchemaError(error) || isMissingRolesSchemaError(error);
}

export interface WorkspaceUserRow {
  id: string;
  nome: string;
  role: 'owner' | 'admin' | 'agent';
  role_id: string | null;
  papel_nome: string | null;
  can_see_financials: boolean;
  avatar_url: string | null;
  created_at: string;
  /** Pre-migration database (no column): every member reads as 'todos'. */
  client_scope: ClientScope;
}

const WORKSPACE_USERS_ROLES_COLUMNS =
  'user_id, role, role_id, joined_at, can_see_financials, workspace_roles(nome), profiles!inner(id, nome, avatar_url, created_at)';

/**
 * Rows have the WorkspaceUserRow shape. The return stays `any[]` because a
 * dozen callers (agenda, drawers) type it locally with narrower shapes
 * (`avatar_url: string`); cast to WorkspaceUserRow[] where the full shape
 * matters (e.g. `client_scope` in Configuração > Membros).
 */
export async function getWorkspaceUsers(): Promise<any[]> {
  const conta_id = await getContaId();
  const selectUsers = (columns: string) =>
    supabase
      .from('workspace_members')
      .select(columns)
      .eq('workspace_id', conta_id)
      .order('joined_at', { ascending: true });

  // Tier 1: roles + client_scope (acesso por cliente).
  let { data, error } = await selectUsers(`${WORKSPACE_USERS_ROLES_COLUMNS}, client_scope`);
  if (error && isMissingSchemaError(error) && !isRolesMention(error)) {
    // Tier 2: the database predates the client-scope migration (or the probe
    // could not tell which schema is missing): same roles select as before
    // the feature. Every member then reads as 'todos' (normalizeClientScope
    // of an absent key), so Configuração > Membros never breaks.
    ({ data, error } = await selectUsers(WORKSPACE_USERS_ROLES_COLUMNS));
  }
  if (error) {
    if (!isMissingRolesSchemaError(error)) throw error;
    // Same pre-migration degradation as getMyMembership() below (hotfix
    // #439): a database that predates the roles migration 400s on the
    // enriched select (role_id / workspace_roles unknown to PostgREST's
    // schema cache). Falling through to `throw error` here left MembrosTab's
    // roster query rejected -- an EMPTY list, not a loud failure, because the
    // caller (`useQuery`) just renders `wsUsers ?? []` on error. Re-run with
    // the legacy columns instead, same fields every row would carry
    // pre-migration.
    const { data: legacy, error: legacyError } = await supabase
      .from('workspace_members')
      .select(
        'user_id, role, joined_at, can_see_financials, profiles!inner(id, nome, avatar_url, created_at)',
      )
      .eq('workspace_id', conta_id)
      .order('joined_at', { ascending: true });
    if (legacyError) throw legacyError;
    return (legacy || []).map((m: any) => ({
      id: m.profiles.id,
      nome: m.profiles.nome,
      role: m.role,
      role_id: null,
      papel_nome: null,
      can_see_financials: m.can_see_financials,
      avatar_url: m.profiles.avatar_url,
      created_at: m.profiles.created_at,
      client_scope: 'todos',
    }));
  }
  // Flatten the join result to match the expected shape
  return ((data as any[] | null) || []).map((m: any) => ({
    id: m.profiles.id,
    nome: m.profiles.nome,
    role: m.role,
    role_id: m.role_id ?? null,
    papel_nome: m.workspace_roles?.nome ?? null,
    can_see_financials: m.can_see_financials,
    avatar_url: m.profiles.avatar_url,
    created_at: m.profiles.created_at,
    client_scope: normalizeClientScope(m.client_scope),
  }));
}

/**
 * Every client assignment of the active workspace, grouped by member, in ONE
 * query (Configuração > Membros shows a per-member count; one read per row
 * would be N+1 on large teams). Owner-only in practice: RLS lets a non-owner
 * read only its own rows, so a non-owner caller would get a partial map. The
 * UI never runs this for a non-owner viewer. Throws on error (fail closed: a
 * failed read must not render as "0 clientes").
 */
export async function getWorkspaceMemberClienteIds(): Promise<Record<string, number[]>> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workspace_member_clientes')
    .select('user_id, cliente_id')
    .eq('workspace_id', conta_id);
  if (error) throw error;
  const byUser: Record<string, number[]> = {};
  for (const r of (data as { user_id: string; cliente_id: number | string }[] | null) ?? []) {
    (byUser[r.user_id] ??= []).push(Number(r.cliente_id));
  }
  return byUser;
}

/**
 * Login e-mails of the active workspace's members. profiles has no e-mail
 * column, so this goes through a SECURITY DEFINER RPC over auth.users that
 * answers only callers with equipe:editar (zero rows otherwise).
 */
export async function getWorkspaceMemberEmails(): Promise<{ user_id: string; email: string }[]> {
  const { data, error } = await supabase.rpc('get_workspace_member_emails');
  if (error) throw error;
  return (data ?? []) as { user_id: string; email: string }[];
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

/**
 * RLS on `workspaces` FILTERS a forbidden row out of an UPDATE instead of
 * raising: PostgREST answers 200 with zero rows affected, so `error` is null
 * and the caller toasts success for a save that never happened (F4, revisão
 * externa). Every workspace update below therefore asks for the affected ids
 * back with `.select('id')` and treats an empty result as a denial. The UI
 * gates on `configuracoes:editar` are the primary fix; this is the backstop
 * that keeps a missed gate from lying to the user.
 */
function assertWorkspaceRowAffected(rows: { id: string }[] | null): void {
  if (!rows || rows.length === 0) {
    throw new Error('workspace_update_forbidden');
  }
}

export async function updateWorkspace(
  workspaceId: string,
  updates: { name?: string; logo_url?: string | null; report_splash_url?: string | null },
): Promise<void> {
  const { data, error } = await supabase
    .from('workspaces')
    .update(updates)
    .eq('id', workspaceId)
    .select('id');
  if (error) throw error;
  assertWorkspaceRowAffected(data);
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
  // Central de Notificações, Fase 2 (spec 2026-09-02): master switch for the
  // "Pendências do Hub" digest, read by SeusClientesSection alongside the
  // per-client clientes.send_event_email column.
  send_client_event_emails: boolean;
}> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspaces')
    .select('brand_color, report_splash_url, send_report_email, send_client_event_emails')
    .eq('id', contaId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkspaceBranding(fields: {
  send_report_email?: boolean;
  send_client_event_emails?: boolean;
}) {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspaces')
    .update(fields)
    .eq('id', contaId)
    .select('id');
  if (error) throw error;
  assertWorkspaceRowAffected(data);
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
  const { data, error } = await supabase
    .from('workspaces')
    .update(fields)
    .eq('id', contaId)
    .select('id');
  if (error) throw error;
  assertWorkspaceRowAffected(data);
}

// Auto-limpeza de armazenamento (Configurações → Armazenamento). Owner-only:
// the RLS row policy lets admins update workspaces, but a BEFORE UPDATE guard
// trigger (20260811000001) raises P0001 for the three policy columns when the
// actor is not an owner. The last_* columns are written only by the executor
// RPC; this surface is their ONE reader, and updateStorageAutoclean is the ONE
// writer of the policy columns (one-writer-per-column, see updateHubBranding).
// Throws on failure rather than returning defaults: same discipline as
// getWorkspaceBranding above, for the same reason.
export interface StorageAutocleanSettings {
  storage_autoclean_enabled: boolean;
  storage_autoclean_delay_days: number;
  storage_autoclean_threshold_pct: number | null;
  storage_autoclean_last_run_at: string | null;
  storage_autoclean_last_files: number | null;
  storage_autoclean_last_bytes: number | null;
}

export async function getStorageAutoclean(): Promise<StorageAutocleanSettings> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('workspaces')
    .select(
      'storage_autoclean_enabled, storage_autoclean_delay_days, storage_autoclean_threshold_pct, storage_autoclean_last_run_at, storage_autoclean_last_files, storage_autoclean_last_bytes',
    )
    .eq('id', contaId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateStorageAutoclean(
  fields: Pick<
    StorageAutocleanSettings,
    'storage_autoclean_enabled' | 'storage_autoclean_delay_days' | 'storage_autoclean_threshold_pct'
  >,
): Promise<void> {
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

export async function updateWorkspaceUserRole(
  userId: string,
  value: { role: 'admin' | 'agent' } | { roleId: string },
): Promise<void> {
  await callManageWorkspaceUser('update-role', userId, value);
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

/**
 * Owner-only (enforced by the edge action): restricts `userId` to the given
 * clientes (`'atribuidos'`) or lifts the restriction (`'todos'`). The action
 * replaces the whole assignment list and bumps `client_scope_rev`, which is
 * what fires the member's live revocation (AuthContext wm: channel).
 */
export async function setWorkspaceUserClientScope(
  userId: string,
  scope: ClientScope,
  clienteIds: number[],
): Promise<void> {
  await callManageWorkspaceUser('set-client-scope', userId, { scope, clienteIds });
}

export interface MyMembership {
  role: 'owner' | 'admin' | 'agent';
  can_see_financials: boolean;
  role_id: string | null;
  /** permissions do papel custom; null quando role_id é null (fallback legado). */
  permissions: Record<string, string> | null;
  /**
   * Acesso por cliente. `'atribuidos'` (non-owner) = only `cliente_ids` are
   * visible. Pre-migration database: `'todos'`, rev 0, `[]`.
   */
  client_scope: ClientScope;
  /** Bumped by the server on every scope/list change; drives live revocation. */
  client_scope_rev: number;
  /**
   * Assigned clientes (embed `workspace_member_clientes(cliente_id)`). Empty
   * when the embed is missing or failed, never a stand-in for "all": with
   * `'atribuidos'` an empty list means zero clientes.
   */
  cliente_ids: number[];
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
/**
 * True when the error says the ROLES SCHEMA itself is missing — `role_id` /
 * `workspace_roles` not present in the database this client is talking to —
 * as opposed to a network/RLS failure.
 *
 * Exists because the frontend and migrations deploy independently: Vercel
 * ships a bundle on merge while `20260903000002_workspace_roles_a_additive`
 * reaches each database by a manual push. In that window the enriched select
 * below 400s for EVERY member, AuthContext resolves membership to 'error',
 * and the whole app collapses to "Não foi possível confirmar seu acesso"
 * (2026-09-02 incident). A pre-migration database must degrade to the legacy
 * lookup, not take the workspace down.
 *
 * Codes: 42703 undefined column (`role_id`), 42P01 undefined table,
 * PGRST200 embed relationship not in PostgREST's schema cache — plus a
 * message probe for the same two identifiers, because the schema-cache
 * phrasing has shifted across PostgREST versions. A transport error
 * ("Failed to fetch") matches none of these and still throws.
 */
function isMissingRolesSchemaError(error: { code?: string; message?: string }): boolean {
  if (error.code === '42703' || error.code === '42P01' || error.code === 'PGRST200') return true;
  const message = error.message ?? '';
  return message.includes('workspace_roles') || message.includes('role_id');
}

const MEMBERSHIP_ROLES_COLUMNS = 'role, can_see_financials, role_id, workspace_roles(permissions)';
const MEMBERSHIP_SCOPE_COLUMNS = 'client_scope, client_scope_rev';
const MEMBERSHIP_SCOPE_EMBED = 'workspace_member_clientes(cliente_id)';

type MembershipRow = {
  role: MyMembership['role'];
  can_see_financials: boolean;
  role_id?: string | null;
  workspace_roles?: { permissions: Record<string, string> } | null;
  client_scope?: unknown;
  client_scope_rev?: unknown;
  workspace_member_clientes?: { cliente_id: number | string }[] | null;
};

function toMyMembership(row: MembershipRow): MyMembership {
  const embed = row.workspace_member_clientes;
  return {
    role: row.role,
    can_see_financials: row.can_see_financials,
    role_id: row.role_id ?? null,
    permissions: row.workspace_roles?.permissions ?? null,
    client_scope: normalizeClientScope(row.client_scope),
    client_scope_rev: normalizeClientScopeRev(row.client_scope_rev),
    // Missing/null embed -> [] (zero clientes under 'atribuidos'), never "all".
    cliente_ids: Array.isArray(embed) ? embed.map((r) => Number(r.cliente_id)) : [],
  };
}

export async function getMyMembership(): Promise<MyMembership | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // getContaId() throws rather than returning a falsy value when there is no
  // active workspace, so "no active workspace" surfaces as a rejection here
  // (getMyMembership() throws too), never as this function returning null.
  const conta_id = await getContaId();

  const selectMembership = (columns: string) =>
    supabase
      .from('workspace_members')
      .select(columns)
      .eq('user_id', user.id)
      .eq('workspace_id', conta_id)
      .maybeSingle();

  // Fallback chain, one tier per schema the frontend can outrun (Vercel ships
  // on merge, migrations are pushed by hand):
  //   T1 roles + client_scope + client_scope_rev + workspace_member_clientes embed
  //   T2 roles + client_scope + client_scope_rev (embed relationship missing:
  //      PostgREST fails the WHOLE request on a bad embed, so this is the only
  //      way to still read 'atribuidos'; cliente_ids is then [], never "all")
  //   T3 roles only (client-scope migration not applied): 'todos', rev 0, []
  //   T4 legacy (roles migration not applied either)
  // A client-scope error must step down to T3 at most, NEVER straight to T4:
  // T4 zeroes role_id/permissions, which for a custom-role member is the
  // AGENT_ROLE_PRESET fail-open lib/permissions.ts warns about. A non-schema
  // error (network, RLS) throws at the tier it happened on.
  let { data, error } = await selectMembership(
    `${MEMBERSHIP_ROLES_COLUMNS}, ${MEMBERSHIP_SCOPE_COLUMNS}, ${MEMBERSHIP_SCOPE_EMBED}`,
  );
  if (error && isMissingSchemaError(error) && !isRolesMention(error)) {
    // Skip T2 when the message already says the client_scope column itself
    // is missing (today's pre-migration prod): T2 would fail the same way.
    const columnMissing =
      (error.message ?? '').includes('client_scope') &&
      !(error.message ?? '').includes('workspace_member_clientes');
    if (!columnMissing) {
      ({ data, error } = await selectMembership(
        `${MEMBERSHIP_ROLES_COLUMNS}, ${MEMBERSHIP_SCOPE_COLUMNS}`,
      ));
    }
    if (error && isMissingSchemaError(error) && !isRolesMention(error)) {
      ({ data, error } = await selectMembership(MEMBERSHIP_ROLES_COLUMNS));
    }
  }

  if (error) {
    if (!isMissingRolesSchemaError(error)) throw error;
    // Database predates the roles migration — resolve membership through the
    // legacy columns instead of failing the whole session. `role_id: null`
    // is exactly what every row would hold pre-migration, so derivePermission
    // takes its legacy fallback and behaviour matches the old bundle.
    const { data: legacy, error: legacyError } = await supabase
      .from('workspace_members')
      .select('role, can_see_financials')
      .eq('user_id', user.id)
      .eq('workspace_id', conta_id)
      .maybeSingle();
    if (legacyError) throw legacyError;
    if (!legacy) return null;
    const legacyRow = legacy as unknown as {
      role: MyMembership['role'];
      can_see_financials: boolean;
    };
    return {
      role: legacyRow.role,
      can_see_financials: legacyRow.can_see_financials,
      role_id: null,
      permissions: null,
      client_scope: 'todos',
      client_scope_rev: 0,
      cliente_ids: [],
    };
  }
  if (!data) return null;
  return toMyMembership(data as unknown as MembershipRow);
}
