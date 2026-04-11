# Hub Calendar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hub's simple dot-grid calendar with the CRM's two-column post calendar, move it to the home page, and remove the standalone Calendário page and nav entry.

**Architecture:** Extract a `PostCalendar` component from the CRM calendar design, render it in `HomePage` below the section cards (reusing the already-fetched posts query), and remove `CalendarioPage`, its route, and its nav item.

**Tech Stack:** React, TypeScript, Tailwind CSS, `@tanstack/react-query` (data already fetched by caller)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/hub/src/components/PostCalendar.tsx` | Self-contained calendar component |
| Modify | `apps/hub/src/pages/HomePage.tsx` | Add `<PostCalendar>` below cards, remove Calendário section |
| Delete | `apps/hub/src/pages/CalendarioPage.tsx` | Removed entirely |
| Modify | `apps/hub/src/router.tsx` | Remove calendário route + import |
| Modify | `apps/hub/src/shell/HubNav.tsx` | Remove Calendário nav item |

---

### Task 1: Create the `PostCalendar` component

**Files:**
- Create: `apps/hub/src/components/PostCalendar.tsx`

This component receives `posts: HubPost[]` and renders the full two-column calendar identical to the CRM design. No data fetching inside — the caller passes posts.

- [ ] **Step 1: Create the file**

```tsx
// apps/hub/src/components/PostCalendar.tsx
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HubPost } from '../types';

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

const TIPO_COLOR: Record<string, string> = {
  feed: '#3b82f6',
  reels: '#8b5cf6',
  stories: '#f59e0b',
  carrossel: '#10b981',
};

const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  em_producao: 'Em produção',
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção',
  agendado: 'Agendado',
  publicado: 'Publicado',
};

interface Props {
  posts: HubPost[];
}

