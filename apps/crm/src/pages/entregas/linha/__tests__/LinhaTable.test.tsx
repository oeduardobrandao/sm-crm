import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente } from '@/store';
import type {
  LinhaColuna,
  LinhaEditorial,
  LinhaItem,
  LinhaPost,
  LinhaResposta,
} from '@/store/linhaEditorial';
import { buildStatusRegistry } from '../../statusRegistry';

const m = vi.hoisted(() => ({
  listLinhasDoMes: vi.fn(),
  listItens: vi.fn(),
  listColunas: vi.fn(),
  listRespostas: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItens: vi.fn(),
  addColuna: vi.fn(),
  updateColuna: vi.fn(),
  excluirColuna: vi.fn(),
  responderComentario: vi.fn(),
  listPostsDaLinha: vi.fn(),
  getHubToken: vi.fn(),
  getWorkspaceSlug: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/store/linhaEditorial', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/linhaEditorial')>()),
  listLinhasDoMes: m.listLinhasDoMes,
  listItens: m.listItens,
  listColunas: m.listColunas,
  listRespostas: m.listRespostas,
  addItem: m.addItem,
  updateItem: m.updateItem,
  deleteItem: m.deleteItem,
  reorderItens: m.reorderItens,
  addColuna: m.addColuna,
  updateColuna: m.updateColuna,
  excluirColuna: m.excluirColuna,
  responderComentario: m.responderComentario,
  listPostsDaLinha: m.listPostsDaLinha,
}));
vi.mock('@/store/hub', () => ({
  getHubToken: m.getHubToken,
  getWorkspaceSlug: m.getWorkspaceSlug,
}));
vi.mock('@/hooks/useClienteAvatars', () => ({
  useClienteAvatars: () => ({ igAvatars: undefined, fotosDe: () => [] }),
}));
vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => buildStatusRegistry([]),
}));
vi.mock('sonner', () => ({ toast: { success: m.toastSuccess, error: m.toastError } }));

import { LinhaEditorialView } from '../LinhaEditorialView';

const CLIENTE = {
  id: 1,
  nome: 'Zeta Odonto',
  sigla: 'ZO',
  cor: '#123456',
  status: 'ativo',
} as Cliente;

const LINHA: LinhaEditorial = {
  id: 'l-1',
  conta_id: 'c1',
  cliente_id: 1,
  periodo: '2026-11-01',
  status: 'rascunho',
  enviada_at: null,
  enviada_por: null,
  decidida_at: null,
  rodada: 2,
  itens_total: 2,
  itens_convertidos: 0,
};

const item = (n: number, over: Partial<LinhaItem> = {}): LinhaItem => ({
  id: `i${n}`,
  linha_id: 'l-1',
  data: null,
  tipo: 'reels',
  titulo: `Post ${n}`,
  direcao: '',
  valores: {},
  ordem: n,
  post_id: null,
  ...over,
});

const resposta = (over: Partial<LinhaResposta> & { id: string }): LinhaResposta => ({
  linha_id: 'l-1',
  item_id: null,
  acao: 'comentario',
  comentario: null,
  rodada: 1,
  is_workspace_user: false,
  author_user_id: null,
  created_at: '2026-10-20T12:00:00Z',
  ...over,
});

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <LinhaEditorialView
          contaId="c1"
          clientes={[CLIENTE]}
          filterClientes={[1]}
          mes="2026-11"
          onChange={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { qc, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  m.listLinhasDoMes.mockResolvedValue([LINHA]);
  m.listItens.mockResolvedValue([item(1), item(2)]);
  m.listColunas.mockResolvedValue([] as LinhaColuna[]);
  m.listRespostas.mockResolvedValue([]);
  m.listPostsDaLinha.mockResolvedValue([] as LinhaPost[]);
  m.addItem.mockImplementation(async (linhaId: string, patch: Partial<LinhaItem>) => ({
    ...item(99),
    ...patch,
    linha_id: linhaId,
  }));
  m.updateItem.mockResolvedValue(undefined);
  m.deleteItem.mockResolvedValue(undefined);
  m.reorderItens.mockResolvedValue(undefined);
  m.responderComentario.mockResolvedValue(undefined);
  m.getHubToken.mockResolvedValue(null);
  m.getWorkspaceSlug.mockResolvedValue('acme');
});

