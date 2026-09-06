import { supabase } from './supabase';
import type { SubscriptionInfo, SubscriptionSummary, WorkspaceStatusGroup } from './subscription';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ─── Types ────────────────────────────────────────────────────

export interface WorkspaceSummary {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  /** Newest audited action in the workspace; null when nothing has ever been logged. */
  last_activity_at: string | null;
  owner: { name: string; email: string; telefone: string | null; marketing_opt_in: boolean } | null;
  member_count: number;
  client_count: number;
  plan_name: string | null;
  has_overrides: boolean;
  subscription: SubscriptionSummary | null;
}

export interface WorkspaceDetail {
  workspace: {
    id: string;
    name: string;
    logo_url: string | null;
    created_at: string;
    plan_source?: string;
  };
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
  subscription: SubscriptionInfo | null;
  usage: { client_count: number; member_count: number; integration_count: number };
}

export interface MemberInfo {
  user_id: string;
  name: string;
  email: string;
  telefone: string | null;
  marketing_opt_in: boolean;
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
  pagarme_12x_enabled: boolean;
  pagarme_plan_id_annual: string | null;
  pagarme_installment_cents: number | null;
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
  max_mcp_keys: number | null;
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
  feature_mcp: boolean;
  feature_tiktok: boolean;
  feature_mensagens: boolean;
  feature_instagram_automation: boolean;
  feature_briefing_audio: boolean;
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

export interface GlobalBanner {
  id: string;
  type: 'info' | 'warning' | 'critical';
  content: string;
  link: string | null;
  custom_color: string | null;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[] | null;
  target_workspace_ids: string[] | null;
  dismissible: boolean;
  starts_at: string | null;
  ends_at: string | null;
  status: 'draft' | 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  dismissal_count: number;
}

export type WorkspaceActivityBucket = '7d' | '30d' | 'dormente' | 'nunca';
export type WorkspaceSortKey =
  | 'name'
  | 'plan'
  | 'client_count'
  | 'member_count'
  | 'created_at'
  | 'last_activity_at';
export type SortDir = 'asc' | 'desc';

// A `type` literal (not `interface`) so it keeps the implicit string index signature
// TS grants object-type literals -- adminApi()'s `params` parameter needs that to accept it.
// This matches every other multi-field adminApi() params shape in this file (see
// setWorkspaceOverrides below): none of them are declared as `interface`.
export type ListWorkspacesParams = {
  search?: string;
  plan_id?: string;
  offset?: number;
  limit?: number;
  /** Freezes the filtered set to how it looked at this instant (ISO), for multi-call exports. */
  as_of?: string;
  /** Subscription status group; mirrors the CASE on p_status in admin_list_workspaces. */
  status?: WorkspaceStatusGroup;
  has_overrides?: boolean;
  activity?: WorkspaceActivityBucket;
  /** ISO timestamp; created_at >= created_since. */
  created_since?: string;
  sort?: WorkspaceSortKey;
  dir?: SortDir;
};

export interface ListWorkspacesResponse {
  workspaces: WorkspaceSummary[];
  total: number;
  /** Membership count across the whole filtered set, not just the returned page. */
  total_members: number;
  /** Client count across the whole filtered set, not just the returned page. */
  total_clients: number;
  /** Workspaces with plan overrides across the whole filtered set, not just the page. */
  total_with_overrides: number;
}

// ─── Column definitions ─────────────────────────────────────

export const RESOURCE_LIMIT_KEYS = [
  'max_clients',
  'max_team_members',
  'max_workflow_templates',
  'max_active_workflows_per_client',
  'max_instagram_accounts',
  'max_leads',
  'max_hub_tokens',
  'storage_quota_bytes',
  'max_custom_properties_per_template',
  'max_posts_per_workflow',
  'max_workspaces_per_user',
  'max_mcp_keys',
] as const;

export const RESOURCE_LIMIT_LABELS: Record<string, string> = {
  max_clients: 'Máx. de clientes',
  max_team_members: 'Máx. de membros da equipe',
  max_workflow_templates: 'Máx. de modelos de fluxo',
  max_active_workflows_per_client: 'Máx. de fluxos por cliente',
  max_instagram_accounts: 'Máx. de contas Instagram',
  max_leads: 'Máx. de leads',
  max_hub_tokens: 'Máx. de tokens do Hub',
  storage_quota_bytes: 'Armazenamento (bytes)',
  max_custom_properties_per_template: 'Máx. de propriedades por modelo',
  max_posts_per_workflow: 'Máx. de posts por fluxo',
  max_workspaces_per_user: 'Máx. de workspaces por usuário',
  max_mcp_keys: 'Máx. de chaves MCP',
};

export const FEATURE_FLAG_KEYS = [
  'feature_instagram',
  'feature_instagram_ai',
  'feature_analytics_reports',
  'feature_best_times',
  'feature_audience_demographics',
  'feature_hub_portal',
  'feature_leads',
  'feature_financial',
  'feature_contracts',
  'feature_ideas',
  'feature_workflow_gantt',
  'feature_workflow_recurrence',
  'feature_csv_import',
  'feature_custom_properties',
  'feature_post_scheduling',
  'feature_auto_sync_cron',
  'feature_post_tagging',
  'feature_brand_customization',
  'feature_mcp',
  'feature_tiktok',
  'feature_mensagens',
  'feature_instagram_automation',
  'feature_briefing_audio',
] as const;

export const FEATURE_FLAG_LABELS: Record<string, string> = {
  feature_instagram: 'Instagram',
  feature_instagram_ai: 'IA do Instagram',
  feature_analytics_reports: 'Relatórios de analytics',
  feature_best_times: 'Melhores horários',
  feature_audience_demographics: 'Demografia do público',
  feature_hub_portal: 'Portal do Hub',
  feature_leads: 'Leads',
  feature_financial: 'Financeiro',
  feature_contracts: 'Contratos',
  feature_ideas: 'Ideias',
  feature_workflow_gantt: 'Gantt de fluxos',
  feature_workflow_recurrence: 'Recorrência de fluxos',
  feature_csv_import: 'Importação CSV',
  feature_custom_properties: 'Propriedades personalizadas',
  feature_post_scheduling: 'Agendamento de posts',
  feature_auto_sync_cron: 'Sincronização automática',
  feature_post_tagging: 'Marcação de posts',
  feature_brand_customization: 'Personalização de marca',
  feature_mcp: 'MCP (Claude)',
  feature_tiktok: 'TikTok',
  feature_mensagens: 'Mensagens',
  feature_instagram_automation: 'Automação do Instagram',
  feature_briefing_audio: 'Briefing por áudio',
};

export const RATE_LIMIT_KEYS = [
  'rate_instagram_syncs_per_day',
  'rate_ai_analyses_per_month',
  'rate_report_generations_per_month',
] as const;

export const RATE_LIMIT_LABELS: Record<string, string> = {
  rate_instagram_syncs_per_day: 'Sincronizações do Instagram por dia',
  rate_ai_analyses_per_month: 'Análises de IA por mês',
  rate_report_generations_per_month: 'Relatórios gerados por mês',
};

// ─── API Call ─────────────────────────────────────────────────

export interface AdminApiError extends Error {
  body?: Record<string, unknown>;
  status?: number;
}

async function adminApi<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
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
    const error = new Error(err.error || `API error: ${res.status}`) as AdminApiError;
    // Keep the whole payload: structured errors (e.g. the cross-workspace
    // confirmation gate) carry fields the caller needs, not just a message.
    error.body = err;
    error.status = res.status;
    throw error;
  }

  return res.json();
}

