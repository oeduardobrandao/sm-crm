import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CheckList } from '../src/CheckList';
import { GroupedList } from '../src/GroupedList';
import { PickerCell } from '../src/PickerSheet';

const CATEGORIAS = [
  { value: 'mensalidade', label: 'Mensalidade' },
  { value: 'producao', label: 'Produção' },
  { value: 'trafego', label: 'Tráfego' },
];

function Single({ searchable = false }: { searchable?: boolean }) {
  const [value, setValue] = useState<string | null>('mensalidade');
  return (
    <MemoryRouter>
      <GroupedList aria-label="Lançamento">
        <PickerCell
          label="Categoria"
          options={CATEGORIAS}
          value={value}
          onChange={setValue}
          emptyOption={{ label: 'Sem categoria' }}
          searchable={searchable}
        />
      </GroupedList>
      <output data-testid="value">{value ?? 'null'}</output>
    </MemoryRouter>
  );
}

function Multi() {
  const [value, setValue] = useState<number[]>([]);
  return (
    <MemoryRouter>
      <GroupedList aria-label="Filtros">
        <PickerCell
          multiple
          label="Responsável"
          options={[
            { value: 1, label: 'Ana' },
            { value: 2, label: 'Bruno' },
            { value: 3, label: 'Carla' },
          ]}
          value={value}
          onChange={setValue}
          emptyOption={{ label: 'Todos' }}
        />
      </GroupedList>
    </MemoryRouter>
  );
}

describe('PickerCell + PickerSheet', () => {
  it('shows the current value and mounts no sheet until tapped', () => {
    render(<Single />);
    const cell = screen.getByRole('button', { name: /Categoria/ });
    expect(cell).toHaveTextContent('Mensalidade');
    expect(cell).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('single select: checks the current option, picks and closes', async () => {
    render(<Single />);
    fireEvent.click(screen.getByRole('button', { name: /Categoria/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Categoria' });
    expect(sheet).toHaveAttribute('data-detent', 'fit');
    const current = within(sheet).getByRole('button', { name: 'Mensalidade' });
    expect(current).toHaveAttribute('aria-pressed', 'true');
    expect(current.querySelector('.phone-check')).not.toBeNull();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Tráfego' }));
    expect(screen.getByTestId('value')).toHaveTextContent('trafego');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: /Categoria/ })).toHaveTextContent('Tráfego');
  });

  it('single select: the empty option picks null', async () => {
    render(<Single />);
    fireEvent.click(screen.getByRole('button', { name: /Categoria/ }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sem categoria' }));
    expect(screen.getByTestId('value')).toHaveTextContent('null');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: /Categoria/ })).toHaveTextContent('Sem categoria');
  });

  it('multi select: toggles in place, summarises, and "Todos" clears', async () => {
    render(<Multi />);
    const cell = screen.getByRole('button', { name: /Responsável/ });
    expect(cell).toHaveTextContent('Todos');
    fireEvent.click(cell);
    const sheet = await screen.findByRole('dialog', { name: 'Responsável' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Bruno' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ana' }));
    // Still open: multi select applies each toggle and stays.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Bruno' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sheet).getByRole('button', { name: 'Todos' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Summary in option order, not tap order.
    expect(screen.getByRole('button', { name: /Responsável.*Ana \+1/, hidden: true })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Todos' }));
    expect(within(sheet).getByRole('button', { name: 'Ana' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('searches accent-insensitively and says when nothing matches', async () => {
    render(<Single searchable />);
    fireEvent.click(screen.getByRole('button', { name: /Categoria/ }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveAttribute('data-detent', 'large');
    const search = within(sheet).getByRole('searchbox', { name: 'Buscar' });
    fireEvent.change(search, { target: { value: 'producao' } });
    expect(within(sheet).getByRole('button', { name: 'Produção' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Tráfego' })).toBeNull();
    // The empty option hides while searching.
    expect(within(sheet).queryByRole('button', { name: 'Sem categoria' })).toBeNull();
    fireEvent.change(search, { target: { value: 'xyz' } });
    expect(within(sheet).getByRole('status')).toHaveTextContent('Nenhum resultado');
  });
});

describe('CheckList sections', () => {
  it('groups options by section, in first-seen order', () => {
    render(
      <MemoryRouter>
        <CheckList
          value={null}
          onChange={() => {}}
          options={[
            { value: 'a', label: 'Instagram', section: 'Redes' },
            { value: 'b', label: 'E-mail', section: 'Outros' },
            { value: 'c', label: 'TikTok', section: 'Redes' },
          ]}
        />
      </MemoryRouter>,
    );
    const redes = screen.getByRole('list', { name: 'Redes' });
    expect(
      within(redes)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Instagram', 'TikTok']);
    expect(screen.getByRole('list', { name: 'Outros' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Redes', 'Outros']);
  });
});
