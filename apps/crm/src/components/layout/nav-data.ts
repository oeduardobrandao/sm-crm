import type { FinancialAccess } from '@/lib/financialAccess';
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';

export interface NavItem {
  id: string;
  route: string;
  label: string;
  labelKey: string;
  icon: string;
  /** Open the route in a new browser tab instead of in-app SPA navigation. */
  newTab?: boolean;
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
    id: 'gestao',
    label: 'Gestao',
    labelKey: 'nav.gestao',
    icon: 'ph-folder',
    items: [
      {
        id: 'entregas',
        route: '/entregas',
        label: 'Entregas',
        labelKey: 'nav.entregas',
        icon: 'ph-kanban',
      },
      {
        id: 'tarefas',
        route: '/tarefas',
        label: 'Tarefas',
        labelKey: 'nav.tarefas',
        icon: 'ph-list-checks',
      },
      {
        id: 'post-express',
        route: '/post-express',
        label: 'Post Express',
        labelKey: 'nav.postExpress',
        icon: 'ph-paper-plane-tilt',
      },
      {
        id: 'automacoes',
        route: '/automacoes',
        label: 'Automações',
        labelKey: 'nav.automacoes',
        icon: 'ph-robot',
        showLockedWhenGated: true,
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
        disabled: true,
      },
      {
        id: 'analytics-fluxos',
        route: '/analytics-fluxos',
        label: 'Fluxos',
        labelKey: 'nav.fluxos',
        icon: 'ph-flow-arrow',
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
      { id: 'ajuda', route: '/ajuda', label: 'Ajuda', labelKey: 'nav.ajuda', icon: 'ph-question' },
    ],
  },
  {
    id: 'config',
    label: 'Configuracoes',
    labelKey: 'nav.configuracoes',
    icon: 'ph-gear',
    isBottom: true,
    items: [
      {
        id: 'configuracao',
        route: '/configuracao',
        label: 'Configuracoes',
        labelKey: 'nav.configuracoes',
        icon: 'ph-gear',
      },
      {
        id: 'politica-de-privacidade',
        route: '/politica-de-privacidade',
        label: 'Privacidade',
        labelKey: 'nav.privacidade',
        icon: 'ph-shield-check',
      },
    ],
  },
];

export const PRIMARY_NAV_IDS = ['dashboard', 'clientes', 'analytics', 'entregas'];

/** Maps nav item id → feature flag key. If the flag is false, the item is hidden. */
const NAV_FEATURE: Record<string, string> = {
  mcp: 'feature_mcp',
  leads: 'feature_leads',
  financeiro: 'feature_financial',
  contratos: 'feature_contracts',
  ideias: 'feature_ideas',
  mensagens: 'feature_mensagens',
  analytics: 'feature_analytics_reports',
  'analytics-fluxos': 'feature_analytics_reports',
  'post-express': 'feature_post_scheduling',
  automacoes: 'feature_instagram_automation',
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
 * politica-de-privacidade, analytics-tiktok, cobranca) are outside the
 * permission catalog and always pass through unfiltered here.
 */
const NAV_MODULE: Partial<Record<string, [PermissionModule, PermissionAction]>> = {
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
  'analytics-fluxos': ['analytics', 'ver'],
  automacoes: ['automacoes', 'ver'],
  importar: ['clientes', 'editar'],
};

export function getNavGroups(
  role: string,
  features: Record<string, boolean> | null,
  canSeeFinancials: FinancialAccess,
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck,
): NavGroup[] {
  let groups = ALL_NAV_GROUPS;

  // Billing is owner-only. Sourced from `workspaceRole` (workspace_members for
  // the ACTIVE workspace), NOT the profile-derived `role`: switchWorkspace
  // never writes profiles.role, so an owner in workspace A who is admin/agent
  // in B would otherwise keep seeing the billing link while working in B.
  if (workspaceRole !== 'owner') {
    groups = groups.map((g) =>
      g.id === 'config' ? { ...g, items: g.items.filter((i) => i.id !== 'cobranca') } : g,
    );
  }

  // Single permission filter for every module-backed nav item. Fails CLOSED
  // on 'unknown' (anti-flash): a nav item that appears then bounces to a
  // restriction/redirect on click is worse than a brief absence during
  // membership hydration — same trade-off `formatFinancialBRL` makes.
  groups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        const gate = NAV_MODULE[i.id];
        return !gate || can(gate[0], gate[1]) === true;
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
            if (!flag || features[flag] !== false) return i;
            return i.showLockedWhenGated ? { ...i, locked: true } : null;
          })
          .filter((i): i is NavItem => i !== null),
      }))
      .filter((g) => g.items.length > 0);
  }

  return groups;
}

export function getMoreSheetGroups(
  role: string,
  features: Record<string, boolean> | null,
  canSeeFinancials: FinancialAccess,
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck,
): NavGroup[] {
  return getNavGroups(role, features, canSeeFinancials, workspaceRole, can)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !PRIMARY_NAV_IDS.includes(i.id)),
    }))
    .filter((g) => g.items.length > 0);
}
