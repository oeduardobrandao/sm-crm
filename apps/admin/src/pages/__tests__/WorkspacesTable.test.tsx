import { fireEvent, render, screen, within } from '@testing-library/react';
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
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('columnheader', { name: /Workspace/ })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: /Plano/ })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: /Clientes/ })).toBeInTheDocument();
    expect(table.queryByRole('columnheader', { name: /Dono/ })).toBeNull();
    expect(table.queryByText('rafa@agencianorte.com')).toBeNull();
  });

  it('mobile card ignores column visibility and always shows the secondary fields', () => {
    renderTable({ visible: ['name'] });
    const card = within(screen.getByRole('list'));
    expect(card.getByText('rafa@agencianorte.com')).toBeInTheDocument();
    expect(card.getByText('42 clientes')).toBeInTheDocument();
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
