import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('../../lib/api', () => ({
  verifyAdmin: vi.fn(),
}));

import { supabase } from '../../lib/supabase';
import { verifyAdmin } from '../../lib/api';
import LoginPage from '../LoginPage';

const mockedSignIn = vi.mocked(supabase.auth.signInWithPassword);
const mockedVerifyAdmin = vi.mocked(verifyAdmin);

let restorePhone: () => void;

beforeEach(() => {
  restorePhone = mockPhone();
  mockedSignIn.mockReset();
  mockedVerifyAdmin.mockReset();
});

afterEach(() => {
  restorePhone();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <Routes>
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin" element={<div>Painel admin</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage (phone)', () => {
  it('shows the title, subtitle, a single Mesaas logo and the inset fields', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Mesaas Admin' })).toBeInTheDocument();
    expect(screen.getByText('Acesso restrito à equipe da plataforma')).toBeInTheDocument();
    expect(screen.getAllByAltText('Mesaas')).toHaveLength(1);
    expect(screen.getByLabelText('E-mail')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Senha')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('signs in and goes to the admin panel', async () => {
    mockedSignIn.mockResolvedValue({ data: {}, error: null } as never);
    mockedVerifyAdmin.mockResolvedValue({ is_admin: true });
    renderPage();

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@mesaas.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() =>
      expect(mockedSignIn).toHaveBeenCalledWith({ email: 'a@mesaas.com.br', password: 'segredo' }),
    );
    expect(await screen.findByText('Painel admin')).toBeInTheDocument();
  });

  it('shows the error for a non-admin and stays on the page', async () => {
    mockedSignIn.mockResolvedValue({ data: {}, error: null } as never);
    mockedVerifyAdmin.mockResolvedValue({ is_admin: false });
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);
    renderPage();

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@mesaas.com.br' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Acesso não autorizado.');
    expect(screen.queryByText('Painel admin')).not.toBeInTheDocument();
  });

  it('is pinned to the light scope even when the Admin theme is dark', () => {
    document.documentElement.dataset.theme = 'dark';
    try {
      const { container } = renderPage();
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveClass('admin-login-light');
      expect(screen.getByRole('button', { name: 'Entrar' }).className).toContain('bg-foreground');
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });
});
