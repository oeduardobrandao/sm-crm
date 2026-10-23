import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeriodoFinanceiro } from '@/store/financeiroV2';
import { planilha } from './fixtures/planilha';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const {
  useAuthMock,
  getRentabilidadeMock,
  getPeriodosMock,
  reabrirPeriodoMock,
  fecharPeriodoMock,
  downloadCsvMock,
  toastMock,
  entitlementMock,
  desktop,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getRentabilidadeMock: vi.fn(),
  getPeriodosMock: vi.fn(),
  reabrirPeriodoMock: vi.fn(),
  fecharPeriodoMock: vi.fn(),
  downloadCsvMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  entitlementMock: vi.fn(),
  desktop: { value: true },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/entitlement-toast', () => ({ handleEntitlementMutationError: entitlementMock }));
vi.mock('@/lib/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csvExport')>()),
  downloadCsv: downloadCsvMock,
}));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getRentabilidade: getRentabilidadeMock,
  getPeriodos: getPeriodosMock,
  reabrirPeriodo: reabrirPeriodoMock,
  fecharPeriodo: fecharPeriodoMock,
}));

import RentabilidadePage from '../RentabilidadePage';

const NBSP = /\u00a0/g;
const norm = (s: string | null | undefined) => (s ?? '').replace(NBSP, ' ');

function periodo(status: PeriodoFinanceiro['status']): PeriodoFinanceiro {
  return {
    inicio: '2026-10-01',
    fim: '2026-11-01',
    rotulo: 'out 2026',
    status,
    transicao: false,
  };
}

function auth(overrides: Record<string, unknown> = {}) {
  return {
    profile: { conta_id: 'w1' },
    canSeeFinancials: true,
    can: () => true,
    workspaceRole: 'owner',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/financeiro/rentabilidade']}>
        <RentabilidadePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
}

/** The <tr> of a client in the desktop table. */
function linha(nome: string): HTMLElement {
  return screen.getByRole('button', { name: nome }).closest('tr') as HTMLElement;
}

/** The KPI card holding a label. */
function kpi(label: string): HTMLElement {
  return screen.getByText(label).closest('.kpi-card') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  desktop.value = true;
  useAuthMock.mockReturnValue(auth());
  entitlementMock.mockReturnValue(false);
  getRentabilidadeMock.mockResolvedValue(planilha);
  getPeriodosMock.mockResolvedValue([periodo('aberto')]);
  reabrirPeriodoMock.mockResolvedValue(undefined);
  fecharPeriodoMock.mockResolvedValue(undefined);
});

