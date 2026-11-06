import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente } from '@/store';
import type { LinhaEditorial, LinhaItem, LinhaResposta } from '@/store/linhaEditorial';
import { buildStatusRegistry } from '../../statusRegistry';

const m = vi.hoisted(() => ({
  listLinhasDoMes: vi.fn(),
  listItens: vi.fn(),
  listColunas: vi.fn(),
  listRespostas: vi.fn(),
  enviarLinha: vi.fn(),
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
  enviarLinha: m.enviarLinha,
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
// jsdom's matchMedia never matches; the phone layout is pinned on here.
vi.mock('../useIsLinhaPhone', () => ({ useIsLinhaPhone: () => true }));

import { LinhaEditorialView } from '../LinhaEditorialView';
import { LinhaPhoneView } from '../LinhaPhoneView';

const cliente = (id: number, nome: string): Cliente =>
  ({ id, nome, sigla: nome.slice(0, 2).toUpperCase(), cor: '#123456', status: 'ativo' }) as Cliente;

const CLIENTES = [cliente(1, 'Ana Clínica'), cliente(2, 'Bruno Estética')];

const linha = (over: Partial<LinhaEditorial> = {}): LinhaEditorial => ({
  id: 'l-1',
  conta_id: 'c1',
  cliente_id: 1,
  periodo: '2026-11-01',
  status: 'rascunho',
  enviada_at: null,
  enviada_por: null,
  decidida_at: null,
  rodada: 1,
  itens_total: 2,
  itens_convertidos: 0,
  ...over,
});

const item = (n: number, over: Partial<LinhaItem> = {}): LinhaItem => ({
  id: `i${n}`,
  linha_id: 'l-1',
  data: `2026-11-0${n}`,
  tipo: 'reels',
  titulo: `Post ${n}`,
  direcao: `Direção ${n}`,
  valores: {},
  ordem: n,
  post_id: null,
  ...over,
});

const resposta = (over: Partial<LinhaResposta>): LinhaResposta => ({
  id: 'r1',
  linha_id: 'l-1',
  item_id: 'i1',
  acao: 'comentario',
  comentario: 'Trocar o gancho',
  rodada: 1,
  is_workspace_user: false,
  author_user_id: null,
  created_at: '2026-11-02T10:00:00Z',
  ...over,
});

const ITENS = [item(1), item(2, { tipo: 'carrossel', direcao: '' })];

function renderView() {
  const onChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <LinhaEditorialView
          contaId="c1"
          clientes={CLIENTES}
          filterClientes={[1]}
          mes="2026-11"
          onChange={onChange}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listLinhasDoMes.mockResolvedValue([linha()]);
  m.listItens.mockResolvedValue(ITENS);
  m.listColunas.mockResolvedValue([]);
  m.listRespostas.mockResolvedValue([
    resposta({ id: 'r1' }),
    resposta({ id: 'r2', comentario: 'Concordo' }),
    resposta({ id: 'r3', item_id: 'i2', acao: 'ajustes', comentario: null }),
  ]);
  m.enviarLinha.mockResolvedValue(undefined);
  m.getHubToken.mockResolvedValue(null);
  m.getWorkspaceSlug.mockResolvedValue('acme');
});

describe('LinhaPhoneView', () => {
  it('phone shows cards and no edit controls', async () => {
    renderView();
    const cards = await screen.findAllByTestId('linha-phone-card');
    expect(cards).toHaveLength(2);

    const first = within(cards[0]);
    expect(first.getByText('Post 1')).toBeInTheDocument();
    expect(first.getByText('Vídeo vertical')).toBeInTheDocument();
    expect(first.getByText('Direção 1')).toBeInTheDocument();
    expect(first.getByText('1 nov')).toBeInTheDocument();
    // Two real comments on i1; the empty "ajustes" answer on i2 does not count.
    expect(first.getByLabelText('2 comentários')).toBeInTheDocument();
    expect(within(cards[1]).queryByLabelText(/comentário/)).toBeNull();

    expect(screen.getByText('Edite a linha no computador.')).toBeInTheDocument();
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
    // Read only: no inputs, no row menus, no columns popover, no conversion.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /Colunas/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ações da linha/ })).toBeNull();
    expect(screen.queryByText(/Converter|Criar posts|Nova linha/)).toBeNull();
  });

  it('client list selects another client', async () => {
    const { onChange } = renderView();
    await screen.findAllByTestId('linha-phone-card');
    await userEvent.click(screen.getByRole('button', { name: /Bruno Estética/ }));
    expect(onChange).toHaveBeenCalledWith({ clientes: [2] });
  });

  it('Enviar ao cliente works on phone', async () => {
    renderView();
    await screen.findAllByTestId('linha-phone-card');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
    await waitFor(() => expect(m.enviarLinha).toHaveBeenCalledWith('l-1'));
    await waitFor(() => expect(m.toastSuccess).toHaveBeenCalledWith('Linha enviada ao cliente.'));
  });

  it('Enviar ao cliente is disabled with no rows', async () => {
    m.listItens.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText('Nenhum post nesta linha.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar ao cliente' })).toBeDisabled();
  });

  it('sent linha shows the status and no send button', async () => {
    m.listLinhasDoMes.mockResolvedValue([linha({ status: 'enviada' })]);
    renderView();
    await screen.findAllByTestId('linha-phone-card');
    expect(screen.getByText('Enviada ao cliente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar ao cliente' })).toBeNull();
  });

  it('client without a linha says to create it on the computer', async () => {
    m.listLinhasDoMes.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText(/Sem linha neste mês/)).toBeInTheDocument();
    expect(screen.getAllByText(/no computador\./).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Criar linha' })).toBeNull();
  });

  it('cards show the row state next to the format once the linha was sent', async () => {
    m.listLinhasDoMes.mockResolvedValue([linha({ status: 'ajustes', rodada: 1 })]);
    m.listItens.mockResolvedValue([
      item(1, { aprovacao: 'aprovado' }),
      item(2, { aprovacao: 'ajustes' }),
      item(3),
    ]);
    renderView();
    const cards = await screen.findAllByTestId('linha-phone-card');
    expect(within(cards[0]).getByText('Aprovado')).toBeInTheDocument();
    // Read only on the phone: no thread to open, so the chip is not a button.
    expect(within(cards[1]).getByText('Ajuste pedido')).toBeInTheDocument();
    expect(within(cards[1]).queryByRole('button', { name: 'Ajuste pedido' })).toBeNull();
    expect(within(cards[2]).getByText('Pendente')).toBeInTheDocument();
  });

  it('cards show no state before the first send', async () => {
    m.listLinhasDoMes.mockResolvedValue([linha({ rodada: 0 })]);
    m.listItens.mockResolvedValue([item(1, { aprovacao: 'aprovado' }), item(2)]);
    renderView();
    await screen.findAllByTestId('linha-phone-card');
    expect(screen.queryByText('Aprovado')).toBeNull();
    expect(screen.queryByText('Pendente')).toBeNull();
  });

  it('renders directly from props', () => {
    render(
      <LinhaPhoneView
        clientes={CLIENTES}
        linhas={[linha()]}
        mes="2026-11"
        selectedId={1}
        fotosDe={() => []}
        linhasLoading={false}
        linhasError={false}
        itens={ITENS}
        itensLoading={false}
        itensError={false}
        respostas={[]}
        enviando={false}
        onSelect={vi.fn()}
        onMesChange={vi.fn()}
        onEnviar={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('linha-phone-card')).toHaveLength(2);
  });
});
