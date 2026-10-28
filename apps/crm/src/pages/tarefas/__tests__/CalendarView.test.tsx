import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { DragEndEvent } from '@dnd-kit/core';
import type { Membro, TarefaWithRelations } from '../../../store';
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

// Desktop layout (the phone branch has its own suite); jsdom's matchMedia reports false.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

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

function renderMonth(
  tarefa: TarefaWithRelations,
  {
    membros = [],
    onTarefaClick = vi.fn(),
  }: { membros?: Membro[]; onTarefaClick?: () => void } = {},
) {
  render(
    <CalendarView
      tarefas={[tarefa]}
      membros={membros}
      onTarefaClick={onTarefaClick}
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

describe('CalendarView month chips', () => {
  // Real focus (activeElement), as a Tab would give: the card opens on :focus-visible only.
  const focusChip = () => act(() => screen.getByRole('button', { name: 'Editar vídeo' }).focus());
  const ANA = { id: 7, nome: 'Ana Souza', avatar_url: null } as unknown as Membro;
  const TAGS = [
    { id: 1, nome: 'Urgente', cor: '#f55a42' },
    { id: 2, nome: 'Design', cor: '#42c8f5' },
  ];
  // Today, so the chip lands in the month the grid opens on.
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('shows the client colour as the left bar and the assignee avatar', () => {
    renderMonth(
      makeTarefa({
        data_limite: today(),
        responsavel_id: 7,
        cliente_nome: 'Clínica Sol',
        cliente_cor: '#123456',
        tags: TAGS,
      }),
      { membros: [ANA] },
    );
    const chip = screen.getByTestId('tarefa-chip');
    expect(chip.style.borderLeft).toContain('rgb(18, 52, 86)');
    expect(within(chip).getByText('AS')).toBeInTheDocument();
    // Tags moved to the hover card; no native title tooltip either.
    expect(within(chip).queryByText('Urgente')).not.toBeInTheDocument();
    expect(chip.closest('[title]')).toBeNull();
  });

  it('falls back to a neutral bar and no avatar without client or assignee', () => {
    renderMonth(makeTarefa({ data_limite: today() }), { membros: [ANA] });
    const chip = screen.getByTestId('tarefa-chip');
    expect(chip.style.borderLeft).toContain('var(--border-color)');
    expect(chip.querySelector('.avatar')).toBeNull();
  });

  it('the hover card shows client, assignee, tags, subtasks and the recurrence', async () => {
    renderMonth(
      makeTarefa({
        data_limite: today(),
        responsavel_id: 7,
        cliente_nome: 'Clínica Sol',
        cliente_cor: '#123456',
        tags: TAGS,
        subtarefas_total: 3,
        subtarefas_concluidas: 1,
        serie: SERIE,
      }),
      { membros: [ANA] },
    );
    focusChip();
    const card = await screen.findByRole('tooltip');
    expect(within(card).getByText('Clínica Sol')).toBeInTheDocument();
    expect(within(card).getByText('Ana Souza')).toBeInTheDocument();
    expect(within(card).getByText('Urgente')).toBeInTheDocument();
    expect(within(card).getByText('Design')).toBeInTheDocument();
    expect(within(card).getByText('1/3 subtarefas')).toBeInTheDocument();
    expect(within(card).getByText('Todo dia')).toBeInTheDocument();
    expect(within(card).getByText('Hoje')).toBeInTheDocument();
  });

  it('says "Sem responsável" in the card for an unassigned task', async () => {
    renderMonth(makeTarefa({ data_limite: today() }));
    focusChip();
    const card = await screen.findByRole('tooltip');
    expect(within(card).getByText('Sem responsável')).toBeInTheDocument();
  });

  it('a focus that is not :focus-visible (focus handed back after a click) keeps the card closed', async () => {
    renderMonth(makeTarefa({ data_limite: today() }));
    // A focus event on an element that is not the focused one never matches :focus-visible.
    fireEvent.focus(screen.getByRole('button', { name: 'Editar vídeo' }));
    await act(async () => {});
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens the task on click and on Enter/Space', () => {
    const onTarefaClick = vi.fn();
    renderMonth(makeTarefa({ data_limite: today() }), { onTarefaClick });
    const chip = screen.getByRole('button', { name: 'Editar vídeo' });
    fireEvent.click(chip);
    fireEvent.keyDown(chip, { key: 'Enter' });
    fireEvent.keyDown(chip, { key: ' ' });
    expect(onTarefaClick).toHaveBeenCalledTimes(3);
  });
});
