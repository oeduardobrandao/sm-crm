export interface NavItem { id: string; route: string; label: string; icon: string }
export interface NavGroup { id: string; label: string; icon: string; items: NavItem[]; isBottom?: boolean }

export const ALL_NAV_GROUPS: NavGroup[] = [
  {
    id: 'visao-geral', label: 'Visão Geral', icon: 'ph-squares-four', items: [
      { id: 'dashboard', route: '/dashboard', label: 'Dashboard', icon: 'ph-chart-pie-slice' },
      { id: 'calendario', route: '/calendario', label: 'Calendário', icon: 'ph-calendar-blank' },
    ]
  },
  {
    id: 'crm', label: 'CRM', icon: 'ph-users', items: [
      { id: 'leads', route: '/leads', label: 'Leads', icon: 'ph-funnel' },
      { id: 'clientes', route: '/clientes', label: 'Clientes', icon: 'ph-users' },
      { id: 'ideias', route: '/ideias', label: 'Ideias', icon: 'ph-lightbulb' },
    ]
  },
  {
    id: 'gestao', label: 'Gestão', icon: 'ph-folder', items: [
      { id: 'entregas', route: '/entregas', label: 'Entregas', icon: 'ph-kanban' },
      { id: 'post-express', route: '/post-express', label: 'Post Express', icon: 'ph-paper-plane-tilt' },
      { id: 'arquivos', route: '/arquivos', label: 'Arquivos', icon: 'ph-folder-open' },
      { id: 'financeiro', route: '/financeiro', label: 'Financeiro', icon: 'ph-wallet' },
      { id: 'contratos', route: '/contratos', label: 'Contratos', icon: 'ph-file-text' },
      { id: 'equipe', route: '/equipe', label: 'Equipe', icon: 'ph-user-circle-gear' },
    ]
  },
  {
    id: 'analytics-group', label: 'Analytics', icon: 'ph-chart-line-up', items: [
      { id: 'analytics', route: '/analytics', label: 'Instagram', icon: 'ph-instagram-logo' },
      { id: 'analytics-fluxos', route: '/analytics-fluxos', label: 'Fluxos', icon: 'ph-flow-arrow' },
    ]
  },
  {
    id: 'config', label: 'Configurações', icon: 'ph-gear', isBottom: true, items: [
      { id: 'configuracao', route: '/configuracao', label: 'Configurações', icon: 'ph-gear' },
      { id: 'politica-de-privacidade', route: '/politica-de-privacidade', label: 'Privacidade', icon: 'ph-shield-check' },
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
