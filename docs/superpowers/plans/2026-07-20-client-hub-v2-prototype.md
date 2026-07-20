# Client Hub V2 Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated, clickable, responsive Client Hub V2 prototype covering every current Hub route without changing production Hub routing, APIs, or data.

**Architecture:** Add `prototype.html` as a second local Vite entry and place the prototype under `apps/hub/src/prototype/`. A hash router, local typed fixtures, and a small context reducer provide navigation and simulated interactions; semantic CSS variables and scoped `hv2-*` styles provide the warm-neutral, sans-first visual system and agency theme resolution.

**Tech Stack:** React 19, TypeScript, React Router v7, Tailwind CSS 3 utilities, scoped CSS variables, Lucide React, Vitest, Testing Library, Playwright, `@axe-core/playwright`.

## Global Constraints

- Keep `apps/hub/src/router.tsx`, `apps/hub/src/api.ts`, and all Supabase behavior unchanged.
- The prototype must make no network requests and perform no external writes.
- The prototype must use local fixtures and hash routes rooted at `apps/hub/prototype.html`.
- Use a warm-neutral, sans-first Editorial Service direction with an action-first homepage.
- The agency/workspace identity controls the shell; client brand assets remain content on the Marca page.
- Support agency name, full logo, compact mark, accent color, attribution, appearance, and an optional top banner with alt text, focal positions, and sanitized link.
- Do not use decorative gradients, noise textures, emoji greetings, decorative serif type, excessive pill shapes, or ornamental animation.
- All current Hub routes require corresponding prototype screens in light mode.
- Home and individual post review require a dark-mode reference.
- Mobile touch targets must be at least 44 by 44 CSS pixels and editable controls must render at 16px or larger.
- Respect reduced motion, keyboard navigation, focus trapping/restoration, and WCAG AA contrast.
- Use Lucide React for icons and the existing `sanitizeExternalUrl()` helper for external banner and resource links.
- Do not add a new production dependency; `@axe-core/playwright` is a development-only verification dependency.
- After every code task, run its focused tests. After all tasks, run `npm run build:hub` and `npm run test`.

---

## File Structure

### Prototype entry and foundation

- `apps/hub/prototype.html` — isolated Vite HTML entry.
- `apps/hub/src/prototype/main.tsx` — React bootstrap and router provider.
- `apps/hub/src/prototype/router.tsx` — hash-route definitions only.
- `apps/hub/src/prototype/prototype.css` — scoped tokens, layout, components, responsive, dark, and reduced-motion styles.
- `apps/hub/src/prototype/theme.ts` — agency configuration validation and semantic token resolution.
- `apps/hub/src/prototype/types.ts` — prototype-only data, theme, and scenario types.
- `apps/hub/src/prototype/fixtures.ts` — deterministic local data for every route.
- `apps/hub/src/prototype/PrototypeContext.tsx` — local interaction state and reducer.

### Shared interface

- `apps/hub/src/prototype/components/PrototypeShell.tsx` — shell, desktop navigation, mobile navigation, Resources menu, and appearance/scenario controls.
- `apps/hub/src/prototype/components/PageHeader.tsx` — consistent page heading.
- `apps/hub/src/prototype/components/AttentionStrip.tsx` — required-action row.
- `apps/hub/src/prototype/components/MetricGroup.tsx` — accessible summary metrics.
- `apps/hub/src/prototype/components/StatusBadge.tsx` — semantic status label.
- `apps/hub/src/prototype/components/MediaPreview.tsx` — local post media rendering.
- `apps/hub/src/prototype/components/Modal.tsx` — accessible dialog with focus trap and restoration.
- `apps/hub/src/prototype/components/StatePanel.tsx` — loading, empty, success, unavailable, and error states.

### Pages

- `apps/hub/src/prototype/pages/HomePrototype.tsx`
- `apps/hub/src/prototype/pages/ApprovalsPrototype.tsx`
- `apps/hub/src/prototype/pages/PostReviewPrototype.tsx`
- `apps/hub/src/prototype/pages/ContentPrototype.tsx`
- `apps/hub/src/prototype/pages/BrandPrototype.tsx`
- `apps/hub/src/prototype/pages/PagesPrototype.tsx`
- `apps/hub/src/prototype/pages/PageReaderPrototype.tsx`
- `apps/hub/src/prototype/pages/BriefingPrototype.tsx`
- `apps/hub/src/prototype/pages/IdeasPrototype.tsx`
- `apps/hub/src/prototype/pages/ReportsPrototype.tsx`
- `apps/hub/src/prototype/pages/ReportViewPrototype.tsx`
- `apps/hub/src/prototype/pages/StatesPrototype.tsx`

### Local visual assets

- `apps/hub/public/prototype/agency-mark.svg`
- `apps/hub/public/prototype/banner.svg`
- `apps/hub/public/prototype/post-01.svg`
- `apps/hub/public/prototype/post-02.svg`
- `apps/hub/public/prototype/post-03.svg`

### Tests

- `apps/hub/src/prototype/__tests__/theme.test.ts`
- `apps/hub/src/prototype/__tests__/router.test.tsx`
- `apps/hub/src/prototype/__tests__/shell.test.tsx`
- `apps/hub/src/prototype/__tests__/home.test.tsx`
- `apps/hub/src/prototype/__tests__/approval-flow.test.tsx`
- `apps/hub/src/prototype/__tests__/content-resources.test.tsx`
- `apps/hub/src/prototype/__tests__/ideas-reports-states.test.tsx`
- `e2e/hub/prototype.spec.ts`
- `e2e/hub/prototype.visual.spec.ts`

---

### Task 1: Theme resolver and isolated prototype entry

**Files:**
- Create: `apps/hub/prototype.html`
- Create: `apps/hub/src/prototype/main.tsx`
- Create: `apps/hub/src/prototype/router.tsx`
- Create: `apps/hub/src/prototype/prototype.css`
- Create: `apps/hub/src/prototype/theme.ts`
- Create: `apps/hub/src/prototype/__tests__/theme.test.ts`

**Interfaces:**
- Produces: `AgencyThemeConfig`, `ResolvedAgencyTheme`, `resolveAgencyTheme(config)`, `prototypeRouter`.
- Consumes: `sanitizeExternalUrl()` from `apps/hub/src/lib/security.ts` for optional links in later tasks.

- [ ] **Step 1: Write the failing theme resolver test**

