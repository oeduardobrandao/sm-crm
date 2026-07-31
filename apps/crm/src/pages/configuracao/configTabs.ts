export type ConfigRole = 'owner' | 'admin' | 'agent';

export interface ConfigTab {
  /** Path segment under /configuracao. */
  path: string;
  label: string;
  /** Roles allowed to see the tab and open its URL directly. */
  roles: ConfigRole[];
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
  { path: 'perfil', label: 'Perfil', roles: ALL },
  { path: 'workspace', label: 'Workspace', roles: STAFF },
  { path: 'membros', label: 'Membros', roles: STAFF },
  { path: 'relatorios', label: 'Relatórios', roles: STAFF },
  { path: 'hub', label: 'Hub', roles: STAFF },
  { path: 'mcp', label: 'Claude (MCP)', roles: STAFF },
  { path: 'cobranca', label: 'Plano & Cobrança', roles: ['owner'] },
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
