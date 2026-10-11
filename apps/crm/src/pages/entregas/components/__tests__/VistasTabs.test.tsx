import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VistasTabs } from '../VistasTabs';

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

// Radix menus open on real pointer events jsdom can't fake — render inline instead,
// same approach as WorkflowCard.badge.test.tsx.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

type Row = { id: string; name: string; query: string; position: number };

/** In-memory stand-in for the entregas_saved_views table, with the same
 * upsert / unique-name semantics the store functions rely on. */
const server = vi.hoisted(() => ({ rows: [] as Row[], seq: 0 }));

vi.mock('@/store/savedViews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/savedViews')>();
  const sorted = () => [...server.rows].sort((a, b) => a.position - b.position);
  return {
    ...actual,
    listSavedViews: vi.fn(async () => sorted()),
    saveSavedView: vi.fn(
      async (_conta: string, v: { name: string; query: string; position: number }) => {
        const hit = server.rows.find((r) => r.name === v.name);
        if (hit) {
          Object.assign(hit, { query: v.query, position: v.position });
          return { ...hit };
        }
        const row = { id: `id-${++server.seq}`, ...v };
        server.rows.push(row);
        return { ...row };
      },
    ),
    updateSavedViewQuery: vi.fn(async (id: string, query: string) => {
      const hit = server.rows.find((r) => r.id === id);
      if (hit) hit.query = query;
    }),
    renameSavedView: vi.fn(async (id: string, name: string, replaceId?: string | null) => {
      if (replaceId) server.rows = server.rows.filter((r) => r.id !== replaceId);
      const hit = server.rows.find((r) => r.id === id);
      if (hit) hit.name = name;
    }),
    removeSavedView: vi.fn(async (id: string) => {
      server.rows = server.rows.filter((r) => r.id !== id);
    }),
    importSavedViews: vi.fn(
      async (_conta: string, views: { name: string; query: string; position: number }[]) => {
        for (const v of views) {
          if (!server.rows.some((r) => r.name === v.name)) {
            server.rows.push({ id: `id-${++server.seq}`, ...v });
          }
        }
      },
    ),
    reorderSavedViews: vi.fn(),
  };
});

import * as store from '@/store/savedViews';

const CONTA = 'conta-test';

const seed = (views: { name: string; query: string }[]) => {
  server.rows = views.map((v, i) => ({ id: `seed-${i}`, ...v, position: i }));
};
const stored = () =>
  [...server.rows]
    .sort((a, b) => a.position - b.position)
    .map(({ name, query }) => ({ name, query }));

function renderTabs(props: Partial<React.ComponentProps<typeof VistasTabs>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = { contaId: CONTA, currentQuery: '', onApply: vi.fn(), ...props };
  const ui = (p: typeof all) => (
    <QueryClientProvider client={qc}>
      <VistasTabs {...p} />
    </QueryClientProvider>
  );
  const utils = render(ui(all));
  return {
    ...utils,
    rerenderTabs: (p: Partial<typeof all>) => utils.rerender(ui({ ...all, ...p })),
  };
}