// ─── Exported Functions ───────────────────────────────────────

export function verifyAdmin() {
  return adminApi<{ is_admin: boolean }>('verify-admin');
}

export function listWorkspaces(params?: ListWorkspacesParams) {
  return adminApi<ListWorkspacesResponse>('list-workspaces', params || {});
}

export function getWorkspace(workspace_id: string) {
  return adminApi<WorkspaceDetail>('get-workspace', { workspace_id });
}

export function listPlans() {
  return adminApi<{ plans: Plan[] }>('list-plans');
}

export interface PayingWorkspace {
  workspace_id: string;
  name: string;
  plan_name: string | null;
  status: string | null;
  /** Billing interval ("month" | "year"). */
  interval: string | null;
  /** This workspace's monthly contribution to MRR, in centavos. */
  monthly_cents: number;
  /** Coupon/discount label when the live Stripe amount is discounted. */
  discount_label: string | null;
  /** Whether monthly_cents came from live Stripe or the plan's catalog price. */
  amount_source: 'stripe' | 'pagarme' | 'catalog' | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_telefone: string | null;
  owner_marketing_opt_in: boolean;
  /** When the workspace was created; feeds describeActivity's "never acted" branch. */
  created_at: string | null;
  /** Newest human work artifact (admin_workspace_last_activity RPC); null = never. */
  last_activity_at: string | null;
}

