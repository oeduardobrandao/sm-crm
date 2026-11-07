import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  resendSignupConfirmation: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null, loading: false })),
}));

vi.mock('@/lib/analytics', () => ({
  captureEvent: vi.fn(),
  identifySignup: vi.fn(),
}));

import { toast } from 'sonner';
import { resendSignupConfirmation, resetPassword, signIn, signUp } from '../../../lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { captureEvent, identifySignup } from '@/lib/analytics';
import LoginPage from '../LoginPage';

const mockedSignIn = vi.mocked(signIn);
const mockedSignUp = vi.mocked(signUp);
const mockedResetPassword = vi.mocked(resetPassword);
const mockedResend = vi.mocked(resendSignupConfirmation);
const mockedToastSuccess = vi.mocked(toast.success);
const mockedToastError = vi.mocked(toast.error);
const mockedUseAuth = vi.mocked(useAuth);
const mockedCaptureEvent = vi.mocked(captureEvent);
const mockedIdentifySignup = vi.mocked(identifySignup);

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
    mockedResend.mockReset();
    mockedToastSuccess.mockReset();
    mockedToastError.mockReset();
    mockedUseAuth.mockReset();
    mockedUseAuth.mockReturnValue({ user: null, loading: false } as never);
    mockedCaptureEvent.mockReset();
    mockedIdentifySignup.mockReset();
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
    // signUp having been called does not mean the verification state has
    // committed — on a loaded CI runner the render lands after this line,
    // so the text must be awaited, not asserted synchronously.
    await screen.findByText('Verifique seu e-mail');

    expect(
      screen.getByText(
        'Enviamos um link de confirmação para ana@mesaas.com. Clique nele para ativar sua conta.',
      ),
    ).toBeInTheDocument();
    // Not a Gmail address: no Gmail shortcut.
    expect(screen.queryByRole('link', { name: 'Abrir o Gmail' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Já confirmei, quero entrar' }));

    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveValue('ana@mesaas.com');
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
    // The toast fires in the same continuation that switches the tab, but the
    // render that brings the login form back can commit after this line under
    // CI load — and the forgot flow has no "Senha" field to find.
    await screen.findByLabelText('Senha');
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

  it('identifies the new user BEFORE capturing signup_completed, so the event attaches to a person', async () => {
    // Under PostHog's identified_only mode, a capture fired while anonymous is personless
    // forever — the order of these two calls is the whole fix for the orphaned-signup funnel.
    mockedSignUp.mockResolvedValue({
      data: { session: null, user: { id: 'uuid-1' } },
      error: null,
    } as never);
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container);
    submitRegister(container);
    await waitFor(() => expect(mockedCaptureEvent).toHaveBeenCalledWith('signup_completed'));
    expect(mockedIdentifySignup).toHaveBeenCalledWith('uuid-1');
    expect(mockedIdentifySignup.mock.invocationCallOrder[0]).toBeLessThan(
      mockedCaptureEvent.mock.invocationCallOrder[0],
    );
  });

  it('still captures signup_completed without identifying when signUp returns no user id', async () => {
    mockedSignUp.mockResolvedValue({ data: { session: null, user: null }, error: null } as never);
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container);
    submitRegister(container);
    await waitFor(() => expect(mockedCaptureEvent).toHaveBeenCalledWith('signup_completed'));
    expect(mockedIdentifySignup).not.toHaveBeenCalled();
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

describe('signup confirmation leaks', () => {
  beforeEach(() => {
    mockedSignIn.mockReset();
    mockedSignUp.mockReset();
    mockedResend.mockReset();
    mockedToastSuccess.mockReset();
    mockedToastError.mockReset();
    mockedCaptureEvent.mockReset();
    mockedIdentifySignup.mockReset();
    mockedUseAuth.mockReturnValue({ user: null, loading: false } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function submitLogin(email: string) {
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-segura' } });
    fireEvent.submit(screen.getByLabelText('E-mail').closest('form')!);
  }

  it('explains an unconfirmed email in Portuguese and resends the confirmation, instead of the raw English toast', async () => {
    mockedSignIn.mockResolvedValue({
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    } as never);
    mockedResend.mockResolvedValue({ error: null } as never);

    renderLoginPage('/login?plan=pro&interval=month');
    submitLogin(' ana@mesaas.com ');

    await screen.findByText('Confirme seu e-mail para entrar');
    expect(mockedToastError).not.toHaveBeenCalled();
    expect(mockedCaptureEvent).toHaveBeenCalledWith('login_email_not_confirmed');

    fireEvent.click(screen.getByRole('button', { name: 'Reenviar e-mail de confirmação' }));

    await waitFor(() =>
      expect(mockedResend).toHaveBeenCalledWith('ana@mesaas.com', '/login?plan=pro&interval=month'),
    );
    await waitFor(() =>
      expect(mockedToastSuccess).toHaveBeenCalledWith('Enviamos um novo link para ana@mesaas.com.'),
    );
    expect(mockedCaptureEvent).toHaveBeenCalledWith('signup_confirmation_resent');
    // Cooldown: Supabase refuses a second resend inside the minute.
    expect(screen.getByRole('button', { name: /Reenviar em \d+s/ })).toBeDisabled();
  });

  it('shows a translated error when the resend is refused', async () => {
    mockedSignIn.mockResolvedValue({
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    } as never);
    mockedResend.mockResolvedValue({ error: { message: 'rate limited' } } as never);

    renderLoginPage();
    submitLogin('ana@mesaas.com');
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar e-mail de confirmação' }));

    await waitFor(() =>
      expect(mockedToastError).toHaveBeenCalledWith(
        'Não foi possível reenviar agora. Aguarde um minuto e tente de novo.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Reenviar e-mail de confirmação' })).toBeEnabled();
  });

  it('tells an existing account apart from a new signup and does not identify the fake user', async () => {
    mockedSignUp.mockResolvedValue({
      data: { session: null, user: { id: 'fake-uuid', identities: [] } },
      error: null,
    } as never);
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container);
    submitRegister(container);

    await screen.findByText('Você já tem uma conta');
    expect(screen.queryByText('Verifique seu e-mail')).not.toBeInTheDocument();
    expect(mockedIdentifySignup).not.toHaveBeenCalled();
    expect(mockedCaptureEvent).not.toHaveBeenCalledWith('signup_completed');
    expect(mockedCaptureEvent).toHaveBeenCalledWith('signup_existing_account');

    fireEvent.click(screen.getByRole('button', { name: 'Entrar com minha senha' }));
    expect(screen.getByLabelText('E-mail')).toHaveValue('ana@example.com');
  });

  it('sends an existing account to the forgot-password form with the email filled in', async () => {
    mockedSignUp.mockResolvedValue({
      data: { session: null, user: { id: 'fake-uuid', identities: [] } },
      error: null,
    } as never);
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container);
    submitRegister(container);

    fireEvent.click(await screen.findByRole('link', { name: 'Esqueci minha senha' }));
    expect(screen.getByRole('button', { name: 'Enviar Link' })).toBeInTheDocument();
    expect(container.querySelector('input[type="email"]')).toHaveValue('ana@example.com');
  });

  it('offers a Gmail shortcut and a resend on the check-your-email screen', async () => {
    mockedSignUp.mockResolvedValue({
      data: { session: null, user: { id: 'uuid-1', identities: [{ id: 'i' }] } },
      error: null,
    } as never);
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container);
    fireEvent.change(container.querySelector('#reg-email')!, {
      target: { value: 'ana@gmail.com' },
    });
    submitRegister(container);

    await screen.findByText('Verifique seu e-mail');
    expect(mockedIdentifySignup).toHaveBeenCalledWith('uuid-1');
    const gmail = screen.getByRole('link', { name: 'Abrir o Gmail' });
    expect(gmail).toHaveAttribute('target', '_blank');
    expect(gmail.getAttribute('href')).toMatch(/^https:\/\/mail\.google\.com\//);
    // The signup itself just sent the email, so the resend starts on cooldown.
    expect(screen.getByRole('button', { name: /Reenviar em \d+s/ })).toBeDisabled();
  });
});

describe('Crisp widget visibility', () => {
  let crispPush: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.$crisp = [];
    crispPush = vi.spyOn(window.$crisp, 'push');
  });

  afterEach(() => {
    crispPush.mockRestore();
  });

  it('hides the Crisp widget on mount, the same way AppLayout does for authenticated routes', () => {
    // /login is a standalone route, never nested under AppLayout, so
    // AppLayout's own chat:hide-on-mount never runs here. Without this,
    // a Crisp session left bound from a PRIOR visit on this browser (its
    // own cookie persists it independent of Supabase auth state -- see
    // the design spec's Verification section) would show fully
    // interactive and unhidden to whoever loads /login next.
    renderLoginPage();
    expect(crispPush).toHaveBeenCalledWith(['do', 'chat:hide']);
  });
});

describe('LoginPage inside the iOS app', () => {
  beforeEach(() => {
    mockedSignIn.mockReset();
    mockedToastSuccess.mockReset();
    mockedUseAuth.mockReset();
    mockedUseAuth.mockReturnValue({ user: null, loading: false } as never);
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  });

  afterEach(() => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
  });

  it('offers no "Criar Conta" tab', () => {
    renderLoginPage();
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar Conta' })).not.toBeInTheDocument();
  });

  it('opens the login form even with ?tab=register', () => {
    renderLoginPage('/login?tab=register');
    expect(screen.queryByLabelText('Nome Completo')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar Conta' })).not.toBeInTheDocument();
  });

  it('keeps the forgot-password flow', () => {
    renderLoginPage();
    fireEvent.click(screen.getByRole('link', { name: 'Esqueci minha senha' }));
    expect(screen.getByText(/Informe seu e-mail para receber um link/i)).toBeInTheDocument();
  });

  it('does not make the logo a link to the landing page', () => {
    renderLoginPage();
    expect(
      screen.queryByRole('link', { name: 'Ir para a página inicial' }),
    ).not.toBeInTheDocument();
    expect(screen.getByAltText('Mesaas')).toBeInTheDocument();
  });

  it('ignores a plan intent after login and goes to /dashboard, never /comecar', async () => {
    mockedSignIn.mockResolvedValue({ error: null } as never);
    renderRegister('/login?plan=pro&interval=year');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@mesaas.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-segura' } });
    fireEvent.submit(screen.getByLabelText('E-mail').closest('form')!);

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/dashboard'));
  });

  it('sends an already-authenticated visitor with a plan intent to /dashboard', async () => {
    mockedUseAuth.mockReturnValue({ user: { id: 'user-1' }, loading: false } as never);
    renderRegister('/login?plan=pro&interval=year');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/dashboard'));
  });
});

describe('LoginPage on the web keeps the landing link', () => {
  it('links the logo to the landing page', () => {
    mockedUseAuth.mockReturnValue({ user: null, loading: false } as never);
    renderLoginPage();
    expect(screen.getByRole('link', { name: 'Ir para a página inicial' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
