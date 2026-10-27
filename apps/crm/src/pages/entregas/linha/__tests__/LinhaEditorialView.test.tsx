import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente, Membro, WorkflowTemplate } from '@/store';
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
  renameLinha: vi.fn(),
  converterItens: vi.fn(),
  getHubToken: vi.fn(),
  getWorkspaceSlug: vi.fn(),
  getMembros: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  createWorkflowFromWizard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

// The wizard's steps scroll into view; jsdom has no layout.
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

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
  renameLinha: m.renameLinha,
  converterItens: m.converterItens,
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
vi.mock('sonner', () => ({
  toast: { success: m.toastSuccess, error: m.toastError, warning: m.toastWarning },
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    features: { feature_linha_editorial: true, feature_post_processes: true },
    limits: null,
    isLoading: false,
  }),
}));
vi.mock('@/store/team', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/team')>()),
  getMembros: m.getMembros,
}));
vi.mock('@/store/workflows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/workflows')>()),
  getWorkflowTemplates: m.getWorkflowTemplates,
}));
vi.mock('../../wizard/createWorkflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../wizard/createWorkflow')>()),
  createWorkflowFromWizard: m.createWorkflowFromWizard,
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

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
  rodada: 0,
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
  m.renameLinha.mockResolvedValue(undefined);
  m.getHubToken.mockResolvedValue(null);
  m.getWorkspaceSlug.mockResolvedValue('acme');
  m.getMembros.mockResolvedValue([{ id: 9, nome: 'Ana' }] as Membro[]);
  m.getWorkflowTemplates.mockResolvedValue([
    {
      id: 12,
      nome: 'Fluxo Padrão de Post',
      modo_prazo: 'padrao',
      etapas: [
        {
          nome: 'Briefing',
          prazo_dias: 2,
          tipo_prazo: 'corridos',
          responsavel_id: 9,
          tipo: 'padrao',
        },
      ],
    },
  ] as WorkflowTemplate[]);
  m.createWorkflowFromWizard.mockResolvedValue({
    workflow: { id: 77, titulo: 'Reels de novembro', template_id: null },
  });
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

  it('shows A de M aprovados once the linha was sent', async () => {
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'ajustes', rodada: 1, itens_total: 12, itens_aprovados: 9 }),
      linha({ cliente_id: 2, status: 'enviada', rodada: 1, itens_total: 4 }),
    ]);
    renderView();
    const rail = within(screen.getByTestId('linha-rail'));
    expect(await rail.findByText('9 de 12 aprovados')).toBeInTheDocument();
    expect(rail.getByText('0 de 4 aprovados')).toBeInTheDocument();
  });

  it('em produção wins over aprovados, and a never-sent linha counts posts', async () => {
    m.listLinhasDoMes.mockResolvedValue([
      linha({
        cliente_id: 1,
        status: 'aprovada',
        rodada: 1,
        itens_total: 5,
        itens_convertidos: 2,
        itens_aprovados: 5,
      }),
      linha({ cliente_id: 2, rodada: 0, itens_total: 1, itens_aprovados: 0 }),
    ]);
    renderView();
    const rail = within(screen.getByTestId('linha-rail'));
    expect(await rail.findByText('2 de 5 em produção')).toBeInTheDocument();
    expect(rail.getByText('1 post')).toBeInTheDocument();
    expect(rail.queryByText(/aprovados/)).toBeNull();
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

  it('summary appends the approval progress once the linha was sent', async () => {
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'ajustes', rodada: 1, itens_total: 6 }),
    ]);
    m.listItens.mockResolvedValue([
      { ...item(1), aprovacao: 'aprovado' },
      { ...item(2), aprovacao: 'aprovado' },
      { ...item(3), aprovacao: 'aprovado' },
      { ...item(4, 'carrossel'), aprovacao: 'ajustes' },
      item(5, 'carrossel'),
      { ...item(6, 'carrossel'), aprovacao: null },
    ]);
    renderView({ filterClientes: [1] });
    expect(
      await screen.findByText(/^6 posts · .* · 3 aprovados · 1 com ajuste · 2 pendentes$/),
    ).toBeInTheDocument();
  });

  it('summary omits zero parts and uses the singular', async () => {
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'enviada', rodada: 2, itens_total: 2 }),
    ]);
    m.listItens.mockResolvedValue([{ ...item(1), aprovacao: 'aprovado' }, item(2)]);
    renderView({ filterClientes: [1] });
    expect(
      await screen.findByText('2 posts · Reels 2 · 1 aprovado · 1 pendente'),
    ).toBeInTheDocument();
  });

  it('summary has no progress before the first send', async () => {
    m.listLinhasDoMes.mockResolvedValue([linha({ cliente_id: 1, itens_total: 1 })]);
    m.listItens.mockResolvedValue([{ ...item(1), aprovacao: 'aprovado' }]);
    renderView({ filterClientes: [1] });
    expect(await screen.findByText('1 post · Reels 1')).toBeInTheDocument();
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

describe('LinhaEditorialView title', () => {
  const titulo = () => screen.findByRole('button', { name: 'Linha editorial de novembro' });

  it('Enter saves the trimmed title once and shows it at once', async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    m.renameLinha.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    m.listLinhasDoMes.mockResolvedValue([linha({ cliente_id: 1 })]);
    renderView({ filterClientes: [1] });
    const btn = await titulo();
    expect(btn).toHaveAttribute('title', 'Renomear');
    await user.click(btn);
    const input = screen.getByRole('textbox', { name: 'Título da linha' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Linha editorial de novembro');
    expect(input).toHaveAttribute('maxLength', '120');
    await user.type(input, '  Campanha de Natal  {Enter}');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Campanha de Natal' }),
    ).toBeInTheDocument();
    expect(m.renameLinha).toHaveBeenCalledTimes(1);
    expect(m.renameLinha).toHaveBeenCalledWith('l-1', 'Campanha de Natal');
    resolve();
  });

  it('Escape cancels without saving', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes.mockResolvedValue([linha({ cliente_id: 1 })]);
    renderView({ filterClientes: [1] });
    await user.click(await titulo());
    await user.type(screen.getByRole('textbox', { name: 'Título da linha' }), 'Outro{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Título da linha' })).not.toBeInTheDocument();
    expect(await titulo()).toBeInTheDocument();
    expect(m.renameLinha).not.toHaveBeenCalled();
  });

  it('blur saves; an unchanged title saves nothing', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes.mockResolvedValue([linha({ cliente_id: 1, titulo: 'Natal' })]);
    renderView({ filterClientes: [1] });
    await user.click(await screen.findByRole('button', { name: 'Natal' }));
    const input = screen.getByRole('textbox', { name: 'Título da linha' });
    expect(input).toHaveValue('Natal');
    await user.type(input, ' {Enter}');
    expect(m.renameLinha).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Natal' }));
    await user.type(screen.getByRole('textbox', { name: 'Título da linha' }), ' 2');
    await user.click(document.body);
    await waitFor(() => expect(m.renameLinha).toHaveBeenCalledWith('l-1', 'Natal 2'));
    expect(m.renameLinha).toHaveBeenCalledTimes(1);
  });

  it('empty saves null and brings back the derived title', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes
      .mockResolvedValueOnce([linha({ cliente_id: 1, titulo: 'Natal' })])
      .mockResolvedValue([linha({ cliente_id: 1, titulo: null })]);
    renderView({ filterClientes: [1] });
    await user.click(await screen.findByRole('button', { name: 'Natal' }));
    await user.clear(screen.getByRole('textbox', { name: 'Título da linha' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(m.renameLinha).toHaveBeenCalledWith('l-1', null));
    expect(await titulo()).toBeInTheDocument();
  });

  it('an error rolls the title back and toasts', async () => {
    const user = userEvent.setup();
    let reject!: (e: unknown) => void;
    m.renameLinha.mockReturnValue(new Promise<void>((_r, rj) => (reject = rj)));
    m.listLinhasDoMes.mockResolvedValue([linha({ cliente_id: 1 })]);
    renderView({ filterClientes: [1] });
    await user.click(await titulo());
    await user.type(screen.getByRole('textbox', { name: 'Título da linha' }), 'Natal{Enter}');
    expect(await screen.findByRole('button', { name: 'Natal' })).toBeInTheDocument();
    reject(new Error('boom'));
    expect(await titulo()).toBeInTheDocument();
    expect(m.toastError).toHaveBeenCalledWith('Não foi possível renomear a linha.');
  });
});

