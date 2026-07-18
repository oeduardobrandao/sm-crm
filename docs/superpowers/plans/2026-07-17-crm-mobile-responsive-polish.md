# CRM Mobile Responsive Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a stable glass mobile navbar, consolidated related-article access, a compact and navigable mobile client-detail page, selective horizontal card rails, and unclipped Hub tabs/actions.

**Architecture:** Keep all routing, permissions, queries, mutations, and desktop information architecture intact. Simplify shared mobile chrome in place, split the client-detail header and responsive rail into focused presentational components, extend the existing section navigator rather than creating a second navigation model, and use scoped CSS classes for phone-only transformations. Every behavior change is introduced test-first and committed independently.

**Tech Stack:** React 19, TypeScript, React Router 7, TanStack Query 5, Radix/shadcn primitives, lucide-react, plain CSS in `apps/crm/style.css`, Vitest 3, Testing Library, Vite 6.

## Global Constraints

- Phone breakpoint is **below 768px**; tablet is **768–1100px**; wide desktop is **1101px and above**.
- Preserve the existing primary destinations and order: Dashboard, Clientes, Analytics, Entregas, Mais.
- Preserve all Supabase, token, Instagram, permission, role, query, mutation, and routing behavior.
- Use `lucide-react` for new icons. Existing Phosphor classes in `MobileNav` may remain in this slice; do not add another icon package.
- Use `sonner` for toasts and existing Radix/shadcn primitives for popovers and sheets.
- Keep user-derived raw HTML escaped and external/user URLs sanitized in `InstagramPostsTable.ts`.
- Touch targets are at least 44×44px; fixed phone chrome respects safe-area insets.
- Backdrop filtering must have an opaque themed fallback.
- Horizontal rails use native overflow and scroll snap; no autoplay, looping, drag library, or new dependency.
- Do not modify or commit `.env*`, `AGENTS.md`, or `spike/`.
- After every code task, run its focused Vitest target and commit only that task's files.
- Before completion, run `npm run test` and `npm run build`, as required by `AGENTS.md`.

---

## File Structure

- **Modify** `apps/crm/src/components/layout/MobileNav.tsx` — remove canvas/bubble state and render stable semantic route buttons.
- **Modify** `apps/crm/src/components/layout/__tests__/MobileNav.test.tsx` — assert stable active/expanded semantics and retained More-sheet behavior.
- **Delete** `apps/crm/src/components/layout/mobile-nav-canvas.ts` and `use-bubble-animation.ts` plus their dedicated tests after imports are gone.
- **Modify** `apps/crm/src/components/help/ContextHelpLinks.tsx` — filter valid article targets and render one responsive related-articles trigger.
- **Create** `apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx` — cover empty, invalid, desktop-popover, and phone-sheet behavior.
- **Modify** `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx` — reuse the section buttons as a phone sticky strip and desktop rail.
- **Modify** `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx` — cover active-chip visibility and reduced-motion section jumps.
- **Create** `apps/crm/src/pages/cliente-detalhe/ClienteDetalheHeader.tsx` — focused client identity/back/edit header.
- **Create** `apps/crm/src/pages/cliente-detalhe/ResponsiveCardRail.tsx` — page-local repeated-card wrapper with single/multiple state.
- **Create** tests for both new client-detail components.
- **Modify** `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` — integrate the header and rails around deliveries, dates, and addresses.
- **Modify** `apps/crm/src/components/instagram/InstagramPostsTable.ts` — add scoped semantic post-list/card classes while preserving escaping and pagination.
- **Create** `apps/crm/src/components/instagram/__tests__/InstagramPostsTable.test.ts` — validate card hooks, collapsed rows, expansion, and safe content.
- **Modify** `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` — controlled tabs, selected-trigger visibility, and deliberate access-action groups.
- **Modify** `apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx` — cover all five triggers, scrolling, and layout hooks.
- **Modify** `apps/crm/style.css` — all glass navigation, help trigger, sticky strip, header, rail, Instagram, and Hub responsive presentation.

---

### Task 1: Replace the animated canvas navbar with stable glass navigation

**Files:**
- Modify: `apps/crm/src/components/layout/MobileNav.tsx:1-170`
- Modify: `apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`
- Modify: `apps/crm/style.css:2252-2475`
- Delete: `apps/crm/src/components/layout/mobile-nav-canvas.ts`
- Delete: `apps/crm/src/components/layout/use-bubble-animation.ts`
- Delete: `apps/crm/src/components/layout/__tests__/mobile-nav-canvas.test.ts`
- Delete any dedicated `use-bubble-animation` test returned by `rg --files apps/crm/src/components/layout/__tests__ | rg 'bubble-animation'`.

**Interfaces:**
- Consumes: `PRIMARY_ITEMS`, `getActiveIndex(pathname)`, existing `go`, More-sheet state/actions.
- Produces: `.mobile-nav-glass`, `.mobile-nav-items`, `.mobile-nav-item`, `.mobile-nav-item__icon`, active route `aria-current="page"`, and More `aria-expanded`.

- [ ] **Step 1: Write failing semantic navigation tests**

Remove the canvas and `useBubbleAnimation` mocks/imports from `MobileNav.test.tsx`. Add these assertions to the existing active-route test and add a More-state test:

