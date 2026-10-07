import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledPost } from '../../../../store';
import type { CamadaItem, CamadaPagamento } from '../tipos';

vi.mock('../../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../../store')>('../../../../store');
  return { ...actual, addTransacao: vi.fn() };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import * as store from '../../../../store';
import { CamadaPopover, situacaoDoPrazo } from '../CamadaPopover';
import { useConfirmarPagamento } from '../useConfirmarPagamento';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

/** The popover plus the confirm hook, wired the way AgendaTab wires them. */
function Harness({ item, onClose }: { item: CamadaItem; onClose: () => void }) {
  const { pedirConfirmacao, dialog } = useConfirmarPagamento(true);
  const anchor = document.getElementById('ancora')!;
  return (
    <>
      <CamadaPopover
        item={item}
        anchor={anchor}
        onClose={onClose}
        onConfirmar={pedirConfirmacao}
        canSeeFinancials={true}
      />
      {dialog}
    </>
  );
}

function renderPopover(item: CamadaItem) {
  document.getElementById('ancora')?.remove();
  const ancora = document.createElement('div');
  ancora.id = 'ancora';
  document.body.appendChild(ancora);
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/calendario']}>
        <Harness item={item} onClose={onClose} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
    { container: document.body.appendChild(document.createElement('div')) },
  );
  return { onClose, qc };
}

const post = (over: Partial<ScheduledPost> = {}): CamadaItem => ({
  camada: 'posts',
  id: 'posts:55',
  inicio: new Date(2026, 9, 7, 10, 30).toISOString(),
  post: {
    id: 55,
    workflow_id: 3,
    cliente_id: 10,
    cliente_nome: 'Clínica Sorriso',
    workflow_titulo: 'Outubro',
    titulo: 'Carrossel de dicas',
    tipo: 'carrossel',
    status: 'agendado',
    scheduled_at: new Date(2026, 9, 7, 10, 30).toISOString(),
    platform: 'instagram',
    ...over,
  } as ScheduledPost,
  estado: 'agendado',
});

const pagamento = (over: Partial<CamadaPagamento>): CamadaPagamento => ({
  nome: 'Clínica Sorriso',
  valor: 1500,
  pago: false,
  referencia: 'cliente_1_2026_10',
  alvo: { tipo: 'cliente', id: 1 },
  ajustado: false,
  diaConfigurado: 10,
  ...over,
});