describe('LinhaEditorialView selection', () => {
  it('selecting rows shows the bar and Criar posts individuais converts them as avulsos', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'aprovada', itens_total: 2 }),
    ]);
    m.listItens.mockResolvedValue([item(1), item(2)]);
    m.converterItens.mockResolvedValue([{ item_id: 'i1', post_id: 501 }]);
    const onVerPosts = vi.fn();
    renderView({ filterClientes: [1], onVerPosts });
    expect(screen.queryByTestId('linha-selection-bar')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: 'Selecionar Post 1' }));
    const bar = await screen.findByTestId('linha-selection-bar');
    expect(within(bar).getByText('1 selecionado')).toBeInTheDocument();
    expect(within(bar).getByText('1 reels')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Criar posts individuais' }));
    expect(
      await screen.findByRole('heading', { name: 'Criar 1 post individual' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Criar 1 post' }));
    await waitFor(() =>
      expect(m.converterItens).toHaveBeenCalledWith('l-1', null, expect.any(Array)),
    );
    expect(m.converterItens.mock.calls[0][2].map((p: { item_id: string }) => p.item_id)).toEqual([
      'i1',
    ]);
    await waitFor(() =>
      expect(screen.queryByTestId('linha-selection-bar')).not.toBeInTheDocument(),
    );
    const [msg, opts] = m.toastSuccess.mock.calls.at(-1)!;
    expect(msg).toBe('1 post criado');
    opts.action.onClick();
    expect(onVerPosts).toHaveBeenCalledWith(1);
  });
});

