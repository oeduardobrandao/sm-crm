# Admin Portal Revamp, Fase 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin app the CRM's shadcn primitives (copied), a Workspaces list with server-side filters/sorting, URL-backed state, column prefs and proper states, an "Atenção" at-risk card on the Dashboard, and Portuguese copy throughout.

**Architecture:** Primitives are copied from `apps/crm/src/components/ui/` into `apps/admin/src/components/ui/` (relative `cn` import; Badge rewritten on Tailwind tokens). Filtering and sorting move into the `admin_list_workspaces` RPC (one migration), passed through by the `platform-admin` edge function. The Workspaces page is decomposed into pure modules (URL params, column prefs, pagination window) plus small presentational components composed by the page. The Dashboard gains a pure `dashboard-risk.ts` module and a `RiskCard` component.

**Tech Stack:** React 19, React Router v7 (`useSearchParams`), TanStack Query v5, Radix UI + Tailwind (shadcn), Vitest + Testing Library (jsdom), Deno tests for the edge function, Postgres SQL function.

**Spec:** `docs/superpowers/specs/2026-09-04-admin-portal-revamp-phase1-design.md`

## Global Constraints

- Branch: `feat/admin-portal-revamp-phase1` (cut from `origin/main` at `1878f3f4`). Work only in this worktree: `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/notification-center-960dfc`.
- Admin keeps its own palette (`apps/admin/src/globals.css`) and liquid glass. Do NOT import `apps/crm/style.css` into the admin.
- Copied primitives import `cn` via the relative path `'../../lib/utils'`, never `'@/lib/utils'` (Vitest aliases `@` to `apps/crm/src`).
- No new npm dependencies. All Radix packages needed are already in the root `package.json`.
- All admin UI copy in Portuguese. Product terms stay: Dashboard, Workspaces, Admins, Banners, Popups, Stripe, MRR, CSV, overrides. No em-dashes in user-facing copy (use ".", ":" or "·").
- Icons: `lucide-react` only. Toasts: `toast()` from `sonner`.
- Migration file must have a unique version prefix above `origin/main`'s tail. Re-check with `git ls-tree --name-only origin/main:supabase/migrations | tail -3` right before opening the PR and renumber if needed. Current tail: `20260907000020`.
- Edge functions run on Deno: `npm:` specifiers and relative `.ts` imports only.
- Commit after every task. Commit message trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Test commands: `npx vitest run <path>` for Vitest; `npm run test:functions` for Deno (note: it dirties `deno.lock`, run `git checkout deno.lock` afterwards); typecheck with `npx tsc -p apps/admin/tsconfig.json --noEmit`.
- Reference files to read before touching them: `apps/admin/src/pages/WorkspacesPage.tsx`, `apps/admin/src/pages/DashboardPage.tsx`, `apps/admin/src/lib/api.ts`, `apps/admin/src/lib/subscription.ts`, `apps/admin/src/pages/workspace-activity.ts`, `supabase/migrations/20260825000010_admin_list_workspaces_deterministic_owner.sql`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/admin/src/components/ui/{button,input,select,table,dropdown-menu,checkbox,skeleton,tabs,label,separator}.tsx` | Copied shadcn primitives (Task 1) |
| `apps/admin/src/components/ui/badge.tsx` | Badge rewritten on admin tokens (Task 1) |
| `apps/admin/src/components/ui/card.tsx` | Card, CardHeader, CardTitle, CardContent (Task 1) |
| `apps/admin/src/components/EmptyState.tsx`, `ErrorState.tsx`, `PageHeader.tsx` | Composition components (Task 2) |
| `apps/admin/src/lib/subscription.ts` | + `WorkspaceStatusGroup`, `statusGroup()`, labels; `SubscriptionSummary` gains two fields (Task 3) |
| `supabase/migrations/20260907000030_admin_list_workspaces_filters_sort.sql` | RPC v5 (Task 4) |
| `supabase/functions/platform-admin/list-workspaces.ts` | Pass-through of new params (Task 5) |
| `supabase/tests/entitlements/70..73_admin_list_workspaces_*.sql` | CI-gated psql suites for the RPC (Task 6) |
| `apps/admin/src/lib/api.ts` | `ListWorkspacesParams`, sort/activity types (Task 7) |
| `apps/admin/src/pages/workspaces-params.ts` | URL param parse/serialize/request mapping, labels, `nextSort` (Task 7) |
| `apps/admin/src/hooks/useWorkspacesParams.ts` | `useSearchParams` wrapper (Task 8) |
| `apps/admin/src/pages/workspaces-columns.ts` | Column registry + localStorage prefs (Task 9) |
| `apps/admin/src/pages/workspaces-pagination.ts` | `pageWindow()` (Task 10) |
| `apps/admin/src/pages/workspaces/WorkspacesTable.tsx`, `WorkspacesPagination.tsx` | Table + footer (Task 10) |
| `apps/admin/src/pages/workspaces/WorkspacesToolbar.tsx`, `WorkspacesFilterChips.tsx` | Toolbar + chips (Task 11) |
| `apps/admin/src/pages/WorkspacesPage.tsx` | Composition (Task 12) |
| `apps/admin/src/pages/dashboard-risk.ts` | Pure at-risk selectors/labels (Task 13) |
| `apps/admin/src/pages/dashboard/RiskCard.tsx`, `DashboardPage.tsx` | Card + KPI + translation (Task 14) |
| Remaining pages, `AdminLayout.tsx`, export column labels | Portuguese pass (Task 15) |
| `DESIGN_SYSTEM.md` | Note on copied primitives; final verification (Task 16) |

---

### Task 1: Copy the primitives and write Badge + Card

**Files:**
- Create: `apps/admin/src/components/ui/{button,input,select,table,dropdown-menu,checkbox,skeleton,tabs,label,separator}.tsx` (copies)
- Create: `apps/admin/src/components/ui/badge.tsx`, `apps/admin/src/components/ui/card.tsx`
- Test: `apps/admin/src/components/ui/__tests__/primitives.test.tsx`

**Interfaces:**
- Produces: `Button` (`variant`: default | ink | destructive | outline | secondary | ghost | link; `size`: default | sm | lg | icon), `Input`, `Select*`, `Table*`, `DropdownMenu*`, `Checkbox`, `Skeleton`, `Tabs*`, `Label`, `Separator`, `Badge` (`variant`: neutral | success | warning | danger | info | primary | outline; `tone`: soft | solid; `size`: sm | md | lg), `Card`, `CardHeader`, `CardTitle`, `CardContent`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/components/ui/__tests__/primitives.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../badge';
import { Button } from '../button';
import { Card, CardContent, CardHeader, CardTitle } from '../card';
import { Skeleton } from '../skeleton';

describe('admin primitives', () => {
  it('Badge maps variants to admin token classes', () => {
    render(<Badge variant="warning">Pendente</Badge>);
    const el = screen.getByText('Pendente');
    expect(el.className).toContain('text-warning');
    expect(el.className).toContain('bg-warning/10');
  });

  it('Badge solid tone fills the background', () => {
    render(<Badge variant="danger" tone="solid">6</Badge>);
    expect(screen.getByText('6').className).toContain('bg-destructive ');
  });

  it('Button has no bottom margin baked in', () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole('button').className).not.toMatch(/\bmb-2\b/);
  });

  it('Card composes header and content', () => {
    render(
      <Card>
        <CardHeader><CardTitle>Atenção</CardTitle></CardHeader>
        <CardContent>corpo</CardContent>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Atenção' })).toBeInTheDocument();
    expect(screen.getByText('corpo')).toBeInTheDocument();
  });

  it('Skeleton is a pulsing block', () => {
    const { container } = render(<Skeleton className="h-3 w-10" />);
    expect(container.firstElementChild?.className).toContain('animate-pulse');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/admin/src/components/ui/__tests__/primitives.test.tsx`
Expected: FAIL, "Failed to resolve import '../badge'".

- [ ] **Step 3: Copy the ten primitives and fix the `cn` import**

```bash
for f in button input select table dropdown-menu checkbox skeleton tabs label separator; do
  cp apps/crm/src/components/ui/$f.tsx apps/admin/src/components/ui/$f.tsx
done
sed -i '' "s#from '@/lib/utils'#from '../../lib/utils'#" apps/admin/src/components/ui/*.tsx
grep -n "@/" apps/admin/src/components/ui/*.tsx   # must print nothing
```

Then in `apps/admin/src/components/ui/button.tsx`, remove ` mb-2` from the base class string of `buttonVariants` (it currently reads `... text-sm font-medium mb-2 transition-colors ...`).

- [ ] **Step 4: Write `badge.tsx`**

