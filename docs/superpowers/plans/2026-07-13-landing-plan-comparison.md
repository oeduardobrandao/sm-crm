# Landing Plan Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deferred, Admin-backed plan comparison matrix below the landing-page pricing cards without adding a second request or putting features back inside the cards.

**Architecture:** Extend the existing `PublicPricingPlan` projection with the 11 approved comparison fields, then pass the same TanStack Query result to a focused `PlanComparison` presentation component. The component owns semantic table markup and value formatting; `Pricing` continues to own deferred loading, authentication-aware URLs, loading/error states, and plan marketing labels.

**Tech Stack:** React 19, TypeScript, TanStack Query, Supabase JS, Vitest, Testing Library, CSS.

## Global Constraints

- Pricing cards must continue to show only Clients and Users.
- The matrix must contain exactly four capacity rows and seven feature rows from the approved design.
- Use the existing deferred public plan request; do not add a second request.
- Keep filtering inactive plans and the internal `lifetime` plan.
- Render limits from Admin; display null numeric limits as `Ilimitado`.
- Use a semantic table and an accessible, keyboard-scrollable mobile comparison region.
- On mobile, keep the resource-label column sticky and horizontally scroll plan columns.
- Do not add dependencies.
- Run `npm run build`, `npm run test`, and `npm run format:check` after code changes.

---

## File Structure

- Modify `apps/crm/src/services/billing.ts`: expand the public plan type and the existing compact Supabase projection.
- Modify `apps/crm/src/services/__tests__/billing.test.ts`: lock down the expanded projection, data passthrough, ordering, and Lifetime filtering.
- Create `apps/crm/src/pages/landing/PlanComparison.tsx`: define curated rows, format values, and render the accessible matrix.
- Create `apps/crm/src/pages/landing/__tests__/PlanComparison.test.tsx`: unit-test formatting, availability states, plan order, actions, and accessibility.
- Modify `apps/crm/src/pages/landing/LandingPage.tsx`: reuse the successful pricing result and existing action rules to render the matrix.
- Modify `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx`: expand fixtures and verify deferred integration plus loading/error/empty behavior.
- Modify `apps/crm/src/pages/landing/landing.css`: style desktop, sticky mobile behavior, Pro highlighting, dark mode, focus, and reduced motion.

---

### Task 1: Expand the Public Plan Projection

**Files:**
- Modify: `apps/crm/src/services/billing.ts:20-70`
- Test: `apps/crm/src/services/__tests__/billing.test.ts:20-76`

**Interfaces:**
- Consumes: public `plans` rows allowed by existing Supabase RLS.
- Produces: `PublicPricingPlan` with card fields plus `max_workflow_templates`, `max_instagram_accounts`, `max_hub_tokens`, `storage_quota_bytes`, `feature_analytics_reports`, `feature_post_scheduling`, `feature_leads`, `feature_financial`, `feature_contracts`, `feature_brand_customization`, and `feature_mcp`.

- [ ] **Step 1: Expand the service test fixture and expected projection**

Replace the first billing-service test with this complete expectation:

```ts
it('lists only active public pricing fields in Admin order and hides Lifetime', async () => {
  const lifetime = {
    id: 'lifetime',
    name: 'Lifetime',
    price_brl: 0,
    price_brl_annual: 0,
    sort_order: -1,
    max_clients: null,
    max_team_members: null,
    max_workflow_templates: null,
    max_instagram_accounts: null,
    max_hub_tokens: null,
    storage_quota_bytes: null,
    feature_analytics_reports: true,
    feature_post_scheduling: true,
    feature_leads: true,
    feature_financial: true,
    feature_contracts: true,
    feature_brand_customization: true,
    feature_mcp: true,
  };
  const start = {
    id: 'start',
    name: 'Start',
    price_brl: 9990,
    price_brl_annual: 95900,
    sort_order: 1,
    max_clients: 5,
    max_team_members: 2,
    max_workflow_templates: 3,
    max_instagram_accounts: 5,
    max_hub_tokens: 5,
    storage_quota_bytes: 5 * 1024 ** 3,
    feature_analytics_reports: true,
    feature_post_scheduling: true,
    feature_leads: true,
    feature_financial: true,
    feature_contracts: true,
    feature_brand_customization: true,
    feature_mcp: true,
  };
  const order = vi.fn().mockResolvedValue({ data: [lifetime, start], error: null });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  from.mockReturnValue({ select });

  await expect(listPublicPricingPlans()).resolves.toEqual([start]);
  expect(from).toHaveBeenCalledWith('plans');
  expect(select).toHaveBeenCalledWith(
    'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, max_workflow_templates, max_instagram_accounts, max_hub_tokens, storage_quota_bytes, feature_analytics_reports, feature_post_scheduling, feature_leads, feature_financial, feature_contracts, feature_brand_customization, feature_mcp',
  );
  expect(eq).toHaveBeenCalledWith('is_active', true);
  expect(order).toHaveBeenCalledWith('sort_order', { ascending: true });
});
```

- [ ] **Step 2: Run the service test and verify the projection assertion fails**

Run:

```bash
npm run test -- apps/crm/src/services/__tests__/billing.test.ts
```

Expected: FAIL because `select` still receives the shorter card-only projection.

- [ ] **Step 3: Expand `PublicPricingPlan` and the existing Supabase select**

Replace the public interface and query with:

```ts
export interface PublicPricingPlan {
  id: string;
  name: string;
  price_brl: number | null;
  price_brl_annual: number | null;
  sort_order: number;
  max_clients: number | null;
  max_team_members: number | null;
  max_workflow_templates: number | null;
  max_instagram_accounts: number | null;
  max_hub_tokens: number | null;
  storage_quota_bytes: number | null;
  feature_analytics_reports: boolean;
  feature_post_scheduling: boolean;
  feature_leads: boolean;
  feature_financial: boolean;
  feature_contracts: boolean;
  feature_brand_customization: boolean;
  feature_mcp: boolean;
}

export async function listPublicPricingPlans(): Promise<PublicPricingPlan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, max_workflow_templates, max_instagram_accounts, max_hub_tokens, storage_quota_bytes, feature_analytics_reports, feature_post_scheduling, feature_leads, feature_financial, feature_contracts, feature_brand_customization, feature_mcp',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PublicPricingPlan[]).filter(
    (plan) => !INTERNAL_PLAN_IDS.has(plan.id),
  );
}
```

- [ ] **Step 4: Run the service test and verify it passes**

Run:

```bash
npm run test -- apps/crm/src/services/__tests__/billing.test.ts
```

Expected: all billing-service tests PASS.

- [ ] **Step 5: Commit the projection change**

```bash
git add apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts
git commit -m "feat: expose public plan comparison fields"
```

---

### Task 2: Build the Accessible Comparison Component

**Files:**
- Create: `apps/crm/src/pages/landing/PlanComparison.tsx`
- Create: `apps/crm/src/pages/landing/__tests__/PlanComparison.test.tsx`

**Interfaces:**
- Consumes: `plans: PublicPricingPlan[]` and `actionFor(plan): { href: string; label: string; primary?: boolean }`.
- Produces: a semantic comparison section containing the approved capacity and feature rows, localized values, accessible availability text, and one action per plan.

- [ ] **Step 1: Write the component tests before the component exists**

