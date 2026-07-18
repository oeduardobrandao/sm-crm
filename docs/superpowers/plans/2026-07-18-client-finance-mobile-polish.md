# Client Finance Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all three client finance KPIs on one mobile row and replace right-aligned empty table rows with useful, accessible empty states.

**Architecture:** Add one focused presentational component for finance empty states, then conditionally render it instead of an empty table. Scope the KPI override and empty-state styling to the client finance section so generic KPI and table behavior elsewhere remains unchanged.

**Tech Stack:** React 19, TypeScript, React Router, Lucide React, Tailwind utility classes, shared CSS, Vitest, Testing Library, i18next JSON resources.

## Global Constraints

- Preserve the existing desktop layout and populated contract and transaction tables.
- Use Lucide React icons exclusively.
- Keep the three finance KPI cards on one row at phone widths without horizontal page overflow.
- Use React Router navigation for `/contratos` and `/financeiro`.
- Add equivalent Portuguese and English copy.
- Do not change finance calculations, queries, or mutation flows.

---

### Task 1: Accessible finance empty-state component

**Files:**
- Create: `apps/crm/src/pages/cliente-detalhe/ClienteFinanceEmptyState.tsx`
- Create: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceEmptyState.test.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button`, `Link` from `react-router-dom`, and `LucideIcon` from `lucide-react`.
- Produces: `ClienteFinanceEmptyState(props: ClienteFinanceEmptyStateProps): JSX.Element`, where props are `icon`, `title`, `description`, `actionLabel`, and `actionHref`.

- [ ] **Step 1: Write the failing component test**

```tsx
import { render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ClienteFinanceEmptyState } from '../ClienteFinanceEmptyState';

