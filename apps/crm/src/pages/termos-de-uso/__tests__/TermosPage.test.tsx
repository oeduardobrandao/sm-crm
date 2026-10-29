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
    expect(screen.getByText(/O Mesaas oferece um plano gratuito \(Free\)/)).toBeTruthy();
    expect(screen.getByText(/Teste grátis: cada workspace pode testar/)).toBeTruthy();
    expect(screen.getByText(/Enviamos um e-mail 7 dias antes da primeira cobrança/)).toBeTruthy();
    expect(screen.getByText('Nos planos pagos:')).toBeTruthy();
  });

  it('não fala mais em período beta nem em planos pagos que ainda vão entrar em vigor', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/período beta/i);
    expect(container.textContent).not.toMatch(/entrarem em vigor/i);
  });

  it('mostra a data de atualização do rodapé em outubro de 2026', () => {
    const { container } = renderPage();
    expect(container.textContent).toContain('Última atualização: outubro de 2026');
    expect(container.textContent).not.toContain('abril de 2025');
  });
});

describe('TermosPage: integrações', () => {
  it('nomeia Instagram, TikTok, YouTube e Google Meu Negócio', () => {
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('(Instagram, TikTok, YouTube e Google Meu Negócio)');
    expect(text).toMatch(
      /como Instagram, TikTok, YouTube e Google Meu Negócio, por meio de suas APIs oficiais/,
    );
    expect(text).not.toMatch(/Instagram e Meta|Instagram, Meta/);
  });
});
