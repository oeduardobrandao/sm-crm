import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  Globe,
  HardDrive,
  Plug,
  Tags,
  User,
  Users,
} from 'lucide-react';

export type ConfigRole = 'owner' | 'admin' | 'agent';

export interface ConfigTab {
  /** Path segment under /configuracao. */
  path: string;
  label: string;
  /** Roles allowed to see the tab and open its URL directly. */
  roles: ConfigRole[];
  /**
   * Section heading in the settings nav. Consecutive tabs sharing a group
   * render under one label, so tabs of the same group must stay adjacent.
   */
  group: string;
  icon: LucideIcon;
}

const ALL: ConfigRole[] = ['owner', 'admin', 'agent'];
const STAFF: ConfigRole[] = ['owner', 'admin'];

/**
 * Single source of truth for the Configurações tab strip. The layout renders the
 * strip from this list and also guards direct URL access against it, so a tab
 * can never be hidden in the nav yet reachable by typing its address.
 *
 * `roles` mirrors the guard each destination already enforces internally
 * (CobrancaPage is owner-only; IntegracoesClaudePage is owner/admin) — those
 * checks stay in place as the real gate; this list only avoids advertising a
 * tab that would render a "no access" screen.
 */
export const CONFIG_TABS: ConfigTab[] = [
  { path: 'perfil', label: 'Perfil', roles: ALL, group: 'Conta', icon: User },
  { path: 'notificacoes', label: 'Notificações', roles: ALL, group: 'Conta', icon: Bell },
  { path: 'workspace', label: 'Workspace', roles: STAFF, group: 'Workspace', icon: Building2 },
  { path: 'membros', label: 'Membros', roles: STAFF, group: 'Workspace', icon: Users },
  { path: 'relatorios', label: 'Relatórios', roles: STAFF, group: 'Workspace', icon: BarChart3 },
  { path: 'status', label: 'Status de posts', roles: STAFF, group: 'Workspace', icon: Tags },
  { path: 'hub', label: 'Hub', roles: STAFF, group: 'Workspace', icon: Globe },
  {
    path: 'armazenamento',
    label: 'Armazenamento',
    roles: ['owner'],
    group: 'Workspace',
    icon: HardDrive,
  },
  { path: 'mcp', label: 'Agentes (MCP)', roles: STAFF, group: 'Avançado', icon: Plug },
  {
    path: 'cobranca',
    label: 'Plano & Cobrança',
    roles: ['owner'],
    group: 'Avançado',
    icon: CreditCard,
  },
];

export function visibleConfigTabs(workspaceRole: string | null | undefined): ConfigTab[] {
  return CONFIG_TABS.filter((tab) => tab.roles.includes(workspaceRole as ConfigRole));
}

export function canAccessConfigTab(
  path: string,
  workspaceRole: string | null | undefined,
): boolean {
  const tab = CONFIG_TABS.find((t) => t.path === path);
  return tab ? tab.roles.includes(workspaceRole as ConfigRole) : false;
}