describe('LinhaTable editing', () => {
  it('Tab moves to next cell, Enter to the cell below', async () => {
    const user = userEvent.setup();
    renderView();
    const titulos = await screen.findAllByLabelText('Título');
    expect(titulos).toHaveLength(2);
    await user.click(titulos[0]);
    await user.keyboard('{Tab}');
    expect(screen.getAllByLabelText('Direção do conteúdo')[0]).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(titulos[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getAllByLabelText('Título')[1]).toHaveFocus();
    expect(m.updateItem).not.toHaveBeenCalled();
  });

  it('titulo edit saves once after debounce', async () => {
    const user = userEvent.setup();
    renderView();
    const [titulo] = await screen.findAllByLabelText('Título');
    await user.type(titulo, ' novo');
    expect(m.updateItem).not.toHaveBeenCalled();
    await waitFor(() => expect(m.updateItem).toHaveBeenCalledTimes(1));
    // Only the changed field travels (post_id and friends are not granted to UPDATE).
    expect(m.updateItem).toHaveBeenCalledWith('i1', { titulo: 'Post 1 novo' });
    await new Promise((r) => setTimeout(r, 500));
    expect(m.updateItem).toHaveBeenCalledTimes(1);
  });

  it('Nova linha uses defaultNovaData', async () => {
    const user = userEvent.setup();
    m.listItens.mockResolvedValue([
      item(1, { data: '2026-11-03' }),
      item(2, { data: '2026-11-05' }),
    ]);
    renderView();
    await screen.findAllByLabelText('Título');
    await user.click(screen.getByRole('button', { name: 'Nova linha' }));
    await waitFor(() =>
      expect(m.addItem).toHaveBeenCalledWith(
        'l-1',
        expect.objectContaining({ data: '2026-11-06', ordem: 3 }),
      ),
    );
    // Optimistic: the row is in the table before the insert resolves.
    await waitFor(() => expect(screen.getAllByLabelText('Título')).toHaveLength(3));
  });

  it('Ordenar por data writes the date order', async () => {
    const user = userEvent.setup();
    m.listItens.mockResolvedValue([
      item(1, { data: '2026-11-09' }),
      item(2, { data: null }),
      item(3, { data: '2026-11-02' }),
    ]);
    renderView();
    await screen.findAllByLabelText('Título');
    await user.click(screen.getByRole('button', { name: 'Ordenar por data' }));
    await waitFor(() => expect(m.reorderItens).toHaveBeenCalledWith(['i3', 'i1', 'i2']));
  });
});

describe('LinhaTable converted rows', () => {
  const POST: LinhaPost = {
    id: 99,
    status: 'aprovado_cliente',
    custom_status_id: null,
    titulo: 'Post 2',
    workflow_id: 7,
    workflow_titulo: 'Reels de novembro',
  };

  it('converted row cells are read-only and show the post status chip', async () => {
    m.listItens.mockResolvedValue([item(1), item(2, { post_id: 99 })]);
    m.listPostsDaLinha.mockResolvedValue([POST]);
    renderView();
    expect(await screen.findByText('Aprovado pelo cliente')).toBeInTheDocument();
    expect(m.listPostsDaLinha).toHaveBeenCalledWith([99]);
    // Only the unconverted row has editors.
    expect(screen.getAllByLabelText('Título')).toHaveLength(1);
    expect(screen.getAllByLabelText('Direção do conteúdo')).toHaveLength(1);
    const row = screen.getByTestId('linha-row-i2');
    expect(within(row).getByText('Post 2')).toBeInTheDocument();
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(within(row).getByRole('link', { name: 'Reels de novembro' })).toHaveAttribute(
      'href',
      expect.stringContaining('post=99'),
    );
    expect(screen.getByRole('columnheader', { name: 'Produção' })).toBeInTheDocument();
  });

  it('Produção column only appears once a row is converted', async () => {
    renderView();
    await screen.findAllByLabelText('Título');
    expect(screen.queryByRole('columnheader', { name: 'Produção' })).toBeNull();
  });

  it('converted rows have no selection checkbox', async () => {
    const user = userEvent.setup();
    m.listItens.mockResolvedValue([item(1), item(2, { post_id: 99 })]);
    m.listPostsDaLinha.mockResolvedValue([POST]);
    renderView();
    const sel = await screen.findByRole('checkbox', { name: 'Selecionar Post 1' });
    expect(screen.queryByRole('checkbox', { name: 'Selecionar Post 2' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar todas' }));
    expect(sel).toBeChecked();
  });

  it('converted row menu offers Abrir post and confirms delete', async () => {
    const user = userEvent.setup();
    m.listItens.mockResolvedValue([item(1), item(2, { post_id: 99 })]);
    m.listPostsDaLinha.mockResolvedValue([POST]);
    renderView();
    await user.click(await screen.findByRole('button', { name: 'Ações da linha Post 2' }));
    expect(await screen.findByRole('menuitem', { name: 'Abrir post' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Excluir linha' }));
    expect(
      await screen.findByText(
        'Excluir esta linha? O post criado a partir dela continua existindo.',
      ),
    ).toBeInTheDocument();
    expect(m.deleteItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(m.deleteItem).toHaveBeenCalledWith('i2'));
  });

  it('unconverted row deletes without confirm', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole('button', { name: 'Ações da linha Post 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir linha' }));
    await waitFor(() => expect(m.deleteItem).toHaveBeenCalledWith('i1'));
  });
});

describe('LinhaTable comments', () => {
  const RESPOSTAS = [
    resposta({ id: 'r0', comentario: 'Gostei do mês' }),
    resposta({ id: 'r1', item_id: 'i1', comentario: 'Trocar a foto' }),
    resposta({ id: 'r2', item_id: 'i1', comentario: 'Feito', is_workspace_user: true }),
    resposta({ id: 'r3', item_id: 'i1', comentario: 'Agora sim', rodada: 2 }),
  ];

  it('comment count opens panel with item thread and rodada separator', async () => {
    const user = userEvent.setup();
    m.listRespostas.mockResolvedValue(RESPOSTAS);
    renderView();
    await user.click(await screen.findByRole('button', { name: '3 comentários' }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Gostei do mês')).toBeInTheDocument();
    expect(within(panel).getByText('Trocar a foto')).toBeInTheDocument();
    expect(within(panel).getByText('Agora sim')).toBeInTheDocument();
    expect(within(panel).getByText('Rodada 2')).toBeInTheDocument();
    expect(within(panel).getAllByText('Rodada 1').length).toBeGreaterThan(0);
  });

  it('a row without comments shows no count', async () => {
    m.listRespostas.mockResolvedValue(RESPOSTAS);
    renderView();
    await screen.findByRole('button', { name: '3 comentários' });
    const row2 = screen.getByTestId('linha-row-i2');
    expect(within(row2).queryByRole('button', { name: /comentário/ })).toBeNull();
  });

  it('team reply calls responderComentario', async () => {
    const user = userEvent.setup();
    m.listRespostas.mockResolvedValue(RESPOSTAS);
    renderView();
    await user.click(await screen.findByRole('button', { name: '3 comentários' }));
    const panel = await screen.findByRole('dialog');
    await user.type(within(panel).getByLabelText('Resposta'), 'Vou ajustar');
    await user.click(within(panel).getByRole('button', { name: 'Responder' }));
    await waitFor(() =>
      expect(m.responderComentario).toHaveBeenCalledWith('l-1', 'i1', 'Vou ajustar'),
    );
    await waitFor(() => expect(within(panel).getByLabelText('Resposta')).toHaveValue(''));
  });

  it('a failed reply keeps the draft', async () => {
    const user = userEvent.setup();
    m.listRespostas.mockResolvedValue(RESPOSTAS);
    m.responderComentario.mockRejectedValue(new Error('boom'));
    renderView();
    await user.click(await screen.findByRole('button', { name: '3 comentários' }));
    const panel = await screen.findByRole('dialog');
    await user.type(within(panel).getByLabelText('Resposta'), 'Vou ajustar');
    await user.click(within(panel).getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(m.toastError).toHaveBeenCalled());
    expect(within(panel).getByLabelText('Resposta')).toHaveValue('Vou ajustar');
  });
});

describe('LinhaTable columns', () => {
  it('Direção do conteúdo toggle hides the column only', async () => {
    const user = userEvent.setup();
    m.listItens.mockResolvedValue([item(1, { direcao: 'Mostrar o antes e depois' })]);
    renderView();
    await screen.findAllByLabelText('Título');
    expect(screen.getByRole('columnheader', { name: 'Direção do conteúdo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Colunas' }));
    await user.click(
      await screen.findByRole('switch', { name: 'Mostrar Direção do conteúdo na tabela' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: 'Direção do conteúdo' })).toBeNull(),
    );
    expect(screen.getByRole('columnheader', { name: 'Título' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Formato' })).toBeInTheDocument();
    // Only hidden here: no write to the item or the columns.
    expect(m.updateItem).not.toHaveBeenCalled();
    expect(m.updateColuna).not.toHaveBeenCalled();
    expect(localStorage.getItem('entregas_linha_direcao_oculta_c1')).toBe('1');
  });

  it('extra columns render in ordem, hidden ones are left out, and select saves valores', async () => {
    const user = userEvent.setup();
    const pilar: LinhaColuna = {
      id: 'c-pilar',
      nome: 'Pilar',
      tipo: 'select',
      config: {
        options: [
          { id: 'o-edu', label: 'Educação', color: '#3b82f6' },
          { id: 'o-aut', label: 'Autoridade', color: '#22c55e' },
        ],
      },
      visivel_cliente: true,
      oculta: false,
      ordem: 0,
    };
    const ref: LinhaColuna = {
      id: 'c-ref',
      nome: 'Referência',
      tipo: 'url',
      config: {},
      visivel_cliente: true,
      oculta: true,
      ordem: 1,
    };
    m.listColunas.mockResolvedValue([pilar, ref]);
    m.listItens.mockResolvedValue([item(1, { valores: { 'c-orfa': 'x' } })]);
    renderView();
    expect(await screen.findByRole('columnheader', { name: 'Pilar' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Referência' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pilar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Autoridade' }));
    await waitFor(() =>
      // The whole valores travels, orphan keys of deleted columns included.
      expect(m.updateItem).toHaveBeenCalledWith('i1', {
        valores: { 'c-orfa': 'x', 'c-pilar': 'o-aut' },
      }),
    );
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LinhaTable write failures and ordering', () => {
  it('a guard raise reaches the user as actionable copy', async () => {
    const user = userEvent.setup();
    m.addItem.mockRejectedValue({ message: 'linha_item_limite', code: 'P0001' });
    renderView();
    await screen.findAllByLabelText('Título');
    await user.click(screen.getByRole('button', { name: 'Nova linha' }));
    await waitFor(() =>
      expect(m.toastError).toHaveBeenCalledWith(
        'A linha chegou ao limite de 100 posts. Exclua uma linha para criar outra.',
      ),
    );
  });

  it('the Data input accepts a date outside the linha month', async () => {
    renderView();
    const [data] = await screen.findAllByLabelText('Data');
    expect(data).not.toHaveAttribute('min');
    expect(data).not.toHaveAttribute('max');
    fireEvent.change(data, { target: { value: '2026-12-03' } });
    fireEvent.blur(data);
    await waitFor(() => expect(m.updateItem).toHaveBeenCalledWith('i1', { data: '2026-12-03' }));
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it('a half-typed year is never saved', async () => {
    renderView();
    const [data] = await screen.findAllByLabelText('Data');
    fireEvent.change(data, { target: { value: '0002-11-03' } });
    fireEvent.blur(data);
    await new Promise((r) => setTimeout(r, 50));
    expect(m.updateItem).not.toHaveBeenCalled();
  });

  it('deleting a row whose insert is in flight waits for the insert', async () => {
    const user = userEvent.setup();
    const insert = deferred<LinhaItem>();
    m.addItem.mockReturnValue(insert.promise);
    renderView();
    await screen.findAllByLabelText('Título');
    await user.click(screen.getByRole('button', { name: 'Nova linha' }));
    await waitFor(() => expect(m.addItem).toHaveBeenCalled());
    const novoId = (m.addItem.mock.calls[0][1] as { id: string }).id;
    await user.click(await screen.findByRole('button', { name: 'Ações da linha sem título' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir linha' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(m.deleteItem).not.toHaveBeenCalled();
    insert.resolve(item(3, { id: novoId }));
    await waitFor(() => expect(m.deleteItem).toHaveBeenCalledWith(novoId));
  });

  it('a delete after a failed insert is skipped', async () => {
    const user = userEvent.setup();
    const insert = deferred<LinhaItem>();
    m.addItem.mockReturnValue(insert.promise);
    renderView();
    await screen.findAllByLabelText('Título');
    await user.click(screen.getByRole('button', { name: 'Nova linha' }));
    await user.click(await screen.findByRole('button', { name: 'Ações da linha sem título' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir linha' }));
    insert.reject(new Error('rede'));
    await waitFor(() => expect(m.toastError).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(m.deleteItem).not.toHaveBeenCalled();
  });

  it('an optimistic write does not cancel a pending rollback refetch', async () => {
    const user = userEvent.setup();
    const { qc } = renderView();
    const [titulo] = await screen.findAllByLabelText('Título');
    // The rollback refetch hangs until the end of the test.
    const refetch = deferred<LinhaItem[]>();
    m.listItens.mockReturnValueOnce(refetch.promise);
    m.updateItem.mockRejectedValueOnce(new Error('rede'));
    await user.type(titulo, ' a');
    await waitFor(() => expect(m.toastError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(m.listItens).toHaveBeenCalledTimes(2));
    const cancel = vi.spyOn(qc, 'cancelQueries');
    await user.type(screen.getAllByLabelText('Título')[1], ' b');
    await waitFor(() => expect(m.updateItem).toHaveBeenCalledTimes(2));
    expect(cancel).not.toHaveBeenCalled();
    // The write landed while the rollback was in flight: it resyncs once it succeeds.
    await waitFor(() => expect(m.listItens).toHaveBeenCalledTimes(3));
    refetch.resolve([item(1), item(2)]);
  });
});
