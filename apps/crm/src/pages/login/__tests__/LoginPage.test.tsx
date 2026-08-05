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

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null, loading: false })),
}));

import { toast } from 'sonner';
import { resetPassword, signIn, signUp } from '../../../lib/supabase';
import { useAuth } from '@/context/AuthContext';
import LoginPage from '../LoginPage';

const mockedSignIn = vi.mocked(signIn);
const mockedSignUp = vi.mocked(signUp);
const mockedResetPassword = vi.mocked(resetPassword);
const mockedToastSuccess = vi.mocked(toast.success);
const mockedToastError = vi.mocked(toast.error);
const mockedUseAuth = vi.mocked(useAuth);

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function renderLoginPage(
  initialEntry: string | { pathname: string; search?: string; state?: unknown } = '/login',
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/login"
          element={
            <>
              <LoginPage />
              <PathProbe />
            </>
          }
        />
        <Route path="/dashboard" element={<PathProbe />} />
        <Route path="/clientes" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function SearchProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname + location.search}</div>;
}

function renderRegister(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/login"
          element={
            <>
              <LoginPage />
              <SearchProbe />
            </>
          }
        />
        <Route path="/comecar" element={<SearchProbe />} />
        <Route path="/dashboard" element={<SearchProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillRegisterForm(
  container: HTMLElement,
  overrides: { nome?: string; empresa?: string } = {},
) {
  const set = (id: string, value: string) =>
    fireEvent.change(container.querySelector(`#${id}`)!, { target: { value } });
  set('reg-nome', overrides.nome ?? 'Ana Souza');
  set('reg-empresa', overrides.empresa ?? 'Studio Ana');
  set('reg-email', 'ana@example.com');
  set('reg-telefone', '11999999999');
  set('reg-password', 'senha12345');
  set('reg-confirm', 'senha12345');
}

// jsdom does not run HTML constraint validation on a programmatic submit, so
// this reaches the handler and exercises the trim guard rather than being
// blocked by `required`.
function submitRegister(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form.auth-form')!);
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockedSignIn.mockReset();
    mockedSignUp.mockReset();
    mockedResetPassword.mockReset();
    mockedToastSuccess.mockReset();
    mockedToastError.mockReset();
    mockedUseAuth.mockReset();
    mockedUseAuth.mockReturnValue({ user: null, loading: false } as never);
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

  it('opens the forgot-password flow directly from the query string', () => {
    renderLoginPage('/login?tab=forgot');

    expect(screen.getByText(/Informe seu e-mail para receber um link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar Conta' })).not.toBeInTheDocument();
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
    expect(mockedToastError).toHaveBeenCalledWith(
      'Não foi possível entrar. Se você foi convidado, use o link do e-mail ou "Esqueci minha senha" para definir sua senha.',
    );
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
    mockedSignUp.mockResolvedValue({ data: { session: null }, error: null } as never);

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
    fireEvent.change(screen.getByLabelText('Telefone'), {
      target: { value: '(11) 99999-9999' },
    });
    fireEvent.change(screen.getByLabelText('Senha'), {
      target: { value: 'senha-123' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar Senha'), {
      target: { value: 'senha-123' },
    });
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.submit(screen.getByLabelText('Nome Completo').closest('form')!);

    await waitFor(() => {
      expect(mockedSignUp).toHaveBeenCalledWith(
        'ana@mesaas.com',
        'senha-123',
        {
          nome: 'Ana Souza',
          empresa: 'Mesaas',
          telefone: '(11) 99999-9999',
          marketing_opt_in: true,
        },
        '/login',
      );
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

  it('rejects a whitespace-only company name instead of submitting it', () => {
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container, { empresa: '   ' });
    submitRegister(container);
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('trims the name and company before sending them to signUp', async () => {
    mockedSignUp.mockResolvedValue({
      data: { session: { access_token: 't' } },
      error: null,
    } as never);
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container, { nome: '  Ana  ', empresa: '  Studio  ' });
    submitRegister(container);
    await waitFor(() => expect(mockedSignUp).toHaveBeenCalled());
    expect(mockedSignUp.mock.calls[0][2]).toMatchObject({ nome: 'Ana', empresa: 'Studio' });
  });

  it('sends a signed-up user to /comecar carrying the plan intent', async () => {
    mockedSignUp.mockResolvedValue({
      data: { session: { access_token: 't' } },
      error: null,
    } as never);
    const { container } = renderRegister('/login?tab=register&plan=pro&interval=year');
    fillRegisterForm(container);
    submitRegister(container);
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('/comecar?plan=pro&interval=year'),
    );
  });

  it('passes the intent through emailRedirectTo when confirmation is still on', async () => {
    mockedSignUp.mockResolvedValue({ data: { session: null }, error: null } as never);
    const { container } = renderRegister('/login?tab=register&plan=pro&interval=month');
    fillRegisterForm(container);
    submitRegister(container);
    await waitFor(() => expect(mockedSignUp).toHaveBeenCalled());
    expect(mockedSignUp.mock.calls[0][3]).toBe('/login?plan=pro&interval=month');
  });

  it('redirects an already-authenticated visitor with a plan intent to /comecar and does not show the login form', async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
    } as never);

    renderRegister('/login?plan=pro&interval=year');

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('/comecar?plan=pro&interval=year'),
    );
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
  });

  it('redirects an already-authenticated visitor at plain /login to /dashboard', async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
    } as never);

    renderRegister('/login');

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/dashboard'));
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
  });

  it('still shows the login form for an unauthenticated visitor', () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: false } as never);

    renderRegister('/login');

    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('/login');
  });

  it('does not redirect while auth is still loading, even with a user present', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      loading: true,
    } as never);

    renderRegister('/login');

    expect(screen.getByTestId('probe')).toHaveTextContent('/login');
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
  });
});
