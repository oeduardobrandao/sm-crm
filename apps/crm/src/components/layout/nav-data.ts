export interface NavItem { id: string; route: string; label: string; labelKey: string; icon: string }
export interface NavGroup { id: string; label: string; labelKey: string; icon: string; items: NavItem[]; isBottom?: boolean }

export const ALL_NAV_GROUPS: NavGroup[] = [
  {
    id: 'visao-geral', label: 'Visao Geral', labelKey: 'nav.visaoGeral', icon: 'ph-squares-four', items: [
      { id: 'dashboard', route: '/dashboard', label: 'Dashboard', labelKey: 'nav.dashboard', icon: 'ph-chart-pie-slice' },
      { id: 'calendario', route: '/calendario', label: 'Calendario', labelKey: 'nav.calendario', icon: 'ph-calendar-blank' },
    ]
  },
  {
    id: 'crm', label: 'CRM', labelKey: 'nav.crm', icon: 'ph-users', items: [
      { id: 'leads', route: '/leads', label: 'Leads', labelKey: 'nav.leads', icon: 'ph-funnel' },
      { id: 'clientes', route: '/clientes', label: 'Clientes', labelKey: 'nav.clientes', icon: 'ph-users' },
      { id: 'ideias', route: '/ideias', label: 'Ideias', labelKey: 'nav.ideias', icon: 'ph-lightbulb' },
    ]
  },
  {
    id: 'gestao', label: 'Gestao', labelKey: 'nav.gestao', icon: 'ph-folder', items: [
      { id: 'entregas', route: '/entregas', label: 'Entregas', labelKey: 'nav.entregas', icon: 'ph-kanban' },
      { id: 'post-express', route: '/post-express', label: 'Post Express', labelKey: 'nav.postExpress', icon: 'ph-paper-plane-tilt' },
      { id: 'arquivos', route: '/arquivos', label: 'Arquivos', labelKey: 'nav.arquivos', icon: 'ph-folder-open' },
      { id: 'financeiro', route: '/financeiro', label: 'Financeiro', labelKey: 'nav.financeiro', icon: 'ph-wallet' },
      { id: 'contratos', route: '/contratos', label: 'Contratos', labelKey: 'nav.contratos', icon: 'ph-file-text' },
      { id: 'equipe', route: '/equipe', label: 'Equipe', labelKey: 'nav.equipe', icon: 'ph-user-circle-gear' },
    ]
  },
  {
    id: 'analytics-group', label: 'Analytics', labelKey: 'nav.analytics', icon: 'ph-chart-line-up', items: [
      { id: 'analytics', route: '/analytics', label: 'Instagram', labelKey: 'nav.instagram', icon: 'ph-instagram-logo' },
      { id: 'analytics-fluxos', route: '/analytics-fluxos', label: 'Fluxos', labelKey: 'nav.fluxos', icon: 'ph-flow-arrow' },
    ]
  },
  {
    id: 'config', label: 'Configuracoes', labelKey: 'nav.configuracoes', icon: 'ph-gear', isBottom: true, items: [
      { id: 'configuracao', route: '/configuracao', label: 'Configuracoes', labelKey: 'nav.configuracoes', icon: 'ph-gear' },
      { id: 'politica-de-privacidade', route: '/politica-de-privacidade', label: 'Privacidade', labelKey: 'nav.privacidade', icon: 'ph-shield-check' },
    ]
  },
]

export const PRIMARY_NAV_IDS = ['dashboard', 'clientes', 'analytics', 'entregas']

export function getNavGroups(role: string): NavGroup[] {
  if (role !== 'agent') return ALL_NAV_GROUPS
  return ALL_NAV_GROUPS
    .map(g => {
      if (g.id === 'crm') return { ...g, items: g.items.filter(i => i.id !== 'leads') }
      if (g.id === 'gestao') return { ...g, items: g.items.filter(i => i.id !== 'financeiro' && i.id !== 'contratos') }
      return g
    })
    .filter(g => g.items.length > 0)
}

export function getMoreSheetGroups(role: string): NavGroup[] {
  return getNavGroups(role)
    .map(g => ({
      ...g,
      items: g.items.filter(i => !PRIMARY_NAV_IDS.includes(i.id))
    }))
    .filter(g => g.items.length > 0)
}
