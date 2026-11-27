import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    fetchBootstrap: vi.fn(),
    fetchPosts: vi.fn().mockResolvedValue({ posts: [], postApprovals: [], instagramProfile: null }),
    fetchMensagensUnread: vi.fn().mockResolvedValue({ unread: 0 }),
    requestLoginCode: vi.fn(),
    verifyLoginCode: vi.fn(),
    logoutHub: vi.fn(),
  };
});
vi.mock('../../lib/hubSession', () => ({
  getHubSession: vi.fn(() => null),
  setHubSession: vi.fn(),
  clearHubSession: vi.fn(),
}));
vi.mock('../../services/materialRequests', () => ({ fetchMaterialRequests: vi.fn() }));

import {
  fetchBootstrap,
  HubApiError,
  logoutHub,
  requestLoginCode,
  verifyLoginCode,
} from '../../api';
import { fetchMensagensUnread, fetchPosts } from '../../api';
import { fetchMaterialRequests } from '../../services/materialRequests';
import { clearHubSession } from '../../lib/hubSession';
import { createHubQueryClient, hubBootstrapQuery } from '../../queries';
import type { HubBootstrap, HubLoginPayload } from '../../types';
import { HubShell } from '../HubShell';
import { i18n, setActiveWorkspaceLanguage } from '@mesaas/i18n';

const mockedBootstrap = vi.mocked(fetchBootstrap);
const mockedLogout = vi.mocked(logoutHub);
const mockedRequest = vi.mocked(requestLoginCode);
const mockedVerify = vi.mocked(verifyLoginCode);
const mockedClear = vi.mocked(clearHubSession);

const LOGIN: HubLoginPayload = {
  workspace: { name: 'Studio Aurora', logo_url: null, brand_color: '#123abc' },
  hub_theme: null,
};

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Studio Aurora', logo_url: null, brand_color: '#0f766e' },
  cliente_nome: 'Clínica Vida',
  is_active: true,
  cliente_id: 14,
  feature_mensagens: false,
  person: { nome: 'Marina Costa', email: 'marina@clinicavida.com.br' },
};

const loginRequired = () =>
  new HubApiError('Login necessário.', 401, 'login_required', { login: LOGIN });

