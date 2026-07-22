import {
  Home,
  CheckSquare,
  LayoutList,
  LayoutTemplate,
  FileText,
  CircleDot,
  Lightbulb,
  BarChart3,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  labelKey: string;
  icon: LucideIcon;
  path: string;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { label: 'Início', labelKey: 'nav.home', icon: Home, path: '' },
  { label: 'Aprovações', labelKey: 'nav.aprovacoes', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Postagens', labelKey: 'nav.postagens', icon: LayoutList, path: '/postagens' },
  { label: 'Páginas', labelKey: 'nav.paginas', icon: LayoutTemplate, path: '/paginas' },
  { label: 'Briefing', labelKey: 'nav.briefing', icon: FileText, path: '/briefing' },
  { label: 'Marca', labelKey: 'nav.marca', icon: CircleDot, path: '/marca' },
  { label: 'Ideias', labelKey: 'nav.ideias', icon: Lightbulb, path: '/ideias' },
  { label: 'Relatórios', labelKey: 'nav.relatorios', icon: BarChart3, path: '/relatorios' },
  { label: 'Mensagens', labelKey: 'nav.mensagens', icon: MessageCircle, path: '/mensagens' },
];

/** Shared between HubSidebar and HubMobileNav so the two nav surfaces can never drift. */
export function getVisibleNavItems(featureMensagens: boolean): NavItem[] {
  return BASE_NAV_ITEMS.filter((item) => item.path !== '/mensagens' || featureMensagens);
}
