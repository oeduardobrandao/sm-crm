import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getPublicConnectInfo = vi.fn();
const startPublicConnect = vi.fn();

vi.mock('../../../services/connectLink', () => ({
  getPublicConnectInfo: (...a: unknown[]) => getPublicConnectInfo(...a),
  startPublicConnect: (...a: unknown[]) => startPublicConnect(...a),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

import ConectarPage from '../ConectarPage';

function renderAt(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/conectar/tok-1${search}`]}>
      <Routes>
        <Route path="/conectar/:token" element={<ConectarPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConectarPage', () => {
  beforeEach(() => {
    getPublicConnectInfo.mockReset();
    startPublicConnect.mockReset();
  });

  test('live link shows both names and the connect button', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live',
      cliente_name: 'Clínica X',
      workspace_name: 'Agência Y',
      connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
    expect(screen.getByText(/Clínica X/)).toBeInTheDocument();
    expect(screen.getByText(/Agência Y/)).toBeInTheDocument();
  });

  test('clicking connect navigates to the Instagram url', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live',
      cliente_name: 'Clínica X',
      workspace_name: 'Agência Y',
      connected_username: null,
    });
    startPublicConnect.mockResolvedValue('https://www.instagram.com/oauth/authorize?x=1');
    const assign = vi.fn();
    // window.location has no configurable setter for `assign` alone (jsdom
    // marks it non-configurable), so the whole object has to be swapped.
    // Scoped to just this test via try/finally -- must not leak into other
    // suites sharing a worker/environment.
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, assign, search: '' },
      configurable: true,
      writable: true,
    });
    try {
      renderAt();
      await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button'));
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith('https://www.instagram.com/oauth/authorize?x=1'),
      );
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        configurable: true,
        writable: true,
      });
    }
  });

  test('revoked link shows the revoked state and no button', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'revoked',
      cliente_name: '',
      workspace_name: '',
      connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.revokedTitle')).toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('unavailable link shows the unavailable state and no button', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'unavailable',
      cliente_name: '',
      workspace_name: '',
      connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.unavailableTitle')).toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('expired link shows the expired state', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'expired',
      cliente_name: '',
      workspace_name: '',
      connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.expiredTitle')).toBeInTheDocument());
  });

  test('unknown token shows the invalid state', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'not_found',
      cliente_name: '',
      workspace_name: '',
      connected_username: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.invalidTitle')).toBeInTheDocument());
  });

  test('an already-connected account shows the already state', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live',
      cliente_name: 'Clínica X',
      workspace_name: 'Agência Y',
      connected_username: 'clinicax',
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('connect.alreadyTitle')).toBeInTheDocument());
  });

  test('ig_connected in the url shows the success state', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live',
      cliente_name: 'Clínica X',
      workspace_name: 'Agência Y',
      connected_username: 'clinicax',
    });
    renderAt('?ig_connected=new');
    await waitFor(() => expect(screen.getByText('connect.successTitle')).toBeInTheDocument());
  });

  test('ig_error in the url shows the shared error copy', async () => {
    getPublicConnectInfo.mockResolvedValue({
      status: 'live',
      cliente_name: 'Clínica X',
      workspace_name: 'Agência Y',
      connected_username: null,
    });
    renderAt('?ig_error=link_revoked');
    await waitFor(() => expect(screen.getByText('detail.igLinkRevoked')).toBeInTheDocument());
  });
});
