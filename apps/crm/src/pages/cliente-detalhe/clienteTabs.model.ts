import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  LayoutList,
  Share2,
  BarChart3,
  KeyRound,
  ClipboardList,
  Palette,
  FileText,
  Lightbulb,
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
  | 'hub/acesso'
  | 'hub/briefing'
  | 'hub/marca'
  | 'hub/paginas'
  | 'hub/ideias'
  | 'arquivos'
  | 'financeiro';

export type ClienteTabGroup = 'cliente' | 'canais' | 'portal' | 'gestao';

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
 * grouped Cliente / Canais e análise / Portal do cliente / Gestão. The layout renders the strip
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
  // As cinco rotas do grupo `portal` substituem a antiga aba única `hub` de
  // origin/main e herdam exatamente o gate que ela carregava desde a Task 12:
  // `configuracoes:editar`. Um `agent` legado nunca tem essa permissão e é
  // redirecionado pelo guard antes de montar; uma role custom cujo
  // `workspaceRole` de chassi lê 'agent' mas que tem a permissão passa — e
  // `HubRoleGate` (hub/HubRoleGate.tsx) lê o MESMO `can()`, para que a
  // checagem interna nunca contradiga este guard.
  {
    key: 'hub/acesso',
    group: 'portal',
    icon: KeyRound,
    labelKey: 'detail.tabs.hubAcesso',
    permission: { module: 'configuracoes', action: 'editar' },
  },
  {
    key: 'hub/briefing',
    group: 'portal',
    icon: ClipboardList,
    labelKey: 'detail.tabs.hubBriefing',
    permission: { module: 'configuracoes', action: 'editar' },
  },
  {
    key: 'hub/marca',
    group: 'portal',
    icon: Palette,
    labelKey: 'detail.tabs.hubMarca',
    permission: { module: 'configuracoes', action: 'editar' },
  },
  {
    key: 'hub/paginas',
    group: 'portal',
    icon: FileText,
    labelKey: 'detail.tabs.hubPaginas',
    permission: { module: 'configuracoes', action: 'editar' },
  },
  {
    key: 'hub/ideias',
    group: 'portal',
    icon: Lightbulb,
    labelKey: 'detail.tabs.hubIdeias',
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
  portal: 'detail.tabGroups.portal',
  gestao: 'detail.tabGroups.gestao',
};

/**
 * Resolves a tab's raw permission check: `'no-tab'` for an unregistered key,
 * literal `true` for a `permission: null` tab (no finer gate than the parent
 * route), otherwise whatever `can()` returns for that tab's module/action --
 * including `'unknown'` while membership is still resolving. Shared by
 * `canAccessClienteTab` (two-state, for the nav) and `clienteTabGuardOutcome`
 * (three-state, for the route guard) so both read the exact same gate.
 */
function tabPermissionCheck(key: string, can: CanFn): PermissionCheck | 'no-tab' {
  const tab = CLIENTE_TABS.find((t) => t.key === key);
  if (!tab) return 'no-tab';
  if (tab.permission === null) return true;
  return can(tab.permission.module, tab.permission.action);
}

/**
 * Full access check for a single tab, used both by the nav filter and (until
 * `clienteTabGuardOutcome` below) the route guard. `permission: null` means
 * "no finer gate than the parent route" -> always true. Collapses `'unknown'`
 * to `false` on purpose: this is what `visibleClienteTabs` uses to decide nav
 * visibility, where hiding a tab whose permission hasn't resolved yet is the
 * correct fail-closed behaviour for a passive list. Do NOT reuse this for an
 * ACTIVE route guard -- see `clienteTabGuardOutcome`, which fails neutral
 * instead.
 */
export function canAccessClienteTab(key: string, can: CanFn): boolean {
  return tabPermissionCheck(key, can) === true;
}

/** Tabs to show in the nav for the current permission set, in display order. */
export function visibleClienteTabs(can: CanFn): ClienteTab[] {
  return CLIENTE_TABS.filter((tab) => canAccessClienteTab(tab.key, can));
}

/**
 * Three-state guard outcome for any permission-gated tab (mirrors
 * `financeiroTabGuardOutcome`, generalized beyond `financeiro`): 'unknown'
 * fails NEUTRAL (loading), not closed, so hydration -- or a transient
 * membership-lookup hiccup -- never flashes a redirect at a member who is
 * actually authorized. `ClienteDetalhePage`'s route guard must resolve this
 * BEFORE the Outlet mounts, exactly like it already does for `financeiro`;
 * an unregistered key denies rather than loads forever.
 */
export function clienteTabGuardOutcome(key: string, can: CanFn): 'content' | 'loading' | 'denied' {
  const result = tabPermissionCheck(key, can);
  if (result === true) return 'content';
  if (result === 'unknown') return 'loading';
  return 'denied';
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
