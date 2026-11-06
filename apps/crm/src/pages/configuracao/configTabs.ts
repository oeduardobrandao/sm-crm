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
import type { FeatureFlags } from '@/hooks/useWorkspaceLimits';
import { isNativeApp } from '@/native/platform';

/**
 * `'all'` = every member, regardless of role or membership state (used for a
 * user's own account settings — profile/notifications never depend on
 * workspace permissions). `'owner'` = the workspace owner literal, for the
 * handful of destinations that stay owner-only regardless of the permission
 * catalog (billing, storage, role management itself). `{module,action}` =
 * evaluated via `can()`.
 */
export type ConfigPermission =
  | { module: PermissionModule; action: PermissionAction }
  | 'owner'
  | 'all';

/** Section id of a tab in the settings nav; its label is `settings:tabs.groups.<id>`. */
export type ConfigTabGroup = 'conta' | 'workspace' | 'avancado';

export interface ConfigTab {
  /** Path segment under /configuracao. */
  path: string;
  /** i18n key (namespace `settings`) of the tab's label. */
  labelKey: string;
  /** Permission gate for the tab. See `ConfigPermission`. */
  permission: ConfigPermission;
  /**
   * Section heading in the settings nav. Consecutive tabs sharing a group
   * render under one label, so tabs of the same group must stay adjacent. An id, never
   * a translated string: the label is `settings:tabs.groups.<group>`.
   */
  group: ConfigTabGroup;
  icon: LucideIcon;
}

/**
 * Single source of truth for the Configurações tab strip. The layout renders the
 * strip from this list and also guards direct URL access against it, so a tab
 * the role cannot open is never reachable by typing its address.
 *
 * One deliberate exception goes the other way: `contas-conectadas` is listed in the
 * nav only while the workspace has YouTube or Google Meu Negócio (see
 * `visibleConfigTabs`), yet stays reachable by URL and from the client tabs with both
 * flags off, so a downgraded workspace can still remove a Google account's access.
 *
 * `permission` mirrors the guard each destination already enforces internally
 * (CobrancaPage is owner-only) — those
 * checks stay in place as the real gate; this list only avoids advertising a
 * tab that would render a "no access" screen.
 */
export const CONFIG_TABS: ConfigTab[] = [
  { path: 'perfil', labelKey: 'tabs.perfil', permission: 'all', group: 'conta', icon: User },
  {
    path: 'notificacoes',
    labelKey: 'tabs.notificacoes',
    permission: 'all',
    group: 'conta',
    icon: Bell,
  },
  {
    path: 'workspace',
    labelKey: 'tabs.workspace',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'workspace',
    icon: Building2,
  },
  {
    path: 'membros',
    labelKey: 'tabs.membros',
    permission: { module: 'equipe', action: 'ver' },
    group: 'workspace',
    icon: Users,
  },
  {
    path: 'papeis',
    labelKey: 'tabs.papeis',
    permission: 'owner',
    group: 'workspace',
    icon: ShieldCheck,
  },
  {
    path: 'relatorios',
    labelKey: 'tabs.relatorios',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'workspace',
    icon: BarChart3,
  },
  {
    path: 'status',
    labelKey: 'tabs.status',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'workspace',
    icon: Tags,
  },
  {
    path: 'hub',
    labelKey: 'tabs.hub',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'workspace',
    icon: Globe,
  },
  {
    // Nav-listed only with feature_youtube or feature_google_business (visibleConfigTabs);
    // the route itself checks the permission only.
    path: 'contas-conectadas',
    labelKey: 'tabs.contasConectadas',
    permission: { module: 'configuracoes', action: 'ver' },
    group: 'workspace',
    icon: Plug,
  },
  {
    path: 'armazenamento',
    labelKey: 'tabs.armazenamento',
    permission: 'owner',
    group: 'workspace',
    icon: HardDrive,
  },
  {
    path: 'mcp',
    labelKey: 'tabs.mcp',
    // Every member can connect Claude with the scopes their own role allows. The page shows
    // API keys and everyone's connections only with `configuracoes:ver`.
    permission: 'all',
    group: 'avancado',
    icon: Plug,
  },
  {
    path: 'cobranca',
    labelKey: 'tabs.cobranca',
    permission: 'owner',
    group: 'avancado',
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

/** The plan flags `visibleConfigTabs` reads. */
export type ConfigTabFeatures = Pick<FeatureFlags, 'feature_youtube' | 'feature_google_business'>;

/** Tabs advertised only while a plan flag is on. Their route stays permission-only. */
function listedForFeatures(path: string, features: ConfigTabFeatures | null | undefined): boolean {
  if (path === 'contas-conectadas') {
    return features?.feature_youtube === true || features?.feature_google_business === true;
  }
  return true;
}

/**
 * Tabs to show in the nav for the current permission set, in display order. `features`
 * (the workspace's plan flags) hides `contas-conectadas` unless YouTube or Google Meu
 * Negócio is on; while it is still loading (null) that tab stays hidden.
 */
export function visibleConfigTabs(
  can: ConfigCanFn,
  workspaceRole: string | null | undefined,
  features?: ConfigTabFeatures | null,
): ConfigTab[] {
  return CONFIG_TABS.filter(
    (t) =>
      canAccessConfigTab(t.path, can, workspaceRole) &&
      listedForFeatures(t.path, features) &&
      listedInNativeApp(t.path),
  );
}

/** The iOS app never shows billing (apps/mobile/DECISIONS.md D5); the route guard bounces it. */
function listedInNativeApp(path: string): boolean {
  return path !== 'cobranca' || !isNativeApp();
}
