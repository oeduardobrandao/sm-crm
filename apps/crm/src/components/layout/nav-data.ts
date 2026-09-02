import type { FinancialAccess } from '@/lib/financialAccess';

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
  'analytics-fluxos': 'feature_analytics_reports',
  'post-express': 'feature_post_scheduling',
  automacoes: 'feature_instagram_automation',
};

export function getNavGroups(
  role: string,
  features: Record<string, boolean> | null,
  canSeeFinancials: FinancialAccess,
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
): NavGroup[] {
  let groups = ALL_NAV_GROUPS;

  // Billing is owner-only.
  if (role !== 'owner') {
    groups = groups.map((g) =>
      g.id === 'config' ? { ...g, items: g.items.filter((i) => i.id !== 'cobranca') } : g,
    );
  }

  if (role === 'agent') {
    groups = groups
      .map((g) => {
        if (g.id === 'crm') return { ...g, items: g.items.filter((i) => i.id !== 'leads') };
        if (g.id === 'gestao')
          return {
            ...g,
            // `equipe` is included because ProtectedRoute redirects agents away
            // from /equipe. Leaving the link visible rendered an item that
            // bounced them to /dashboard.
            items: g.items.filter(
              (i) => i.id !== 'financeiro' && i.id !== 'contratos' && i.id !== 'equipe',
            ),
          };
        return g;
      })
      .filter((g) => g.items.length > 0);
  }

  // Restricted admins lose the financial routes. Owners are never restricted,
  // and agents already lost them above.
  //
  // Sourced from `workspaceRole` (workspace_members for the ACTIVE workspace),
  // NOT the profile-derived `role`: switchWorkspace never writes
  // profiles.role, so an owner in workspace A who is a restricted admin in B
  // would otherwise keep seeing Financeiro/Contratos while working in B — the
  // link then bounces to the restriction screen, which is exactly the
  // flash-then-bounce this feature set exists to remove. Accepted cost:
  // workspaceRole is null until membership resolves, so an owner's financial
  // nav items appear a beat later instead of immediately — a brief flicker,
  // traded against a persistently wrong nav for multi-workspace users.
  //
  // Fails CLOSED on 'unknown'/null, matching formatFinancialBRL: flashing a nav item
  // that then bounces to a restriction screen is worse than a brief absence.
  if (workspaceRole !== 'owner' && canSeeFinancials !== true) {
    groups = groups
      .map((g) =>
        g.id === 'gestao'
          ? { ...g, items: g.items.filter((i) => i.id !== 'financeiro' && i.id !== 'contratos') }
          : g,
      )
      .filter((g) => g.items.length > 0);
  }

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

export function getMoreSheetGroups(
  role: string,
  features: Record<string, boolean> | null,
  canSeeFinancials: FinancialAccess,
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
): NavGroup[] {
  return getNavGroups(role, features, canSeeFinancials, workspaceRole)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !PRIMARY_NAV_IDS.includes(i.id)),
    }))
    .filter((g) => g.items.length > 0);
}