```ts
import { describe, expect, it } from 'vitest';
import { resolveAgencyTheme } from '../theme';

describe('resolveAgencyTheme', () => {
  it('maps a safe agency accent onto semantic variables', () => {
    const result = resolveAgencyTheme({ name: 'DK Marketing', accentColor: '#315c4c' });
    expect(result.name).toBe('DK Marketing');
    expect(result.style['--hv2-action']).toBe('#315c4c');
    expect(result.style['--hv2-action-fg']).toBe('#ffffff');
  });

  it.each(['not-a-color', '#fff', '#f8f8f8', 'javascript:red']) (
    'falls back to graphite for unsafe accent %s',
    (accentColor) => {
      const result = resolveAgencyTheme({ name: 'DK Marketing', accentColor });
      expect(result.style['--hv2-action']).toBe('#3f4541');
      expect(result.usedAccentFallback).toBe(true);
    },
  );

  it('normalizes optional banner configuration', () => {
    const result = resolveAgencyTheme({
      name: 'DK Marketing',
      banner: {
        src: '/prototype/banner.svg',
        alt: 'Campanha institucional da agência',
        href: 'https://dkmarketing.com.br',
        focalPointDesktop: '50% 42%',
        focalPointMobile: '64% 50%',
      },
    });
    expect(result.banner?.focalPointDesktop).toBe('50% 42%');
    expect(result.banner?.focalPointMobile).toBe('64% 50%');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run: `npx vitest run apps/hub/src/prototype/__tests__/theme.test.ts`

Expected: FAIL because `../theme` does not exist.

- [ ] **Step 3: Implement the resolver with explicit contrast rules**

```ts
import type { CSSProperties } from 'react';

export interface AgencyBannerConfig {
  src: string;
  alt: string;
  href?: string;
  focalPointDesktop?: string;
  focalPointMobile?: string;
}

export interface AgencyThemeConfig {
  name: string;
  logoUrl?: string;
  compactMarkUrl?: string;
  accentColor?: string;
  attribution?: string;
  appearance?: 'light' | 'dark';
  banner?: AgencyBannerConfig;
}

type ThemeStyle = CSSProperties & Record<`--hv2-${string}`, string>;

export interface ResolvedAgencyTheme extends AgencyThemeConfig {
  style: ThemeStyle;
  usedAccentFallback: boolean;
}

const FALLBACK_ACCENT = '#3f4541';
const LIGHT_CANVAS = '#f7f6f3';

