# i18n Language Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add react-i18next infrastructure with a language toggle (PT/EN) and translate core CRM pages.

**Architecture:** New `packages/i18n/` workspace package shared by both CRM and Hub apps. Translation JSON files per namespace per language, loaded statically. Language stored in `localStorage` under `mesaas-language`. Toggle in CRM sidebar dropdown and Hub nav header.

**Tech Stack:** react-i18next, i18next, date-fns locales (ptBR/enUS), React 19, Vite, TypeScript

---

### Task 1: Install dependencies and create packages/i18n package

**Files:**
- Create: `packages/i18n/package.json`
- Create: `packages/i18n/index.ts`
- Modify: `package.json` (root — add i18next deps)
- Modify: `apps/crm/tsconfig.json` (add path alias for @mesaas/i18n)
- Modify: `apps/hub/tsconfig.json` (add path alias for @mesaas/i18n)
- Modify: `apps/crm/vite.config.ts` (add alias)
- Modify: `apps/hub/vite.config.ts` (add alias)
- Modify: `vitest.config.ts` (add alias)

- [ ] **Step 1: Install i18next and react-i18next**

```bash
npm install i18next react-i18next --save
```

- [ ] **Step 2: Create packages/i18n/package.json**

Create `packages/i18n/package.json`:

```json
{
  "name": "@mesaas/i18n",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "index.ts"
}
```

- [ ] **Step 3: Create packages/i18n/index.ts**

Create `packages/i18n/index.ts`:

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const STORAGE_KEY = 'mesaas-language';
const SUPPORTED_LANGUAGES = ['pt', 'en'] as const;
type Language = (typeof SUPPORTED_LANGUAGES)[number];

function getSavedLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED_LANGUAGES.includes(saved as Language)) return saved as Language;
  return 'pt';
}

export function initI18n(resources: Record<string, Record<string, Record<string, unknown>>>) {
  const namespaces = Object.keys(Object.values(resources)[0] ?? {});

  i18n.use(initReactI18next).init({
    lng: getSavedLanguage(),
    fallbackLng: 'pt',
    defaultNS: 'common',
    ns: namespaces,
    interpolation: { escapeValue: false },
    resources,
  });

  return i18n;
}

export function changeLanguage(lang: Language) {
  localStorage.setItem(STORAGE_KEY, lang);
  i18n.changeLanguage(lang);
}

export { i18n, SUPPORTED_LANGUAGES, STORAGE_KEY };
export type { Language };
```

- [ ] **Step 4: Add path aliases for @mesaas/i18n**

In `apps/crm/tsconfig.json`, add to `paths`:

```json
"@mesaas/i18n": ["../../packages/i18n/index.ts"]
```

In `apps/hub/tsconfig.json`, add the same path entry.

In `apps/crm/vite.config.ts`, add to `resolve.alias`:

```ts
'@mesaas/i18n': path.resolve(__dirname, '../../packages/i18n/index.ts'),
```

In `apps/hub/vite.config.ts`, add to `resolve.alias`:

```ts
'@mesaas/i18n': path.resolve(__dirname, '../../packages/i18n/index.ts'),
```

In `vitest.config.ts`, add to `resolve.alias`:

```ts
'@mesaas/i18n': path.resolve(__dirname, 'packages/i18n/index.ts'),
```

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds (no code uses i18n yet, just verifying resolution).

- [ ] **Step 6: Commit**

```bash
git add packages/i18n/ package.json package-lock.json apps/crm/tsconfig.json apps/hub/tsconfig.json apps/crm/vite.config.ts apps/hub/vite.config.ts vitest.config.ts
git commit -m "feat(i18n): add packages/i18n with i18next infrastructure"
```

---

### Task 2: Create common translation files and wire i18n into both apps

**Files:**
- Create: `packages/i18n/locales/pt/common.json`
- Create: `packages/i18n/locales/en/common.json`
- Modify: `apps/crm/src/main.tsx`
- Modify: `apps/hub/src/main.tsx`

- [ ] **Step 1: Create Portuguese common translations**

Create `packages/i18n/locales/pt/common.json`:

```json
{
  "nav.visaoGeral": "Visão Geral",
  "nav.dashboard": "Dashboard",
  "nav.calendario": "Calendário",
  "nav.crm": "CRM",
  "nav.leads": "Leads",
  "nav.clientes": "Clientes",
  "nav.ideias": "Ideias",
  "nav.gestao": "Gestão",
  "nav.entregas": "Entregas",
  "nav.postExpress": "Post Express",
  "nav.arquivos": "Arquivos",
  "nav.financeiro": "Financeiro",
  "nav.contratos": "Contratos",
  "nav.equipe": "Equipe",
  "nav.analytics": "Analytics",
  "nav.instagram": "Instagram",
  "nav.fluxos": "Fluxos",
  "nav.configuracoes": "Configurações",
  "nav.privacidade": "Privacidade",
  "sidebar.accountOptions": "Opções da Conta",
  "sidebar.workspace": "Workspace",
  "sidebar.language": "Idioma",
  "sidebar.lightMode": "Modo Claro",
  "sidebar.darkMode": "Modo Escuro",
  "sidebar.logout": "Sair",
  "sidebar.myAccount": "Minha Conta",
  "language.pt": "Português",
  "language.en": "English",
  "actions.save": "Salvar",
  "actions.cancel": "Cancelar",
  "actions.delete": "Remover",
  "actions.edit": "Editar",
  "actions.add": "Adicionar",
  "actions.close": "Fechar",
  "actions.confirm": "Confirmar",
  "actions.yes": "Sim",
  "actions.no": "Não",
  "actions.search": "Buscar",
  "actions.importCsv": "Importar CSV",
  "actions.back": "Voltar",
  "status.ativo": "Ativo",
  "status.pausado": "Pausado",
  "status.encerrado": "Encerrado",
  "status.novo": "Novo",
  "status.contatado": "Contatado",
  "status.qualificado": "Qualificado",
  "status.perdido": "Perdido",
  "status.convertido": "Convertido",
  "status.vigente": "Vigente",
  "status.a_assinar": "A Assinar",
  "status.todos": "Todos",
  "toast.saveError": "Erro ao salvar",
  "toast.deleteError": "Erro ao remover",
  "months.0": "Janeiro",
  "months.1": "Fevereiro",
  "months.2": "Março",
  "months.3": "Abril",
  "months.4": "Maio",
  "months.5": "Junho",
  "months.6": "Julho",
  "months.7": "Agosto",
  "months.8": "Setembro",
  "months.9": "Outubro",
  "months.10": "Novembro",
  "months.11": "Dezembro",
  "weekdays.0": "Domingo",
  "weekdays.1": "Segunda-feira",
  "weekdays.2": "Terça-feira",
  "weekdays.3": "Quarta-feira",
  "weekdays.4": "Quinta-feira",
  "weekdays.5": "Sexta-feira",
  "weekdays.6": "Sábado",
  "sort.name": "Nome",
  "sort.ascending": "Crescente",
  "sort.descending": "Decrescente",
  "filter.status": "Status",
  "filter.sortBy": "Ordenar por",
  "empty.noData": "Nenhum dado encontrado."
}
```

- [ ] **Step 2: Create English common translations**

Create `packages/i18n/locales/en/common.json`:

```json
{
  "nav.visaoGeral": "Overview",
  "nav.dashboard": "Dashboard",
  "nav.calendario": "Calendar",
  "nav.crm": "CRM",
  "nav.leads": "Leads",
  "nav.clientes": "Clients",
  "nav.ideias": "Ideas",
  "nav.gestao": "Management",
  "nav.entregas": "Deliverables",
  "nav.postExpress": "Express Post",
  "nav.arquivos": "Files",
  "nav.financeiro": "Finance",
  "nav.contratos": "Contracts",
  "nav.equipe": "Team",
  "nav.analytics": "Analytics",
  "nav.instagram": "Instagram",
  "nav.fluxos": "Workflows",
  "nav.configuracoes": "Settings",
  "nav.privacidade": "Privacy",
  "sidebar.accountOptions": "Account Options",
  "sidebar.workspace": "Workspace",
  "sidebar.language": "Language",
  "sidebar.lightMode": "Light Mode",
  "sidebar.darkMode": "Dark Mode",
  "sidebar.logout": "Log Out",
  "sidebar.myAccount": "My Account",
  "language.pt": "Português",
  "language.en": "English",
  "actions.save": "Save",
  "actions.cancel": "Cancel",
  "actions.delete": "Remove",
  "actions.edit": "Edit",
  "actions.add": "Add",
  "actions.close": "Close",
  "actions.confirm": "Confirm",
  "actions.yes": "Yes",
  "actions.no": "No",
  "actions.search": "Search",
  "actions.importCsv": "Import CSV",
  "actions.back": "Back",
  "status.ativo": "Active",
  "status.pausado": "Paused",
  "status.encerrado": "Closed",
  "status.novo": "New",
  "status.contatado": "Contacted",
  "status.qualificado": "Qualified",
  "status.perdido": "Lost",
  "status.convertido": "Converted",
  "status.vigente": "Active",
  "status.a_assinar": "To Sign",
  "status.todos": "All",
  "toast.saveError": "Failed to save",
  "toast.deleteError": "Failed to remove",
  "months.0": "January",
  "months.1": "February",
  "months.2": "March",
  "months.3": "April",
  "months.4": "May",
  "months.5": "June",
  "months.6": "July",
  "months.7": "August",
  "months.8": "September",
  "months.9": "October",
  "months.10": "November",
  "months.11": "December",
  "weekdays.0": "Sunday",
  "weekdays.1": "Monday",
  "weekdays.2": "Tuesday",
  "weekdays.3": "Wednesday",
  "weekdays.4": "Thursday",
  "weekdays.5": "Friday",
  "weekdays.6": "Saturday",
  "sort.name": "Name",
  "sort.ascending": "Ascending",
  "sort.descending": "Descending",
  "filter.status": "Status",
  "filter.sortBy": "Sort by",
  "empty.noData": "No data found."
}
```

- [ ] **Step 3: Wire i18n into CRM main.tsx**

Modify `apps/crm/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { initI18n } from '@mesaas/i18n';
import ptCommon from '../../../packages/i18n/locales/pt/common.json';
import enCommon from '../../../packages/i18n/locales/en/common.json';
import App from './App';
import '../style.css';