```tsx
// apps/admin/src/components/ui/badge.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Same API as the CRM Badge (variant / tone / size), but built on the admin's Tailwind
 * tokens. The CRM version renders the `.badge*` classes from apps/crm/style.css, which
 * the admin does not load.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-transparent font-semibold uppercase leading-none tracking-wide',
  {
    variants: {
      variant: {
        neutral: 'bg-muted-foreground/10 text-muted-foreground',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        danger: 'bg-destructive/10 text-destructive',
        info: 'bg-sky-500/10 text-sky-500',
        primary: 'bg-primary/20 text-foreground',
        outline: 'border-border bg-transparent text-foreground',
      },
      tone: { soft: '', solid: '' },
      size: {
        sm: 'h-[18px] px-1.5 text-[0.6rem]',
        md: 'h-5 px-2 text-[0.7rem]',
        lg: 'h-6 px-2.5 text-xs',
      },
    },
    compoundVariants: [
      { variant: 'neutral', tone: 'solid', class: 'bg-muted-foreground text-background' },
      { variant: 'success', tone: 'solid', class: 'bg-success text-background' },
      { variant: 'warning', tone: 'solid', class: 'bg-warning text-background' },
      { variant: 'danger', tone: 'solid', class: 'bg-destructive text-destructive-foreground' },
      { variant: 'info', tone: 'solid', class: 'bg-sky-500 text-white' },
      { variant: 'primary', tone: 'solid', class: 'bg-primary text-primary-foreground' },
    ],
    defaultVariants: { variant: 'neutral', tone: 'soft', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, tone, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 5: Write `card.tsx`**

```tsx
// apps/admin/src/components/ui/card.tsx
import * as React from 'react';
import { cn } from '../../lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-2xl border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-between gap-3 border-b border-border px-5 py-3', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('text-sm font-semibold', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-5', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardContent };
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/components/ui/__tests__/primitives.test.tsx && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: 5 tests PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/components/ui
git commit -m "feat(admin): copia primitivos shadcn do CRM e reescreve Badge nos tokens do admin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: EmptyState, ErrorState, PageHeader

**Files:**
- Create: `apps/admin/src/components/EmptyState.tsx`, `ErrorState.tsx`, `PageHeader.tsx`
- Test: `apps/admin/src/components/__tests__/states.test.tsx`

**Interfaces:**
- Produces: `EmptyState({ icon?: LucideIcon; title: string; description?: string; action?: ReactNode })`, `ErrorState({ message?: string; onRetry: () => void })`, `PageHeader({ title: string; description?: string; actions?: ReactNode })`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/components/__tests__/states.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { PageHeader } from '../PageHeader';

describe('state components', () => {
  it('EmptyState renders title, description and action', () => {
    render(<EmptyState title="Nada aqui" description="Tente outra coisa." action={<button>Limpar</button>} />);
    expect(screen.getByText('Nada aqui')).toBeInTheDocument();
    expect(screen.getByText('Tente outra coisa.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeInTheDocument();
  });

  it('ErrorState shows a generic message and retries', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('PageHeader renders title, description and actions slot', () => {
    render(<PageHeader title="Workspaces" description="143 cadastrados" actions={<span>ação</span>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByText('143 cadastrados')).toBeInTheDocument();
    expect(screen.getByText('ação')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/admin/src/components/__tests__/states.test.tsx`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement the three components**

```tsx
// apps/admin/src/components/EmptyState.tsx
import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-5 py-10 text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
        <Icon size={18} />
      </span>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
```

```tsx
// apps/admin/src/components/ErrorState.tsx
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';

interface ErrorStateProps {
  /** Generic, user-safe text. Never pass a raw error message here. */
  message?: string;
  onRetry: () => void;
}

export function ErrorState({ message = 'Não foi possível carregar.', onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center px-5 py-10 text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle size={18} />
      </span>
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}
```

```tsx
// apps/admin/src/components/PageHeader.tsx
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-sf text-2xl font-bold">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run apps/admin/src/components/__tests__/states.test.tsx`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/EmptyState.tsx apps/admin/src/components/ErrorState.tsx apps/admin/src/components/PageHeader.tsx apps/admin/src/components/__tests__/states.test.tsx
git commit -m "feat(admin): EmptyState, ErrorState e PageHeader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Status groups in `subscription.ts`

**Files:**
- Modify: `apps/admin/src/lib/subscription.ts`
- Modify: `apps/admin/src/lib/__tests__/subscription.test.ts`
- Modify: `apps/admin/src/pages/__tests__/workspaces-export.test.ts` (fixture gains two fields)

**Interfaces:**
- Produces:
  ```ts
  export type WorkspaceStatusGroup = 'ativo' | 'teste' | 'pendente' | 'cancelado' | 'sem_assinatura';
  export const STATUS_GROUPS: readonly WorkspaceStatusGroup[];
  export const STATUS_GROUP_LABELS: Record<WorkspaceStatusGroup, string>;
  export function statusGroup(status: string | null | undefined): WorkspaceStatusGroup;
  export function isStatusGroup(value: string): value is WorkspaceStatusGroup;
  ```
  `SubscriptionSummary` gains `failed_payment_count: number; current_period_end: string | null;`.

- [ ] **Step 1: Add failing tests** to `apps/admin/src/lib/__tests__/subscription.test.ts` (append inside the top-level `describe`, and add `statusGroup, isStatusGroup, STATUS_GROUPS` to the import list):

```ts
  describe('statusGroup', () => {
    it('maps every known status to its group', () => {
      expect(statusGroup('active')).toBe('ativo');
      expect(statusGroup('trialing')).toBe('teste');
      expect(statusGroup('past_due')).toBe('pendente');
      expect(statusGroup('unpaid')).toBe('pendente');
      expect(statusGroup('incomplete')).toBe('pendente');
      expect(statusGroup('canceled')).toBe('cancelado');
      expect(statusGroup('incomplete_expired')).toBe('cancelado');
      expect(statusGroup('paused')).toBe('cancelado');
    });
    it('treats null, undefined and unknown statuses as no subscription', () => {
      expect(statusGroup(null)).toBe('sem_assinatura');
      expect(statusGroup(undefined)).toBe('sem_assinatura');
      expect(statusGroup('weird')).toBe('sem_assinatura');
    });
    it('isStatusGroup guards URL values', () => {
      expect(isStatusGroup('pendente')).toBe(true);
      expect(isStatusGroup('xyz')).toBe(false);
      expect(STATUS_GROUPS).toHaveLength(5);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/lib/__tests__/subscription.test.ts`
Expected: FAIL, `statusGroup` is not exported.

- [ ] **Step 3: Implement** in `apps/admin/src/lib/subscription.ts`. Add the two fields to `SubscriptionSummary`:

```ts
export interface SubscriptionSummary {
  status: string | null;
  plan_name: string | null;
  billing_interval: string | null;
  amount_cents: number | null;
  currency: string | null;
  interval: string | null;
  discount_label: string | null;
  /** Consecutive failed charges on the current invoice (0 when healthy). */
  failed_payment_count: number;
  /** End of the current billing period / trial (ISO), null when unknown. */
  current_period_end: string | null;
}
```

Append after `statusMeta`:

```ts
/**
 * Coarse status groups used by the Workspaces list filter and the Dashboard at-risk card.
 * MUST stay in sync with the CASE on p_status inside admin_list_workspaces
 * (supabase/migrations/20260907000030_admin_list_workspaces_filters_sort.sql).
 */
export type WorkspaceStatusGroup = 'ativo' | 'teste' | 'pendente' | 'cancelado' | 'sem_assinatura';

export const STATUS_GROUPS: readonly WorkspaceStatusGroup[] = [
  'ativo',
  'teste',
  'pendente',
  'cancelado',
  'sem_assinatura',
];

export const STATUS_GROUP_LABELS: Record<WorkspaceStatusGroup, string> = {
  ativo: 'Ativo',
  teste: 'Teste',
  pendente: 'Pagamento pendente',
  cancelado: 'Cancelado',
  sem_assinatura: 'Sem assinatura',
};

const STATUS_TO_GROUP: Record<string, WorkspaceStatusGroup> = {
  active: 'ativo',
  trialing: 'teste',
  past_due: 'pendente',
  unpaid: 'pendente',
  incomplete: 'pendente',
  canceled: 'cancelado',
  incomplete_expired: 'cancelado',
  paused: 'cancelado',
};

export function statusGroup(status: string | null | undefined): WorkspaceStatusGroup {
  if (!status) return 'sem_assinatura';
  return STATUS_TO_GROUP[status] ?? 'sem_assinatura';
}

export function isStatusGroup(value: string): value is WorkspaceStatusGroup {
  return (STATUS_GROUPS as readonly string[]).includes(value);
}
```

Leave `toneBadgeClass` in place with this comment above it: `/** Kept for WorkspaceDetailPage until Phase 2 migrates it to <Badge>. New code uses Badge. */`.

- [ ] **Step 4: Fix the export fixture.** In `apps/admin/src/pages/__tests__/workspaces-export.test.ts`, inside `baseWorkspace`'s `subscription` object add `failed_payment_count: 0,` and `current_period_end: null,`. Search the file for any other inline `subscription: {` literals and add the two fields there too.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/lib/__tests__/subscription.test.ts apps/admin/src/pages/__tests__/workspaces-export.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib/subscription.ts apps/admin/src/lib/__tests__/subscription.test.ts apps/admin/src/pages/__tests__/workspaces-export.test.ts
git commit -m "feat(admin): grupos de status de assinatura + campos de risco no resumo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Migration, `admin_list_workspaces` v5

**Files:**
- Create: `supabase/migrations/20260907000030_admin_list_workspaces_filters_sort.sql`

**Interfaces:**
- Produces the RPC signature `admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text)` returning the same jsonb shape as today, with `subscription.failed_payment_count` and `subscription.current_period_end` added to each row.

- [ ] **Step 1: Write the migration**

```sql
-- admin_list_workspaces v5: server-side filters + sorting for the admin Workspaces list.
--
-- New optional params (all DEFAULT NULL / harmless defaults, so the frontend deployed before
-- this migration keeps working unchanged):
--   p_status         status GROUP: ativo | teste | pendente | cancelado | sem_assinatura
--                    (mirror of statusGroup() in apps/admin/src/lib/subscription.ts)
--   p_has_overrides  true | false | NULL (all)
--   p_activity       7d | 30d | dormente | nunca   (buckets over last_activity_at)
--   p_created_since  created_at >= p_created_since
--   p_sort           name | plan | client_count | member_count | created_at | last_activity_at
--                    (anything else falls back to created_at)
--   p_dir            asc | desc (anything else = desc). Tiebreaker always id ASC.
--                    last_activity_at sorts NULLS FIRST on asc and NULLS LAST on desc, so
--                    "least active first" puts never-active workspaces on top.
--
-- Because status/overrides/activity are computed per row, enrichment now runs over the whole
-- search/plan/date-filtered set BEFORE those filters and before OFFSET/LIMIT; totals reflect
-- the fully filtered set. last_activity is fetched in ONE call for all candidate ids.
-- p_search now also matches the owner's e-mail.
-- Subscription JSON gains failed_payment_count and current_period_end (Dashboard at-risk card).
--
-- Signature changes (5 params -> 11): DROP the old overload explicitly, as before.
DROP FUNCTION IF EXISTS admin_list_workspaces(text, text, int, int, timestamptz);

CREATE OR REPLACE FUNCTION admin_list_workspaces(
  p_search        text        DEFAULT NULL,
  p_plan_id       text        DEFAULT NULL,
  p_offset        int         DEFAULT 0,
  p_limit         int         DEFAULT 20,
  p_as_of         timestamptz DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_has_overrides boolean     DEFAULT NULL,
  p_activity      text        DEFAULT NULL,
  p_created_since timestamptz DEFAULT NULL,
  p_sort          text        DEFAULT 'created_at',
  p_dir           text        DEFAULT 'desc'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH default_plan AS (
  SELECT id, name FROM plans WHERE is_default = true LIMIT 1
),
base AS (
  SELECT w.id, w.name, w.logo_url, w.created_at, w.plan_id, w.created_by
    FROM workspaces w
   WHERE (p_search IS NULL
          OR w.name ILIKE '%' || p_search || '%'
          OR EXISTS (
               SELECT 1
                 FROM workspace_members m
                 JOIN auth.users u ON u.id = m.user_id
                WHERE m.workspace_id = w.id
                  AND m.role = 'owner'
                  AND u.email ILIKE '%' || p_search || '%'))
     AND (p_plan_id IS NULL
          OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = p_plan_id)
     AND w.created_at <= COALESCE(p_as_of, now())
     AND (p_created_since IS NULL OR w.created_at >= p_created_since)
),
activity AS (
  SELECT a.workspace_id, a.last_activity_at
    FROM admin_workspace_last_activity((SELECT COALESCE(array_agg(id), '{}'::uuid[]) FROM base)) a
),
enriched_all AS (
  SELECT
    b.id,
    b.name,
    b.logo_url,
    b.created_at,
    la.last_activity_at,
    (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = b.id) AS member_count,
    (SELECT count(*) FROM clientes c WHERE c.conta_id = b.id)              AS client_count,
    COALESCE(pl.name, (SELECT name FROM default_plan))                     AS plan_name,
    EXISTS (
      SELECT 1 FROM workspace_plan_overrides o
       WHERE o.workspace_id = b.id
         AND (o.resource_overrides IS NOT NULL OR o.feature_overrides IS NOT NULL)
    ) AS has_overrides,
    own.owner_json AS owner,
    sub.sub_json   AS subscription,
    sub.sub_status
  FROM base b
  LEFT JOIN plans pl ON pl.id = b.plan_id
  LEFT JOIN activity la ON la.workspace_id = b.id
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'name',             COALESCE(pr.nome, 'Unknown'),
      'email',            COALESCE(u.email, 'Unknown'),
      'telefone',         pr.telefone,
      'marketing_opt_in', COALESCE(pr.marketing_opt_in, false)
    ) AS owner_json
      FROM workspace_members m
      LEFT JOIN profiles pr ON pr.id = m.user_id
      LEFT JOIN auth.users u ON u.id = m.user_id
     WHERE m.workspace_id = b.id AND m.role = 'owner'
     ORDER BY (m.user_id = b.created_by) DESC, m.joined_at ASC, m.user_id ASC
     LIMIT 1
  ) own ON true
  LEFT JOIN LATERAL (
    SELECT
      s.status AS sub_status,
      jsonb_build_object(
        'status',               s.status,
        'plan_name',            sp.name,
        'billing_interval',     s.billing_interval,
        'amount_cents',         COALESCE(
                                  s.amount_cents,
                                  CASE WHEN s.billing_interval = 'year'
                                       THEN sp.price_brl_annual ELSE sp.price_brl END),
        'currency',             CASE
                                  WHEN s.amount_cents IS NOT NULL THEN s.currency
                                  WHEN (CASE WHEN s.billing_interval = 'year'
                                             THEN sp.price_brl_annual ELSE sp.price_brl END) IS NOT NULL
                                       THEN 'brl'
                                  ELSE NULL
                                END,
        'interval',             COALESCE(s.amount_interval, s.billing_interval),
        'discount_label',       s.discount_label,
        'failed_payment_count', COALESCE(s.failed_payment_count, 0),
        'current_period_end',   s.current_period_end
      ) AS sub_json
      FROM workspace_subscriptions s
      LEFT JOIN plans sp ON sp.id = s.plan_id
     WHERE s.workspace_id = b.id
  ) sub ON true
),
filtered AS (
  SELECT e.*
    FROM enriched_all e
   WHERE (p_status IS NULL OR CASE p_status
            WHEN 'ativo'          THEN e.sub_status = 'active'
            WHEN 'teste'          THEN e.sub_status = 'trialing'
            WHEN 'pendente'       THEN e.sub_status IN ('past_due', 'unpaid', 'incomplete')
            WHEN 'cancelado'      THEN e.sub_status IN ('canceled', 'incomplete_expired', 'paused')
            WHEN 'sem_assinatura' THEN e.sub_status IS NULL
            ELSE true END)
     AND (p_has_overrides IS NULL OR e.has_overrides = p_has_overrides)
     AND (p_activity IS NULL OR CASE p_activity
            WHEN '7d'       THEN e.last_activity_at >= now() - interval '7 days'
            WHEN '30d'      THEN e.last_activity_at >= now() - interval '30 days'
            WHEN 'dormente' THEN e.last_activity_at <  now() - interval '30 days'
            WHEN 'nunca'    THEN e.last_activity_at IS NULL
            ELSE true END)
),
page AS (
  SELECT f.*, row_number() OVER (
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'client_count' THEN f.client_count
                                                WHEN 'member_count' THEN f.member_count END) END ASC  NULLS LAST,
      CASE WHEN p_dir <> 'asc' THEN (CASE p_sort WHEN 'client_count' THEN f.client_count
                                                 WHEN 'member_count' THEN f.member_count END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(f.name)
                                                WHEN 'plan' THEN lower(f.plan_name) END) END ASC  NULLS LAST,
      CASE WHEN p_dir <> 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(f.name)
                                                 WHEN 'plan' THEN lower(f.plan_name) END) END DESC NULLS LAST,
      -- NULLS FIRST on asc: "least active first" must surface never-active workspaces.
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'created_at'       THEN f.created_at
                                                WHEN 'last_activity_at' THEN f.last_activity_at END) END ASC  NULLS FIRST,
      CASE WHEN p_dir <> 'asc' THEN (CASE p_sort WHEN 'created_at'       THEN f.created_at
                                                 WHEN 'last_activity_at' THEN f.last_activity_at END) END DESC NULLS LAST,
      f.created_at DESC,
      f.id ASC
  ) AS rn
  FROM filtered f
)
SELECT jsonb_build_object(
  'total',                (SELECT count(*) FROM filtered),
  'total_members',        (SELECT COALESCE(sum(member_count), 0) FROM filtered),
  'total_clients',        (SELECT COALESCE(sum(client_count), 0) FROM filtered),
  'total_with_overrides', (SELECT count(*) FROM filtered WHERE has_overrides),
  'workspaces',           COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'id',               p.id,
                'name',             p.name,
                'logo_url',         p.logo_url,
                'created_at',       p.created_at,
                'last_activity_at', p.last_activity_at,
                'member_count',     p.member_count,
                'client_count',     p.client_count,
                'plan_name',        p.plan_name,
                'has_overrides',    p.has_overrides,
                'owner',            p.owner,
                'subscription',     p.subscription
              ) ORDER BY p.rn)
       FROM page p
      WHERE p.rn > p_offset AND p.rn <= p_offset + p_limit),
    '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text) FROM anon;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_list_workspaces(text, text, int, int, timestamptz, text, boolean, text, timestamptz, text, text) TO service_role;
```

- [ ] **Step 2: Verify against a local Supabase (needs Docker/colima).** If Docker is unavailable, skip this step and write "RPC not validated locally: no Docker" in the PR body; Task 15 repeats the check.

```bash
npx supabase start
npx supabase db reset
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"   # port from `npx supabase status` if different
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
-- signature exists once, old overload gone
SELECT count(*) FROM pg_proc WHERE proname = 'admin_list_workspaces';          -- expect 1
-- every filter/sort path executes without error
SELECT (admin_list_workspaces())->>'total';
SELECT (admin_list_workspaces(p_status := 'pendente'))->>'total';
SELECT (admin_list_workspaces(p_status := 'sem_assinatura'))->>'total';
SELECT (admin_list_workspaces(p_has_overrides := true))->>'total';
SELECT (admin_list_workspaces(p_activity := 'nunca'))->>'total';
SELECT (admin_list_workspaces(p_activity := 'dormente'))->>'total';
SELECT (admin_list_workspaces(p_created_since := now() - interval '30 days'))->>'total';
SELECT (admin_list_workspaces(p_sort := 'client_count', p_dir := 'desc'))->'workspaces'->0->>'client_count';
SELECT (admin_list_workspaces(p_sort := 'name', p_dir := 'asc'))->'workspaces'->0->>'name';
SELECT (admin_list_workspaces(p_sort := 'garbage', p_dir := 'sideways'))->>'total'; -- falls back, no error
SELECT (admin_list_workspaces(p_offset := 1, p_limit := 1))->'workspaces';
SELECT (admin_list_workspaces())->'workspaces'->0->'subscription' ? 'failed_payment_count'; -- expect t or null sub
SQL
npx supabase stop
```

Expected: every statement succeeds; the pg_proc count is 1.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260907000030_admin_list_workspaces_filters_sort.sql
git commit -m "feat(admin): admin_list_workspaces v5 com filtros de status/overrides/atividade e ordenação

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Edge function pass-through

**Files:**
- Modify: `supabase/functions/platform-admin/list-workspaces.ts`
- Modify: `supabase/functions/__tests__/platform-admin-list-workspaces_test.ts`

**Interfaces:**
- Consumes body fields `status`, `has_overrides`, `activity`, `created_since`, `sort`, `dir`; produces RPC params `p_status`, `p_has_overrides`, `p_activity`, `p_created_since`, `p_sort` (default `'created_at'`), `p_dir` (default `'desc'`).

- [ ] **Step 1: Update the three existing param assertions** in the test file. Every `assertEquals(rpcCalls[0].params, {...})` object gains these six keys after `p_as_of`:

```ts
    p_status: null,
    p_has_overrides: null,
    p_activity: null,
    p_created_since: null,
    p_sort: "created_at",
    p_dir: "desc",
```

- [ ] **Step 2: Add a new test** at the end of the file:

```ts
Deno.test("list-workspaces forwards the filter and sort params to the RPC", async () => {
  const { db, rpcCalls } = makeFakeRpcDb({ total: 0, workspaces: [] });

  await handleListWorkspaces(
    db as unknown as SupabaseClient,
    {
      status: "pendente",
      has_overrides: false,
      activity: "dormente",
      created_since: "2026-08-01T00:00:00.000Z",
      sort: "client_count",
      dir: "asc",
    },
    HEADERS,
  );

  assertEquals(rpcCalls[0].params, {
    p_search: null,
    p_plan_id: null,
    p_offset: 0,
    p_limit: 20,
    p_as_of: null,
    p_status: "pendente",
    p_has_overrides: false,
    p_activity: "dormente",
    p_created_since: "2026-08-01T00:00:00.000Z",
    p_sort: "client_count",
    p_dir: "asc",
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:functions -- --filter "list-workspaces"` then `git checkout deno.lock`
Expected: the four param-assertion tests FAIL (missing keys).

- [ ] **Step 4: Implement** in `list-workspaces.ts`. Replace the body type and the rpc call:

```ts
export async function handleListWorkspaces(
  svc: SupabaseClient,
  body: {
    search?: string;
    plan_id?: string;
    offset?: number;
    limit?: number;
    as_of?: string;
    status?: string;
    has_overrides?: boolean;
    activity?: string;
    created_since?: string;
    sort?: string;
    dir?: string;
  },
  headers: Record<string, string>,
) {
  const {
    search, plan_id, offset = 0, limit = 20, as_of,
    status, has_overrides, activity, created_since,
    sort = "created_at", dir = "desc",
  } = body;
  const { data, error } = await svc.rpc("admin_list_workspaces", {
    p_search: search ?? null,
    p_plan_id: plan_id ?? null,
    p_offset: offset,
    p_limit: limit,
    p_as_of: as_of ?? null,
    p_status: status ?? null,
    p_has_overrides: has_overrides ?? null,
    p_activity: activity ?? null,
    p_created_since: created_since ?? null,
    p_sort: sort,
    p_dir: dir,
  });
```

Keep the rest of the function unchanged. Update the doc comment to mention v5 (`20260907000030`).

- [ ] **Step 5: Run tests**

Run: `npm run test:functions -- --filter "list-workspaces"; git checkout deno.lock`
Expected: all list-workspaces tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/platform-admin/list-workspaces.ts supabase/functions/__tests__/platform-admin-list-workspaces_test.ts
git commit -m "feat(platform-admin): repassa filtros e ordenação para admin_list_workspaces

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: psql suites for the RPC (CI-gated)

**Files:**
- Create: `supabase/tests/entitlements/70_admin_list_workspaces_status_filter.sql`
- Create: `supabase/tests/entitlements/71_admin_list_workspaces_sort.sql`
- Create: `supabase/tests/entitlements/72_admin_list_workspaces_activity_overrides.sql`
- Create: `supabase/tests/entitlements/73_admin_list_workspaces_owner_email_search.sql`

**Interfaces:**
- Consumes the RPC from Task 4 and the helpers `et_make_workspace(p_plan_id text, p_overrides jsonb default null) returns uuid` from `supabase/tests/entitlements/_helpers.sql`. The runner `scripts/test-entitlements.sh` picks up every `[0-9]*.sql` in that folder.

Pattern used by every file (copied from `68_*.sql`): `\set ON_ERROR_STOP on`, `\i supabase/tests/entitlements/_helpers.sql`, one `begin; do $$ ... $$; rollback;` block, `execute 'set local role service_role';` around RPC calls, a unique `p_search` prefix so pre-existing rows never interfere, and a final `raise notice 'PASS <file>'`.

- [ ] **Step 1: Write `70_admin_list_workspaces_status_filter.sql`**

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_active uuid; v_trial uuid; v_pastdue uuid; v_canceled uuid; v_nullstatus uuid; v_nosub uuid;
  v jsonb;
  function_ids uuid[];
begin
  v_active     := et_make_workspace('max'); update workspaces set name = 'ET status ativo'      where id = v_active;
  v_trial      := et_make_workspace('max'); update workspaces set name = 'ET status teste'      where id = v_trial;
  v_pastdue    := et_make_workspace('max'); update workspaces set name = 'ET status pendente'   where id = v_pastdue;
  v_canceled   := et_make_workspace('max'); update workspaces set name = 'ET status cancelado'  where id = v_canceled;
  v_nullstatus := et_make_workspace('max'); update workspaces set name = 'ET status nulo'       where id = v_nullstatus;
  v_nosub      := et_make_workspace('max'); update workspaces set name = 'ET status sem linha'  where id = v_nosub;

  insert into workspace_subscriptions (workspace_id, status, plan_id, failed_payment_count) values
    (v_active,     'active',   'max', 0),
    (v_trial,      'trialing', 'max', 0),
    (v_pastdue,    'past_due', 'max', 2),
    (v_canceled,   'canceled', 'max', 0),
    (v_nullstatus, null,       'max', 0);

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'ativo');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_active,
    format('ativo: expected only %s, got %s', v_active, v -> 'workspaces');

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'teste');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_trial, 'teste filter';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'pendente');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_pastdue, 'pendente filter';
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'failed_payment_count')::int = 2,
    'subscription json must expose failed_payment_count';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'cancelado');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_canceled, 'cancelado filter';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'sem_assinatura');
  select array_agg((w ->> 'id')::uuid) into function_ids from jsonb_array_elements(v -> 'workspaces') w;
  assert (v ->> 'total')::int = 2, format('sem_assinatura: expected 2, got %s', v ->> 'total');
  assert v_nullstatus = any(function_ids) and v_nosub = any(function_ids),
    'sem_assinatura must include both the null-status row and the workspace with no row';

  v := admin_list_workspaces(p_search := 'ET status', p_status := 'garbage');
  assert (v ->> 'total')::int = 6, format('unknown p_status must not filter, got %s', v ->> 'total');

  v := admin_list_workspaces(p_search := 'ET status');
  assert (v ->> 'total')::int = 6, 'null p_status must not filter';

  execute 'reset role';
  raise notice 'PASS 70_admin_list_workspaces_status_filter';
end $$;
rollback;
```

- [ ] **Step 2: Write `71_admin_list_workspaces_sort.sql`**

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_a uuid; v_b uuid; v_c uuid;
  v_uid uuid := gen_random_uuid();
  v jsonb; v_p0 jsonb; v_p1 jsonb;
  ids uuid[];
begin
  -- Names deliberately out of creation order; client counts 0 / 2 / 5.
  v_a := et_make_workspace('max'); update workspaces set name = 'ET sort Zeta',  created_at = now() - interval '3 days' where id = v_a;
  v_b := et_make_workspace('max'); update workspaces set name = 'ET sort Alpha', created_at = now() - interval '2 days' where id = v_b;
  v_c := et_make_workspace('max'); update workspaces set name = 'ET sort Mid',   created_at = now() - interval '1 day'  where id = v_c;

  insert into auth.users (id, email) values (v_uid, 'et-sort@example.com');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    select v_uid, v_b, 'C', 'C', '#000' from generate_series(1, 2);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    select v_uid, v_c, 'C', 'C', '#000' from generate_series(1, 5);

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'client_count', p_dir := 'desc');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_c, v_b, v_a], format('client_count desc: got %s', ids);

  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'client_count', p_dir := 'asc');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_a, v_b, v_c], format('client_count asc: got %s', ids);

  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'name', p_dir := 'asc');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_b, v_c, v_a], format('name asc: got %s', ids);

  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'name', p_dir := 'desc');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_a, v_c, v_b], format('name desc: got %s', ids);

  -- Unknown sort key falls back to created_at desc (newest first).
  v := admin_list_workspaces(p_search := 'ET sort', p_sort := 'garbage', p_dir := 'sideways');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert ids = array[v_c, v_b, v_a], format('fallback sort: got %s', ids);
  assert (v ->> 'total')::int = 3, 'sorting must not change total';

  -- Pagination through row_number: no overlap, no gaps.
  v_p0 := admin_list_workspaces(p_search := 'ET sort', p_offset := 0, p_limit := 2, p_sort := 'name', p_dir := 'asc');
  v_p1 := admin_list_workspaces(p_search := 'ET sort', p_offset := 2, p_limit := 2, p_sort := 'name', p_dir := 'asc');
  assert jsonb_array_length(v_p0 -> 'workspaces') = 2 and jsonb_array_length(v_p1 -> 'workspaces') = 1,
    'pages must hold 2 + 1 rows';
  assert (v_p1 -> 'workspaces' -> 0 ->> 'id')::uuid = v_a, 'last page must hold the last-sorted row';
  assert (v_p0 ->> 'total')::int = 3 and (v_p1 ->> 'total')::int = 3, 'total is page-independent';

  execute 'reset role';
  raise notice 'PASS 71_admin_list_workspaces_sort';
end $$;
rollback;
```

- [ ] **Step 3: Write `72_admin_list_workspaces_activity_overrides.sql`**

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_plain uuid; v_over uuid; v_old uuid;
  v_uid uuid := gen_random_uuid();
  v jsonb;
  ids uuid[];
begin
  v_plain := et_make_workspace('max');
  update workspaces set name = 'ET act plain' where id = v_plain;
  v_over  := et_make_workspace('max', '{"max_clients": 99}'::jsonb);
  update workspaces set name = 'ET act override' where id = v_over;
  v_old   := et_make_workspace('max');
  update workspaces set name = 'ET act old', created_at = now() - interval '400 days' where id = v_old;

  -- Give v_over one client so it has activity; v_plain and v_old stay never-active.
  insert into auth.users (id, email) values (v_uid, 'et-act@example.com');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_over, 'C', 'C', '#000');

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'ET act', p_has_overrides := true);
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_over,
    format('has_overrides=true: got %s', v -> 'workspaces');

  v := admin_list_workspaces(p_search := 'ET act', p_has_overrides := false);
  assert (v ->> 'total')::int = 2, format('has_overrides=false: expected 2, got %s', v ->> 'total');

  v := admin_list_workspaces(p_search := 'ET act', p_activity := 'nunca');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert (v ->> 'total')::int = 2 and v_plain = any(ids) and v_old = any(ids),
    format('nunca: got %s', ids);

  v := admin_list_workspaces(p_search := 'ET act', p_activity := '7d');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_over, '7d: only the active one';

  v := admin_list_workspaces(p_search := 'ET act', p_activity := 'dormente');
  assert (v ->> 'total')::int = 0, 'dormente: nobody has old activity here';

  -- asc on last_activity_at puts never-active (NULL) rows first.
  v := admin_list_workspaces(p_search := 'ET act', p_sort := 'last_activity_at', p_dir := 'asc');
  assert (v -> 'workspaces' -> 2 ->> 'id')::uuid = v_over,
    'last_activity_at asc must list NULLs first and the active workspace last';
  v := admin_list_workspaces(p_search := 'ET act', p_sort := 'last_activity_at', p_dir := 'desc');
  assert (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_over,
    'last_activity_at desc must list the active workspace first';

  v := admin_list_workspaces(p_search := 'ET act', p_created_since := now() - interval '30 days');
  select array_agg((w ->> 'id')::uuid) into ids from jsonb_array_elements(v -> 'workspaces') w;
  assert (v ->> 'total')::int = 2 and not (v_old = any(ids)), format('created_since: got %s', ids);

  execute 'reset role';
  raise notice 'PASS 72_admin_list_workspaces_activity_overrides';
end $$;
rollback;
```

- [ ] **Step 4: Write `73_admin_list_workspaces_owner_email_search.sql`**

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid; v_other uuid;
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v jsonb;
begin
  v_ws    := et_make_workspace('max'); update workspaces set name = 'ET mail one' where id = v_ws;
  v_other := et_make_workspace('max'); update workspaces set name = 'ET mail two' where id = v_other;

  insert into auth.users (id, email) values
    (v_owner,  'dona-unica-xyz@example.com'),
    (v_member, 'agente-unico-xyz@example.com');
  insert into workspace_members (user_id, workspace_id, role, joined_at) values
    (v_owner,  v_ws,    'owner', now()),
    (v_member, v_other, 'agent', now());
  update profiles set conta_id = v_ws,    active_workspace_id = v_ws    where id = v_owner;
  update profiles set conta_id = v_other, active_workspace_id = v_other where id = v_member;

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'dona-unica-xyz');
  assert (v ->> 'total')::int = 1 and (v -> 'workspaces' -> 0 ->> 'id')::uuid = v_ws,
    format('owner e-mail search: got %s', v -> 'workspaces');

  v := admin_list_workspaces(p_search := 'agente-unico-xyz');
  assert (v ->> 'total')::int = 0, 'non-owner member e-mail must not match';

  v := admin_list_workspaces(p_search := 'ET mail');
  assert (v ->> 'total')::int = 2, 'name search still works';

  execute 'reset role';
  raise notice 'PASS 73_admin_list_workspaces_owner_email_search';
end $$;
rollback;
```

- [ ] **Step 5: Run the suites (Docker required).** If Docker is unavailable locally, push and rely on the `entitlement-tests` CI job, and say so in the PR body.

```bash
npm run test:db
```

Expected: every file prints `PASS ...`, including the pre-existing 67, 68 and 69. If 70 fails on `clientes` NOT NULL columns, copy the exact `insert into clientes (...)` column list from any other suite in the folder; the required set is `user_id, conta_id, nome, sigla, cor`.

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/entitlements/70_admin_list_workspaces_status_filter.sql supabase/tests/entitlements/71_admin_list_workspaces_sort.sql supabase/tests/entitlements/72_admin_list_workspaces_activity_overrides.sql supabase/tests/entitlements/73_admin_list_workspaces_owner_email_search.sql
git commit -m "test(db): suítes psql para filtros, ordenação e busca por e-mail em admin_list_workspaces

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: API types and the URL params module

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (the `listWorkspaces` block, ~line 274)
- Create: `apps/admin/src/pages/workspaces-params.ts`
- Test: `apps/admin/src/pages/__tests__/workspaces-params.test.ts`

**Interfaces:**
- Consumes: `WorkspaceStatusGroup`, `isStatusGroup`, `STATUS_GROUP_LABELS` (Task 3).
- Produces (api.ts):
  ```ts
  export type WorkspaceActivityBucket = '7d' | '30d' | 'dormente' | 'nunca';
  export type WorkspaceSortKey = 'name' | 'plan' | 'client_count' | 'member_count' | 'created_at' | 'last_activity_at';
  export type SortDir = 'asc' | 'desc';
  export interface ListWorkspacesParams { search?; plan_id?; offset?; limit?; as_of?; status?: WorkspaceStatusGroup; has_overrides?: boolean; activity?: WorkspaceActivityBucket; created_since?: string; sort?: WorkspaceSortKey; dir?: SortDir }
  export interface ListWorkspacesResponse { workspaces: WorkspaceSummary[]; total: number; total_members: number; total_clients: number; total_with_overrides: number }
  export function listWorkspaces(params?: ListWorkspacesParams): Promise<ListWorkspacesResponse>
  ```
- Produces (workspaces-params.ts):
  ```ts
  export const PAGE_SIZES = [20, 50, 100] as const;  export type PageSize = 20 | 50 | 100;
  export type CreatedPreset = '' | '7d' | '30d' | '90d' | '12m';
  export type OverridesFilter = '' | 'sim' | 'nao';
  export interface WorkspacesListParams { q: string; plano: string; status: WorkspaceStatusGroup | ''; overrides: OverridesFilter; atividade: WorkspaceActivityBucket | ''; criado: CreatedPreset; ord: WorkspaceSortKey; dir: SortDir; pag: number; por: PageSize }
  export const DEFAULT_PARAMS: WorkspacesListParams;
  export const FILTER_KEYS: readonly (keyof WorkspacesListParams)[];  // q plano status overrides atividade criado
  export const ACTIVITY_LABELS: Record<WorkspaceActivityBucket, string>;
  export const CREATED_LABELS: Record<Exclude<CreatedPreset, ''>, string>;
  export const OVERRIDES_LABELS: Record<Exclude<OverridesFilter, ''>, string>;
  export const SORT_DEFAULT_DIR: Record<WorkspaceSortKey, SortDir>;
  export function parseWorkspacesParams(sp: URLSearchParams): WorkspacesListParams;
  export function serializeWorkspacesParams(p: WorkspacesListParams): URLSearchParams;
  export function toListWorkspacesRequest(p: WorkspacesListParams, now: Date): ListWorkspacesParams;
  export function hasActiveFilters(p: WorkspacesListParams): boolean;
  export function nextSort(current: Pick<WorkspacesListParams, 'ord' | 'dir'>, key: WorkspaceSortKey): Pick<WorkspacesListParams, 'ord' | 'dir'>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/pages/__tests__/workspaces-params.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  hasActiveFilters,
  nextSort,
  parseWorkspacesParams,
  serializeWorkspacesParams,
  toListWorkspacesRequest,
  type WorkspacesListParams,
} from '../workspaces-params';

const FULL: WorkspacesListParams = {
  q: 'cl',
  plano: 'pro',
  status: 'pendente',
  overrides: 'sim',
  atividade: 'dormente',
  criado: '30d',
  ord: 'client_count',
  dir: 'asc',
  pag: 3,
  por: 50,
};

describe('workspaces-params', () => {
  it('round-trips a full param set', () => {
    const sp = serializeWorkspacesParams(FULL);
    expect(parseWorkspacesParams(sp)).toEqual(FULL);
  });

  it('omits defaults from the URL', () => {
    expect(serializeWorkspacesParams(DEFAULT_PARAMS).toString()).toBe('');
    expect(serializeWorkspacesParams({ ...DEFAULT_PARAMS, pag: 2 }).toString()).toBe('pag=2');
  });

  it('falls back to defaults on invalid values', () => {
    const sp = new URLSearchParams('status=xyz&pag=abc&por=37&dir=sideways&ord=nope&atividade=x&criado=y&overrides=maybe');
    expect(parseWorkspacesParams(sp)).toEqual(DEFAULT_PARAMS);
    expect(parseWorkspacesParams(new URLSearchParams('pag=0')).pag).toBe(1);
    expect(parseWorkspacesParams(new URLSearchParams('pag=-4')).pag).toBe(1);
  });

  it('maps to the API request with offset/limit and an absolute created_since', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    expect(toListWorkspacesRequest(FULL, now)).toEqual({
      search: 'cl',
      plan_id: 'pro',
      status: 'pendente',
      has_overrides: true,
      activity: 'dormente',
      created_since: '2026-08-05T12:00:00.000Z',
      sort: 'client_count',
      dir: 'asc',
      offset: 100,
      limit: 50,
    });
  });

  it('omits empty filters from the request', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    expect(toListWorkspacesRequest(DEFAULT_PARAMS, now)).toEqual({
      sort: 'created_at',
      dir: 'desc',
      offset: 0,
      limit: 20,
    });
    expect(toListWorkspacesRequest({ ...DEFAULT_PARAMS, overrides: 'nao' }, now).has_overrides).toBe(false);
  });

  it('hasActiveFilters ignores sort and paging', () => {
    expect(hasActiveFilters(DEFAULT_PARAMS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_PARAMS, pag: 4, ord: 'name', por: 100 })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_PARAMS, q: 'a' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_PARAMS, criado: '7d' })).toBe(true);
  });

  it('nextSort flips direction on the same key and uses the column default otherwise', () => {
    expect(nextSort({ ord: 'created_at', dir: 'desc' }, 'created_at')).toEqual({ ord: 'created_at', dir: 'asc' });
    expect(nextSort({ ord: 'created_at', dir: 'desc' }, 'name')).toEqual({ ord: 'name', dir: 'asc' });
    expect(nextSort({ ord: 'name', dir: 'asc' }, 'client_count')).toEqual({ ord: 'client_count', dir: 'desc' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/workspaces-params.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Extend `api.ts`.** Add the imports/types near the top of the file (after the existing `import type { SubscriptionInfo, SubscriptionSummary } from './subscription';` line, extend that import to include `WorkspaceStatusGroup`) and replace the `listWorkspaces` function:

```ts
import type { SubscriptionInfo, SubscriptionSummary, WorkspaceStatusGroup } from './subscription';

export type WorkspaceActivityBucket = '7d' | '30d' | 'dormente' | 'nunca';
export type WorkspaceSortKey =
  | 'name'
  | 'plan'
  | 'client_count'
  | 'member_count'
  | 'created_at'
  | 'last_activity_at';
export type SortDir = 'asc' | 'desc';

export interface ListWorkspacesParams {
  search?: string;
  plan_id?: string;
  offset?: number;
  limit?: number;
  /** Freezes the filtered set to how it looked at this instant (ISO), for multi-call exports. */
  as_of?: string;
  /** Subscription status group; mirrors the CASE on p_status in admin_list_workspaces. */
  status?: WorkspaceStatusGroup;
  has_overrides?: boolean;
  activity?: WorkspaceActivityBucket;
  /** ISO timestamp; created_at >= created_since. */
  created_since?: string;
  sort?: WorkspaceSortKey;
  dir?: SortDir;
}

export interface ListWorkspacesResponse {
  workspaces: WorkspaceSummary[];
  total: number;
  /** Membership count across the whole filtered set, not just the returned page. */
  total_members: number;
  /** Client count across the whole filtered set, not just the returned page. */
  total_clients: number;
  /** Workspaces with plan overrides across the whole filtered set, not just the page. */
  total_with_overrides: number;
}

export function listWorkspaces(params?: ListWorkspacesParams) {
  return adminApi<ListWorkspacesResponse>('list-workspaces', params || {});
}
```

(Place the type declarations in the `Types` section of the file and keep `listWorkspaces` where it is.)

- [ ] **Step 4: Write `workspaces-params.ts`**

```ts
// apps/admin/src/pages/workspaces-params.ts
/**
 * Pure mapping between the Workspaces list URL (?q=&status=&ord=...) and both the typed
 * params object the page works with and the request sent to listWorkspaces(). Defaults
 * are never written to the URL; unknown values fall back to defaults silently.
 */
import type {
  ListWorkspacesParams,
  SortDir,
  WorkspaceActivityBucket,
  WorkspaceSortKey,
} from '../lib/api';
import { isStatusGroup, type WorkspaceStatusGroup } from '../lib/subscription';

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export type CreatedPreset = '' | '7d' | '30d' | '90d' | '12m';
export type OverridesFilter = '' | 'sim' | 'nao';

export interface WorkspacesListParams {
  q: string;
  plano: string;
  status: WorkspaceStatusGroup | '';
  overrides: OverridesFilter;
  atividade: WorkspaceActivityBucket | '';
  criado: CreatedPreset;
  ord: WorkspaceSortKey;
  dir: SortDir;
  /** 1-based. */
  pag: number;
  por: PageSize;
}

export const DEFAULT_PARAMS: WorkspacesListParams = {
  q: '',
  plano: '',
  status: '',
  overrides: '',
  atividade: '',
  criado: '',
  ord: 'created_at',
  dir: 'desc',
  pag: 1,
  por: 20,
};

export const FILTER_KEYS = ['q', 'plano', 'status', 'overrides', 'atividade', 'criado'] as const;

const ACTIVITY_BUCKETS: readonly WorkspaceActivityBucket[] = ['7d', '30d', 'dormente', 'nunca'];
const CREATED_PRESETS: readonly Exclude<CreatedPreset, ''>[] = ['7d', '30d', '90d', '12m'];
const SORT_KEYS: readonly WorkspaceSortKey[] = [
  'name',
  'plan',
  'client_count',
  'member_count',
  'created_at',
  'last_activity_at',
];

export const ACTIVITY_LABELS: Record<WorkspaceActivityBucket, string> = {
  '7d': 'Ativo (7 dias)',
  '30d': 'Ativo (30 dias)',
  dormente: 'Dormente (30d+)',
  nunca: 'Nunca ativou',
};

export const CREATED_LABELS: Record<Exclude<CreatedPreset, ''>, string> = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  '12m': 'Últimos 12 meses',
};

export const OVERRIDES_LABELS: Record<Exclude<OverridesFilter, ''>, string> = {
  sim: 'Com overrides',
  nao: 'Sem overrides',
};

const CREATED_PRESET_DAYS: Record<Exclude<CreatedPreset, ''>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

/** First click on a column header sorts this way; text columns ascend, numbers/dates descend. */
export const SORT_DEFAULT_DIR: Record<WorkspaceSortKey, SortDir> = {
  name: 'asc',
  plan: 'asc',
  client_count: 'desc',
  member_count: 'desc',
  created_at: 'desc',
  last_activity_at: 'desc',
};

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseWorkspacesParams(sp: URLSearchParams): WorkspacesListParams {
  const status = sp.get('status');
  const pag = Number.parseInt(sp.get('pag') ?? '', 10);
  const por = Number.parseInt(sp.get('por') ?? '', 10);
  return {
    q: sp.get('q') ?? '',
    plano: sp.get('plano') ?? '',
    status: status && isStatusGroup(status) ? status : '',
    overrides: oneOf(sp.get('overrides'), ['sim', 'nao'] as const) ?? '',
    atividade: oneOf(sp.get('atividade'), ACTIVITY_BUCKETS) ?? '',
    criado: oneOf(sp.get('criado'), CREATED_PRESETS) ?? '',
    ord: oneOf(sp.get('ord'), SORT_KEYS) ?? DEFAULT_PARAMS.ord,
    dir: oneOf(sp.get('dir'), ['asc', 'desc'] as const) ?? DEFAULT_PARAMS.dir,
    pag: Number.isFinite(pag) && pag >= 1 ? pag : 1,
    por: (PAGE_SIZES as readonly number[]).includes(por) ? (por as PageSize) : DEFAULT_PARAMS.por,
  };
}

export function serializeWorkspacesParams(p: WorkspacesListParams): URLSearchParams {
  const sp = new URLSearchParams();
  (Object.keys(DEFAULT_PARAMS) as (keyof WorkspacesListParams)[]).forEach((key) => {
    const value = p[key];
    if (value !== DEFAULT_PARAMS[key]) sp.set(key, String(value));
  });
  return sp;
}

export function toListWorkspacesRequest(p: WorkspacesListParams, now: Date): ListWorkspacesParams {
  const req: ListWorkspacesParams = {
    sort: p.ord,
    dir: p.dir,
    offset: (p.pag - 1) * p.por,
    limit: p.por,
  };
  if (p.q) req.search = p.q;
  if (p.plano) req.plan_id = p.plano;
  if (p.status) req.status = p.status;
  if (p.overrides) req.has_overrides = p.overrides === 'sim';
  if (p.atividade) req.activity = p.atividade;
  if (p.criado) {
    const since = new Date(now.getTime() - CREATED_PRESET_DAYS[p.criado] * 86_400_000);
    req.created_since = since.toISOString();
  }
  return req;
}

export function hasActiveFilters(p: WorkspacesListParams): boolean {
  return FILTER_KEYS.some((key) => p[key] !== DEFAULT_PARAMS[key]);
}

export function nextSort(
  current: Pick<WorkspacesListParams, 'ord' | 'dir'>,
  key: WorkspaceSortKey,
): Pick<WorkspacesListParams, 'ord' | 'dir'> {
  if (current.ord === key) return { ord: key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { ord: key, dir: SORT_DEFAULT_DIR[key] };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/pages/__tests__/workspaces-params.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: 7 PASS, tsc clean. If tsc complains that `WorkspacesPage.tsx` or `DashboardPage.tsx` pass an unknown key to `listWorkspaces`, they don't yet; the old call sites only use `search/plan_id/offset/limit/as_of`, which remain valid.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/pages/workspaces-params.ts apps/admin/src/pages/__tests__/workspaces-params.test.ts
git commit -m "feat(admin): tipos de filtro/ordenação na API e módulo de parâmetros da lista de workspaces

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `useWorkspacesParams` hook

**Files:**
- Create: `apps/admin/src/hooks/useWorkspacesParams.ts`
- Test: `apps/admin/src/hooks/__tests__/useWorkspacesParams.test.tsx`

**Interfaces:**
- Consumes: `parseWorkspacesParams`, `serializeWorkspacesParams`, `DEFAULT_PARAMS`, `FILTER_KEYS`, `WorkspacesListParams` (Task 7).
- Produces:
  ```ts
  export function useWorkspacesParams(): {
    params: WorkspacesListParams;
    set: (patch: Partial<WorkspacesListParams>, opts?: { replace?: boolean }) => void;
    reset: () => void;   // clears FILTER_KEYS + pag only; keeps ord/dir/por
  };
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/hooks/__tests__/useWorkspacesParams.test.tsx
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useWorkspacesParams } from '../useWorkspacesParams';

function wrap(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useWorkspacesParams', () => {
  it('parses the current URL', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?status=pendente&pag=3&ord=name&dir=asc'),
    });
    expect(result.current.params.status).toBe('pendente');
    expect(result.current.params.pag).toBe(3);
    expect(result.current.params.ord).toBe('name');
  });

  it('set() with a filter key resets the page to 1', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?pag=3'),
    });
    act(() => result.current.set({ status: 'teste' }));
    expect(result.current.params.status).toBe('teste');
    expect(result.current.params.pag).toBe(1);
  });

  it('set() with pag / ord / dir keeps the page unless pag is given', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?pag=3'),
    });
    act(() => result.current.set({ ord: 'name', dir: 'asc' }));
    expect(result.current.params.pag).toBe(3);
    act(() => result.current.set({ pag: 5 }));
    expect(result.current.params.pag).toBe(5);
  });

  it('reset() clears filters and page but keeps sort and page size', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?q=x&status=ativo&criado=7d&pag=2&ord=name&dir=asc&por=50'),
    });
    act(() => result.current.reset());
    expect(result.current.params).toEqual({
      q: '',
      plano: '',
      status: '',
      overrides: '',
      atividade: '',
      criado: '',
      ord: 'name',
      dir: 'asc',
      pag: 1,
      por: 50,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/hooks/__tests__/useWorkspacesParams.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/admin/src/hooks/useWorkspacesParams.ts
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DEFAULT_PARAMS,
  FILTER_KEYS,
  parseWorkspacesParams,
  serializeWorkspacesParams,
  type WorkspacesListParams,
} from '../pages/workspaces-params';

/** Keys whose change does NOT send the user back to page 1. */
const KEEP_PAGE_KEYS: ReadonlySet<string> = new Set(['pag', 'ord', 'dir']);

export function useWorkspacesParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parseWorkspacesParams(searchParams), [searchParams]);

  const set = useCallback(
    (patch: Partial<WorkspacesListParams>, opts?: { replace?: boolean }) => {
      const next: WorkspacesListParams = { ...params, ...patch };
      const touchesFilterOrSize = Object.keys(patch).some((k) => !KEEP_PAGE_KEYS.has(k));
      if (touchesFilterOrSize && patch.pag === undefined) next.pag = 1;
      // Typing in the search box rewrites the URL on every debounce tick; those must not
      // pile up in history. Everything else is a deliberate navigation.
      const replace = opts?.replace ?? ('q' in patch && Object.keys(patch).length === 1);
      setSearchParams(serializeWorkspacesParams(next), { replace });
    },
    [params, setSearchParams],
  );

  const reset = useCallback(() => {
    const cleared: Partial<WorkspacesListParams> = { pag: 1 };
    FILTER_KEYS.forEach((key) => {
      (cleared as Record<string, unknown>)[key] = DEFAULT_PARAMS[key];
    });
    set(cleared);
  }, [set]);

  return { params, set, reset };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/hooks/__tests__/useWorkspacesParams.test.tsx && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: 4 PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/hooks
git commit -m "feat(admin): hook useWorkspacesParams sobre useSearchParams

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Column registry and persisted prefs

**Files:**
- Create: `apps/admin/src/pages/workspaces-columns.ts`
- Test: `apps/admin/src/pages/__tests__/workspaces-columns.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSortKey` (Task 7).
- Produces:
  ```ts
  export type WorkspaceColumnKey = 'name' | 'owner' | 'plan' | 'subscription' | 'client_count' | 'member_count' | 'created_at' | 'last_activity_at';
  export interface WorkspaceColumn { key: WorkspaceColumnKey; label: string; sortKey?: WorkspaceSortKey; hideable: boolean; numeric?: boolean }
  export const WORKSPACE_COLUMNS: readonly WorkspaceColumn[];
  export type Density = 'confortavel' | 'compacta';
  export interface ColumnPrefs { visible: WorkspaceColumnKey[]; density: Density }
  export const DEFAULT_COLUMN_PREFS: ColumnPrefs;
  export const COLUMNS_STORAGE_KEY = 'admin.workspaces.columns';
  export const DENSITY_STORAGE_KEY = 'admin.workspaces.density';
  export function readColumnPrefs(storage?: Storage | null): ColumnPrefs;
  export function writeColumnPrefs(prefs: ColumnPrefs, storage?: Storage | null): void;
  export function toggleColumn(prefs: ColumnPrefs, key: WorkspaceColumnKey): ColumnPrefs;  // no-op for non-hideable
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/pages/__tests__/workspaces-columns.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  COLUMNS_STORAGE_KEY,
  DEFAULT_COLUMN_PREFS,
  DENSITY_STORAGE_KEY,
  readColumnPrefs,
  toggleColumn,
  WORKSPACE_COLUMNS,
  writeColumnPrefs,
} from '../workspaces-columns';

beforeEach(() => localStorage.clear());

describe('workspaces-columns', () => {
  it('defaults to every column visible and comfortable density', () => {
    expect(readColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
    expect(DEFAULT_COLUMN_PREFS.visible).toEqual(WORKSPACE_COLUMNS.map((c) => c.key));
    expect(DEFAULT_COLUMN_PREFS.density).toBe('confortavel');
  });

  it('round-trips through localStorage', () => {
    writeColumnPrefs({ visible: ['name', 'plan'], density: 'compacta' });
    expect(readColumnPrefs()).toEqual({ visible: ['name', 'plan'], density: 'compacta' });
  });

  it('drops unknown column keys and bad density', () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(['name', 'bogus', 'plan']));
    localStorage.setItem(DENSITY_STORAGE_KEY, 'huge');
    expect(readColumnPrefs()).toEqual({ visible: ['name', 'plan'], density: 'confortavel' });
  });

  it('always keeps the name column visible', () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(['plan']));
    expect(readColumnPrefs().visible).toEqual(['name', 'plan']);
    expect(toggleColumn(DEFAULT_COLUMN_PREFS, 'name').visible).toContain('name');
  });

  it('survives garbage and a throwing storage', () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, '{not json');
    expect(readColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
    const boom = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    } as unknown as Storage;
    expect(readColumnPrefs(boom)).toEqual(DEFAULT_COLUMN_PREFS);
    expect(() => writeColumnPrefs(DEFAULT_COLUMN_PREFS, boom)).not.toThrow();
  });

  it('toggleColumn hides and shows hideable columns preserving registry order', () => {
    const hidden = toggleColumn(DEFAULT_COLUMN_PREFS, 'owner');
    expect(hidden.visible).not.toContain('owner');
    const shown = toggleColumn(hidden, 'owner');
    expect(shown.visible).toEqual(DEFAULT_COLUMN_PREFS.visible);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/workspaces-columns.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/admin/src/pages/workspaces-columns.ts
import type { WorkspaceSortKey } from '../lib/api';

export type WorkspaceColumnKey =
  | 'name'
  | 'owner'
  | 'plan'
  | 'subscription'
  | 'client_count'
  | 'member_count'
  | 'created_at'
  | 'last_activity_at';

export interface WorkspaceColumn {
  key: WorkspaceColumnKey;
  label: string;
  /** Present when the header is sortable. */
  sortKey?: WorkspaceSortKey;
  hideable: boolean;
  numeric?: boolean;
}

export const WORKSPACE_COLUMNS: readonly WorkspaceColumn[] = [
  { key: 'name', label: 'Workspace', sortKey: 'name', hideable: false },
  { key: 'owner', label: 'Dono', hideable: true },
  { key: 'plan', label: 'Plano', sortKey: 'plan', hideable: true },
  { key: 'subscription', label: 'Assinatura', hideable: true },
  { key: 'client_count', label: 'Clientes', sortKey: 'client_count', hideable: true, numeric: true },
  { key: 'member_count', label: 'Membros', sortKey: 'member_count', hideable: true, numeric: true },
  { key: 'created_at', label: 'Criado em', sortKey: 'created_at', hideable: true },
  { key: 'last_activity_at', label: 'Última atividade', sortKey: 'last_activity_at', hideable: true },
];

export type Density = 'confortavel' | 'compacta';
export const DENSITY_LABELS: Record<Density, string> = {
  confortavel: 'Confortável',
  compacta: 'Compacta',
};

export interface ColumnPrefs {
  visible: WorkspaceColumnKey[];
  density: Density;
}

export const DEFAULT_COLUMN_PREFS: ColumnPrefs = {
  visible: WORKSPACE_COLUMNS.map((c) => c.key),
  density: 'confortavel',
};

export const COLUMNS_STORAGE_KEY = 'admin.workspaces.columns';
export const DENSITY_STORAGE_KEY = 'admin.workspaces.density';

const KNOWN_KEYS = new Set<string>(WORKSPACE_COLUMNS.map((c) => c.key));

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Keeps registry order and forces every non-hideable column in. */
function normalizeVisible(keys: string[]): WorkspaceColumnKey[] {
  const wanted = new Set(keys.filter((k) => KNOWN_KEYS.has(k)));
  return WORKSPACE_COLUMNS.filter((c) => !c.hideable || wanted.has(c.key)).map((c) => c.key);
}

export function readColumnPrefs(storage: Storage | null = defaultStorage()): ColumnPrefs {
  if (!storage) return DEFAULT_COLUMN_PREFS;
  try {
    const rawCols = storage.getItem(COLUMNS_STORAGE_KEY);
    const parsed: unknown = rawCols ? JSON.parse(rawCols) : null;
    const visible = Array.isArray(parsed)
      ? normalizeVisible(parsed.filter((k): k is string => typeof k === 'string'))
      : DEFAULT_COLUMN_PREFS.visible;
    const rawDensity = storage.getItem(DENSITY_STORAGE_KEY);
    const density: Density = rawDensity === 'compacta' ? 'compacta' : 'confortavel';
    return { visible, density };
  } catch {
    return DEFAULT_COLUMN_PREFS;
  }
}

export function writeColumnPrefs(prefs: ColumnPrefs, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(prefs.visible));
    storage.setItem(DENSITY_STORAGE_KEY, prefs.density);
  } catch {
    // Private mode / quota: the preference simply doesn't persist.
  }
}

export function toggleColumn(prefs: ColumnPrefs, key: WorkspaceColumnKey): ColumnPrefs {
  const col = WORKSPACE_COLUMNS.find((c) => c.key === key);
  if (!col || !col.hideable) return prefs;
  const next = prefs.visible.includes(key)
    ? prefs.visible.filter((k) => k !== key)
    : [...prefs.visible, key];
  return { ...prefs, visible: normalizeVisible(next) };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/pages/__tests__/workspaces-columns.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: 6 PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/workspaces-columns.ts apps/admin/src/pages/__tests__/workspaces-columns.test.ts
git commit -m "feat(admin): registro de colunas e preferências persistidas da lista de workspaces

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Table and pagination components

**Files:**
- Create: `apps/admin/src/pages/workspaces-pagination.ts`
- Create: `apps/admin/src/pages/workspaces/WorkspacesTable.tsx`
- Create: `apps/admin/src/pages/workspaces/WorkspacesPagination.tsx`
- Test: `apps/admin/src/pages/__tests__/workspaces-pagination.test.ts`
- Test: `apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx`

**Interfaces:**
- Consumes: `Table*`, `Badge`, `Skeleton`, `Button`, `Select*` (Task 1); `WORKSPACE_COLUMNS`, `WorkspaceColumnKey`, `Density` (Task 9); `WorkspaceSortKey`, `SortDir`, `WorkspaceSummary` (Task 7 / api.ts); `PAGE_SIZES`, `PageSize` (Task 7); `describeActivity`, `ACTIVITY_TONE_CLASS` (`pages/workspace-activity.ts`); `statusMeta`, `hasSubscription`, `formatMoney`, `intervalSuffix` (`lib/subscription.ts`); `getPlanColor` (`lib/plan-colors.ts`); `Tooltip*` (`components/ui/tooltip.tsx`).
- Produces:
  ```ts
  export function pageWindow(current: number, totalPages: number, size?: number): (number | 'gap')[];
  export function WorkspacesTable(props: { workspaces: WorkspaceSummary[]; visible: WorkspaceColumnKey[]; density: Density; sort: { ord: WorkspaceSortKey; dir: SortDir }; onSort: (key: WorkspaceSortKey) => void; onOpen: (id: string) => void; now: Date; busy?: boolean }): JSX.Element;
  export function WorkspacesTableSkeleton(props: { visible: WorkspaceColumnKey[]; rows?: number }): JSX.Element;
  export function WorkspacesPagination(props: { total: number; pag: number; por: PageSize; onPage: (pag: number) => void; onPageSize: (por: PageSize) => void }): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/admin/src/pages/__tests__/workspaces-pagination.test.ts
import { describe, expect, it } from 'vitest';
import { pageWindow } from '../workspaces-pagination';

describe('pageWindow', () => {
  it('lists every page when they fit', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('centers the current page and adds gaps with first/last pinned', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
  });
  it('clamps out-of-range current pages', () => {
    expect(pageWindow(99, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(0, 3)).toEqual([1, 2, 3]);
  });
});
```

```tsx
// apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/tooltip';
import type { WorkspaceSummary } from '../../lib/api';
import { WorkspacesTable, WorkspacesTableSkeleton } from '../workspaces/WorkspacesTable';
import { DEFAULT_COLUMN_PREFS } from '../workspaces-columns';

const NOW = new Date('2026-09-04T12:00:00.000Z');

function ws(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'ws-1',
    name: 'Agência Norte',
    logo_url: null,
    created_at: '2026-01-15T10:00:00Z',
    last_activity_at: '2026-07-19T12:00:00Z',
    owner: { name: 'Rafa', email: 'rafa@agencianorte.com', telefone: null, marketing_opt_in: false },
    member_count: 3,
    client_count: 42,
    plan_name: 'Pro',
    has_overrides: true,
    subscription: {
      status: 'past_due',
      plan_name: 'Pro',
      billing_interval: 'month',
      amount_cents: 19700,
      currency: 'brl',
      interval: 'month',
      discount_label: null,
      failed_payment_count: 3,
      current_period_end: null,
    },
    ...overrides,
  };
}

function renderTable(props: Partial<Parameters<typeof WorkspacesTable>[0]> = {}) {
  const onSort = vi.fn();
  const onOpen = vi.fn();
  render(
    <TooltipProvider>
      <WorkspacesTable
        workspaces={[ws()]}
        visible={DEFAULT_COLUMN_PREFS.visible}
        density="confortavel"
        sort={{ ord: 'created_at', dir: 'desc' }}
        onSort={onSort}
        onOpen={onOpen}
        now={NOW}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onSort, onOpen };
}

describe('WorkspacesTable', () => {
  it('renders one header per visible column and hides the rest', () => {
    renderTable({ visible: ['name', 'plan', 'client_count'] });
    expect(screen.getByRole('columnheader', { name: /Workspace/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Plano/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Clientes/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Dono/ })).toBeNull();
    expect(screen.queryByText('rafa@agencianorte.com')).toBeNull();
  });

  it('marks the active sort column with aria-sort and calls onSort on click', () => {
    const { onSort } = renderTable({ sort: { ord: 'client_count', dir: 'desc' } });
    const clients = screen.getByRole('columnheader', { name: /Clientes/ });
    expect(clients).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /Workspace/ })).not.toHaveAttribute('aria-sort');
    fireEvent.click(screen.getByRole('button', { name: /Membros/ }));
    expect(onSort).toHaveBeenCalledWith('member_count');
  });

  it('renders row content: name, overrides badge, plan, status, counts, activity', () => {
    renderTable();
    expect(screen.getAllByText('Agência Norte').length).toBeGreaterThan(0);
    expect(screen.getAllByText('overrides').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pro').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pagamento pendente').length).toBeGreaterThan(0);
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
  });

  it('navigates when a row is clicked', () => {
    const { onOpen } = renderTable();
    fireEvent.click(screen.getAllByText('Agência Norte')[0]);
    expect(onOpen).toHaveBeenCalledWith('ws-1');
  });

  it('marks the table busy while refetching', () => {
    renderTable({ busy: true });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('skeleton renders the requested rows for the visible columns', () => {
    render(<WorkspacesTableSkeleton visible={['name', 'plan']} rows={3} />);
    expect(screen.getAllByRole('row')).toHaveLength(4); // header + 3
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/workspaces-pagination.test.ts apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `workspaces-pagination.ts`**

```ts
// apps/admin/src/pages/workspaces-pagination.ts
/**
 * Page-number window for the list footer: up to `size` consecutive pages centred on the
 * current one, with the first and last page always pinned and 'gap' where pages are skipped.
 */
export function pageWindow(current: number, totalPages: number, size = 5): (number | 'gap')[] {
  if (totalPages <= 0) return [];
  const cur = Math.min(Math.max(1, current), totalPages);
  if (totalPages <= size + 2) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const half = Math.floor(size / 2);
  let start = Math.max(1, cur - half);
  let end = Math.min(totalPages, start + size - 1);
  start = Math.max(1, end - size + 1);

  const pages: (number | 'gap')[] = [];
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('gap');
  }
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('gap');
    pages.push(totalPages);
  }
  return pages;
}
```

- [ ] **Step 4: Implement `WorkspacesTable.tsx`**

```tsx
// apps/admin/src/pages/workspaces/WorkspacesTable.tsx
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDir, WorkspaceSortKey, WorkspaceSummary } from '../../lib/api';
import { getPlanColor } from '../../lib/plan-colors';
import { formatMoney, hasSubscription, intervalSuffix, statusMeta } from '../../lib/subscription';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ACTIVITY_TONE_CLASS, describeActivity } from '../workspace-activity';
import { WORKSPACE_COLUMNS, type Density, type WorkspaceColumnKey } from '../workspaces-columns';
import { cn } from '../../lib/utils';

