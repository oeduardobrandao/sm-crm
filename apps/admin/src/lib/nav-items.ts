import {
  AppWindow,
  BookOpen,
  Building2,
  Film,
  HandCoins,
  LayoutDashboard,
  Megaphone,
  Package,
  Plug,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavId =
  | 'dashboard'
  | 'metricas'
  | 'workspaces'
  | 'afiliados'
  | 'planos'
  | 'admins'
  | 'integracoes'
  | 'banners'
  | 'popups'
  | 'artigos'
  | 'videos';

export interface AdminNavItem {
  id: NavId;
  to: string;
  label: string;
  icon: LucideIcon;
  /** iOS Settings-style tile colour (data, like plan-colors.ts). */
  tile: string;
}

export interface AdminNavGroup {
  label: string | null;
  items: AdminNavItem[];
}

const item = (
  id: NavId,
  to: string,
  label: string,
  icon: LucideIcon,
  tile: string,
): AdminNavItem => ({ id, to, label, icon, tile });

export const NAV_GROUPS: AdminNavGroup[] = [
  {
    label: null,
    items: [
      item('dashboard', '/admin', 'Dashboard', LayoutDashboard, '#facc15'),
      item('metricas', '/admin/metricas', 'Métricas', TrendingUp, '#34c759'),
      item('workspaces', '/admin/workspaces', 'Workspaces', Building2, '#007aff'),
      item('afiliados', '/admin/afiliados', 'Afiliados', HandCoins, '#ff9500'),
    ],
  },
  {
    label: 'Plataforma',
    items: [
      item('planos', '/admin/plans', 'Planos', Package, '#af52de'),
      item('admins', '/admin/admins', 'Admins', Users, '#30b0c7'),
      item('integracoes', '/admin/integrations', 'Integrações', Plug, '#636366'),
    ],
  },
  {
    label: 'Comunicação',
    items: [
      item('banners', '/admin/banners', 'Banners', Megaphone, '#ff6b35'),
      item('popups', '/admin/popups', 'Popups', AppWindow, '#5856d6'),
    ],
  },
  {
    label: 'Central de Ajuda',
    items: [
      item('artigos', '/admin/kb-articles', 'Artigos', BookOpen, '#0a84ff'),
      item('videos', '/admin/kb-videos', 'Vídeos', Film, '#ff3b30'),
    ],
  },
];

export const PHONE_TABS: AdminNavItem[] = NAV_GROUPS[0].items;
export const MAIS_GROUPS: AdminNavGroup[] = NAV_GROUPS.filter((g) => g.label !== null);

export function isRouteActive(pathname: string, to: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (to === '/admin') return path === '/admin';
  return path === to || path.startsWith(`${to}/`);
}

const PUSHED_EDITORS = [
  /^\/admin\/kb-articles\/(new|[^/]+\/edit)\/?$/,
  /^\/admin\/kb-videos\/(new|[^/]+\/edit)\/?$/,
];

/** The phone tab bar is hidden on the pushed full-screen editors. */
export function hidesTabBar(pathname: string): boolean {
  return PUSHED_EDITORS.some((re) => re.test(pathname));
}
