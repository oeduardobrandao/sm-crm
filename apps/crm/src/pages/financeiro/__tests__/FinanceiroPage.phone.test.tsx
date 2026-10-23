import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';
import { MASKED_BRL } from '@/lib/financialAccess';

// jsdom's matchMedia reports false, so FinanceiroPage renders its phone branch (PLAN F2d).

const { useAuthMock, store } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  store: {
    getTransacoes: vi.fn(),
    getClientes: vi.fn(),
    getMembros: vi.fn(),
    addTransacao: vi.fn(),
    updateTransacao: vi.fn(),
    removeTransacao: vi.fn(),
    getRecorrentes: vi.fn(),
    addRecorrente: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  ...store,
  // The projection is covered elsewhere; here the rows are the fixtures as given.
  projetarAgendamentos: (rows: unknown[]) => rows,
}));

import FinanceiroPage from '../FinanceiroPage';

const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const ADICIONAR = 'Adicionar: Entrada, Saída, Importar CSV ou Recorrentes';

const ROWS = [
  {
    id: 1,
    descricao: 'Mensalidade Café Aurora',
    detalhe: '',
    categoria: 'Mensalidade',
    tipo: 'entrada',
    valor: 3200,
    data: `${ym}-10`,
    status: 'pago',
  },
  {
    id: 2,
    descricao: 'Anúncios Meta',
    detalhe: '',
    categoria: 'Tráfego',
    tipo: 'saida',
    valor: 450,
    data: `${ym}-10`,
    status: 'pago',
  },
  {
    id: 3,
    descricao: 'Clínica Sol',
    detalhe: '',
    categoria: 'Agendamento',
    tipo: 'entrada',
    valor: 2500,
    data: `${ym}-12`,
    status: 'agendado',
  },
  {
    descricao: 'Bruno',
    detalhe: '',
    categoria: 'Agendamento',
    tipo: 'saida',
    valor: 1800,
    data: `${ym}-12`,
    status: 'agendado',
    referencia_agendamento: `membro_7_${ym}`,
  },
];

function renderPage({ phoneShell = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/financeiro']}>
        <FinanceiroPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(phoneShell ? <PhoneLayoutProvider isPhone>{page}</PhoneLayoutProvider> : page);
}

function rowOf(text: string) {
  return screen.getByText(text).closest('li') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ canSeeFinancials: true, profile: { conta_id: 'w1' } });
  store.getTransacoes.mockResolvedValue(ROWS);
  store.getClientes.mockResolvedValue([]);
  store.getMembros.mockResolvedValue([]);
  store.addTransacao.mockResolvedValue({});
  store.updateTransacao.mockResolvedValue(undefined);
  store.removeTransacao.mockResolvedValue(undefined);
  store.getRecorrentes.mockResolvedValue([]);
  store.addRecorrente.mockResolvedValue({});
});