```tsx
it('renders a stable active route without canvas chrome', () => {
  setAuth();
  renderMobileNav('/analytics');

  const analytics = screen.getByRole('button', { name: 'Analytics' });
  expect(analytics).toHaveAttribute('aria-current', 'page');
  expect(analytics).toHaveClass('active');
  expect(document.querySelector('canvas')).not.toBeInTheDocument();
  expect(document.querySelector('.mobile-nav-bubble-circle')).not.toBeInTheDocument();
});

it('exposes the Mais sheet state', () => {
  setAuth();
  renderMobileNav('/dashboard');

  const more = screen.getByRole('button', { name: 'Mais' });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(more);
  expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(more).toHaveAttribute('aria-controls', 'mobile-more-sheet');
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test -- apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`

Expected: FAIL because the canvas/bubble still render and the buttons lack the new ARIA attributes.

- [ ] **Step 3: Remove animation state and render the stable navigation**

In `MobileNav.tsx`, remove `useRef`, the imports from `mobile-nav-canvas` and
`use-bubble-animation`, `DPR`, `canvasRef`, `bubbleRef`, `activeIndexRef`, `fillColor`,
`itemCount`, both canvas/bubble effects, and the `animatingRef` click guard. Replace the
entire current nav block whose root is `<nav className="mobile-nav-bubble" id="mobile-nav">`
with:

```tsx
<nav className="mobile-nav-glass" id="mobile-nav" aria-label="Navegação principal">
  <div className="mobile-nav-items">
    {PRIMARY_ITEMS.map((item, index) => {
      const active = activeIndex === index;
      return (
        <button
          key={item.id}
          className={`mobile-nav-item${active ? ' active' : ''}`}
          onClick={() => go(item.route)}
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-label={item.label}
        >
          <span className="mobile-nav-item__icon" aria-hidden="true">
            <i className={`${active ? 'ph-fill' : 'ph'} ${item.icon}`} />
          </span>
          <span className="nav-label">{item.label}</span>
        </button>
      );
    })}

    <button
      id="mobile-more-btn"
      className={`mobile-nav-item${moreOpen ? ' active' : ''}`}
      onClick={() => setMoreOpen((value) => !value)}
      type="button"
      aria-label="Mais"
      aria-expanded={moreOpen}
      aria-controls="mobile-more-sheet"
    >
      <span className="mobile-nav-item__icon" aria-hidden="true">
        <i className="ph ph-dots-three" />
      </span>
      <span className="nav-label">Mais</span>
    </button>
  </div>
</nav>
```

Add `id="mobile-more-sheet"` to the existing `.mobile-more-sheet` element.

- [ ] **Step 4: Replace the canvas/bubble CSS with glass-bar CSS**

Replace the mobile nav rules under `@media (max-width: 900px)` and update page bottom
clearance with the following rules. Keep the existing More overlay/item styling after
this block.

```css
.mobile-nav-glass {
  display: none;
}

@media (max-width: 767px) {
  .mobile-nav-glass {
    position: fixed;
    z-index: 1000;
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    bottom: max(10px, env(safe-area-inset-bottom));
    display: block;
    min-height: 72px;
    padding: 6px;
    border: 1px solid color-mix(in srgb, var(--border-color) 76%, white 24%);
    border-radius: 26px;
    background: var(--surface-main);
    background: color-mix(in srgb, var(--surface-main) 82%, transparent);
    box-shadow: 0 -4px 24px rgba(15, 23, 42, 0.12);
    -webkit-backdrop-filter: blur(22px) saturate(145%);
    backdrop-filter: blur(22px) saturate(145%);
  }

  @supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .mobile-nav-glass {
      background: var(--surface-main);
    }
  }

  .mobile-nav-items {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    align-items: stretch;
    min-height: 58px;
  }

  .mobile-nav-item {
    min-width: 0;
    min-height: 58px;
    padding: 4px 2px;
    gap: 3px;
  }

  .mobile-nav-item__icon {
    display: grid;
    width: 36px;
    height: 30px;
    place-items: center;
    border-radius: 999px;
    transition: background-color 160ms ease, color 160ms ease, transform 160ms ease;
  }

  .mobile-nav-item.active .mobile-nav-item__icon {
    color: var(--text-main);
    background: color-mix(in srgb, var(--primary-color) 24%, transparent);
  }

  .mobile-nav-item.active .icon-wrap,
  .mobile-nav-item.active .mobile-nav-item__icon {
    opacity: 1;
    visibility: visible;
  }

  .mobile-nav-item .nav-label {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.64rem;
    font-weight: 600;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-nav-item.active .nav-label {
    color: var(--text-main);
    font-weight: 750;
  }

  .main-content {
    padding-bottom: calc(104px + env(safe-area-inset-bottom, 0px));
  }

  .mobile-more-sheet {
    bottom: calc(96px + env(safe-area-inset-bottom, 0px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .mobile-nav-item__icon,
  .mobile-more-sheet,
  .mobile-more-overlay {
    transition: none;
  }
}
```

Remove the old `.mobile-nav-bubble`, `.mobile-nav-wrap`, `.mobile-nav-canvas`,
`.mobile-nav-bubble-circle`, `.icon-wrap` hiding, and bubble-position rules. Keep the
tablet `display: none` override aligned to the new `.mobile-nav-glass` selector.

- [ ] **Step 5: Delete unused canvas/animation modules and tests**

Delete the four known files listed above and any dedicated bubble-animation test found by
the `rg` command. Confirm no imports remain:

Run: `rg -n "mobile-nav-canvas|use-bubble-animation|mobile-nav-bubble-circle|mobile-nav-canvas" apps/crm/src apps/crm/style.css`

