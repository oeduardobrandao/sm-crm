import React from 'react';
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LONG_PRESS_MS } from '@/components/mobile/useLongPress';
import { installPointerEvent, pointerDown, pointerUp } from '@/components/mobile/__tests__/pointer';

// jsdom's matchMedia reports no match: useIsDesktop(768) is false, so KanbanView
// renders the phone board (PLAN C3.3).

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
  reorderFluxosBoard: vi.fn(),
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  updateWorkflowPost: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
  getDeadlineInfo: vi.fn(),
  updateWorkflowEtapa: vi.fn(),
  getWorkflowHistory: vi.fn(async () => []),
  isFinalClientApprovalCycle: vi.fn(() => true),
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/useStatusRegistry', () => ({ useStatusRegistry: () => null }));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

beforeAll(installPointerEvent);
afterEach(() => vi.useRealTimers());

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const ETAPAS = [
  {
    id: 10,
    workflow_id: 0,
    ordem: 0,
    nome: 'Copy',
    tipo: 'padrao',
    prazo_dias: 1,
    tipo_prazo: 'corridos',
    status: 'ativo',
  },
  {
    id: 11,
    workflow_id: 0,
    ordem: 1,
    nome: 'Design',
    tipo: 'padrao',
    prazo_dias: 1,
    tipo_prazo: 'corridos',
    status: 'pendente',
  },
] as const;

function card(
  id: number,
  titulo: string,
  etapaIdx: number,
  templateId: number | null = 7,
): BoardCard {
  const etapas = ETAPAS.map((e) => ({ ...e, workflow_id: id, id: id * 100 + e.ordem }));
  return {
    workflow: {
      id,
      cliente_id: 1,
      titulo,
      status: 'ativo',
      etapa_atual: etapaIdx,
      recorrente: false,
      template_id: templateId,
      position: id,
    },
    etapa: etapas[etapaIdx],
    cliente: { id: 1, nome: 'Café Aurora', cor: '#123456' },
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: etapas.length,
    etapaIdx,
    allEtapas: etapas,
  } as unknown as BoardCard;
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    cards: [card(1, 'Posts de outubro', 1), card(2, 'Campanha Natal', 1), card(3, 'Reels', 0)],
    onCardClick: vi.fn(),
    onEditClick: vi.fn(),
    onPostsClick: vi.fn(),
    onRefresh: vi.fn(),
    onRecurring: vi.fn(),
    onAddWorkflow: vi.fn(),
    onDeleteWorkflowClick: vi.fn(),
    membros: [],
    templates: [{ id: 7, nome: 'Redes', etapas: [] } as never],
    postsCounts: new Map([[1, 4]]),
    approvedPostsCounts: new Map(),
    clearedClienteCounts: new Map(),
    revisaoInternaCounts: new Map(),
    awaitingClienteCounts: new Map(),
    ...overrides,
  };
}

describe('KanbanView on phones (one etapa at a time)', () => {
  it('renders only the active etapa, chips switch it, and the template switch lists rows', () => {
    render(<KanbanView {...(baseProps() as never)} />);
    expect(screen.getByTestId('phone-kanban-board')).toBeInTheDocument();
    const chips = screen.getByRole('tablist', { name: 'Etapas' });
    // Default column: the first etapa with something in it (Copy has "Reels").
    expect(within(chips).getByRole('tab', { name: /Copy/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByTestId('phone-workflow-card')).toHaveLength(1);
    expect(screen.getByText('Reels')).toBeInTheDocument();
    expect(screen.queryByText('Posts de outubro')).toBeNull();

    fireEvent.click(within(chips).getByRole('tab', { name: /Design/ }));
    expect(screen.getAllByTestId('phone-workflow-card')).toHaveLength(2);
    expect(screen.queryByText('Reels')).toBeNull();
    // "+ Novo fluxo" only on the first etapa.
    expect(screen.queryByRole('button', { name: /Novo fluxo/ })).toBeNull();
  });

  it('"+ Novo fluxo" opens the wizard with the row template; Novo template in the switch', async () => {
    const onAddWorkflow = vi.fn();
    const onCreateTemplate = vi.fn();
    render(<KanbanView {...(baseProps({ onAddWorkflow, onCreateTemplate }) as never)} />);
    fireEvent.click(screen.getByRole('button', { name: /Novo fluxo/ }));
    expect(onAddWorkflow).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByRole('button', { name: /Trocar template/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Templates' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Criar template' }));
    await waitFor(() => expect(onCreateTemplate).toHaveBeenCalledTimes(1));
  });

  it('offers Fluxo / Post individual when post processes are on and the row has a template', async () => {
    const onAddPostIndividual = vi.fn();
    render(
      <KanbanView {...(baseProps({ postProcessesEnabled: true, onAddPostIndividual }) as never)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Novo$/ }));
    const sheet = await screen.findByRole('dialog', { name: /^Novo em/ });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Post individual' }));
    await waitFor(() => expect(onAddPostIndividual).toHaveBeenCalledWith(7));
  });

  it('the ✓ button runs the forward confirmation as an action sheet', async () => {
    render(<KanbanView {...(baseProps() as never)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir etapa e avançar' }));
    expect(await screen.findByRole('dialog', { name: 'Avançar etapa?' })).toBeInTheDocument();
  });

  it('a hold opens the card menu with the desktop actions, and nothing drags', async () => {
    vi.useFakeTimers();
    const onEditClick = vi.fn();
    render(<KanbanView {...(baseProps({ onEditClick }) as never)} />);
    const main = within(screen.getByTestId('phone-workflow-card')).getAllByRole('button')[0];
    pointerDown(main, { x: 10, y: 10 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    });
    pointerUp(main, { x: 10, y: 10 });
    vi.useRealTimers();
    const menu = await screen.findByRole('menu', { name: 'Ações do fluxo' });
    for (const label of [
      'Concluir etapa e avançar',
      'Abrir posts',
      'Editar',
      'Copiar link do fluxo',
      'Abrir cliente',
      'Histórico do fluxo',
      'Excluir',
    ]) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    // First etapa: no "Voltar etapa".
    expect(within(menu).queryByRole('menuitem', { name: 'Voltar etapa' })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Editar' }));
    await waitFor(() => expect(onEditClick).toHaveBeenCalledTimes(1));
    // No drag handle outside Reordenar.
    expect(screen.queryByRole('button', { name: 'Arrastar para reordenar' })).toBeNull();
  });

  it('Reordenar shows drag handles, hides the ✓ and menu buttons, and OK leaves the mode', () => {
    render(<KanbanView {...(baseProps() as never)} />);
    fireEvent.click(
      within(screen.getByRole('tablist', { name: 'Etapas' })).getByRole('tab', { name: /Design/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
    expect(screen.getAllByRole('button', { name: 'Arrastar para reordenar' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Concluir etapa e avançar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mais ações de/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('button', { name: 'Arrastar para reordenar' })).toBeNull();
  });

  it('the column sort sheet switches Prazo / Manual', async () => {
    render(<KanbanView {...(baseProps({ contaId: 'c-phone' }) as never)} />);
    fireEvent.click(screen.getByRole('button', { name: /Ordenar coluna Copy: Prazo/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Ordenar coluna Copy' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Manual' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Ordenar coluna Copy: Manual/ }),
      ).toBeInTheDocument(),
    );
  });
});