describe('FinanceiroPage on phones', () => {
  it('renders the page header, the month summary and the rows grouped by day', async () => {
    renderPage();

    expect(await screen.findByText('Clínica Sol')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeInTheDocument();
    expect(
      screen.getByText('Visão das finanças, receitas projetadas e despesas.'),
    ).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeNull();
    const summary = screen.getByRole('region', { name: 'Resumo do mês' });
    expect(within(summary).getByText('Saldo projetado')).toBeInTheDocument();
    expect(within(summary).getByText('A pagar')).toBeInTheDocument();
    // Two days, two groups.
    expect(screen.getAllByRole('list').length).toBeGreaterThanOrEqual(3);
    expect(within(rowOf('Clínica Sol')).getByText('Agendado')).toBeInTheDocument();
    expect(within(rowOf('Anúncios Meta')).getByText('Pago')).toBeInTheDocument();
  });

  it('masks every value without financial access', async () => {
    useAuthMock.mockReturnValue({ canSeeFinancials: false, profile: { conta_id: 'w1' } });
    renderPage();

    await screen.findByText('Clínica Sol');
    expect(
      screen.getAllByText(new RegExp(MASKED_BRL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length,
    ).toBeGreaterThan(5);
    expect(screen.queryByText(/3\.200,00/)).not.toBeInTheDocument();
  });

  it('opens Entrada, Saída and Importar CSV from the "+" sheet, with the CSV columns', async () => {
    renderPage();
    await screen.findByText('Clínica Sol');

    fireEvent.click(screen.getByRole('button', { name: ADICIONAR }));
    const sheet = await screen.findByRole('dialog', { name: 'Adicionar' });
    expect(within(sheet).getByText(/descricao\*, valor\*, data\*/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Importar CSV' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Saída' }));

    expect(await screen.findByRole('dialog', { name: 'Registrar Saída' })).toBeInTheDocument();
  });

  it('confirms a scheduled row from its swipe action', async () => {
    renderPage();
    await screen.findByText('Clínica Sol');

    fireEvent.click(within(rowOf('Clínica Sol')).getByRole('button', { name: 'Confirmar' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Confirmar pagamento?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sim' }));

    await waitFor(() => expect(store.updateTransacao).toHaveBeenCalledWith(3, { status: 'pago' }));
  });

  it('edits and removes paid rows, never offering Confirmar on them', async () => {
    renderPage();
    await screen.findByText('Anúncios Meta');
    const row = rowOf('Anúncios Meta');

    expect(within(row).queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Remover' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Remover esta transação?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sim' }));
    await waitFor(() => expect(store.removeTransacao).toHaveBeenCalledWith(2));

    fireEvent.click(within(rowOf('Anúncios Meta')).getByRole('button', { name: 'Editar' }));
    expect(await screen.findByRole('dialog', { name: 'Editar Transação' })).toBeInTheDocument();
  });

  it('bulk-confirms the selected scheduled rows in selection mode', async () => {
    renderPage();
    await screen.findByText('Clínica Sol');

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar' }));
    // Only scheduled rows are pickable; paid rows stay visible without a checkbox.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: 'Selecionar Anúncios Meta' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Bruno' }));
    expect(screen.getByRole('heading', { level: 1, name: '1 selecionada' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar 1' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Confirmar 1 pagamento?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sim' }));

    // A projected occurrence is materialised as a new paid row, as on desktop.
    await waitFor(() =>
      expect(store.addTransacao).toHaveBeenCalledWith(
        expect.objectContaining({ descricao: 'Bruno', status: 'pago' }),
      ),
    );
    expect(store.updateTransacao).not.toHaveBeenCalled();
    // Done: back to the normal header.
    expect(await screen.findByRole('button', { name: 'Selecionar' })).toBeInTheDocument();
  });

  it('selects every scheduled row with Selecionar todas, and Cancelar leaves the mode', async () => {
    renderPage();
    await screen.findByText('Clínica Sol');

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todas' }));
    expect(screen.getByRole('heading', { level: 1, name: '2 selecionadas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desmarcar todas' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeInTheDocument();
    // Leaving drops the selection.
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar' }));
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });

  it('filters by type with the segmented control', async () => {
    renderPage();
    await screen.findByText('Clínica Sol');

    fireEvent.click(screen.getByRole('radio', { name: 'Saídas' }));
    expect(screen.queryByText('Clínica Sol')).not.toBeInTheDocument();
    expect(screen.getByText('Anúncios Meta')).toBeInTheDocument();
  });

  it('switches to all months from the month sheet', async () => {
    store.getTransacoes.mockResolvedValue([
      ...ROWS,
      {
        id: 9,
        descricao: 'Imposto antigo',
        detalhe: '',
        categoria: 'Imposto',
        tipo: 'saida',
        valor: 99,
        data: '2020-01-15',
        status: 'pago',
      },
    ]);
    renderPage();
    await screen.findByText('Clínica Sol');
    expect(screen.queryByText('Imposto antigo')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mês/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Mês' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Todos os meses' }));

    expect(await screen.findByText('Imposto antigo')).toBeInTheDocument();
  });

  it('fills the form with grouped rows and a Categoria picker inside the phone shell', async () => {
    renderPage({ phoneShell: true });
    await screen.findByText('Clínica Sol');

    fireEvent.click(screen.getByRole('button', { name: ADICIONAR }));
    fireEvent.click(await screen.findByRole('button', { name: 'Entrada' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar Entrada' });

    fireEvent.change(within(dialog).getByLabelText('Descrição'), {
      target: { value: 'Projeto extra' },
    });
    fireEvent.change(within(dialog).getByLabelText('Valor (R$)'), { target: { value: '150' } });
    fireEvent.change(within(dialog).getByLabelText('Data'), { target: { value: `${ym}-20` } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Categoria/ }));
    const picker = await screen.findByRole('dialog', { name: 'Categoria' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Produção' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /Categoria/ })).toHaveTextContent(
        'Produção',
      ),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(store.addTransacao).toHaveBeenCalledWith(
        expect.objectContaining({
          descricao: 'Projeto extra',
          valor: 150,
          data: `${ym}-20`,
          categoria: 'Produção',
          tipo: 'entrada',
          status: 'pago',
        }),
      ),
    );
  });

  it('registers a lançamento that repeats every month from "Repetir todo mês"', async () => {
    store.addRecorrente.mockResolvedValue({ id: 42 });
    renderPage({ phoneShell: true });
    await screen.findByText('Clínica Sol');

    fireEvent.click(screen.getByRole('button', { name: ADICIONAR }));
    fireEvent.click(await screen.findByRole('button', { name: 'Saída' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar Saída' });

    fireEvent.change(within(dialog).getByLabelText('Descrição'), { target: { value: ' Canva ' } });
    fireEvent.change(within(dialog).getByLabelText('Valor (R$)'), { target: { value: '99.9' } });
    fireEvent.change(within(dialog).getByLabelText('Data'), { target: { value: `${ym}-08` } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Categoria/ }));
    const picker = await screen.findByRole('dialog', { name: 'Categoria' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Ferramenta' }));
    const toggle = within(dialog).getByRole('switch', { name: 'Repetir todo mês' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(store.addTransacao).toHaveBeenCalled());
    expect(store.addRecorrente).toHaveBeenCalledWith({
      tipo: 'saida',
      descricao: 'Canva',
      categoria: 'Ferramenta',
      valor: 99.9,
      dia: 8,
      inicio: `${ym}-01`,
    });
    expect(store.addTransacao).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'saida',
        valor: 99.9,
        data: `${ym}-08`,
        status: 'pago',
        detalhe: 'Recorrente',
        referencia_agendamento: `recorrente_42_${ym.replace('-', '_')}`,
      }),
    );
  });

  it('offers no "Repetir todo mês" when editing a lançamento', async () => {
    renderPage({ phoneShell: true });
    await screen.findByText('Anúncios Meta');
    fireEvent.click(within(rowOf('Anúncios Meta')).getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar Transação' });
    expect(within(dialog).queryByRole('switch', { name: 'Repetir todo mês' })).toBeNull();
  });

  it('lists the recurring lançamentos from the "+" sheet', async () => {
    store.getRecorrentes.mockResolvedValue([
      {
        id: 7,
        tipo: 'saida',
        descricao: 'Canva',
        categoria: 'Ferramenta',
        valor: 99.9,
        dia: 10,
        inicio: '2026-01-01',
        fim: null,
      },
    ]);
    renderPage();
    await screen.findByText('Clínica Sol');

    fireEvent.click(screen.getByRole('button', { name: ADICIONAR }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recorrentes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Lançamentos recorrentes' });
    expect(within(dialog).getByText('Canva')).toBeInTheDocument();
    expect(within(dialog).getByText('Todo dia 10 · Ferramenta')).toBeInTheDocument();
  });

  it('hides Recorrentes without financial access', async () => {
    useAuthMock.mockReturnValue({ canSeeFinancials: false, profile: { conta_id: 'w1' } });
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Adicionar: Entrada, Saída ou Importar CSV' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Adicionar' });
    expect(within(sheet).queryByRole('button', { name: 'Recorrentes' })).toBeNull();
    expect(store.getRecorrentes).not.toHaveBeenCalled();
  });
});
