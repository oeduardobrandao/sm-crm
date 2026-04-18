import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../lib/supabase', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  resetPassword: vi.fn(),
}));

import { toast } from 'sonner';
import { resetPassword, signIn, signUp } from '../../../lib/supabase';
import LoginPage from '../LoginPage';

const mockedSignIn = vi.mocked(signIn);
const mockedSignUp = vi.mocked(signUp);
const mockedResetPassword = vi.mocked(resetPassword);
const mockedToastSuccess = vi.mocked(toast.success);
const mockedToastError = vi.mocked(toast.error);

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function renderLoginPage(initialEntry: string | { pathname: string; search?: string; state?: unknown } = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/login"
          element={(
            <>
              <LoginPage />
              <PathProbe />
            </>
          )}
        />
        <Route path="/dashboard" element={<PathProbe />} />
        <Route path="/clientes" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockedSignIn.mockReset();
    mockedSignUp.mockReset();
    mockedResetPassword.mockReset();
    mockedToastSuccess.mockReset();
    mockedToastError.mockReset();
  });

  it('starts on the register tab from the query string and switches between register, forgot, and login flows', () => {
    renderLoginPage('/login?tab=register');

    expect(screen.getByLabelText('Nome Completo')).toBeInTheDocument();
    expect(screen.queryByText('Esqueci minha senha')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Esqueci minha senha' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Esqueci minha senha' }));

    expect(screen.getByText(/Informe seu e-mail para receber um link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar Conta' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /Voltar para o login/i }));

    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar Conta' })).toBeInTheDocument();
  });

  it('shows the translated login error when Supabase rejects the credentials', async () => {
    mockedSignIn.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    } as never);

    renderLoginPage();

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ana@mesaas.com' },
    });
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-segura' },
    });

    fireEvent.submit(screen.getByLabelText('E-mail').closest('form')!);

    await waitFor(() => {
      expect(mockedSignIn).toHaveBeenCalledWith('ana@mesaas.com', 'senha-segura');
    });
    expect(mockedToastError).toHaveBeenCalledWith('E-mail ou senha incorretos.');
    expect(screen.getByTestId('current-path')).toHaveTextContent('/login');
  });

  it('logs in successfully and redirects to the intended route from location state', async () => {
    mockedSignIn.mockResolvedValue({ error: null } as never);

    renderLoginPage({
      pathname: '/login',
      state: { from: { pathname: '/clientes' } },
    });

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ana@mesaas.com' },
    });
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-segura' },
    });

    fireEvent.submit(screen.getByLabelText('E-mail').closest('form')!);

    await waitFor(() => {
      expect(mockedToastSuccess).toHaveBeenCalledWith('Login realizado com sucesso!');
    });
    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent('/clientes');
    });
  });

  it('blocks registration when the passwords do not match', async () => {
    renderLoginPage('/login?tab=register');

    fireEvent.change(screen.getByLabelText('Nome Completo'), {
      target: { value: 'Ana Souza' },
    });
    fireEvent.change(screen.getByLabelText('Nome da Empresa'), {
      target: { value: 'Mesaas' },
    });
    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ana@mesaas.com' },
    });
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-123' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar Senha'), {
      target: { value: 'senha-999' },
    });

    fireEvent.submit(screen.getByLabelText('Nome Completo').closest('form')!);

    await waitFor(() => {
      expect(mockedToastError).toHaveBeenCalledWith('As senhas não coincidem.');
    });
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('shows the verification state after a successful registration and returns to login', async () => {
    mockedSignUp.mockResolvedValue({ error: null } as never);

    renderLoginPage('/login?tab=register');

    fireEvent.change(screen.getByLabelText('Nome Completo'), {
      target: { value: 'Ana Souza' },
    });
    fireEvent.change(screen.getByLabelText('Nome da Empresa'), {
      target: { value: 'Mesaas' },
    });
    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ana@mesaas.com' },
    });
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-123' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar Senha'), {
      target: { value: 'senha-123' },
    });

    fireEvent.submit(screen.getByLabelText('Nome Completo').closest('form')!);

    await waitFor(() => {
      expect(mockedSignUp).toHaveBeenCalledWith('ana@mesaas.com', 'senha-123', {
        nome: 'Ana Souza',
        empresa: 'Mesaas',
      });
    });
    expect(screen.getByText('Verifique seu e-mail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ir para o login' }));

    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.queryByText('Verifique seu e-mail')).not.toBeInTheDocument();
  });

  it('shows the reset-password error and keeps the user in the forgot flow when the request fails', async () => {
    mockedResetPassword.mockResolvedValue({
      error: { message: 'Usuário não encontrado.' },
    } as never);

    renderLoginPage();
    fireEvent.click(screen.getByRole('link', { name: 'Esqueci minha senha' }));

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ana@mesaas.com' },
    });
    fireEvent.submit(screen.getByLabelText('E-mail').closest('form')!);

    await waitFor(() => {
      expect(mockedResetPassword).toHaveBeenCalledWith('ana@mesaas.com');
    });
    expect(mockedToastError).toHaveBeenCalledWith('Usuário não encontrado.');
    expect(screen.getByText(/Informe seu e-mail para receber um link/i)).toBeInTheDocument();
  });

  it('returns to the login tab after sending a reset-password email successfully', async () => {
    mockedResetPassword.mockResolvedValue({ error: null } as never);

    renderLoginPage();
    fireEvent.click(screen.getByRole('link', { name: 'Esqueci minha senha' }));

    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ana@mesaas.com' },
    });
    fireEvent.submit(screen.getByLabelText('E-mail').closest('form')!);

    await waitFor(() => {
      expect(mockedToastSuccess).toHaveBeenCalledWith(
        'Link de redefinição enviado para ana@mesaas.com. Verifique sua caixa de entrada.',
      );
    });
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.queryByText(/Informe seu e-mail para receber um link/i)).not.toBeInTheDocument();
  });
});