export function PostCalendar({ posts }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isSameCalMonth = month === today.getMonth() && year === today.getFullYear();

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  function postsForDay(day: number) {
    return posts.filter(p => {
      if (!p.scheduled_at) return false;
      const d = new Date(p.scheduled_at);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  }

  const selectedPosts = selectedDay ? postsForDay(selectedDay) : [];

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4 border rounded-xl overflow-hidden bg-card">

        {/* Left: calendar grid */}
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-base">Postagens</h2>
              <p className="text-sm text-muted-foreground">{MONTHS_PT[month]} {year}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="p-1.5 rounded hover:bg-accent transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={nextMonth} className="p-1.5 rounded hover:bg-accent transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_PT.map(d => (
              <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[56px]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayPosts = postsForDay(day);
              const hasEvents = dayPosts.length > 0;
              const isToday = day === today.getDate() && isSameCalMonth;
              const isSelected = selectedDay === day;

              // Group by tipo
              const byTipo: Record<string, number> = {};
              for (const p of dayPosts) {
                byTipo[p.tipo] = (byTipo[p.tipo] || 0) + 1;
              }

              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`min-h-[56px] p-1 rounded cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent ring-1 ring-primary/30' : 'hover:bg-accent/50'
                  } ${hasEvents ? '' : ''}`}
                >
                  <div className={`text-xs mb-1 w-5 h-5 flex items-center justify-center rounded-full font-medium ${
                    isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}>
                    {day}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(byTipo).map(([tipo, count]) => (
                      <div
                        key={tipo}
                        className="text-[9px] px-1 py-0.5 rounded font-semibold leading-none truncate"
                        style={{
                          background: `${TIPO_COLOR[tipo] ?? '#6b7280'}18`,
                          color: TIPO_COLOR[tipo] ?? '#6b7280',
                        }}
                      >
                        {count} {TIPO_LABEL[tipo] ?? tipo}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: side panel */}
        <div className="border-t md:border-t-0 md:border-l p-4 bg-muted/30">
          <div className="mb-3">
            <h3 className="font-medium text-sm">Postagens</h3>
            <p className="text-xs text-muted-foreground">
              {selectedDay
                ? `${selectedDay} de ${MONTHS_PT[month]}, ${year}`
                : `${MONTHS_PT[month]} ${year}`}
            </p>
          </div>

          {selectedPosts.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {selectedDay ? 'Nenhuma postagem neste dia.' : 'Selecione um dia.'}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedPosts.map(p => (
                <div key={p.id} className="rounded-lg border bg-card p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        background: `${TIPO_COLOR[p.tipo] ?? '#6b7280'}18`,
                        color: TIPO_COLOR[p.tipo] ?? '#6b7280',
                      }}
                    >
                      {(TIPO_LABEL[p.tipo] ?? p.tipo).toUpperCase()}
                    </span>
                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-snug">{p.titulo}</p>
                  {p.scheduled_at && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.scheduled_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles** (no test framework for components — check with build)

```bash
cd apps/hub && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `PostCalendar.tsx`

- [ ] **Step 3: Commit**

```bash
cd /Users/eduardosouza/Projects/sm-crm
git add apps/hub/src/components/PostCalendar.tsx
git commit -m "feat(hub): add PostCalendar two-column component"
```

---

### Task 2: Update `HomePage` — add calendar, remove Calendário section card

**Files:**
- Modify: `apps/hub/src/pages/HomePage.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
// apps/hub/src/pages/HomePage.tsx
import { useNavigate, useParams } from 'react-router-dom';
import { CheckSquare, Palette, FileText, BookOpen } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCalendar } from '../components/PostCalendar';

const SECTIONS = [
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes', description: 'Posts aguardando sua aprovação' },
  { label: 'Marca', icon: Palette, path: '/marca', description: 'Identidade visual e arquivos' },
  { label: 'Páginas', icon: FileText, path: '/paginas', description: 'Materiais e estratégia' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing', description: 'Informações do seu projeto' },
];

export function HomePage() {
  const { bootstrap, token } = useHub();
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  const base = `/${workspace}/hub/${token}`;

  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const posts = data?.posts ?? [];
  const pendingCount = posts.filter(p => p.status === 'enviado_cliente').length;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <p className="text-sm text-muted-foreground mb-1">{bootstrap.workspace.name}</p>
        <h1 className="text-2xl font-semibold">Olá, {bootstrap.cliente_nome.split(' ')[0]} 👋</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SECTIONS.map(({ label, icon: Icon, path, description }) => {
          const isPendente = path === '/aprovacoes' && pendingCount > 0;
          return (
            <button
              key={path}
              onClick={() => navigate(`${base}${path}`)}
              className="relative flex flex-col items-center text-center p-5 rounded-xl border bg-white hover:bg-accent transition-colors gap-2"
            >
              {isPendente && (
                <span className="absolute top-2 right-2 bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5 font-medium">
                  {pendingCount}
                </span>
              )}
              <Icon size={24} className="text-muted-foreground" />
              <span className="font-medium text-sm">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12 mt-8">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <PostCalendar posts={posts} />
      )}
    </div>
  );
}
```

> Note: The grid changes from `sm:grid-cols-3` to `sm:grid-cols-4` since there are now 4 section cards instead of 5.

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/hub && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /Users/eduardosouza/Projects/sm-crm
git add apps/hub/src/pages/HomePage.tsx
git commit -m "feat(hub): embed PostCalendar on home page, remove Calendário section card"
```

---

### Task 3: Remove `CalendarioPage`, its route, and its nav item

**Files:**
- Delete: `apps/hub/src/pages/CalendarioPage.tsx`
- Modify: `apps/hub/src/router.tsx`
- Modify: `apps/hub/src/shell/HubNav.tsx`

- [ ] **Step 1: Delete `CalendarioPage.tsx`**

```bash
rm apps/hub/src/pages/CalendarioPage.tsx
```

- [ ] **Step 2: Update `router.tsx`**

Replace the entire file:

```tsx
// apps/hub/src/router.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { HubShell } from './shell/HubShell';
import { HomePage } from './pages/HomePage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { MarcaPage } from './pages/MarcaPage';
import { PaginasPage } from './pages/PaginasPage';
import { PaginaPage } from './pages/PaginaPage';
import { BriefingPage } from './pages/BriefingPage';

export const router = createBrowserRouter([
  {
    path: '/:workspace/hub/:token',
    element: <HubShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'aprovacoes', element: <AprovacoesPage /> },
      { path: 'marca', element: <MarcaPage /> },
      { path: 'paginas', element: <PaginasPage /> },
      { path: 'paginas/:pageId', element: <PaginaPage /> },
      { path: 'briefing', element: <BriefingPage /> },
    ],
  },
  { path: '*', element: <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p style={{ fontFamily: 'sans-serif', color: '#666' }}>Link inválido.</p></div> },
]);
```

- [ ] **Step 3: Update `HubNav.tsx`**

Replace the entire file:

```tsx
// apps/hub/src/shell/HubNav.tsx
import { Link, useLocation, useParams } from 'react-router-dom';
import { Home, CheckSquare, Palette, FileText, BookOpen } from 'lucide-react';
import { useHub } from '../HubContext';

const NAV_ITEMS = [
  { label: 'Home', icon: Home, path: '' },
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Marca', icon: Palette, path: '/marca' },
  { label: 'Páginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing' },
];

export function HubNav() {
  const { bootstrap } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const base = `/${workspace}/hub/${token}`;

  return (
    <>
      {/* Desktop top bar */}
      <header className="hidden md:flex items-center gap-6 px-6 py-3 border-b border-zinc-800 bg-black text-white sticky top-0 z-10">
        <div className="flex items-center gap-2 mr-4">
          {bootstrap.workspace.logo_url && (
            <img src={bootstrap.workspace.logo_url} alt={bootstrap.workspace.name} className="h-7 w-auto object-contain" />
          )}
          <span className="font-semibold text-sm">{bootstrap.workspace.name}</span>
        </div>
        {NAV_ITEMS.map(({ label, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          return (
            <Link key={path} to={href} className={`text-sm transition-colors ${active ? 'font-semibold text-white' : 'text-zinc-400 hover:text-white'}`}>
              {label}
            </Link>
          );
        })}
        <span className="ml-auto text-sm text-zinc-400">{bootstrap.cliente_nome}</span>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-black border-t border-zinc-800 z-10 flex">
        {NAV_ITEMS.map(({ label, icon: Icon, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          return (
            <Link key={path} to={href} className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${active ? 'text-white font-medium' : 'text-zinc-400'}`}>
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
```

> Note: Mobile nav now uses the full `NAV_ITEMS` array (5 items) instead of `slice(0, 5)` — the count is already 5 so the slice is removed for clarity.

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd apps/hub && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
cd /Users/eduardosouza/Projects/sm-crm
git add apps/hub/src/router.tsx apps/hub/src/shell/HubNav.tsx
git rm apps/hub/src/pages/CalendarioPage.tsx
git commit -m "feat(hub): remove Calendário page, route, and nav item"
```
