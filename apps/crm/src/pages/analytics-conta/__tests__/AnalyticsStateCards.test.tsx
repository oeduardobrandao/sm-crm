import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { LockedCard } from '../AnalyticsStateCards';

function renderCard() {
  return render(
    <MemoryRouter>
      <LockedCard
        title="YouTube"
        body="O YouTube não está disponível no seu plano."
        actionLabel="Ver planos"
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('LockedCard', () => {
  it('links to billing on the web', () => {
    renderCard();
    expect(screen.getByText('O YouTube não está disponível no seu plano.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver planos' })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
  });

  it('keeps the title, states the fact and renders no link inside the native app', () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
    };
    renderCard();
    expect(screen.getByRole('heading', { name: 'YouTube' })).toBeInTheDocument();
    expect(
      screen.getByText('Fale com o dono do workspace se precisar deste recurso.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/plano/i)).not.toBeInTheDocument();
  });
});
