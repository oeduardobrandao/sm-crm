# Live Landing Plan Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the landing-page pricing cards load the current public plan name, price, order, client limit, and user limit from Admin only when the pricing section approaches the viewport.

**Architecture:** Add a narrow public-catalog query beside the existing billing service so the landing page does not fetch unrelated entitlements. The pricing component enables a TanStack Query from an `IntersectionObserver`, joins frontend-owned marketing copy by plan ID, and renders stable loading, success, empty, and retryable error states.

**Tech Stack:** React 19, TypeScript, TanStack Query, Supabase JS, Vitest, Testing Library, CSS.

## Global Constraints

- Do not add a Supabase request to the landing page's initial load.
- Request only `id`, `name`, `price_brl`, `price_brl_annual`, `sort_order`, `max_clients`, and `max_team_members` for active plans.
- Never offer the internal `lifetime` plan publicly.
- Show only `Clientes` and `Usuários` in the cards; do not show Templates, feature flags, storage, or rate limits.
- Treat `null` resource limits as `Ilimitado`.
- Keep audience descriptions, CTA labels/destinations, and the Pro recommendation in frontend metadata.
- Calculate annual savings from the catalog; do not hardcode 20%.
- Preserve the existing Portuguese UI and monthly/annual display convention.
- Follow test-first development, then run `npm run build` and `npm run test`.

---

## File Structure

- `apps/crm/src/services/billing.ts`: owns the minimal public pricing-plan type and Supabase query.
- `apps/crm/src/services/__tests__/billing.test.ts`: proves the query shape, ordering, internal-plan exclusion, and error propagation.
- `apps/crm/src/pages/landing/LandingPage.tsx`: owns deferred query activation, frontend marketing metadata, pricing calculations, and rendering.
- `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx`: proves deferred loading and all visible pricing behavior.
- `apps/crm/src/pages/landing/landing.css`: styles stable skeletons and the empty/error state in light and dark themes.

### Task 1: Minimal public pricing catalog query

**Files:**
- Modify: `apps/crm/src/services/billing.ts`
- Test: `apps/crm/src/services/__tests__/billing.test.ts`

**Interfaces:**
- Produces: `PublicPricingPlan` with fields `id`, `name`, `price_brl`, `price_brl_annual`, `sort_order`, `max_clients`, and `max_team_members`.
- Produces: `listPublicPricingPlans(): Promise<PublicPricingPlan[]>`.
- Filtering contract: active rows are requested in ascending `sort_order`; `lifetime` is removed before returning.

- [ ] **Step 1: Extend the Supabase mock and write failing service tests**

At the top of `apps/crm/src/services/__tests__/billing.test.ts`, replace the current Supabase mock and billing import with:

```ts
const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
    from,
  },
}));

import { supabase } from '../../lib/supabase';
import {
  listPublicPricingPlans,
  startCheckout,
  openBillingPortal,
} from '../billing';
```

Add `from.mockReset()` to the existing `beforeEach`, then add these tests:

```ts
it('lists only active public pricing fields in Admin order and hides Lifetime', async () => {
  const order = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'lifetime',
        name: 'Lifetime',
        price_brl: 0,
        price_brl_annual: 0,
        sort_order: -1,
        max_clients: null,
        max_team_members: null,
      },
      {
        id: 'start',
        name: 'Start',
        price_brl: 9990,
        price_brl_annual: 95900,
        sort_order: 1,
        max_clients: 5,
        max_team_members: 2,
      },
    ],
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  from.mockReturnValue({ select });

  await expect(listPublicPricingPlans()).resolves.toEqual([
    {
      id: 'start',
      name: 'Start',
      price_brl: 9990,
      price_brl_annual: 95900,
      sort_order: 1,
      max_clients: 5,
      max_team_members: 2,
    },
  ]);
  expect(from).toHaveBeenCalledWith('plans');
  expect(select).toHaveBeenCalledWith(
    'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members',
  );
  expect(eq).toHaveBeenCalledWith('is_active', true);
  expect(order).toHaveBeenCalledWith('sort_order', { ascending: true });
});

it('surfaces public pricing catalog errors', async () => {
  const order = vi.fn().mockResolvedValue({
    data: null,
    error: { message: 'catalog unavailable' },
  });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  from.mockReturnValue({ select });

  await expect(listPublicPricingPlans()).rejects.toThrow('catalog unavailable');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run apps/crm/src/services/__tests__/billing.test.ts
```