describe('LinhaEditorialView rail errors', () => {
  it('an errored month offers no Criar in the rail', async () => {
    m.listLinhasDoMes.mockRejectedValue(new Error('rede'));
    renderView();
    const main = await screen.findByTestId('linha-main');
    await within(main).findByRole('button', { name: /tentar/i });
    const rail = within(screen.getByTestId('linha-rail'));
    expect(rail.queryByRole('button', { name: 'Criar' })).toBeNull();
    expect(screen.queryByText('Sem linha neste mês')).toBeNull();
  });
});

describe('LinhaEditorialView Criar fluxo', () => {
  it('the wizard names a custom title as the origin', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'aprovada', itens_total: 1, titulo: 'Campanha de Natal' }),
    ]);
    m.listItens.mockResolvedValue([item(1)]);
    renderView({ filterClientes: [1] });
    await user.click(await screen.findByRole('checkbox', { name: 'Selecionar Post 1' }));
    const bar = await screen.findByTestId('linha-selection-bar');
    await user.click(within(bar).getByRole('button', { name: 'Criar fluxo' }));
    expect(
      await screen.findByText('1 post vem da linha editorial “Campanha de Natal”.'),
    ).toBeInTheDocument();
  });

  it('selected rows open the seeded wizard and convert into the new fluxo', async () => {
    const user = userEvent.setup();
    m.listLinhasDoMes.mockResolvedValue([
      linha({ cliente_id: 1, status: 'enviada', itens_total: 3 }),
    ]);
    m.listItens.mockResolvedValue([item(1), item(2), item(3)]);
    m.converterItens.mockResolvedValue([
      { item_id: 'i1', post_id: 501 },
      { item_id: 'i3', post_id: 502 },
    ]);
    renderView({ filterClientes: [1] });
    await user.click(await screen.findByRole('checkbox', { name: 'Selecionar Post 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Post 3' }));
    const bar = await screen.findByTestId('linha-selection-bar');
    await user.click(within(bar).getByRole('button', { name: 'Criar fluxo' }));
    // Not approved yet: asks first.
    await user.click(await screen.findByRole('button', { name: 'Criar mesmo assim' }));
    expect(
      await screen.findByText('2 posts vêm da linha editorial de novembro.'),
    ).toBeInTheDocument();

    // Template → O básico → Etapas → Prazos → Revisar.
    fireEvent.click(await screen.findByText('Fluxo Padrão de Post'));
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.click(await screen.findByText('Criar fluxo com 2 posts'));

    await waitFor(() => expect(m.converterItens).toHaveBeenCalledTimes(1));
    expect(m.createWorkflowFromWizard).toHaveBeenCalledWith(
      expect.objectContaining({ clienteId: 1, titulo: 'Reels de novembro' }),
    );
    const [linhaId, workflowId, payload] = m.converterItens.mock.calls[0];
    expect(linhaId).toBe('l-1');
    expect(workflowId).toBe(77);
    expect((payload as { item_id: string }[]).map((p) => p.item_id).sort()).toEqual(['i1', 'i3']);
    await waitFor(() =>
      expect(screen.queryByTestId('linha-selection-bar')).not.toBeInTheDocument(),
    );
  });
});