export interface MrrSummary {
  /** Monthly recurring revenue in centavos (annual subs normalized to monthly). */
  mrr_cents: number;
  /** Number of paid subscriptions counted (status 'active' only — past_due/failed payments are excluded). */
  paying_count: number;
  currency: string;
  /** Per-workspace breakdown, highest monthly contribution first. Sums to mrr_cents. */
  workspaces: PayingWorkspace[];
}

export function getMrr() {
  return adminApi<MrrSummary>('get-mrr');
}

export interface TrialWorkspace {
  workspace_id: string;
  name: string;
  plan_name: string | null;
  /** Billing interval that will apply once the trial converts ("month" | "year"). */
  interval: string | null;
  /** Trial-end date (ISO string), i.e. the subscription's current_period_end. Null if unknown. */
  trial_ends_at: string | null;
  /** Expected monthly contribution once converted (catalog price, annual→monthly). Null if unpriced. */
  monthly_cents: number | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_telefone: string | null;
  owner_marketing_opt_in: boolean;
  /** When the workspace was created; feeds describeActivity's "never acted" branch. */
  created_at: string | null;
  /** Newest human work artifact (admin_workspace_last_activity RPC); null = never. */
  last_activity_at: string | null;
}

export interface TrialsSummary {
  trials: TrialWorkspace[];
  trial_count: number;
  /** Sum of the trials' expected monthly contributions, in centavos. */
  trial_mrr_cents: number;
  currency: string;
}