interface WorkspacesTableProps {
  workspaces: WorkspaceSummary[];
  visible: WorkspaceColumnKey[];
  density: Density;
  sort: { ord: WorkspaceSortKey; dir: SortDir };
  onSort: (key: WorkspaceSortKey) => void;
  onOpen: (id: string) => void;
  /** Injected so activity labels are deterministic in tests. */
  now: Date;
  /** True while a refetch is in flight; dims the previous rows instead of unmounting them. */
  busy?: boolean;
}

const STATUS_VARIANT = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'neutral',
} as const;

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });

function PlanBadge({ name }: { name: string | null }) {
  if (!name) return <span className="text-dim-foreground">—</span>;
  const color = getPlanColor(name);
  return (
    <Badge variant="neutral" style={{ color, backgroundColor: `${color}26` }}>
      {name}
    </Badge>
  );
}

function SubscriptionCell({ ws }: { ws: WorkspaceSummary }) {
  if (!hasSubscription(ws.subscription)) return <span className="text-dim-foreground">—</span>;
  const meta = statusMeta(ws.subscription.status);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Badge variant={STATUS_VARIANT[meta.tone]}>{meta.label}</Badge>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatMoney(ws.subscription.amount_cents, ws.subscription.currency)}
        {intervalSuffix(ws.subscription.interval)}
      </span>
    </span>
  );
}

