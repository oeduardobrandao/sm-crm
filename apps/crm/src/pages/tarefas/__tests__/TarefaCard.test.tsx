import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TarefaWithRelations } from '../../../store';

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

// Real Radix DropdownMenu relies on portals/pointer-capture that jsdom does not
// model well; every other test in this codebase that exercises a DropdownMenu
// mocks the module down to plain elements instead (see ClientesPage.test.tsx /
// PostsKanbanView.test.tsx). Content renders unconditionally, so a menu item is
// queryable without simulating Radix's own open state.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { TarefaCard } from '../components/TarefaCard';

const NOW = new Date('2026-07-29T15:00:00');
const MEMBROS = [
  { id: 1, nome: 'Ana Silva' },
  { id: 2, nome: 'Bruno Costa' },
] as never[];

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

describe('TarefaCard', () => {
  it('shows the client footer dot using cliente_cor, with a fallback when unset', () => {
    const { rerender } = render(
      <TarefaCard
        tarefa={makeTarefa({ cliente_nome: 'Studio Bem-Estar', cliente_cor: '#ff00aa' })}
        membro={null}
        now={NOW}
        onClick={() => {}}
        membros={[]}
        onRefresh={() => {}}
      />,
    );
    const name = screen.getByText('Studio Bem-Estar');
    const dot = name.previousElementSibling as HTMLElement;
    expect(dot.style.background).toBe('rgb(255, 0, 170)');

    rerender(
      <TarefaCard
        tarefa={makeTarefa({ cliente_nome: 'Studio Bem-Estar', cliente_cor: null })}
        membro={null}
        now={NOW}
        onClick={() => {}}
        membros={[]}
        onRefresh={() => {}}
      />,
    );
    const dotFallback = screen.getByText('Studio Bem-Estar').previousElementSibling as HTMLElement;
    expect(dotFallback.style.background).toBe('var(--text-muted)');
  });

  it('omits the client footer entirely when there is no client', () => {
    render(
      <TarefaCard
        tarefa={makeTarefa({ cliente_nome: null })}
        membro={null}
        now={NOW}
        onClick={() => {}}
        membros={[]}
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByText(/studio/i)).not.toBeInTheDocument();
  });

  it('opens a reassign dropdown on avatar click without triggering the card onClick', async () => {
    const onClick = vi.fn();
    render(
      <TarefaCard
        tarefa={makeTarefa()}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={onClick}
        membros={MEMBROS}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTitle('Ana Silva'));
    expect(await screen.findByText('Bruno Costa')).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('reassigns on selecting a member: calls updateTarefa, shows a toast, and refreshes', async () => {
    updateTarefaMock.mockResolvedValueOnce({});
    const onRefresh = vi.fn();
    render(
      <TarefaCard
        tarefa={makeTarefa({ id: 42 })}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={() => {}}
        membros={MEMBROS}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTitle('Ana Silva'));
    fireEvent.click(await screen.findByText('Bruno Costa'));

    await waitFor(() => expect(updateTarefaMock).toHaveBeenCalledWith(42, { responsavel_id: 2 }));
    expect(toastSuccessMock).toHaveBeenCalledWith('Responsável atualizado!');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("doesn't keep showing the optimistic assignee once the tarefa prop's responsavel_id has actually moved on", async () => {
    updateTarefaMock.mockResolvedValueOnce({});
    const { rerender } = render(
      <TarefaCard
        tarefa={makeTarefa({ id: 42, responsavel_id: 1 })}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={() => {}}
        membros={MEMBROS}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTitle('Ana Silva'));
    fireEvent.click(await screen.findByText('Bruno Costa'));
    await screen.findByTitle('Bruno Costa'); // optimistic localMembro is showing

    // Someone reassigns the same task elsewhere (e.g. the detail sheet) to a
    // third member; the list refetches and this card re-renders in place
    // (same key, no remount) with the new responsavel_id.
    rerender(
      <TarefaCard
        tarefa={makeTarefa({ id: 42, responsavel_id: 3 })}
        membro={{ id: 3, nome: 'Carla Dias' } as never}
        now={NOW}
        onClick={() => {}}
        membros={MEMBROS}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByTitle('Carla Dias')).toBeInTheDocument();
    expect(screen.queryByTitle('Bruno Costa')).not.toBeInTheDocument();
  });

  it('rolls back to the original assignee and shows an error toast when the update fails', async () => {
    updateTarefaMock.mockRejectedValueOnce(new Error('network down'));
    render(
      <TarefaCard
        tarefa={makeTarefa({ id: 42 })}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={() => {}}
        membros={MEMBROS}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTitle('Ana Silva'));
    fireEvent.click(await screen.findByText('Bruno Costa'));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Erro ao atualizar responsável'),
    );
    // Rolled back: the original assignee's avatar is showing again, not Bruno's.
    expect(screen.getByTitle('Ana Silva')).toBeInTheDocument();
  });

  it('hides the whole assignee block when hideAssignee is set', () => {
    render(
      <TarefaCard
        tarefa={makeTarefa()}
        membro={{ id: 1, nome: 'Ana Silva' } as never}
        now={NOW}
        onClick={() => {}}
        membros={MEMBROS}
        onRefresh={() => {}}
        hideAssignee
      />,
    );
    expect(screen.queryByTitle('Ana Silva')).not.toBeInTheDocument();
  });
});
