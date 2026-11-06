import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PhoneConfirmSheet } from '../PhoneConfirmSheet';
import { PhoneFiltersSheet, type FilterSection } from '../PhoneFiltersSheet';
import { PhoneConfirmSheet as EntregasPhoneConfirmSheet } from '@/pages/entregas/phone/PhoneConfirmSheet';

describe('PhoneConfirmSheet', () => {
  it('is the same component at the old Entregas path', () => {
    expect(EntregasPhoneConfirmSheet).toBe(PhoneConfirmSheet);
  });

  it('runs the action once, hides itself while the parent is still open, never cancels', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <MemoryRouter>
        <PhoneConfirmSheet
          open
          title="Excluir fluxo?"
          message="Não dá para desfazer."
          actions={[{ label: 'Excluir', destructive: true, onSelect: onConfirm }]}
          onCancel={onCancel}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Cancelar calls onCancel', async () => {
    const onCancel = vi.fn();
    render(
      <MemoryRouter>
        <PhoneConfirmSheet
          open
          title="Excluir fluxo?"
          actions={[{ label: 'Excluir', onSelect: vi.fn() }]}
          onCancel={onCancel}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });
});

interface State {
  status: string[];
  clientes: number[];
}

function FiltersHarness({ onOpenChange = () => {} }: { onOpenChange?: (o: boolean) => void }) {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<State>({ status: [], clientes: [] });
  const active = state.status.length + state.clientes.length;
  const sections: FilterSection[] = [
    {
      type: 'chips',
      key: 'situacao',
      label: 'Situação',
      chips: ['Atrasados', 'Em dia'].map((s) => ({
        key: s,
        label: s,
        selected: state.status.includes(s),
        onToggle: () =>
          setState((prev) => ({
            ...prev,
            status: prev.status.includes(s)
              ? prev.status.filter((x) => x !== s)
              : [...prev.status, s],
          })),
      })),
      after: <p>Texto sob as fichas</p>,
    },
    {
      type: 'lists',
      key: 'listas',
      lists: [
        {
          key: 'clientes',
          title: 'Cliente',
          allLabel: 'Todos',
          options: [
            { value: 1, label: 'Café Aurora' },
            { value: 2, label: 'Clínica Sol' },
          ],
          selected: state.clientes,
          onChange: (next) => setState((prev) => ({ ...prev, clientes: next as number[] })),
        },
      ],
    },
    { type: 'custom', key: 'extra', content: <p>Seção livre</p> },
  ];
  return (
    <MemoryRouter>
      <PhoneFiltersSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange(next);
        }}
        description="Filtre os fluxos"
        sections={sections}
        activeCount={active}
        onClear={() => setState({ status: [], clientes: [] })}
        resultCount={6 - active}
      />
    </MemoryRouter>
  );
}

describe('PhoneFiltersSheet', () => {
  it('renders chip groups, drill rows and custom sections; Limpar is off with no filter', () => {
    render(<FiltersHarness />);
    const sheet = screen.getByRole('dialog', { name: 'Filtros' });
    expect(within(sheet).getByRole('group', { name: 'Situação' })).toBeInTheDocument();
    expect(within(sheet).getByText('Texto sob as fichas')).toBeInTheDocument();
    expect(within(sheet).getByText('Seção livre')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /Cliente/ })).toHaveTextContent('Todos');
    expect(within(sheet).getByRole('button', { name: 'Limpar' })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: 'Ver 6' })).toBeInTheDocument();
  });

  it('applies chips as they are tapped and Limpar clears', () => {
    render(<FiltersHarness />);
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Atrasados' }));
    expect(within(sheet).getByRole('button', { name: 'Atrasados' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sheet).getByRole('button', { name: 'Ver 5' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Limpar' }));
    expect(within(sheet).getByRole('button', { name: 'Ver 6' })).toBeInTheDocument();
  });

  it('drills into a list, toggles options, and comes back with a summary', () => {
    render(<FiltersHarness />);
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Cliente/ }));
    expect(within(sheet).getByRole('list', { name: 'Cliente' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Clínica Sol' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Café Aurora' }));
    expect(within(sheet).getByRole('button', { name: 'Todos' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // The header's leading button goes back while drilled in.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Filtros' }));
    expect(within(sheet).getByRole('button', { name: /Cliente/ })).toHaveTextContent(
      'Café Aurora +1',
    );
    expect(within(sheet).getByRole('button', { name: 'Ver 4' })).toBeInTheDocument();
  });

  it('"Ver N" closes the sheet and the next open starts on the main page', async () => {
    const onOpenChange = vi.fn();
    render(<FiltersHarness onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Cliente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver 6' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
