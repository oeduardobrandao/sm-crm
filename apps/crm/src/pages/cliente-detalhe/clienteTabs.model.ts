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
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';
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
  /**
   * Permission gate for the tab. `null` means the tab has no finer gate than
   * the parent route's `clientes:ver` (App.tsx / routePermissions.ts) —
   * always visible/accessible once that route itself is reachable.
   * `financeiro` still gets its own three-state `financeiroTabGuardOutcome`
   * for the route guard (see below); its `permission` here exists only for
   * `visibleClienteTabs` and is semantically identical —
   * `can('financeiro','ver')` mirrors `canSeeFinancials === true` exactly,
   * since `deriveFinancialAccess` already delegates to the same
   * `derivePermission` call.
   */
  permission: { module: PermissionModule; action: PermissionAction } | null;
}

export type CanFn = (module: PermissionModule, action?: PermissionAction) => PermissionCheck;

/**
 * Single source of truth for the client-detail tab strip, in display order —
 * grouped Cliente / Canais e análise / Gestão. The layout renders the strip
 * from this list and also guards direct URL access against it, so a tab can
 * never be hidden in the nav yet reachable by typing its address.
 */
export const CLIENTE_TABS: ClienteTab[] = [
  {
    key: 'visao-geral',
    group: 'cliente',
    icon: LayoutDashboard,
    labelKey: 'detail.tabs.visaoGeral',
    permission: null,
  },
  {
    key: 'entregas',
    group: 'cliente',
    icon: LayoutList,
    labelKey: 'detail.tabs.entregas',
    permission: null,
  },
  {
    key: 'redes-sociais',
    group: 'canais',
    icon: Share2,
    labelKey: 'detail.tabs.redesSociais',
    permission: null,
  },
  {
    key: 'relatorios',
    group: 'canais',
    icon: BarChart3,
    labelKey: 'detail.tabs.relatorios',
    permission: { module: 'analytics', action: 'ver' },
  },
  {
    key: 'hub',
    group: 'gestao',
    icon: Globe,
    labelKey: 'detail.tabs.hub',
    permission: { module: 'configuracoes', action: 'editar' },
  },
  {
    key: 'arquivos',
    group: 'gestao',
    icon: FolderOpen,
    labelKey: 'detail.tabs.arquivos',
    permission: null,
  },
  {
    key: 'financeiro',
    group: 'gestao',
    icon: Wallet,
    labelKey: 'detail.tabs.financeiro',
    permission: { module: 'financeiro', action: 'ver' },
  },
];

/** i18n keys (namespace 'clients') for each group heading, in display order. */
export const CLIENTE_TAB_GROUP_LABELS: Record<ClienteTabGroup, string> = {
  cliente: 'detail.tabGroups.cliente',
  canais: 'detail.tabGroups.canais',
  gestao: 'detail.tabGroups.gestao',
};

/**
 * Full access check for a single tab, used both by the nav filter and the
 * route guard for direct URL access. `permission: null` means "no finer gate
 * than the parent route" -> always true.
 */
export function canAccessClienteTab(key: string, can: CanFn): boolean {
  const tab = CLIENTE_TABS.find((t) => t.key === key);
  if (!tab) return false;
  if (tab.permission === null) return true;
  return can(tab.permission.module, tab.permission.action) === true;
}

/** Tabs to show in the nav for the current permission set, in display order. */
export function visibleClienteTabs(can: CanFn): ClienteTab[] {
  return CLIENTE_TABS.filter((tab) => canAccessClienteTab(tab.key, can));
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
