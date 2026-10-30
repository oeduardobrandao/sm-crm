import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';

export interface NavItem {
  id: string;
  route: string;
  label: string;
  labelKey: string;
  icon: string;
  /** Open the route in a new browser tab instead of in-app SPA navigation. */
  newTab?: boolean;
  /**
   * Public page outside the CRM shell (no AppLayout). The phone Mais sheet opens it in a
   * new tab/window like `newTab`, so the user never lands outside the shell with no tab
   * bar and no way back. Desktop navigation is unaffected.
   */
  outsideShell?: boolean;
  /** Renders as an inert row with a "coming soon" badge instead of a working link. */
  disabled?: boolean;
  /** Flag off: em vez de sumir, renderiza esmaecido com cadeado, clicável
   * (a página destino mostra o paywall). Não combinar com `disabled`. */
  showLockedWhenGated?: boolean;
  /** Saída de getNavGroups; nunca declarar estaticamente. */
  locked?: boolean;
}
export interface NavGroup {
  id: string;
  label: string;
  labelKey: string;
  icon: string;
  items: NavItem[];
  isBottom?: boolean;
}

export const ALL_NAV_GROUPS: NavGroup[] = [
  {
    id: 'visao-geral',
    label: 'Visao Geral',
    labelKey: 'nav.visaoGeral',
    icon: 'ph-squares-four',
    items: [
      {
        id: 'dashboard',
        route: '/dashboard',
        label: 'Dashboard',
        labelKey: 'nav.dashboard',
        icon: 'ph-chart-pie-slice',
      },
      {
        id: 'calendario',
        route: '/calendario',
        label: 'Calendario',
        labelKey: 'nav.calendario',
        icon: 'ph-calendar-blank',
      },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    labelKey: 'nav.crm',
    icon: 'ph-users',
    items: [
      { id: 'leads', route: '/leads', label: 'Leads', labelKey: 'nav.leads', icon: 'ph-funnel' },
      {
        id: 'clientes',
        route: '/clientes',
        label: 'Clientes',
        labelKey: 'nav.clientes',
        icon: 'ph-users',
      },
      {
        id: 'ideias',
        route: '/ideias',
        label: 'Ideias',
        labelKey: 'nav.ideias',
        icon: 'ph-lightbulb',
      },
      {
        id: 'mensagens',
        route: '/mensagens',
        label: 'Mensagens',
        labelKey: 'nav.mensagens',
        icon: 'ph-chat-circle-text',
      },
    ],
  },
  {
    id: 'producao',
    label: 'Producao',
    labelKey: 'nav.producao',
    icon: 'ph-kanban',
    items: [
      {
        id: 'entregas',
        route: '/entregas',
        label: 'Entregas',
        labelKey: 'nav.entregas',
        icon: 'ph-kanban',
      },
      {
        id: 'post-express',
        route: '/post-express',
        label: 'Post Express',
        labelKey: 'nav.postExpress',
        icon: 'ph-paper-plane-tilt',
      },
      {
        id: 'analytics-fluxos',
        route: '/analytics-fluxos',
        label: 'Fluxos',
        labelKey: 'nav.fluxos',
        icon: 'ph-flow-arrow',
      },
      {
        id: 'automacoes',
        route: '/automacoes',
        label: 'Automações',
        labelKey: 'nav.automacoes',
        icon: 'ph-robot',
        showLockedWhenGated: true,
      },
    ],
  },
  {
    id: 'operacao',
    label: 'Operacao',
    labelKey: 'nav.operacao',
    icon: 'ph-folder',
    items: [
      {
        id: 'tarefas',
        route: '/tarefas',
        label: 'Tarefas',
        labelKey: 'nav.tarefas',
        icon: 'ph-list-checks',
      },
      {
        id: 'arquivos',
        route: '/arquivos',
        label: 'Arquivos',
        labelKey: 'nav.arquivos',
        icon: 'ph-folder-open',
      },
      {
        id: 'financeiro',
        route: '/financeiro',
        label: 'Financeiro',
        labelKey: 'nav.financeiro',
        icon: 'ph-wallet',
      },
      {
        id: 'contratos',
        route: '/contratos',
        label: 'Contratos',
        labelKey: 'nav.contratos',
        icon: 'ph-file-text',
      },
      {
        id: 'equipe',
        route: '/equipe',
        label: 'Equipe',
        labelKey: 'nav.equipe',
        icon: 'ph-user-circle-gear',
      },
    ],
  },
  {
    id: 'analytics-group',
    label: 'Analytics',
    labelKey: 'nav.analytics',
    icon: 'ph-chart-line-up',
    items: [
      {
        id: 'analytics',
        route: '/analytics',
        label: 'Instagram',
        labelKey: 'nav.instagram',
        icon: 'ph-instagram-logo',
      },
      {
        id: 'analytics-tiktok',
        route: '/analytics/tiktok',
        label: 'TikTok',
        labelKey: 'nav.tiktok',
        icon: 'ph-tiktok-logo',
      },
    ],
  },
  {
    id: 'ajuda-group',
    label: 'Suporte',
    labelKey: 'nav.suporte',
    icon: 'ph-lifebuoy',
    items: [
      {
        id: 'novidades',
        route: '/novidades',
        label: 'Novidades',
        labelKey: 'nav.novidades',
        icon: 'ph-sparkle',
        newTab: true,
      },
      {
        id: 'politica-de-privacidade',
        route: '/politica-de-privacidade',
        label: 'Privacidade',
        labelKey: 'nav.privacidade',
        icon: 'ph-shield-check',
        outsideShell: true,
      },
    ],
  },
  {
    id: 'config',
    label: 'Configuracoes',
    labelKey: 'nav.configuracoes',
    icon: 'ph-gear',
    items: [
      {
        id: 'configuracao',
        route: '/configuracao',
        label: 'Configuracoes',
        labelKey: 'nav.configuracoes',
        icon: 'ph-gear',
      },
      { id: 'ajuda', route: '/ajuda', label: 'Ajuda', labelKey: 'nav.ajuda', icon: 'ph-question' },
    ],
  },
];

export const PRIMARY_NAV_IDS = ['dashboard', 'clientes', 'analytics', 'entregas'];

/**
 * Maps nav item id → feature flag key(s). If the flag is false, the item is
 * hidden. An array entry is OR'd, but asymmetrically: the FIRST flag is the
 * legacy, already-deployed one and keeps fail-open semantics (`!== false` --
 * visible unless explicitly off); every OTHER flag is a newer addition and
 * is fail-closed (`=== true` -- visible only once explicitly on). This
 * matters during a rollout window: a brand-new flag like `feature_team_chat`
 * arrives `undefined` for every workspace until `workspace-limits` is
 * redeployed with the new column. Fail-open on it would show the item to
 * everyone in that window; fail-closed instead preserves today's behaviour
 * (nav item follows the legacy flag alone) until the redeploy lands, after
 * which either flag being explicitly true also shows the item.
 */
const NAV_FEATURE: Record<string, string | string[]> = {
  mcp: 'feature_mcp',
  leads: 'feature_leads',
  financeiro: 'feature_financial',
  contratos: 'feature_contracts',
  ideias: 'feature_ideas',
  mensagens: ['feature_mensagens', 'feature_team_chat'],
  analytics: 'feature_analytics_reports',
  'analytics-tiktok': 'feature_analytics_reports',
  'analytics-fluxos': 'feature_analytics_reports',
  'post-express': 'feature_post_scheduling',
  automacoes: 'feature_instagram_automation',
};

/**
 * Maps nav item id -> a flag that must be explicitly `true` for the item to show.
 * Unlike NAV_FEATURE this is fail-closed and applies even while `features` is
 * null (plan loading, or the unlimited path): the item stays hidden until the
 * plan says yes. Checked on top of NAV_FEATURE, never instead of it.
 */
const NAV_FEATURE_REQUIRED_TRUE: Record<string, string> = {
  'analytics-tiktok': 'feature_tiktok',
};

/**
 * Maps nav item id -> the module/action `can()` must grant 'ver'/'editar' on
 * for the item to survive the filter below. One single truth table replaces
 * the two hand-rolled role blocks this used to have (agent-only exclusions,
 * and the financial restricted-admin block) — `can()`'s own truth table
 * (derivePermission, lib/permissions.ts) already reproduces both byte-for-byte
 * for every legacy role, so nothing here re-encodes role literals.
 *
 * Ids with no entry (dashboard, ajuda, configuracao, novidades,
 * politica-de-privacidade) are outside the permission
 * catalog and always pass through unfiltered here.
 */
/** Exported so MobileNav.tsx's fixed primary bar (dashboard/clientes/
 * analytics/entregas, rendered outside the `getNavGroups`-driven "Mais"
 * sheet) can gate on the exact same table instead of a second, hand-rolled
 * mapping that could silently drift from this one. */
export const NAV_MODULE: Partial<Record<string, [PermissionModule, PermissionAction]>> = {
  calendario: ['calendario', 'ver'],
  leads: ['leads', 'ver'],
  clientes: ['clientes', 'ver'],
  entregas: ['entregas', 'ver'],
  'post-express': ['entregas', 'ver'],
  tarefas: ['tarefas', 'ver'],
  aprovacoes: ['aprovacoes', 'ver'],
  arquivos: ['arquivos', 'ver'],
  ideias: ['ideias', 'ver'],
  mensagens: ['clientes', 'ver'],
  financeiro: ['financeiro', 'ver'],
  contratos: ['contratos', 'ver'],
  equipe: ['equipe', 'ver'],
  analytics: ['analytics', 'ver'],
  'analytics-tiktok': ['analytics', 'ver'],
  'analytics-fluxos': ['analytics', 'ver'],
  automacoes: ['automacoes', 'ver'],
  importar: ['clientes', 'editar'],
};

export function getNavGroups(
  features: Record<string, boolean> | null,
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck,
): NavGroup[] {
  // `workspaceRole` has no owner-only filter to drive today -- the nav item
  // it used to gate ('cobranca') doesn't exist in ALL_NAV_GROUPS above (dead
  // code, removed). Kept in the signature rather than dropped: all three call
  // sites already resolve it from useAuth(), and a future owner-only item
  // (e.g. billing, if it returns to the nav) would need it immediately.
  void workspaceRole;

  let groups = ALL_NAV_GROUPS;

  // Single permission filter for every module-backed nav item. Fails CLOSED
  // on 'unknown' for EVERY gated id, not just the old financial pair
  // (anti-flash: a nav item that appears then bounces to a
  // restriction/redirect on click is worse than a brief absence during
  // membership hydration — same trade-off `formatFinancialBRL` makes). This
  // is a conscious choice, not an accident of `=== true`: the ROUTE itself
  // (ProtectedRoute/routePermissions.ts) stays NEUTRAL on 'unknown' instead
  // (renders children), so a user stuck in an error/unresolved state can
  // still navigate to a page by typing its URL even while its nav link is
  // hidden — the nav and the route are allowed to disagree here on purpose.
  groups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        const gate = NAV_MODULE[i.id];
        return !gate || can(gate[0], gate[1]) === true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  // Fail-closed flags: hidden unless explicitly true, null features included.
  groups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        const required = NAV_FEATURE_REQUIRED_TRUE[i.id];
        return !required || features?.[required] === true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  // Hide feature-gated nav items when the flag is explicitly false, unless
  // the item opts into staying visible-but-locked.
  if (features) {
    groups = groups
      .map((g) => ({
        ...g,
        items: g.items
          .map((i) => {
            const flag = NAV_FEATURE[i.id];
            if (!flag) return i;
            // Array semantics: flag[0] is the legacy flag (fail-open, `!==
            // false`); any additional flag is new and fail-closed (`===
            // true`) so an unredeployed/undefined new flag can't widen
            // access -- see the NAV_FEATURE doc comment above.
            const isEnabled = Array.isArray(flag)
              ? features[flag[0]] !== false || flag.slice(1).some((f) => features[f] === true)
              : features[flag] !== false;
            if (isEnabled) return i;
            return i.showLockedWhenGated ? { ...i, locked: true } : null;
          })
          .filter((i): i is NavItem => i !== null),
      }))
      .filter((g) => g.items.length > 0);
  }

  return groups;
}

/**
 * A nav item's route is "active" for a pathname on an exact match or a
 * child path, never on an unrelated route that merely shares a text prefix
 * -- plain `pathname.startsWith(route)` marks '/analytics-fluxos' active for
 * the '/analytics' (Instagram) item too, since the string '/analytics-fluxos'
 * starts with '/analytics'. Requiring the boundary '/' after `route` rules
 * that out while still matching real sub-routes like '/analytics/12'.
 *
 * TikTok paths are the one exception, and only when `itemId` is passed (the
 * sidebar): '/analytics/tiktok' and a client's '/analytics/<id>/tiktok' tab
 * belong to the `analytics-tiktok` item, so the `analytics` (Instagram) item
 * is NOT active there even though they are children of '/analytics'. Without
 * an item id (the phone tab bar's single Analytics tab) every '/analytics*'
 * child path still matches '/analytics', TikTok included.
 */
const TIKTOK_ANALYTICS_PATH = /^\/analytics\/(?:tiktok|[^/]+\/tiktok)\/?$/;

export function isNavRouteActive(pathname: string, route: string, itemId?: string): boolean {
  if (itemId === 'analytics-tiktok') return TIKTOK_ANALYTICS_PATH.test(pathname);
  if (itemId === 'analytics' && TIKTOK_ANALYTICS_PATH.test(pathname)) return false;
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function getMoreSheetGroups(
  features: Record<string, boolean> | null,
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck,
  /** Ids already on the tab bar. Defaults to the old fixed bar. */
  excludeIds: readonly string[] = PRIMARY_NAV_IDS,
): NavGroup[] {
  return getNavGroups(features, workspaceRole, can)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !excludeIds.includes(i.id)),
    }))
    .filter((g) => g.items.length > 0);
}

