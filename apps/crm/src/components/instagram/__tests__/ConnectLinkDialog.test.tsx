import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const getConnectLink = vi.fn();
const createConnectLink = vi.fn();
const revokeConnectLink = vi.fn();
const emailConnectLink = vi.fn();

vi.mock('../../../services/connectLink', () => ({
  getConnectLink: (...a: unknown[]) => getConnectLink(...a),
  createConnectLink: (...a: unknown[]) => createConnectLink(...a),
  revokeConnectLink: (...a: unknown[]) => revokeConnectLink(...a),
  emailConnectLink: (...a: unknown[]) => emailConnectLink(...a),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

import { ConnectLinkRow } from '../ConnectLinkDialog';

function renderRow(email: string | null = 'c@x.com') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConnectLinkRow clienteId={42} clienteEmail={email} />
    </QueryClientProvider>,
  );
}

describe('ConnectLinkRow', () => {
  beforeEach(() => {
    getConnectLink.mockReset();
    createConnectLink.mockReset();
    revokeConnectLink.mockReset();
    emailConnectLink.mockReset();
  });

  test('with no live link, offers to generate one', async () => {
    getConnectLink.mockResolvedValue(null);
    renderRow();
    await waitFor(() => expect(screen.getByText('connect.generate')).toBeInTheDocument());
    expect(screen.queryByText(/connect\.activeUntil/)).not.toBeInTheDocument();
  });

  test('with a live link, shows the expiry and a revoke action', async () => {
    getConnectLink.mockResolvedValue({
      url: 'https://app.mesaas.com.br/conectar/tok-1',
      expires_at: '2026-09-05T12:00:00.000Z',
    });
    renderRow();
    // O link pendente precisa ser VISÍVEL sem abrir nada: a agência não revoga
    // o que não sabe que existe.
    await waitFor(() => expect(screen.getByText(/connect\.activeUntil/)).toBeInTheDocument());
    expect(screen.getByText('connect.revoke')).toBeInTheDocument();
  });

  test('revoking calls the service and clears the row', async () => {
    getConnectLink.mockResolvedValue({
      url: 'https://app.mesaas.com.br/conectar/tok-1',
      expires_at: '2026-09-05T12:00:00.000Z',
    });
    revokeConnectLink.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderRow();
    await waitFor(() => expect(screen.getByText('connect.revoke')).toBeInTheDocument());
    getConnectLink.mockResolvedValue(null);
    fireEvent.click(screen.getByText('connect.revoke'));
    await waitFor(() => expect(revokeConnectLink).toHaveBeenCalledWith(42));
    // A revoked link must actually disappear from the row, not just trigger the call:
    // this row is the safety mechanism, so it may never keep showing a stale
    // expiry/Revogar for a link that no longer exists.
    await waitFor(() => {
      expect(screen.queryByText(/connect\.activeUntil/)).not.toBeInTheDocument();
      expect(screen.queryByText('connect.revoke')).not.toBeInTheDocument();
      expect(screen.getByText('connect.generate')).toBeInTheDocument();
    });
  });

  test('declining the confirm does not revoke', async () => {
    getConnectLink.mockResolvedValue({
      url: 'https://app.mesaas.com.br/conectar/tok-1',
      expires_at: '2026-09-05T12:00:00.000Z',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderRow();
    await waitFor(() => expect(screen.getByText('connect.revoke')).toBeInTheDocument());
    fireEvent.click(screen.getByText('connect.revoke'));
    expect(revokeConnectLink).not.toHaveBeenCalled();
  });

  test('generating calls the service', async () => {
    getConnectLink.mockResolvedValue(null);
    createConnectLink.mockResolvedValue({
      url: 'https://app.mesaas.com.br/conectar/tok-2',
      expires_at: '2026-09-05T12:00:00.000Z',
    });
    renderRow();
    await waitFor(() => expect(screen.getByText('connect.generate')).toBeInTheDocument());
    fireEvent.click(screen.getByText('connect.generate'));
    await waitFor(() => expect(createConnectLink).toHaveBeenCalledWith(42));
  });
});