describe('RentabilidadePage', () => {
  it('renders_kpis', async () => {
    renderPage();

    await screen.findByText('Receita recorrente');
    expect(getRentabilidadeMock).toHaveBeenCalledWith();
    expect(norm(kpi('Receita recorrente').textContent)).toContain('R$ 30.600,00');
    expect(norm(kpi('Receita recorrente').textContent)).toContain(
      '15 clientes · ARR R$ 367.200,00',
    );
    expect(norm(kpi('Custo da equipe').textContent)).toContain('R$ 12.310,00');
    expect(norm(kpi('Custo da equipe').textContent)).toContain('5 pessoas · 40,2% da receita');
    expect(norm(kpi('Lucro recorrente').textContent)).toContain('R$ 18.290,00');
    expect(norm(kpi('Lucro recorrente').textContent)).toContain('LL anual R$ 219.480,00');
    expect(kpi('Margem média')).toHaveTextContent('59,8%');
    expect(kpi('Margem média')).toHaveTextContent('Meta: 55%');
    // No cost outside the clients in the spreadsheet: the card stays hidden.
    expect(screen.queryByText('Sem cliente')).not.toBeInTheDocument();
  });

  it('shows the "Sem cliente" card when some cost has no client', async () => {
    const data = structuredClone(planilha);
    data.totais.custo_sem_cliente = 900;
    getRentabilidadeMock.mockResolvedValue(data);
    renderPage();

    await screen.findByText('Sem cliente');
    expect(norm(kpi('Sem cliente').textContent)).toContain('R$ 900,00');
    expect(kpi('Sem cliente')).toHaveTextContent('Pessoas sem cliente ou sem função');
  });

  it('sorted_by_margin_first_is_tyciana_or_cricia', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'Talitha' });
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    // Two header rows, then the clients.
    const first = rows[2];
    expect(['Crícia', 'Tyciana']).toContain(within(first).getAllByRole('button')[0].textContent);
    // Ties keep the payload order (by nome): Crícia, then Tyciana.
    expect(within(rows[2]).getByRole('button')).toHaveTextContent('Crícia');
    expect(within(rows[3]).getByRole('button')).toHaveTextContent('Tyciana');
    expect(within(rows[4]).getByRole('button')).toHaveTextContent('Talitha');
    expect(within(linha('Crícia')).getByText('47,0%')).toBeInTheDocument();
  });

  it('sorts clients without a margin last', async () => {
    const data = structuredClone(planilha);
    const cinara = data.clientes.find((c) => c.nome === 'Cinara')!;
    Object.assign(cinara, { status: 'pausado', receita: 0, custo: 0, lucro: 0, margem: null });
    getRentabilidadeMock.mockResolvedValue(data);
    renderPage();

    await screen.findByRole('button', { name: 'Cinara' });
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    // Last body row comes before the footer row.
    const last = rows[rows.length - 2];
    expect(within(last).getByRole('button')).toHaveTextContent('Cinara');
    expect(within(last).getByText('Pausado')).toBeInTheDocument();
  });

  it('talitha_abaixo_da_meta', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'Talitha' });
    expect(within(linha('Talitha')).getByText('Abaixo da meta')).toBeInTheDocument();
    expect(within(linha('Talitha')).getByText('52,8%')).toBeInTheDocument();
    expect(within(linha('Cinara')).queryByText('Abaixo da meta')).not.toBeInTheDocument();
  });

  it('anual_toggle_multiplies', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: 'Talitha' });
    expect(screen.getByRole('columnheader', { name: 'MRR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mensal' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Anual' }));

    expect(screen.getByRole('button', { name: 'Anual' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('columnheader', { name: 'ARR' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Custo anual' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'LL anual' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Videomaker' })).toBeInTheDocument();
    const talitha = norm(linha('Talitha').textContent);
    expect(talitha).toContain('R$ 30.000,00');
    expect(talitha).toContain('R$ 14.160,00');
    expect(talitha).toContain('R$ 6.600,00');
    // Margem does not change.
    expect(talitha).toContain('52,8%');
  });

  it('select_client_shows_regra', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Talitha' }));

    const detalhe = screen.getByRole('complementary', { name: 'Detalhe do cliente' });
    expect(norm(detalhe.textContent)).toContain('Só este cliente: R$ 550,00 por mês');
    expect(norm(detalhe.textContent)).toContain('R$ 3.900,00 ÷ 15 clientes');
    expect(within(detalhe).getByText('Copy: ninguém atribuído')).toBeInTheDocument();
    expect(
      within(detalhe).getByRole('img', {
        name: 'Videomaker 22%, Design 10%, Edição de vídeo 8%, Gestão de projetos 6%, Lucro 53%',
      }),
    ).toBeInTheDocument();
  });

  it('shows "A informar" for a delivery without a quantity', async () => {
    const user = userEvent.setup();
    const data = structuredClone(planilha);
    data.incompleto = true;
    const talitha = data.clientes.find((c) => c.nome === 'Talitha')!;
    talitha.a_informar = true;
    talitha.por_funcao['5'] = 0;
    talitha.pessoas.push({
      membro_id: 6,
      nome: 'Rafa',
      funcao_id: 5,
      regra: 'entrega',
      valor: 0,
      total: 0,
      n_clientes: 1,
      quantidade: null,
      valor_unitario: 40,
    });
    getRentabilidadeMock.mockResolvedValue(data);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Talitha' }));

    expect(within(linha('Talitha')).getByText('A informar')).toBeInTheDocument();
    const detalhe = screen.getByRole('complementary', { name: 'Detalhe do cliente' });
    expect(within(detalhe).getByText('A informar')).toBeInTheDocument();
    expect(within(detalhe).queryByText('Copy: ninguém atribuído')).not.toBeInTheDocument();
    expect(screen.getByText('Há entregas a informar neste período.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Informar entregas' })).toHaveAttribute(
      'href',
      '/financeiro/equipe',
    );
  });

  it('masked_without_financials', async () => {
    useAuthMock.mockReturnValue(auth({ canSeeFinancials: false }));
    const { container } = renderPage();

    await screen.findByRole('button', { name: 'Talitha' });
    expect(norm(container.textContent)).not.toMatch(/R\$ ?2\.500/);
    expect(norm(container.textContent)).not.toMatch(/R\$ ?30\.600/);
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
  });

  it('reabrir_visible_only_for_owner', async () => {
    const user = userEvent.setup();
    getPeriodosMock.mockResolvedValue([periodo('fechado')]);
    const { invalidate } = renderPage();

    const reabrir = await screen.findByRole('button', { name: 'Reabrir período' });
    expect(screen.getAllByText('Fechado').length).toBeGreaterThan(0);

    await user.click(reabrir);
    const dialog = await screen.findByRole('alertdialog', { name: 'Reabrir período?' });
    expect(dialog).toHaveTextContent(
      'Os números deste período voltam a ser calculados até você fechar de novo.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reabrir' }));

    await waitFor(() => expect(reabrirPeriodoMock).toHaveBeenCalledWith('2026-10-01'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] }));
  });

  it('hides "Reabrir período" from an agent and from a role without editar', async () => {
    getPeriodosMock.mockResolvedValue([periodo('fechado')]);
    useAuthMock.mockReturnValue(auth({ workspaceRole: 'agent' }));
    const { unmount } = renderPage();
    await screen.findByRole('button', { name: 'Talitha' });
    await waitFor(() => expect(screen.getAllByText('Fechado').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Reabrir período' })).not.toBeInTheDocument();
    unmount();

    useAuthMock.mockReturnValue(auth({ workspaceRole: 'admin', can: () => 'unknown' }));
    renderPage();
    await screen.findByRole('button', { name: 'Talitha' });
    await waitFor(() => expect(screen.getAllByText('Fechado').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Reabrir período' })).not.toBeInTheDocument();
  });

  it('offers "Fechar período" on a reopened period', async () => {
    const user = userEvent.setup();
    getPeriodosMock.mockResolvedValue([periodo('reaberto')]);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Fechar período' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Fechar período?' });
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));

    await waitFor(() => expect(fecharPeriodoMock).toHaveBeenCalledWith('2026-10-01'));
    expect(screen.queryByRole('button', { name: 'Reabrir período' })).not.toBeInTheDocument();
  });

  it('shows an error toast when reopening fails', async () => {
    const user = userEvent.setup();
    getPeriodosMock.mockResolvedValue([periodo('fechado')]);
    reabrirPeriodoMock.mockRejectedValue(new Error('periodo_invalido'));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Reabrir período' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Reabrir período?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reabrir' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(entitlementMock).toHaveBeenCalledWith(expect.any(Error), 'w1');
  });

  it('exports the rendered rows as CSV', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

    expect(downloadCsvMock).toHaveBeenCalledTimes(1);
    const [csv, filename] = downloadCsvMock.mock.calls[0] as [string, string];
    expect(filename).toBe('rentabilidade-out-2026.csv');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    expect(lines[0]).toBe(
      'Cliente;MRR;Custo;Lucro;Margem;Videomaker;Design;Edição de vídeo;Gestão de projetos;Copy',
    );
    expect(lines[1].startsWith('Crícia;')).toBe(true);
    expect(lines).toContain(
      'Talitha;2500,00;1180,00;1320,00;52,8;550,00;260,00;210,00;160,00;0,00',
    );

    await user.click(screen.getByRole('button', { name: 'Anual' }));
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    const [anual] = downloadCsvMock.mock.calls[1] as [string, string];
    expect(anual).toContain(
      'Talitha;30000,00;14160,00;15840,00;52,8;6600,00;3120,00;2520,00;1920,00;0,00',
    );
  });

  it('queries the chosen period', async () => {
    const user = userEvent.setup();
    const set = structuredClone(planilha);
    set.periodo = { ...set.periodo, inicio: '2026-09-01', fim: '2026-10-01', rotulo: 'set 2026' };
    getPeriodosMock.mockResolvedValue([
      periodo('aberto'),
      { ...periodo('fechado'), inicio: '2026-09-01', fim: '2026-10-01', rotulo: 'set 2026' },
    ]);
    getRentabilidadeMock.mockImplementation(async (inicio?: string) =>
      inicio === '2026-09-01' ? set : planilha,
    );
    renderPage();

    await screen.findByRole('button', { name: 'Talitha' });
    await user.click(screen.getByRole('combobox', { name: 'Período' }));
    await user.click(await screen.findByRole('option', { name: /set 2026/ }));

    await waitFor(() => expect(getRentabilidadeMock).toHaveBeenCalledWith('2026-09-01'));
    expect(await screen.findByRole('button', { name: 'Reabrir período' })).toBeInTheDocument();
  });

  it('keeps the period picker and a way back when another period fails to load', async () => {
    const user = userEvent.setup();
    getPeriodosMock.mockResolvedValue([
      periodo('aberto'),
      { ...periodo('fechado'), inicio: '2026-09-01', fim: '2026-10-01', rotulo: 'set 2026' },
    ]);
    getRentabilidadeMock.mockImplementation(async (inicio?: string) => {
      if (inicio === '2026-09-01') throw new Error('periodo_invalido');
      return planilha;
    });
    renderPage();

    await screen.findByRole('button', { name: 'Talitha' });
    await user.click(screen.getByRole('combobox', { name: 'Período' }));
    await user.click(await screen.findByRole('option', { name: /set 2026/ }));

    expect(
      await screen.findByText('Não foi possível carregar a rentabilidade.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Período' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voltar ao período atual' }));
    expect(await screen.findByRole('button', { name: 'Talitha' })).toBeInTheDocument();
  });

  it('shows an error line when the query fails', async () => {
    getRentabilidadeMock.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(
      await screen.findByText('Não foi possível carregar a rentabilidade.'),
    ).toBeInTheDocument();
  });

  it('phone_renders_list', async () => {
    const user = userEvent.setup();
    desktop.value = false;
    renderPage();

    const lista = await screen.findByRole('list', { name: 'Clientes' });
    const itens = within(lista).getAllByRole('button');
    expect(itens).toHaveLength(15);
    expect(itens[0]).toHaveTextContent('Crícia');
    expect(norm(itens[0].textContent)).toContain('47,0%');
    expect(norm(itens[0].textContent)).toContain('R$ 705,00');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mensal' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Anual' }));
    expect(norm(within(lista).getAllByRole('button')[0].textContent)).toContain('R$ 8.460,00');

    await user.click(within(lista).getByRole('button', { name: /Talitha/ }));
    const sheet = await screen.findByRole('dialog');
    expect(norm(sheet.textContent)).toContain('Só este cliente: R$ 550,00 por mês');
  });
});
