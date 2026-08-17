import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  LayoutList,
  Share2,
  BarChart3,
  Globe,
  FolderOpen,
  Wallet,
} from 'lucide-react';
import type { FinancialAccess } from '@/lib/financialAccess';
import type { Cliente } from '../../store';

export type ClienteTabKey =
  | 'visao-geral'
  | 'entregas'
  | 'redes-sociais'
  | 'relatorios'
  | 'hub'
  | 'arquivos'
  | 'financeiro';

export type ClienteTabGroup = 'cliente' | 'canais' | 'gestao';

export type WorkspaceRole = 'owner' | 'admin' | 'agent';

/** Context handed to every tab route via `<Outlet context={...} />`. */
export interface ClienteDetalheOutletContext {
  clienteId: number;
  cliente: Cliente;
}

export interface ClienteTab {
  /** Path segment under /clientes/:id. */
  key: ClienteTabKey;
  /**
   * Section heading in the tab nav. Consecutive tabs sharing a group render
   * under one label, so tabs of the same group must stay adjacent in
   * CLIENTE_TABS.
   */
  group: ClienteTabGroup;
  icon: LucideIcon;
  /** i18n key inside the 'clients' namespace. */
  labelKey: string;
  /** Roles allowed to see the tab and open its URL directly. */
  roles: WorkspaceRole[];
}

const ALL: WorkspaceRole[] = ['owner', 'admin', 'agent'];
const STAFF: WorkspaceRole[] = ['owner', 'admin'];

/**
 * Single source of truth for the client-detail tab strip, in display order —
 * grouped Cliente / Canais e análise / Gestão. The layout renders the strip
 * from this list and also guards direct URL access against it, so a tab can
 * never be hidden in the nav yet reachable by typing its address.
 *
 * `financeiro`'s `roles` is deliberately ALL: the real gate for that tab is
 * `canSeeFinancials` (see `financeiroTabGuardOutcome` below), not the role
 * list — an agent is still denied because `deriveFinancialAccess` never
 * grants one `true`, but a restricted ADMIN needs the finer-grained
 * capability check, not a blanket role exclusion.
 */
export const CLIENTE_TABS: ClienteTab[] = [
  {
    key: 'visao-geral',
    group: 'cliente',
    icon: LayoutDashboard,
    labelKey: 'detail.tabs.visaoGeral',
    roles: ALL,
  },
  {
    key: 'entregas',
    group: 'cliente',
    icon: LayoutList,
    labelKey: 'detail.tabs.entregas',
    roles: ALL,
  },
  {
    key: 'redes-sociais',
    group: 'canais',
    icon: Share2,
    labelKey: 'detail.tabs.redesSociais',
    roles: ALL,
  },
  {
    key: 'relatorios',
    group: 'canais',
    icon: BarChart3,
    labelKey: 'detail.tabs.relatorios',
    roles: STAFF,
  },
  { key: 'hub', group: 'gestao', icon: Globe, labelKey: 'detail.tabs.hub', roles: ALL },
  {
    key: 'arquivos',
    group: 'gestao',
    icon: FolderOpen,
    labelKey: 'detail.tabs.arquivos',
    roles: ALL,
  },
  {
    key: 'financeiro',
    group: 'gestao',
    icon: Wallet,
    labelKey: 'detail.tabs.financeiro',
    roles: ALL,
  },
];

/** i18n keys (namespace 'clients') for each group heading, in display order. */
export const CLIENTE_TAB_GROUP_LABELS: Record<ClienteTabGroup, string> = {
  cliente: 'detail.tabGroups.cliente',
  canais: 'detail.tabGroups.canais',
  gestao: 'detail.tabGroups.gestao',
};

/** Pure role check only — ignores the finer `financeiro` capability gate. */
function hasRoleAccess(tab: ClienteTab, workspaceRole: WorkspaceRole | null | undefined): boolean {
  return tab.roles.includes(workspaceRole as WorkspaceRole);
}

/**
 * Full access check for a single tab: role AND, for `financeiro`, the
 * resolved capability. Used by the route guard to decide whether direct URL
 * access to a tab is allowed.
 *
 * Deliberately collapses `canSeeFinancials === 'unknown'` into "no access"
 * here: this function answers "can render right now", and the layout uses
 * the separate three-state `financeiroTabGuardOutcome` when it needs to tell
 * loading apart from denial (to avoid a premature redirect).
 */
export function canAccessClienteTab(
  key: string,
  workspaceRole: WorkspaceRole | null | undefined,
  canSeeFinancials: FinancialAccess,
): boolean {
  const tab = CLIENTE_TABS.find((t) => t.key === key);
  if (!tab) return false;
  if (!hasRoleAccess(tab, workspaceRole)) return false;
  if (tab.key === 'financeiro') return canSeeFinancials === true;
  return true;
}

/** Role-only access check, for tabs other than `financeiro` (see module doc above). */
export function canAccessClienteTabRole(
  key: string,
  workspaceRole: WorkspaceRole | null | undefined,
): boolean {
  const tab = CLIENTE_TABS.find((t) => t.key === key);
  return tab ? hasRoleAccess(tab, workspaceRole) : false;
}

/** Tabs to show in the nav for the current role/capability, in display order. */
export function visibleClienteTabs(
  workspaceRole: WorkspaceRole | null | undefined,
  canSeeFinancials: FinancialAccess,
): ClienteTab[] {
  return CLIENTE_TABS.filter((tab) =>
    canAccessClienteTab(tab.key, workspaceRole, canSeeFinancials),
  );
}

/**
 * Three-state guard outcome for the `financeiro` route specifically, mirroring
 * AppLayout's `financialGuardOutcome`: 'unknown' fails NEUTRAL (loading), not
 * closed, so hydration or a transient membership-lookup failure never flashes
 * the restriction/redirect at an owner. Route content stays unmounted either
 * way, so the loading state leaks nothing.
 */
export function financeiroTabGuardOutcome(
  canSeeFinancials: FinancialAccess,
): 'content' | 'loading' | 'denied' {
  if (canSeeFinancials === true) return 'content';
  if (canSeeFinancials === 'unknown') return 'loading';
  return 'denied';
}
