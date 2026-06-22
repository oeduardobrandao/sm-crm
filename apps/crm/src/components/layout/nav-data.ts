export interface NavItem {
  id: string;
  route: string;
  label: string;
  labelKey: string;
  icon: string;
  /** Open the route in a new browser tab instead of in-app SPA navigation. */
  newTab?: boolean;
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
        id: 'post-express',
        route: '/post-express',
        label: 'Post Express',
        labelKey: 'nav.postExpress',
        icon: 'ph-paper-plane-tilt',
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
        id: 'cobranca',
        route: '/configuracao/cobranca',
        label: 'Plano & Cobrança',
        labelKey: 'nav.cobranca',
        icon: 'ph-credit-card',
      },
      {
        id: 'mcp',
        route: '/configuracao/mcp',
        label: 'Claude (MCP)',
        labelKey: 'nav.mcp',
        icon: 'ph-plugs-connected',
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
  analytics: 'feature_analytics_reports',
  'analytics-fluxos': 'feature_analytics_reports',
  'post-express': 'feature_post_scheduling',
};

export function getNavGroups(role: string, features?: Record<string, boolean> | null): NavGroup[] {
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
            items: g.items.filter((i) => i.id !== 'financeiro' && i.id !== 'contratos'),
          };
        return g;
      })
      .filter((g) => g.items.length > 0);
  }

  // Hide feature-gated nav items when the flag is explicitly false.
  if (features) {
    groups = groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => {
          const flag = NAV_FEATURE[i.id];
          return !flag || features[flag] !== false;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }

  return groups;
}

export function getMoreSheetGroups(
  role: string,
  features?: Record<string, boolean> | null,
): NavGroup[] {
  return getNavGroups(role, features)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !PRIMARY_NAV_IDS.includes(i.id)),
    }))
    .filter((g) => g.items.length > 0);
}
