import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente } from '@/store';
import type { LinhaEditorial, LinhaItem } from '@/store/linhaEditorial';
import { MemoryRouter } from 'react-router-dom';
import { buildStatusRegistry } from '../../statusRegistry';

const m = vi.hoisted(() => ({
  listLinhasDoMes: vi.fn(),
  listItens: vi.fn(),
  listColunas: vi.fn(),
  listRespostas: vi.fn(),
  criarLinha: vi.fn(),
  enviarLinha: vi.fn(),
  recolherLinha: vi.fn(),
  getHubToken: vi.fn(),
  getWorkspaceSlug: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/store/linhaEditorial', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/linhaEditorial')>()),
  listPostsDaLinha: vi.fn().mockResolvedValue([]),
  listLinhasDoMes: m.listLinhasDoMes,
  listItens: m.listItens,
  listColunas: m.listColunas,
  listRespostas: m.listRespostas,
  criarLinha: m.criarLinha,
  enviarLinha: m.enviarLinha,
  recolherLinha: m.recolherLinha,
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

const cliente = (id: number, nome: string): Cliente =>
  ({ id, nome, sigla: nome.slice(0, 2).toUpperCase(), cor: '#123456', status: 'ativo' }) as Cliente;

const CLIENTES = [
  cliente(1, 'Zeta Odonto'),
  cliente(2, 'Ana Clínica'),
  cliente(3, 'Bruno Estética'),
];

const linha = (over: Partial<LinhaEditorial> & { cliente_id: number }): LinhaEditorial => ({
  id: `l-${over.cliente_id}`,
  conta_id: 'c1',
  periodo: '2026-11-01',
  status: 'rascunho',
  enviada_at: null,
  enviada_por: null,
  decidida_at: null,
  rodada: 1,
  itens_total: 0,
  itens_convertidos: 0,
  ...over,
});

const item = (n: number, tipo: LinhaItem['tipo'] = 'reels'): LinhaItem => ({
  id: `i${n}`,
  linha_id: 'l-1',
  data: null,
  tipo,
  titulo: `Post ${n}`,
  direcao: '',
  valores: {},
  ordem: n,
  post_id: null,
});

function renderView(over: Partial<React.ComponentProps<typeof LinhaEditorialView>> = {}) {
  const onChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    contaId: 'c1',
    clientes: CLIENTES,
    filterClientes: [] as number[],
    mes: '2026-11',
    onChange,
    ...over,
  };
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <LinhaEditorialView {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onChange, qc, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listLinhasDoMes.mockResolvedValue([]);
  m.listItens.mockResolvedValue([]);
  m.listColunas.mockResolvedValue([]);
  m.listRespostas.mockResolvedValue([]);
  m.criarLinha.mockResolvedValue('new-linha');
  m.enviarLinha.mockResolvedValue(undefined);
  m.recolherLinha.mockResolvedValue(undefined);
  m.getHubToken.mockResolvedValue(null);
  m.getWorkspaceSlug.mockResolvedValue('acme');
});

describe('LinhaEditorialView rail', () => {
  it('rail sorts clients with linha first then alphabetical', async () => {
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, itens_total: 3 }),
      linha({ cliente_id: 3, status: 'enviada', itens_total: 2 }),
    ]);
    renderView();
    await screen.findByText('2 posts');
    const names = within(screen.getByTestId('linha-rail'))
      .getAllByTestId('linha-rail-name')
      .map((n) => n.textContent);
    // Bruno and Zeta have a linha (alphabetical), Ana has none and comes last.
    expect(names).toEqual(['Bruno Estética', 'Zeta Odonto', 'Ana Clínica']);
    const rail = within(screen.getByTestId('linha-rail'));
    expect(rail.getByText('Enviada ao cliente')).toBeInTheDocument();
    expect(rail.getByText('Rascunho')).toBeInTheDocument();
    expect(rail.getByText('3 posts')).toBeInTheDocument();
  });

  it('Criar calls criarLinha with periodo 2026-11-01 and selects the client', async () => {
    const user = userEvent.setup();
    const { onChange } = renderView();
    await screen.findAllByText('Sem linha neste mês');
    const row = screen.getByText('Ana Clínica').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(m.criarLinha).toHaveBeenCalledWith(2, '2026-11-01'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ clientes: [2] }));
  });

  it('shows N de M em produção once rows are converted', async () => {
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'aprovada', itens_total: 5, itens_convertidos: 2 }),
    ]);
    renderView();
    expect(await screen.findByText('2 de 5 em produção')).toBeInTheDocument();
    expect(within(screen.getByTestId('linha-rail')).getByText('Aprovada')).toBeInTheDocument();
  });

  it('month switch writes mes', async () => {
    const user = userEvent.setup();
    const { onChange } = renderView();
    expect(screen.getByText('Novembro 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(onChange).toHaveBeenLastCalledWith({ mes: '2026-10' });
    await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(onChange).toHaveBeenLastCalledWith({ mes: '2026-12' });
  });

  it('month switch rolls over the year', async () => {
    const user = userEvent.setup();
    const { onChange } = renderView({ mes: '2026-12' });
    await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(onChange).toHaveBeenLastCalledWith({ mes: '2027-01' });
  });
});

