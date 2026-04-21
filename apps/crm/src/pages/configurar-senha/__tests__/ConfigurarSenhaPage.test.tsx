import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/supabase');

import { toast } from 'sonner';
import {
  __resetSupabaseMock,
  __setCurrentSession,
  __emitAuthChange,
  __queueSupabaseResult,
} from '../../../lib/__mocks__/supabase';
import ConfigurarSenhaPage from '../ConfigurarSenhaPage';

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/configurar-senha']}>
      <Routes>
        <Route path="/configurar-senha" element={<ConfigurarSenhaPage />} />
        <Route path="/login" element={<PathProbe />} />
        <Route path="/dashboard" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const INVITE_SESSION = {
  access_token: 'invite-token',
  user: {
    id: 'invited-user-1',
    email: 'novo@equipe.com',
    user_metadata: {
      conta_id: 'workspace-1',
      role: 'agent',
      nome: 'novo',
    },
  },
};

const RECOVERY_SESSION = {
  access_token: 'recovery-token',
  user: {
    id: 'existing-user-1',
    email: 'user@equipe.com',
    user_metadata: {},
  },
};

const OWNER_PROFILE = {
  nome: 'Eduardo Souza',
  empresa: 'Agencia X',
};

describe('ConfigurarSenhaPage', () => {
  beforeEach(() => {
    __resetSupabaseMock();
    __setCurrentSession(null);
    vi.mocked(toast.error).mockClear();
  });

  // --- Session detection via auth events ---

  it('detects invite session via INITIAL_SESSION event', async () => {
    __queueSupabaseResult('profiles', 'select', { data: OWNER_PROFILE });
    renderPage();

    act(() => { __emitAuthChange('INITIAL_SESSION', INVITE_SESSION as any); });

    await waitFor(() => {
      expect(screen.getByText('Você foi convidado')).toBeInTheDocument();
    });
    expect(screen.queryByText('Link inválido ou expirado')).not.toBeInTheDocument();
  });

  it('detects invite session via SIGNED_IN event', async () => {
    __queueSupabaseResult('profiles', 'select', { data: OWNER_PROFILE });
    renderPage();

    act(() => { __emitAuthChange('SIGNED_IN', INVITE_SESSION as any); });

    await waitFor(() => {
      expect(screen.getByText('Você foi convidado')).toBeInTheDocument();
    });
  });

  it('detects password recovery via PASSWORD_RECOVERY event', async () => {
    renderPage();

    act(() => { __emitAuthChange('PASSWORD_RECOVERY', RECOVERY_SESSION as any); });

    await waitFor(() => {
      expect(screen.getByText('Configurar Senha')).toBeInTheDocument();
    });
  });

  it('detects password recovery via INITIAL_SESSION without conta_id', async () => {
    renderPage();

    act(() => { __emitAuthChange('INITIAL_SESSION', RECOVERY_SESSION as any); });

    await waitFor(() => {
      expect(screen.getByText('Configurar Senha')).toBeInTheDocument();
    });
  });

  it('shows invite form fields (name + password) for invite flow', async () => {
    __queueSupabaseResult('profiles', 'select', { data: OWNER_PROFILE });
    renderPage();

    act(() => { __emitAuthChange('INITIAL_SESSION', INVITE_SESSION as any); });

    await waitFor(() => {
      expect(screen.getByLabelText('Seu nome completo')).toBeInTheDocument();
      expect(screen.getByLabelText('Crie sua senha')).toBeInTheDocument();
      expect(screen.getByText('Aceitar convite e entrar')).toBeInTheDocument();
    });
  });

  it('shows only password field for recovery flow', async () => {
    renderPage();

    act(() => { __emitAuthChange('PASSWORD_RECOVERY', RECOVERY_SESSION as any); });

    await waitFor(() => {
      expect(screen.getByLabelText('Nova senha')).toBeInTheDocument();
      expect(screen.getByText('Salvar senha')).toBeInTheDocument();
      expect(screen.queryByLabelText('Seu nome completo')).not.toBeInTheDocument();
    });
  });

  // --- Timeout behavior ---

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows error after 8 seconds with no session', async () => {
      renderPage();

      act(() => { vi.advanceTimersByTime(8000); });

      expect(screen.getByText('Link inválido ou expirado')).toBeInTheDocument();
    });

    it('does not show error before 8 seconds', async () => {
      renderPage();

      act(() => { vi.advanceTimersByTime(7000); });

      expect(screen.queryByText('Link inválido ou expirado')).not.toBeInTheDocument();
    });

    it('clears token error when session arrives after timeout', async () => {
      __queueSupabaseResult('profiles', 'select', { data: OWNER_PROFILE });
      renderPage();

      act(() => { vi.advanceTimersByTime(9000); });

      expect(screen.getByText('Link inválido ou expirado')).toBeInTheDocument();

      await act(async () => {
        __emitAuthChange('SIGNED_IN', INVITE_SESSION as any);
      });

      await waitFor(() => {
        expect(screen.queryByText('Link inválido ou expirado')).not.toBeInTheDocument();
        expect(screen.getByText('Você foi convidado')).toBeInTheDocument();
      });
    });
  });

  // --- Form submission ---

  it('calls accept-invite on submit for invite flow', async () => {
    __setCurrentSession(INVITE_SESSION as any);
    __queueSupabaseResult('profiles', 'select', { data: OWNER_PROFILE });
    __queueSupabaseResult('profiles', 'update', { data: null });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Convite aceito.' }), { status: 200 }),
    );

    renderPage();

    act(() => { __emitAuthChange('INITIAL_SESSION', INVITE_SESSION as any); });

    await waitFor(() => {
      expect(screen.getByText('Aceitar convite e entrar')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Seu nome completo'), {
      target: { value: 'Maria Silva' },
    });
    fireEvent.change(screen.getByLabelText('Crie sua senha'), {
      target: { value: 'Senha@123' },
    });

    fireEvent.click(screen.getByText('Aceitar convite e entrar'));

    await waitFor(() => {
      expect(screen.getByText('Conta criada com sucesso!')).toBeInTheDocument();
    });

    const acceptCall = fetchSpy.mock.calls.find(
      (c) => String(c[0]).includes('manage-workspace-user'),
    );
    expect(acceptCall).toBeDefined();
    const body = JSON.parse(String((acceptCall![1] as any).body));
    expect(body.action).toBe('accept-invite');
    expect(body.email).toBe('novo@equipe.com');

    fetchSpy.mockRestore();
  });

  it('shows toast when session expired before submit', async () => {
    __setCurrentSession(INVITE_SESSION as any);
    __queueSupabaseResult('profiles', 'select', { data: OWNER_PROFILE });
    renderPage();

    act(() => { __emitAuthChange('INITIAL_SESSION', INVITE_SESSION as any); });

    await waitFor(() => {
      expect(screen.getByText('Aceitar convite e entrar')).toBeInTheDocument();
    });

    // Session expires after the form is shown
    __setCurrentSession(null);

    fireEvent.change(screen.getByLabelText('Seu nome completo'), {
      target: { value: 'Maria Silva' },
    });
    fireEvent.change(screen.getByLabelText('Crie sua senha'), {
      target: { value: 'Senha@123' },
    });

    fireEvent.click(screen.getByText('Aceitar convite e entrar'));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Sessão expirada. Solicite um novo link.',
      );
    });
  });
});
