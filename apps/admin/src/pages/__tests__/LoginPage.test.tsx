import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
    },
  },
}));

vi.mock('../../lib/api', () => ({
  verifyAdmin: vi.fn(),
}));

import LoginPage from '../LoginPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage logo', () => {
  it('shows the black logo in light mode and the white logo in dark mode', () => {
    renderPage();

    const blackLogo = screen.getByAltText('Mesaas');
    expect(blackLogo).toHaveAttribute('src', '/logo-black.svg');
    expect(blackLogo.className).toContain('dark:hidden');

    const whiteLogo = screen.getByAltText('', { exact: true });
    expect(whiteLogo).toHaveAttribute('src', '/logo-white.svg');
    expect(whiteLogo.className).toContain('dark:block');
  });

  it('renders accessible email and password fields and a submit button', () => {
    renderPage();

    expect(screen.getByLabelText('E-mail')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Senha')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });
});