export function getTrials() {
  return adminApi<TrialsSummary>('get-trials');
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

export function unsetWorkspacePlan(workspace_id: string) {
  return adminApi<{ message: string; plan_source: string }>('unset-workspace-plan', {
    workspace_id,
  });
}

export function setWorkspaceOverrides(params: {
  workspace_id: string;
  resource_overrides?: Record<string, number>;
  feature_overrides?: Record<string, boolean>;
  notes?: string;
}) {
  return adminApi<{ message: string }>('set-workspace-overrides', params);
}

export function clearWorkspaceOverrides(workspace_id: string) {
  return adminApi<{ message: string }>('clear-workspace-overrides', { workspace_id });
}

export interface McpKeyRow {
  id: string;
  name: string;
  token_suffix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function listWorkspaceMcpKeys(workspace_id: string) {
  return adminApi<{ keys: McpKeyRow[] }>('list-workspace-mcp-keys', { workspace_id });
}

export function revokeMcpKey(workspace_id: string, key_id: string) {
  return adminApi<{ message: string }>('revoke-mcp-key', { workspace_id, key_id });
}

export function revokeAllMcpKeys(workspace_id: string) {
  return adminApi<{ message: string; count: number }>('revoke-all-mcp-keys', { workspace_id });
}

export interface OAuthGrantRow {
  id: string;
  client_id: string;
  scopes: string[];
  created_at: string;
  revoked_at: string | null;
  connected_by: string | null;
}

export function listWorkspaceOAuthGrants(workspace_id: string) {
  return adminApi<{ grants: OAuthGrantRow[] }>('list-workspace-oauth-grants', { workspace_id });
}

export function revokeOAuthGrant(workspace_id: string, grant_id: string) {
  return adminApi<{ message: string }>('revoke-oauth-grant', { workspace_id, grant_id });
}

export function revokeAllOAuthGrants(workspace_id: string) {
  return adminApi<{ message: string; count: number }>('revoke-all-oauth-grants', { workspace_id });
}

export interface InviteAuthState {
  user_id: string;
  email_confirmed: boolean;
  confirmation_sent_at: string | null;
  invited_at: string | null;
  last_sign_in_at: string | null;
  has_password: boolean | null;
  onboarding_complete: boolean;
  is_member: boolean;
}

export interface InviteInfo {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  created_at: string;
  accepted_at: string | null;
  expires_at: string | null;
  invited_by: string;
  silent_add: boolean;
  link_expired: boolean;
  auth_state: InviteAuthState | null;
}

export function getWorkspaceInvites(workspace_id: string) {
  return adminApi<{ invites: InviteInfo[]; total: number }>('get-workspace-invites', {
    workspace_id,
  });
}

export function adminCancelInvite(workspace_id: string, invite_id: string) {
  return adminApi<{ success: boolean; deleted_user: boolean }>('admin-cancel-invite', {
    workspace_id,
    invite_id,
  });
}

export function adminResendInvite(
  workspace_id: string,
  invite_id: string,
  confirm_cross_workspace = false,
) {
  return adminApi<{ success?: boolean; route?: string; message?: string }>('admin-resend-invite', {
    workspace_id,
    invite_id,
    confirm_cross_workspace,
  });
}

export function adminCreateInvite(
  workspace_id: string,
  email: string,
  role: 'admin' | 'agent',
  confirm_cross_workspace = false,
) {
  return adminApi<{ success?: boolean; route?: string; message?: string }>('admin-create-invite', {
    workspace_id,
    email,
    role,
    confirm_cross_workspace,
  });
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

export function listBanners(params?: { status?: string }) {
  return adminApi<{ banners: GlobalBanner[] }>('list-banners', params || {});
}

export function createBanner(params: Record<string, unknown>) {
  return adminApi<{ banner: GlobalBanner }>('create-banner', params);
}

export function updateBanner(params: Record<string, unknown>) {
  return adminApi<{ banner: GlobalBanner }>('update-banner', params);
}

export function deleteBanner(banner_id: string) {
  return adminApi<{ message: string }>('delete-banner', { banner_id });
}

// ─── Popups ─────────────────────────────────────────────────

export interface PopupPage {
  title: string;
  eyebrow: string | null;
  body: string;
  image_key: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
}

export interface GlobalPopup {
  id: string;
  pages: PopupPage[];
  cta_label: string | null;
  cta_url: string | null;
  cta_style: 'ink' | 'brand';
  secondary_label: string | null;
  frequency: 'once' | 'until_cta';
  require_ack: boolean;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[] | null;
  target_workspace_ids: string[] | null;
  starts_at: string | null;
  ends_at: string | null;
  status: 'draft' | 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  counts: { seen: number; closed: number; cta: number; ack: number };
}

export function listPopups(params?: { status?: string }) {
  return adminApi<{ popups: GlobalPopup[] }>('list-popups', params || {});
}

export function createPopup(params: Record<string, unknown>) {
  return adminApi<{ popup: GlobalPopup }>('create-popup', params);
}

export function updatePopup(params: Record<string, unknown>) {
  return adminApi<{ popup: GlobalPopup }>('update-popup', params);
}

export function deletePopup(popup_id: string) {
  return adminApi<{ message: string }>('delete-popup', { popup_id });
}

// ─── Workspace Events ───────────────────────────────────────

export interface WorkspaceEvent {
  id: number;
  created_at: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  metadata: Record<string, unknown> | null;
}

export function listWorkspaceEvents(params: {
  workspace_id: string;
  offset?: number;
  limit?: number;
  event_types?: string[];
}) {
  return adminApi<{ events: WorkspaceEvent[]; total: number }>('list-workspace-events', params);
}

// ─── KB Articles ─────────────────────────────────────────────

export interface KbArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: Record<string, unknown> | null;
  content_plain: string;
  cover_image_url: string | null;
  category: string;
  tags: string[];
  status: 'draft' | 'published';
  display_order: number;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbContextLink {
  id: string;
  route_pattern: string;
  article_id: string;
  label: string | null;
  display_order: number;
}

export function listKbArticles(params?: { category?: string; status?: string }) {
  return adminApi<{ articles: KbArticle[] }>('list-kb-articles', params || {});
}

export function getKbArticle(article_id: string) {
  return adminApi<{ article: KbArticle }>('get-kb-article', { article_id });
}

export function createKbArticle(params: Record<string, unknown>) {
  return adminApi<{ article: KbArticle }>('create-kb-article', params);
}

export function updateKbArticle(params: Record<string, unknown>) {
  return adminApi<{ article: KbArticle }>('update-kb-article', params);
}

export function deleteKbArticle(article_id: string) {
  return adminApi<{ message: string }>('delete-kb-article', { article_id });
}

export function listKbContextLinks(article_id: string) {
  return adminApi<{ links: KbContextLink[] }>('list-kb-context-links', { article_id });
}

export function upsertKbContextLink(params: Record<string, unknown>) {
  return adminApi<{ link_id: string }>('upsert-kb-context-link', params);
}

export function deleteKbContextLink(link_id: string) {
  return adminApi<{ message: string }>('delete-kb-context-link', { link_id });
}

// ─── MCP do Admin (conector platform-admin) ────────────────────

export interface AdminMcpGrant {
  id: string;
  user_id: string;
  email: string | null;
  client_id: string;
  scopes: string[];
  created_at: string;
  revoked_at: string | null;
}

export function listAdminMcpGrants() {
  return adminApi<{ grants: AdminMcpGrant[] }>('list-admin-mcp-grants');
}

export function revokeAdminMcpGrant(grantId: string) {
  return adminApi<{ ok: true }>('revoke-admin-mcp-grant', { grant_id: grantId });
}
