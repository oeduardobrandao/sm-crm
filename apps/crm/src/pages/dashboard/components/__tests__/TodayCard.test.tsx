import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TodayCard, type TodayEvent } from '../TodayCard';

function renderCard(events: TodayEvent[]) {
  return render(
    <MemoryRouter>
      <TodayCard events={events} />
    </MemoryRouter>,
  );
}

describe('TodayCard', () => {
  it('keeps calendar and clients as independent links in the empty state', () => {
    const { container } = renderCard([]);

    expect(container.querySelector('a a')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/calendario');
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/clientes');
  });

  it('links non-empty event content to the calendar', () => {
    renderCard([{ kind: 'deadline', label: 'Entrega', sublabel: 'Hoje' }]);

    expect(screen.getByRole('link', { name: /Entrega/ })).toHaveAttribute('href', '/calendario');
  });
});