Expected: no matches.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test -- apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`

Expected: PASS.

```bash
git add apps/crm/src/components/layout/MobileNav.tsx apps/crm/src/components/layout/__tests__/MobileNav.test.tsx apps/crm/src/components/layout/mobile-nav-canvas.ts apps/crm/src/components/layout/use-bubble-animation.ts apps/crm/src/components/layout/__tests__ apps/crm/style.css
git commit -m "feat(mobile): replace animated nav with glass bar"
```

---

### Task 2: Consolidate contextual help into one responsive articles menu

**Files:**
- Modify: `apps/crm/src/components/help/ContextHelpLinks.tsx`
- Create: `apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx`
- Modify: `apps/crm/style.css`

**Interfaces:**
- Consumes: `getContextLinksForRoute(baseRoute): Promise<KbContextLink[]>`.
- Produces: one `Artigos relacionados` trigger, `.context-help`, and
  `.context-help__article` links; invalid/missing slugs are excluded.

- [ ] **Step 1: Create failing menu tests**

Create `ContextHelpLinks.test.tsx` with a QueryClient/MemoryRouter harness and mock the KB
store:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextHelpLinks } from '../ContextHelpLinks';
import { getContextLinksForRoute } from '@/store/kb';

vi.mock('@/store/kb', () => ({ getContextLinksForRoute: vi.fn() }));

const article = (id: string, slug: string) => ({
  id,
  route_pattern: '/clientes',
  article_id: `article-${id}`,
  label: null,
  display_order: Number(id),
  article: {
    id: `article-${id}`,
    title: `Artigo ${id}`,
    slug,
    excerpt: null,
    content: null,
    content_plain: '',
    cover_image_url: null,
    category: 'clientes',
    tags: [],
    status: 'published' as const,
    display_order: Number(id),
    author_id: null,
    created_at: '',
    updated_at: '',
  },
});

function renderHelp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/clientes/42']}>
        <ContextHelpLinks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContextHelpLinks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)' ? false : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  it('renders one trigger and reveals all valid articles', async () => {
    vi.mocked(getContextLinksForRoute).mockResolvedValue([
      article('1', 'adicionar-clientes'),
      article('2', 'conectar-instagram'),
    ]);
    renderHelp();

    const trigger = await screen.findByRole('button', { name: /Artigos relacionados/ });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByRole('link', { name: 'Artigo 1' })).toHaveAttribute(
      'href',
      '/ajuda/adicionar-clientes',
    );
    expect(screen.getByRole('link', { name: 'Artigo 2' })).toBeInTheDocument();
  });

  it('omits missing slugs and hides the trigger when none remain', async () => {
    vi.mocked(getContextLinksForRoute).mockResolvedValue([article('1', '')]);
    renderHelp();
    await waitFor(() => expect(getContextLinksForRoute).toHaveBeenCalledWith('/clientes'));
    expect(screen.queryByRole('button', { name: /Artigos relacionados/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm run test -- apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx`

Expected: FAIL because the current component renders permanent article links and no trigger.

- [ ] **Step 3: Implement responsive Popover/Sheet content**

Add a local `usePhoneViewport()` hook using `(max-width: 767px)`. Filter links before
rendering. Use the existing `Popover` and `Sheet` primitives and the same article list in
both branches:

```tsx
function usePhoneViewport() {
  const query = '(max-width: 767px)';
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (event: MediaQueryListEvent) => setIsPhone(event.matches);
    setIsPhone(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isPhone;
}

function ArticleMenu({ links }: { links: KbContextLink[] }) {
  return (
    <div className="context-help__list">
      {links.map((link) => (
        <Link
          key={link.id}
          to={`/ajuda/${link.article!.slug}`}
          className="context-help__article"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>{link.label ?? link.article!.title}</span>
          <ChevronRight className="ml-auto h-4 w-4" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
```

Use one trigger body in the component:

```tsx
const validLinks = links.filter((link) => Boolean(link.article?.slug));
if (validLinks.length === 0) return null;

const trigger = (
  <Button variant="ghost" size="sm" className="context-help__trigger">
    <BookOpen className="h-4 w-4" aria-hidden="true" />
    Artigos relacionados
    <span className="context-help__count">{validLinks.length}</span>
  </Button>
);

return (
  <div className="context-help">
    {isPhone ? (
      <Sheet>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="context-help__sheet">
          <SheetHeader><SheetTitle>Artigos relacionados</SheetTitle></SheetHeader>
          <ArticleMenu links={validLinks} />
        </SheetContent>
      </Sheet>
    ) : (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="context-help__popover">
          <ArticleMenu links={validLinks} />
        </PopoverContent>
      </Popover>
    )}
  </div>
);
```

Import `useEffect`, `useState`, `Link`, `BookOpen`, `ChevronRight`, `Button`, the
Popover primitives, Sheet primitives, and `KbContextLink`.

- [ ] **Step 4: Add compact help menu styles**

```css
.context-help {
  display: flex;
  justify-content: flex-end;
  min-height: 36px;
  margin-bottom: 0.75rem;
}

.context-help__trigger {
  gap: 0.45rem;
  color: var(--text-muted);
}

.context-help__count {
  display: grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary-color) 20%, transparent);
  color: var(--text-main);
  font-size: 0.7rem;
}

.context-help__popover { padding: 0.5rem; }
.context-help__sheet {
  max-height: 72svh;
  overflow-y: auto;
  border-radius: 24px 24px 0 0;
  padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
}

.context-help__list { display: grid; gap: 0.25rem; }
.context-help__article {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  color: var(--text-main);
  text-decoration: none;
}
.context-help__article:hover { background: var(--surface-hover); }
```

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run test -- apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx`

Expected: PASS.

```bash
git add apps/crm/src/components/help/ContextHelpLinks.tsx apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx apps/crm/style.css
git commit -m "feat(help): consolidate related article links"
```

---

### Task 3: Extend the section navigator into a sticky phone strip

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx`
- Modify: `apps/crm/style.css:8119-8325`

