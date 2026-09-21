import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { DragEndEvent } from '@dnd-kit/core';
import type { TarefaWithRelations } from '../../../store';
import { buildDropId } from '../tarefasLogic';

const { updateTarefaMock, toastErrorMock, toastSuccessMock, useAuthMock } = vi.hoisted(() => ({
  updateTarefaMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store')>();
  return { ...actual, updateTarefa: updateTarefaMock };
});
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));
vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});
// The drag gesture itself (PointerSensor) is not what this file tests; capture
// DndContext's onDragEnd and invoke it directly. Hooks stay real.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd: (e: DragEndEvent) => void;
    }) => {
      (globalThis as { __onDragEnd?: (e: DragEndEvent) => void }).__onDragEnd = onDragEnd;
      return <div>{children}</div>;
    },
  };
});

import { CalendarView } from '../views/CalendarView';

const SERIE = {
  id: 1,
  freq: 'daily' as const,
  intervalo: 1,
  dias_semana: null,
  dia_mes: null,
  mes: null,
  modo: 'calendario' as const,
  fim: null,
  inicio: '2026-07-30',
  pausada: false,
  encerrada_em: null,
  proxima_data: '2026-07-31',
};

function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42,
    titulo: 'Editar vídeo',
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: '2026-07-30',
    concluida_em: null,
    created_at: '2026-07-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
}

function renderMonth(tarefa: TarefaWithRelations) {
  render(
    <CalendarView
      tarefas={[tarefa]}
      membros={[]}
      onTarefaClick={vi.fn()}
      onRefresh={vi.fn()}
      onCreateTask={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mês' }));
}

function dragEnd(tarefaId: number, overId: string) {
  const handler = (globalThis as { __onDragEnd?: (e: DragEndEvent) => Promise<void> }).__onDragEnd!;
  return act(async () => {
    await handler({ active: { id: tarefaId }, over: { id: overId } } as unknown as DragEndEvent);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthMock.mockReturnValue({ profile: { conta_id: 'c1', active_workspace_id: 'c1' } });
});

describe('CalendarView date-drop guards', () => {
  it('refuses to drop a series occurrence on "Sem data" and shows the toast', async () => {
    renderMonth(makeTarefa({ serie: SERIE }));
    await dragEnd(42, buildDropId({ kind: 'day', date: null }));
    expect(updateTarefaMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Tarefas de uma série precisam de prazo.');
  });

  it('maps 23505 on tarefas_serie_data_uq to the specific toast', async () => {
    updateTarefaMock.mockRejectedValueOnce({
      code: '23505',
      message: 'duplicate key value violates unique constraint "tarefas_serie_data_uq"',
    });
    renderMonth(makeTarefa({ serie: SERIE }));
    await dragEnd(42, buildDropId({ kind: 'day', date: '2026-07-31' }));
    expect(toastErrorMock).toHaveBeenCalledWith('Já existe uma ocorrência desta série nesse dia.');
  });
});