Create `apps/crm/src/pages/landing/__tests__/PlanComparison.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicPricingPlan } from '@/services/billing';
import PlanComparison from '../PlanComparison';

const FREE: PublicPricingPlan = {
  id: 'free',
  name: 'Free',
  price_brl: 0,
  price_brl_annual: 0,
  sort_order: 0,
  max_clients: 2,
  max_team_members: 1,
  max_workflow_templates: 1,
  max_instagram_accounts: 1,
  max_hub_tokens: 0,
  storage_quota_bytes: 100 * 1024 ** 2,
  feature_analytics_reports: false,
  feature_post_scheduling: false,
  feature_leads: false,
  feature_financial: false,
  feature_contracts: false,
  feature_brand_customization: false,
  feature_mcp: false,
};

const PRO: PublicPricingPlan = {
  ...FREE,
  id: 'pro',
  name: 'Pro',
  price_brl: 13990,
  price_brl_annual: 134300,
  sort_order: 2,
  max_workflow_templates: null,
  max_instagram_accounts: 15,
  max_hub_tokens: 15,
  storage_quota_bytes: 10 * 1024 ** 3,
  feature_analytics_reports: true,
  feature_post_scheduling: true,
  feature_leads: true,
  feature_financial: true,
  feature_contracts: true,
  feature_brand_customization: true,
  feature_mcp: true,
};

const actionFor = (plan: PublicPricingPlan) => ({
  href: `/assinar/${plan.id}`,
  label: plan.id === 'free' ? 'Começar grátis' : `Assinar ${plan.name}`,
  primary: plan.id === 'pro',
});

describe('PlanComparison', () => {
  it('renders plans in input order and formats capacity values', () => {
    render(<PlanComparison plans={[FREE, PRO]} actionFor={actionFor} />);

    const table = screen.getByRole('table', { name: 'Comparação detalhada dos planos' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Recurso',
      'Free',
      'Pro',
    ]);
    expect(screen.getByRole('row', { name: /Contas do Instagram/ })).toHaveTextContent('115');
    expect(screen.getByRole('row', { name: /Armazenamento/ })).toHaveTextContent('100 MB10 GB');
    expect(screen.getByRole('row', { name: /Templates de fluxo/ })).toHaveTextContent(
      '1Ilimitado',
    );
    expect(screen.getByRole('row', { name: /Portais do cliente/ })).toHaveTextContent('015');
  });

  it('exposes feature availability, actions, scroll semantics, and Pro emphasis', () => {
    render(<PlanComparison plans={[FREE, PRO]} actionFor={actionFor} />);

    const analytics = screen.getByRole('row', { name: /Relatórios e analytics/ });
    expect(within(analytics).getByText('Não incluído')).toBeInTheDocument();
    expect(within(analytics).getByText('Incluído')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tabela comparativa de planos' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(screen.getByRole('link', { name: 'Começar grátis' })).toHaveAttribute(
      'href',
      '/assinar/free',
    );
    expect(screen.getByRole('link', { name: 'Assinar Pro' })).toHaveClass('lp-btn-primary');
    expect(screen.getByRole('columnheader', { name: 'Pro' })).toHaveClass(
      'plan-comparison-cell--highlight',
    );
  });
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
npm run test -- apps/crm/src/pages/landing/__tests__/PlanComparison.test.tsx
```

Expected: FAIL because `../PlanComparison` does not exist.

- [ ] **Step 3: Implement the focused presentation component**

Create `apps/crm/src/pages/landing/PlanComparison.tsx`:

