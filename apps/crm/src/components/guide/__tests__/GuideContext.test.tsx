import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PROGRESS, loadGuideProgress, saveGuideProgress } from '../guideStorage';
import type { GuideSignals } from '../useGuideSignals';

const {
  useAuthMock,
  useIsWorkspaceOwnerMock,
  useEntitlementsMock,
  useGuideSignalsMock,
  captureEventMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useIsWorkspaceOwnerMock: vi.fn(),
  useEntitlementsMock: vi.fn(),
  useGuideSignalsMock: vi.fn(),
  captureEventMock: vi.fn(),
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../../hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: useIsWorkspaceOwnerMock,
}));
vi.mock('../../../hooks/useEntitlements', () => ({ useEntitlements: useEntitlementsMock }));
vi.mock('../useGuideSignals', () => ({ useGuideSignals: useGuideSignalsMock }));
vi.mock('../../../lib/analytics', () => ({ captureEvent: captureEventMock }));

import { GuideProvider, useGuide } from '../GuideContext';

const EMPTY_SIGNALS: GuideSignals = {
  values: {},
  latestClienteId: null,
  clientes: { status: 'success', count: 0 },
  workflows: { status: 'success', count: 0 },
};

function Probe() {
  const g = useGuide();
  if (!g) return null;
  return (
    <div>
      <span data-testid="open">{String(g.isOpen)}</span>
      <span data-testid="entry">{String(g.showEntryPoint)}</span>
      <button onClick={() => g.open('pill')}>abrir</button>
      <button onClick={() => g.close()}>fechar</button>
    </div>
  );
}

function renderProvider(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GuideProvider>
        <Probe />
      </GuideProvider>
    </MemoryRouter>,
  );
}

describe('GuideProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthMock.mockReturnValue({ loading: false, profile: { conta_id: 'ws-1' } });
    useIsWorkspaceOwnerMock.mockReturnValue(true);
    useEntitlementsMock.mockReturnValue({ hasFeature: () => true });
    useGuideSignalsMock.mockReturnValue(EMPTY_SIGNALS);
  });

  it('auto-abre no dashboard vazio e grava autoOpenedAt uma vez', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('true'));
    expect(loadGuideProgress('ws-1').autoOpenedAt).toBeTruthy();
    expect(captureEventMock).toHaveBeenCalledWith('guide_opened', { source: 'auto' });
  });

  it('não auto-abre fora do dashboard nem para não-dono', () => {
    renderProvider('/clientes');
    expect(screen.getByTestId('open').textContent).toBe('false');
    useIsWorkspaceOwnerMock.mockReturnValue(false);
    renderProvider();
    expect(screen.getAllByTestId('open').at(-1)!.textContent).toBe('false');
  });

  it('fechar grava dismissedAt e captura guide_closed', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('true'));
    act(() => screen.getByText('fechar').click());
    expect(screen.getByTestId('open').textContent).toBe('false');
    expect(loadGuideProgress('ws-1').dismissedAt).toBeTruthy();
    expect(captureEventMock).toHaveBeenCalledWith('guide_closed', { page: null });
  });

  it('showEntryPoint é false para não-dono e após conclusão por sinais', () => {
    useGuideSignalsMock.mockReturnValue({
      ...EMPTY_SIGNALS,
      clientes: { status: 'success', count: 1 },
      values: {
        hasCliente: true,
        hasInstagram: true,
        hasHubToken: true,
        hasMembro: true,
        hasWorkflow: true,
      },
    });
    renderProvider();
    expect(screen.getByTestId('entry').textContent).toBe('false');
  });

  it('conclusão por sinais persiste concludedAt e captura guide_completed via signals', async () => {
    useGuideSignalsMock.mockReturnValue({
      ...EMPTY_SIGNALS,
      clientes: { status: 'success', count: 1 },
      values: {
        hasCliente: true,
        hasInstagram: true,
        hasHubToken: true,
        hasMembro: true,
        hasWorkflow: true,
      },
    });
    renderProvider();
    await waitFor(() => expect(loadGuideProgress('ws-1').concludedAt).toBeTruthy());
    expect(captureEventMock).toHaveBeenCalledWith('guide_completed', { via: 'signals' });
  });

  it('não recomputa sinais quando o guia já foi concluído no storage', () => {
    saveGuideProgress('ws-1', {
      ...EMPTY_PROGRESS,
      concludedAt: '2026-08-01T00:00:00.000Z',
    });
    renderProvider();
    expect(useGuideSignalsMock).toHaveBeenCalledWith(false);
  });
});
