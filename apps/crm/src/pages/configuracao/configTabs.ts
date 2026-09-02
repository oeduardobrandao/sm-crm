import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  Globe,
  HardDrive,
  Plug,
  ShieldCheck,
  Tags,
  User,
  Users,
} from 'lucide-react';
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';

/**
 * `'all'` = every member, regardless of role or membership state (used for a
 * user's own account settings — profile/notifications never depend on
 * workspace permissions). `'owner'` = the workspace owner literal, for the
 * handful of destinations that stay owner-only regardless of the permission
 * catalog (billing, storage, role management itself). `{module,action}` =
 * evaluated via `can()`.
 */
export type ConfigPermission =
  { module: PermissionModule; action: PermissionAction } | 'owner' | 'all';

export interface ConfigTab {
  /** Path segment under /configuracao. */
  path: string;
  label: string;
  /** Permission gate for the tab. See `ConfigPermission`. */
  permission: ConfigPermission;
  /**
   * Section heading in the settings nav. Consecutive tabs sharing a group
   * render under one label, so tabs of the same group must stay adjacent.
   */
  group: string;
  icon: LucideIcon;
}

/**
 * Single source of truth for the Configurações tab strip. The layout renders the
 * strip from this list and also guards direct URL access against it, so a tab
 * can never be hidden in the nav yet reachable by typing its address.
 *
 * `permission` mirrors the guard each destination already enforces internally
 * (CobrancaPage is owner-only; IntegracoesClaudePage is owner/admin) — those
 * checks stay in place as the real gate; this list only avoids advertising a
 * tab that would render a "no access" screen.
 */
export const CONFIG_TABS: ConfigTab[] = [
  { path: 'perfil', label: 'Perfil', permission: 'all', group: 'Conta', icon: User },
  { path: 'notificacoes', label: 'Notificações', permission: 'all', group: 'Conta', icon: Bell },
  {
    path: 'workspace',
    label: 'Workspace',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'Workspace',
    icon: Building2,
  },
  {
    path: 'membros',
    label: 'Membros',
    permission: { module: 'equipe', action: 'ver' },
    group: 'Workspace',
    icon: Users,
  },
  { path: 'papeis', label: 'Papéis', permission: 'owner', group: 'Workspace', icon: ShieldCheck },
  {
    path: 'relatorios',
    label: 'Relatórios',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'Workspace',
    icon: BarChart3,
  },
  {
    path: 'status',
    label: 'Status de posts',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'Workspace',
    icon: Tags,
  },
  {
    path: 'hub',
    label: 'Hub',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'Workspace',
    icon: Globe,
  },
  {
    path: 'armazenamento',
    label: 'Armazenamento',
    permission: 'owner',
    group: 'Workspace',
    icon: HardDrive,
  },
  {
    path: 'mcp',
    label: 'Agentes (MCP)',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'Avançado',
    icon: Plug,
  },
  {
    path: 'cobranca',
    label: 'Plano & Cobrança',
    permission: 'owner',
    group: 'Avançado',
    icon: CreditCard,
  },
];

export type ConfigCanFn = (module: PermissionModule, action?: PermissionAction) => PermissionCheck;

/**
 * Full access check for a single tab, used both by the nav filter and the
 * route guard for direct URL access.
 */
export function canAccessConfigTab(
  path: string,
  can: ConfigCanFn,
  workspaceRole: string | null | undefined,
): boolean {
  const tab = CONFIG_TABS.find((t) => t.path === path);
  if (!tab) return false;
  if (tab.permission === 'all') return true;
  if (tab.permission === 'owner') return workspaceRole === 'owner';
  return can(tab.permission.module, tab.permission.action) === true;
}

/** Tabs to show in the nav for the current permission set, in display order. */
export function visibleConfigTabs(
  can: ConfigCanFn,
  workspaceRole: string | null | undefined,
): ConfigTab[] {
  return CONFIG_TABS.filter((t) => canAccessConfigTab(t.path, can, workspaceRole));
}