function rgb(hex: string) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex: string) {
  const channels = rgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function safeAccent(value?: string) {
  const normalized = value?.toLowerCase();
  if (!normalized || !/^#[0-9a-f]{6}$/.test(normalized)) return FALLBACK_ACCENT;
  return contrast(normalized, LIGHT_CANVAS) >= 3 ? normalized : FALLBACK_ACCENT;
}

export function resolveAgencyTheme(config: AgencyThemeConfig): ResolvedAgencyTheme {
  const accent = safeAccent(config.accentColor);
  const lightTextContrast = contrast(accent, '#ffffff');
  const darkTextContrast = contrast(accent, '#171916');
  const foreground = lightTextContrast >= darkTextContrast ? '#ffffff' : '#171916';
  return {
    ...config,
    appearance: config.appearance ?? 'light',
    style: {
      '--hv2-action': accent,
      '--hv2-action-fg': foreground,
      '--hv2-focus': accent,
      '--hv2-selection': `${accent}1f`,
    },
    usedAccentFallback: Boolean(
      config.accentColor && accent === FALLBACK_ACCENT && config.accentColor.toLowerCase() !== FALLBACK_ACCENT,
    ),
  };
}
```

- [ ] **Step 4: Add the isolated HTML entry and bootstrap**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Client Hub V2 Prototype</title>
  </head>
  <body>
    <div id="prototype-root"></div>
    <script type="module" src="/src/prototype/main.tsx"></script>
  </body>
</html>
```

```tsx
// apps/hub/src/prototype/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { prototypeRouter } from './router';
import './prototype.css';

ReactDOM.createRoot(document.getElementById('prototype-root')!).render(
  <React.StrictMode>
    <RouterProvider router={prototypeRouter} />
  </React.StrictMode>,
);
```

```tsx
// apps/hub/src/prototype/router.tsx
import { createHashRouter } from 'react-router-dom';

function FoundationScreen() {
  return <main className="hv2-root"><h1>Client Hub V2</h1></main>;
}

export const prototypeRouter = createHashRouter([{ path: '*', element: <FoundationScreen /> }]);
```

```css
/* apps/hub/src/prototype/prototype.css */
* { box-sizing: border-box; }
html, body, #prototype-root { min-height: 100%; margin: 0; }
.hv2-root {
  --hv2-canvas: #f7f6f3;
  --hv2-surface: #ffffff;
  --hv2-surface-subtle: #efeee9;
  --hv2-border: #deddd7;
  --hv2-border-strong: #c6c5be;
  --hv2-text: #262824;
  --hv2-text-secondary: #696b65;
  --hv2-text-muted: #85867f;
  --hv2-action: #3f4541;
  --hv2-action-fg: #ffffff;
  --hv2-success: #456b55;
  --hv2-warning: #8a642c;
  --hv2-danger: #a33f3f;
  --hv2-info: #3f637c;
  min-height: 100vh;
  background: var(--hv2-canvas);
  color: var(--hv2-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.hv2-root[data-appearance='dark'] {
  --hv2-canvas: #171815;
  --hv2-surface: #20211e;
  --hv2-surface-subtle: #292a26;
  --hv2-border: #393a35;
  --hv2-border-strong: #4b4c46;
  --hv2-text: #f1f0eb;
  --hv2-text-secondary: #c0c0b8;
  --hv2-text-muted: #92938b;
}
.hv2-root a { color: inherit; }
.hv2-root button, .hv2-root input, .hv2-root textarea, .hv2-root select { font: inherit; }
.hv2-root :focus-visible { outline: 3px solid var(--hv2-focus); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .hv2-root *, .hv2-root *::before, .hv2-root *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
```

- [ ] **Step 5: Run the test and Hub typecheck**

Run: `npx vitest run apps/hub/src/prototype/__tests__/theme.test.ts`

Expected: PASS, 6 tests (the unsafe-accent table contributes four cases).

Run: `npx tsc -p apps/hub/tsconfig.json`

Expected: exit 0.

- [ ] **Step 6: Commit the foundation**

```bash
git add apps/hub/prototype.html apps/hub/src/prototype
git commit -m "feat(hub): scaffold v2 prototype foundation"
```

---

### Task 2: Typed fixtures, local reducer, and responsive shell

**Files:**
- Create: `apps/hub/src/prototype/types.ts`
- Create: `apps/hub/src/prototype/fixtures.ts`
- Create: `apps/hub/src/prototype/PrototypeContext.tsx`
- Create: `apps/hub/src/prototype/components/PrototypeShell.tsx`
- Create: `apps/hub/src/prototype/__tests__/shell.test.tsx`
- Modify: `apps/hub/src/prototype/router.tsx`
- Modify: `apps/hub/src/prototype/prototype.css`

**Interfaces:**
- Produces: `PrototypeProvider`, `usePrototype()`, `prototypeFixture`, `PrototypeShell`.
- `usePrototype()` returns `{ fixture, appearance, scenario, approvedPostIds, corrections, setAppearance, setScenario, approvePost, requestCorrection, reset }`.

- [ ] **Step 1: Write failing shell behavior tests**

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PrototypeProvider } from '../PrototypeContext';
import { PrototypeShell } from '../components/PrototypeShell';

function renderShell() {
  return render(<MemoryRouter><PrototypeProvider><PrototypeShell /></PrototypeProvider></MemoryRouter>);
}

describe('PrototypeShell', () => {
  it('renders agency identity and client navigation', () => {
    renderShell();
    expect(screen.getAllByText('DK Marketing').length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Aprovações 3' })).toBeInTheDocument();
  });

  it('opens and closes the accessible mobile resources sheet', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const dialog = screen.getByRole('dialog', { name: 'Mais opções' });
    expect(within(dialog).getByRole('link', { name: 'Marca' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Mais opções' })).not.toBeInTheDocument();
  });

  it('switches the appearance without using localStorage', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Usar modo escuro' }));
    expect(screen.getByTestId('prototype-root')).toHaveAttribute('data-appearance', 'dark');
  });
});
```

- [ ] **Step 2: Run the shell test and confirm it fails**

Run: `npx vitest run apps/hub/src/prototype/__tests__/shell.test.tsx`

Expected: FAIL because context, fixtures, and shell files do not exist.

- [ ] **Step 3: Define the prototype data contracts and complete deterministic fixture**

```ts
// apps/hub/src/prototype/types.ts
import type { AgencyThemeConfig } from './theme';

export type PrototypeScenario = 'default' | 'loading' | 'empty' | 'success' | 'unavailable' | 'error';
export type PrototypePostStatus = 'pending' | 'approved' | 'changes' | 'scheduled' | 'published';

export interface PrototypePost {
  id: number;
  title: string;
  platform: 'Instagram' | 'TikTok' | 'Instagram + TikTok';
  type: 'Feed' | 'Reels' | 'Stories' | 'Carrossel';
  status: PrototypePostStatus;
  scheduledAt: string;
  caption: string;
  mediaUrl: string;
}

export interface PrototypeFixture {
  agency: AgencyThemeConfig;
  clientName: string;
  metrics: Array<{ label: string; value: string; trend: string }>;
  posts: PrototypePost[];
  pages: Array<{ id: string; title: string; description: string; updatedAt: string }>;
  briefing: Array<{ id: string; section: string; question: string; answer: string }>;
  ideas: Array<{ id: string; title: string; description: string; status: string }>;
  reports: Array<{ month: string; label: string; summary: string }>;
}
```

```ts
// apps/hub/src/prototype/fixtures.ts
import type { PrototypeFixture } from './types';

export const prototypeFixture: PrototypeFixture = {
  agency: {
    name: 'DK Marketing',
    compactMarkUrl: '/prototype/agency-mark.svg',
    accentColor: '#315c4c',
    attribution: 'Estratégia e operação por DK Marketing',
    appearance: 'light',
    banner: {
      src: '/prototype/banner.svg',
      alt: 'Composição institucional da DK Marketing',
      href: 'https://dkmarketing.com.br',
      focalPointDesktop: '50% 48%',
      focalPointMobile: '62% 50%',
    },
  },
  clientName: 'Rafael Nunes',
  metrics: [
    { label: 'Alcance', value: '48,2 mil', trend: '+12,4%' },
    { label: 'Seguidores', value: '12.480', trend: '+184' },
    { label: 'Interações', value: '3.942', trend: '+8,7%' },
  ],
  posts: [
    { id: 101, title: 'O cuidado começa na escuta', platform: 'Instagram', type: 'Carrossel', status: 'pending', scheduledAt: '2026-07-22T12:00:00-03:00', caption: 'Uma boa consulta começa antes do diagnóstico: começa na escuta.', mediaUrl: '/prototype/post-01.svg' },
    { id: 102, title: 'Três sinais para observar', platform: 'Instagram + TikTok', type: 'Reels', status: 'pending', scheduledAt: '2026-07-24T18:00:00-03:00', caption: 'Informação clara ajuda você a reconhecer quando é hora de buscar orientação.', mediaUrl: '/prototype/post-02.svg' },
    { id: 103, title: 'Perguntas frequentes da semana', platform: 'Instagram', type: 'Stories', status: 'pending', scheduledAt: '2026-07-25T09:00:00-03:00', caption: 'Respondemos as dúvidas mais recebidas nesta semana.', mediaUrl: '/prototype/post-03.svg' },
    { id: 104, title: 'Agenda de agosto', platform: 'Instagram', type: 'Feed', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00-03:00', caption: 'A agenda de agosto está aberta.', mediaUrl: '/prototype/post-01.svg' },
  ],
  pages: [
    { id: 'estrategia', title: 'Estratégia de conteúdo', description: 'Posicionamento, editorias e princípios de comunicação.', updatedAt: '18 jul 2026' },
    { id: 'tom-de-voz', title: 'Tom de voz', description: 'Vocabulário, exemplos e orientações para a marca.', updatedAt: '12 jul 2026' },
  ],
  briefing: [
    { id: 'b1', section: 'Negócio', question: 'Qual é o principal objetivo deste projeto?', answer: 'Fortalecer autoridade e gerar consultas qualificadas.' },
    { id: 'b2', section: 'Público', question: 'Quem queremos alcançar?', answer: 'Adultos de 28 a 55 anos que buscam informação confiável.' },
  ],
  ideas: [
    { id: 'i1', title: 'Série: mitos e verdades', description: 'Transformar dúvidas recorrentes em uma série mensal.', status: 'Em análise' },
    { id: 'i2', title: 'Bastidores da consulta', description: 'Mostrar a preparação do espaço e da equipe.', status: 'Nova' },
  ],
  reports: [
    { month: '2026-07', label: 'Julho de 2026', summary: 'Crescimento consistente de alcance e salvamentos.' },
    { month: '2026-06', label: 'Junho de 2026', summary: 'Aumento de frequência e melhor retenção em vídeos.' },
  ],
};
```

- [ ] **Step 4: Implement the local reducer and public context interface**

```tsx
import { createContext, useContext, useMemo, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { prototypeFixture } from './fixtures';
import type { PrototypeScenario } from './types';

interface State { appearance: 'light' | 'dark'; scenario: PrototypeScenario; approvedPostIds: number[]; corrections: Record<number, string>; }
type Action = { type: 'appearance'; value: 'light' | 'dark' } | { type: 'scenario'; value: PrototypeScenario } | { type: 'approve'; postId: number } | { type: 'correction'; postId: number; message: string } | { type: 'reset' };
const initialState: State = { appearance: 'light', scenario: 'default', approvedPostIds: [], corrections: {} };

function reducer(state: State, action: Action): State {
  if (action.type === 'appearance') return { ...state, appearance: action.value };
  if (action.type === 'scenario') return { ...state, scenario: action.value };
  if (action.type === 'approve') return { ...state, approvedPostIds: [...new Set([...state.approvedPostIds, action.postId])] };
  if (action.type === 'correction') return { ...state, corrections: { ...state.corrections, [action.postId]: action.message } };
  return initialState;
}

const PrototypeContext = createContext<ReturnType<typeof makeValue> | null>(null);
function makeValue(state: State, dispatch: Dispatch<Action>) {
  return { fixture: prototypeFixture, ...state, setAppearance: (value: State['appearance']) => dispatch({ type: 'appearance', value }), setScenario: (value: PrototypeScenario) => dispatch({ type: 'scenario', value }), approvePost: (postId: number) => dispatch({ type: 'approve', postId }), requestCorrection: (postId: number, message: string) => dispatch({ type: 'correction', postId, message }), reset: () => dispatch({ type: 'reset' }) };
}
export function PrototypeProvider({ children }: { children: ReactNode }) { const [state, dispatch] = useReducer(reducer, initialState); const value = useMemo(() => makeValue(state, dispatch), [state]); return <PrototypeContext.Provider value={value}>{children}</PrototypeContext.Provider>; }
export function usePrototype() { const value = useContext(PrototypeContext); if (!value) throw new Error('usePrototype must be used inside PrototypeProvider'); return value; }
```

- [ ] **Step 5: Implement `PrototypeShell` and replace the foundation route**

The shell must render desktop links for Início, Aprovações, Conteúdo, Relatórios, and a Recursos menu; mobile links for Início, Aprovações, Conteúdo, and Mais; an Escape-closeable `role="dialog"` for Mais; an appearance button; `<Outlet />`; and an attribution footer. Apply `resolveAgencyTheme(fixture.agency).style` and `data-appearance={appearance}` to the element with `data-testid="prototype-root"`.

```tsx
function FoundationHome() {
  return <main><h1>Visão geral</h1></main>;
}

export const prototypeRoutes = [{ index: true, element: <FoundationHome /> }];

export const prototypeRouter = createHashRouter([{
  element: <PrototypeProvider><PrototypeShell /></PrototypeProvider>,
  children: prototypeRoutes,
}]);
```

Add scoped shell CSS with a 64px sticky desktop header, `max-width: 1180px` content container, hidden desktop nav below 768px, fixed mobile bottom navigation below 768px, 44px controls, safe-area padding, plain surfaces, 8px maximum control radii, and no shadow stronger than `0 8px 24px rgb(20 22 19 / 8%)`.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx vitest run apps/hub/src/prototype/__tests__/shell.test.tsx apps/hub/src/prototype/__tests__/theme.test.ts`

Expected: PASS.

Run: `npx tsc -p apps/hub/tsconfig.json`

Expected: exit 0.

- [ ] **Step 7: Commit the shell slice**

```bash
git add apps/hub/src/prototype
git commit -m "feat(hub): add prototype shell and fixtures"
```

---

### Task 3: Shared primitives, local assets, and action-first Home

**Files:**
- Create: shared component files listed under “Shared interface” above except `Modal.tsx`
- Create: `apps/hub/src/prototype/pages/HomePrototype.tsx`
- Create: five SVG files under `apps/hub/public/prototype/`
- Create: `apps/hub/src/prototype/__tests__/home.test.tsx`
- Modify: `apps/hub/src/prototype/router.tsx`
- Modify: `apps/hub/src/prototype/prototype.css`

**Interfaces:**
- Produces: `PageHeader`, `AttentionStrip`, `MetricGroup`, `StatusBadge`, `MediaPreview`, `StatePanel`, `HomePrototype`.
- Consumes: `usePrototype()`, `sanitizeExternalUrl()`, `PrototypePost`.

- [ ] **Step 1: Write failing Home tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PrototypeProvider } from '../PrototypeContext';
import { HomePrototype } from '../pages/HomePrototype';

function renderHome() { return render(<MemoryRouter><PrototypeProvider><HomePrototype /></PrototypeProvider></MemoryRouter>); }

describe('HomePrototype', () => {
  it('puts required actions before performance', () => {
    renderHome();
    const attention = screen.getByText('3 conteúdos aguardam sua revisão');
    const metrics = screen.getByRole('heading', { name: 'Resumo do período' });
    expect(attention.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the configured banner as an accessible, sanitized link', () => {
    renderHome();
    const banner = screen.getByRole('img', { name: 'Composição institucional da DK Marketing' });
    expect(banner).toHaveAttribute('src', '/prototype/banner.svg');
    expect(banner.closest('a')).toHaveAttribute('href', 'https://dkmarketing.com.br');
  });

  it('can switch to an empty state using the prototype controls', () => {
    renderHome();
    fireEvent.change(screen.getByLabelText('Cenário da página'), { target: { value: 'empty' } });
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma pendência por aqui');
  });
});
```

- [ ] **Step 2: Run the Home test and confirm it fails**

Run: `npx vitest run apps/hub/src/prototype/__tests__/home.test.tsx`

Expected: FAIL because `HomePrototype` and shared components do not exist.

- [ ] **Step 3: Create deterministic SVG assets**

Use plain fills, lines, and typography; do not use gradients. `agency-mark.svg` is a circular DK monogram. `banner.svg` is a 1600×420 warm-neutral editorial composition with the words “Clareza para crescer”. The three 1080×1080 post assets use distinct solid palettes and contain the fixture titles. Each SVG must include `role="img"` and a `<title>`.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="420" viewBox="0 0 1600 420" role="img" aria-labelledby="title">
  <title id="title">Clareza para crescer</title>
  <rect width="1600" height="420" fill="#ded9cf"/>
  <circle cx="1320" cy="210" r="150" fill="#315c4c"/>
  <rect x="110" y="94" width="1" height="232" fill="#77786f"/>
  <text x="160" y="185" fill="#272824" font-family="system-ui, sans-serif" font-size="60" font-weight="600">Clareza para crescer.</text>
  <text x="164" y="235" fill="#676860" font-family="system-ui, sans-serif" font-size="24">Estratégia, conteúdo e acompanhamento em um só lugar.</text>
</svg>
```

- [ ] **Step 4: Implement shared primitives with semantic HTML**

`PageHeader` renders an optional eyebrow, one `h1`, description, and action slot. `AttentionStrip` renders a linked or button action with an icon and count. `MetricGroup` renders a `<dl>` with trend text. `StatusBadge` maps `pending`, `approved`, `changes`, `scheduled`, and `published` to Portuguese labels. `MediaPreview` renders a fixed-ratio `<img>` with descriptive alt text. `StatePanel` renders `role="status"` for loading/empty/success and `role="alert"` for unavailable/error, plus retry when provided.

```tsx
export function MetricGroup({ metrics }: { metrics: Array<{ label: string; value: string; trend: string }> }) {
  return <dl className="hv2-metrics">{metrics.map((metric) => <div className="hv2-metric" key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd><span className="hv2-trend">{metric.trend}</span></div>)}</dl>;
}
```

- [ ] **Step 5: Implement Home in the approved order**

Render: optional linked banner; `PageHeader` with “Bom dia, Rafael.” and no emoji; `AttentionStrip`; three quick actions; `h2` “Resumo do período” with `MetricGroup`; a seven-day upcoming-content strip; and restrained resource/report links. Use a scenario `<select aria-label="Cenário da página">` in the prototype review toolbar. For `loading`, `empty`, `success`, `unavailable`, and `error`, render the matching `StatePanel` before or instead of the default content as appropriate. Collapse the banner after its `onError` event.

- [ ] **Step 6: Register Home and complete its responsive styles**

Replace the `FoundationHome` index element in `prototypeRoutes` with `<HomePrototype />`. Add `hv2-banner`, `hv2-page-header`, `hv2-attention`, `hv2-quick-actions`, `hv2-metrics`, `hv2-upcoming`, and `hv2-state` styles. Home uses no more than three columns, drops to two columns below 900px and one below 640px, and keeps all action targets at least 44px high.

- [ ] **Step 7: Run tests and commit**

Run: `npx vitest run apps/hub/src/prototype/__tests__/home.test.tsx`

Expected: PASS, 3 tests.

Run: `npx tsc -p apps/hub/tsconfig.json`

Expected: exit 0.

```bash
git add apps/hub/public/prototype apps/hub/src/prototype
git commit -m "feat(hub): build action-first prototype home"
```

---

### Task 4: Approvals queue, accessible modal, and individual post review

**Files:**
- Create: `apps/hub/src/prototype/components/Modal.tsx`
- Create: `apps/hub/src/prototype/pages/ApprovalsPrototype.tsx`
- Create: `apps/hub/src/prototype/pages/PostReviewPrototype.tsx`
- Create: `apps/hub/src/prototype/__tests__/approval-flow.test.tsx`
- Modify: `apps/hub/src/prototype/router.tsx`
- Modify: `apps/hub/src/prototype/prototype.css`

**Interfaces:**
- Produces: routes `/aprovacoes` and `/postagens/:postId`.
- Consumes: `approvePost(postId)`, `requestCorrection(postId, message)`, `MediaPreview`, `StatusBadge`, `Modal`.

- [ ] **Step 1: Write failing review-flow tests**

```tsx
it('filters the queue and opens a post review', async () => {
  renderPrototype('/aprovacoes');
  expect(screen.getAllByRole('article')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Filtrar por formato'), { target: { value: 'Reels' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  fireEvent.click(screen.getByRole('link', { name: 'Revisar Três sinais para observar' }));
  expect(await screen.findByRole('heading', { name: 'Três sinais para observar' })).toBeInTheDocument();
});

it('approves a post and exposes a confirmation state', () => {
  renderPrototype('/postagens/101');
  fireEvent.click(screen.getByRole('button', { name: 'Aprovar conteúdo' }));
  expect(screen.getByRole('status')).toHaveTextContent('Conteúdo aprovado');
});

it('requires a correction message and restores focus after the dialog closes', () => {
  renderPrototype('/postagens/101');
  const trigger = screen.getByRole('button', { name: 'Solicitar ajustes' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Solicitar ajustes' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar solicitação' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Descreva o ajuste necessário');
  fireEvent.change(within(dialog).getByLabelText('Ajustes solicitados'), { target: { value: 'Reduzir o texto da segunda tela.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar solicitação' }));
  expect(trigger).toHaveFocus();
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run apps/hub/src/prototype/__tests__/approval-flow.test.tsx`

Expected: FAIL because approval pages and the shared render helper do not exist.

- [ ] **Step 3: Add a test render helper and implement the modal**

Create `apps/hub/src/prototype/__tests__/renderPrototype.tsx` with a `createMemoryRouter` using the same route objects as the hash router. Implement `Modal` with `role="dialog"`, `aria-modal`, a title ID, Escape handling, body-scroll lock, Tab wrap, initial focus, backdrop close, and trigger-focus restoration. Keep the modal mounted only while open.

- [ ] **Step 4: Implement the approvals queue**

Render a `PageHeader`, pending count, format and platform filters, and media-led articles. Each article contains `MediaPreview`, platform, type, planned date, `StatusBadge`, and a link named `Revisar {title}`. The default fixture yields three pending articles; filters operate entirely in memory. Empty filter results use `StatePanel`.

- [ ] **Step 5: Implement individual post review**

Look up `Number(postId)` in fixtures and render a not-found `StatePanel` when absent. Desktop uses `hv2-review-grid` with media left and a sticky `aside` right. The aside contains date/platform/type, full caption, discussion summary, “Aprovar conteúdo,” and “Solicitar ajustes.” Approved and correction states come from context. Mobile changes to one column and places final actions in a safe-area-aware sticky footer.

- [ ] **Step 6: Register routes and run tests**

```tsx
{ path: 'aprovacoes', element: <ApprovalsPrototype /> },
{ path: 'postagens/:postId', element: <PostReviewPrototype /> },
```

Run: `npx vitest run apps/hub/src/prototype/__tests__/approval-flow.test.tsx`

Expected: PASS.

Run: `npx tsc -p apps/hub/tsconfig.json`

Expected: exit 0.

- [ ] **Step 7: Commit the approval journey**

```bash
git add apps/hub/src/prototype
git commit -m "feat(hub): prototype client approval journey"
```

---

### Task 5: Content calendar/list and individual content view

**Files:**
- Create: `apps/hub/src/prototype/pages/ContentPrototype.tsx`
- Create: `apps/hub/src/prototype/__tests__/content-resources.test.tsx`
- Modify: `apps/hub/src/prototype/router.tsx`
- Modify: `apps/hub/src/prototype/prototype.css`

**Interfaces:**
- Produces: `/postagens` with calendar/list switch and reuses `/postagens/:postId` for individual content.
- Consumes: `prototypeFixture.posts`, `MediaPreview`, `StatusBadge`.

- [ ] **Step 1: Write failing content-view tests**

```tsx
describe('ContentPrototype', () => {
  it('switches between calendar and list without losing the selected month', () => {
    renderPrototype('/postagens');
    expect(screen.getByRole('grid', { name: 'Calendário de julho de 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Visualização em lista' }));
    expect(screen.getByRole('list', { name: 'Conteúdos de julho de 2026' })).toBeInTheDocument();
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument();
  });

  it('shows essential calendar signals and opens the content route', () => {
    renderPrototype('/postagens');
    const cell = screen.getByRole('gridcell', { name: /22 de julho.*O cuidado começa na escuta/ });
    expect(within(cell).getByText('Instagram')).toBeInTheDocument();
    expect(within(cell).getByRole('link')).toHaveAttribute('href', '/postagens/101');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run apps/hub/src/prototype/__tests__/content-resources.test.tsx`

Expected: FAIL because `ContentPrototype` does not exist.

- [ ] **Step 3: Implement accessible calendar and list views**

Use a local `view: 'calendar' | 'list'` state. Calendar uses `role="grid"`, Portuguese weekday headings, semantic buttons/links, and compact platform/status text. List uses `role="list"`, grouped date headings, thumbnails, title, platform, type, status, and review link. No cell relies on color alone. Add month previous/next controls that update the visible label and preserve the selected view.

- [ ] **Step 4: Register the content route and complete responsive styles**

Register `{ path: 'postagens', element: <ContentPrototype /> }`. At widths below 760px, default to list presentation while leaving the calendar toggle available; calendar becomes horizontally scrollable with a labelled container rather than compressing cells below 88px.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run apps/hub/src/prototype/__tests__/content-resources.test.tsx`

Expected: PASS for the content tests.

```bash
git add apps/hub/src/prototype
git commit -m "feat(hub): prototype content planning views"
```

---

### Task 6: Brand, document library/reader, and Briefing resources

**Files:**
- Create: `apps/hub/src/prototype/pages/BrandPrototype.tsx`
- Create: `apps/hub/src/prototype/pages/PagesPrototype.tsx`
- Create: `apps/hub/src/prototype/pages/PageReaderPrototype.tsx`
- Create: `apps/hub/src/prototype/pages/BriefingPrototype.tsx`
- Modify: `apps/hub/src/prototype/__tests__/content-resources.test.tsx`
- Modify: `apps/hub/src/prototype/router.tsx`
- Modify: `apps/hub/src/prototype/prototype.css`

**Interfaces:**
- Produces: `/marca`, `/paginas`, `/paginas/:pageId`, `/briefing`.
- Consumes: fixture pages/briefing, `sanitizeExternalUrl()`, `PageHeader`, `StatePanel`.

- [ ] **Step 1: Extend the failing resource tests**

```tsx
it('keeps client brand colors inside the Marca content surface', () => {
  renderPrototype('/marca');
  expect(screen.getByRole('heading', { name: 'Marca' })).toBeInTheDocument();
  expect(screen.getByLabelText('Cor primária #284a63')).toHaveStyle({ backgroundColor: '#284a63' });
  expect(screen.getByTestId('prototype-root')).toHaveStyle({ '--hv2-action': '#315c4c' });
});

it('opens a document in a focused reader', async () => {
  renderPrototype('/paginas');
  fireEvent.click(screen.getByRole('link', { name: 'Ler Estratégia de conteúdo' }));
  expect(await screen.findByRole('heading', { name: 'Estratégia de conteúdo' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Nesta página' })).toBeInTheDocument();
});

it('validates and saves a briefing answer locally', () => {
  renderPrototype('/briefing');
  const answer = screen.getByLabelText('Qual é o principal objetivo deste projeto?');
  fireEvent.change(answer, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar briefing' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Preencha as respostas obrigatórias');
  fireEvent.change(answer, { target: { value: 'Gerar consultas qualificadas.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar briefing' }));
  expect(screen.getByRole('status')).toHaveTextContent('Briefing salvo neste protótipo');
});
```

- [ ] **Step 2: Run tests and confirm the new assertions fail**

Run: `npx vitest run apps/hub/src/prototype/__tests__/content-resources.test.tsx`

Expected: FAIL because resource pages do not exist.

- [ ] **Step 3: Implement Marca and document library**

Marca uses specimen sections for a local client logo, two color swatches, typography names, and file rows with sanitized sample URLs. Páginas uses a semantic list with title, description, update date, and `Ler {title}` links. Neither page uses the client swatches as shell tokens.

- [ ] **Step 4: Implement the reader and Briefing**

The reader looks up `pageId`, renders `StatePanel` for missing IDs, uses a `max-width: 72ch` article, and provides an `aria-label="Nesta página"` navigation for the two fixture headings. Briefing groups questions by section, uses controlled 16px textareas, requires non-empty answers, preserves values after validation, and reports local save success through `role="status"`.

- [ ] **Step 5: Register routes, run tests, and commit**

```tsx
{ path: 'marca', element: <BrandPrototype /> },
{ path: 'paginas', element: <PagesPrototype /> },
{ path: 'paginas/:pageId', element: <PageReaderPrototype /> },
{ path: 'briefing', element: <BriefingPrototype /> },
```

Run: `npx vitest run apps/hub/src/prototype/__tests__/content-resources.test.tsx`

Expected: PASS.

```bash
git add apps/hub/src/prototype
git commit -m "feat(hub): prototype client resource pages"
```

---

### Task 7: Ideas, report history, and monthly report

**Files:**
- Create: `apps/hub/src/prototype/pages/IdeasPrototype.tsx`
- Create: `apps/hub/src/prototype/pages/ReportsPrototype.tsx`
- Create: `apps/hub/src/prototype/pages/ReportViewPrototype.tsx`
- Create: `apps/hub/src/prototype/__tests__/ideas-reports-states.test.tsx`
- Modify: `apps/hub/src/prototype/router.tsx`
- Modify: `apps/hub/src/prototype/prototype.css`

**Interfaces:**
- Produces: `/ideias`, `/relatorios`, `/relatorios/:month`.
- Consumes: fixture ideas/reports/metrics/posts, `Modal`, `MetricGroup`, `MediaPreview`, `StatePanel`.

- [ ] **Step 1: Write failing Ideas and Reports tests**

```tsx
it('submits a new idea locally and places it first in the feed', () => {
  renderPrototype('/ideias');
  fireEvent.click(screen.getByRole('button', { name: 'Compartilhar ideia' }));
  const dialog = screen.getByRole('dialog', { name: 'Nova ideia' });
  fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Entrevista com a equipe' } });
  fireEvent.change(within(dialog).getByLabelText('Descrição'), { target: { value: 'Apresentar as especialidades de cada profissional.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar ideia' }));
  expect(screen.getAllByRole('article')[0]).toHaveTextContent('Entrevista com a equipe');
});

it('opens a monthly report with summary before detailed charts', async () => {
  renderPrototype('/relatorios');
  fireEvent.click(screen.getByRole('link', { name: 'Abrir Julho de 2026' }));
  const summary = await screen.findByRole('heading', { name: 'Resumo executivo' });
  const charts = screen.getByRole('heading', { name: 'Evolução dos indicadores' });
  expect(summary.compareDocumentPosition(charts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('labels chart values without relying on color', () => {
  renderPrototype('/relatorios/2026-07');
  expect(screen.getByRole('img', { name: 'Alcance semanal: 8, 11, 13 e 16 mil contas' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run apps/hub/src/prototype/__tests__/ideas-reports-states.test.tsx`

Expected: FAIL because Ideas and Reports pages do not exist.

- [ ] **Step 3: Implement Ideas with local feed state**

Render a restrained submission action above a semantic feed. Image-free idea entries use ruled rows; future media entries may use cards. The modal requires title and description, prepends the submitted idea, closes, restores trigger focus, and announces success. Existing fixture entries show status, reactions, and an agency-response sample without destructive network actions.

- [ ] **Step 4: Implement report history and monthly report**

History uses period rows with summary and `Abrir {label}` links. The report view looks up `month`, renders not-found state when absent, and orders content as: executive summary, metric group, plain-language interpretation, labelled SVG/bar chart, top-post media row, and next-period notes. Every chart has `role="img"` and an exact textual `aria-label`.

- [ ] **Step 5: Register routes, test, and commit**

```tsx
{ path: 'ideias', element: <IdeasPrototype /> },
{ path: 'relatorios', element: <ReportsPrototype /> },
{ path: 'relatorios/:month', element: <ReportViewPrototype /> },
```

Run: `npx vitest run apps/hub/src/prototype/__tests__/ideas-reports-states.test.tsx`

Expected: PASS.

```bash
git add apps/hub/src/prototype
git commit -m "feat(hub): prototype ideas and reporting"
```

---

### Task 8: State gallery, router coverage, dark reference, and production isolation

**Files:**
- Create: `apps/hub/src/prototype/pages/StatesPrototype.tsx`
- Create: `apps/hub/src/prototype/__tests__/router.test.tsx`
- Modify: `apps/hub/src/prototype/router.tsx`
- Modify: `apps/hub/src/prototype/__tests__/ideas-reports-states.test.tsx`
- Modify: `apps/hub/src/prototype/prototype.css`

**Interfaces:**
- Produces: `/states` review route and complete route table.
- Consumes: every page component and `StatePanel`.

- [ ] **Step 1: Write failing route and edge-state tests**

```tsx
const routes = ['/', '/aprovacoes', '/postagens', '/postagens/101', '/marca', '/paginas', '/paginas/estrategia', '/briefing', '/ideias', '/relatorios', '/relatorios/2026-07', '/states'];
it.each(routes)('renders prototype route %s without the production Hub shell', async (route) => {
  renderPrototype(route);
  expect(await screen.findByTestId('prototype-root')).toBeInTheDocument();
  expect(screen.queryByText('Link inválido.')).not.toBeInTheDocument();
});

it('shows every specified edge state in the state gallery', () => {
  renderPrototype('/states');
  for (const text of ['Carregando conteúdo', 'Nenhum conteúdo disponível', 'Alterações salvas', 'Acesso indisponível', 'Não foi possível carregar']) expect(screen.getByText(text)).toBeInTheDocument();
});

it('keeps Home and post review readable in dark appearance', () => {
  renderPrototype('/postagens/101');
  fireEvent.click(screen.getByRole('button', { name: 'Usar modo escuro' }));
  expect(screen.getByTestId('prototype-root')).toHaveAttribute('data-appearance', 'dark');
  expect(screen.getByRole('button', { name: 'Aprovar conteúdo' })).toBeVisible();
});
```

- [ ] **Step 2: Run tests and confirm the missing gallery failure**

Run: `npx vitest run apps/hub/src/prototype/__tests__/router.test.tsx apps/hub/src/prototype/__tests__/ideas-reports-states.test.tsx`

Expected: FAIL for `/states` and state copy.

- [ ] **Step 3: Implement the state gallery and route manifest**

Complete the existing `prototypeRoutes` export in `router.tsx` so the production hash router and test memory router consume the same child route objects. `StatesPrototype` renders five labelled sections with `StatePanel`: loading, empty, success, unavailable, and recoverable error with a retry button that changes its announcement to “Nova tentativa iniciada”. Add a catch-all prototype not-found state with a link to `#/`.

- [ ] **Step 4: Complete dark and responsive CSS**

Audit every `hv2-*` selector to use semantic variables. Add dark-only image treatment only when required for media contrast; do not invert content media. Verify banner focus points through CSS custom properties and `object-position`. Add tablet behavior at 1024px, mobile behavior at 768px, narrow behavior at 480px, safe-area padding, 16px editable controls, and 44px targets. Ensure fixed mobile controls do not cover route content.

- [ ] **Step 5: Prove the production entry remains isolated**

Run: `git diff -- apps/hub/src/router.tsx apps/hub/src/api.ts apps/hub/index.html apps/crm/style.css`

Expected: no output.

Run: `npx vitest run apps/hub/src/prototype/__tests__`

Expected: all prototype unit tests PASS.

- [ ] **Step 6: Commit complete screen/state coverage**

```bash
git add apps/hub/src/prototype
git commit -m "feat(hub): complete prototype routes and states"
```

---

### Task 9: Automated accessibility, interaction E2E, and visual snapshots

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `e2e/hub/prototype.spec.ts`
- Create: `e2e/hub/prototype.visual.spec.ts`
- Create: Playwright snapshot PNGs under the generated `e2e/hub/prototype.visual.spec.ts-snapshots/` directory.

**Interfaces:**
- Consumes: local URL `/prototype.html#/...` served by the existing Hub Vite server.
- Produces: axe checks, keyboard-flow checks, responsive screenshots.

- [ ] **Step 1: Install the development-only accessibility helper**

Run: `npm install --save-dev @axe-core/playwright`

Expected: `package.json` and `package-lock.json` add `@axe-core/playwright` under development dependencies only.

- [ ] **Step 2: Write failing E2E accessibility and interaction tests**

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const route of ['/', '/aprovacoes', '/postagens/101']) {
  test(`prototype ${route} has no detectable accessibility violations`, async ({ page }) => {
    await page.goto(`/prototype.html#${route}`);
    await expect(page.getByTestId('prototype-root')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test('keyboard user can open and close the mobile More sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/prototype.html#/');
  await page.getByRole('button', { name: 'Mais' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Mais opções' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Mais' })).toBeFocused();
});

test('approval flow is local and survives route navigation', async ({ page }) => {
  await page.goto('/prototype.html#/postagens/101');
  await page.getByRole('button', { name: 'Aprovar conteúdo' }).click();
  await expect(page.getByRole('status')).toContainText('Conteúdo aprovado');
  await page.getByRole('link', { name: 'Aprovações' }).click();
  await page.goBack();
  await expect(page.getByRole('status')).toContainText('Conteúdo aprovado');
});
```

- [ ] **Step 3: Run E2E and fix only concrete violations**

Run: `npx playwright test e2e/hub/prototype.spec.ts --project=hub`

Expected: PASS. If axe reports a violation, fix the named semantic, contrast, label, or focus issue in the responsible prototype file and rerun until zero violations.

- [ ] **Step 4: Add deterministic visual coverage**

```ts
import { expect, test } from '@playwright/test';

const lightRoutes = [
  ['home', '/'], ['approvals', '/aprovacoes'], ['content', '/postagens'], ['review', '/postagens/101'],
  ['brand', '/marca'], ['pages', '/paginas'], ['reader', '/paginas/estrategia'], ['briefing', '/briefing'],
  ['ideas', '/ideias'], ['reports', '/relatorios'], ['report', '/relatorios/2026-07'], ['states', '/states'],
] as const;

for (const [name, route] of lightRoutes) {
  test(`light desktop ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/prototype.html#${route}`);
    await expect(page).toHaveScreenshot(`${name}-desktop-light.png`, { fullPage: true, animations: 'disabled' });
  });
}

for (const [name, route] of [['home', '/'], ['approvals', '/aprovacoes'], ['review', '/postagens/101']] as const) {
  test(`mobile ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/prototype.html#${route}`);
    await expect(page).toHaveScreenshot(`${name}-mobile-light.png`, { fullPage: true, animations: 'disabled' });
  });
}

for (const [name, route] of [['home', '/'], ['review', '/postagens/101']] as const) {
  test(`dark ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/prototype.html#${route}`);
    await page.getByRole('button', { name: 'Usar modo escuro' }).click();
    await expect(page).toHaveScreenshot(`${name}-desktop-dark.png`, { fullPage: true, animations: 'disabled' });
  });
}
```

- [ ] **Step 5: Generate and review snapshots**

Run: `npx playwright test e2e/hub/prototype.visual.spec.ts --project=hub --update-snapshots`

Expected: 17 snapshot tests PASS and PNG baselines are created.

Open the snapshots and verify: no clipped controls; no content hidden behind mobile navigation; no unexpected horizontal scrolling except the labelled compact calendar region; consistent content width; banner crop remains useful; Home and review remain readable in dark mode.

Run: `npx playwright test e2e/hub/prototype.visual.spec.ts --project=hub`

Expected: 17 snapshot tests PASS without updating files.

- [ ] **Step 6: Commit verification coverage**

```bash
git add package.json package-lock.json e2e/hub apps/hub/src/prototype
git commit -m "test(hub): verify v2 prototype accessibility and visuals"
```

---

### Task 10: Full verification and prototype handoff

**Files:**
- Create: `apps/hub/src/prototype/README.md`
- Modify only if verification exposes a concrete issue: files under `apps/hub/src/prototype/` or `e2e/hub/`.

**Interfaces:**
- Produces: local review instructions and final evidence.

- [ ] **Step 1: Write exact local review instructions**

```md
# Client Hub V2 Prototype

Run `npm run dev:hub` and open `http://localhost:5175/prototype.html#/`.

The prototype uses local fixtures only. It does not authenticate, call Supabase, or write external data.

Routes mirror the production Hub after the hash, including `/aprovacoes`, `/postagens`, `/postagens/101`, `/marca`, `/paginas`, `/paginas/estrategia`, `/briefing`, `/ideias`, `/relatorios`, `/relatorios/2026-07`, and `/states`.

Use the review toolbar to change the page scenario and appearance. Use Reset to restore the original local fixture.
```

- [ ] **Step 2: Run focused prototype tests**

Run: `npx vitest run apps/hub/src/prototype/__tests__`

Expected: all prototype unit/component tests PASS.

- [ ] **Step 3: Run the complete repository test suite**

Run: `npm run test`

Expected: all Vitest tests PASS with no existing Hub regressions.

- [ ] **Step 4: Run the required Hub build**

Run: `npm run build:hub`

Expected: TypeScript and Vite build succeed. The production output remains rooted at `dist/hub/index.html`; no production route points to the prototype.

- [ ] **Step 5: Run prototype E2E suites**

Run: `npx playwright test e2e/hub/prototype.spec.ts e2e/hub/prototype.visual.spec.ts --project=hub`

Expected: all accessibility, interaction, and visual tests PASS.

- [ ] **Step 6: Recheck production isolation and working-tree scope**

Run: `git diff -- apps/hub/src/router.tsx apps/hub/src/api.ts apps/hub/index.html apps/crm/style.css`

Expected: no output.

Run: `git status --short`

Expected: only intended prototype/readme changes are present; preserve unrelated user files such as `AGENTS.md` and `spike/`.

- [ ] **Step 7: Commit handoff documentation**

```bash
git add apps/hub/src/prototype/README.md
git commit -m "docs(hub): add v2 prototype review guide"
```
