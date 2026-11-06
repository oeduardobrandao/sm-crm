import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Saída de etapa de aprovação no celular: o sheet se esconde ao escolher, então um
// posts_changed (que mantém o diálogo aberto) precisa trazê-lo de volta com os
// números novos, senão o fluxo fica preso.

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));

const store = vi.hoisted(() => ({
  advanceWorkflowFromApproval: vi.fn(),
  completeEtapa: vi.fn(),
  getWorkflowPostStatusCounts: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  revertEtapa: vi.fn(),
  sendPostsToCliente: vi.fn(),
  getDeadlineInfo: vi.fn(),
  getWorkflowPostsWithProperties: vi.fn(),
  getWorkspaceSlug: vi.fn(),
}));
vi.mock('../../../../store', () => store);

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { toast } from 'sonner';
import { useWorkflowStageCommands } from '../useWorkflowStageCommands';
import type { BoardCard } from '../useEntregasData';

const approvalEtapa = {
  id: 11,
  workflow_id: 1,
  ordem: 1,
  nome: 'Aprovação do texto',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'aprovacao_cliente' as const,
  status: 'ativo' as const,
};
const nextEtapa = { ...approvalEtapa, id: 12, ordem: 2, nome: 'Design', tipo: 'padrao' as const };
const card = {
  workflow: { id: 1, cliente_id: 1, titulo: 'Posts Agosto', status: 'ativo', recorrente: false },
  etapa: approvalEtapa,
  allEtapas: [approvalEtapa, nextEtapa],
} as unknown as BoardCard;

const COUNTS = { rascunho: 1, aprovado_interno: 1, aprovado_cliente: 1 };

function Harness({ onRefresh }: { onRefresh: () => void }) {
  const commands = useWorkflowStageCommands({
    onRefresh,
    onRecurring: () => {},
    postsCounts: new Map(),
    clearedClienteCounts: new Map(),
  });
  return (
    <>
      <button onClick={() => commands.forward(card)}>forward</button>
      {commands.dialogs}
    </>
  );
}

function renderHarness(onRefresh = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Harness onRefresh={onRefresh} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onRefresh;
}

const option = (name: RegExp) =>
  screen.findByRole('button', { name }).then((b) => b as HTMLButtonElement);

describe('useWorkflowStageCommands (celular)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.getWorkflowPostStatusCounts.mockResolvedValue(COUNTS);
    store.hasLaterApprovalEtapa.mockReturnValue(true);
  });

  it('posts_changed traz o sheet de volta com os números novos', async () => {
    store.advanceWorkflowFromApproval
      .mockRejectedValueOnce({ message: 'posts_changed' })
      .mockResolvedValue({ workflowStatus: 'ativo', etapaAtual: 2, postsChanged: 1 });
    renderHarness();
    fireEvent.click(screen.getByText('forward'));
    await waitFor(async () => expect((await option(/Aprovar todos/)).disabled).toBe(false));
    fireEvent.click(await option(/Aprovar todos/));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Os posts mudaram enquanto você escolhia. Confira os números e confirme de novo.',
      ),
    );
    await waitFor(() => expect(store.getWorkflowPostStatusCounts).toHaveBeenCalledTimes(2));
    // O sheet voltou e as ações estão habilitadas de novo.
    await waitFor(async () => expect((await option(/Aprovar todos/)).disabled).toBe(false));
    fireEvent.click(await option(/Aprovar todos/));
    await waitFor(() => expect(store.advanceWorkflowFromApproval).toHaveBeenCalledTimes(2));
    expect(store.advanceWorkflowFromApproval.mock.calls[1][0]).toMatchObject({
      choice: 'aprovar_todos',
      expectedCounts: COUNTS,
    });
  });

  it('falha nas contagens: "Tentar de novo" busca de novo e mostra as opções', async () => {
    store.getWorkflowPostStatusCounts.mockRejectedValueOnce(new Error('offline'));
    renderHarness();
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await option(/Tentar de novo/));
    await waitFor(() => expect(store.getWorkflowPostStatusCounts).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect((await option(/Aprovar todos/)).disabled).toBe(false));
  });
});
