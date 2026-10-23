import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { planilha } from './fixtures/planilha';
import type { PeriodoFinanceiro, RentabilidadeSeeded } from '@/store/financeiroV2';

// Radix Select needs pointer-capture/scrollIntoView APIs jsdom lacks.
beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, store } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  store: { getRentabilidade: vi.fn(), getPeriodos: vi.fn() },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import CustosEquipePage from '../CustosEquipePage';

const PERIODOS: PeriodoFinanceiro[] = [
  {
    inicio: '2026-10-01',
    fim: '2026-11-01',
    rotulo: 'out 2026',
    status: 'aberto',
    transicao: false,
    fator: 1,
  },
  {
    inicio: '2026-09-01',
    fim: '2026-10-01',
    rotulo: 'set 2026',
    status: 'fechado',
    transicao: false,
    fator: 1,
  },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CustosEquipePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const linhaDe = (nome: string) => screen.getByRole('link', { name: nome }).closest('tr')!;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ canSeeFinancials: true });
  store.getRentabilidade.mockResolvedValue(planilha);
  store.getPeriodos.mockResolvedValue(PERIODOS);
});

describe('CustosEquipePage', () => {
  it('lists_members_with_model_labels', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Ana' });
    const ana = linhaDe('Ana');
    expect(within(ana).getByText('Design')).toBeInTheDocument();
    expect(within(ana).getByText('Mensal com meta')).toBeInTheDocument();
    expect(within(ana).getByText(/R\$\s3\.900,00/)).toBeInTheDocument();
    expect(within(ana).getByText('15')).toBeInTheDocument();
    expect(within(ana).getByText(/R\$\s260,00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ana' })).toHaveAttribute('href', '/equipe/3');

    const duda = linhaDe('Duda');
    expect(within(duda).getByText('Mensal com limite')).toBeInTheDocument();
    expect(within(duda).getByText(/15 de 20/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1 + planilha.membros.length + 1);
  });

  it('total_matches_custo_total', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Ana' });
    const footer = screen.getAllByRole('row').at(-1)!;
    expect(within(footer).getByText('Total')).toBeInTheDocument();
    expect(within(footer).getByText(/R\$\s12\.310,00/)).toBeInTheDocument();
    expect(screen.queryByText(/Sem cliente/)).not.toBeInTheDocument();
  });

  it('shows_custo_sem_cliente_when_positive', async () => {
    const data = structuredClone(planilha) as RentabilidadeSeeded;
    data.totais.custo_sem_cliente = 550;
    data.totais.custo_total = 12860;
    store.getRentabilidade.mockResolvedValue(data);
    renderPage();
    expect(await screen.findByText(/Sem cliente: R\$\s550,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s12\.860,00/)).toBeInTheDocument();
  });

  it('sem_funcao_badge', async () => {
    const data = structuredClone(planilha) as RentabilidadeSeeded;
    data.membros.find((m) => m.membro_id === 2)!.funcao_id = null;
    store.getRentabilidade.mockResolvedValue(data);
    renderPage();
    await screen.findByRole('link', { name: 'Lia' });
    expect(within(linhaDe('Lia')).getByText('Sem função')).toBeInTheDocument();
    expect(within(linhaDe('Ana')).queryByText('Sem função')).not.toBeInTheDocument();
  });

  it('a_informar_link', async () => {
    const data = structuredClone(planilha) as RentabilidadeSeeded;
    const lia = data.membros.find((m) => m.membro_id === 2)!;
    lia.modelo = 'por_entrega';
    lia.a_informar = true;
    lia.custo = 0;
    lia.por_cliente = null;
    store.getRentabilidade.mockResolvedValue(data);
    renderPage();
    await screen.findByRole('link', { name: 'Lia' });
    const row = linhaDe('Lia');
    expect(within(row).getByText('Por entrega')).toBeInTheDocument();
    const link = within(row).getByRole('link', { name: 'Entregas a informar' });
    expect(link).toHaveAttribute('href', '/equipe/2');
    expect(within(row).queryByText(/R\$\s0,00/)).not.toBeInTheDocument();
  });

  it('shows_dash_when_por_cliente_is_null', async () => {
    const data = structuredClone(planilha) as RentabilidadeSeeded;
    const lia = data.membros.find((m) => m.membro_id === 2)!;
    lia.n_clientes = 0;
    lia.por_cliente = null;
    store.getRentabilidade.mockResolvedValue(data);
    renderPage();
    await screen.findByRole('link', { name: 'Lia' });
    const cells = within(linhaDe('Lia')).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent('-');
  });

  it('switches_period', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('link', { name: 'Ana' });
    expect(store.getRentabilidade).toHaveBeenCalledWith(undefined);
    await user.click(screen.getByRole('combobox', { name: 'Período' }));
    await user.click(await screen.findByRole('option', { name: /set 2026/ }));
    expect(store.getRentabilidade).toHaveBeenCalledWith('2026-09-01');
  });

  it('shows_an_error_line_when_the_load_fails', async () => {
    store.getRentabilidade.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/Não foi possível carregar/)).toBeInTheDocument();
  });
});