initI18n({
  pt: { common: ptCommon },
  en: { common: enCommon },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
```

- [ ] **Step 4: Wire i18n into Hub main.tsx**

Modify `apps/hub/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initI18n } from '@mesaas/i18n';
import ptCommon from '../../../packages/i18n/locales/pt/common.json';
import enCommon from '../../../packages/i18n/locales/en/common.json';
import { router } from './router';
import '../../crm/style.css';

initI18n({
  pt: { common: ptCommon },
  en: { common: enCommon },
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 5: Verify build passes**

```bash
npm run build
npm run build:hub
```

Expected: Both builds succeed.

- [ ] **Step 6: Commit**

```bash
git add packages/i18n/locales/ apps/crm/src/main.tsx apps/hub/src/main.tsx
git commit -m "feat(i18n): add common translations and wire i18n into both apps"
```

---

### Task 3: Add language toggle to CRM sidebar

**Files:**
- Modify: `apps/crm/src/components/layout/Sidebar.tsx`
- Modify: `apps/crm/src/components/layout/nav-data.ts`

- [ ] **Step 1: Make nav-data labels translatable**

Modify `apps/crm/src/components/layout/nav-data.ts` to use translation keys instead of hardcoded labels:

```ts
export interface NavItem { id: string; route: string; label: string; labelKey: string; icon: string }
export interface NavGroup { id: string; label: string; labelKey: string; icon: string; items: NavItem[]; isBottom?: boolean }

export const ALL_NAV_GROUPS: NavGroup[] = [
  {
    id: 'visao-geral', label: 'Visão Geral', labelKey: 'nav.visaoGeral', icon: 'ph-squares-four', items: [
      { id: 'dashboard', route: '/dashboard', label: 'Dashboard', labelKey: 'nav.dashboard', icon: 'ph-chart-pie-slice' },
      { id: 'calendario', route: '/calendario', label: 'Calendário', labelKey: 'nav.calendario', icon: 'ph-calendar-blank' },
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
    id: 'gestao', label: 'Gestão', labelKey: 'nav.gestao', icon: 'ph-folder', items: [
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
    id: 'config', label: 'Configurações', labelKey: 'nav.configuracoes', icon: 'ph-gear', isBottom: true, items: [
      { id: 'configuracao', route: '/configuracao', label: 'Configurações', labelKey: 'nav.configuracoes', icon: 'ph-gear' },
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
```

- [ ] **Step 2: Update Sidebar.tsx with i18n and language toggle**

Replace the full content of `apps/crm/src/components/layout/Sidebar.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { getNavGroups } from './nav-data';
import { changeLanguage, SUPPORTED_LANGUAGES, type Language } from '@mesaas/i18n';
import type { NavGroup } from './nav-data';

const LANGUAGE_FLAGS: Record<Language, string> = { pt: '🇧🇷', en: '🇺🇸' };

interface SidebarProps {
  isDrawer?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isDrawer = false, isOpen = false, onClose }: SidebarProps) {
  const { user, profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const [isDark, setIsDark] = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<any[]>([]);

  const navGroups = getNavGroups(role);
  const activeRoute = location.pathname;

  useEffect(() => {
    if (!user) return;
    supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(id, name)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data && data.length > 1) setWorkspaces(data);
      });
  }, [user?.id]);

  useEffect(() => {
    if (!isDrawer || !isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDrawer, isOpen, onClose]);

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
    if (next === 'light') document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', next);
    setIsDark(next === 'dark');
  };

  const handleNavClick = (route: string) => {
    navigate(route);
    if (isDrawer) onClose?.();
  };

  const handleWorkspaceSwitch = async (workspaceId: string) => {
    if (!user) return;
    await supabase
      .from('profiles')
      .update({ active_workspace_id: workspaceId, conta_id: workspaceId })
      .eq('id', user.id);
    window.location.reload();
  };

  const handleLanguageChange = (lang: Language) => {
    changeLanguage(lang);
  };

  const initials = profile?.nome
    ? profile.nome.split(' ').map((w: string) => w?.[0] || '').join('').substring(0, 2).toUpperCase()
    : 'U';

  const userName = profile?.nome || t('sidebar.myAccount');

  const mainGroups = navGroups.filter(g => !g.isBottom);
  const configItems = navGroups.find(g => g.id === 'config')?.items ?? [];

  const renderGroup = (group: NavGroup) => (
    <li key={group.id} className="sidebar-group">
      <div className="sidebar-group-label">{t(group.labelKey)}</div>
      <ul className="sidebar-sub-nav">
        {group.items.map(item => {
          const isActiveItem = activeRoute.startsWith(item.route);
          const ItemIcon = isActiveItem ? `ph-fill ${item.icon}` : `ph ${item.icon}`;
          return (
            <li key={item.id} className="sidebar-sub-item">
              <a
                className={`sidebar-sub-link ${isActiveItem ? 'active' : ''}`}
                href={`#${item.route}`}
                onClick={(e) => { e.preventDefault(); handleNavClick(item.route); }}
              >
                <i className={ItemIcon} />
                <span>{t(item.labelKey)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </li>
  );

  return (
    <nav
      className={`sidebar${isDrawer ? ' sidebar--drawer' : ''}${isDrawer && isOpen ? ' sidebar--open' : ''}`}
      id="sidebar"
    >
      <div className="sidebar-wrapper">
        <div className="logo-container" style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: '1.25rem', width: '100%', marginBottom: '1.5rem', marginTop: '1rem' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }} style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <img src={isDark ? "/logo-white.svg" : "/logo-black.svg"} alt="Mesaas" className="rail-logo" style={{ height: 16, width: 'auto' }} />
          </a>
        </div>

        <div className="sidebar-scrollable">
          <ul className="sidebar-nav" id="sidebar-nav-main">
            {mainGroups.map(renderGroup)}
          </ul>
        </div>

        <div className="sidebar-bottom">
          <div
            className="sidebar-user-menu"
            id="user-menu-wrap"
            tabIndex={0}
            onClick={() => setUserMenuOpen(v => !v)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setUserMenuOpen(false); }}
          >
            <div className="sidebar-user-trigger">
              <div className="avatar" style={{ width: 32, height: 32, borderRadius: 8, fontSize: '0.8rem' }}>
                {initials}
              </div>
              <span className="user-name-text">{userName}</span>
              <i className={`ph ${userMenuOpen ? 'ph-caret-up' : 'ph-caret-down'}`} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
            </div>

            {userMenuOpen && (
              <div className="user-menu-popover">
                <div className="user-dropdown-header" style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('sidebar.accountOptions')}</div>

                {workspaces.length > 1 && (
                  <div style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)', marginBottom: '0.25rem' }}>
                    <div style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {t('sidebar.workspace')}
                    </div>
                    {workspaces.map((m: any) => {
                      const isActive = m.workspaces.id === (profile?.active_workspace_id || profile?.conta_id);
                      return (
                        <button
                          key={m.workspaces.id}
                          className="user-dropdown-item"
                          style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--primary-color)' : 'var(--text-main)', padding: '0.5rem 0.75rem' }}
                          onClick={() => !isActive && handleWorkspaceSwitch(m.workspaces.id)}
                        >
                          <i className={`ph ${isActive ? 'ph-check-circle' : 'ph-circle'}`} />
                          <span>{m.workspaces.name || 'Workspace'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {configItems.length > 0 && (
                  <div style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)', marginBottom: '0.25rem' }}>
                    {configItems.map(item => (
                      <button
                        key={item.id}
                        className="user-dropdown-item"
                        style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', padding: '0.5rem 0.75rem' }}
                        onClick={() => { handleNavClick(item.route); setUserMenuOpen(false); }}
                      >
                        <i className={`ph ${item.icon}`} />
                        <span>{t(item.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border-color)', marginBottom: '0.25rem' }}>
                  <div style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {t('sidebar.language')}
                  </div>
                  {SUPPORTED_LANGUAGES.map(lang => {
                    const isActive = i18n.language === lang;
                    return (
                      <button
                        key={lang}
                        className="user-dropdown-item"
                        style={{ width: '100%', border: 'none', background: isActive ? 'rgba(234, 179, 8, 0.08)' : 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--primary-color)' : 'var(--text-main)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}
                        onClick={(e) => { e.stopPropagation(); handleLanguageChange(lang); }}
                      >
                        <span>{LANGUAGE_FLAGS[lang]}</span>
                        <span>{t(`language.${lang}`)}</span>
                        {isActive && <i className="ph ph-check" style={{ marginLeft: 'auto' }} />}
                      </button>
                    );
                  })}
                </div>

                <button
                  className="user-dropdown-item"
                  style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', padding: '0.5rem 0.75rem' }}
                  onClick={(e) => { e.stopPropagation(); toggleTheme(); }}
                >
                  <i className={`ph ${isDark ? 'ph-sun' : 'ph-moon'}`} />
                  <span>{isDark ? t('sidebar.lightMode') : t('sidebar.darkMode')}</span>
                </button>

                <button
                  id="btn-logout-flutuante"
                  className="user-dropdown-item"
                  style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}
                  onClick={signOut}
                >
                  <i className="ph ph-sign-out" /> {t('sidebar.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Verify build passes and test manually**

```bash
npm run build
```

Expected: Build succeeds. Run `npm run dev`, open the sidebar user menu, confirm the "Idioma" section appears with PT (selected) and EN. Switch to English and verify nav labels update.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/components/layout/Sidebar.tsx apps/crm/src/components/layout/nav-data.ts
git commit -m "feat(i18n): add language toggle to CRM sidebar with translated nav"
```

---

### Task 4: Add language toggle to Hub nav

**Files:**
- Modify: `apps/hub/src/shell/HubNav.tsx`

- [ ] **Step 1: Update HubNav with i18n and language toggle**

Modify `apps/hub/src/shell/HubNav.tsx` to add a language toggle next to the theme toggle in the desktop header and mobile header, and translate nav labels:

```tsx
import { Link, useLocation, useParams } from 'react-router-dom';
import { Home, CheckSquare, Palette, FileText, BookOpen, LayoutList, Sun, Moon, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { useTheme } from '../hooks/useTheme';
import { changeLanguage, SUPPORTED_LANGUAGES, type Language } from '@mesaas/i18n';

const LANGUAGE_FLAGS: Record<Language, string> = { pt: '🇧🇷', en: '🇺🇸' };

const NAV_ITEMS = [
  { labelKey: 'nav.home', fallback: 'Home', icon: Home, path: '' },
  { labelKey: 'nav.aprovacoes', fallback: 'Aprovações', icon: CheckSquare, path: '/aprovacoes' },
  { labelKey: 'nav.postagens', fallback: 'Postagens', icon: LayoutList, path: '/postagens' },
  { labelKey: 'nav.marca', fallback: 'Marca', icon: Palette, path: '/marca' },
  { labelKey: 'nav.paginas', fallback: 'Páginas', icon: FileText, path: '/paginas' },
  { labelKey: 'nav.briefing', fallback: 'Briefing', icon: BookOpen, path: '/briefing' },
];

export function HubNav() {
  const { bootstrap } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const base = `/${workspace}/hub/${token}`;
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();

  const nextLang = SUPPORTED_LANGUAGES.find(l => l !== i18n.language) ?? 'en';

  return (
    <>
      {/* Desktop top bar */}
      <header className="hidden md:block sticky top-0 z-20 border-b border-stone-900 bg-stone-950/95 backdrop-blur-md">
        <div className="mx-auto w-full max-w-5xl px-8 h-16 flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            {bootstrap.workspace.logo_url && (
              <img src={bootstrap.workspace.logo_url} alt={bootstrap.workspace.name} className="h-6 w-auto object-contain" />
            )}
            <span className="font-display text-[15px] font-semibold tracking-tight text-white">
              {bootstrap.workspace.name}
            </span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ labelKey, fallback, path }) => {
              const href = `${base}${path}`;
              const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
              return (
                <Link
                  key={path}
                  to={href}
                  className={`relative px-3 py-1.5 text-[13px] font-medium rounded-full transition-all duration-200 ${
                    active
                      ? 'text-white bg-white/10'
                      : 'text-stone-400 hover:text-white'
                  }`}
                >
                  {t(labelKey, fallback)}
                  {active && (
                    <span className="absolute left-1/2 -translate-x-1/2 -bottom-[17px] h-[2px] w-8 rounded-full bg-[#FFBF30]" />
                  )}
                </Link>
              );
            })}
          </nav>
          <span className="ml-auto flex items-center gap-3">
            <span className="text-[13px] text-stone-400">{bootstrap.cliente_nome}</span>
            <button
              onClick={() => changeLanguage(nextLang)}
              aria-label={t(`language.${nextLang}`)}
              className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors text-sm"
            >
              {LANGUAGE_FLAGS[i18n.language as Language]}
            </button>
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
              className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </span>
        </div>
      </header>

      {/* Mobile top bar (brand only) */}
      <header className="md:hidden sticky top-0 z-20 h-14 px-5 flex items-center justify-between border-b border-stone-900 bg-stone-950/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {bootstrap.workspace.logo_url && (
            <img src={bootstrap.workspace.logo_url} alt={bootstrap.workspace.name} className="h-5 w-auto object-contain" />
          )}
          <span className="font-display text-sm font-semibold tracking-tight text-white">
            {bootstrap.workspace.name}
          </span>
        </div>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400 truncate max-w-[120px]">{bootstrap.cliente_nome}</span>
          <button
            onClick={() => changeLanguage(nextLang)}
            aria-label={t(`language.${nextLang}`)}
            className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors text-xs"
          >
            {LANGUAGE_FLAGS[i18n.language as Language]}
          </button>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
            className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </span>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-stone-200/80 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {NAV_ITEMS.map(({ labelKey, fallback, icon: Icon, path }) => {
            const href = `${base}${path}`;
            const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
            return (
              <Link
                key={path}
                to={href}
                className="relative flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px]"
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-[#FFBF30]" />
                )}
                <Icon size={19} strokeWidth={active ? 2.25 : 1.75} className={active ? 'text-stone-900' : 'text-stone-400'} />
                <span className={active ? 'text-stone-900 font-semibold' : 'text-stone-500 font-medium'}>{t(labelKey, fallback)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
```

Also add hub nav keys to `packages/i18n/locales/pt/common.json`:

```json
"nav.home": "Home",
"nav.aprovacoes": "Aprovações",
"nav.postagens": "Postagens",
"nav.marca": "Marca",
"nav.paginas": "Páginas",
"nav.briefing": "Briefing"
```

And to `packages/i18n/locales/en/common.json`:

```json
"nav.home": "Home",
"nav.aprovacoes": "Approvals",
"nav.postagens": "Posts",
"nav.marca": "Brand",
"nav.paginas": "Pages",
"nav.briefing": "Briefing"
```

- [ ] **Step 2: Verify both builds pass**

```bash
npm run build
npm run build:hub
```

- [ ] **Step 3: Commit**

```bash
git add apps/hub/src/shell/HubNav.tsx packages/i18n/locales/
git commit -m "feat(i18n): add language toggle to Hub nav"
```

---

### Task 5: Translate Dashboard page

**Files:**
- Create: `packages/i18n/locales/pt/dashboard.json`
- Create: `packages/i18n/locales/en/dashboard.json`
- Modify: `apps/crm/src/main.tsx` (add dashboard namespace to resources)
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx`

- [ ] **Step 1: Create dashboard translation files**

Create `packages/i18n/locales/pt/dashboard.json`:

```json
{
  "title": "Dashboard",
  "today": "Hoje",
  "noEventsToday": "Nenhum evento hoje.",
  "receipt": "Recebimento",
  "expense": "Despesa",
  "birthday": "Aniversário",
  "leads": "Leads",
  "noLeadsYet": "Nenhum lead ainda.",
  "analytics": "Analytics",
  "accounts": "CONTAS",
  "followers": "SEGUIDORES",
  "reach28d": "ALCANCE (28D)",
  "avgEngagement": "ENG. MÉDIO",
  "websiteClicks": "CLIQUES NO LINK",
  "bestEngagement": "MELHOR ENG.",
  "mostGrown": "MAIS CRESCEU",
  "growing": "{{count}} crescendo",
  "stable": "{{count}} estável",
  "declining": "{{count}} caindo",
  "followersSuffix": "seg.",
  "noAccountConnected": "Nenhuma conta conectada",
  "deliverables": "Entregas",
  "active": "ATIVOS",
  "noActiveWorkflow": "Nenhum workflow ativo.",
  "contracts": "Contratos",
  "currentContracts": "VIGENTES",
  "toSign": "A ASSINAR",
  "expiringIn30Days": "EXPIRANDO EM 30 DIAS",
  "team": "Equipe",
  "members": "MEMBROS",
  "costPerMonth": "CUSTO/MÊS",
  "clt": "CLT",
  "monthly": "Mensal",
  "onDemand": "Demanda",
  "finance": "Financeiro",
  "toReceive": "A RECEBER",
  "toPay": "A PAGAR",
  "noTransactionsThisMonth": "Nenhuma transação este mês.",
  "calendar": "Calendário",
  "paymentsIn": "Pagamentos em {{month}}/{{year}}",
  "day": "Dia {{day}}",
  "noUpcomingPayments": "Nenhum pagamento próximo.",
  "monthlyRevenue": "RECEITA MENSAL",
  "activeClients": "{{count}} clientes ativos",
  "expenses": "DESPESAS",
  "thisMonth": "este mês",
  "balance": "SALDO",
  "projected": "projetado",
  "activeClientsLabel": "CLIENTES ATIVOS",
  "ofTotal": "de {{total}} total",
  "currentContractsLabel": "CONTRATOS VIGENTES",
  "toSignCount": "{{count}} a assinar"
}
```

Create `packages/i18n/locales/en/dashboard.json`:

```json
{
  "title": "Dashboard",
  "today": "Today",
  "noEventsToday": "No events today.",
  "receipt": "Income",
  "expense": "Expense",
  "birthday": "Birthday",
  "leads": "Leads",
  "noLeadsYet": "No leads yet.",
  "analytics": "Analytics",
  "accounts": "ACCOUNTS",
  "followers": "FOLLOWERS",
  "reach28d": "REACH (28D)",
  "avgEngagement": "AVG. ENGAGEMENT",
  "websiteClicks": "LINK CLICKS",
  "bestEngagement": "BEST ENG.",
  "mostGrown": "MOST GROWN",
  "growing": "{{count}} growing",
  "stable": "{{count}} stable",
  "declining": "{{count}} declining",
  "followersSuffix": "fol.",
  "noAccountConnected": "No account connected",
  "deliverables": "Deliverables",
  "active": "ACTIVE",
  "noActiveWorkflow": "No active workflows.",
  "contracts": "Contracts",
  "currentContracts": "ACTIVE",
  "toSign": "TO SIGN",
  "expiringIn30Days": "EXPIRING IN 30 DAYS",
  "team": "Team",
  "members": "MEMBERS",
  "costPerMonth": "COST/MONTH",
  "clt": "CLT",
  "monthly": "Monthly",
  "onDemand": "On Demand",
  "finance": "Finance",
  "toReceive": "RECEIVABLE",
  "toPay": "PAYABLE",
  "noTransactionsThisMonth": "No transactions this month.",
  "calendar": "Calendar",
  "paymentsIn": "Payments in {{month}}/{{year}}",
  "day": "Day {{day}}",
  "noUpcomingPayments": "No upcoming payments.",
  "monthlyRevenue": "MONTHLY REVENUE",
  "activeClients": "{{count}} active clients",
  "expenses": "EXPENSES",
  "thisMonth": "this month",
  "balance": "BALANCE",
  "projected": "projected",
  "activeClientsLabel": "ACTIVE CLIENTS",
  "ofTotal": "of {{total}} total",
  "currentContractsLabel": "ACTIVE CONTRACTS",
  "toSignCount": "{{count}} to sign"
}
```

- [ ] **Step 2: Register dashboard namespace in CRM main.tsx**

Add dashboard imports to `apps/crm/src/main.tsx`:

```tsx
import ptDashboard from '../../../packages/i18n/locales/pt/dashboard.json';
import enDashboard from '../../../packages/i18n/locales/en/dashboard.json';

initI18n({
  pt: { common: ptCommon, dashboard: ptDashboard },
  en: { common: enCommon, dashboard: enDashboard },
});
```

- [ ] **Step 3: Update DashboardPage.tsx to use translations**

Key changes to `apps/crm/src/pages/dashboard/DashboardPage.tsx`:

1. Add `import { useTranslation } from 'react-i18next';` at the top
2. Add `const { t } = useTranslation('dashboard');` and `const { t: tc } = useTranslation('common');` inside the component
3. Replace `monthNames` and `weekDayNames` arrays with `tc('months.N')` and `tc('weekdays.N')` calls
4. Replace all hardcoded Portuguese strings with `t()` calls using the keys from the translation files
5. Replace `.toLocaleString('pt-BR')` with `.toLocaleString(i18n.language === 'en' ? 'en-US' : 'pt-BR')` for number formatting

The full list of string replacements:
- `<h1>Dashboard</h1>` → `<h1>{t('title')}</h1>`
- `<h3>...Hoje</h3>` → `<h3>...{t('today')}</h3>`
- `{weekDayNames[now.getDay()]}, {todayDay} de {monthNames[todayMonth]}` → use `tc('weekdays.' + now.getDay())` and `tc('months.' + todayMonth)`
- `Nenhum evento hoje.` → `{t('noEventsToday')}`
- `Recebimento` → `{t('receipt')}`
- `Despesa` → `{t('expense')}`
- `Aniversário` → `{t('birthday')}`
- `<h3>...Leads</h3>` → `<h3>...{t('leads')}</h3>`
- `Nenhum lead ainda.` → `{t('noLeadsYet')}`
- All KPI labels: `CONTAS` → `{t('accounts')}`, `SEGUIDORES` → `{t('followers')}`, etc.
- `crescendo/estável/caindo` badges → `{t('growing', { count })}`/`{t('stable', { count })}`/`{t('declining', { count })}`
- `seg.` → `{t('followersSuffix')}`
- `Nenhuma conta conectada` → `{t('noAccountConnected')}`
- `<h3>...Entregas</h3>` → `<h3>...{t('deliverables')}</h3>`
- `ATIVOS` → `{t('active')}`
- `Nenhum workflow ativo.` → `{t('noActiveWorkflow')}`
- `<h3>...Contratos</h3>` → `<h3>...{t('contracts')}</h3>`
- `VIGENTES`/`A ASSINAR` → `{t('currentContracts')}`/`{t('toSign')}`
- `EXPIRANDO EM 30 DIAS` → `{t('expiringIn30Days')}`
- `<h3>...Equipe</h3>` → `<h3>...{t('team')}</h3>`
- `MEMBROS`/`CUSTO/MÊS` → `{t('members')}`/`{t('costPerMonth')}`
- `CLT:/Mensal:/Demanda:` badges → `{t('clt')}: / {t('monthly')}: / {t('onDemand')}:`
- `<h3>...Financeiro</h3>` → `<h3>...{t('finance')}</h3>`
- `A RECEBER`/`A PAGAR` → `{t('toReceive')}`/`{t('toPay')}`
- `Nenhuma transação este mês.` → `{t('noTransactionsThisMonth')}`
- `Pagamentos em {mesAtual}/{anoAtual}` → `{t('paymentsIn', { month: mesAtual, year: anoAtual })}`
- `Dia {ev.dia}` → `{t('day', { day: ev.dia })}`
- `Nenhum pagamento próximo.` → `{t('noUpcomingPayments')}`
- All KPI grid labels → use corresponding `t()` keys
- `{stats.clientesAtivos.length} clientes ativos` → `{t('activeClients', { count: stats.clientesAtivos.length })}`
- `este mês` → `{t('thisMonth')}`
- `projetado` → `{t('projected')}`
- `de {stats.clientes.length} total` → `{t('ofTotal', { total: stats.clientes.length })}`
- `{contratosAAssinar.length} a assinar` → `{t('toSignCount', { count: contratosAAssinar.length })}`

Remove the `monthNames` and `weekDayNames` const arrays entirely.

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/locales/pt/dashboard.json packages/i18n/locales/en/dashboard.json apps/crm/src/main.tsx apps/crm/src/pages/dashboard/DashboardPage.tsx
git commit -m "feat(i18n): translate Dashboard page"
```

---

### Task 6: Translate Clients list page

**Files:**
- Create: `packages/i18n/locales/pt/clients.json`
- Create: `packages/i18n/locales/en/clients.json`
- Modify: `apps/crm/src/main.tsx` (add clients namespace)
- Modify: `apps/crm/src/pages/clientes/ClientesPage.tsx`

- [ ] **Step 1: Create clients translation files**

Create `packages/i18n/locales/pt/clients.json`:

```json
{
  "title": "Clientes",
  "tooltip": "Gerencie todos os clientes e contratos ativos.",
  "csvTooltip": "Colunas: nome*, email, telefone, plano, valor_mensal, notion_page_url, data_pagamento",
  "newClient": "Novo Cliente",
  "searchPlaceholder": "Buscar por nome ou e-mail...",
  "sortMonthlyValue": "Valor Mensal",
  "sortPaymentDay": "Dia Pagamento",
  "openInNotion": "Abrir no Notion",
  "editClient": "Editar Cliente",
  "form.name": "Nome *",
  "form.email": "E-mail",
  "form.phone": "Telefone",
  "form.plan": "Plano",
  "form.monthlyValue": "Valor Mensal (R$)",
  "form.notionUrl": "URL do Notion",
  "form.paymentDay": "Dia de Pagamento (1-31)",
  "form.status": "Status",
  "deleteConfirm": "Remover este cliente?",
  "toast.updated": "Cliente atualizado",
  "toast.added": "Cliente adicionado",
  "toast.removed": "Cliente removido",
  "toast.importSuccess": "{{count}} cliente importado com sucesso!",
  "toast.importSuccess_other": "{{count}} clientes importados com sucesso!",
  "validation.nameRequired": "Nome obrigatório",
  "validation.emailInvalid": "E-mail inválido",
  "validation.paymentDayRange": "Dia deve ser entre 1 e 31"
}
```

Create `packages/i18n/locales/en/clients.json`:

```json
{
  "title": "Clients",
  "tooltip": "Manage all your clients and active contracts.",
  "csvTooltip": "Columns: nome*, email, telefone, plano, valor_mensal, notion_page_url, data_pagamento",
  "newClient": "New Client",
  "searchPlaceholder": "Search by name or email...",
  "sortMonthlyValue": "Monthly Value",
  "sortPaymentDay": "Payment Day",
  "openInNotion": "Open in Notion",
  "editClient": "Edit Client",
  "form.name": "Name *",
  "form.email": "Email",
  "form.phone": "Phone",
  "form.plan": "Plan",
  "form.monthlyValue": "Monthly Value (R$)",
  "form.notionUrl": "Notion URL",
  "form.paymentDay": "Payment Day (1-31)",
  "form.status": "Status",
  "deleteConfirm": "Remove this client?",
  "toast.updated": "Client updated",
  "toast.added": "Client added",
  "toast.removed": "Client removed",
  "toast.importSuccess": "{{count}} client imported successfully!",
  "toast.importSuccess_other": "{{count}} clients imported successfully!",
  "validation.nameRequired": "Name is required",
  "validation.emailInvalid": "Invalid email",
  "validation.paymentDayRange": "Day must be between 1 and 31"
}
```

- [ ] **Step 2: Register clients namespace in CRM main.tsx**

Add to `apps/crm/src/main.tsx` imports and `initI18n` call:

```tsx
import ptClients from '../../../packages/i18n/locales/pt/clients.json';
import enClients from '../../../packages/i18n/locales/en/clients.json';

// In initI18n call:
pt: { common: ptCommon, dashboard: ptDashboard, clients: ptClients },
en: { common: enCommon, dashboard: enDashboard, clients: enClients },
```

- [ ] **Step 3: Update ClientesPage.tsx to use translations**

Key changes to `apps/crm/src/pages/clientes/ClientesPage.tsx`:

1. Add `import { useTranslation } from 'react-i18next';` and `import type { TFunction } from 'i18next';`
2. Convert `clienteSchema` to a factory: `const createClienteSchema = (t: TFunction) => z.object({...})` using `t('validation.nameRequired')` etc.
3. Add `const { t } = useTranslation('clients');` and `const { t: tc } = useTranslation('common');` inside the component
4. Replace `STATUS_LABEL` usage with `tc('status.' + status)`
5. Replace all Portuguese strings with `t()` calls
6. Wrap schema creation with `useMemo`: `const clienteSchema = useMemo(() => createClienteSchema(t), [t]);`
7. Update the form's `resolver` to use the memoized schema

Full string replacements:
- `<h1>Clientes</h1>` → `<h1>{t('title')}</h1>`
- tooltip text → `{t('tooltip')}` and `{t('csvTooltip')}`
- `Importar CSV` → `{tc('actions.importCsv')}`
- `Novo Cliente` → `{t('newClient')}`
- `Buscar por nome ou e-mail...` → `{t('searchPlaceholder')}`
- `Status` → `{tc('filter.status')}`
- `Todos` → `{tc('status.todos')}`
- `Ordenar por` → `{tc('filter.sortBy')}`
- `Nome` → `{tc('sort.name')}`
- `Valor Mensal` → `{t('sortMonthlyValue')}`
- `Dia Pagamento` → `{t('sortPaymentDay')}`
- `Decrescente/Crescente` → `{tc('sort.descending')}/{tc('sort.ascending')}`
- `Editar` → `{tc('actions.edit')}`
- `Remover` → `{tc('actions.delete')}`
- Dialog title: `editing ? 'Editar Cliente' : 'Novo Cliente'` → `editing ? t('editClient') : t('newClient')`
- Form labels → `t('form.name')`, `t('form.email')`, etc.
- `Cancelar` → `{tc('actions.cancel')}`
- `Salvar` → `{tc('actions.save')}`
- `Remover este cliente?` → `{t('deleteConfirm')}`
- `Não`/`Sim` → `{tc('actions.no')}`/`{tc('actions.yes')}`
- Toast messages → `t('toast.updated')`, `t('toast.added')`, `t('toast.removed')`, `t('toast.saveError')`
- CSV import success → `t('toast.importSuccess', { count })`

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/locales/pt/clients.json packages/i18n/locales/en/clients.json apps/crm/src/main.tsx apps/crm/src/pages/clientes/ClientesPage.tsx
git commit -m "feat(i18n): translate Clients list page"
```

---

### Task 7: Translate Leads page

**Files:**
- Create: `packages/i18n/locales/pt/leads.json`
- Create: `packages/i18n/locales/en/leads.json`
- Modify: `apps/crm/src/main.tsx` (add leads namespace)
- Modify: `apps/crm/src/pages/leads/LeadsPage.tsx`

- [ ] **Step 1: Create leads translation files**

Create `packages/i18n/locales/pt/leads.json`:

```json
{
  "title": "Leads",
  "tooltip": "Gerencie seus leads e converta-os em clientes.",
  "csvTooltip": "Colunas: nome*, email, instagram, canal, especialidade, faturamento, tags, notas",
  "newLead": "Novo Lead",
  "searchPlaceholder": "Buscar por nome ou e-mail...",
  "editLead": "Editar Lead",
  "convertToClient": "Converter em Cliente",
  "converting": "Convertendo Lead em Cliente",
  "deleteConfirm": "Remover este lead?",
  "table.name": "Nome",
  "table.instagram": "Instagram",
  "table.channel": "Canal",
  "table.specialty": "Especialidade",
  "table.revenue": "Faturamento",
  "table.status": "Status",
  "table.actions": "Ações",
  "form.name": "Nome *",
  "form.email": "E-mail",
  "form.instagram": "Instagram",
  "form.channel": "Canal de Aquisição",
  "form.selectChannel": "Selecione o canal",
  "form.specialty": "Especialidade",
  "form.revenue": "Faixa de Faturamento",
  "form.selectRevenue": "Selecione a faixa",
  "form.tags": "Tags (separadas por vírgula)",
  "form.notes": "Notas",
  "form.status": "Status",
  "convert.name": "Nome *",
  "convert.email": "E-mail",
  "convert.phone": "Telefone",
  "convert.plan": "Plano",
  "convert.monthlyValue": "Valor Mensal (R$)",
  "convert.paymentDay": "Dia de Pagamento (1-31)",
  "toast.created": "Lead criado",
  "toast.updated": "Lead atualizado",
  "toast.removed": "Lead removido",
  "toast.converted": "Lead convertido em cliente!",
  "toast.importSuccess": "{{count}} lead importado com sucesso!",
  "toast.importSuccess_other": "{{count}} leads importados com sucesso!",
  "validation.nameRequired": "Nome obrigatório",
  "validation.emailInvalid": "E-mail inválido",
  "validation.paymentDayRange": "Dia deve ser entre 1 e 31",
  "channel.Instagram": "Instagram",
  "channel.Facebook": "Facebook",
  "channel.GoogleAds": "Google Ads",
  "channel.Indicacao": "Indicação",
  "channel.Site": "Site",
  "channel.WhatsApp": "WhatsApp",
  "channel.Typeform": "Typeform",
  "channel.Outro": "Outro",
  "revenue.upTo5k": "Até R$ 5.000/mês",
  "revenue.5kTo10k": "De R$ 5.000 a R$ 10.000/mês",
  "revenue.10kTo20k": "De R$ 10.000 a R$ 20.000/mês",
  "revenue.20kTo50k": "De R$ 20.000 a R$ 50.000/mês",
  "revenue.above50k": "Acima de R$ 50.000/mês"
}
```

Create `packages/i18n/locales/en/leads.json`:

```json
{
  "title": "Leads",
  "tooltip": "Manage your leads and convert them into clients.",
  "csvTooltip": "Columns: nome*, email, instagram, canal, especialidade, faturamento, tags, notas",
  "newLead": "New Lead",
  "searchPlaceholder": "Search by name or email...",
  "editLead": "Edit Lead",
  "convertToClient": "Convert to Client",
  "converting": "Converting Lead to Client",
  "deleteConfirm": "Remove this lead?",
  "table.name": "Name",
  "table.instagram": "Instagram",
  "table.channel": "Channel",
  "table.specialty": "Specialty",
  "table.revenue": "Revenue",
  "table.status": "Status",
  "table.actions": "Actions",
  "form.name": "Name *",
  "form.email": "Email",
  "form.instagram": "Instagram",
  "form.channel": "Acquisition Channel",
  "form.selectChannel": "Select channel",
  "form.specialty": "Specialty",
  "form.revenue": "Revenue Range",
  "form.selectRevenue": "Select range",
  "form.tags": "Tags (comma-separated)",
  "form.notes": "Notes",
  "form.status": "Status",
  "convert.name": "Name *",
  "convert.email": "Email",
  "convert.phone": "Phone",
  "convert.plan": "Plan",
  "convert.monthlyValue": "Monthly Value (R$)",
  "convert.paymentDay": "Payment Day (1-31)",
  "toast.created": "Lead created",
  "toast.updated": "Lead updated",
  "toast.removed": "Lead removed",
  "toast.converted": "Lead converted to client!",
  "toast.importSuccess": "{{count}} lead imported successfully!",
  "toast.importSuccess_other": "{{count}} leads imported successfully!",
  "validation.nameRequired": "Name is required",
  "validation.emailInvalid": "Invalid email",
  "validation.paymentDayRange": "Day must be between 1 and 31",
  "channel.Instagram": "Instagram",
  "channel.Facebook": "Facebook",
  "channel.GoogleAds": "Google Ads",
  "channel.Indicacao": "Referral",
  "channel.Site": "Website",
  "channel.WhatsApp": "WhatsApp",
  "channel.Typeform": "Typeform",
  "channel.Outro": "Other",
  "revenue.upTo5k": "Up to R$ 5,000/month",
  "revenue.5kTo10k": "R$ 5,000 to R$ 10,000/month",
  "revenue.10kTo20k": "R$ 10,000 to R$ 20,000/month",
  "revenue.20kTo50k": "R$ 20,000 to R$ 50,000/month",
  "revenue.above50k": "Above R$ 50,000/month"
}
```

- [ ] **Step 2: Register leads namespace in CRM main.tsx**

Add leads imports and register in `initI18n` call.

- [ ] **Step 3: Update LeadsPage.tsx to use translations**

Same pattern as ClientesPage:
1. Add `useTranslation('leads')` hook
2. Convert `leadSchema` and `convertSchema` to factories receiving `t`
3. Replace `STATUS_LABELS` usage with `tc('status.' + status)`
4. Replace `CANAL_OPTIONS` with translated channel options using `t('channel.*')` keys
5. Replace `FATURAMENTO_OPTIONS` with translated revenue options using `t('revenue.*')` keys
6. Replace all hardcoded strings with `t()` calls
7. Replace all toast messages with translated versions

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/locales/pt/leads.json packages/i18n/locales/en/leads.json apps/crm/src/main.tsx apps/crm/src/pages/leads/LeadsPage.tsx
git commit -m "feat(i18n): translate Leads page"
```

---

### Task 8: Translate Express Post page

**Files:**
- Create: `packages/i18n/locales/pt/posts.json`
- Create: `packages/i18n/locales/en/posts.json`
- Modify: `apps/crm/src/main.tsx` (add posts namespace)
- Modify: `apps/crm/src/pages/post-express/ExpressPostPage.tsx`

- [ ] **Step 1: Create posts translation files**

Create `packages/i18n/locales/pt/posts.json`:

```json
{
  "expressPost.title": "Post Express",
  "expressPost.subtitle": "Publique rapidamente no Instagram",
  "expressPost.client": "Cliente",
  "expressPost.selectClient": "Selecionar cliente...",
  "expressPost.noClientsWithIg": "Nenhum cliente com Instagram conectado.",
  "expressPost.connectAccount": "Conectar conta",
  "expressPost.media": "Mídia",
  "expressPost.preparingDraft": "Preparando rascunho...",
  "expressPost.caption": "Legenda do Instagram",
  "expressPost.captionPlaceholder": "Escreva a legenda do post aqui...",
  "expressPost.preview": "Preview",
  "expressPost.mediaAppearsHere": "Mídia aparece aqui",
  "expressPost.publishNow": "Publicar agora",
  "expressPost.willPublishImmediately": "O post será publicado imediatamente no Instagram",
  "expressPost.confirmTitle": "Publicar agora?",
  "expressPost.publishing": "Publicando…",
  "expressPost.confirmDescription": "O post será publicado imediatamente no Instagram. Esta ação não pode ser desfeita.",
  "expressPost.publishingDescription": "Aguarde enquanto o post é publicado no Instagram.",
  "expressPost.sendingToIg": "Enviando para o Instagram…",
  "expressPost.done": "Concluído!",
  "expressPost.publish": "Publicar",
  "expressPost.published": "Post publicado no Instagram!",
  "expressPost.processing": "Post sendo processado pelo Instagram. Acompanhe na página de entregas.",
  "expressPost.viewPost": "Ver post",
  "expressPost.viewDeliverables": "Ver entregas",
  "expressPost.draftError": "Erro ao preparar rascunho: {{error}}",
  "expressPost.warning.revoked": "Token do Instagram foi revogado. Reconecte a conta nas configurações do cliente.",
  "expressPost.warning.expired": "Token do Instagram expirou. Reconecte a conta nas configurações do cliente.",
  "expressPost.warning.noPublishPermission": "Permissão de publicação não concedida. Reconecte a conta com as permissões necessárias.",
  "postType.feed": "Feed",
  "postType.reels": "Reels",
  "postType.carrossel": "Carrossel"
}
```

Create `packages/i18n/locales/en/posts.json`:

```json
{
  "expressPost.title": "Express Post",
  "expressPost.subtitle": "Quickly publish to Instagram",
  "expressPost.client": "Client",
  "expressPost.selectClient": "Select client...",
  "expressPost.noClientsWithIg": "No clients with Instagram connected.",
  "expressPost.connectAccount": "Connect account",
  "expressPost.media": "Media",
  "expressPost.preparingDraft": "Preparing draft...",
  "expressPost.caption": "Instagram Caption",
  "expressPost.captionPlaceholder": "Write the post caption here...",
  "expressPost.preview": "Preview",
  "expressPost.mediaAppearsHere": "Media appears here",
  "expressPost.publishNow": "Publish now",
  "expressPost.willPublishImmediately": "The post will be published immediately on Instagram",
  "expressPost.confirmTitle": "Publish now?",
  "expressPost.publishing": "Publishing…",
  "expressPost.confirmDescription": "The post will be published immediately on Instagram. This action cannot be undone.",
  "expressPost.publishingDescription": "Please wait while the post is published on Instagram.",
  "expressPost.sendingToIg": "Sending to Instagram…",
  "expressPost.done": "Done!",
  "expressPost.publish": "Publish",
  "expressPost.published": "Post published on Instagram!",
  "expressPost.processing": "Post being processed by Instagram. Track it on the deliverables page.",
  "expressPost.viewPost": "View post",
  "expressPost.viewDeliverables": "View deliverables",
  "expressPost.draftError": "Failed to prepare draft: {{error}}",
  "expressPost.warning.revoked": "Instagram token was revoked. Reconnect the account in client settings.",
  "expressPost.warning.expired": "Instagram token has expired. Reconnect the account in client settings.",
  "expressPost.warning.noPublishPermission": "Publish permission not granted. Reconnect the account with the required permissions.",
  "postType.feed": "Feed",
  "postType.reels": "Reels",
  "postType.carrossel": "Carousel"
}
```

- [ ] **Step 2: Register posts namespace in CRM main.tsx**

Add posts imports and register in `initI18n` call.

- [ ] **Step 3: Update ExpressPostPage.tsx to use translations**

1. Add `import { useTranslation } from 'react-i18next';`
2. Add `const { t } = useTranslation('posts');` and `const { t: tc } = useTranslation('common');`
3. Update `getTypeLabel` to receive `t` and use `t('postType.feed')` etc.
4. Replace all hardcoded strings with `t()` calls following the keys above
5. Replace warning messages with `t('expressPost.warning.revoked')` etc.
6. Replace toast messages with translated versions
7. Replace dialog strings with translated versions

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/locales/pt/posts.json packages/i18n/locales/en/posts.json apps/crm/src/main.tsx apps/crm/src/pages/post-express/ExpressPostPage.tsx
git commit -m "feat(i18n): translate Express Post page"
```

---

### Task 9: Translate Client Detail page

**Files:**
- Modify: `apps/crm/src/main.tsx` (clients namespace already registered)
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`
- Modify: `packages/i18n/locales/pt/clients.json` (add detail keys)
- Modify: `packages/i18n/locales/en/clients.json` (add detail keys)

- [ ] **Step 1: Add client detail keys to translation files**

Append to `packages/i18n/locales/pt/clients.json`:

```json
"detail.back": "Voltar",
"detail.editInfo": "Editar Informações",
"detail.tabs.overview": "Visão Geral",
"detail.tabs.deliverables": "Entregas",
"detail.tabs.finance": "Financeiro",
"detail.tabs.hub": "Hub",
"detail.tabs.files": "Arquivos",
"detail.tabs.dates": "Datas",
"detail.tabs.addresses": "Endereços",
"detail.tabs.instagram": "Instagram",
"detail.plan": "Plano",
"detail.email": "E-mail",
"detail.phone": "Telefone",
"detail.paymentDay": "Dia pgto",
"detail.deliveryDay": "Dia entrega",
"detail.monthlyValue": "Valor Mensal",
"detail.noTitle": "Sem título",
"detail.calendarUpdated": "Calendário atualizado!",
"detail.calendarUpdateError": "Erro ao atualizar calendário.",
"detail.postScheduled": "Post agendado.",
"detail.postMarkedPosted": "Post marcado como postado.",
"detail.postUpdateError": "Erro ao atualizar status do post.",
"detail.stepCompleted": "Etapa concluída!",
"detail.stepError": "Erro ao concluir etapa: {{error}}",
"detail.newCycleCreated": "Novo ciclo criado!",
"detail.newCycleError": "Erro ao criar ciclo",
"detail.nameRequired": "Nome é obrigatório.",
"detail.paymentDayError": "Dia de pagamento deve ser entre 1 e 31.",
"detail.deliveryDayError": "Dia de entrega deve ser entre 1 e 31.",
"detail.clientUpdated": "Cliente atualizado!",
"detail.clientSaveError": "Erro ao salvar: {{error}}",
"detail.cepNotFound": "CEP não encontrado.",
"detail.fillRequired": "Preencha todos os campos obrigatórios.",
"detail.addressUpdated": "Endereço atualizado!",
"detail.addressAdded": "Endereço adicionado!",
"detail.addressSaveError": "Erro ao salvar endereço: {{error}}",
"detail.addressRemoved": "Endereço removido!",
"detail.addressRemoveError": "Erro ao remover: {{error}}",
"detail.fillTitleAndDate": "Preencha título e data.",
"detail.dateUpdated": "Data atualizada!",
"detail.dateAdded": "Data adicionada!",
"detail.dateRemoved": "Data removida!",
"detail.clickAddDates": "Clique em \"Adicionar\" para registrar datas relevantes.",
"detail.clickAddAddress": "Clique em \"Adicionar\" para cadastrar um endereço.",
"detail.selectDay": "Selecione um dia.",
"detail.noPostsThisDay": "Nenhuma postagem neste dia.",
"detail.postStatus.rascunho": "Rascunho",
"detail.postStatus.revisao_interna": "Em revisão",
"detail.postStatus.enviado_cliente": "Enviado",
"detail.postStatus.correcao_cliente": "Correção",
"detail.postType.feed": "Feed",
"detail.postType.reels": "Reels",
"detail.postType.stories": "Stories",
"detail.postType.carrossel": "Carrossel",
"detail.igNotBusiness": "A conta Instagram não é uma conta Business. Reconecte com uma conta Business ou Creator."
```

Append the same keys with English translations to `packages/i18n/locales/en/clients.json`:

```json
"detail.back": "Back",
"detail.editInfo": "Edit Information",
"detail.tabs.overview": "Overview",
"detail.tabs.deliverables": "Deliverables",
"detail.tabs.finance": "Finance",
"detail.tabs.hub": "Hub",
"detail.tabs.files": "Files",
"detail.tabs.dates": "Dates",
"detail.tabs.addresses": "Addresses",
"detail.tabs.instagram": "Instagram",
"detail.plan": "Plan",
"detail.email": "Email",
"detail.phone": "Phone",
"detail.paymentDay": "Payment day",
"detail.deliveryDay": "Delivery day",
"detail.monthlyValue": "Monthly Value",
"detail.noTitle": "No title",
"detail.calendarUpdated": "Calendar updated!",
"detail.calendarUpdateError": "Failed to update calendar.",
"detail.postScheduled": "Post scheduled.",
"detail.postMarkedPosted": "Post marked as posted.",
"detail.postUpdateError": "Failed to update post status.",
"detail.stepCompleted": "Step completed!",
"detail.stepError": "Failed to complete step: {{error}}",
"detail.newCycleCreated": "New cycle created!",
"detail.newCycleError": "Failed to create cycle",
"detail.nameRequired": "Name is required.",
"detail.paymentDayError": "Payment day must be between 1 and 31.",
"detail.deliveryDayError": "Delivery day must be between 1 and 31.",
"detail.clientUpdated": "Client updated!",
"detail.clientSaveError": "Failed to save: {{error}}",
"detail.cepNotFound": "ZIP code not found.",
"detail.fillRequired": "Please fill in all required fields.",
"detail.addressUpdated": "Address updated!",
"detail.addressAdded": "Address added!",
"detail.addressSaveError": "Failed to save address: {{error}}",
"detail.addressRemoved": "Address removed!",
"detail.addressRemoveError": "Failed to remove: {{error}}",
"detail.fillTitleAndDate": "Please fill in title and date.",
"detail.dateUpdated": "Date updated!",
"detail.dateAdded": "Date added!",
"detail.dateRemoved": "Date removed!",
"detail.clickAddDates": "Click \"Add\" to register important dates.",
"detail.clickAddAddress": "Click \"Add\" to register an address.",
"detail.selectDay": "Select a day.",
"detail.noPostsThisDay": "No posts on this day.",
"detail.postStatus.rascunho": "Draft",
"detail.postStatus.revisao_interna": "In Review",
"detail.postStatus.enviado_cliente": "Sent",
"detail.postStatus.correcao_cliente": "Correction",
"detail.postType.feed": "Feed",
"detail.postType.reels": "Reels",
"detail.postType.stories": "Stories",
"detail.postType.carrossel": "Carousel",
"detail.igNotBusiness": "The Instagram account is not a Business account. Reconnect with a Business or Creator account."
```

- [ ] **Step 2: Update ClienteDetalhePage.tsx to use translations**

This is a large file (1414 lines). Key changes:

1. Add `import { useTranslation } from 'react-i18next';`
2. Add `const { t } = useTranslation('clients');` and `const { t: tc } = useTranslation('common');`
3. Replace hardcoded month arrays with `tc('months.N')` calls
4. Replace all toast messages, labels, form texts, tab labels with `t()` calls
5. Replace post type/status labels with `t('detail.postType.*')` / `t('detail.postStatus.*')` calls
6. Replace all validation error strings with `t()` calls
7. Replace `.toLocaleString('pt-BR')` with locale-aware formatting

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

- [ ] **Step 4: Run tests**

```bash
npm run test
```

Expected: All tests pass (no regressions from i18n changes).

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/locales/ apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "feat(i18n): translate Client Detail page"
```

---

### Task 10: Update Hub HubShell error states and run final verification

**Files:**
- Modify: `apps/hub/src/shell/HubShell.tsx`
- Modify: `apps/hub/src/router.tsx`

- [ ] **Step 1: Translate HubShell static strings**

Update `apps/hub/src/shell/HubShell.tsx` to add `useTranslation()` and replace:
- `"Link inválido ou expirado."` → `{t('hub.invalidLink')}`
- `"Acesso desativado."` → `{t('hub.accessDisabled')}`
- `"Entre em contato com a agência."` → `{t('hub.contactAgency')}`

Add these keys to common.json:
- PT: `"hub.invalidLink": "Link inválido ou expirado."`, `"hub.accessDisabled": "Acesso desativado."`, `"hub.contactAgency": "Entre em contato com a agência."`
- EN: `"hub.invalidLink": "Invalid or expired link."`, `"hub.accessDisabled": "Access disabled."`, `"hub.contactAgency": "Please contact the agency."`

Update `apps/hub/src/router.tsx` catch-all route:
- `"Link inválido."` → needs i18n but is outside React context. Keep as-is for now (it's a static 404 page, low priority).

- [ ] **Step 2: Run full build for both apps**

```bash
npm run build
npm run build:hub
```

Expected: Both builds succeed.

- [ ] **Step 3: Run full test suite**

```bash
npm run test
```

Expected: All tests pass.

- [ ] **Step 4: Manual smoke test**

Run `npm run dev` and verify:
1. Sidebar shows language toggle with PT selected and flag
2. Switching to English updates all nav labels, sidebar strings, theme toggle text
3. Dashboard page shows English KPI labels, month/day names, empty states
4. Clients page shows English title, form labels, toast messages, filter labels
5. Leads page shows English title, table headers, form labels, channel/revenue options
6. Express Post page shows English title, labels, confirmation dialog
7. Client Detail page shows English tab labels, form fields, toast messages
8. Refreshing the page preserves the language choice
9. Switching back to Portuguese restores all original text

Run `npm run dev:hub` and verify:
1. Hub nav shows language flag button
2. Clicking it toggles between PT and EN
3. Nav labels update (Aprovações → Approvals, etc.)
4. Error states show translated text

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(i18n): translate Hub shell and finalize language toggle"
```

---

### Task 11: Add .superpowers to .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add .superpowers to .gitignore**

Append `.superpowers/` to `.gitignore` (the brainstorming visual companion created files there).

- [ ] **Step 2: Remove tracked .superpowers files if any**

```bash
git rm -r --cached .superpowers/ 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add .superpowers to gitignore"
```
