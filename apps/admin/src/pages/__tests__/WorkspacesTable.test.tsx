import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
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
    owner: {
      name: 'Rafa',
      email: 'rafa@agencianorte.com',
      telefone: null,
      marketing_opt_in: false,
    },
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
      provider: 'stripe',
    },
    ...overrides,
  };
}

function renderTable(props: Partial<Parameters<typeof WorkspacesTable>[0]> = {}) {
  const onSort = vi.fn();
  const onOpen = vi.fn();
  render(
    <MemoryRouter>
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
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onSort, onOpen };
}

describe('WorkspacesTable', () => {
  it('renders one header per visible column and hides the rest', () => {
    renderTable({ visible: ['name', 'plan', 'client_count'] });
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('columnheader', { name: /Workspace/ })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: /Plano/ })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: /Clientes/ })).toBeInTheDocument();
    expect(table.queryByRole('columnheader', { name: /Dono/ })).toBeNull();
    expect(table.queryByText('rafa@agencianorte.com')).toBeNull();
  });

  it('stacks the owner e-mail under the name instead of giving it a column', () => {
    renderTable();
    const table = within(screen.getByRole('table'));
    expect(table.queryByRole('columnheader', { name: /Dono/ })).toBeNull();
    const nameCell = table.getByRole('link', { name: 'Agência Norte' }).closest('td')!;
    expect(within(nameCell).getByText('rafa@agencianorte.com')).toBeInTheDocument();
  });

  it('keeps short cells on one line so the default columns fit the panel', () => {
    renderTable();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('42').closest('td')).toHaveClass('px-2');
    expect(table.getByText(/\d{2}\/\d{2}\/\d{2}/)).toHaveClass('whitespace-nowrap');
  });

  it('has no separate mobile card list: phones get their own view (WorkspacesPhone)', () => {
    renderTable({ visible: ['name'] });
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getAllByText('Agência Norte')).toHaveLength(1);
  });

  it('marks the active sort column with aria-sort and calls onSort on click', () => {
    const { onSort } = renderTable({ sort: { ord: 'client_count', dir: 'desc' } });
    const clients = screen.getByRole('columnheader', { name: /Clientes/ });
    expect(clients).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /Workspace/ })).not.toHaveAttribute(
      'aria-sort',
    );
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

  it('navigates when a row is clicked outside the name link', () => {
    const { onOpen } = renderTable();
    const table = within(screen.getByRole('table'));
    fireEvent.click(table.getByText('42'));
    expect(onOpen).toHaveBeenCalledWith('ws-1');
  });

  it('the name cell is a real link to the detail page and does not double-fire the row click', () => {
    const { onOpen } = renderTable();
    const table = within(screen.getByRole('table'));
    const link = table.getByRole('link', { name: 'Agência Norte' });
    expect(link).toHaveAttribute('href', '/admin/workspaces/ws-1');
    fireEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marks the table busy while refetching', () => {
    renderTable({ busy: true });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('skeleton renders the requested rows for the visible columns', () => {
    render(<WorkspacesTableSkeleton visible={['name', 'plan']} rows={3} />);
    expect(screen.getAllByRole('row')).toHaveLength(4); // header + 3
  });

  it('captions the subscription cell with the billing provider', () => {
    renderTable({
      workspaces: [
        ws({
          subscription: {
            status: 'active',
            plan_name: 'Max',
            billing_interval: 'year',
            amount_cents: 113880,
            currency: 'brl',
            interval: 'year',
            discount_label: null,
            failed_payment_count: 0,
            current_period_end: '2027-10-03T00:00:00Z',
            provider: 'pagarme',
          },
        }),
      ],
      visible: ['name', 'subscription'],
    });
    expect(screen.getAllByText('Pagar.me').length).toBeGreaterThan(0);
  });

  it('shows no provider caption when the payload predates the provider key', () => {
    renderTable({
      workspaces: [
        ws({
          subscription: {
            status: 'active',
            plan_name: 'Max',
            billing_interval: 'month',
            amount_cents: 19700,
            currency: 'brl',
            interval: 'month',
            discount_label: null,
            failed_payment_count: 0,
            current_period_end: null,
            provider: null,
          },
        }),
      ],
      visible: ['name', 'subscription'],
    });
    expect(screen.queryByText('Stripe')).toBeNull();
    expect(screen.queryByText('Pagar.me')).toBeNull();
  });
});

describe('WorkspacesTable plan source badge', () => {
  it('shows a Demo badge for plan_source demo and Comp for manual', () => {
    renderTable({
      workspaces: [
        ws({ id: 'a', name: 'Alfa', plan_source: 'demo' }),
        ws({ id: 'b', name: 'Beta', plan_source: 'manual' }),
        ws({ id: 'c', name: 'Gama', plan_source: 'subscription' }),
      ],
      visible: ['name', 'plan'],
    });
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Demo')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Comp')).toBeInTheDocument();
    expect(within(rows[3]).queryByText('Demo')).toBeNull();
    expect(within(rows[3]).queryByText('Comp')).toBeNull();
  });
});