```tsx
import type { PublicPricingPlan } from '@/services/billing';

type CapacityKey =
  | 'max_instagram_accounts'
  | 'storage_quota_bytes'
  | 'max_workflow_templates'
  | 'max_hub_tokens';

type FeatureKey =
  | 'feature_analytics_reports'
  | 'feature_post_scheduling'
  | 'feature_leads'
  | 'feature_financial'
  | 'feature_contracts'
  | 'feature_brand_customization'
  | 'feature_mcp';

export interface PlanComparisonAction {
  href: string;
  label: string;
  primary?: boolean;
}

interface PlanComparisonProps {
  plans: PublicPricingPlan[];
  actionFor: (plan: PublicPricingPlan) => PlanComparisonAction;
}

const CAPACITY_ROWS: ReadonlyArray<{ key: CapacityKey; label: string }> = [
  { key: 'max_instagram_accounts', label: 'Contas do Instagram' },
  { key: 'storage_quota_bytes', label: 'Armazenamento' },
  { key: 'max_workflow_templates', label: 'Templates de fluxo' },
  { key: 'max_hub_tokens', label: 'Portais do cliente' },
];

const FEATURE_ROWS: ReadonlyArray<{ key: FeatureKey; label: string }> = [
  { key: 'feature_analytics_reports', label: 'Relatórios e analytics' },
  { key: 'feature_post_scheduling', label: 'Agendamento de posts' },
  { key: 'feature_leads', label: 'Leads' },
  { key: 'feature_financial', label: 'Financeiro' },
  { key: 'feature_contracts', label: 'Contratos' },
  { key: 'feature_brand_customization', label: 'Personalização de marca' },
  { key: 'feature_mcp', label: 'Integração com Claude (MCP)' },
];

function cellClass(plan: PublicPricingPlan): string {
  return `plan-comparison-cell${plan.id === 'pro' ? ' plan-comparison-cell--highlight' : ''}`;
}

function formatStorage(bytes: number | null): string {
  if (bytes == null) return 'Ilimitado';
  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) {
    return `${gigabytes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2).toLocaleString('pt-BR')} MB`;
}

function formatCapacity(plan: PublicPricingPlan, key: CapacityKey): string {
  if (key === 'storage_quota_bytes') return formatStorage(plan[key]);
  return plan[key] == null ? 'Ilimitado' : String(plan[key]);
}

function FeatureValue({ included }: { included: boolean }) {
  return (
    <>
      <span className={included ? 'plan-comparison-check' : 'plan-comparison-empty'} aria-hidden>
        {included ? '✓' : '—'}
      </span>
      <span className="plan-comparison-sr-only">
        {included ? 'Incluído' : 'Não incluído'}
      </span>
    </>
  );
}

export default function PlanComparison({ plans, actionFor }: PlanComparisonProps) {
  return (
    <section className="plan-comparison" aria-labelledby="plan-comparison-title">
      <div className="plan-comparison-heading">
        <h3 id="plan-comparison-title">Compare os planos</h3>
        <p>Confira os limites e recursos atuais de cada opção.</p>
      </div>
      <p className="plan-comparison-swipe-hint" aria-hidden>
        Deslize para comparar →
      </p>
      <div
        className="plan-comparison-scroll"
        role="region"
        aria-label="Tabela comparativa de planos"
        tabIndex={0}
      >
        <table className="plan-comparison-table">
          <caption className="plan-comparison-sr-only">
            Comparação detalhada dos planos
          </caption>
          <thead>
            <tr>
              <th scope="col">Recurso</th>
              {plans.map((plan) => (
                <th key={plan.id} scope="col" className={cellClass(plan)}>
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="plan-comparison-group">
              <th scope="rowgroup" colSpan={plans.length + 1}>
                Capacidade
              </th>
            </tr>
            {CAPACITY_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {plans.map((plan) => (
                  <td key={plan.id} className={cellClass(plan)}>
                    {formatCapacity(plan, row.key)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="plan-comparison-group">
              <th scope="rowgroup" colSpan={plans.length + 1}>
                Recursos
              </th>
            </tr>
            {FEATURE_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {plans.map((plan) => (
                  <td key={plan.id} className={cellClass(plan)}>
                    <FeatureValue included={plan[row.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Escolha seu plano</th>
              {plans.map((plan) => {
                const action = actionFor(plan);
                return (
                  <td key={plan.id} className={cellClass(plan)}>
                    <a
                      href={action.href}
                      className={`lp-btn ${action.primary ? 'lp-btn-primary' : 'lp-btn-outline'}`}
                    >
                      {action.label}
                    </a>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the component test and verify it passes**

Run:

```bash
npm run test -- apps/crm/src/pages/landing/__tests__/PlanComparison.test.tsx
```

Expected: both `PlanComparison` tests PASS.

- [ ] **Step 5: Commit the component and its tests**

```bash
git add apps/crm/src/pages/landing/PlanComparison.tsx apps/crm/src/pages/landing/__tests__/PlanComparison.test.tsx
git commit -m "feat: add accessible plan comparison matrix"
```

---

### Task 3: Integrate, Style, and Verify the Matrix

**Files:**
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx:1-36,594-790`
- Modify: `apps/crm/src/pages/landing/landing.css:309-380,519-545`
- Test: `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx:8-61,160-360`