describe('LinhaEditorialView header', () => {
  it('Enviar ao cliente disabled with zero rows', async () => {
    m.listLinhasDoMes.mockResolvedValue([linha({ cliente_id: 1 })]);
    renderView({ filterClientes: [1] });
    const btn = await screen.findByRole('button', { name: 'Enviar ao cliente' });
    expect(btn).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Colunas' })).toBeInTheDocument();
  });

  it('Enviar ao cliente sends the linha when rows exist', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes.mockResolvedValue([linha({ cliente_id: 1, itens_total: 2 })]);
    m.listItens.mockResolvedValue([item(1), item(2, 'carrossel')]);
    renderView({ filterClientes: [1] });
    const btn = await screen.findByRole('button', { name: 'Enviar ao cliente' });
    await waitFor(() => expect(btn).toBeEnabled());
    expect(await screen.findByText(/2 posts · Carrossel 1 · Reels 1/)).toBeInTheDocument();
    await user.click(btn);
    await waitFor(() => expect(m.enviarLinha).toHaveBeenCalledWith('l-1'));
  });

  it('enviada shows Recolher and the banner', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes.mockResolvedValue([
      linha({
        cliente_id: 1,
        status: 'enviada',
        itens_total: 1,
        enviada_at: '2026-10-20T12:00:00Z',
      }),
    ]);
    m.listItens.mockResolvedValue([item(1)]);
    renderView({ filterClientes: [1] });
    expect(
      await screen.findByText('O cliente vê as alterações ao abrir o Hub.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar ao cliente' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Link do Hub' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recolher' }));
    await waitFor(() => expect(m.recolherLinha).toHaveBeenCalledWith('l-1'));
  });

  it('Link do Hub is disabled without a token', async () => {
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'enviada', itens_total: 1 }),
    ]);
    renderView({ filterClientes: [1] });
    const btn = await screen.findByRole('button', { name: 'Link do Hub' });
    await waitFor(() => expect(m.getHubToken).toHaveBeenCalledWith(1));
    expect(btn).toBeDisabled();
  });

  it('Link do Hub copies the compact aprovacoes link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    m.getHubToken.mockResolvedValue({
      id: 't',
      token: '123e4567-e89b-12d3-a456-426614174000',
      is_active: true,
      expires_at: '2999-01-01T00:00:00Z',
    });
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'enviada', itens_total: 1 }),
    ]);
    renderView({ filterClientes: [1] });
    await screen.findByRole('button', { name: 'Link do Hub' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link do Hub' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Link do Hub' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/acme/hub/123e4567e89b12d3a456426614174000/aprovacoes?aba=linha`,
      ),
    );
  });

  it('aprovada offers Enviar de novo in the overflow menu', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'aprovada', itens_total: 1 }),
    ]);
    m.listItens.mockResolvedValue([item(1)]);
    renderView({ filterClientes: [1] });
    await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Enviar de novo' }));
    await waitFor(() => expect(m.enviarLinha).toHaveBeenCalledWith('l-1'));
  });

  it('a client without linha shows the empty state with Criar', async () => {
    const user = userEvent.setup();
    const { onChange } = renderView({ filterClientes: [2] });
    const main = await screen.findByTestId('linha-main');
    await user.click(await within(main).findByRole('button', { name: 'Criar linha' }));
    await waitFor(() => expect(m.criarLinha).toHaveBeenCalledWith(2, '2026-11-01'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ clientes: [2] }));
  });
});