/** One slot of the phone tab bar. `navId` is the nav-data item it stands for. */
export interface PhoneTab {
  navId: string;
  route: string;
  label: string;
  labelKey: string;
}

const PHONE_TAB: Record<string, PhoneTab> = {
  dashboard: { navId: 'dashboard', route: '/dashboard', label: 'Início', labelKey: 'nav.home' },
  entregas: { navId: 'entregas', route: '/entregas', label: 'Entregas', labelKey: 'nav.entregas' },
  // With feature_agenda on, /calendario IS the Agenda (CalendarioPage renders AgendaPagina).
  calendario: {
    navId: 'calendario',
    route: '/calendario',
    label: 'Agenda',
    labelKey: 'nav.agenda',
  },
  mensagens: {
    navId: 'mensagens',
    route: '/mensagens',
    label: 'Mensagens',
    labelKey: 'nav.mensagens',
  },
  clientes: { navId: 'clientes', route: '/clientes', label: 'Clientes', labelKey: 'nav.clientes' },
  analytics: {
    navId: 'analytics',
    route: '/analytics',
    label: 'Analytics',
    labelKey: 'nav.analytics',
  },
};

/** Preferred tabs in bar order (D18). */
const PHONE_PRIMARY_IDS = ['dashboard', 'entregas', 'calendario', 'mensagens'] as const;
/** Fill a missing tab's slot, in this order. Otherwise they head the Mais sheet. */
const PHONE_FALLBACK_IDS = ['clientes', 'analytics'] as const;
export const PHONE_TAB_SLOTS = 4;