function mount(qc = new QueryClient()) {
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/aurora/hub/tok']}>
        <Routes>
          <Route path="/:workspace/hub/:token" element={<HubShell />}>
            <Route index element={<Outlet />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

async function typeEmailAndCode(code = '482931') {
  fireEvent.change(await screen.findByLabelText('E-mail'), {
    target: { value: 'marina@clinicavida.com.br' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
  fireEvent.change(await screen.findByLabelText('Código de 6 dígitos'), {
    target: { value: code },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  });
}

describe('HubShell login', () => {
  beforeEach(() => {
    mockedBootstrap.mockReset();
    vi.mocked(fetchPosts).mockResolvedValue({
      posts: [],
      postApprovals: [],
      instagramProfile: null,
    });
    vi.mocked(fetchMensagensUnread).mockResolvedValue({ unread: 0 });
    vi.mocked(fetchMaterialRequests).mockResolvedValue([]);
    mockedLogout.mockReset();
    mockedRequest.mockReset().mockResolvedValue({ ok: true });
    mockedVerify.mockReset();
    mockedClear.mockReset();
    document.head.innerHTML = '';
    localStorage.clear();
  });

  it('renders the login screen, themed by the login payload, on login_required', async () => {
    mockedBootstrap.mockRejectedValue(loginRequired());
    mount();
    expect(await screen.findByText('Entre no seu portal')).toBeInTheDocument();
    expect(screen.queryByText('Link inválido ou expirado.')).not.toBeInTheDocument();
    const styles = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent)
      .join(' ');
    expect(styles).toMatch(/--hub-acc:\s*#123abc/i);
  });

  it('still renders the invalid link screen on a 404', async () => {
    mockedBootstrap.mockRejectedValue(new HubApiError('Link inválido.', 404));
    mount();
    expect(await screen.findByText('Link inválido ou expirado.')).toBeInTheDocument();
    expect(screen.queryByText('Entre no seu portal')).not.toBeInTheDocument();
  });

  it('falls back to the invalid link screen when login_required carries no login payload', async () => {
    mockedBootstrap.mockRejectedValue(new HubApiError('Login necessário.', 401, 'login_required'));
    mount();
    expect(await screen.findByText('Link inválido ou expirado.')).toBeInTheDocument();
    expect(screen.queryByText('Login necessário.')).not.toBeInTheDocument();
  });

  it('invalidates all queries after a successful login', async () => {
    mockedBootstrap.mockRejectedValueOnce(loginRequired()).mockResolvedValue(BOOTSTRAP);
    mockedVerify.mockResolvedValue({ session_token: 's' });
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    mount(qc);
    await typeEmailAndCode();
    await waitFor(() => expect(spy).toHaveBeenCalledWith());
    expect(
      (await screen.findAllByRole('button', { name: /Conta de Marina Costa/ })).length,
    ).toBeGreaterThan(0);
  });

  it('shows the login instead of the portal when a refetch fails with login_required', async () => {
    const qc = new QueryClient();
    mockedBootstrap.mockResolvedValue(BOOTSTRAP);
    mount(qc);
    await waitFor(() => expect(screen.getAllByText('Clínica Vida').length).toBeGreaterThan(0));
    mockedBootstrap.mockRejectedValue(loginRequired());
    await act(async () => {
      await qc.invalidateQueries({ queryKey: hubBootstrapQuery('aurora', 'tok').queryKey });
    });
    expect(await screen.findByText('Entre no seu portal')).toBeInTheDocument();
  });

  it('swaps an open anonymous portal to the login screen when a later call returns login_required', async () => {
    const qc = createHubQueryClient();
    mockedBootstrap.mockResolvedValue(BOOTSTRAP);
    mount(qc);
    await waitFor(() => expect(screen.getAllByText('Clínica Vida').length).toBeGreaterThan(0));
    // The agency turns "Exigir login" on: bootstrap now answers 401 and so does the next call.
    mockedBootstrap.mockRejectedValue(loginRequired());
    await act(async () => {
      await qc
        .fetchQuery({
          queryKey: ['hub-other'],
          queryFn: () => Promise.reject(loginRequired()),
          retry: false,
        })
        .catch(() => undefined);
    });
    expect(await screen.findByText('Entre no seu portal')).toBeInTheDocument();
  });

  it('keeps the portal on any other refetch error', async () => {
    const qc = new QueryClient();
    mockedBootstrap.mockResolvedValue(BOOTSTRAP);
    mount(qc);
    await waitFor(() => expect(screen.getAllByText('Clínica Vida').length).toBeGreaterThan(0));
    mockedBootstrap.mockRejectedValue(new Error('boom'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: hubBootstrapQuery('aurora', 'tok').queryKey });
    });
    expect(screen.queryByText('Entre no seu portal')).not.toBeInTheDocument();
    expect(screen.queryByText('Link inválido ou expirado.')).not.toBeInTheDocument();
    expect(screen.getAllByText('Clínica Vida').length).toBeGreaterThan(0);
  });

  it('renders the account menu only when the bootstrap has a person', async () => {
    mockedBootstrap.mockResolvedValue({ ...BOOTSTRAP, person: null });
    mount();
    await waitFor(() => expect(screen.getAllByText('Clínica Vida').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /Conta de/ })).not.toBeInTheDocument();
  });

  it('renders the account menu for a logged-in person', async () => {
    mockedBootstrap.mockResolvedValue(BOOTSTRAP);
    mount();
    expect((await screen.findAllByRole('button', { name: 'Conta de Marina Costa' })).length).toBe(
      2,
    );
  });

  it('signs out: logoutHub, clear the session, drop the other queries, invalidate bootstrap', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const removeSpy = vi.spyOn(qc, 'removeQueries');
    const resetSpy = vi.spyOn(qc, 'resetQueries');
    mockedBootstrap.mockResolvedValueOnce(BOOTSTRAP).mockRejectedValue(loginRequired());
    mockedLogout.mockResolvedValue({ ok: true });
    mount(qc);
    const [trigger] = await screen.findAllByRole('button', { name: 'Conta de Marina Costa' });
    qc.setQueryData(['hub-dashboard', 'tok', 30, 'default'], { secret: 'previous person' });
    await waitFor(() => expect(vi.mocked(fetchPosts)).toHaveBeenCalled());
    const postsCallsBefore = vi.mocked(fetchPosts).mock.calls.length;
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('button', { name: 'Sair' })[0]);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['hub-bootstrap'] }));
    expect(spy).not.toHaveBeenCalledWith();
    expect(mockedLogout.mock.invocationCallOrder[0]).toBeLessThan(
      mockedClear.mock.invocationCallOrder[0],
    );
    expect(mockedClear.mock.invocationCallOrder[0]).toBeLessThan(spy.mock.invocationCallOrder[0]);
    // Gated hub: bootstrap failed, so the rest is removed outright, never refetched.
    await waitFor(() => expect(removeSpy).toHaveBeenCalled());
    expect(resetSpy).not.toHaveBeenCalled();
    expect(vi.mocked(fetchPosts).mock.calls.length).toBe(postsCallsBefore);
    expect(qc.getQueryData(['hub-dashboard', 'tok', 30, 'default'])).toBeUndefined();
    expect(qc.getQueryState(hubBootstrapQuery('aurora', 'tok').queryKey)).toBeDefined();
    expect(await screen.findByText('Entre no seu portal')).toBeInTheDocument();
  });

  it('keeps an open hub working after sign out: dropped queries load again', async () => {
    const qc = new QueryClient();
    mockedBootstrap.mockResolvedValue(BOOTSTRAP);
    mockedLogout.mockResolvedValue({ ok: true });
    mount(qc);
    const [trigger] = await screen.findAllByRole('button', { name: 'Conta de Marina Costa' });
    await waitFor(() => expect(vi.mocked(fetchPosts)).toHaveBeenCalled());
    const before = vi.mocked(fetchPosts).mock.calls.length;
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('button', { name: 'Sair' })[0]);
    await waitFor(() => expect(mockedClear).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(fetchPosts).mock.calls.length).toBeGreaterThan(before));
    expect(screen.getAllByText('Clínica Vida').length).toBeGreaterThan(0);
  });

  it('keeps the portal recoverable when the bootstrap refetch after sign out fails for another reason', async () => {
    const qc = new QueryClient();
    const removeSpy = vi.spyOn(qc, 'removeQueries');
    mockedBootstrap
      .mockResolvedValueOnce(BOOTSTRAP)
      .mockRejectedValue(new HubApiError('Erro interno.', 500));
    mockedLogout.mockResolvedValue({ ok: true });
    mount(qc);
    const [trigger] = await screen.findAllByRole('button', { name: 'Conta de Marina Costa' });
    await waitFor(() => expect(vi.mocked(fetchPosts)).toHaveBeenCalled());
    const before = vi.mocked(fetchPosts).mock.calls.length;
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('button', { name: 'Sair' })[0]);
    // Not a login_required: the portal stays mounted, so its queries are reset, not removed.
    await waitFor(() => expect(vi.mocked(fetchPosts).mock.calls.length).toBeGreaterThan(before));
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('signs out locally even when logoutHub rejects', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    mockedBootstrap.mockResolvedValue(BOOTSTRAP);
    mockedLogout.mockRejectedValue(new Error('offline'));
    mount(qc);
    const [trigger] = await screen.findAllByRole('button', { name: 'Conta de Marina Costa' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('button', { name: 'Sair' })[0]);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['hub-bootstrap'] }));
    expect(mockedClear).toHaveBeenCalled();
  });

  it('keeps the code step and the typed email across a focus change', async () => {
    mockedBootstrap.mockRejectedValue(loginRequired());
    mount();
    fireEvent.change(await screen.findByLabelText('E-mail'), {
      target: { value: 'marina@clinicavida.com.br' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    await screen.findByLabelText('Código de 6 dígitos');
    const callsBefore = mockedBootstrap.mock.calls.length;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(screen.getByLabelText('Código de 6 dígitos')).toBeInTheDocument();
    expect(screen.getByText(/marina@clinicavida\.com\.br/)).toBeInTheDocument();
    expect(within(document.body).queryByLabelText('E-mail')).not.toBeInTheDocument();
    expect(mockedBootstrap.mock.calls.length).toBe(callsBefore);
  });
  describe('workspace language', () => {
    beforeEach(async () => {
      setActiveWorkspaceLanguage(null);
      await i18n.changeLanguage('pt');
    });
    afterEach(async () => {
      setActiveWorkspaceLanguage(null);
      await i18n.changeLanguage('pt');
    });

    it('Hub renders English for an en workspace without explicit choice', async () => {
      mockedBootstrap.mockResolvedValue({ ...BOOTSTRAP, language: 'en', is_active: false });
      mount();
      expect(await screen.findByText('Access disabled.')).toBeInTheDocument();
      expect(i18n.language).toBe('en');
      await waitFor(() => expect(document.title).toBe('Client hub'));
    });

    it('applies the language of the login_required payload to the login screen', async () => {
      mockedBootstrap.mockRejectedValue(
        new HubApiError('Login necessário.', 401, 'login_required', {
          login: { ...LOGIN, workspace: { ...LOGIN.workspace, language: 'en' } },
        }),
      );
      mount();
      expect(await screen.findByText('Sign in to your portal')).toBeInTheDocument();
      expect(i18n.language).toBe('en');
    });

    it('explicit pt toggle wins', async () => {
      localStorage.setItem('mesaas-language', 'pt');
      mockedBootstrap.mockResolvedValue({ ...BOOTSTRAP, language: 'en', is_active: false });
      mount();
      expect(await screen.findByText('Acesso desativado.')).toBeInTheDocument();
      expect(i18n.language).toBe('pt');
    });
  });
});