function ActivityCell({ ws, now }: { ws: WorkspaceSummary; now: Date }) {
  const a = describeActivity(ws.last_activity_at, ws.created_at, now);
  return (
    <Tooltip>
      {/* asChild keeps a span: a <button> here would hijack the row's click. */}
      <TooltipTrigger asChild>
        <span className={cn('w-fit text-sm', ACTIVITY_TONE_CLASS[a.tone])}>{a.label}</span>
      </TooltipTrigger>
      <TooltipContent>{a.title}</TooltipContent>
    </Tooltip>
  );
}

function cellFor(key: WorkspaceColumnKey, ws: WorkspaceSummary, now: Date) {
  switch (key) {
    case 'name':
      return (
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{ws.name}</span>
          {ws.has_overrides ? <Badge variant="warning" size="sm">overrides</Badge> : null}
        </span>
      );
    case 'owner':
      return <span className="truncate text-sm text-muted-foreground">{ws.owner?.email || '—'}</span>;
    case 'plan':
      return <PlanBadge name={ws.plan_name} />;
    case 'subscription':
      return <SubscriptionCell ws={ws} />;
    case 'client_count':
      return <span className="tabular-nums">{ws.client_count}</span>;
    case 'member_count':
      return <span className="tabular-nums">{ws.member_count}</span>;
    case 'created_at':
      return <span className="text-sm text-muted-foreground">{DATE_FMT.format(new Date(ws.created_at))}</span>;
    case 'last_activity_at':
      return <ActivityCell ws={ws} now={now} />;
  }
}

