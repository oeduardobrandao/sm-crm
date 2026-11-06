import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TarefaWithRelations } from '../../../store';

const { updateTarefaMock } = vi.hoisted(() => ({ updateTarefaMock: vi.fn() }));

vi.mock('../../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store')>();
  return { ...actual, updateTarefa: updateTarefaMock };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TarefasPhoneCalendar } from '../phone/TarefasPhoneCalendar';

const MONTH = new Date(2099, 2, 1); // March 2099, never "today"

function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 1,
    titulo: 'Tarefa',
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: null,
    concluida_em: null,
    created_at: '2026-07-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    comentarios_total: 0,
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
}

function renderCalendar(tarefas: TarefaWithRelations[]) {
  const props = {
    onMonthChange: vi.fn(),
    onTarefaClick: vi.fn(),
    onRefresh: vi.fn(),
    onCreateTask: vi.fn(),
  };
  render(
    <MemoryRouter>
      <TarefasPhoneCalendar tarefas={tarefas} membros={[]} currentMonth={MONTH} {...props} />
    </MemoryRouter>,
  );
  return props;
}

beforeEach(() => {
  updateTarefaMock.mockReset().mockResolvedValue(undefined);
});

describe('TarefasPhoneCalendar (Mês on phones)', () => {
  it('marks days with tasks and lists the selected day under the grid', async () => {
    const user = userEvent.setup();
    const { onCreateTask } = renderCalendar([
      makeTarefa({ id: 1, titulo: 'Gravar reels', data_limite: '2099-03-10' }),
      makeTarefa({ id: 2, titulo: 'Enviar relatório', data_limite: '2099-03-10' }),
    ]);
    expect(screen.getByRole('heading', { name: /março 2099/i })).toBeInTheDocument();
    // The first of the month is selected and empty.
    expect(screen.getByText('Nenhuma tarefa neste dia.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '10 de março, 2 tarefas' }));
    expect(screen.getByRole('button', { name: '10 de março, 2 tarefas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Gravar reels')).toBeInTheDocument();
    expect(screen.getByText('Enviar relatório')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Nova tarefa em 10\/03/ }));
    expect(onCreateTask).toHaveBeenCalledWith('2099-03-10');
  });

  it('moves between months', async () => {
    const user = userEvent.setup();
    const { onMonthChange } = renderCalendar([]);
    await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(onMonthChange).toHaveBeenCalledWith(new Date(2099, 3, 1));
  });

  it('"Sem data" opens a sheet with the undated open tasks; opening one closes it first', async () => {
    const user = userEvent.setup();
    const { onTarefaClick } = renderCalendar([
      makeTarefa({ id: 3, titulo: 'Sem prazo aberta' }),
      makeTarefa({ id: 4, titulo: 'Sem prazo concluída', status: 'concluida' }),
    ]);
    await user.click(screen.getByRole('button', { name: /Sem data/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sem data · 1' });
    expect(within(sheet).getByText('Sem prazo aberta')).toBeInTheDocument();
    expect(within(sheet).queryByText('Sem prazo concluída')).not.toBeInTheDocument();

    await user.click(within(sheet).getByText('Sem prazo aberta'));
    await waitFor(() =>
      expect(onTarefaClick).toHaveBeenCalledWith(expect.objectContaining({ id: 3 })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Sem data/ })).toBeNull());
  });

  it('reschedules from the row menu instead of dragging', async () => {
    const user = userEvent.setup();
    renderCalendar([makeTarefa({ id: 5, titulo: 'Editar vídeo', data_limite: '2099-03-01' })]);
    await user.click(screen.getByRole('button', { name: 'Mais' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /Mudar prazo/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Prazo' });
    fireEvent.change(within(sheet).getByLabelText('Prazo'), { target: { value: '2099-03-20' } });
    await user.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(updateTarefaMock).toHaveBeenCalledWith(5, { data_limite: '2099-03-20' }),
    );
  });
});
