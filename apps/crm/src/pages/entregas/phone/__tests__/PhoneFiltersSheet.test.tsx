import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTERS, type FilterState } from '../../components/EntregasFilters';
import { buildStatusRegistry } from '../../statusRegistry';
import { PhoneFiltersSheet } from '../PhoneFiltersSheet';
import type { Cliente } from '../../../../store';

vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => buildStatusRegistry([]),
}));

const clientes = [
  { id: 1, nome: 'Café Aurora', status: 'ativo' },
  { id: 2, nome: 'Clínica Sol', status: 'ativo' },
  { id: 3, nome: 'Antigo', status: 'inativo' },
] as unknown as Cliente[];

function Harness({ initial = EMPTY_FILTERS }: { initial?: FilterState }) {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(initial);
  return (
    <MemoryRouter>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <PhoneFiltersSheet
        open={open}
        onOpenChange={setOpen}
        filters={filters}
        onChange={setFilters}
        mode="entregas"
        resultCount={3}
        clientes={clientes}
        membros={[]}
        templates={[]}
        etapaNames={['Produção']}
      />
      <output data-testid="clientes">{filters.filterClientes.join(',')}</output>
    </MemoryRouter>
  );
}

async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
  return screen.findByRole('dialog', { name: 'Filtros' });
}

describe('Entregas PhoneFiltersSheet (on the kit shell)', () => {
  it('lists only active clientes and writes the picked ids', async () => {
    render(<Harness />);
    const sheet = await openSheet();
    expect(sheet).toHaveAccessibleDescription('Filtre os fluxos');
    fireEvent.click(within(sheet).getByRole('button', { name: /Cliente/ }));
    expect(within(sheet).queryByRole('button', { name: 'Antigo' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Clínica Sol' }));
    expect(screen.getByTestId('clientes')).toHaveTextContent('2');
  });

  it('"Personalizado" survives a drill-in and resets when the sheet reopens', async () => {
    render(<Harness />);
    let sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Personalizado' }));
    expect(within(sheet).getByLabelText('De')).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: /Etapa/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Filtros' }));
    expect(within(sheet).getByLabelText('De')).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Ver 3' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    sheet = await openSheet();
    // No range was typed, so the custom fields start closed again.
    expect(within(sheet).queryByLabelText('De')).toBeNull();
  });

  it('opens with the custom range shown when one is set', async () => {
    render(<Harness initial={{ ...EMPTY_FILTERS, filterPrazoFrom: '2026-10-01' }} />);
    const sheet = await openSheet();
    expect(within(sheet).getByLabelText('De')).toHaveValue('2026-10-01');
    expect(within(sheet).getByRole('button', { name: 'Personalizado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