export function WorkspacesTable({ workspaces, visible, density, sort, onSort, onOpen, now, busy }: WorkspacesTableProps) {
  const columns = WORKSPACE_COLUMNS.filter((c) => visible.includes(c.key));
  const cellPad = density === 'compacta' ? 'py-1.5 text-xs' : 'py-3';

  return (
    <>
      {/* Desktop: real table. */}
      <Table aria-busy={busy ? 'true' : undefined} className={cn('hidden md:table', busy && 'opacity-60')}>
        <TableHeader>
          <TableRow>
            {columns.map((col) => {
              const active = col.sortKey !== undefined && col.sortKey === sort.ord;
              const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
              return (
                <TableHead
                  key={col.key}
                  aria-sort={ariaSort}
                  className={cn('text-[0.7rem] uppercase tracking-wider', col.numeric && 'text-right')}
                >
                  {col.sortKey ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.sortKey!)}
                      className={cn(
                        'group inline-flex items-center gap-1 hover:text-foreground',
                        active ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {col.label}
                      {active ? (
                        sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                      ) : (
                        <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-60" />
                      )}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{col.label}</span>
                  )}
                </TableHead>
              );
            })}
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {workspaces.map((ws) => (
            <TableRow key={ws.id} onClick={() => onOpen(ws.id)} className="cursor-pointer">
              {columns.map((col) => (
                <TableCell key={col.key} className={cn(cellPad, col.numeric && 'text-right')}>
                  {cellFor(col.key, ws, now)}
                </TableCell>
              ))}
              <TableCell className={cn(cellPad, 'text-muted-foreground')}>
                <ArrowRight size={16} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Mobile: one card per row. Ignores column prefs on purpose. */}
      <ul className={cn('flex flex-col md:hidden', busy && 'opacity-60')}>
        {workspaces.map((ws) => (
          <li
            key={ws.id}
            onClick={() => onOpen(ws.id)}
            className="cursor-pointer border-b border-border/50 px-5 py-3 last:border-0 hover:bg-secondary/30"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{ws.name}</span>
              {ws.has_overrides ? <Badge variant="warning" size="sm">overrides</Badge> : null}
              <ArrowRight size={14} className="ml-auto text-muted-foreground" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="max-w-[180px] truncate">{ws.owner?.email || '—'}</span>
              <PlanBadge name={ws.plan_name} />
              <SubscriptionCell ws={ws} />
              <span>{ws.client_count} clientes</span>
              <span>{ws.member_count} membros</span>
              <ActivityCell ws={ws} now={now} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function WorkspacesTableSkeleton({ visible, rows = 5 }: { visible: WorkspaceColumnKey[]; rows?: number }) {
  const columns = WORKSPACE_COLUMNS.filter((c) => visible.includes(c.key));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">
              {col.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, i) => (
          <TableRow key={i}>
            {columns.map((col) => (
              <TableCell key={col.key} className="py-3">
                <Skeleton className={cn('h-3', col.key === 'name' ? 'w-36' : 'w-20')} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 5: Implement `WorkspacesPagination.tsx`**

```tsx
// apps/admin/src/pages/workspaces/WorkspacesPagination.tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { PAGE_SIZES, type PageSize } from '../workspaces-params';
import { pageWindow } from '../workspaces-pagination';

interface WorkspacesPaginationProps {
  total: number;
  pag: number;
  por: PageSize;
  onPage: (pag: number) => void;
  onPageSize: (por: PageSize) => void;
}

export function WorkspacesPagination({ total, pag, por, onPage, onPageSize }: WorkspacesPaginationProps) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / por));
  const start = (pag - 1) * por + 1;
  const end = Math.min(total, pag * por);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          {start}–{end} de {total}
        </span>
        <span aria-hidden>·</span>
        <Select value={String(por)} onValueChange={(v) => onPageSize(Number(v) as PageSize)}>
          <SelectTrigger className="h-7 w-[7.5rem] text-xs" aria-label="Itens por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} por página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginação" className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={pag <= 1} onClick={() => onPage(pag - 1)} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          {pageWindow(pag, totalPages).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="px-1">…</span>
            ) : (
              <Button
                key={p}
                variant={p === pag ? 'ink' : 'outline'}
                size="sm"
                className="h-7 min-w-7 px-2 text-xs"
                aria-current={p === pag ? 'page' : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </Button>
            ),
          )}
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={pag >= totalPages} onClick={() => onPage(pag + 1)} aria-label="Próxima página">
            <ChevronRight />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/pages/__tests__/workspaces-pagination.test.ts apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: 9 PASS, tsc clean. If the `cellFor` switch triggers "not all code paths return a value", add `default: return null;`.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pages/workspaces-pagination.ts apps/admin/src/pages/workspaces apps/admin/src/pages/__tests__/workspaces-pagination.test.ts apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx
git commit -m "feat(admin): tabela ordenável com colunas configuráveis e paginação da lista de workspaces

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Toolbar and filter chips

**Files:**
- Create: `apps/admin/src/pages/workspaces/WorkspacesToolbar.tsx`
- Create: `apps/admin/src/pages/workspaces/WorkspacesFilterChips.tsx`
- Test: `apps/admin/src/pages/__tests__/WorkspacesToolbar.test.tsx`

**Interfaces:**
- Consumes: `Input`, `Select*`, `Button`, `DropdownMenu*` (Task 1); `WorkspacesListParams`, `ACTIVITY_LABELS`, `CREATED_LABELS`, `OVERRIDES_LABELS`, `hasActiveFilters`, `FILTER_KEYS` (Task 7); `STATUS_GROUPS`, `STATUS_GROUP_LABELS` (Task 3); `WORKSPACE_COLUMNS`, `ColumnPrefs`, `toggleColumn`, `DENSITY_LABELS`, `Density` (Task 9); `Plan` (api.ts).
- Produces:
  ```ts
  export function WorkspacesToolbar(props: { params: WorkspacesListParams; plans: Plan[]; prefs: ColumnPrefs; onChange: (patch: Partial<WorkspacesListParams>) => void; onPrefs: (prefs: ColumnPrefs) => void; onExport: () => void; exporting: boolean }): JSX.Element;
  export function WorkspacesFilterChips(props: { params: WorkspacesListParams; plans: Plan[]; total: number | undefined; onChange: (patch: Partial<WorkspacesListParams>) => void; onClear: () => void }): JSX.Element | null;
  ```

Radix Select and DropdownMenu open on pointer events jsdom does not model, so the tests below exercise the search debounce, rendered values and the chips. Select interaction is covered by the page's URL-driven tests (Task 12) through direct `onChange` patches and by the browser check in Task 16.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/pages/__tests__/WorkspacesToolbar.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../../lib/api';
import { WorkspacesFilterChips } from '../workspaces/WorkspacesFilterChips';
import { WorkspacesToolbar } from '../workspaces/WorkspacesToolbar';
import { DEFAULT_COLUMN_PREFS } from '../workspaces-columns';
import { DEFAULT_PARAMS } from '../workspaces-params';

const PLANS = [
  { id: 'pro', name: 'Pro' },
  { id: 'max', name: 'Max' },
] as unknown as Plan[];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WorkspacesToolbar', () => {
  it('debounces the search box into one onChange({ q })', () => {
    const onChange = vi.fn();
    render(
      <WorkspacesToolbar
        params={DEFAULT_PARAMS}
        plans={PLANS}
        prefs={DEFAULT_COLUMN_PREFS}
        onChange={onChange}
        onPrefs={vi.fn()}
        onExport={vi.fn()}
        exporting={false}
      />,
    );
    const input = screen.getByPlaceholderText('Buscar por nome ou e-mail do dono…');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ag' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ q: 'ag' });
  });

  it('shows the current filter values and the export state', () => {
    render(
      <WorkspacesToolbar
        params={{ ...DEFAULT_PARAMS, status: 'pendente', atividade: 'dormente' }}
        plans={PLANS}
        prefs={DEFAULT_COLUMN_PREFS}
        onChange={vi.fn()}
        onPrefs={vi.fn()}
        onExport={vi.fn()}
        exporting={true}
      />,
    );
    expect(screen.getByText('Pagamento pendente')).toBeInTheDocument();
    expect(screen.getByText('Dormente (30d+)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportando…/ })).toBeDisabled();
  });
});

describe('WorkspacesFilterChips', () => {
  it('renders nothing without active filters', () => {
    const { container } = render(
      <WorkspacesFilterChips params={DEFAULT_PARAMS} plans={PLANS} total={143} onChange={vi.fn()} onClear={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one chip per active filter, removes a filter, clears all, shows the count', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <WorkspacesFilterChips
        params={{ ...DEFAULT_PARAMS, q: 'norte', plano: 'pro', status: 'pendente' }}
        plans={PLANS}
        total={7}
        onChange={onChange}
        onClear={onClear}
      />,
    );
    expect(screen.getByText(/Busca:/).textContent).toContain('norte');
    expect(screen.getByText(/Plano:/).textContent).toContain('Pro');
    expect(screen.getByText(/Status:/).textContent).toContain('Pagamento pendente');
    expect(screen.getByText('7 resultados')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro Status' }));
    expect(onChange).toHaveBeenCalledWith({ status: '' });

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspacesToolbar.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `WorkspacesToolbar.tsx`**

```tsx
// apps/admin/src/pages/workspaces/WorkspacesToolbar.tsx
import { useEffect, useState } from 'react';
import { Columns3, Download, Search } from 'lucide-react';
import type { Plan } from '../../lib/api';
import { STATUS_GROUPS, STATUS_GROUP_LABELS } from '../../lib/subscription';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  DENSITY_LABELS,
  WORKSPACE_COLUMNS,
  toggleColumn,
  type ColumnPrefs,
  type Density,
} from '../workspaces-columns';
import {
  ACTIVITY_LABELS,
  CREATED_LABELS,
  OVERRIDES_LABELS,
  type WorkspacesListParams,
} from '../workspaces-params';

const SEARCH_DEBOUNCE_MS = 300;
/** Radix Select can't carry an empty-string value, so "all" is a sentinel that maps back to ''. */
const ALL = '__all__';

interface WorkspacesToolbarProps {
  params: WorkspacesListParams;
  plans: Plan[];
  prefs: ColumnPrefs;
  onChange: (patch: Partial<WorkspacesListParams>) => void;
  onPrefs: (prefs: ColumnPrefs) => void;
  onExport: () => void;
  exporting: boolean;
}

interface FilterSelectProps<T extends string> {
  label: string;
  value: T | '';
  allLabel: string;
  options: { value: T; label: string }[];
  onChange: (value: T | '') => void;
}

function FilterSelect<T extends string>({ label, value, allLabel, options, onChange }: FilterSelectProps<T>) {
  const active = value !== '';
  return (
    <Select value={value === '' ? ALL : value} onValueChange={(v) => onChange(v === ALL ? '' : (v as T))}>
      <SelectTrigger
        aria-label={label}
        className={cn('h-9 w-auto gap-2', active && 'border-primary/60 bg-primary/10')}
      >
        <span className="text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WorkspacesToolbar({ params, plans, prefs, onChange, onPrefs, onExport, exporting }: WorkspacesToolbarProps) {
  const [text, setText] = useState(params.q);

  // External changes (chip removal, "Limpar filtros", back button) win over local typing.
  useEffect(() => setText(params.q), [params.q]);

  useEffect(() => {
    if (text === params.q) return;
    const t = setTimeout(() => onChange({ q: text }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, params.q, onChange]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Buscar por nome ou e-mail do dono…"
          className="pl-9"
          aria-label="Buscar workspaces"
        />
      </div>

      <FilterSelect
        label="Plano"
        value={params.plano}
        allLabel="Todos"
        options={plans.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(plano) => onChange({ plano })}
      />
      <FilterSelect
        label="Status"
        value={params.status}
        allLabel="Todos"
        options={STATUS_GROUPS.map((g) => ({ value: g, label: STATUS_GROUP_LABELS[g] }))}
        onChange={(status) => onChange({ status })}
      />
      <FilterSelect
        label="Overrides"
        value={params.overrides}
        allLabel="Todos"
        options={(Object.keys(OVERRIDES_LABELS) as (keyof typeof OVERRIDES_LABELS)[]).map((k) => ({ value: k, label: OVERRIDES_LABELS[k] }))}
        onChange={(overrides) => onChange({ overrides })}
      />
      <FilterSelect
        label="Atividade"
        value={params.atividade}
        allLabel="Qualquer"
        options={(Object.keys(ACTIVITY_LABELS) as (keyof typeof ACTIVITY_LABELS)[]).map((k) => ({ value: k, label: ACTIVITY_LABELS[k] }))}
        onChange={(atividade) => onChange({ atividade })}
      />
      <FilterSelect
        label="Criado"
        value={params.criado}
        allLabel="Qualquer data"
        options={(Object.keys(CREATED_LABELS) as (keyof typeof CREATED_LABELS)[]).map((k) => ({ value: k, label: CREATED_LABELS[k] }))}
        onChange={(criado) => onChange({ criado })}
      />

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Columns3 />
              Colunas
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
            {WORKSPACE_COLUMNS.filter((c) => c.hideable).map((col) => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={prefs.visible.includes(col.key)}
                onCheckedChange={() => onPrefs(toggleColumn(prefs, col.key))}
                onSelect={(e) => e.preventDefault()}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Densidade</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={prefs.density} onValueChange={(d) => onPrefs({ ...prefs, density: d as Density })}>
              {(Object.keys(DENSITY_LABELS) as Density[]).map((d) => (
                <DropdownMenuRadioItem key={d} value={d} onSelect={(e) => e.preventDefault()}>
                  {DENSITY_LABELS[d]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" onClick={onExport} disabled={exporting}>
          <Download />
          {exporting ? 'Exportando…' : 'Exportar CSV'}
        </Button>
      </div>
    </div>
  );
}
```

If the copied `dropdown-menu.tsx` does not export `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup` or `DropdownMenuRadioItem`, add them following the shadcn `dropdown-menu` reference (they wrap `DropdownMenuPrimitive.CheckboxItem` / `RadioGroup` / `RadioItem` with an `ItemIndicator` holding a `Check` / `Circle` lucide icon).

- [ ] **Step 4: Implement `WorkspacesFilterChips.tsx`**

```tsx
// apps/admin/src/pages/workspaces/WorkspacesFilterChips.tsx
import { X } from 'lucide-react';
import type { Plan } from '../../lib/api';
import { STATUS_GROUP_LABELS } from '../../lib/subscription';
import { Button } from '../../components/ui/button';
import {
  ACTIVITY_LABELS,
  CREATED_LABELS,
  OVERRIDES_LABELS,
  hasActiveFilters,
  type WorkspacesListParams,
} from '../workspaces-params';

interface WorkspacesFilterChipsProps {
  params: WorkspacesListParams;
  plans: Plan[];
  total: number | undefined;
  onChange: (patch: Partial<WorkspacesListParams>) => void;
  onClear: () => void;
}

interface Chip {
  key: keyof WorkspacesListParams;
  label: string;
  value: string;
}

function chipsFor(params: WorkspacesListParams, plans: Plan[]): Chip[] {
  const chips: Chip[] = [];
  if (params.q) chips.push({ key: 'q', label: 'Busca', value: params.q });
  if (params.plano) {
    chips.push({ key: 'plano', label: 'Plano', value: plans.find((p) => p.id === params.plano)?.name ?? params.plano });
  }
  if (params.status) chips.push({ key: 'status', label: 'Status', value: STATUS_GROUP_LABELS[params.status] });
  if (params.overrides) chips.push({ key: 'overrides', label: 'Overrides', value: OVERRIDES_LABELS[params.overrides] });
  if (params.atividade) chips.push({ key: 'atividade', label: 'Atividade', value: ACTIVITY_LABELS[params.atividade] });
  if (params.criado) chips.push({ key: 'criado', label: 'Criado', value: CREATED_LABELS[params.criado] });
  return chips;
}

export function WorkspacesFilterChips({ params, plans, total, onChange, onClear }: WorkspacesFilterChipsProps) {
  if (!hasActiveFilters(params)) return null;
  const chips = chipsFor(params, plans);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex h-6 items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1 text-foreground">
          <span>
            <span className="text-muted-foreground">{chip.label}:</span> {chip.value}
          </span>
          <button
            type="button"
            aria-label={`Remover filtro ${chip.label}`}
            onClick={() => onChange({ [chip.key]: '' } as Partial<WorkspacesListParams>)}
            className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onClear}>
        Limpar filtros
      </Button>
      {total !== undefined ? (
        <span className="ml-auto tabular-nums">
          {total} {total === 1 ? 'resultado' : 'resultados'}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspacesToolbar.test.tsx && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: 4 PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/workspaces/WorkspacesToolbar.tsx apps/admin/src/pages/workspaces/WorkspacesFilterChips.tsx apps/admin/src/pages/__tests__/WorkspacesToolbar.test.tsx apps/admin/src/components/ui/dropdown-menu.tsx
git commit -m "feat(admin): barra de filtros com selects inline, menu de colunas e chips de filtros ativos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Compose the Workspaces page

**Files:**
- Rewrite: `apps/admin/src/pages/WorkspacesPage.tsx`
- Test: `apps/admin/src/pages/__tests__/WorkspacesPage.test.tsx`

**Interfaces:**
- Consumes everything from Tasks 1, 2, 7 to 11: `PageHeader`, `EmptyState`, `ErrorState`, `Card`, `useWorkspacesParams`, `toListWorkspacesRequest`, `hasActiveFilters`, `nextSort`, `readColumnPrefs`, `writeColumnPrefs`, `WorkspacesToolbar`, `WorkspacesFilterChips`, `WorkspacesTable`, `WorkspacesTableSkeleton`, `WorkspacesPagination`, plus `listWorkspaces`, `listPlans` (api.ts), `toCSV`, `downloadCSV` (`lib/csv-export.ts`), `WORKSPACE_EXPORT_COLUMNS`, `buildWorkspaceExportRows` (`pages/workspaces-export.ts`).
- Produces: default export `WorkspacesPage`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/pages/__tests__/WorkspacesPage.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/tooltip';
import type { ListWorkspacesResponse, WorkspaceSummary } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  listWorkspaces: vi.fn(),
  listPlans: vi.fn(),
}));

import { listPlans, listWorkspaces } from '../../lib/api';
import WorkspacesPage from '../WorkspacesPage';
import { COLUMNS_STORAGE_KEY } from '../workspaces-columns';

const mockedList = vi.mocked(listWorkspaces);
const mockedPlans = vi.mocked(listPlans);

function ws(id: string, name: string): WorkspaceSummary {
  return {
    id,
    name,
    logo_url: null,
    created_at: '2026-01-15T10:00:00Z',
    last_activity_at: null,
    owner: { name: 'Ana', email: `${id}@example.com`, telefone: null, marketing_opt_in: false },
    member_count: 1,
    client_count: 2,
    plan_name: 'Pro',
    has_overrides: false,
    subscription: null,
  };
}

function response(workspaces: WorkspaceSummary[], total = workspaces.length): ListWorkspacesResponse {
  return { workspaces, total, total_members: 0, total_clients: 0, total_with_overrides: 0 };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="url">{loc.pathname + loc.search}</span>;
}

function renderPage(initial = '/admin/workspaces') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initial]}>
          <WorkspacesPage />
          <LocationProbe />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockedPlans.mockResolvedValue({ plans: [{ id: 'pro', name: 'Pro' }] } as never);
  mockedList.mockResolvedValue(response([ws('a', 'Alpha'), ws('b', 'Beta')], 2));
});

describe('WorkspacesPage', () => {
  it('turns the URL into the API request', async () => {
    renderPage('/admin/workspaces?q=al&status=pendente&atividade=dormente&ord=client_count&dir=asc&pag=2&por=50');
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    expect(mockedList.mock.calls[0][0]).toEqual({
      search: 'al',
      status: 'pendente',
      activity: 'dormente',
      sort: 'client_count',
      dir: 'asc',
      offset: 50,
      limit: 50,
    });
  });

  it('renders rows and the result count once loaded', async () => {
    renderPage('/admin/workspaces?status=ativo');
    expect(await screen.findAllByText('Alpha')).not.toHaveLength(0);
    expect(screen.getByText('2 resultados')).toBeInTheDocument();
  });

  it('clicking a sortable header updates ord/dir in the URL and flips on the second click', async () => {
    renderPage();
    await screen.findAllByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: /Clientes/ }));
    expect(screen.getByTestId('url').textContent).toBe('/admin/workspaces?ord=client_count');
    fireEvent.click(screen.getByRole('button', { name: /Clientes/ }));
    expect(screen.getByTestId('url').textContent).toBe('/admin/workspaces?ord=client_count&dir=asc');
  });

  it('removing a chip clears that filter and resets the page', async () => {
    renderPage('/admin/workspaces?status=ativo&criado=7d&pag=3');
    await screen.findAllByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro Status' }));
    expect(screen.getByTestId('url').textContent).toBe('/admin/workspaces?criado=7d');
  });

  it('shows the filtered empty state with a clear action', async () => {
    mockedList.mockResolvedValue(response([], 0));
    renderPage('/admin/workspaces?status=cancelado&ord=name');
    expect(await screen.findByText('Nenhum workspace com esses filtros')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Limpar filtros' })[0]);
    expect(screen.getByTestId('url').textContent).toBe('/admin/workspaces?ord=name');
  });

  it('shows the plain empty state without filters', async () => {
    mockedList.mockResolvedValue(response([], 0));
    renderPage();
    expect(await screen.findByText('Nenhum workspace cadastrado ainda.')).toBeInTheDocument();
  });

  it('shows the error state and refetches on retry', async () => {
    mockedList.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    mockedList.mockResolvedValue(response([ws('a', 'Alpha')]));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findAllByText('Alpha')).not.toHaveLength(0);
  });

  it('reads column prefs from localStorage', async () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(['name', 'plan']));
    renderPage();
    await screen.findAllByText('Alpha');
    expect(screen.queryByRole('columnheader', { name: /Dono/ })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Plano/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspacesPage.test.tsx`
Expected: FAIL (old page renders English strings and no URL wiring).

- [ ] **Step 3: Rewrite `WorkspacesPage.tsx`**

```tsx
// apps/admin/src/pages/WorkspacesPage.tsx
import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { listPlans, listWorkspaces, type WorkspaceSortKey, type WorkspaceSummary } from '../lib/api';
import { downloadCSV, toCSV } from '../lib/csv-export';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { PageHeader } from '../components/PageHeader';
import { useWorkspacesParams } from '../hooks/useWorkspacesParams';
import { WorkspacesFilterChips } from './workspaces/WorkspacesFilterChips';
import { WorkspacesPagination } from './workspaces/WorkspacesPagination';
import { WorkspacesTable, WorkspacesTableSkeleton } from './workspaces/WorkspacesTable';
import { readColumnPrefs, writeColumnPrefs, type ColumnPrefs } from './workspaces-columns';
import { WORKSPACE_EXPORT_COLUMNS, buildWorkspaceExportRows } from './workspaces-export';
import { hasActiveFilters, nextSort, toListWorkspacesRequest } from './workspaces-params';
import { WorkspacesToolbar } from './workspaces/WorkspacesToolbar';

const EXPORT_PAGE_SIZE = 200;
const EXPORT_MAX_ROWS = 2000;

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const { params, set, reset } = useWorkspacesParams();
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => readColumnPrefs());
  const [exporting, setExporting] = useState(false);

  // One clock per render: the activity labels and the created_since cutoff agree.
  const now = useMemo(() => new Date(), [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const request = useMemo(() => toListWorkspacesRequest(params, now), [params, now]);

  const list = useQuery({
    queryKey: ['admin', 'workspaces', request],
    queryFn: () => listWorkspaces(request),
    placeholderData: keepPreviousData,
  });

  const plansQuery = useQuery({ queryKey: ['admin', 'plans'], queryFn: listPlans });
  const plans = plansQuery.data?.plans ?? [];

  const onPrefs = useCallback((next: ColumnPrefs) => {
    setPrefs(next);
    writeColumnPrefs(next);
  }, []);

  const onSort = useCallback((key: WorkspaceSortKey) => set(nextSort(params, key)), [params, set]);

  async function handleExportCsv() {
    setExporting(true);
    try {
      // Freeze the set to this instant so signups mid-export can't shift rows across pages.
      const asOf = new Date().toISOString();
      const all: WorkspaceSummary[] = [];
      let total = Infinity;
      for (let offset = 0; offset < Math.min(total, EXPORT_MAX_ROWS); offset += EXPORT_PAGE_SIZE) {
        const page = await listWorkspaces({ ...request, offset, limit: EXPORT_PAGE_SIZE, as_of: asOf });
        total = page.total;
        all.push(...page.workspaces);
      }
      if (all.length === 0) {
        toast.error('Nada para exportar');
        return;
      }
      const rows = all.slice(0, EXPORT_MAX_ROWS);
      downloadCSV(
        `workspaces-${new Date().toISOString().slice(0, 10)}.csv`,
        toCSV(buildWorkspaceExportRows(rows), WORKSPACE_EXPORT_COLUMNS),
      );
      if (total > EXPORT_MAX_ROWS) {
        toast.warning(
          `Exportados os primeiros ${EXPORT_MAX_ROWS} de ${total} workspaces. Refine os filtros para exportar o restante.`,
        );
      }
    } catch {
      toast.error('Falha ao exportar');
    } finally {
      setExporting(false);
    }
  }

  const total = list.data?.total;
  const workspaces = list.data?.workspaces ?? [];
  const filtered = hasActiveFilters(params);

  let body: JSX.Element;
  if (list.isPending) {
    body = <WorkspacesTableSkeleton visible={prefs.visible} />;
  } else if (list.isError) {
    body = <ErrorState message="Não foi possível carregar os workspaces." onRetry={() => list.refetch()} />;
  } else if (workspaces.length === 0) {
    body = filtered ? (
      <EmptyState
        icon={Building2}
        title="Nenhum workspace com esses filtros"
        description="Tente ampliar a busca ou remover um dos filtros ativos."
        action={
          <Button variant="outline" size="sm" onClick={reset}>
            Limpar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState icon={Building2} title="Nenhum workspace cadastrado ainda." />
    );
  } else {
    body = (
      <>
        <WorkspacesTable
          workspaces={workspaces}
          visible={prefs.visible}
          density={prefs.density}
          sort={{ ord: params.ord, dir: params.dir }}
          onSort={onSort}
          onOpen={(id) => navigate(`/admin/workspaces/${id}`)}
          now={now}
          busy={list.isFetching}
        />
        <WorkspacesPagination
          total={total ?? 0}
          pag={params.pag}
          por={params.por}
          onPage={(pag) => set({ pag })}
          onPageSize={(por) => set({ por })}
        />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Workspaces"
        description={total === undefined ? 'Todos os workspaces cadastrados' : `${total} workspaces cadastrados`}
      />
      <WorkspacesToolbar
        params={params}
        plans={plans}
        prefs={prefs}
        onChange={set}
        onPrefs={onPrefs}
        onExport={handleExportCsv}
        exporting={exporting}
      />
      <WorkspacesFilterChips params={params} plans={plans} total={total} onChange={set} onClear={reset} />
      <Card className="overflow-hidden">{body}</Card>
    </div>
  );
}
```

Notes for the implementer:
- `now` is intentionally re-derived when `params` changes so `created_since` moves with the clock between navigations, while staying stable inside one render cycle. Keep the eslint disable; the dependency is deliberate.
- The description text above the toolbar uses `total` from the current filtered query, matching the mockup ("143 workspaces cadastrados" when unfiltered).
- `JSX.Element` may need `import type { JSX } from 'react'` under React 19 types; add it if tsc asks.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/pages/__tests__/WorkspacesPage.test.tsx apps/admin/src/pages/__tests__/workspaces-export.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: 8 + existing PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/WorkspacesPage.tsx apps/admin/src/pages/__tests__/WorkspacesPage.test.tsx
git commit -m "feat(admin): página de Workspaces com estado na URL, filtros, ordenação, colunas e estados

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Pure at-risk helpers for the Dashboard

**Files:**
- Create: `apps/admin/src/pages/dashboard-risk.ts`
- Test: `apps/admin/src/pages/__tests__/dashboard-risk.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const TRIAL_ENDING_SOON_DAYS = 3;
  export function selectTrialsEndingSoon<T extends { trial_ends_at: string | null }>(trials: T[], now: Date, days?: number): T[];
  export function trialDeadlineLabel(trialEndsAt: string, now: Date): string;   // 'hoje' | 'amanhã' | 'em N dias'
  export function pendingLabel(sub: { failed_payment_count?: number | null; current_period_end?: string | null } | null | undefined, now: Date): string;
    // 'Nª tentativa' | 'vence hoje' | 'vence em N dias' | 'venceu há N dias' | '—'
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/pages/__tests__/dashboard-risk.test.ts
import { describe, expect, it } from 'vitest';
import { pendingLabel, selectTrialsEndingSoon, trialDeadlineLabel } from '../dashboard-risk';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('selectTrialsEndingSoon', () => {
  it('keeps trials ending between now and now + 3 days inclusive, soonest first', () => {
    const trials = [
      { id: 'late', trial_ends_at: at(3 * DAY + 1) },
      { id: 'edge', trial_ends_at: at(3 * DAY) },
      { id: 'past', trial_ends_at: at(-1) },
      { id: 'soon', trial_ends_at: at(DAY) },
      { id: 'now', trial_ends_at: at(0) },
      { id: 'unknown', trial_ends_at: null },
    ];
    expect(selectTrialsEndingSoon(trials, NOW).map((t) => t.id)).toEqual(['now', 'soon', 'edge']);
  });
  it('honours a custom window', () => {
    const trials = [{ id: 'a', trial_ends_at: at(6 * DAY) }];
    expect(selectTrialsEndingSoon(trials, NOW, 7)).toHaveLength(1);
    expect(selectTrialsEndingSoon(trials, NOW)).toHaveLength(0);
  });
});

describe('trialDeadlineLabel', () => {
  it('says hoje / amanhã / em N dias by calendar day', () => {
    expect(trialDeadlineLabel(at(2 * 3_600_000), NOW)).toBe('hoje');
    expect(trialDeadlineLabel(at(DAY), NOW)).toBe('amanhã');
    expect(trialDeadlineLabel(at(3 * DAY), NOW)).toBe('em 3 dias');
  });
});

describe('pendingLabel', () => {
  it('prefers the retry count', () => {
    expect(pendingLabel({ failed_payment_count: 3, current_period_end: at(DAY) }, NOW)).toBe('3ª tentativa');
    expect(pendingLabel({ failed_payment_count: 1, current_period_end: null }, NOW)).toBe('1ª tentativa');
  });
  it('falls back to the period end', () => {
    expect(pendingLabel({ failed_payment_count: 0, current_period_end: at(5 * DAY) }, NOW)).toBe('vence em 5 dias');
    expect(pendingLabel({ failed_payment_count: 0, current_period_end: at(3_600_000) }, NOW)).toBe('vence hoje');
    expect(pendingLabel({ failed_payment_count: 0, current_period_end: at(-2 * DAY) }, NOW)).toBe('venceu há 2 dias');
  });
  it('renders a dash when nothing is known', () => {
    expect(pendingLabel({ failed_payment_count: 0, current_period_end: null }, NOW)).toBe('—');
    expect(pendingLabel(null, NOW)).toBe('—');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/dashboard-risk.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/admin/src/pages/dashboard-risk.ts
/**
 * Pure helpers behind the Dashboard "Atenção" card. `now` is always injected so the
 * selectors and labels are deterministic in tests.
 */
const DAY_MS = 86_400_000;

export const TRIAL_ENDING_SOON_DAYS = 3;

/** Calendar-day distance (UTC) from `now` to `date`; negative when in the past. */
function calendarDays(date: Date, now: Date): number {
  const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((utc(date) - utc(now)) / DAY_MS);
}

export function selectTrialsEndingSoon<T extends { trial_ends_at: string | null }>(
  trials: T[],
  now: Date,
  days: number = TRIAL_ENDING_SOON_DAYS,
): T[] {
  const from = now.getTime();
  const to = from + days * DAY_MS;
  return trials
    .filter((t): t is T & { trial_ends_at: string } => t.trial_ends_at !== null)
    .map((t) => ({ t, ends: new Date(t.trial_ends_at).getTime() }))
    .filter(({ ends }) => Number.isFinite(ends) && ends >= from && ends <= to)
    .sort((a, b) => a.ends - b.ends)
    .map(({ t }) => t);
}

export function trialDeadlineLabel(trialEndsAt: string, now: Date): string {
  const days = calendarDays(new Date(trialEndsAt), now);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return `em ${days} dias`;
}

export function pendingLabel(
  sub: { failed_payment_count?: number | null; current_period_end?: string | null } | null | undefined,
  now: Date,
): string {
  if (!sub) return '—';
  const attempts = sub.failed_payment_count ?? 0;
  if (attempts > 0) return `${attempts}ª tentativa`;
  if (!sub.current_period_end) return '—';
  const days = calendarDays(new Date(sub.current_period_end), now);
  if (days === 0) return 'vence hoje';
  if (days > 0) return `vence em ${days} ${days === 1 ? 'dia' : 'dias'}`;
  const ago = -days;
  return `venceu há ${ago} ${ago === 1 ? 'dia' : 'dias'}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/admin/src/pages/__tests__/dashboard-risk.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/dashboard-risk.ts apps/admin/src/pages/__tests__/dashboard-risk.test.ts
git commit -m "feat(admin): seletores e rótulos puros do cartão Atenção do dashboard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: RiskCard, "Em risco" KPI and Dashboard translation

**Files:**
- Create: `apps/admin/src/pages/dashboard/RiskCard.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `apps/admin/src/pages/__tests__/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `Card*`, `Badge`, `Tabs*`, `Skeleton` (Task 1); `ErrorState` (Task 2); `selectTrialsEndingSoon`, `trialDeadlineLabel`, `pendingLabel`, `TRIAL_ENDING_SOON_DAYS` (Task 13); `listWorkspaces` with `{ status: 'pendente', sort: 'last_activity_at', dir: 'asc', limit: 5 }` (Task 7); `TrialWorkspace`, `WorkspaceSummary` (api.ts); `describeActivity` (`workspace-activity.ts`); `formatMoney`, `intervalSuffix` (`lib/subscription.ts`).
- Produces:
  ```ts
  export function RiskCard(props: {
    trials: { data: TrialWorkspace[] | undefined; loading: boolean; error: boolean; retry: () => void };
    pending: { data: { workspaces: WorkspaceSummary[]; total: number } | undefined; loading: boolean; error: boolean; retry: () => void };
    now: Date;
  }): JSX.Element;
  ```

- [ ] **Step 1: Update the existing Dashboard tests and add the new ones.** Replace the whole file:

```tsx
// apps/admin/src/pages/__tests__/DashboardPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '../../components/ui/tooltip';

vi.mock('../../lib/api', () => ({
  listWorkspaces: vi.fn(),
  listPlans: vi.fn(),
  getMrr: vi.fn(),
  getTrials: vi.fn(),
}));

import { getMrr, getTrials, listPlans, listWorkspaces, type ListWorkspacesParams } from '../../lib/api';
import DashboardPage from '../DashboardPage';

const DAY = 86_400_000;
const soon = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const RECENT = {
  total: 7,
  total_members: 12,
  total_clients: 31,
  total_with_overrides: 4,
  workspaces: [
    { id: 'a', name: 'A', member_count: 3, client_count: 4, has_overrides: false, created_at: soon(-10), last_activity_at: null, subscription: null, plan_name: 'Pro', owner: null, logo_url: null },
    { id: 'b', name: 'B', member_count: 2, client_count: 2, has_overrides: true, created_at: soon(-10), last_activity_at: null, subscription: null, plan_name: 'Pro', owner: null, logo_url: null },
  ],
};

const PENDING = {
  total: 6,
  total_members: 0,
  total_clients: 0,
  total_with_overrides: 0,
  workspaces: [
    {
      id: 'p1', name: 'Agência Norte', plan_name: 'Pro', logo_url: null, owner: null, member_count: 1, client_count: 1, has_overrides: false,
      created_at: soon(-200), last_activity_at: soon(-47),
      subscription: { status: 'past_due', plan_name: 'Pro', billing_interval: 'month', amount_cents: 19700, currency: 'brl', interval: 'month', discount_label: null, failed_payment_count: 3, current_period_end: null },
    },
  ],
};

// Implementations live in beforeEach: the global test setup runs
// vi.restoreAllMocks() after each test, wiping factory-time mocks.
beforeEach(() => {
  vi.mocked(listWorkspaces).mockImplementation(((params?: ListWorkspacesParams) =>
    Promise.resolve(params?.status === 'pendente' ? PENDING : RECENT)) as never);
  vi.mocked(listPlans).mockResolvedValue({ plans: [{ id: 'p1' }, { id: 'p2' }] } as never);
  // The Stripe-backed queries never resolve by default: the other cards must not wait for them.
  vi.mocked(getMrr).mockReturnValue(new Promise(() => {}) as never);
  vi.mocked(getTrials).mockReturnValue(new Promise(() => {}) as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** The KPI card element whose label text is `label` (labels are <p>; table headers are <span>). */
function kpiCard(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'p' }).closest('div')!;
}

describe('DashboardPage per-card loading', () => {
  it('shows workspace and plan KPIs while the Stripe-backed queries are still loading', async () => {
    renderPage();
    await waitFor(() => expect(kpiCard('Workspaces').textContent).toContain('7'));
    expect(kpiCard('Usuários').textContent).toContain('12');
    expect(kpiCard('Clientes').textContent).toContain('31');
    expect(kpiCard('Planos ativos').textContent).toContain('2');
    expect(kpiCard('Com overrides').textContent).toContain('4');
  });

  it('keeps the MRR-dependent cards on their placeholder while pending', async () => {
    renderPage();
    await waitFor(() => expect(kpiCard('Workspaces').textContent).toContain('7'));
    expect(kpiCard('MRR').textContent).toContain('—');
    expect(kpiCard('Testes').textContent).toContain('—');
    expect(kpiCard('MRR total').textContent).toContain('—');
    expect(kpiCard('Em risco').textContent).toContain('—');
  });
});

describe('DashboardPage at-risk card', () => {
  it('sums trials ending soon and pending subscriptions into the Em risco KPI', async () => {
    vi.mocked(getTrials).mockResolvedValue({
      trial_count: 3,
      trial_mrr_cents: 0,
      currency: 'brl',
      trials: [
        { workspace_id: 't1', name: 'Nova Onda', plan_name: 'Pro', interval: 'month', trial_ends_at: soon(1), monthly_cents: 19700, owner_name: null, owner_email: null, owner_telefone: null, owner_marketing_opt_in: false, created_at: soon(-5), last_activity_at: soon(-1) },
        { workspace_id: 't2', name: 'Longe', plan_name: 'Pro', interval: 'month', trial_ends_at: soon(20), monthly_cents: 19700, owner_name: null, owner_email: null, owner_telefone: null, owner_marketing_opt_in: false, created_at: soon(-5), last_activity_at: null },
      ],
    } as never);
    renderPage();
    await waitFor(() => expect(kpiCard('Em risco').textContent).toContain('7')); // 1 trial + 6 pending
    expect(kpiCard('Em risco').textContent).toContain('1 teste vencendo');
    expect(kpiCard('Em risco').textContent).toContain('6 pendentes');

    expect(await screen.findByText('Nova Onda')).toBeInTheDocument();
    expect(screen.queryByText('Longe')).toBeNull();
    expect(screen.getByText('amanhã')).toBeInTheDocument();
    expect(screen.getByText('Agência Norte')).toBeInTheDocument();
    expect(screen.getByText('3ª tentativa')).toBeInTheDocument();
    expect(screen.getByText('+5 workspaces')).toBeInTheDocument();
  });

  it('shows "Tudo em ordem" when both groups are empty', async () => {
    vi.mocked(getTrials).mockResolvedValue({ trial_count: 0, trial_mrr_cents: 0, currency: 'brl', trials: [] } as never);
    vi.mocked(listWorkspaces).mockImplementation(((params?: ListWorkspacesParams) =>
      Promise.resolve(params?.status === 'pendente' ? { ...PENDING, total: 0, workspaces: [] } : RECENT)) as never);
    renderPage();
    expect(await screen.findByText(/Tudo em ordem/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/DashboardPage.test.tsx`
Expected: FAIL (English labels, no Em risco card).

- [ ] **Step 3: Implement `RiskCard.tsx`**

```tsx
// apps/admin/src/pages/dashboard/RiskCard.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TrialWorkspace, WorkspaceSummary } from '../../lib/api';
import { formatMoney, intervalSuffix } from '../../lib/subscription';
import { cn } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ErrorState } from '../../components/ErrorState';
import { pendingLabel, selectTrialsEndingSoon, TRIAL_ENDING_SOON_DAYS, trialDeadlineLabel } from '../dashboard-risk';
import { describeActivity } from '../workspace-activity';

const MAX_ROWS = 5;

interface Source<T> {
  data: T | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

interface RiskCardProps {
  trials: Source<TrialWorkspace[]>;
  pending: Source<{ workspaces: WorkspaceSummary[]; total: number }>;
  now: Date;
}

type View = 'todos' | 'testes' | 'pendentes';

function GroupRows({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col divide-y divide-border/60">{children}</ul>;
}

function Row({ name, meta, right, tone, onClick }: { name: string; meta: string; right: string; tone: 'warning' | 'danger'; onClick: () => void }) {
  return (
    <li onClick={onClick} className="flex cursor-pointer items-center justify-between gap-3 py-2 hover:bg-secondary/30">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{name}</div>
        <div className="truncate text-xs text-muted-foreground">{meta}</div>
      </div>
      <span className={cn('shrink-0 text-xs', tone === 'warning' ? 'text-warning' : 'text-destructive')}>{right}</span>
    </li>
  );
}

function GroupSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-2">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-3 w-3/4" />)}
    </div>
  );
}

export function RiskCard({ trials, pending, now }: RiskCardProps) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('todos');

  const endingSoon = trials.data ? selectTrialsEndingSoon(trials.data, now) : [];
  const pendingRows = pending.data?.workspaces ?? [];
  const pendingTotal = pending.data?.total ?? 0;

  const bothLoaded = !trials.loading && !pending.loading && !trials.error && !pending.error;
  const allClear = bothLoaded && endingSoon.length === 0 && pendingTotal === 0;

  const showTrials = view !== 'pendentes';
  const showPending = view !== 'testes';

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Atenção</CardTitle>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-8">
            <TabsTrigger value="todos" className="text-xs">Todos</TabsTrigger>
            <TabsTrigger value="testes" className="text-xs">Testes</TabsTrigger>
            <TabsTrigger value="pendentes" className="text-xs">Pendentes</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      {allClear ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">Tudo em ordem: nenhum teste vencendo nem pagamento pendente.</p>
        </CardContent>
      ) : (
        <div className={cn('grid', showTrials && showPending && 'md:grid-cols-2 md:divide-x md:divide-border')}>
          {showTrials ? (
            <section className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <Badge variant="warning">{endingSoon.length}</Badge>
                Testes terminando em até {TRIAL_ENDING_SOON_DAYS} dias
                <Link to="/admin/workspaces?status=teste" className="ml-auto font-normal text-dim-foreground hover:text-foreground">
                  ver todos os testes →
                </Link>
              </h3>
              {trials.loading ? <GroupSkeleton /> : trials.error ? (
                <ErrorState message="Não foi possível carregar os testes." onRetry={trials.retry} />
              ) : endingSoon.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">Nenhum teste vence nos próximos {TRIAL_ENDING_SOON_DAYS} dias.</p>
              ) : (
                <GroupRows>
                  {endingSoon.slice(0, MAX_ROWS).map((t) => (
                    <Row
                      key={t.workspace_id}
                      name={t.name}
                      meta={`${t.plan_name ?? 'Sem plano'} · ${formatMoney(t.monthly_cents)}/mês · ${describeActivity(t.last_activity_at, t.created_at ?? now.toISOString(), now).label}`}
                      right={trialDeadlineLabel(t.trial_ends_at!, now)}
                      tone="warning"
                      onClick={() => navigate(`/admin/workspaces/${t.workspace_id}`)}
                    />
                  ))}
                  {endingSoon.length > MAX_ROWS ? (
                    <li className="py-2 text-xs text-muted-foreground">+{endingSoon.length - MAX_ROWS} workspaces</li>
                  ) : null}
                </GroupRows>
              )}
            </section>
          ) : null}

          {showPending ? (
            <section className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <Badge variant="danger">{pendingTotal}</Badge>
                Pagamento pendente
                <Link to="/admin/workspaces?status=pendente" className="ml-auto font-normal text-dim-foreground hover:text-foreground">
                  ver todos →
                </Link>
              </h3>
              {pending.loading ? <GroupSkeleton /> : pending.error ? (
                <ErrorState message="Não foi possível carregar os pagamentos pendentes." onRetry={pending.retry} />
              ) : pendingRows.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">Nenhum pagamento pendente.</p>
              ) : (
                <GroupRows>
                  {pendingRows.slice(0, MAX_ROWS).map((ws) => (
                    <Row
                      key={ws.id}
                      name={ws.name}
                      meta={`${ws.plan_name ?? 'Sem plano'} · ${formatMoney(ws.subscription?.amount_cents, ws.subscription?.currency)}${intervalSuffix(ws.subscription?.interval)} · ${describeActivity(ws.last_activity_at, ws.created_at, now).label}`}
                      right={pendingLabel(ws.subscription, now)}
                      tone="danger"
                      onClick={() => navigate(`/admin/workspaces/${ws.id}`)}
                    />
                  ))}
                  {pendingTotal > MAX_ROWS ? (
                    <li className="py-2 text-xs text-muted-foreground">+{pendingTotal - MAX_ROWS} workspaces</li>
                  ) : null}
                </GroupRows>
              )}
            </section>
          ) : null}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Wire the Dashboard.** In `DashboardPage.tsx`:

1. Add imports: `import { RiskCard } from './dashboard/RiskCard';`, `import { selectTrialsEndingSoon } from './dashboard-risk';`, `import { PageHeader } from '../components/PageHeader';`.
2. After the `trials` query add:

```tsx
  // Past-due subscriptions, least-recently-active first. total feeds the KPI, rows feed the card.
  const pendingQuery = useQuery({
    queryKey: ['admin', 'workspaces', { status: 'pendente', sort: 'last_activity_at', dir: 'asc', limit: 5 }],
    queryFn: () => listWorkspaces({ status: 'pendente', sort: 'last_activity_at', dir: 'asc', offset: 0, limit: 5 }),
  });
  const now = new Date();
  const endingSoonCount = trialsData ? selectTrialsEndingSoon(trialsData.trials, now).length : 0;
  const pendingCount = pendingQuery.data?.total ?? 0;
```

3. Replace the `kpis` array labels and insert "Em risco" after "Testes":

```tsx
  const kpis: { label: string; value: string | number; sub?: string; loading: boolean; tone?: 'warning' }[] = [
    { label: 'Workspaces', value: totalWorkspaces, loading: wsLoading },
    { label: 'Usuários', value: totalMembers, loading: wsLoading },
    { label: 'Clientes', value: totalClients, loading: wsLoading },
    { label: 'Planos ativos', value: activePlans, loading: plansLoading },
    { label: 'Com overrides', value: withOverrides, loading: wsLoading },
    { label: 'MRR', value: kpiMoney(mrrData?.mrr_cents ?? null), sub: mrrData ? `${mrrData.paying_count} pagantes` : undefined, loading: mrrLoading },
    { label: 'Testes', value: kpiMoney(trialMrrCents), sub: trialsData ? `${trialsData.trial_count} em teste` : undefined, loading: trialsLoading },
    {
      label: 'Em risco',
      value: endingSoonCount + pendingCount,
      sub: `${endingSoonCount} ${endingSoonCount === 1 ? 'teste vencendo' : 'testes vencendo'} · ${pendingCount} ${pendingCount === 1 ? 'pendente' : 'pendentes'}`,
      loading: trialsLoading || pendingQuery.isPending,
      tone: endingSoonCount + pendingCount > 0 ? 'warning' : undefined,
    },
    { label: 'MRR total', value: kpiMoney(totalMrrCents), sub: 'MRR + testes', loading: mrrLoading || trialsLoading },
  ];
```

4. In the KPI tile markup, apply the tone: `className={cn('text-2xl sm:text-3xl font-bold font-sf break-words', kpi.tone === 'warning' && 'text-warning')}` (import `cn` from `../lib/utils`).
5. Replace the `<h1>`/`<p>` header with `<PageHeader title="Dashboard" description="Visão geral da plataforma" />`.
6. Directly after the KPI grid, render:

```tsx
      <RiskCard
        now={now}
        trials={{ data: trialsData?.trials, loading: trialsLoading, error: trialsQuery.isError, retry: () => trialsQuery.refetch() }}
        pending={{ data: pendingQuery.data ? { workspaces: pendingQuery.data.workspaces, total: pendingQuery.data.total } : undefined, loading: pendingQuery.isPending, error: pendingQuery.isError, retry: () => pendingQuery.refetch() }}
      />
```

   For this, change the trials query destructuring to keep the query object: `const trialsQuery = useQuery({...}); const trialsData = trialsQuery.data; const trialsLoading = trialsQuery.isLoading;`.
7. Translate the rest of the page's strings: "Nothing to export" → "Nada para exportar"; "Paying Workspaces" → "Workspaces pagantes"; "Trials" (section h2) → "Testes"; "Export CSV" → "Exportar CSV"; "Recent Workspaces" → "Workspaces recentes"; table headers "Workspace / Plan / Trial ends / Last Activity / MRR / Owner / Status / Interval" → "Workspace / Plano / Fim do teste / Última atividade / MRR / Dono / Status / Intervalo"; "No paying workspaces yet." → "Nenhum workspace pagante ainda."; "No workspaces on trial right now." → "Nenhum workspace em teste no momento."; "Loading..." → "Carregando…"; any "View all" style link → "Ver todos". Grep the file for `[A-Z][a-z]+ [A-Z]` and `'[A-Z]` afterwards to catch stragglers. Also replace the two `toneBadgeClass(...)` pill spans with `<Badge variant={...}>` using the same `STATUS_VARIANT` mapping as the table (`success → success, warning → warning, danger → danger, muted → neutral`), and the plan pills with the `PlanBadge` pattern (`<Badge variant="neutral" style={{ color, backgroundColor: `${color}26` }}>`). Remove the now-unused `toneBadgeClass` import.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/admin/src/pages/__tests__/DashboardPage.test.tsx apps/admin/src/pages/__tests__/dashboard-export.test.ts && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: 4 PASS + existing export tests PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/dashboard apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/__tests__/DashboardPage.test.tsx
git commit -m "feat(admin): cartão Atenção e KPI Em risco no dashboard, copy em português

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Portuguese pass on the remaining pages

**Files:**
- Modify: `apps/admin/src/layouts/AdminLayout.tsx`, `apps/admin/src/pages/{AdminsPage,PlansPage,BannersPage,PopupsPage,KbArticlesPage,KbArticleEditorPage,WorkspaceDetailPage,WorkspaceInvitesCard,WorkspaceEventsCard}.tsx`, `apps/admin/src/components/TargetPicker.tsx`, `apps/admin/src/pages/workspaces-export.ts`, `apps/admin/src/pages/dashboard-export.ts`
- Modify tests that assert English labels: `apps/admin/src/pages/__tests__/{workspaces-export,dashboard-export,workspace-invites,workspace-events,WorkspaceInvitesCard}.test.ts(x)` as needed

**Interfaces:** copy only; no signatures change.

- [ ] **Step 1: Inventory the English strings**

```bash
grep -rnoE "(>|placeholder=\"|title=\"|label: ')[A-Z][A-Za-z0-9 .…'/-]{2,60}(<|\"|')" apps/admin/src/pages/*.tsx apps/admin/src/layouts/*.tsx apps/admin/src/components/*.tsx | grep -vE ">(Dashboard|Workspaces|Admins|Banners|Popups|Stripe|MRR|CSV|Sair)<"
```

Save the output; every hit must be translated or be a product term.

- [ ] **Step 2: Apply the translation table.** Use exact replacements; keep product terms.

| English | Português |
|---|---|
| Plans (nav + h1) | Planos |
| Articles (nav) / Knowledge Base (h1) | Artigos / Base de conhecimento |
| Platform administrators | Administradores da plataforma |
| Manage plan templates | Gerencie os planos |
| Manage global announcements | Gerencie os avisos globais |
| Manage help articles for CRM users | Gerencie os artigos de ajuda do CRM |
| All Plans / All Statuses / All Categories / All events | Todos os planos / Todos os status / Todas as categorias / Todos os eventos |
| Search banners... / Search popups... / Search articles... | Buscar banners… / Buscar popups… / Buscar artigos… |
| Email do novo admin... | E-mail do novo admin… |
| Loading... / Loading… / Loading content... | Carregando… |
| No articles found. / No banners found. / No popups found. / No events found. / No invites. / No keys. / No connections. | Nenhum artigo encontrado. / Nenhum banner encontrado. / Nenhum popup encontrado. / Nenhum evento encontrado. / Nenhum convite. / Nenhuma chave. / Nenhuma conexão. |
| Name / Email / Phone / Role / Joined / Added / Created / Status / Type / Title / Category / Order / Frequency / Schedule / Target / Content / Details / Notes / Actions / Actor / Event / When / Owner / Plan / Members / Clients | Nome / E-mail / Telefone / Papel / Entrou em / Adicionado em / Criado em / Status / Tipo / Título / Categoria / Ordem / Frequência / Agendamento / Público / Conteúdo / Detalhes / Notas / Ações / Autor / Evento / Quando / Dono / Plano / Membros / Clientes |
| Invited By / Sent | Convidado por / Enviado |
| Draft / Published / Archived / Active / Expired (badges, any case) | Rascunho / Publicado / Arquivado / Ativo / Expirado |
| Resource Limits / Feature Flags / Rate Limits | Limites de recursos / Funcionalidades / Limites de taxa |
| MCP API Keys / MCP OAuth Connections | Chaves de API do MCP / Conexões OAuth do MCP |
| Admin notes... | Notas do admin… |
| Opted in to marketing contact | Aceitou contato de marketing |
| No plan / None | Sem plano / Nenhum |
| Live preview / Remove cover / Select category / Select page / CTA style | Prévia ao vivo / Remover capa / Selecionar categoria / Selecionar página / Estilo do CTA |
| Auth state / Billing / Analytics | Estado de autenticação / Cobrança / Analytics |
| How to add a client (example/placeholder text) | Como adicionar um cliente |
| Nothing to export / Export CSV / Exporting… / Export failed | Nada para exportar / Exportar CSV / Exportando… / Falha ao exportar |
| Sem assinatura Stripe. | Sem assinatura Stripe. (already Portuguese, keep) |

CSV header labels (`WORKSPACE_EXPORT_COLUMNS`, `PAYING_WORKSPACE_EXPORT_COLUMNS`, `TRIAL_EXPORT_COLUMNS`): Workspace, Nome do dono, E-mail do dono, Telefone do dono, Aceita marketing, Plano, Status da assinatura, Intervalo, Valor da assinatura (R$), Valor mensal (R$), Desconto, Clientes, Membros, Tem overrides, Criado em, Última atividade, Fim do teste, MRR mensal (R$). Boolean cells `yes`/`no` become `sim`/`não`.

Strings that already are Portuguese ("Sair", "Ativo", "Página não encontrada.") stay. Do not touch `LoginPage.tsx` (no English strings) or anything under `components/editor/` (toolbar tooltips there are covered by Phase 2).

- [ ] **Step 3: Update tests that pinned English labels**

Run the admin test folder and fix each assertion to the new Portuguese text (same test intent, new string):

```bash
npx vitest run apps/admin
```

Typical edits: `expect(header).toContain('Owner Email')` → `'E-mail do dono'`; `'yes'`/`'no'` → `'sim'`/`'não'`; `'Invited By'` → `'Convidado por'`.

- [ ] **Step 4: Re-run the inventory and the full admin suite**

```bash
grep -rnoE "(>|placeholder=\"|title=\"|label: ')[A-Z][A-Za-z0-9 .…'/-]{2,60}(<|\"|')" apps/admin/src/pages/*.tsx apps/admin/src/layouts/*.tsx apps/admin/src/components/*.tsx | grep -vE ">(Dashboard|Workspaces|Admins|Banners|Popups|Stripe|MRR|CSV|Sair|Analytics|Status|MRR total|MRR mensal)"
npx vitest run apps/admin && npx tsc -p apps/admin/tsconfig.json --noEmit
```

Expected: the grep prints only product terms or Portuguese words that happen to start with a capital; all tests PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src
git commit -m "chore(admin): copy em português em todas as páginas do admin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Design-system note, full verification, browser check, PR

**Files:**
- Modify: `DESIGN_SYSTEM.md` (Admin section)
- Verify: everything

- [ ] **Step 1: Document the copied primitives.** In `DESIGN_SYSTEM.md`, under the `## Admin (\`apps/admin\`)` section, append:

```markdown
### Primitives

`apps/admin/src/components/ui/` holds **copies** of the CRM's shadcn primitives (button, input,
select, table, dropdown-menu, checkbox, skeleton, tabs, label, separator, tooltip), plus an
admin-only `badge.tsx` (same API as the CRM Badge, implemented on Tailwind tokens because the
admin does not load `apps/crm/style.css`) and `card.tsx`. They import `cn` from
`../../lib/utils`, never `@/lib/utils`. A fix to a primitive on one side must be mirrored on the
other by hand; nothing enforces parity. Composition components (`EmptyState`, `ErrorState`,
`PageHeader`) live in `apps/admin/src/components/`.
```

- [ ] **Step 2: Run the complete local gate**

```bash
npm run lint
npm run format            # then re-run format:check
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions; git checkout deno.lock
npm run test:db           # Docker; skip with a note in the PR if unavailable
```

Expected: all green. Commit any formatter changes: `git commit -am "style: prettier" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

- [ ] **Step 3: Browser check against staging (the RPC must exist there first).**

Check the linked project first: `cat supabase/.temp/project-ref` (staging is `wlyzhyfondykzpsiqsce`). If the worktree is unlinked, use `--project-ref` explicitly.

```bash
npx supabase db push --project-ref wlyzhyfondykzpsiqsce
npx supabase functions deploy platform-admin --use-api --project-ref wlyzhyfondykzpsiqsce
```

If `db push` refuses because of unrelated pending migrations on staging (known drift), apply just this file with the Management API SQL endpoint per `reference_staging_ops_management_api`, and say so in the PR.

Then open the admin against staging with the Browser pane (`preview_start` on a `.claude/launch.json` entry running `npm run dev:admin:staging`, port 5177), log in, and verify on `/admin/workspaces`:
1. Type in the search box: URL gains `?q=` after ~300 ms, table dims then refreshes.
2. Pick Status → Pagamento pendente: chip appears, `?status=pendente` in the URL, count updates.
3. Click "Clientes" header twice: arrow flips, URL shows `ord=client_count` then `dir=asc`.
4. Hide "Dono" in Colunas, reload: it stays hidden.
5. Change page size to 50; "1–50 de N" shows; navigate pages.
6. Clear filters via the chip link; empty state with "Limpar filtros" when no rows match.
7. Export CSV with a filter active: the file only contains matching rows.
8. `/admin`: "Em risco" KPI and "Atenção" card render; group links open the pre-filtered list.
9. Toggle light mode: badges, selects and table remain legible.
Take a screenshot of the Workspaces page and of the Dashboard card for the PR.

- [ ] **Step 4: Migration version re-check and push**

```bash
git fetch origin main
git ls-tree --name-only origin/main:supabase/migrations | tail -3
```

If any file on `origin/main` has a prefix ≥ `20260907000030`, rename the migration (and the two references to its filename in `subscription.ts` and `list-workspaces.ts` comments) to a higher unique version, then:

```bash
git push -u origin feat/admin-portal-revamp-phase1
gh pr create --title "feat(admin): revamp fase 1 — primitivos, filtros/ordenação de Workspaces, cartão Atenção" --body-file - <<'EOF'
## Resumo
Fase 1 do revamp do Admin (spec: docs/superpowers/specs/2026-09-04-admin-portal-revamp-phase1-design.md).

- Primitivos shadcn copiados do CRM para o Admin (+ Badge nos tokens do Admin, Card, EmptyState/ErrorState/PageHeader)
- `admin_list_workspaces` v5: filtros de status/overrides/atividade/data, ordenação, busca por e-mail do dono; suítes psql 70–73
- Workspaces: estado na URL, selects inline + chips, cabeçalhos ordenáveis, colunas/densidade persistidas, skeleton/vazio/erro, paginação com tamanho de página
- Dashboard: KPI "Em risco" + cartão "Atenção" (testes vencendo em 3 dias, pagamentos pendentes)
- Copy em português em todo o Admin

## Rollout (ANTES do merge)
1. `npx supabase db push` em produção (migration retrocompatível)
2. `npx supabase functions deploy platform-admin --use-api` em produção
3. Merge

## Verificação
- lint, prettier, tsc ×4, vitest, deno test: verdes localmente
- psql 70–73: <verde localmente | apenas CI, sem Docker local>
- Browser (staging): fluxo dos 9 passos do Task 16 verificado; screenshots abaixo

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Codex review.** A second-opinion review fires on `gh pr create`. Read the comment body, verify each finding against the code, fix what holds up, and reply to what doesn't.

---

## Self-review against the spec

- §1 primitives + rewritten Badge + Card → Task 1; EmptyState/ErrorState/PageHeader → Task 2. ✔
- §2.1 RPC with 11 params, enrichment before filters, single last_activity call, NULLS FIRST on asc, owner e-mail search, subscription fields → Task 4. §2.4 edge pass-through → Task 5. §2.5 api types → Task 7. ✔
- §2.2/2.3 status groups and activity buckets: SQL in Task 4, TS `statusGroup` in Task 3, labels in Task 7. ✔
- §3.1 URL state (parse/serialize/defaults omitted/invalid fallback/created_since/`reset()` scope/replace on q/debounce) → Tasks 7, 8, 11. ✔
- §3.2 toolbar order and highlight → Task 11. §3.3 chips + "Limpar filtros" + count → Task 11. ✔
- §3.4 table columns, sortable headers with `aria-sort`, density, localStorage prefs, mobile cards → Tasks 9, 10. ✔
- §3.5 footer (range, page size, window with gaps) → Task 10. §3.6 states incl. `keepPreviousData` dimming → Tasks 10, 12. ✔
- §4.1 KPI "Em risco" after "Testes" → Task 14. §4.2 card with two groups, tabs, 5 rows + "+N", "ver todos os testes →", "Tudo em ordem", per-group errors → Tasks 13, 14. ✔
- §5 Portuguese: Dashboard in Task 14, everything else in Task 15, CSV headers included. ✔
- §6 tests: Vitest per module (Tasks 1–3, 7–14), Deno (Task 5), psql 70–73 (Task 6). ✔
- §7 rollout order → Task 16 PR body; version re-check → Task 16 Step 4. ✔
- Type names are consistent across tasks: `WorkspacesListParams`, `WorkspaceStatusGroup`, `WorkspaceActivityBucket`, `WorkspaceSortKey`, `SortDir`, `PageSize`, `ColumnPrefs`, `WorkspaceColumnKey`, `Density`, `ListWorkspacesParams`, `ListWorkspacesResponse`.
