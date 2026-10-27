import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import TermosPage from '../TermosPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <TermosPage />
    </MemoryRouter>,
  );
}

describe('TermosPage: planos e teste grátis', () => {
  it('descreve o plano Free, os planos pagos e o teste grátis', () => {
    renderPage();
    expect(screen.getByText(/O Mesaas oferece um plano gratuito \(Free\)/)).toBeInTheDocument();
    expect(screen.getByText(/Teste grátis: cada workspace pode testar/)).toBeInTheDocument();
    expect(
      screen.getByText(/Enviamos um e-mail 7 dias antes da primeira cobrança/),
    ).toBeInTheDocument();
    expect(screen.getByText('Nos planos pagos:')).toBeInTheDocument();
  });

  it('não fala mais em período beta nem em planos pagos que ainda vão entrar em vigor', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/período beta/i);
    expect(container.textContent).not.toMatch(/entrarem em vigor/i);
  });
});
