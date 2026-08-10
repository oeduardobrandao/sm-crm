import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { workspaceStoreMock, rpcMock } = vi.hoisted(() => ({
  workspaceStoreMock: {
    getStorageAutoclean: vi.fn(async () => ({
      storage_autoclean_enabled: true,
      storage_autoclean_delay_days: 30,
      storage_autoclean_threshold_pct: 75,
      storage_autoclean_last_run_at: '2026-08-09T05:30:00Z',
      storage_autoclean_last_files: 12,
      storage_autoclean_last_bytes: 480 * 1024 * 1024,
    })),
    updateStorageAutoclean: vi.fn(async () => {}),
  },
  rpcMock: vi.fn(async () => ({
    data: { files_count: 37, bytes_total: 1.4 * 1024 ** 3 },
    error: null,
  })),
}));

vi.mock('../../../../store/workspace', () => workspaceStoreMock);

vi.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let mockIsOwner = true;
vi.mock('../../../../hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => mockIsOwner,
}));

let mockUsage: { usage: { storage_used_bytes?: number } | null } = {
  usage: { storage_used_bytes: 2.1 * 1024 ** 3 },
};
vi.mock('../../../../hooks/useWorkspaceUsage', () => ({
  useWorkspaceUsage: () => ({ ...mockUsage, isLoading: false, isError: false }),
}));

let mockLimits: {
  limits: { storage_quota_bytes: number | null } | null;
  planName: string | null;
  isLoading: boolean;
  isUnlimited: boolean;
} = {
  limits: { storage_quota_bytes: 5 * 1024 ** 3 },
  planName: 'Pro',
  isLoading: false,
  isUnlimited: false,
};
vi.mock('../../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ ...mockLimits, features: null }),
}));

import ArmazenamentoTab from '../ArmazenamentoTab';

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ArmazenamentoTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsOwner = true;
  mockUsage = { usage: { storage_used_bytes: 2.1 * 1024 ** 3 } };
  mockLimits = {
    limits: { storage_quota_bytes: 5 * 1024 ** 3 },
    planName: 'Pro',
    isLoading: false,
    isUnlimited: false,
  };
});

describe('ArmazenamentoTab', () => {
  it('renders the meter, policy form, live estimate and last run', async () => {
    renderTab();

    expect(await screen.findByText('Uso de armazenamento')).toBeInTheDocument();
    expect(screen.getByText('Ativar limpeza automática')).toBeInTheDocument();
    expect(screen.getByText('Quando remover')).toBeInTheDocument();
    // Threshold selector visible on a quota-limited plan.
    expect(screen.getByText('Somente quando o uso passar de')).toBeInTheDocument();

    // Estimate from the preview RPC (37 files, ~1,4 GB).
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('storage_autoclean_preview', {
        p_delay_days: 30,
      }),
    );
    expect(await screen.findByText(/37\s+arquivos/)).toBeInTheDocument();

    // Last run line from the settings row.
    expect(screen.getByText(/Última limpeza/)).toBeInTheDocument();
    expect(screen.getByText(/12\s+arquivos/)).toBeInTheDocument();

    const save = screen.getByRole('button', { name: /Salvar alterações/ });
    await waitFor(() => expect(save).not.toBeDisabled());
  });

  it('hides the threshold selector when the plan storage is unlimited', async () => {
    mockLimits = {
      limits: { storage_quota_bytes: null },
      planName: 'Max',
      isLoading: false,
      isUnlimited: false,
    };
    renderTab();

    expect(await screen.findByText('Ativar limpeza automática')).toBeInTheDocument();
    expect(screen.queryByText('Somente quando o uso passar de')).not.toBeInTheDocument();
  });

  it('disables saving when the settings read failed (stale-read guard)', async () => {
    workspaceStoreMock.getStorageAutoclean.mockRejectedValueOnce(new Error('boom'));
    renderTab();

    expect(
      await screen.findByText(/Não foi possível carregar as configurações de armazenamento/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar alterações/ })).toBeDisabled();
  });

  it('shows the owner-only gate for non-owners without fetching settings', () => {
    mockIsOwner = false;
    renderTab();

    expect(screen.getByText(/Somente o dono do workspace/)).toBeInTheDocument();
    expect(workspaceStoreMock.getStorageAutoclean).not.toHaveBeenCalled();
  });
});
