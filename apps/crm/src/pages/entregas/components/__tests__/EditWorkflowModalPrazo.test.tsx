import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BoardCard } from '../../hooks/useEntregasData';

const { updateWorkflowMock, updateWorkflowEtapaMock } = vi.hoisted(() => ({
  updateWorkflowMock: vi.fn(),
  updateWorkflowEtapaMock: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: {} }),
}));
vi.mock('../../../../store', () => ({
  getDeadlineInfo: vi.fn(),
  addWorkflowTemplate: vi.fn(),
  removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  updateWorkflow: updateWorkflowMock,
  updateWorkflowEtapa: updateWorkflowEtapaMock,
  saveWorkflowTemplate: vi.fn(),
  getPropertyDefinitions: vi.fn(),
  deletePropertyDefinition: vi.fn(),
}));

import { EditWorkflowModal } from '../WorkflowModals';

// jsdom's matchMedia reports no match: useIsDesktop(768) is false, so this renders
// the phone body, whose "Data limite" row is a native date input.

function makeCard(etapa: Partial<BoardCard['etapa']> = {}): BoardCard {
  return {
    workflow: {
      id: 10,
      titulo: 'Produção mensal',
      cliente_id: 1,
      recorrente: false,
      plataformas: ['instagram'],
      modo_prazo: 'padrao',
    },
    etapa: {
      id: 20,
      workflow_id: 10,
      nome: 'Aprovação do Vídeo',
      ordem: 0,
      status: 'ativo',
      responsavel_id: null,
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      // Wed 2026-11-18, 15:00 local
      iniciado_em: new Date(2026, 10, 18, 15, 0).toISOString(),
      ...etapa,
    },
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [],
  } as unknown as BoardCard;
}

function renderModal(card: BoardCard) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EditWorkflowModal
          card={card}
          membros={[]}
          clientes={[{ id: 1, nome: 'Ana', status: 'ativo' } as never]}
          templates={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EditWorkflowModal: Data limite next to Prazo (dias)', () => {
  beforeEach(() => {
    updateWorkflowMock.mockReset().mockResolvedValue(undefined);
    updateWorkflowEtapaMock.mockReset().mockResolvedValue(undefined);
  });

  it('shows the date the days land on and turns a picked date into days', async () => {
    renderModal(makeCard());
    const date = screen.getByLabelText('Data limite') as HTMLInputElement;
    expect(date.value).toBe('2026-11-20');
    expect(date.min).toBe('2026-11-19');

    fireEvent.change(date, { target: { value: '2026-11-25' } });
    expect((screen.getByLabelText('Prazo (dias)') as HTMLInputElement).value).toBe('7');
    expect(date.value).toBe('2026-11-25');

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(updateWorkflowEtapaMock).toHaveBeenCalledWith(
        20,
        expect.objectContaining({ prazo_dias: 7, tipo_prazo: 'corridos' }),
      ),
    );
    expect(updateWorkflowEtapaMock.mock.calls[0][1]).not.toHaveProperty('data_limite');
  });

  it('counts business days for dias úteis', () => {
    renderModal(makeCard({ tipo_prazo: 'uteis' }));
    const date = screen.getByLabelText('Data limite') as HTMLInputElement;
    // Wed + 2 business days = Fri
    expect(date.value).toBe('2026-11-20');
    // next Wed = Thu, Fri, Mon, Tue, Wed
    fireEvent.change(date, { target: { value: '2026-11-25' } });
    expect((screen.getByLabelText('Prazo (dias)') as HTMLInputElement).value).toBe('5');
  });

  it('hides the date when the etapa has not started', () => {
    renderModal(makeCard({ iniciado_em: null }));
    expect(screen.getByLabelText('Prazo (dias)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Data limite')).toBeNull();
  });
});