**Interfaces:**
- Consumes: `PlanComparison` and the same `plans` array already returned by `listPublicPricingPlans`.
- Produces: a comparison section only in the successful non-empty pricing state; no request, cache, or loading-state changes.

- [ ] **Step 1: Expand landing fixtures and write failing integration assertions**

Replace `PRICING_PLANS` with the complete typed fixture:

```ts
const PAID_FEATURES = {
  feature_analytics_reports: true,
  feature_post_scheduling: true,
  feature_leads: true,
  feature_financial: true,
  feature_contracts: true,
  feature_brand_customization: true,
  feature_mcp: true,
} as const;

const PRICING_PLANS: PublicPricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price_brl: 0,
    price_brl_annual: 0,
    sort_order: 0,
    max_clients: 2,
    max_team_members: 1,
    max_workflow_templates: 1,
    max_instagram_accounts: 1,
    max_hub_tokens: 0,
    storage_quota_bytes: 100 * 1024 ** 2,
    feature_analytics_reports: false,
    feature_post_scheduling: false,
    feature_leads: false,
    feature_financial: false,
    feature_contracts: false,
    feature_brand_customization: false,
    feature_mcp: false,
  },
  {
    id: 'start',
    name: 'Start',
    price_brl: 9990,
    price_brl_annual: 95900,
    sort_order: 1,
    max_clients: 5,
    max_team_members: 2,
    max_workflow_templates: 3,
    max_instagram_accounts: 5,
    max_hub_tokens: 5,
    storage_quota_bytes: 5 * 1024 ** 3,
    ...PAID_FEATURES,
  },
  {
    id: 'pro',
    name: 'Pro',
    price_brl: 13990,
    price_brl_annual: 134300,
    sort_order: 2,
    max_clients: 15,
    max_team_members: 5,
    max_workflow_templates: null,
    max_instagram_accounts: 15,
    max_hub_tokens: 15,
    storage_quota_bytes: 10 * 1024 ** 3,
    ...PAID_FEATURES,
  },
  {
    id: 'max',
    name: 'Max',
    price_brl: 19990,
    price_brl_annual: 191900,
    sort_order: 3,
    max_clients: null,
    max_team_members: null,
    max_workflow_templates: null,
    max_instagram_accounts: null,
    max_hub_tokens: null,
    storage_quota_bytes: 25 * 1024 ** 3,
    ...PAID_FEATURES,
  },
];
```

Replace the Enterprise object in the unknown-plan test with a type-complete fixture:

```ts
{
  id: 'enterprise',
  name: 'Enterprise',
  price_brl: null,
  price_brl_annual: null,
  sort_order: 9,
  max_clients: null,
  max_team_members: null,
  max_workflow_templates: null,
  max_instagram_accounts: null,
  max_hub_tokens: null,
  storage_quota_bytes: null,
  ...PAID_FEATURES,
}
```

Add this success-state test:

```tsx
it('renders the comparison from the same successful deferred plan result', async () => {
  renderLandingPage();

  expect(screen.queryByRole('heading', { name: 'Compare os planos' })).not.toBeInTheDocument();
  triggerPricingIntersection();

  expect(
    await screen.findByRole('table', { name: 'Comparação detalhada dos planos' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Contas do Instagram/ })).toHaveTextContent(
    '1515Ilimitado',
  );
  expect(screen.getByRole('row', { name: /Armazenamento/ })).toHaveTextContent(
    '100 MB5 GB10 GB25 GB',
  );
});
```

