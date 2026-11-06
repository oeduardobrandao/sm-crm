import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BarList } from '../src/BarList';
import { InfoButton } from '../src/InfoButton';

describe('InfoButton', () => {
  it('needs no router and mounts no sheet until tapped', () => {
    render(<InfoButton title="Prazos" content="Úteis = apenas dias úteis." />);
    expect(screen.getByRole('button', { name: 'Mais informações: Prazos' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a content-height sheet with the title and text, and closes', async () => {
    const onRowClick = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={onRowClick}>
          <InfoButton title="Prazos" content={<p>Úteis = apenas dias úteis.</p>} />
        </div>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Prazos/ }));
    // The surrounding row's click doesn't fire.
    expect(onRowClick).not.toHaveBeenCalled();
    const sheet = await screen.findByRole('dialog', { name: 'Prazos' });
    expect(sheet).toHaveAttribute('data-detent', 'fit');
    expect(within(sheet).getByText('Úteis = apenas dias úteis.')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('takes a custom label and icon', () => {
    render(<InfoButton title="Ajuda" label="Ajuda" content="x" icon={<svg data-testid="q" />} />);
    expect(screen.getByRole('button', { name: 'Ajuda' })).toContainElement(screen.getByTestId('q'));
  });
});

describe('BarList', () => {
  const items = [
    { key: 'a', label: 'Café Aurora', value: 50, subtitle: '@cafeaurora' },
    { key: 'b', label: 'Clínica Sol', value: 25, valueLabel: '25 posts' },
    { key: 'c', label: 'Pet Feliz', value: 0 },
  ];

  it('renders label, value text and bars proportional to the largest value', () => {
    const { container } = render(<BarList header="Posts por cliente" items={items} />);
    const list = screen.getByRole('list', { name: 'Posts por cliente' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('@cafeaurora')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('25 posts')).toBeInTheDocument();
    const fills = container.querySelectorAll<HTMLElement>('.phone-bar-row__fill');
    expect(Array.from(fills).map((f) => f.style.width)).toEqual(['100%', '50%', '0%']);
    // Bars are decoration; the numbers are the text.
    expect(container.querySelector('.phone-bar-row__track')).toHaveAttribute('aria-hidden', 'true');
  });

  it('scales to an explicit max and clamps overflow', () => {
    const { container } = render(
      <BarList
        aria-label="Engajamento"
        max={10}
        items={[
          { key: 'a', label: 'A', value: 5 },
          { key: 'b', label: 'B', value: 20 },
        ]}
      />,
    );
    const fills = container.querySelectorAll<HTMLElement>('.phone-bar-row__fill');
    expect(Array.from(fills).map((f) => f.style.width)).toEqual(['50%', '100%']);
  });

  it('draws a second series with a legend and names each value for screen readers', () => {
    const { container } = render(
      <BarList
        aria-label="Seguidores"
        series={{ primary: 'Este período', secondary: 'Anterior' }}
        color="red"
        items={[{ key: 'a', label: 'Café Aurora', value: 40, secondary: 20 }]}
      />,
    );
    expect(container.querySelectorAll('.phone-bar-row__track')).toHaveLength(2);
    expect(
      container.querySelector<HTMLElement>('.phone-bar-row__fill--secondary')!.style.width,
    ).toBe('50%');
    expect(container.querySelector<HTMLElement>('.phone-bar-row__fill')!.style.background).toBe(
      'red',
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Este período: 40');
    expect(screen.getByRole('listitem')).toHaveTextContent('Anterior: 20');
    expect(container.querySelector('.phone-bar-list__legend')).toHaveTextContent(
      'Este períodoAnterior',
    );
  });

  it('makes rows with onClick buttons', () => {
    const onClick = vi.fn();
    render(
      <BarList aria-label="Etapas" items={[{ key: 'a', label: 'Produção', value: 3, onClick }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Produção/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows the empty text when there are no items', () => {
    render(<BarList header="Etapas" items={[]} emptyText="Nenhum dado no período" />);
    expect(screen.getByText('Nenhum dado no período')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