describe('VistasTabs', () => {
  beforeEach(() => {
    localStorage.clear();
    // Most cases start from a browser that already imported its old list.
    localStorage.setItem(`entregas_saved_views_imported_${CONTA}`, '1');
    server.rows = [];
    server.seq = 0;
    vi.clearAllMocks();
  });

  it('renders Padrão + saved vistas as tabs and applies on click', async () => {
    seed([{ name: 'Posts atrasados', query: 'mode=publicacoes&prazo=atrasado' }]);
    const onApply = vi.fn();
    renderTabs({ onApply });

    expect(screen.getByText('Padrão')).toBeInTheDocument();
    fireEvent.click(await screen.findByText('Posts atrasados'));
    expect(onApply).toHaveBeenCalledWith('mode=publicacoes&prazo=atrasado');
    expect(store.listSavedViews).toHaveBeenCalledWith(CONTA);
  });

  it('shows a placeholder tab until the list arrives', async () => {
    seed([{ name: 'Lenta', query: 'view=list' }]);
    renderTabs();
    expect(screen.getByTestId('vista-tabs-loading')).toBeInTheDocument();
    expect(await screen.findByText('Lenta')).toBeInTheDocument();
    expect(screen.queryByTestId('vista-tabs-loading')).toBeNull();
  });

  it("does not query while contaId is the 'unknown' fallback", () => {
    renderTabs({ contaId: 'unknown' });
    expect(screen.getByTestId('vista-tabs-loading')).toBeInTheDocument();
    expect(store.listSavedViews).not.toHaveBeenCalled();
  });

  it('Padrão applies the empty query (reset)', async () => {
    seed([{ name: 'X', query: 'view=list' }]);
    const onApply = vi.fn();
    renderTabs({ currentQuery: 'view=list', onApply });
    await screen.findByText('X');

    fireEvent.click(screen.getByText('Padrão'));
    expect(onApply).toHaveBeenCalledWith('');
  });

  it('marks the vista matching the query as active once the list arrives (shared URL case)', async () => {
    seed([{ name: 'Compartilhada', query: 'view=list&mode=publicacoes' }]);
    renderTabs({ currentQuery: 'view=list&mode=publicacoes' });
    const tab = await screen.findByText('Compartilhada');
    await waitFor(() => expect(tab.closest('.vista-tab')).toHaveClass('vista-tab--active'));
    expect(screen.getByText('Padrão').closest('.vista-tab')).not.toHaveClass('vista-tab--active');
  });

  it('saves a new vista from the + Nova vista popover', async () => {
    renderTabs({ currentQuery: 'mode=publicacoes' });
    await waitFor(() => expect(screen.queryByTestId('vista-tabs-loading')).toBeNull());

    fireEvent.click(screen.getByText('Nova visualização'));
    fireEvent.change(screen.getByPlaceholderText('Nome da visualização'), {
      target: { value: 'Minha vista' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const tab = await screen.findByText('Minha vista');
    expect(stored()).toEqual([{ name: 'Minha vista', query: 'mode=publicacoes' }]);
    await waitFor(() => expect(tab.closest('.vista-tab')).toHaveClass('vista-tab--active'));
    expect(toastMock.success).toHaveBeenCalledWith('Visualização "Minha vista" salva!');
  });

  it('saving onto an existing name replaces that vista and moves it to the end', async () => {
    seed([
      { name: 'Repetida', query: 'view=chart' },
      { name: 'Outra', query: 'view=list' },
    ]);
    renderTabs({ currentQuery: 'view=calendar' });
    await screen.findByText('Repetida');

    fireEvent.click(screen.getByText('Nova visualização'));
    fireEvent.change(screen.getByPlaceholderText('Nome da visualização'), {
      target: { value: 'Repetida' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(stored()).toEqual([
        { name: 'Outra', query: 'view=list' },
        { name: 'Repetida', query: 'view=calendar' },
      ]),
    );
    await waitFor(() => expect(screen.getAllByText('Repetida')).toHaveLength(1));
  });

  it('keeps the popover open and shows an error when saving fails', async () => {
    vi.mocked(store.saveSavedView).mockRejectedValueOnce(new Error('offline'));
    renderTabs({ currentQuery: 'view=list' });
    await waitFor(() => expect(screen.queryByTestId('vista-tabs-loading')).toBeNull());

    fireEvent.click(screen.getByText('Nova visualização'));
    fireEvent.change(screen.getByPlaceholderText('Nome da visualização'), {
      target: { value: 'Falha' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Não foi possível salvar a visualização. Tente novamente.',
      ),
    );
    expect(screen.getByPlaceholderText('Nome da visualização')).toHaveValue('Falha');
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('shows the modified dot when the active vista diverges from the screen', async () => {
    seed([{ name: 'Viva', query: 'view=list' }]);
    const { rerenderTabs } = renderTabs({ currentQuery: 'view=list' });
    const tab = await screen.findByText('Viva');
    await waitFor(() => expect(tab.closest('.vista-tab')).toHaveClass('vista-tab--active'));
    expect(document.querySelector('.vista-tab-dot')).toBeNull();

    // The user tweaked a filter → currentQuery changes while Viva stays applied.
    rerenderTabs({ currentQuery: 'view=list&prazo=hoje' });
    expect(document.querySelector('.vista-tab-dot')).not.toBeNull();
  });

  it('updates a vista with the current state via the ⋯ menu', async () => {
    seed([{ name: 'Viva', query: 'view=list' }]);
    renderTabs({ currentQuery: 'view=list&prazo=hoje' });
    await screen.findByText('Viva');

    fireEvent.click(screen.getByLabelText('Opções da visualização Viva'));
    fireEvent.click(screen.getByText('Atualizar com estado atual'));

    await waitFor(() =>
      expect(stored()).toEqual([{ name: 'Viva', query: 'view=list&prazo=hoje' }]),
    );
    expect(store.updateSavedViewQuery).toHaveBeenCalledWith('seed-0', 'view=list&prazo=hoje');
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Visualização "Viva" atualizada!'),
    );
  });

  it('renames inline via the ⋯ menu, sending one request', async () => {
    seed([{ name: 'Antiga', query: 'view=list' }]);
    renderTabs();
    await screen.findByText('Antiga');

    fireEvent.click(screen.getByLabelText('Opções da visualização Antiga'));
    fireEvent.click(screen.getByText('Renomear'));
    const input = screen.getByDisplayValue('Antiga');
    fireEvent.change(input, { target: { value: 'Nova' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    expect(await screen.findByText('Nova')).toBeInTheDocument();
    await waitFor(() => expect(stored()).toEqual([{ name: 'Nova', query: 'view=list' }]));
    expect(store.renameSavedView).toHaveBeenCalledTimes(1);
    expect(store.renameSavedView).toHaveBeenCalledWith('seed-0', 'Nova', null);
  });

  it('renaming onto an existing name replaces it instead of duplicating', async () => {
    seed([
      { name: 'Alvo', query: 'view=chart' },
      { name: 'Origem', query: 'view=list' },
    ]);
    renderTabs();
    await screen.findByText('Origem');

    // With the inline dropdown mock every vista renders its menu items, so
    // scope to the "Origem" tab before clicking its Renomear.
    const origemTab = screen.getByText('Origem').closest('.vista-tab') as HTMLElement;
    fireEvent.click(within(origemTab).getByText('Renomear'));
    const input = screen.getByDisplayValue('Origem');
    fireEvent.change(input, { target: { value: 'Alvo' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Single surviving entry, carrying the renamed view's query
    await waitFor(() => expect(stored()).toEqual([{ name: 'Alvo', query: 'view=list' }]));
    expect(store.renameSavedView).toHaveBeenCalledWith('seed-1', 'Alvo', 'seed-0');
    expect(screen.getAllByText('Alvo')).toHaveLength(1);

    // And deleting it removes exactly that one entry
    fireEvent.click(screen.getByLabelText('Opções da visualização Alvo'));
    fireEvent.click(screen.getByText('Excluir'));
    await waitFor(() => expect(stored()).toEqual([]));
  });

  it('deletes a vista via the ⋯ menu', async () => {
    seed([{ name: 'Velha', query: 'view=chart' }]);
    renderTabs();
    await screen.findByText('Velha');

    fireEvent.click(screen.getByLabelText('Opções da visualização Velha'));
    fireEvent.click(screen.getByText('Excluir'));

    await waitFor(() => expect(screen.queryByText('Velha')).toBeNull());
    await waitFor(() => expect(stored()).toEqual([]));
  });

  it('puts a vista back and shows an error when deleting fails', async () => {
    seed([{ name: 'Teimosa', query: 'view=chart' }]);
    vi.mocked(store.removeSavedView).mockRejectedValueOnce(new Error('offline'));
    renderTabs();
    await screen.findByText('Teimosa');

    fireEvent.click(screen.getByLabelText('Opções da visualização Teimosa'));
    fireEvent.click(screen.getByText('Excluir'));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Não foi possível excluir a visualização. Tente novamente.',
      ),
    );
    expect(await screen.findByText('Teimosa')).toBeInTheDocument();
  });

  it('shows an error and keeps Padrão usable when the list fails to load', async () => {
    vi.mocked(store.listSavedViews).mockRejectedValueOnce(new Error('offline'));
    renderTabs();
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Não foi possível carregar as visualizações salvas.',
      ),
    );
    expect(screen.getByText('Padrão')).toBeInTheDocument();
    expect(screen.getByText('Nova visualização')).toBeInTheDocument();
    expect(screen.queryByTestId('vista-tabs-loading')).toBeNull();
  });

  it("imports this browser's old localStorage list on the first load", async () => {
    localStorage.removeItem(`entregas_saved_views_imported_${CONTA}`);
    localStorage.setItem(
      `entregas_saved_views_${CONTA}`,
      JSON.stringify([{ name: 'Do navegador', query: 'view=chart' }]),
    );
    seed([{ name: 'Do servidor', query: 'view=list' }]);
    renderTabs();

    expect(await screen.findByText('Do navegador')).toBeInTheDocument();
    expect(screen.getByText('Do servidor')).toBeInTheDocument();
    expect(store.importSavedViews).toHaveBeenCalledWith(CONTA, [
      { name: 'Do navegador', query: 'view=chart', position: 1 },
    ]);
    expect(localStorage.getItem(`entregas_saved_views_imported_${CONTA}`)).not.toBeNull();
    // The old key stays (an older build would still read it).
    expect(localStorage.getItem(`entregas_saved_views_${CONTA}`)).not.toBeNull();
  });
});