In the existing empty and error tests, add:

```tsx
expect(screen.queryByRole('heading', { name: 'Compare os planos' })).not.toBeInTheDocument();
```

In the auth CTA test, update the comment and expected registration-link count from `9` to `13`, accounting for the four comparison actions.

- [ ] **Step 2: Run the landing test and verify integration assertions fail**

Run:

```bash
npm run test -- apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
```

Expected: FAIL because the comparison table and its four actions are not rendered yet.

- [ ] **Step 3: Integrate `PlanComparison` with the existing successful query state**

Add the import:

```tsx
import PlanComparison from './PlanComparison';
```

Inside `Pricing`, add an action adapter next to `planHref`:

```tsx
const planAction = (plan: PublicPricingPlan) => {
  const marketing = PLAN_MARKETING[plan.id] ?? {
    description: `Conheça o plano ${plan.name}.`,
    cta: `Assinar ${plan.name}`,
  };
  return {
    href: planHref(plan.id),
    label: plan.id === 'free' && user ? 'Acessar painel' : marketing.cta,
    primary: marketing.highlight,
  };
};
```

Immediately after `.plans-grid`, still inside `.lp-container`, render:

```tsx
{!isLoadingPlans && !isError && plans.length > 0 && (
  <PlanComparison plans={plans} actionFor={planAction} />
)}
```

Do not add `reveal` to the asynchronously rendered component because the page-level reveal observer registers before the query result appears.

- [ ] **Step 4: Add complete responsive and dark-mode styles**

Add after the existing pricing styles in `landing.css`:

```css
.plan-comparison{margin-top:72px}
.plan-comparison-heading{text-align:center;margin-bottom:28px}
.plan-comparison-heading h3{font-size:clamp(1.55rem,3vw,2.1rem);font-weight:800;letter-spacing:-.03em;color:#12151a}
.plan-comparison-heading p{margin-top:8px;color:#6b7280;font-size:.95rem}
.plan-comparison-swipe-hint{display:none;margin:0 0 10px;color:#6b7280;font-size:.76rem;font-weight:600;text-align:right}
.plan-comparison-scroll{overflow-x:auto;border:1px solid rgba(30,36,48,.09);border-radius:16px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04);scrollbar-gutter:stable}
.plan-comparison-scroll:focus-visible{outline:3px solid rgba(255,191,48,.55);outline-offset:3px}
.plan-comparison-table{width:100%;min-width:780px;border-collapse:separate;border-spacing:0;color:#374151;font-size:.86rem}
.plan-comparison-table th,.plan-comparison-table td{padding:15px 14px;border-top:1px solid rgba(30,36,48,.07);text-align:center;vertical-align:middle}
.plan-comparison-table thead th{position:sticky;top:0;z-index:3;border-top:0;background:#f8fafc;color:#12151a;font-size:.9rem;font-weight:800}
.plan-comparison-table th:first-child{position:sticky;left:0;z-index:2;width:220px;min-width:220px;background:#fff;text-align:left}
.plan-comparison-table thead th:first-child{z-index:4;background:#f8fafc}
.plan-comparison-table tbody th{font-weight:600;color:#4b5563}
.plan-comparison-group th{position:static!important;padding:10px 14px;background:#eef2f6!important;color:#6b7280!important;font-size:.68rem;font-weight:800!important;letter-spacing:.1em;text-transform:uppercase}
.plan-comparison-cell--highlight{background:rgba(255,191,48,.07)!important}
.plan-comparison-check{color:#15a35b;font-size:1.05rem;font-weight:900}
.plan-comparison-empty{color:#9ca3af;font-size:1.05rem}
.plan-comparison-table tfoot th,.plan-comparison-table tfoot td{padding-top:18px;padding-bottom:18px;background:#f8fafc}
.plan-comparison-table tfoot th:first-child{background:#f8fafc}
.plan-comparison-table tfoot .lp-btn{width:100%;justify-content:center;padding:10px 12px;font-size:.8rem}
.plan-comparison-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:720px){
  .plan-comparison{margin-top:56px}
  .plan-comparison-heading{text-align:left;margin-bottom:18px}
  .plan-comparison-swipe-hint{display:block}
  .plan-comparison-table{min-width:760px}
  .plan-comparison-table th:first-child{width:168px;min-width:168px}
}
@media(prefers-reduced-motion:reduce){.plan-comparison-scroll{scroll-behavior:auto}}
```