**Interfaces:**
- Consumes: existing `NavSectionItem[]`, `NavActionItem[]`, DOM section IDs.
- Produces: one `<nav>` that is a phone horizontal strip below 768px, hidden at tablet,
  and the current floating rail above 1100px.

- [ ] **Step 1: Add failing active-chip and reduced-motion tests**

In `ClienteDetalheNav.test.tsx`, stub `matchMedia` and make `scrollIntoView` a spy. Add:

```tsx
it('keeps an observer-selected phone chip visible', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(<ClienteDetalheNav sections={sections} actions={[]} />);
  const dates = screen.getByRole('button', { name: 'Datas' });

  act(() => {
    MockIntersectionObserver.instances[0].callback(
      [{ isIntersecting: true, target: document.getElementById('sec-datas')! } as IntersectionObserverEntry],
      MockIntersectionObserver.instances[0] as unknown as IntersectionObserver,
    );
  });

  expect(dates.scrollIntoView).toHaveBeenCalledWith({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'center',
  });
});

it('uses an instant section jump when reduced motion is preferred', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  render(<ClienteDetalheNav sections={sections} actions={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Datas' }));
  expect(document.getElementById('sec-datas')!.scrollIntoView).toHaveBeenCalledWith({
    behavior: 'auto',
    block: 'start',
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test -- apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx`

Expected: active-chip test FAIL because section buttons do not keep themselves visible.

- [ ] **Step 3: Track section button refs and reveal the active phone chip**

Add `useRef` to the import and the following state/effect. Attach the ref in the existing
section-button map:

```tsx
const sectionButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

useEffect(() => {
  if (!activeId || typeof window === 'undefined') return;
  if (!window.matchMedia('(max-width: 767px)').matches) return;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  sectionButtonRefs.current[activeId]?.scrollIntoView({
    behavior: prefersReduced ? 'auto' : 'smooth',
    block: 'nearest',
    inline: 'center',
  });
}, [activeId]);
```

```tsx
ref={(element) => {
  sectionButtonRefs.current[s.id] = element;
}}
```

Do not duplicate the section buttons. The current `.cliente-detalhe-nav__group` becomes a
row through CSS on phones; hide `.cliente-detalhe-nav__divider` and the action group on
phones with a new modifier class on the actions group:

```tsx
<div className="cliente-detalhe-nav__group cliente-detalhe-nav__group--actions">
```

- [ ] **Step 4: Add phone-strip and offset CSS**

```css
@media (max-width: 767px) {
  .cliente-detalhe-nav {
    position: sticky;
    top: calc(var(--banner-height, 0px) + env(safe-area-inset-top, 0px));
    z-index: 35;
    display: flex;
    width: calc(100% + 2rem);
    margin: 0 -1rem 1rem;
    overflow-x: auto;
    border-block: 1px solid var(--border-color);
    background: var(--surface-main);
    background: color-mix(in srgb, var(--surface-main) 88%, transparent);
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
    scrollbar-width: none;
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    backdrop-filter: blur(18px) saturate(140%);
  }
  .cliente-detalhe-nav::-webkit-scrollbar { display: none; }
  .cliente-detalhe-nav__group {
    display: flex;
    min-width: max-content;
    gap: 0.35rem;
    padding: 0.55rem 1rem;
  }
  .cliente-detalhe-nav__group--actions,
  .cliente-detalhe-nav__divider { display: none; }
  .cliente-detalhe-nav__item {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--surface-main);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .cliente-detalhe-nav__item--active {
    border-color: color-mix(in srgb, var(--primary-color) 55%, var(--border-color));
    background: color-mix(in srgb, var(--primary-color) 18%, var(--surface-main));
    color: var(--text-main);
    font-weight: 700;
  }
  .cliente-detalhe-nav__icon { width: 16px; height: 16px; }
  .cliente-detalhe-nav__label { font-size: 0.78rem; opacity: 1; }

  #sec-info, #sec-entregas, #sec-historico, #ig-container, #sec-relatorio,
  #sec-hub, #sec-arquivos, #sec-datas, #sec-enderecos, #sec-financeiro {
    scroll-margin-top: calc(var(--banner-height, 0px) + env(safe-area-inset-top, 0px) + 68px);
  }
}

@media (min-width: 768px) and (max-width: 1100px) {
  .cliente-detalhe-nav { display: none; }
}
```

Retain the current `@media (min-width: 1101px)` rail rules.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run test -- apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx`

Expected: PASS.

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheNav.test.tsx apps/crm/style.css
git commit -m "feat(clients): add sticky mobile section navigation"
```

---

### Task 4: Add the compact client header and reusable card rails

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/ClienteDetalheHeader.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/ResponsiveCardRail.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteDetalheHeader.test.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/__tests__/ResponsiveCardRail.test.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx:936-993,1064-1089,1564-1795`
- Modify: `apps/crm/style.css`

**Interfaces:**
- `ClienteDetalheHeaderProps`: `{ nome; initials; cor; plano; status; imageUrl?; onBack; onEdit }`.
- `ResponsiveCardRailProps`: `{ children: ReactNode; className?: string; itemClassName?: string }`.
- Produces named layout hooks without changing page callbacks or data.

- [ ] **Step 1: Write failing component tests**

Create the two tests:

```tsx
// ClienteDetalheHeader.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClienteDetalheHeader } from '../ClienteDetalheHeader';