describe('ClienteFinanceEmptyState', () => {
  it('renders descriptive copy and an accessible client-finance action link', () => {
    const { container } = render(
      <MemoryRouter>
        <ClienteFinanceEmptyState
          icon={FileText}
          title="Nenhum contrato cadastrado"
          description="Os contratos vinculados a este cliente aparecerão aqui."
          actionLabel="Gerenciar contratos"
          actionHref="/contratos"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Nenhum contrato cadastrado' })).toBeVisible();
    expect(
      screen.getByText('Os contratos vinculados a este cliente aparecerão aqui.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Gerenciar contratos' })).toHaveAttribute(
      'href',
      '/contratos',
    );
    expect(container.querySelector('.cliente-finance-empty__icon')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing component fails**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceEmptyState.test.tsx`

Expected: FAIL because `../ClienteFinanceEmptyState` does not exist.

- [ ] **Step 3: Implement the minimal presentational component**

```tsx
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface ClienteFinanceEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

export function ClienteFinanceEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: ClienteFinanceEmptyStateProps) {
  return (
    <div className="cliente-finance-empty">
      <span className="cliente-finance-empty__icon" aria-hidden="true">
        <Icon />
      </span>
      <h4 className="cliente-finance-empty__title">{title}</h4>
      <p className="cliente-finance-empty__description">{description}</p>
      <Button asChild variant="outline" size="sm" className="cliente-finance-empty__action">
        <Link to={actionHref}>
          {actionLabel}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceEmptyState.test.tsx`

Expected: PASS, 1 test.

- [ ] **Step 5: Commit the isolated component**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteFinanceEmptyState.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceEmptyState.test.tsx
git commit -m "feat: add client finance empty state"
```

---

### Task 2: Integrate empty states and the three-column mobile KPI row

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx:1-25,1768-1875`
- Modify: `apps/crm/style.css:8420-8595`
- Modify: `packages/i18n/locales/pt/clients.json:190-214`
- Modify: `packages/i18n/locales/en/clients.json:190-214`
- Create: `apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx`

**Interfaces:**
- Consumes: `ClienteFinanceEmptyState` from Task 1 and existing `contratosCliente` and `transacoesCliente` arrays.
- Produces: scoped CSS hooks `cliente-finance-kpis` and `cliente-finance-empty*`, plus translation keys `noContractsDescription`, `manageContracts`, `noTransactionsDescription`, and `viewFinancial`.

- [ ] **Step 1: Write the failing responsive and integration contract tests**

```tsx
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ptClients from '../../../../../../packages/i18n/locales/pt/clients.json';
import enClients from '../../../../../../packages/i18n/locales/en/clients.json';

const css = readFileSync('apps/crm/style.css', 'utf8');
const source = readFileSync(
  'apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx',
  'utf8',
);

describe('client finance responsive contracts', () => {
  it('keeps all three finance KPIs in equal shrinkable columns on phones', () => {
    expect(source).toContain('className="kpi-grid cliente-finance-kpis"');
    expect(css).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*\.cliente-finance-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.cliente-finance-kpis\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*auto[^}]*max-width:\s*none/s,
    );
    expect(css).toMatch(
      /\.cliente-finance-kpis \.kpi-value\s*\{[^}]*white-space:\s*nowrap/s,
    );
  });

  it('uses dedicated empty states instead of empty table rows', () => {
    expect(source).toContain('<ClienteFinanceEmptyState');
    expect(source).toContain('actionHref="/contratos"');
    expect(source).toContain('actionHref="/financeiro"');
    expect(source).not.toMatch(/<TableCell[^>]*colSpan=\{4\}[\s\S]*detail\.noContracts/s);
    expect(source).not.toMatch(/<TableCell[^>]*colSpan=\{4\}[\s\S]*detail\.noTransactions/s);
  });

  it('provides equivalent Portuguese and English empty-state copy', () => {
    expect(ptClients.detail).toMatchObject({
      noContracts: 'Nenhum contrato cadastrado',
      noContractsDescription: 'Os contratos vinculados a este cliente aparecerão aqui.',
      manageContracts: 'Gerenciar contratos',
      noTransactions: 'Nenhuma transação registrada',
      noTransactionsDescription:
        'Os lançamentos financeiros deste cliente aparecerão aqui.',
      viewFinancial: 'Ver financeiro',
    });
    expect(enClients.detail).toMatchObject({
      noContracts: 'No contracts registered',
      noContractsDescription: 'Contracts linked to this client will appear here.',
      manageContracts: 'Manage contracts',
      noTransactions: 'No transactions recorded',
      noTransactionsDescription: 'Financial entries for this client will appear here.',
      viewFinancial: 'View finances',
    });
  });
});
```

- [ ] **Step 2: Run the responsive contract test and verify all three requirements fail**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx`

Expected: FAIL because the scoped class, empty-state integration, CSS, and new translations are absent.

- [ ] **Step 3: Add translations in Portuguese and English**

In `packages/i18n/locales/pt/clients.json`, replace and extend the empty-state keys:

```json
"noContracts": "Nenhum contrato cadastrado",
"noContractsDescription": "Os contratos vinculados a este cliente aparecerão aqui.",
"manageContracts": "Gerenciar contratos",
"noTransactions": "Nenhuma transação registrada",
"noTransactionsDescription": "Os lançamentos financeiros deste cliente aparecerão aqui.",
"viewFinancial": "Ver financeiro"
```

In `packages/i18n/locales/en/clients.json`, add the equivalent keys:

```json
"noContracts": "No contracts registered",
"noContractsDescription": "Contracts linked to this client will appear here.",
"manageContracts": "Manage contracts",
"noTransactions": "No transactions recorded",
"noTransactionsDescription": "Financial entries for this client will appear here.",
"viewFinancial": "View finances"
```

- [ ] **Step 4: Integrate the component and render tables only for populated data**

Add `FileText` and `ReceiptText` to the existing `lucide-react` import and import the component:

```tsx
import { ClienteFinanceEmptyState } from './ClienteFinanceEmptyState';
```

Change the KPI wrapper to:

```tsx
<div
  id="sec-financeiro"
  className="kpi-grid cliente-finance-kpis"
  style={{ marginBottom: '1.5rem' }}
>
```

For contracts, render the empty state before creating a table:

```tsx
{contratosCliente.length === 0 ? (
  <ClienteFinanceEmptyState
    icon={FileText}
    title={t('detail.noContracts')}
    description={t('detail.noContractsDescription')}
    actionLabel={t('detail.manageContracts')}
    actionHref="/contratos"
  />
) : (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>{t('detail.contractTitle')}</TableHead>
        <TableHead>{t('detail.contractPeriod')}</TableHead>
        <TableHead>{t('detail.contractValue')}</TableHead>
        <TableHead>{t('detail.contractStatus')}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {contratosCliente.map((r) => (
        <TableRow key={r.id ?? Math.random()}>
          <TableCell data-label={t('detail.contractTitle')}>{r.titulo}</TableCell>
          <TableCell data-label={t('detail.contractPeriod')}>
            {formatDate(r.data_inicio)} – {formatDate(r.data_fim)}
          </TableCell>
          <TableCell data-label={t('detail.contractValue')}>
            {formatBRL(Number(r.valor_total))}
          </TableCell>
          <TableCell data-label={t('detail.contractStatus')}>
            <StatusBadge status={r.status} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
)}
```

For transactions, use the equivalent structure:

```tsx
{transacoesCliente.length === 0 ? (
  <ClienteFinanceEmptyState
    icon={ReceiptText}
    title={t('detail.noTransactions')}
    description={t('detail.noTransactionsDescription')}
    actionLabel={t('detail.viewFinancial')}
    actionHref="/financeiro"
  />
) : (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>{t('detail.txDescription')}</TableHead>
        <TableHead>{t('detail.txDate')}</TableHead>
        <TableHead>{t('detail.txValue')}</TableHead>
        <TableHead>{t('detail.txStatus')}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {transacoesCliente.map((r) => (
        <TableRow key={r.id ?? Math.random()}>
          <TableCell data-label={t('detail.txDescription')}>{r.descricao}</TableCell>
          <TableCell data-label={t('detail.txDate')}>{formatDate(r.data)}</TableCell>
          <TableCell data-label={t('detail.txValue')}>
            <span
              style={{
                color: r.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)',
                fontWeight: 600,
              }}
            >
              {r.tipo === 'entrada' ? '+' : '-'}
              {formatBRL(Number(r.valor))}
            </span>
          </TableCell>
          <TableCell data-label={t('detail.txStatus')}>
            <StatusBadge status={r.status ?? 'pago'} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
)}
```

- [ ] **Step 5: Add scoped empty-state and phone KPI styles**

Add the base empty-state styles near the existing client-detail responsive styles:

```css
.cliente-finance-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 1.25rem;
  border: 1px dashed var(--border-color);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-main) 94%, var(--text-muted));
  text-align: center;
}

.cliente-finance-empty__icon {
  display: inline-flex;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary-color) 14%, var(--surface-main));
  color: var(--text-main);
}

.cliente-finance-empty__icon svg { width: 20px; height: 20px; }
.cliente-finance-empty__title { margin: 0; color: var(--text-main); font-size: 1rem; font-weight: 700; }
.cliente-finance-empty__description { max-width: 34rem; margin: 0; color: var(--text-muted); font-size: 0.875rem; }
.cliente-finance-empty__action { min-height: 40px; margin: 0.25rem 0 0; }
```

Inside the existing `@media (max-width: 767px)` client-detail block, add:

```css
.cliente-finance-kpis {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.cliente-finance-kpis > :last-child:nth-child(odd) {
  grid-column: auto;
  max-width: none;
  justify-self: stretch;
}

.cliente-finance-kpis .kpi-card {
  min-width: 0;
  padding: 0.75rem 0.5rem;
}

.cliente-finance-kpis .kpi-label {
  font-size: clamp(0.5rem, 2.2vw, 0.64rem);
  line-height: 1.15;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.cliente-finance-kpis .kpi-value {
  font-size: clamp(0.76rem, 3.8vw, 1.15rem);
  line-height: 1.2;
  letter-spacing: -0.04em;
  white-space: nowrap;
}
```

- [ ] **Step 6: Run the two focused tests**

Run: `npx vitest run apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceEmptyState.test.tsx apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx`

Expected: PASS, 2 test files and 4 tests.

- [ ] **Step 7: Commit the integrated responsive change**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx apps/crm/style.css packages/i18n/locales/pt/clients.json packages/i18n/locales/en/clients.json apps/crm/src/pages/cliente-detalhe/__tests__/ClienteFinanceResponsive.test.tsx
git commit -m "fix: polish client finance mobile layout"
```

---

### Task 3: Regression verification and pull-request update

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: the completed client finance component, page integration, translations, and scoped CSS from Tasks 1–2.
- Produces: verified branch state pushed to the existing `codex/mobile-responsive-polish` pull request.

- [ ] **Step 1: Run the complete frontend suite**

Run: `npm run test`

Expected: all Vitest test files and tests pass with exit code 0.

- [ ] **Step 2: Typecheck and build the CRM app**

Run: `npm run build`

Expected: TypeScript and Vite finish successfully with exit code 0.

- [ ] **Step 3: Check the final diff and worktree**

Run: `git diff --check && git status --short && git log --oneline -4`

Expected: no whitespace errors, no uncommitted files, and the design plus implementation commits at the branch tip.

- [ ] **Step 4: Push the verified branch**

Run: `git push origin codex/mobile-responsive-polish`

Expected: the existing pull request updates successfully.