Add to the dark-mode pricing block:

```css
[data-theme='dark'] .plan-comparison-heading h3{color:#e8eaf0}
[data-theme='dark'] .plan-comparison-heading p,[data-theme='dark'] .plan-comparison-swipe-hint{color:#94a3b8}
[data-theme='dark'] .plan-comparison-scroll{background:#12151a;border-color:rgba(255,255,255,.08);box-shadow:0 1px 2px rgba(0,0,0,.2)}
[data-theme='dark'] .plan-comparison-table{color:#94a3b8}
[data-theme='dark'] .plan-comparison-table th,[data-theme='dark'] .plan-comparison-table td{border-top-color:rgba(255,255,255,.07)}
[data-theme='dark'] .plan-comparison-table thead th,[data-theme='dark'] .plan-comparison-table tfoot th,[data-theme='dark'] .plan-comparison-table tfoot td{background:#1a1e26;color:#e8eaf0}
[data-theme='dark'] .plan-comparison-table th:first-child{background:#12151a;color:#cbd5e1}
[data-theme='dark'] .plan-comparison-table thead th:first-child,[data-theme='dark'] .plan-comparison-table tfoot th:first-child{background:#1a1e26}
[data-theme='dark'] .plan-comparison-group th{background:#202632!important;color:#94a3b8!important}
[data-theme='dark'] .plan-comparison-cell--highlight{background:rgba(255,191,48,.08)!important}
```

- [ ] **Step 5: Run targeted tests and format changed source files**

Run:

```bash
npm run test -- apps/crm/src/services/__tests__/billing.test.ts apps/crm/src/pages/landing/__tests__/PlanComparison.test.tsx apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
npx prettier --write apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts apps/crm/src/pages/landing/PlanComparison.tsx apps/crm/src/pages/landing/LandingPage.tsx apps/crm/src/pages/landing/__tests__/PlanComparison.test.tsx apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
```

Expected: targeted tests PASS; Prettier reports the listed TypeScript/TSX files formatted. CSS is intentionally not part of the repository's Prettier script.

- [ ] **Step 6: Run the required full verification**

Run each command separately:

```bash
npm run build
npm run test
npm run format:check
git diff --check
```

Expected: TypeScript and Vite build PASS, the full Vitest suite PASS, Prettier reports all matched files formatted, and `git diff --check` prints no errors.

- [ ] **Step 7: Perform responsive visual verification**

Run:

```bash
npm run dev
```

Open `http://localhost:5173/#pricing` and verify at approximately 1440 px and 390 px widths:

- the cards still contain only Clients and Users;
- the matrix appears immediately below successful cards;
- all four plan columns align on desktop;
- Pro uses the subtle amber treatment;
- the 390 px view horizontally scrolls while the resource column remains visible;
- keyboard focus on the scroll region is visible;
- light and dark themes remain readable;
- no new browser console errors appear.

Stop the development server after verification.

- [ ] **Step 8: Commit the integrated feature**

```bash
git add apps/crm/src/pages/landing/LandingPage.tsx apps/crm/src/pages/landing/landing.css apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
git commit -m "feat: compare plan features below pricing cards"
```

The working tree must be clean after the commit.