describe('CamadaPopover', () => {
  beforeEach(() => {
    vi.mocked(store.addTransacao).mockReset();
  });

  it('post: title, client, platform, time and status; "Abrir post" opens it in its workflow', () => {
    const { onClose } = renderPopover(post());
    expect(screen.getByRole('heading', { name: 'Carrossel de dicas' })).toBeInTheDocument();
    expect(screen.getByText('Posts agendados')).toBeInTheDocument();
    expect(screen.getByText('Clínica Sorriso')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('Quarta, 7 de outubro de 2026 · 10:30')).toBeInTheDocument();
    expect(screen.getByText('Agendado')).toHaveClass('post-status-chip');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir post' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/entregas?drawer=3&post=55');
  });

  it('post avulso opens through the universal ?post= link', () => {
    renderPopover(post({ workflow_id: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir post' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/entregas?post=55');
  });

  it('deadline: stage, delivery, client, remaining days; "Abrir entrega" opens the drawer', () => {
    renderPopover({
      camada: 'prazos',
      id: 'prazos:3',
      dia: '2026-10-09',
      prazo: {
        workflowId: 3,
        workflowTitle: 'Fluxo de outubro',
        etapaNome: 'Design',
        clienteId: 10,
        clienteNome: 'Clínica Sorriso',
        clienteCor: '#123',
        deadlineDate: new Date(2026, 9, 9),
        diasRestantes: 2,
        estourado: false,
      },
    });
    expect(screen.getByRole('heading', { name: 'Design' })).toBeInTheDocument();
    expect(screen.getByText('Entrega: Fluxo de outubro')).toBeInTheDocument();
    expect(screen.getByText('Cliente: Clínica Sorriso')).toBeInTheDocument();
    expect(screen.getByText('Faltam 2 dias')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir entrega' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/entregas?drawer=3');
  });

  it('describes the deadline status', () => {
    expect(situacaoDoPrazo(2, false)).toBe('Faltam 2 dias');
    expect(situacaoDoPrazo(1, false)).toBe('Falta 1 dia');
    expect(situacaoDoPrazo(0, false)).toBe('Vence hoje');
    expect(situacaoDoPrazo(-1, true)).toBe('Estourado há 1 dia');
    expect(situacaoDoPrazo(-3, true)).toBe('Estourado há 3 dias');
  });

  it('client date: "Abrir cliente" goes to the client page', () => {
    renderPopover({
      camada: 'datas',
      id: 'datas:aniversario:4:2026-10-12',
      dia: '2026-10-12',
      tipo: 'aniversario',
      titulo: 'Aniversário',
      cliente: { id: 4, nome: 'Ana' },
    });
    expect(screen.getByRole('heading', { name: 'Aniversário' })).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cliente' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/clientes/4');
  });

  it('commemorative date: name, type and tags; a month item reads as the month', () => {
    renderPopover({
      camada: 'comemorativas',
      id: 'comemorativas:medico:0-0:2026-10-01',
      dia: '2026-10-01',
      nome: 'Outubro Rosa',
      tipo: 'month',
      tags: ['br', 'cancer'],
      rotulo: 'mes',
      mesInteiro: true,
    });
    expect(screen.getByRole('heading', { name: 'Outubro Rosa' })).toBeInTheDocument();
    expect(screen.getByText('Outubro de 2026')).toBeInTheDocument();
    expect(screen.getByText('Mês temático')).toBeInTheDocument();
    expect(screen.getByText('Brasil')).toBeInTheDocument();
    expect(screen.getByText('Câncer')).toBeInTheDocument();
  });

  it('a range shows its closing day', () => {
    renderPopover({
      camada: 'comemorativas',
      id: 'c',
      dia: '2026-08-01',
      nome: 'Semana Mundial da Amamentação',
      tipo: 'week',
      tags: [],
      rotulo: 'semana',
      ate: '07/08',
    });
    expect(screen.getByText('Sábado, 1 de agosto de 2026 até 07/08')).toBeInTheDocument();
  });

  it('payments of the day: paid ones say "Pago", an adjusted day says so', () => {
    renderPopover({
      camada: 'recebimentos',
      id: 'recebimentos:2026-02-28',
      dia: '2026-02-28',
      itens: [
        pagamento({ nome: 'A', pago: true, referencia: 'cliente_1_2026_02' }),
        pagamento({
          nome: 'B',
          referencia: 'cliente_2_2026_02',
          ajustado: true,
          diaConfigurado: 31,
        }),
      ],
    });
    expect(screen.getByRole('heading', { name: 'Recebimentos' })).toBeInTheDocument();
    expect(screen.getByText('Pago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar A' })).toBeNull();
    expect(screen.getByText('Dia 31, ajustado para o último dia do mês')).toBeInTheDocument();
  });

  it.each([
    [
      'cliente',
      pagamento({}),
      {
        descricao: 'Clínica Sorriso',
        categoria: 'Mensalidade Cliente',
        valor: 1500,
        tipo: 'entrada',
        referencia_agendamento: 'cliente_1_2026_10',
      },
    ],
    [
      'membro',
      pagamento({
        nome: 'Bruno',
        valor: 3000,
        referencia: 'membro_7_2026_10',
        alvo: { tipo: 'membro', id: 7 },
      }),
      {
        descricao: 'Pagto. Bruno',
        categoria: 'Pagamento Equipe',
        valor: 3000,
        tipo: 'saida',
        referencia_agendamento: 'membro_7_2026_10',
      },
    ],
  ] as const)(
    'confirming a %s payment goes through the same AlertDialog and payload as the Calendário tab',
    async (_alvo, item, esperado) => {
      vi.mocked(store.addTransacao).mockResolvedValue({} as never);
      const { onClose, qc } = renderPopover({
        camada: item.alvo.tipo === 'cliente' ? 'recebimentos' : 'pagamentos',
        id: 'x',
        dia: '2026-10-10',
        itens: [item],
      });
      const invalidar = vi.spyOn(qc, 'invalidateQueries');

      fireEvent.click(screen.getByRole('button', { name: `Confirmar ${item.nome}` }));
      expect(onClose).toHaveBeenCalled();
      expect(await screen.findByText('Confirmar Agendamento')).toBeInTheDocument();
      expect(
        screen.getByText(
          new RegExp(
            `^Confirmar o recebimento/pagamento agendado de ${esperado.descricao} \\(R\\$`,
          ),
        ),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
      await waitFor(() => expect(store.addTransacao).toHaveBeenCalledTimes(1));
      expect(store.addTransacao).toHaveBeenCalledWith({
        ...esperado,
        detalhe: 'Baixa efetuada pelo Calendário',
        data: new Date().toISOString().split('T')[0],
        status: 'pago',
      });
      await waitFor(() => expect(invalidar).toHaveBeenCalledWith({ queryKey: ['transacoes'] }));
    },
  );
});