Expected: FAIL because `listPublicPricingPlans` is not exported.

- [ ] **Step 3: Add the minimal public pricing type and query**

Add after `BillingPlan` in `apps/crm/src/services/billing.ts`:

```ts
export interface PublicPricingPlan {
  id: string;
  name: string;
  price_brl: number | null;
  price_brl_annual: number | null;
  sort_order: number;
  max_clients: number | null;
  max_team_members: number | null;
}

const INTERNAL_PLAN_IDS = new Set(['lifetime']);
```

Add after `listActivePlans`:

```ts
export async function listPublicPricingPlans(): Promise<PublicPricingPlan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PublicPricingPlan[]).filter(
    (plan) => !INTERNAL_PLAN_IDS.has(plan.id),
  );
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run apps/crm/src/services/__tests__/billing.test.ts
```

Expected: all billing service tests PASS.

- [ ] **Step 5: Commit the catalog query**

```bash
git add apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts
git commit -m "feat: add public pricing plan query"
```

### Task 2: Deferred live cards and resilient pricing states

**Files:**
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx`
- Modify: `apps/crm/src/pages/landing/landing.css`
- Test: `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx`

**Interfaces:**
- Consumes: `listPublicPricingPlans(): Promise<PublicPricingPlan[]>` from Task 1.
- Produces: query key `['landing', 'pricing-plans']`, enabled only after the section intersects a `600px 0px` root margin.
- Produces: retry button text `Tentar novamente` and stable state container `.pricing-state`.

- [ ] **Step 1: Build the IntersectionObserver and plan-catalog test harness**

Update the landing test imports to include `act`, `waitFor`, `within`, `QueryClient`, and `QueryClientProvider`. Mock the service before importing the page:

```tsx
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PublicPricingPlan } from '@/services/billing';

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn(),
}));

import { listPublicPricingPlans } from '@/services/billing';
import LandingPage from '../LandingPage';
```

Add the catalog and observer harness after the auth mock:

```tsx
const PRICING_PLANS: PublicPricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price_brl: 0,
    price_brl_annual: 0,
    sort_order: 0,
    max_clients: 2,
    max_team_members: 1,
  },
  {
    id: 'start',
    name: 'Start',
    price_brl: 9990,
    price_brl_annual: 95900,
    sort_order: 1,
    max_clients: 5,
    max_team_members: 2,
  },
  {
    id: 'pro',
    name: 'Pro',
    price_brl: 13990,
    price_brl_annual: 134300,
    sort_order: 2,
    max_clients: 15,
    max_team_members: 5,
  },
  {
    id: 'max',
    name: 'Max',
    price_brl: 19990,
    price_brl_annual: 191900,
    sort_order: 3,
    max_clients: null,
    max_team_members: null,
  },
];

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    MockIntersectionObserver.instances.push(this);
  }
}

