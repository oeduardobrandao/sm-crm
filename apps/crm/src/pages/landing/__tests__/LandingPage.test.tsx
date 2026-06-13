import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import LandingPage from '../LandingPage';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderLandingPage() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

function mockSectionScroll(id: string) {
  const element = document.getElementById(id) as HTMLElement & {
    scrollIntoView: ReturnType<typeof vi.fn>;
  };
  const scrollSpy = vi.fn();
  element.scrollIntoView = scrollSpy;
  return scrollSpy;
}

describe('LandingPage', () => {
  beforeEach(() => {
    document.body.classList.remove('landing-page');
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('adds the landing-page body class on mount and removes it on unmount', () => {
    const { unmount } = renderLandingPage();

    expect(document.body).toHaveClass('landing-page');

    unmount();

    expect(document.body).not.toHaveClass('landing-page');
  });

  it('toggles the document theme between light and dark', () => {
    renderLandingPage();

    fireEvent.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    fireEvent.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('shows the promo banner and hides it (persisted) after dismissing', () => {
    renderLandingPage();

    expect(screen.getByText('BEMVINDO')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));

    expect(screen.queryByText('BEMVINDO')).not.toBeInTheDocument();
    expect(localStorage.getItem('mesaas_promo_dismissed')).toBe('1');
  });

  it('wires scroll buttons to the right sections and exposes the auth CTAs', () => {
    renderLandingPage();

    const featuresScroll = mockSectionScroll('features');
    const pricingScroll = mockSectionScroll('pricing');
    const faqScroll = mockSectionScroll('faq');

    fireEvent.click(screen.getByRole('button', { name: /Ver como funciona/i }));
    expect(featuresScroll).toHaveBeenCalledWith({ behavior: 'smooth' });

    fireEvent.click(screen.getByRole('button', { name: 'Preços' }));
    expect(pricingScroll).toHaveBeenCalledWith({ behavior: 'smooth' });

    fireEvent.click(screen.getByRole('button', { name: 'FAQ' }));
    expect(faqScroll).toHaveBeenCalledWith({ behavior: 'smooth' });

    const registerLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/login?tab=register');

    // Promo banner + header + hero + final CTA each link to signup, plus all 4 pricing CTAs.
    expect(registerLinks).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
  });

  it('opens one FAQ answer at a time', () => {
    renderLandingPage();

    const freeQuestion = screen.getByRole('button', { name: 'O Mesaas tem plano gratuito?' });
    const installQuestion = screen.getByRole('button', { name: 'Preciso instalar alguma coisa?' });

    fireEvent.click(freeQuestion);

    expect(freeQuestion).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(
        'Sim. O plano Free é gratuito para sempre, com limites para você conhecer a plataforma — 2 clientes e 1 usuário. Quando precisar de mais clientes, usuários ou recursos como integração com Instagram e portal do cliente, é só assinar um plano pago, a partir de R$ 99,90/mês.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(installQuestion);

    expect(freeQuestion).toHaveAttribute('aria-expanded', 'false');
    expect(installQuestion).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText(/gratuito para sempre/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Não. O Mesaas é 100% web e funciona em qualquer navegador moderno, no computador ou no celular. Nada para baixar, nada para configurar.',
      ),
    ).toBeInTheDocument();
  });
});
