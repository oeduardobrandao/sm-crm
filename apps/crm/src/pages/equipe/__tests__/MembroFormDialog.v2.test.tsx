import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// MembroFormDialog while Financeiro v2 is on: the member's cost lives in the acordo, so
// editing a member no longer shows (or writes) custo_mensal / data_pagamento.

const { mockUseAuth, mockUseWorkspaceLimits } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseWorkspaceLimits: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/AuthContext')>()),
  useAuth: mockUseAuth,
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: mockUseWorkspaceLimits }));
vi.mock('@/store', async () => ({
  ...(await vi.importActual<typeof import('@/store')>('@/store')),
  addMembro: vi.fn(),
  updateMembro: vi.fn(),
  getWorkspaceUsers: vi.fn(),
  getWorkspaceRoles: vi.fn(),
  updateWorkspaceUserRole: vi.fn(),
  setMembroCrmUser: vi.fn(),
}));
vi.mock('@/services/invite', () => ({ inviteUser: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(async () => ({ data: [] })) })),
      })),
    })),
  },
}));

import * as store from '@/store';
import type { Membro } from '@/store';
import { MembroFormDialog } from '../MembroFormDialog';

const ANA: Membro = {
  id: 7,
  nome: 'Ana',
  cargo: 'Designer',
  tipo: 'clt',
  custo_mensal: 3900,
  data_pagamento: 5,
  avatar_url: null,
  crm_user_id: null,
};

function renderDialog(membro: Membro | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <MembroFormDialog
          open
          membro={membro}
          membros={membro ? [membro] : []}
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function setV2(ativo: boolean) {
  mockUseWorkspaceLimits.mockReturnValue({
    limits: { max_team_members: 10 },
    features: { feature_financial: true, feature_financeiro_v2: ativo },
    isLoading: false,
    isUnlimited: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    canSeeFinancials: true,
    can: makeCan(fakeMembership({ role: 'owner' })),
    workspaceRole: 'owner',
    user: { id: 'me' },
    profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
  });
  vi.mocked(store.getWorkspaceUsers).mockResolvedValue([]);
  vi.mocked(store.getWorkspaceRoles).mockResolvedValue([]);
  vi.mocked(store.updateMembro).mockResolvedValue(undefined);
  vi.mocked(store.addMembro).mockResolvedValue({ id: 42 } as never);
});

describe('MembroFormDialog with Financeiro v2', () => {
  it('membro_form_hides_custo_when_v2', () => {
    setV2(true);
    renderDialog(ANA);

    expect(screen.queryByLabelText('Custo Mensal (R$)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Dia de Pagamento (1-31)')).not.toBeInTheDocument();
    expect(screen.getByText('O custo agora fica no acordo da pessoa.')).toBeVisible();
    expect(screen.getByRole('link', { name: /acordo/i })).toHaveAttribute('href', '/equipe/7');
  });

  it('omits custo_mensal and data_pagamento from the edit payload when v2 is on', async () => {
    setV2(true);
    renderDialog(ANA);

    fireEvent.change(screen.getByLabelText('Cargo *'), { target: { value: 'Diretora de arte' } });
    fireEvent.click(screen.getByRole('button', { name: /^\s*Salvar$/ }));

    await waitFor(() => expect(store.updateMembro).toHaveBeenCalled());
    const [id, payload] = vi.mocked(store.updateMembro).mock.calls[0];
    expect(id).toBe(7);
    expect(payload).toEqual({ nome: 'Ana', cargo: 'Diretora de arte', tipo: 'clt' });
    expect(payload).not.toHaveProperty('custo_mensal');
    expect(payload).not.toHaveProperty('data_pagamento');
  });

  it('keeps the cost fields when creating a member', async () => {
    setV2(true);
    renderDialog(null);

    expect(screen.getByLabelText('Custo Mensal (R$)')).toBeInTheDocument();
    expect(screen.getByLabelText('Dia de Pagamento (1-31)')).toBeInTheDocument();
    expect(screen.queryByText('O custo agora fica no acordo da pessoa.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Nova' } });
    fireEvent.change(screen.getByLabelText('Cargo *'), { target: { value: 'Redatora' } });
    fireEvent.change(screen.getByLabelText('Custo Mensal (R$)'), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText('Dia de Pagamento (1-31)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /^\s*Salvar$/ }));

    await waitFor(() =>
      expect(store.addMembro).toHaveBeenCalledWith(
        expect.objectContaining({ custo_mensal: 1500, data_pagamento: 10 }),
      ),
    );
  });

  it('keeps the cost fields and writes them when v2 is off', async () => {
    setV2(false);
    renderDialog(ANA);

    expect(screen.getByLabelText('Custo Mensal (R$)')).toHaveValue(3900);
    expect(screen.queryByText('O custo agora fica no acordo da pessoa.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^\s*Salvar$/ }));

    await waitFor(() =>
      expect(store.updateMembro).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ custo_mensal: 3900, data_pagamento: 5 }),
      ),
    );
  });
});