it('keeps identity, badges, and actions in separate layout regions', () => {
  const onBack = vi.fn();
  const onEdit = vi.fn();
  render(
    <ClienteDetalheHeader
      nome="Ana Beatriz Gois Bessa"
      initials="AB"
      cor="#eab308"
      plano="Social + Vídeo"
      status="ativo"
      onBack={onBack}
      onEdit={onEdit}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Ana Beatriz Gois Bessa' })).toHaveClass(
    'cliente-detalhe-header__name',
  );
  expect(screen.getByText('Social + Vídeo').parentElement).toHaveClass(
    'cliente-detalhe-header__badges',
  );
  fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));
  fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
  expect(onBack).toHaveBeenCalledOnce();
  expect(onEdit).toHaveBeenCalledOnce();
});
```

```tsx
// ResponsiveCardRail.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResponsiveCardRail } from '../ResponsiveCardRail';

it('marks multiple children as a discoverable rail', () => {
  render(<ResponsiveCardRail><div>A</div><div>B</div></ResponsiveCardRail>);
  expect(screen.getByTestId('responsive-card-rail')).toHaveClass(
    'cliente-card-rail--multiple',
  );
  expect(screen.getAllByTestId('responsive-card-rail-item')).toHaveLength(2);
});

it('keeps a single child full width', () => {
  render(<ResponsiveCardRail><div>A</div></ResponsiveCardRail>);
  expect(screen.getByTestId('responsive-card-rail')).not.toHaveClass(
    'cliente-card-rail--multiple',
  );
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm run test -- ClienteDetalheHeader ResponsiveCardRail`

Expected: FAIL because neither component exists.

- [ ] **Step 3: Implement both focused components**

`ResponsiveCardRail.tsx`:

```tsx
import { Children, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveCardRailProps {
  children: ReactNode;
  className?: string;
  itemClassName?: string;
}

export function ResponsiveCardRail({ children, className, itemClassName }: ResponsiveCardRailProps) {
  const items = Children.toArray(children);
  return (
    <div
      className={cn('cliente-card-rail', items.length > 1 && 'cliente-card-rail--multiple', className)}
      data-testid="responsive-card-rail"
    >
      {items.map((child, index) => (
        <div key={index} className={cn('cliente-card-rail__item', itemClassName)} data-testid="responsive-card-rail-item">
          {child}
        </div>
      ))}
    </div>
  );
}
```

`ClienteDetalheHeader.tsx` defines the existing status map locally, uses `useTranslation`,
and renders the approved structure:

```tsx
import { ArrowLeft, Edit2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface ClienteDetalheHeaderProps {
  nome: string;
  initials: string;
  cor: string;
  plano: string;
  status: string;
  imageUrl?: string | null;
  onBack: () => void;
  onEdit: () => void;
}

const STATUS_CLASS: Record<string, string> = {
  ativo: 'badge-success', pausado: 'badge-warning', encerrado: 'badge-danger',
  vigente: 'badge-success', a_assinar: 'badge-warning', pago: 'badge-success',
  agendado: 'badge-neutral',
};

export function ClienteDetalheHeader(props: ClienteDetalheHeaderProps) {
  const { t: tc } = useTranslation();
  return (
    <header className="cliente-detalhe-header">
      <div className="cliente-detalhe-header__identity">
        <Button variant="outline" size="icon" className="cliente-detalhe-header__back" onClick={props.onBack} aria-label="Voltar para clientes">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {props.imageUrl ? (
          <img className="cliente-detalhe-header__avatar" src={props.imageUrl} alt={props.nome} />
        ) : (
          <div className="cliente-detalhe-header__avatar cliente-detalhe-header__initials" style={{ background: props.cor }} aria-hidden="true">
            {props.initials}
          </div>
        )}
        <div className="cliente-detalhe-header__text">
          <h2 className="cliente-detalhe-header__name">{props.nome}</h2>
          <div className="cliente-detalhe-header__badges">
            <span className="badge badge-neutral">{props.plano}</span>
            <span className={`badge ${STATUS_CLASS[props.status] ?? 'badge-neutral'}`}>
              {tc(`status.${props.status}`, { defaultValue: props.status })}
            </span>
          </div>
        </div>
      </div>
      <Button variant="outline" className="cliente-detalhe-header__edit" onClick={props.onEdit}>
        <Edit2 className="h-4 w-4" /> {tc('actions.edit')}
      </Button>
    </header>
  );
}
```

- [ ] **Step 4: Integrate the header and rails into `ClienteDetalhePage`**

Remove the local `StatusBadge` function and the old header block. Move the existing
`<ClienteDetalheNav sections={navModel.sections} actions={navModel.actions} />` so it is
immediately after the new header (desktop positioning remains fixed through CSS). Import
both new components and render:

```tsx
<ClienteDetalheHeader
  nome={cliente.nome}
  initials={getInitials(cliente.nome)}
  cor={cliente.cor}
  plano={cliente.plano}
  status={cliente.status}
  imageUrl={igSummary?.account?.profile_picture_url}
  onBack={() => navigate('/clientes')}
  onEdit={handleEdit}
/>
```

Wrap the complete `boardCards.map`, `datasImportantes.map`, and `enderecos.map` outputs in
`ResponsiveCardRail`. Move each date/address card's inline layout properties into
`.cliente-date-card` and `.cliente-address-card`; preserve their data and handlers exactly.
Use `className="cliente-deliveries-rail"`, `cliente-dates-rail`, and
`cliente-addresses-rail` on the three rail instances.

- [ ] **Step 5: Add responsive header/rail styles**

```css
.cliente-detalhe-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.cliente-detalhe-header__identity { display: flex; min-width: 0; align-items: center; gap: 1rem; }
.cliente-detalhe-header__back { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; }
.cliente-detalhe-header__avatar { flex: 0 0 48px; width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }
.cliente-detalhe-header__initials { display: grid; place-items: center; color: white; font-weight: 700; }
.cliente-detalhe-header__text { min-width: 0; }
.cliente-detalhe-header__name { margin: 0; font-family: var(--font-heading); font-weight: 900; color: var(--text-main); }
.cliente-detalhe-header__badges { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
.cliente-card-rail { display: grid; gap: 0.75rem; }
.cliente-deliveries-rail { grid-template-columns: minmax(0, 1fr); }
.cliente-dates-rail { grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); }
.cliente-addresses-rail { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.cliente-date-card, .cliente-address-card { border: 1px solid var(--border-color); border-radius: 12px; background: var(--surface-main); }

@media (max-width: 767px) {
  .cliente-detalhe-page { padding: 0; }
  .cliente-detalhe-header { align-items: flex-start; flex-wrap: wrap; gap: 0.75rem; }
  .cliente-detalhe-header__identity { width: 100%; gap: 0.75rem; }
  .cliente-detalhe-header__name {
    display: -webkit-box;
    overflow: hidden;
    font-size: clamp(1.6rem, 7vw, 2rem);
    line-height: 1.08;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .cliente-detalhe-header__edit { min-height: 44px; margin-left: 104px; }
  .client-info-grid { grid-template-columns: minmax(0, 1fr); }
  .client-info-value { overflow-wrap: anywhere; }
  .cliente-card-rail--multiple {
    display: flex;
    overflow-x: auto;
    gap: 0.75rem;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .cliente-card-rail--multiple::-webkit-scrollbar { display: none; }
  .cliente-card-rail--multiple > .cliente-card-rail__item {
    flex: 0 0 84%;
    min-width: 260px;
    scroll-snap-align: start;
  }
  .cliente-card-rail__item > * { height: 100%; }
  .cliente-dates-rail,
  .cliente-addresses-rail { grid-template-columns: none; }
  .cliente-date-card, .cliente-address-card { height: 100%; }
  .cliente-date-card button, .cliente-address-card button { min-width: 44px; min-height: 44px; }
}

@media (max-width: 359px) {
  .main-content { padding-inline: 12px; }
  .cliente-detalhe-nav { width: calc(100% + 24px); margin-inline: -12px; }
  .cliente-detalhe-header__edit { margin-left: 0; }
}
```

At 360–767px retain the existing `.main-content { padding-inline: 1rem; }`, producing the
specified 16px effective gutter after the page root padding becomes zero.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test -- ClienteDetalheHeader ResponsiveCardRail ClienteDetalheNav`

Expected: PASS.

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalheHeader.tsx apps/crm/src/pages/cliente-detalhe/ResponsiveCardRail.tsx apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx apps/crm/src/pages/cliente-detalhe/__tests__ apps/crm/style.css
git commit -m "feat(clients): polish mobile header and card rails"
```

---

### Task 5: Turn Instagram publications into a scoped phone rail

**Files:**
- Modify: `apps/crm/src/components/instagram/InstagramPostsTable.ts`
- Create: `apps/crm/src/components/instagram/__tests__/InstagramPostsTable.test.ts`
- Modify: `apps/crm/style.css`

**Interfaces:**
- Consumes: existing `getInstagramPosts(clientId, page)` result and security helpers.
- Produces: `.ig-posts-section`, `.ig-posts-list`, `.ig-post-card`, and metric/action hooks.

- [ ] **Step 1: Write failing renderer tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInstagramPostsTable } from '../InstagramPostsTable';
import { getInstagramPosts } from '../../../services/instagram';

vi.mock('../../../services/instagram', () => ({ getInstagramPosts: vi.fn() }));

const posts = Array.from({ length: 6 }, (_, index) => ({
  id: String(index + 1),
  posted_at: '2026-07-13T12:00:00Z',
  media_type: 'CAROUSEL_ALBUM',
  caption: index === 0 ? '<img src=x onerror=alert(1)>' : `Legenda ${index + 1}`,
  thumbnail_url: '',
  permalink: 'https://instagram.com/p/safe',
  likes: 75,
  comments: 6,
  reach: 321,
  impressions: 941,
}));

describe('renderInstagramPostsTable', () => {
  beforeEach(() => vi.resetAllMocks());

  it('renders scoped post cards with escaped captions', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');
    await renderInstagramPostsTable(container, 42);
    expect(container.querySelector('.ig-posts-section')).not.toBeNull();
    expect(container.querySelectorAll('.ig-post-card')).toHaveLength(6);
    expect(container.querySelector('img[onerror="alert(1)"]')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps rows after the fifth collapsed until Ver mais is activated', async () => {
    vi.mocked(getInstagramPosts).mockResolvedValue({ posts, total: 6 } as never);
    const container = document.createElement('div');
    await renderInstagramPostsTable(container, 42);
    const sixth = container.querySelectorAll<HTMLElement>('.ig-post-card')[5];
    expect(sixth.style.display).toBe('none');
    container.querySelector<HTMLButtonElement>('#btn-ig-expand')!.click();
    expect(sixth.style.display).toBe('');
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm run test -- apps/crm/src/components/instagram/__tests__/InstagramPostsTable.test.ts`

Expected: FAIL because the dedicated section/card classes do not exist.

- [ ] **Step 3: Add scoped semantic classes without changing data/security logic**

Apply these exact class substitutions to the existing generated markup without changing
the content between the tags:

- Outer card: change `class="card animate-up"` to
  `class="card animate-up ig-posts-section"`.
- Header wrapper: add `class="ig-posts-section__header"` to the existing flex header.
- Content wrapper: change `id="ig-posts-content"` to
  `id="ig-posts-content" class="ig-posts-content"`.
- Table: change `class="data-table"` to `class="data-table ig-posts-list"`.
- `<tbody>`: change it to `<tbody class="ig-posts-list__body">`.
- Every post `<tr>`: add `ig-post-card`; when collapsed, use
  `class="ig-post-card ig-row-hidden" style="display:none;"`.
- Date cell: add `class="ig-post-card__identity"`.
- Caption cell: add `class="ig-post-card__caption"`.
- Engagement and performance cells: add `class="ig-post-card__metrics"`.
- Link cell: add `class="ig-post-card__action"`.

Keep the existing inline `display:none` toggle on collapsed rows. Keep every `escapeHTML()`
and `sanitizeUrl()` call unchanged. Change the external-link anchor's visible content to
include a visually available mobile label:

```html
<i class="ph ph-arrow-square-out" aria-hidden="true"></i><span class="ig-post-card__action-label">Abrir publicação</span>
```

- [ ] **Step 4: Add the scoped phone rail CSS**

```css
.ig-post-card__action-label { display: none; }

@media (max-width: 767px) {
  .ig-posts-section { overflow: visible !important; }
  .ig-posts-content { overflow: visible; }
  .ig-posts-list,
  .ig-posts-list__body {
    display: block;
    width: 100%;
  }
  .ig-posts-list__body {
    display: flex;
    overflow-x: auto;
    gap: 0.75rem;
    padding: 2px 1px 0.5rem;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .ig-posts-list__body::-webkit-scrollbar { display: none; }
  .ig-posts-list .ig-post-card {
    flex: 0 0 84%;
    min-width: 260px;
    margin: 0;
    padding: 1rem;
    scroll-snap-align: start;
  }
  .ig-posts-list .ig-post-card > td {
    display: flex;
    width: 100%;
    min-width: 0;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .ig-post-card__caption { min-height: 72px; align-items: flex-start !important; }
  .ig-post-card__caption { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
  .ig-post-card__action a { display: inline-flex !important; min-height: 44px; align-items: center; gap: 0.4rem; }
  .ig-post-card__action-label { display: inline; }
}
```

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run test -- apps/crm/src/components/instagram/__tests__/InstagramPostsTable.test.ts`

Expected: PASS.

```bash
git add apps/crm/src/components/instagram/InstagramPostsTable.ts apps/crm/src/components/instagram/__tests__/InstagramPostsTable.test.ts apps/crm/style.css
git commit -m "feat(instagram): add mobile publications rail"
```

---

### Task 6: Make Hub tabs and access actions fully reachable on phones

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx:184-325`
- Modify: `apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx`
- Modify: `apps/crm/style.css`

**Interfaces:**
- Consumes: the existing five tab values and token actions.
- Produces: controlled `activeTab`, `.hub-tabs*`, `.hub-access*`, and selected-trigger
  `scrollIntoView` behavior.

- [ ] **Step 1: Add failing reachability/layout tests**

Add to `HubTab.test.tsx`:

```tsx
it('renders all tabs inside the horizontal Hub tab list', async () => {
  vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
  renderTab();
  await waitFor(() => screen.getByText(/Expira em/));
  expect(screen.getByRole('tablist')).toHaveClass('hub-tabs__list');
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Acesso', 'Briefing', 'Marca', 'Páginas', 'Ideias',
  ]);
});

it('scrolls the selected tab into view and groups access actions', async () => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
  renderTab();
  const ideias = await screen.findByRole('tab', { name: 'Ideias' });
  fireEvent.click(ideias);
  expect(ideias.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  fireEvent.click(screen.getByRole('tab', { name: 'Acesso' }));
  expect(document.querySelector('.hub-access__url')).not.toBeNull();
  expect(document.querySelector('.hub-access__secondary-actions')).not.toBeNull();
  expect(document.querySelector('.hub-access__primary-actions')).not.toBeNull();
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm run test -- apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx`

Expected: FAIL because the tab list/action hooks and selected-trigger scroll are absent.

- [ ] **Step 3: Control the tab value and reveal the selected trigger**

Add state/ref/effect near the existing mutation state:

```tsx
const [activeTab, setActiveTab] = useState('acesso');
const tabListRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const active = tabListRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
  active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}, [activeTab]);
```

Replace the Tabs opening block with:

```tsx
<Tabs value={activeTab} onValueChange={setActiveTab} className="hub-tabs py-4">
  <TabsList ref={tabListRef} className="hub-tabs__list mb-6">
    <TabsTrigger value="acesso">Acesso</TabsTrigger>
    <TabsTrigger value="briefing">Briefing</TabsTrigger>
    <TabsTrigger value="marca">Marca</TabsTrigger>
    <TabsTrigger value="paginas">Páginas</TabsTrigger>
    <TabsTrigger value="ideias">Ideias</TabsTrigger>
  </TabsList>
```

- [ ] **Step 4: Restructure only the Acesso layout wrappers**

Replace the current single `flex items-center gap-3 flex-wrap` wrapper with:

```tsx
<div className="hub-access">
  <code className="hub-access__url text-xs bg-muted px-3 py-2 rounded-lg truncate">
    {hubUrl}
  </code>
  <div className="hub-access__secondary-actions">
    <Button size="sm" variant="outline" onClick={copyLink}>
      <Copy size={14} className="mr-1.5" /> Copiar
    </Button>
    <Button size="sm" variant="outline" onClick={() => openExternalUrl(hubUrl)}>
      <Eye size={14} className="mr-1.5" /> Preview
    </Button>
  </div>
  <div className="hub-access__primary-actions">
    <Button
      size="sm"
      variant={tokenData.is_active ? 'destructive' : 'default'}
      onClick={toggleActive}
    >
      {tokenData.is_active ? (
        <><ToggleRight size={14} className="mr-1.5" /> Desativar</>
      ) : (
        <><ToggleLeft size={14} className="mr-1.5" /> Ativar</>
      )}
    </Button>
    {showRescue && (
      <Button size="sm" variant="outline" onClick={handleExtend} disabled={extending}>
        <CalendarClock size={14} className="mr-1.5" /> Estender +1 ano
      </Button>
    )}
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive" disabled={rotating}>
          <RefreshCw size={14} className="mr-1.5" /> Gerar novo link
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Gerar um novo link?</AlertDialogTitle>
          <AlertDialogDescription>
            O link atual para de funcionar imediatamente. O cliente perde o acesso até
            você enviar o novo link. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleRotate}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</div>
```

Leave the expiry paragraph immediately after `.hub-access`.

- [ ] **Step 5: Add Hub-specific responsive styles**

```css
.hub-tabs { min-width: 0; }
.hub-tabs__list { max-width: 100%; }
.hub-access { display: grid; gap: 0.75rem; }
.hub-access__url { display: block; min-width: 0; width: 100%; }
.hub-access__secondary-actions,
.hub-access__primary-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }

@media (max-width: 767px) {
  .hub-tabs__list {
    display: flex;
    width: 100%;
    height: auto;
    justify-content: flex-start;
    overflow-x: auto;
    padding: 0.25rem;
    scroll-padding-inline: 0.25rem;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .hub-tabs__list::-webkit-scrollbar { display: none; }
  .hub-tabs__list [role='tab'] { flex: 0 0 auto; min-height: 44px; }
  .hub-access__secondary-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hub-access__primary-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hub-access__secondary-actions > *,
  .hub-access__primary-actions > * { min-height: 44px; width: 100%; }
}

@media (max-width: 359px) {
  .hub-access__secondary-actions,
  .hub-access__primary-actions { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test -- apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx`

Expected: PASS.

```bash
git add apps/crm/src/pages/cliente-detalhe/HubTab.tsx apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx apps/crm/style.css
git commit -m "feat(hub): fix mobile tabs and access actions"
```

---

### Task 7: Integrate, verify breakpoints, and fix only discovered regressions

**Files:**
- Modify only files already listed in Tasks 1–6 when verification exposes a regression.
- Do not expand scope into unrelated page refactors.

**Interfaces:**
- Consumes: all task deliverables.
- Produces: passing full tests/build and documented visual evidence across the acceptance matrix.

- [ ] **Step 1: Run all focused responsive tests together**

Run:

```bash
npm run test -- MobileNav ContextHelpLinks ClienteDetalheNav ClienteDetalheHeader ResponsiveCardRail InstagramPostsTable HubTab
```

Expected: all selected test files PASS.

- [ ] **Step 2: Run the full frontend suite**

Run: `npm run test`

Expected: Vitest exits 0 with no regressions.

- [ ] **Step 3: Typecheck and build the CRM**

Run: `npm run build`

Expected: TypeScript and Vite both exit 0 and produce the CRM build.

- [ ] **Step 4: Start the staging CRM for authenticated visual QA**

Run: `npm run dev:staging`

Expected: Vite starts the CRM (normally at `http://localhost:5173`) without compile errors.
Use the signed-in in-app browser if available; otherwise use the existing authenticated
browser session.

- [ ] **Step 5: Verify the exact responsive matrix**

At widths 320, 390, 430, 768, 1024, 1101, and a wide desktop, confirm:

- the phone nav encloses all five icon/label pairs and clears the home indicator;
- no canvas, detached circle, or route-change bubble remains;
- More opens above the new nav and every gated item is reachable;
- one related-articles trigger opens a popover on desktop and sheet on phone;
- a long client name uses at most two visual lines; back/avatar/badges/Editar do not deform;
- phone gutters are 12px below 360 and 16px at 360–767;
- the section strip is sticky only on phones, tracks the active section, and clears banners;
- multiple deliveries/dates/addresses show one card plus a next-card peek; single cards fill width;
- Instagram posts swipe horizontally and retain expansion, pagination, metrics, and safe links;
- all five Hub tabs, including Ideias, are selectable at 320px;
- Hub URL/actions reflow without clipped labels;
- tablet retains the top-bar/drawer layout with no client section strip;
- desktop floating section rail and card/table layouts are unchanged;
- light and dark themes, reduced motion, banner present/absent, and long email/URL data are readable.

- [ ] **Step 6: Run final diff/security checks**

Run: `git diff --check`

Expected: no whitespace errors.

Run:

```bash
rg -n "innerHTML|href=|permalink|caption" apps/crm/src/components/instagram/InstagramPostsTable.ts
```

Expected: captions still pass through `escapeHTML`, external links still pass through
`sanitizeUrl`, and no new unescaped user value is interpolated.

- [ ] **Step 7: Commit verification-only fixes if any were required**

If Step 5 required scoped corrections, stage only those corrections and commit:

```bash
git add apps/crm/src apps/crm/style.css
git commit -m "fix(mobile): resolve responsive QA regressions"
```

If no files changed during verification, do not create an empty commit.
