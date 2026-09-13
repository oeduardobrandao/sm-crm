import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { TarefaWithRelations } from '../../../store';
import type { BoardColumn } from '../views/boardShared';

const { updateTarefaMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  updateTarefaMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('../../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store')>();
  return { ...actual, updateTarefa: updateTarefaMock };
});
vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

// BoardView's own logic (column shape + handleDrop) is what this test targets,
// not dnd-kit -- so TarefaBoard is stubbed down to a prop dump. This mirrors
// how the plan's own test brief for Task 4 mocked dropdown-menu: stub the
// child that can't be meaningfully driven through RTL, keep the real
// component under test intact.
vi.mock('../views/boardShared', () => ({
  TarefaBoard: ({
    columns,
    onDropCard,
  }: {
    columns: BoardColumn[];
    onDropCard: (tarefa: TarefaWithRelations, dropId: string) => void;
  }) => {
    (globalThis as { __capturedColumns?: BoardColumn[] }).__capturedColumns = columns;
    (
      globalThis as {
        __capturedOnDropCard?: (tarefa: TarefaWithRelations, dropId: string) => void;
      }
    ).__capturedOnDropCard = onDropCard;
    return <div data-testid="board-stub" />;
  },
}));

import { BoardView } from '../views/BoardView';

const NOW = new Date('2026-07-29T15:00:00'); // a Wednesday

function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42,
    titulo: 'Editar vídeo',
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: null,
    concluida_em: null,
    created_at: '2026-07-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    cliente_cor: null,
    ...overrides,
  };
}

function getCapturedColumns(): BoardColumn[] {
  return (globalThis as { __capturedColumns?: BoardColumn[] }).__capturedColumns!;
}

function getCapturedOnDropCard() {
  return (globalThis as { __capturedOnDropCard?: (t: TarefaWithRelations, id: string) => void })
    .__capturedOnDropCard!;
}

function renderBoard(overrides: Partial<Parameters<typeof BoardView>[0]> = {}) {
  const onCreateTask = vi.fn();
  render(
    <BoardView
      tarefas={overrides.tarefas ?? []}
      membros={overrides.membros ?? []}
      onTarefaClick={overrides.onTarefaClick ?? vi.fn()}
      onRefresh={overrides.onRefresh ?? vi.fn()}
      onCreateTask={overrides.onCreateTask ?? onCreateTask}
    />,
  );
  return { onCreateTask };
}

describe('BoardView', () => {
  it("builds the six columns and each add-button's date, at a fixed now (Wed 2026-07-29)", () => {
    // Freeze `now` inside BoardView by controlling the system clock, since
    // BoardView computes `new Date()` itself rather than accepting it as a prop.
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { onCreateTask } = renderBoard();
      const columns = getCapturedColumns();

      expect(columns.map((c) => c.title)).toEqual(
        expect.arrayContaining(['Em atraso', 'Hoje', 'Amanhã', 'Mais tarde', 'Sem data']),
      );

      const byTitle = (title: string) => columns.find((c) => c.title === title)!;

      // Droppable, date-bearing columns.
      expect(byTitle('Hoje').droppable).toBe(true);
      expect(byTitle('Hoje').dropId).toBe('day:2026-07-29');
      expect(byTitle('Amanhã').droppable).toBe(true);
      expect(byTitle('Amanhã').dropId).toBe('day:2026-07-30');

      // "Em atraso"/"Mais tarde" have no single unambiguous date: not droppable,
      // and their add-button opens the dialog with no prefilled date.
      const atrasado = byTitle('Em atraso');
      expect(atrasado.droppable).toBe(false);
      atrasado.onAddClick!();
      expect(onCreateTask).toHaveBeenLastCalledWith(null);

      const maisTarde = byTitle('Mais tarde');
      expect(maisTarde.droppable).toBe(false);
      maisTarde.onAddClick!();
      expect(onCreateTask).toHaveBeenLastCalledWith(null);

      // "Sem data" IS droppable (dropping there clears the due date), but its
      // own add-button still opens the dialog with no prefilled date.
      const semData = byTitle('Sem data');
      expect(semData.droppable).toBe(true);
      expect(semData.dropId).toBe('day:none');
      semData.onAddClick!();
      expect(onCreateTask).toHaveBeenLastCalledWith(null);

      // Droppable, date-bearing column: onAddClick fires with that column's date.
      byTitle('Amanhã').onAddClick!();
      expect(onCreateTask).toHaveBeenLastCalledWith('2026-07-30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops onto a day column: updates data_limite, toasts, and refreshes', async () => {
    updateTarefaMock.mockResolvedValueOnce({});
    const onRefresh = vi.fn();
    renderBoard({ tarefas: [makeTarefa({ id: 42, data_limite: null })], onRefresh });

    await act(async () => {
      getCapturedOnDropCard()(makeTarefa({ id: 42, data_limite: null }), 'day:2026-07-31');
    });

    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenCalledWith(42, { data_limite: '2026-07-31' }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Prazo atualizado!');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('dropping a card back on its own date is a no-op', () => {
    renderBoard({ tarefas: [makeTarefa({ id: 42, data_limite: '2026-07-31' })] });

    getCapturedOnDropCard()(makeTarefa({ id: 42, data_limite: '2026-07-31' }), 'day:2026-07-31');

    expect(updateTarefaMock).not.toHaveBeenCalled();
  });

  it('rolls back and shows an error toast when the update fails', async () => {
    updateTarefaMock.mockRejectedValueOnce(new Error('network down'));
    renderBoard({ tarefas: [makeTarefa({ id: 42, data_limite: null })] });

    await act(async () => {
      getCapturedOnDropCard()(makeTarefa({ id: 42, data_limite: null }), 'day:2026-07-31');
    });

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Erro ao atualizar prazo'));
  });

  it('ignores a drop whose dropId is not a day target', () => {
    renderBoard({ tarefas: [makeTarefa({ id: 42 })] });

    getCapturedOnDropCard()(makeTarefa({ id: 42 }), 'status:pendente');

    expect(updateTarefaMock).not.toHaveBeenCalled();
  });
});
