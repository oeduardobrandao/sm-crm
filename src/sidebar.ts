import { currentUserRole } from './store';

interface NavItem { id: string; route: string; label: string; icon: string; }
interface NavGroup { id: string; label: string; icon: string; items: NavItem[]; isBottom?: boolean; }

const allNavGroups: NavGroup[] = [
  { id: 'visao-geral', label: 'Visão Geral', icon: 'ph-squares-four', items: [
      { id: 'dashboard', route: '/dashboard', label: 'Dashboard', icon: 'ph-chart-pie-slice' },
      { id: 'calendario', route: '/calendario', label: 'Calendário', icon: 'ph-calendar-blank' } ] },
  { id: 'crm', label: 'CRM', icon: 'ph-users', items: [
      { id: 'leads', route: '/leads', label: 'Leads', icon: 'ph-funnel' },
      { id: 'clientes', route: '/clientes', label: 'Clientes', icon: 'ph-users' } ] },
  { id: 'gestao', label: 'Gestão', icon: 'ph-folder', items: [
      { id: 'entregas', route: '/entregas', label: 'Entregas', icon: 'ph-kanban' },
      { id: 'financeiro', route: '/financeiro', label: 'Financeiro', icon: 'ph-wallet' },
      { id: 'contratos', route: '/contratos', label: 'Contratos', icon: 'ph-file-text' },
      { id: 'equipe', route: '/equipe', label: 'Equipe', icon: 'ph-user-circle-gear' } ] },
  { id: 'plataforma', label: 'Plataforma', icon: 'ph-plugs-connected', items: [
      { id: 'integracoes', route: '/integracoes', label: 'Integrações', icon: 'ph-plugs-connected' } ] },
  { id: 'analytics-group', label: 'Analytics', icon: 'ph-chart-line-up', items: [
      { id: 'analytics', route: '/analytics', label: 'Analytics', icon: 'ph-chart-line-up' } ] },
  { id: 'config', label: 'Configurações', icon: 'ph-gear', isBottom: true, items: [
      { id: 'configuracao', route: '/configuracao', label: 'Configurações', icon: 'ph-gear' },
      { id: 'politica-de-privacidade', route: '/politica-de-privacidade', label: 'Privacidade', icon: 'ph-shield-check' } ] }
];

function getNavGroups(): NavGroup[] {
  if (currentUserRole !== 'agent') return allNavGroups;
  // Agents: hide CRM group entirely, hide financeiro/contratos from gestão
  return allNavGroups
    .filter(g => g.id !== 'crm')
    .map(g => {
      if (g.id === 'gestao') {
        return { ...g, items: g.items.filter(i => i.id !== 'financeiro' && i.id !== 'contratos') };
      }
      return g;
    });
}

export { type NavGroup, type NavItem };
export const navGroups = allNavGroups; // kept for external references
let activeGroupId: string | null = null;
let activeRoute: string | null = null;
let isFlyoutOpen = false;

export function initSidebar() {
  const railMain = document.getElementById('rail-nav-main');
  const railBottom = document.getElementById('rail-nav-bottom');
  if (!railMain || !railBottom) return;

  getNavGroups().forEach(group => {
    const li = document.createElement('li');
    li.className = 'rail-item';
    const btn = document.createElement('button');
    btn.className = 'rail-icon-btn';
    btn.setAttribute('data-group-id', group.id);
    btn.setAttribute('data-tooltip', group.label);
    btn.setAttribute('data-tooltip-dir', 'right');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'sidebar-flyout');
    btn.innerHTML = `<i class="ph ${group.icon}"></i>`;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFlyout(group.id);
    });
    li.appendChild(btn);
    if (group.isBottom) railBottom.appendChild(li);
    else railMain.appendChild(li);
  });

  document.addEventListener('click', (e) => {
    const flyout = document.getElementById('sidebar-flyout');
    const sidebarOuter = document.getElementById('sidebar');
    if (isFlyoutOpen && flyout && sidebarOuter) {
      if (!sidebarOuter.contains(e.target as Node)) {
        closeFlyout();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFlyoutOpen) closeFlyout();
  });

  syncActiveStateFromHash();
  window.addEventListener('hashchange', syncActiveStateFromHash);
}

function toggleFlyout(groupId: string) {
  if (activeGroupId === groupId && isFlyoutOpen) {
    closeFlyout();
    return;
  }
  openFlyout(groupId);
}

function openFlyout(groupId: string) {
  const group = getNavGroups().find(g => g.id === groupId);
  if (!group) return;

  activeGroupId = groupId;
  isFlyoutOpen = true;

  const flyout = document.getElementById('sidebar-flyout');
  if (flyout) {
    flyout.classList.add('open');
    flyout.setAttribute('aria-hidden', 'false');
  }

  const titleEl = document.getElementById('flyout-title');
  if (titleEl) titleEl.textContent = group.label;

  const menuContainer = document.getElementById('flyout-menu');
  if (menuContainer) {
    menuContainer.innerHTML = '';
    group.items.forEach(item => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'flyout-link';
      a.href = '#' + item.route;
      a.setAttribute('data-route', item.route);
      
      if (item.route === activeRoute) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }

      a.innerHTML = `<i class="ph ${item.icon}"></i> <span>${item.label}</span>`;
      a.addEventListener('click', () => { closeFlyout(); });
      li.appendChild(a);
      menuContainer.appendChild(li);
    });
  }
  updateRailActiveStyles();
}

function closeFlyout() {
  isFlyoutOpen = false;
  const flyout = document.getElementById('sidebar-flyout');
  if (flyout) {
    flyout.classList.remove('open');
    flyout.setAttribute('aria-hidden', 'true');
  }
  syncActiveStateFromHash();
}

export function syncActiveStateFromHash() {
  const hash = window.location.hash.replace('#', '') || '/dashboard';
  activeRoute = hash;

  let foundGroupId: string | null = null;
  getNavGroups().forEach(group => {
    group.items.forEach(item => { if (item.route === hash) foundGroupId = group.id; });
  });

  if (!isFlyoutOpen) activeGroupId = foundGroupId;

  updateRailActiveStyles();
  updateFlyoutActiveStyles();
}

function updateRailActiveStyles() {
  let currentRouteGroup: string | null = null;
  for (const group of getNavGroups()) {
    for (const item of group.items) {
      if (item.route === (activeRoute || '/dashboard')) currentRouteGroup = group.id;
    }
  }
  
  document.querySelectorAll('.rail-icon-btn[data-group-id]').forEach(btn => {
    const groupId = btn.getAttribute('data-group-id');
    const isActive = isFlyoutOpen ? (groupId === activeGroupId) : (groupId === currentRouteGroup);
    
    btn.classList.toggle('active', !!isActive);
    btn.setAttribute('aria-expanded', (groupId === activeGroupId && isFlyoutOpen) ? 'true' : 'false');
  });
}

function updateFlyoutActiveStyles() {
  document.querySelectorAll('.flyout-link').forEach(link => {
    const isActive = link.getAttribute('data-route') === activeRoute;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
