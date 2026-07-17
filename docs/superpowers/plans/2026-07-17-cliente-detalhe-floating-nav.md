# Cliente-detalhe Floating Section Nav — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wide-desktop floating rail to `ClienteDetalhePage` that jumps to the page's sections (with a scrollspy highlight) and groups a few client actions.

**Architecture:** A pure model builder (`buildNavModel`) decides which section links and action buttons are present from the page's existing state (role, data counts, IG/Hub state) — this is where all the conditional logic lives, unit-tested in isolation. A presentational component (`ClienteDetalheNav`) renders the rail, maps keys → lucide icon + i18n label, and owns the `IntersectionObserver` scrollspy. `ClienteDetalhePage` adds an `id` anchor to each section card and renders the rail once. All rail/gutter styling and the ≥1101px media query live in `apps/crm/style.css`.

**Tech Stack:** React 19, TypeScript, react-i18next (`clients` namespace), lucide-react icons, Vitest + Testing Library, plain CSS in `style.css`.

## Global Constraints

- No linter/formatter is documented, but **CI enforces eslint + prettier `format:check` + Vitest**. Typecheck with `npm run build` (runs `tsc` then vite). Run `npm run test` after changes. Run the repo's prettier/eslint before the final commit.
- Icons: **lucide-react exclusively**.
- i18n: add every new key to **both** `packages/i18n/locales/pt/clients.json` and `packages/i18n/locales/en/clients.json`, under the `clients` namespace. UI copy is Portuguese-first.
- The rail is **wide-desktop only (`@media (min-width: 1101px)`)** and `display: none` below that. Do **not** use the `≤900px`/`≥901px` breakpoints — at 768–1100px the sidebar is an off-canvas drawer and `.main-content` gets `margin-left: 0 !important`, which would strand a sidebar-anchored rail mid-content.
- CSS variables for theming: `--primary-color` (#eab308), `--surface-main`, `--surface-hover`, `--border-color`, `--text-main`, `--text-muted`, `--shadow`, `--sidebar-width` (260px), `--topbar-height` (52px).
- Toasts: `toast()` from `sonner`.
- Commit after each task. Never commit `.env*`.

---

## File Structure

- **Create** `apps/crm/src/pages/cliente-detalhe/clienteDetalheNav.model.ts` — pure `buildNavModel(input) → { sections, actions }`, the `SECTION_IDS` map, and shared types. No React, no i18n, no icons.
- **Create** `apps/crm/src/pages/cliente-detalhe/__tests__/clienteDetalheNav.model.test.ts` — exhaustive unit tests for the conditional logic (covers all 5 review findings).
- **Create** `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx` — presentational rail + scrollspy; maps keys → icon + label.
- **Create** `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx` — render / click / scrollspy tests with a mock `IntersectionObserver`.
- **Modify** `packages/i18n/locales/pt/clients.json` and `.../en/clients.json` — add `detail.nav.*` labels + `detail.pageNav` aria-label.
- **Modify** `apps/crm/style.css` — `.cliente-detalhe-page` padding + ≥1101px gutter; `.cliente-detalhe-nav*` classes; section `scroll-margin-top`.
- **Modify** `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` — add section `id`s, swap root inline padding for a class, build the model, render the rail.

---

## Task 1: `buildNavModel` pure model + tests

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/clienteDetalheNav.model.ts`
- Test: `apps/crm/src/pages/cliente-detalhe/__tests__/clienteDetalheNav.model.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type NavSectionKey = 'info'|'entregas'|'historico'|'instagram'|'relatorio'|'hub'|'arquivos'|'datas'|'enderecos'|'financeiro'`
  - `type NavActionKey = 'connectInstagram'|'analytics'|'openHub'|'editar'`
  - `interface NavSectionItem { key: NavSectionKey; id: string }`
  - `interface NavActionItem { key: NavActionKey; onClick: () => void }`
  - `const SECTION_IDS: Record<NavSectionKey, string>`
  - `function buildNavModel(input: BuildNavModelInput): { sections: NavSectionItem[]; actions: NavActionItem[] }`
  - `BuildNavModelInput`, `IgSummaryLike`, `HubTokenLike`, `NavHandlers` (shapes below).

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/cliente-detalhe/__tests__/clienteDetalheNav.model.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildNavModel, SECTION_IDS } from '../clienteDetalheNav.model';
import type { BuildNavModelInput } from '../clienteDetalheNav.model';

const NOW = 1_000_000_000_000; // fixed "now" for expiry math

function makeInput(over: Partial<BuildNavModelInput> = {}): BuildNavModelInput {
  return {
    isAgent: false,
    activeDeliveriesCount: 0,
    deliveryHistoryCount: 0,
    igSummary: undefined,
    hubToken: null,
    workspaceSlug: 'acme',
    contaId: 'conta-1',
    now: NOW,
    handlers: {
      onConnectInstagram: vi.fn(),
      onAnalytics: vi.fn(),
      onOpenHub: vi.fn(),
      onEditar: vi.fn(),
    },
    ...over,
  };
}

const sectionKeys = (m: ReturnType<typeof buildNavModel>) => m.sections.map((s) => s.key);
const actionKeys = (m: ReturnType<typeof buildNavModel>) => m.actions.map((a) => a.key);

describe('buildNavModel — sections', () => {
  it('owner with no deliveries: always-on sections, no entregas/historico', () => {
    const m = buildNavModel(makeInput());
    expect(sectionKeys(m)).toEqual([
      'info', 'instagram', 'relatorio', 'hub', 'arquivos', 'datas', 'enderecos', 'financeiro',
    ]);
  });

  it('includes entregas and historico when their counts are > 0, in order', () => {
    const m = buildNavModel(makeInput({ activeDeliveriesCount: 2, deliveryHistoryCount: 1 }));
    expect(sectionKeys(m)).toEqual([
      'info', 'entregas', 'historico', 'instagram', 'relatorio', 'hub',
      'arquivos', 'datas', 'enderecos', 'financeiro',
    ]);
  });

  it('agent: no relatorio and no financeiro, but hub still present', () => {
    const m = buildNavModel(makeInput({ isAgent: true }));
    expect(sectionKeys(m)).not.toContain('relatorio');
    expect(sectionKeys(m)).not.toContain('financeiro');
    expect(sectionKeys(m)).toContain('hub');
  });

  it('owner: hub section absent until workspaceSlug and contaId are both present', () => {
    expect(sectionKeys(buildNavModel(makeInput({ workspaceSlug: undefined })))).not.toContain('hub');
    expect(sectionKeys(buildNavModel(makeInput({ contaId: null })))).not.toContain('hub');
    expect(sectionKeys(buildNavModel(makeInput()))).toContain('hub');
  });

  it('maps instagram to the existing ig-container id', () => {
    const m = buildNavModel(makeInput());
    expect(m.sections.find((s) => s.key === 'instagram')?.id).toBe('ig-container');
    expect(SECTION_IDS.info).toBe('sec-info');
  });
});

describe('buildNavModel — actions', () => {
  it('disconnected IG: connectInstagram + editar, no analytics/openHub', () => {
    const m = buildNavModel(makeInput({ igSummary: undefined, hubToken: null }));
    expect(actionKeys(m)).toEqual(['connectInstagram', 'editar']);
  });

  it('connected but still syncing (no last_synced_at): neither connect nor analytics', () => {
    const m = buildNavModel(makeInput({ igSummary: { account: { last_synced_at: null } } }));
    expect(actionKeys(m)).toEqual(['editar']);
  });

  it('connected and synced: analytics shown, connect hidden', () => {
    const m = buildNavModel(makeInput({ igSummary: { account: { last_synced_at: '2026-07-01' } } }));
    expect(actionKeys(m)).toEqual(['analytics', 'editar']);
  });

  it('openHub only when token active, non-expired, and slug present', () => {
    const active = { is_active: true, token: 'tk', expires_at: new Date(NOW + 60_000).toISOString() };
    expect(actionKeys(buildNavModel(makeInput({ hubToken: active })))).toContain('openHub');

    const expired = { is_active: true, token: 'tk', expires_at: new Date(NOW - 60_000).toISOString() };
    expect(actionKeys(buildNavModel(makeInput({ hubToken: expired })))).not.toContain('openHub');

    const inactive = { is_active: false, token: 'tk', expires_at: new Date(NOW + 60_000).toISOString() };
    expect(actionKeys(buildNavModel(makeInput({ hubToken: inactive })))).not.toContain('openHub');

    expect(actionKeys(buildNavModel(makeInput({ hubToken: active, workspaceSlug: undefined })))).not.toContain('openHub');
  });

  it('editar is always present and last', () => {
    const m = buildNavModel(makeInput({
      igSummary: { account: { last_synced_at: '2026-07-01' } },
      hubToken: { is_active: true, token: 'tk', expires_at: new Date(NOW + 60_000).toISOString() },
    }));
    expect(actionKeys(m)).toEqual(['analytics', 'openHub', 'editar']);
  });

  it('wires each action to its handler', () => {
    const input = makeInput({
      igSummary: undefined,
      hubToken: { is_active: true, token: 'tk', expires_at: new Date(NOW + 60_000).toISOString() },
    });
    const m = buildNavModel(input);
    m.actions.find((a) => a.key === 'connectInstagram')!.onClick();
    m.actions.find((a) => a.key === 'openHub')!.onClick();
    m.actions.find((a) => a.key === 'editar')!.onClick();
    expect(input.handlers.onConnectInstagram).toHaveBeenCalledTimes(1);
    expect(input.handlers.onOpenHub).toHaveBeenCalledTimes(1);
    expect(input.handlers.onEditar).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- clienteDetalheNav.model`
Expected: FAIL — cannot resolve `../clienteDetalheNav.model` (module not created yet).

- [ ] **Step 3: Implement the model**

Create `apps/crm/src/pages/cliente-detalhe/clienteDetalheNav.model.ts`:

```ts
export type NavSectionKey =
  | 'info'
  | 'entregas'
  | 'historico'
  | 'instagram'
  | 'relatorio'
  | 'hub'
  | 'arquivos'
  | 'datas'
  | 'enderecos'
  | 'financeiro';

export type NavActionKey = 'connectInstagram' | 'analytics' | 'openHub' | 'editar';

export interface NavSectionItem {
  key: NavSectionKey;
  /** DOM id of the target section card. */
  id: string;
}

export interface NavActionItem {
  key: NavActionKey;
  onClick: () => void;
}

export interface IgSummaryLike {
  account?: { last_synced_at?: string | null } | null;
}

export interface HubTokenLike {
  is_active: boolean;
  expires_at: string;
  token: string;
}

export interface NavHandlers {
  onConnectInstagram: () => void;
  onAnalytics: () => void;
  onOpenHub: () => void;
  onEditar: () => void;
}

export interface BuildNavModelInput {
  isAgent: boolean;
  activeDeliveriesCount: number;
  deliveryHistoryCount: number;
  igSummary: IgSummaryLike | null | undefined;
  hubToken: HubTokenLike | null | undefined;
  workspaceSlug: string | undefined;
  contaId: string | null | undefined;
  /** Current time in ms; injected so expiry logic is testable. */
  now: number;
  handlers: NavHandlers;
}

export const SECTION_IDS: Record<NavSectionKey, string> = {
  info: 'sec-info',
  entregas: 'sec-entregas',
  historico: 'sec-historico',
  instagram: 'ig-container',
  relatorio: 'sec-relatorio',
  hub: 'sec-hub',
  arquivos: 'sec-arquivos',
  datas: 'sec-datas',
  enderecos: 'sec-enderecos',
  financeiro: 'sec-financeiro',
};

export function buildNavModel(input: BuildNavModelInput): {
  sections: NavSectionItem[];
  actions: NavActionItem[];
} {
  const {
    isAgent,
    activeDeliveriesCount,
    deliveryHistoryCount,
    igSummary,
    hubToken,
    workspaceSlug,
    contaId,
    now,
    handlers,
  } = input;

  const sections: NavSectionItem[] = [];
  const addSection = (key: NavSectionKey, present: boolean) => {
    if (present) sections.push({ key, id: SECTION_IDS[key] });
  };

  addSection('info', true);
  addSection('entregas', activeDeliveriesCount > 0);
  addSection('historico', deliveryHistoryCount > 0);
  addSection('instagram', true);
  addSection('relatorio', !isAgent);
  addSection('hub', isAgent || (!!contaId && !!workspaceSlug));
  addSection('arquivos', true);
  addSection('datas', true);
  addSection('enderecos', true);
  addSection('financeiro', !isAgent);

  const igDisconnected = !igSummary;
  const igSynced = !!igSummary?.account?.last_synced_at;
  const hubOpenable =
    !!hubToken?.is_active &&
    !!workspaceSlug &&
    new Date(hubToken.expires_at).getTime() > now;

  const actions: NavActionItem[] = [];
  if (igDisconnected) actions.push({ key: 'connectInstagram', onClick: handlers.onConnectInstagram });
  if (igSynced) actions.push({ key: 'analytics', onClick: handlers.onAnalytics });
  if (hubOpenable) actions.push({ key: 'openHub', onClick: handlers.onOpenHub });
  actions.push({ key: 'editar', onClick: handlers.onEditar });

  return { sections, actions };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- clienteDetalheNav.model`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/clienteDetalheNav.model.ts \
        apps/crm/src/pages/cliente-detalhe/__tests__/clienteDetalheNav.model.test.ts
git commit -m "feat(cliente-detalhe): pure nav model for floating section nav"
```

---

## Task 2: i18n labels + `ClienteDetalheNav` component + tests

**Files:**
- Modify: `packages/i18n/locales/pt/clients.json`
- Modify: `packages/i18n/locales/en/clients.json`
- Create: `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx`
- Test: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx`

**Interfaces:**
- Consumes from Task 1: `NavSectionItem`, `NavActionItem`, `NavSectionKey`, `NavActionKey`.
- Produces: `export function ClienteDetalheNav(props: { sections: NavSectionItem[]; actions: NavActionItem[] }): JSX.Element`. Renders `<nav className="cliente-detalhe-nav">`; each item is a `<button className="cliente-detalhe-nav__item">` with the label as its `aria-label`; the active section carries `aria-current="true"` and `cliente-detalhe-nav__item--active`.

- [ ] **Step 1: Add the i18n keys**

In `packages/i18n/locales/pt/clients.json`, inside the `"detail"` object (add a `"pageNav"` string and a nested `"nav"` object — place them alongside the other `detail.*` keys, e.g. right after `"information"`):

```json
    "pageNav": "Navegação da página",
    "nav": {
      "info": "Informação",
      "entregas": "Entregas",
      "historico": "Histórico",
      "instagram": "Instagram",
      "relatorio": "Relatório",
      "hub": "Hub",
      "arquivos": "Arquivos",
      "datas": "Datas",
      "enderecos": "Endereços",
      "financeiro": "Financeiro",
      "connectInstagram": "Conectar Instagram",
      "analytics": "Ir para Analytics",
      "openHub": "Abrir Hub",
      "editar": "Editar cliente"
    },
```

In `packages/i18n/locales/en/clients.json`, inside its `"detail"` object:

```json
    "pageNav": "Page navigation",
    "nav": {
      "info": "Info",
      "entregas": "Deliveries",
      "historico": "History",
      "instagram": "Instagram",
      "relatorio": "Report",
      "hub": "Hub",
      "arquivos": "Files",
      "datas": "Dates",
      "enderecos": "Addresses",
      "financeiro": "Finance",
      "connectInstagram": "Connect Instagram",
      "analytics": "Go to Analytics",
      "openHub": "Open Hub",
      "editar": "Edit client"
    },
```

Note: JSON has no trailing-comma tolerance — ensure the object you insert into still has valid comma placement (the snippets end with a comma assuming more keys follow; if you insert as the last key in `detail`, drop the trailing comma).

- [ ] **Step 2: Write the failing component test**

Create `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ClienteDetalheNav } from '../ClienteDetalheNav';
import type { NavSectionItem, NavActionItem } from '../clienteDetalheNav.model';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    MockIntersectionObserver.instances.push(this);
  }
}

const sections: NavSectionItem[] = [
  { key: 'info', id: 'sec-info' },
  { key: 'datas', id: 'sec-datas' },
];

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver as unknown as typeof IntersectionObserver);
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '<div id="sec-info"></div><div id="sec-datas"></div>';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ClienteDetalheNav', () => {
  it('renders a button per section and per action (PT labels)', () => {
    const actions: NavActionItem[] = [{ key: 'editar', onClick: vi.fn() }];
    render(<ClienteDetalheNav sections={sections} actions={actions} />);
    expect(screen.getByRole('button', { name: 'Informação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Datas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar cliente' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegação da página' })).toBeInTheDocument();
  });

  it('clicking a section scrolls its target into view', () => {
    render(<ClienteDetalheNav sections={sections} actions={[]} />);
    screen.getByRole('button', { name: 'Datas' }).click();
    expect(document.getElementById('sec-datas')!.scrollIntoView).toHaveBeenCalled();
  });

  it('clicking an action fires its onClick', () => {
    const onClick = vi.fn();
    render(<ClienteDetalheNav sections={sections} actions={[{ key: 'editar', onClick }]} />);
    screen.getByRole('button', { name: 'Editar cliente' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks the intersecting section active via aria-current', () => {
    render(<ClienteDetalheNav sections={sections} actions={[]} />);
    const observer = MockIntersectionObserver.instances[0];
    act(() => {
      observer.callback(
        [{ isIntersecting: true, target: document.getElementById('sec-datas')! } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    });
    expect(screen.getByRole('button', { name: 'Datas' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Informação' })).not.toHaveAttribute('aria-current');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- ClienteDetalheNav.test`
Expected: FAIL — cannot resolve `../ClienteDetalheNav` (component not created).

- [ ] **Step 4: Implement the component**

Create `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Info,
  LayoutList,
  History,
  Instagram,
  FileText,
  LayoutDashboard,
  FolderOpen,
  CalendarDays,
  MapPin,
  Wallet,
  Plug,
  BarChart3,
  ExternalLink,
  Edit2,
  type LucideIcon,
} from 'lucide-react';
import type {
  NavSectionItem,
  NavActionItem,
  NavSectionKey,
  NavActionKey,
} from './clienteDetalheNav.model';

const SECTION_META: Record<NavSectionKey, { icon: LucideIcon; labelKey: string }> = {
  info: { icon: Info, labelKey: 'detail.nav.info' },
  entregas: { icon: LayoutList, labelKey: 'detail.nav.entregas' },
  historico: { icon: History, labelKey: 'detail.nav.historico' },
  instagram: { icon: Instagram, labelKey: 'detail.nav.instagram' },
  relatorio: { icon: FileText, labelKey: 'detail.nav.relatorio' },
  hub: { icon: LayoutDashboard, labelKey: 'detail.nav.hub' },
  arquivos: { icon: FolderOpen, labelKey: 'detail.nav.arquivos' },
  datas: { icon: CalendarDays, labelKey: 'detail.nav.datas' },
  enderecos: { icon: MapPin, labelKey: 'detail.nav.enderecos' },
  financeiro: { icon: Wallet, labelKey: 'detail.nav.financeiro' },
};

const ACTION_META: Record<NavActionKey, { icon: LucideIcon; labelKey: string }> = {
  connectInstagram: { icon: Plug, labelKey: 'detail.nav.connectInstagram' },
  analytics: { icon: BarChart3, labelKey: 'detail.nav.analytics' },
  openHub: { icon: ExternalLink, labelKey: 'detail.nav.openHub' },
  editar: { icon: Edit2, labelKey: 'detail.nav.editar' },
};

interface ClienteDetalheNavProps {
  sections: NavSectionItem[];
  actions: NavActionItem[];
}

export function ClienteDetalheNav({ sections, actions }: ClienteDetalheNavProps) {
  const { t } = useTranslation('clients');
  const [activeId, setActiveId] = useState<string | null>(null);

  // Stable dependency: re-subscribe only when the set of section ids changes,
  // not on every render (the parent recomputes the arrays each render).
  const sectionIds = sections.map((s) => s.id).join(',');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const ids = sectionIds ? sectionIds.split(',') : [];
    if (ids.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sectionIds]);

  const handleSectionClick = (id: string) => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    setActiveId(id);
  };

  return (
    <nav className="cliente-detalhe-nav" aria-label={t('detail.pageNav')}>
      <div className="cliente-detalhe-nav__group">
        {sections.map((s) => {
          const { icon: Icon, labelKey } = SECTION_META[s.key];
          const label = t(labelKey);
          const active = activeId === s.id;
          return (
            <button
              key={s.key}
              type="button"
              className={`cliente-detalhe-nav__item${
                active ? ' cliente-detalhe-nav__item--active' : ''
              }`}
              aria-label={label}
              aria-current={active ? 'true' : undefined}
              onClick={() => handleSectionClick(s.id)}
            >
              <Icon className="cliente-detalhe-nav__icon" aria-hidden="true" />
              <span className="cliente-detalhe-nav__label">{label}</span>
            </button>
          );
        })}
      </div>
      {actions.length > 0 && <div className="cliente-detalhe-nav__divider" />}
      <div className="cliente-detalhe-nav__group">
        {actions.map((a) => {
          const { icon: Icon, labelKey } = ACTION_META[a.key];
          const label = t(labelKey);
          return (
            <button
              key={a.key}
              type="button"
              className="cliente-detalhe-nav__item cliente-detalhe-nav__item--action"
              aria-label={label}
              onClick={a.onClick}
            >
              <Icon className="cliente-detalhe-nav__icon" aria-hidden="true" />
              <span className="cliente-detalhe-nav__label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- ClienteDetalheNav.test`
Expected: PASS (4 cases green).

- [ ] **Step 6: Commit**

```bash
git add packages/i18n/locales/pt/clients.json packages/i18n/locales/en/clients.json \
        apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx \
        apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx
git commit -m "feat(cliente-detalhe): floating nav rail component + i18n labels"
```

---

## Task 3: Rail + gutter CSS

**Files:**
- Modify: `apps/crm/style.css` (append a new block at the end of the file)

**Interfaces:**
- Consumes: the class names emitted by `ClienteDetalheNav` (`cliente-detalhe-nav`, `__group`, `__divider`, `__item`, `__item--active`, `__item--action`, `__icon`, `__label`) and the page-root class `cliente-detalhe-page` (applied in Task 4), plus the section `id`s from `SECTION_IDS`.
- Produces: visual styling only. No JS contract.

- [ ] **Step 1: Append the styles to `apps/crm/style.css`**

Add at the end of the file:

```css
/* ─── Cliente detalhe — floating section nav ──────────────── */

/* Root padding lives here (not inline) so the desktop gutter can apply. */
.cliente-detalhe-page {
  padding: 1.5rem;
}

/* Smooth-scroll targets clear the top bar. Harmless when the rail is hidden. */
#sec-info,
#sec-entregas,
#sec-historico,
#ig-container,
#sec-relatorio,
#sec-hub,
#sec-arquivos,
#sec-datas,
#sec-enderecos,
#sec-financeiro {
  scroll-margin-top: calc(var(--topbar-height) + 1rem);
}

/* The rail and its gutter only make sense where the sidebar is statically
   present (>=1101px). Below that the layout uses an off-canvas drawer with
   .main-content margin-left: 0, so the rail must not render. */
@media (min-width: 1101px) {
  .cliente-detalhe-page {
    /* reserve room for the 48px collapsed rail + breathing space */
    padding-left: calc(1.5rem + 48px + 0.75rem);
  }

  .cliente-detalhe-nav {
    position: fixed;
    left: calc(var(--sidebar-width) + 0.5rem);
    top: 50%;
    transform: translateY(-50%);
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 48px;
    max-height: calc(100vh - 2rem);
    overflow-x: hidden;
    overflow-y: auto;
    padding: 8px;
    background: var(--surface-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    box-shadow: var(--shadow);
    transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .cliente-detalhe-nav:hover {
    width: 190px;
  }

  .cliente-detalhe-nav__group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .cliente-detalhe-nav__divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 6px;
    flex-shrink: 0;
  }

  .cliente-detalhe-nav__item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px;
    border: none;
    background: transparent;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .cliente-detalhe-nav__item:hover {
    background: var(--surface-hover);
    color: var(--text-main);
  }

  .cliente-detalhe-nav__icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
  }

  .cliente-detalhe-nav__label {
    font-size: 0.82rem;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .cliente-detalhe-nav:hover .cliente-detalhe-nav__label {
    opacity: 1;
  }

  .cliente-detalhe-nav__item--active {
    color: var(--primary-color);
    background: rgba(234, 179, 8, 0.1);
    font-weight: 500;
  }

  .cliente-detalhe-nav__item--action {
    color: var(--primary-color);
  }
}
```

- [ ] **Step 2: Verify the build is clean (CSS parses, no type impact)**

Run: `npm run build`
Expected: PASS — `tsc` clean and vite build succeeds (CSS is bundled without error).

- [ ] **Step 3: Commit**

```bash
git add apps/crm/style.css
git commit -m "style(cliente-detalhe): floating nav rail + desktop gutter (>=1101px)"
```

---

## Task 4: Wire the rail into `ClienteDetalhePage`

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`

**Interfaces:**
- Consumes from Task 1: `buildNavModel`. From Task 2: `ClienteDetalheNav`. From services: `getInstagramAuthUrl`.
- Produces: the rendered rail on the page; each navigable section carries its `id` from `SECTION_IDS`.

- [ ] **Step 1: Add imports**

At the top of `ClienteDetalhePage.tsx`, add the nav imports (near the other `./` imports, e.g. after the `HubTab` import):

```tsx
import { ClienteDetalheNav } from './ClienteDetalheNav';
import { buildNavModel } from './clienteDetalheNav.model';
```

Extend the existing instagram-service import (currently
`import { getInstagramSummary, syncInstagramData } from '../../services/instagram';`) to include `getInstagramAuthUrl`:

```tsx
import { getInstagramSummary, syncInstagramData, getInstagramAuthUrl } from '../../services/instagram';
```

- [ ] **Step 2: Add `id`s to each navigable section**

Make these exact edits (each anchor string is unique in the file):

Info card:
```tsx
      {/* Info Card */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
```
→
```tsx
      {/* Info Card */}
      <div id="sec-info" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
```

Entregas (the card inside the `boardCards.length > 0` block):
```tsx
      {boardCards.length > 0 && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
```
→
```tsx
      {boardCards.length > 0 && (
        <div id="sec-entregas" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
```

Histórico:
```tsx
      {concludedSummaries.length > 0 && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
```
→
```tsx
      {concludedSummaries.length > 0 && (
        <div id="sec-historico" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
```

Relatório:
```tsx
      {!isAgent && cliente && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight text-foreground mb-1">
            Relatório Mensal
```
→ add `id="sec-relatorio"` to that `<div>`.

Hub (owner card):
```tsx
      {!isAgent && cliente && cliente.id != null && cliente.conta_id && workspaceSlug && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight text-foreground mb-1">
            {t('detail.clientHub')}
```
→ add `id="sec-hub"` to that `<div>`.

Hub (agent notice):
```tsx
      {isAgent && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight text-foreground mb-3">
            {t('detail.clientHub')}
```
→ add `id="sec-hub"` to that `<div>`. (Only one Hub branch renders at a time, so the shared id never duplicates in the DOM.)

Datas:
```tsx
      {/* Important Dates Section */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
```
→ add `id="sec-datas"`.

Endereços:
```tsx
      {/* Addresses Section */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
```
→ add `id="sec-enderecos"`.

Financeiro (the KPI grid — first Financeiro card):
```tsx
          {/* KPI Cards */}
          <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
```
→
```tsx
          {/* KPI Cards */}
          <div id="sec-financeiro" className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
```

Arquivos (inside the `ClienteArquivosSection` component's returned card — anchor on its flex header, which is unique):
```tsx
    <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2 mb-0">
          <FolderOpen className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
```
→ add `id="sec-arquivos"` to the outer `<div>`.

Instagram: no change — `InstagramSection` already renders `<div id="ig-container" …>`. (Verify it is still present.)

- [ ] **Step 3: Build the nav model and render the rail**

Immediately before the final `return (` of `ClienteDetalhePage` (after the `receitaTotal`/`pendente` calculations, where `cliente` is guaranteed defined), add:

```tsx
  const navModel = buildNavModel({
    isAgent,
    activeDeliveriesCount: boardCards.length,
    deliveryHistoryCount: concludedSummaries.length,
    igSummary,
    hubToken: hubTokenData ?? null,
    workspaceSlug,
    contaId: cliente.conta_id ?? null,
    now: Date.now(),
    handlers: {
      onConnectInstagram: async () => {
        try {
          const url = await getInstagramAuthUrl(clienteId);
          window.location.href = url;
        } catch (err: unknown) {
          toast.error(t('instagram.connectError', { error: (err as Error).message }));
        }
      },
      onAnalytics: () => navigate(`/analytics/${clienteId}`),
      onOpenHub: () => {
        if (!hubTokenData || !workspaceSlug) return;
        const url = `${window.location.origin}/${workspaceSlug}/hub/${hubTokenData.token}`;
        window.open(url, '_blank', 'noopener');
      },
      onEditar: handleEdit,
    },
  });
```

Then change the page root element from the inline-padded div to the class, and render the rail as its first child:

```tsx
  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
```
→
```tsx
  return (
    <div className="cliente-detalhe-page">
      <ClienteDetalheNav sections={navModel.sections} actions={navModel.actions} />
      {/* Header */}
```

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npm run build`
Expected: PASS — no TypeScript errors (`hubTokenData` shape from `getHubToken` satisfies `HubTokenLike`; `igSummary` satisfies `IgSummaryLike`).

Run: `npm run test`
Expected: PASS — new model + component tests green, no regressions in existing suites (including `HubTab.test.tsx`).

- [ ] **Step 5: Run repo format/lint (CI gate)**

Run the repo's prettier + eslint if configured (e.g. `npm run format` / `npm run lint`, or `npx prettier --write` + `npx eslint` on the changed files). Fix any reported issues. (CI enforces `format:check` and eslint.)

- [ ] **Step 6: Manual browser verification (reviewer)**

Start the CRM (`npm run dev`), sign in, open a client at `/clientes/:id`, and confirm at a ≥1101px viewport:
- The rail is centered on the left, collapsed to icons; hovering expands it to show labels.
- Scrolling the page moves the yellow highlight to the section in view; clicking a row smooth-scrolls to that section, clearing the top bar.
- Actions: **Editar cliente** opens the edit modal; **Ir para Analytics** navigates (only when IG is connected and synced); **Abrir Hub** opens the portal in a new tab (only when an active, non-expired token exists); **Conectar Instagram** appears only when IG is disconnected and starts the OAuth redirect.
- Resize to 901–1100px and below 768px: the rail is gone and the page layout is unaffected (no leftover gutter mid-content).
- Sign in as an agent (or impersonate the role): no Relatório/Financeiro rows; the Hub row scrolls to the restriction notice.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "feat(cliente-detalhe): render floating section nav on the page"
```

---

## Notes for the implementer

- The rail deliberately renders on **every** viewport in the DOM; CSS (`@media (min-width: 1101px)`) is what shows/hides it. Do not add a JS width check — it would desync from the layout's own breakpoints.
- The parent recomputes `navModel` each render (cheap, pure). The component keys its observer effect off the joined section-id string, so it does not thrash on unrelated re-renders.
- If `npm run test -- <name>` reports "No test files found", run the full `npm run test` — the root Vitest config globs `apps/**/__tests__/**`.
- After `npm run test`, if `deno.lock` at the repo root shows as modified, revert it (`git checkout -- deno.lock`) — it is a known side effect of the functions suite and must not be committed here.