export interface PhoneNav {
  /** Up to four tabs; "Mais" is the fifth slot, always rendered by MobileNav. */
  tabs: PhoneTab[];
  /** Clientes / Analytics when they didn't make the bar, shown first in Mais. */
  shortcuts: NavItem[];
  /** Everything else for the Mais sheet, minus what is on the bar or in `shortcuts`. */
  moreGroups: NavGroup[];
}

/**
 * Phone tab bar (D18): Início, Entregas, Agenda, Mensagens, Mais.
 *
 * Availability comes from `getNavGroups`, the same permission and plan filter as the
 * sidebar, so the bar can't offer a page the sidebar hides. Agenda additionally needs
 * `agendaEnabled` (the workspace's `feature_agenda`): without it `/calendario` is the
 * editorial calendar, which stays in Mais as "Calendário". This is deliberately NOT a
 * `calendario` entry in NAV_FEATURE, which would hide that calendar on desktop too.
 *
 * A tab that isn't available gives its slot to Clientes, then Analytics, so the bar
 * keeps five items whenever enough pages are available.
 */
export function getPhoneNav(
  features: Record<string, boolean> | null,
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck,
  { agendaEnabled }: { agendaEnabled: boolean },
): PhoneNav {
  const groups = getNavGroups(features, workspaceRole, can);
  const usable = new Map<string, NavItem>();
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.locked && !item.disabled) usable.set(item.id, item);
    }
  }
  const isAvailable = (id: string) => usable.has(id) && (id !== 'calendario' || agendaEnabled);

  const fallbacks = PHONE_FALLBACK_IDS.filter((id) => usable.has(id));
  const tabIds: string[] = [];
  for (const id of PHONE_PRIMARY_IDS) {
    if (isAvailable(id)) tabIds.push(id);
    else if (fallbacks.length > 0) tabIds.push(fallbacks.shift()!);
  }
  // A missing tab with no fallback left just shrinks the bar; leftovers stay for Mais.
  const tabs = tabIds.slice(0, PHONE_TAB_SLOTS).map((id) => PHONE_TAB[id]);
  const onBar = new Set(tabs.map((t) => t.navId));
  // Named as on the tab bar ("Analytics", not the sidebar's "Instagram" under an
  // Analytics heading): in Mais they sit on their own, without that heading.
  const shortcuts = PHONE_FALLBACK_IDS.filter((id) => usable.has(id) && !onBar.has(id)).map(
    (id) => ({ ...usable.get(id)!, label: PHONE_TAB[id].label, labelKey: PHONE_TAB[id].labelKey }),
  );
  const exclude = [...onBar, ...shortcuts.map((s) => s.id)];
  return {
    tabs,
    shortcuts,
    moreGroups: getMoreSheetGroups(features, workspaceRole, can, exclude),
  };
}