function triggerPricingIntersection() {
  const observer = MockIntersectionObserver.instances.find(
    (instance) => instance.options.rootMargin === '600px 0px',
  );
  const section = document.getElementById('pricing');
  if (!observer || !section) throw new Error('Pricing observer was not registered');
  act(() => {
    observer.callback(
      [{ isIntersecting: true, target: section } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  });
}
```

Replace `renderLandingPage` with a Query Client wrapper:

```tsx
function renderLandingPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
```

At the start of `beforeEach`, add:

```ts
MockIntersectionObserver.instances = [];
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
vi.mocked(listPublicPricingPlans).mockResolvedValue(PRICING_PLANS);
```

- [ ] **Step 2: Write failing deferred-loading and live-card tests**

Add these tests to `LandingPage.test.tsx`:

```tsx
it('defers the plan request until pricing approaches the viewport', async () => {
  renderLandingPage();

  expect(listPublicPricingPlans).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.plan-card-skeleton')).toHaveLength(4);

  triggerPricingIntersection();

  await waitFor(() => expect(listPublicPricingPlans).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('heading', { name: 'Start', level: 3 })).toBeInTheDocument();
});

it('renders Admin order, prices, and only client/user limits', async () => {
  renderLandingPage();
  triggerPricingIntersection();

  await screen.findByRole('heading', { name: 'Max', level: 3 });
  const names = Array.from(document.querySelectorAll('.plans-grid .plan-card h3')).map(
    (heading) => heading.textContent,
  );
  expect(names).toEqual(['Free', 'Start', 'Pro', 'Max']);

  const startCard = screen.getByRole('heading', { name: 'Start', level: 3 }).closest('.plan-card');
  expect(startCard).not.toBeNull();
  expect(within(startCard as HTMLElement).getByText('R$ 99,90')).toBeInTheDocument();
  expect(within(startCard as HTMLElement).getByText('5')).toBeInTheDocument();
  expect(within(startCard as HTMLElement).getByText('2')).toBeInTheDocument();

  const maxCard = screen.getByRole('heading', { name: 'Max', level: 3 }).closest('.plan-card');
  expect(maxCard).not.toBeNull();
  expect(within(maxCard as HTMLElement).getAllByText('Ilimitado')).toHaveLength(2);
  expect(screen.queryByText('Templates')).not.toBeInTheDocument();
  expect(screen.queryByText('Features')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Lifetime', level: 3 })).not.toBeInTheDocument();
});

it('uses annual catalog prices and derives the savings hint', async () => {
  renderLandingPage();
  triggerPricingIntersection();
  await screen.findByRole('heading', { name: 'Start', level: 3 });

  expect(screen.getByText('Economize até 20% no plano anual')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Anual' }));

  const startCard = screen.getByRole('heading', { name: 'Start', level: 3 }).closest('.plan-card');
  expect(startCard).not.toBeNull();
  expect(within(startCard as HTMLElement).getByText('R$ 79,92')).toBeInTheDocument();
  expect(
    within(startCard as HTMLElement).getByText('cobrado anualmente (R$ 959,00/ano)'),
  ).toBeInTheDocument();
});

it('shows a retryable error without stale plan values', async () => {
  vi.mocked(listPublicPricingPlans).mockRejectedValueOnce(new Error('offline'));
  renderLandingPage();
  triggerPricingIntersection();

  expect(await screen.findByText('Não foi possível carregar os planos agora.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Start', level: 3 })).not.toBeInTheDocument();

  vi.mocked(listPublicPricingPlans).mockResolvedValueOnce(PRICING_PLANS);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

  expect(await screen.findByRole('heading', { name: 'Start', level: 3 })).toBeInTheDocument();
});
```

In the existing navigation/CTA test, call `triggerPricingIntersection()` after `renderLandingPage()` and wait for `Start` before counting registration links:

```tsx
triggerPricingIntersection();
await screen.findByRole('heading', { name: 'Start', level: 3 });
```

Mark that existing test `async`.

- [ ] **Step 3: Run the landing test and verify RED**

Run:

```bash
npx vitest run apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
```

Expected: FAIL because the pricing component does not query the service, register the pricing observer, or render the new states.

- [ ] **Step 4: Add query imports, pricing metadata, and deferred activation**

In `LandingPage.tsx`, import TanStack Query and the new service:

```tsx
import { useQuery } from '@tanstack/react-query';
import {
  listPublicPricingPlans,
  type PublicPricingPlan,
} from '@/services/billing';
```

Add before `Pricing`:

```tsx
const PLAN_MARKETING: Record<
  string,
  { description: string; cta: string; highlight?: boolean }
> = {
  free: {
    description: 'Para conhecer a plataforma.',
    cta: 'Começar grátis',
  },
  start: {
    description: 'Para freelancers que estão começando.',
    cta: 'Assinar Start',
  },
  pro: {
    description: 'Para freelancers com carteira consolidada.',
    cta: 'Assinar Pro',
    highlight: true,
  },
  max: {
    description: 'Para micro-agências e equipes completas.',
    cta: 'Assinar Max',
  },
};

function displayLimit(limit: number | null): string {
  return limit == null ? 'Ilimitado' : String(limit);
}

function annualSavingsPct(plans: PublicPricingPlan[]): number {
  return plans.reduce((best, plan) => {
    if (!plan.price_brl || !plan.price_brl_annual) return best;
    const saving = Math.round((1 - plan.price_brl_annual / (plan.price_brl * 12)) * 100);
    return Math.max(best, saving);
  }, 0);
}
```

At the beginning of `Pricing`, add the observer state and query:

```tsx
const pricingRef = useRef<HTMLElement>(null);
const [shouldLoadPlans, setShouldLoadPlans] = useState(false);

useEffect(() => {
  const section = pricingRef.current;
  if (!section) return;
  if (typeof IntersectionObserver === 'undefined') {
    setShouldLoadPlans(true);
    return;
  }
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      setShouldLoadPlans(true);
      observer.disconnect();
    },
    { rootMargin: '600px 0px' },
  );
  observer.observe(section);
  return () => observer.disconnect();
}, []);

const {
  data: plans = [],
  isPending,
  isError,
  refetch,
} = useQuery({
  queryKey: ['landing', 'pricing-plans'],
  queryFn: listPublicPricingPlans,
  enabled: shouldLoadPlans,
  staleTime: 5 * 60_000,
});

const savingsPct = annualSavingsPct(plans);
```

Delete the hardcoded `plans` array. Add `ref={pricingRef}` to `<section id="pricing">`. Replace the fixed savings message with:

```tsx
{savingsPct > 0 && (
  <span className="pricing-save">Economize até {savingsPct}% no plano anual</span>
)}
```

- [ ] **Step 5: Replace the plan grid with loading, error, empty, and live cards**

Replace the contents of `.plans-grid` with:

```tsx
{!shouldLoadPlans || isPending ? (
  Array.from({ length: 4 }).map((_, index) => (
    <div key={index} className="plan-card plan-card-skeleton" aria-hidden="true">
      <span className="pricing-sk pricing-sk--name" />
      <span className="pricing-sk pricing-sk--price" />
      <span className="pricing-sk pricing-sk--description" />
      <span className="pricing-sk pricing-sk--line" />
      <span className="pricing-sk pricing-sk--line" />
      <span className="pricing-sk pricing-sk--button" />
    </div>
  ))
) : isError ? (
  <div className="pricing-state" role="alert">
    <p>Não foi possível carregar os planos agora.</p>
    <button type="button" className="lp-btn lp-btn-outline" onClick={() => refetch()}>
      Tentar novamente
    </button>
  </div>
) : plans.length === 0 ? (
  <div className="pricing-state">
    <p>Os planos estão temporariamente indisponíveis.</p>
  </div>
) : (
  plans.map((plan) => {
    const marketing = PLAN_MARKETING[plan.id] ?? {
      description: `Conheça o plano ${plan.name}.`,
      cta: `Assinar ${plan.name}`,
    };
    const amount = isYear
      ? plan.price_brl_annual == null
        ? plan.price_brl
        : plan.price_brl_annual / 12
      : plan.price_brl;
    return (
      <div key={plan.id} className={`plan-card${marketing.highlight ? ' highlight' : ''}`}>
        {marketing.highlight && <div className="plan-badge">Mais popular</div>}
        <h3>{plan.name}</h3>
        <div className="price-row">
          <span className="price">{amount == null ? 'Sob consulta' : formatPrice(amount)}</span>
          {amount != null && <span className="price-sub">/mês</span>}
        </div>
        <div className="price-annual-note">
          {isYear && plan.price_brl_annual != null && plan.price_brl_annual > 0
            ? `cobrado anualmente (${formatPrice(plan.price_brl_annual)}/ano)`
            : ' '}
        </div>
        <div className="plan-tag">{marketing.description}</div>
        <div className="plan-label">Limites</div>
        <ul className="plan-list plan-limits">
          <li>
            <span className="k">Clientes</span>
            <span className="v">{displayLimit(plan.max_clients)}</span>
          </li>
          <li>
            <span className="k">Usuários</span>
            <span className="v">{displayLimit(plan.max_team_members)}</span>
          </li>
        </ul>
        <div className="plan-cta">
          <a
            href={planHref(plan.id)}
            className={`lp-btn ${marketing.highlight ? 'lp-btn-primary' : 'lp-btn-outline'}`}
          >
            {plan.id === 'free' && user ? 'Acessar painel' : marketing.cta}
          </a>
        </div>
      </div>
    );
  })
)}
```

- [ ] **Step 6: Style stable loading and failure states**

Add after the existing `.plan-card` rules in `landing.css`:

```css
.plan-card-skeleton{min-height:360px;pointer-events:none;gap:14px}
.pricing-sk{display:block;border-radius:7px;background:linear-gradient(90deg,#eef0f3 25%,#f7f8fa 50%,#eef0f3 75%);background-size:200% 100%;animation:pricing-shimmer 1.3s ease-in-out infinite}
.pricing-sk--name{width:38%;height:22px}
.pricing-sk--price{width:66%;height:34px;margin-top:6px}
.pricing-sk--description{width:88%;height:32px;margin-top:8px}
.pricing-sk--line{width:100%;height:16px}
.pricing-sk--button{width:100%;height:44px;margin-top:auto}
.pricing-state{grid-column:1/-1;min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;color:#4b5563;border:1px solid rgba(30,36,48,.08);border-radius:16px;background:#fff;padding:32px}
.pricing-state .lp-btn{width:auto}
@keyframes pricing-shimmer{to{background-position:-200% 0}}
```

Add to the dark pricing section:

```css
[data-theme='dark'] .pricing-sk{background:linear-gradient(90deg,#1a1e26 25%,#242a34 50%,#1a1e26 75%);background-size:200% 100%}
[data-theme='dark'] .pricing-state{color:#94a3b8;background:#12151a;border-color:rgba(255,255,255,.08)}
```

- [ ] **Step 7: Run the focused landing test and verify GREEN**

Run:

```bash
npx vitest run apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
```

Expected: all landing tests PASS with no unhandled query errors.

- [ ] **Step 8: Commit the deferred live cards**

```bash
git add apps/crm/src/pages/landing/LandingPage.tsx apps/crm/src/pages/landing/landing.css apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
git commit -m "feat: sync landing plan cards with Admin"
```

### Task 3: Repository verification

**Files:**
- Inspect only; modify a task-owned file only if verification exposes a regression caused by Tasks 1 or 2.

**Interfaces:**
- Consumes: completed public catalog query and deferred pricing component.
- Produces: typechecked CRM build and green full Vitest suite.

- [ ] **Step 1: Run both focused test files together**

```bash
npx vitest run apps/crm/src/services/__tests__/billing.test.ts apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
```

Expected: both files PASS.

- [ ] **Step 2: Typecheck and build the CRM**

```bash
npm run build
```

Expected: TypeScript and Vite complete successfully.

- [ ] **Step 3: Run the complete regression suite**

```bash
npm run test
```

Expected: all Vitest test files PASS.

- [ ] **Step 4: Check the final diff for scope and whitespace errors**

```bash
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors; only the pre-existing untracked `AGENTS.md` and `spike/` remain outside the committed work.

