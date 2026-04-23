import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LandingPage from '../LandingPage';

function renderLandingPage() {
  return render(<LandingPage />);
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

    expect(registerLinks).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
  });

  it('opens one FAQ answer at a time', () => {
    renderLandingPage();

    const freeQuestion = screen.getByRole('button', { name: 'O Mesaas é gratuito mesmo?' });
    const installQuestion = screen.getByRole('button', { name: 'Preciso instalar alguma coisa?' });

    fireEvent.click(freeQuestion);

    expect(freeQuestion).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(
        'Sim. Durante a fase beta, todas as funcionalidades são 100% gratuitas para todos os usuários. Quando os planos entrarem em vigor, quem já estava dentro recebe condições especiais.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(installQuestion);

    expect(freeQuestion).toHaveAttribute('aria-expanded', 'false');
    expect(installQuestion).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText(/100% gratuitas para todos/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Não. O Mesaas é 100% web e funciona em qualquer navegador moderno, no computador ou no celular. Nada para baixar, nada para configurar.',
      ),
    ).toBeInTheDocument();
  });
});
