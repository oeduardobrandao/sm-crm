import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TermosPage from '../TermosPage';

const launch = vi.hoisted(() => ({ live: true }));
vi.mock('../../../lib/googleLegalLaunch', () => ({
  get GOOGLE_LEGAL_TEXT_LIVE() {
    return launch.live;
  },
  legalNetworkList: () =>
    launch.live ? 'Instagram, TikTok, YouTube e Google Meu Negócio' : 'Instagram e TikTok',
}));

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
    expect(screen.getByText('Nos planos pagos:')).toBeTruthy();
  });

  it('descreve os dois testes: 14 dias de Pro sem cartão e o teste com cartão', () => {
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('Teste do Pro sem cartão.');
    expect(text).toMatch(/plano Pro por 14 dias, sem cartão de crédito e sem nenhuma cobrança/);
    expect(text).toMatch(/Cada pessoa tem direito a um único teste/);
    expect(text).toMatch(
      /volta automaticamente para o plano Free\. Nada do que foi criado é apagado/,
    );
    expect(text).toMatch(/pausados a partir de 7 dias depois do fim do teste/);
    expect(text).toMatch(/a primeira cobrança é feita na data em que o teste termina/);
    expect(text).toMatch(/Se houver tempo, enviamos um e-mail 7 dias antes da primeira cobrança/);
    expect(text).toContain(
      'Depois de usar um teste, a contratação de um plano pago é cobrada no ato.',
    );
    expect(text).not.toMatch(/cada workspace pode testar um plano pago/);
  });

  it('não fala mais em período beta nem em planos pagos que ainda vão entrar em vigor', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/período beta/i);
    expect(container.textContent).not.toMatch(/entrarem em vigor/i);
  });

  it('mostra a data de atualização do rodapé em novembro de 2026', () => {
    const { container } = renderPage();
    expect(container.textContent).toContain('Última atualização: novembro de 2026');
    expect(container.textContent).not.toContain('abril de 2025');
  });
});

describe('TermosPage: integrações', () => {
  beforeEach(() => {
    launch.live = true;
  });

  it('nomeia Instagram, TikTok, YouTube e Google Meu Negócio', () => {
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('(Instagram, TikTok, YouTube e Google Meu Negócio)');
    expect(text).toMatch(
      /como Instagram, TikTok, YouTube e Google Meu Negócio, por meio de suas APIs oficiais/,
    );
    expect(text).not.toMatch(/Instagram e Meta|Instagram, Meta/);
  });

  it('sem o lançamento do Google, nomeia só Instagram e TikTok', () => {
    launch.live = false;
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('(Instagram e TikTok)');
    expect(text).toMatch(/como Instagram e TikTok, por meio de suas APIs oficiais/);
    expect(text).not.toMatch(/YouTube|Google/);
  });
});
