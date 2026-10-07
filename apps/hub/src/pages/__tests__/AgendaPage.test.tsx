import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';
import type { HubAgendaItem } from '../../types';

vi.mock('../../api', () => ({
  fetchAgenda: vi.fn(),
  fetchAgendaItem: vi.fn(),
  responderAgenda: vi.fn(),
  remarcarAgenda: vi.fn(),
  cancelarRemarcacao: vi.fn(),
  agendaIcsUrl: (token: string, id: number) =>
    `https://x.supabase.co/functions/v1/hub-agenda/ocorrencia/${id}.ics?token=${token}`,
}));

import {
  cancelarRemarcacao,
  fetchAgenda,
  fetchAgendaItem,
  remarcarAgenda,
  responderAgenda,
} from '../../api';
import { AgendaPage } from '../AgendaPage';

const listar = vi.mocked(fetchAgenda);
const buscarItem = vi.mocked(fetchAgendaItem);
const responder = vi.mocked(responderAgenda);
const remarcar = vi.mocked(remarcarAgenda);
const cancelar = vi.mocked(cancelarRemarcacao);

// "Now" is 2026-10-07 12:00 in São Paulo (15:00 UTC). Only Date is faked so
// react-query and waitFor keep their real timers.
const AGORA = new Date('2026-10-07T15:00:00Z');

function item(over: Partial<HubAgendaItem> = {}): HubAgendaItem {
  return {
    ocorrencia_id: 10,
    sequencia: 1,
    inicio: '2026-10-20T18:00:00+00:00',
    fim: '2026-10-20T19:00:00+00:00',
    dia_inteiro: false,
    data_inicio_local: '2026-10-20',
    data_fim_local: '2026-10-20',
    tz: 'America/Sao_Paulo',
    titulo: 'Gravação de reels',
    descricao: null,
    local: null,
    link_reuniao: null,
    resposta: null,
    remarcacao: null,
    ...over,
  };
}

const passado = item({
  ocorrencia_id: 1,
  titulo: 'Reunião de setembro',
  inicio: '2026-09-25T13:00:00+00:00',
  fim: '2026-09-25T14:00:00+00:00',
  data_inicio_local: '2026-09-25',
  data_fim_local: '2026-09-25',
  resposta: 'sim',
});

function hubValue(feature_agenda = true) {
  return {
    bootstrap: {
      workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
      cliente_nome: 'Clínica Aurora',
      cliente_foto_url: null,
      is_active: true,
      cliente_id: 14,
      feature_mensagens: true,
      feature_agenda,
    },
    token: 'tk',
    workspace: 'mesaas',
    theme: 'light' as const,
    toggleTheme: () => {},
  };
}

function renderPage(path = '/mesaas/hub/tk/agenda', feature = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue(feature)}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/:workspace/hub/:token/agenda" element={<AgendaPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

const tzOriginal = process.env.TZ;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  process.env.TZ = 'America/Sao_Paulo';
  listar.mockReset();
  buscarItem.mockReset();
  responder.mockReset();
  remarcar.mockReset();
  cancelar.mockReset();
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = tzOriginal;
});

function card(titulo: string) {
  return screen.getByRole('article', { name: titulo });
}

describe('AgendaPage', () => {
  it('groups upcoming events by day and keeps the past ones collapsed under Anteriores', async () => {
    listar.mockResolvedValue({
      itens: [
        passado,
        item({ ocorrencia_id: 10, titulo: 'Gravação de reels' }),
        item({
          ocorrencia_id: 11,
          titulo: 'Sessão de fotos',
          inicio: '2026-10-20T20:00:00+00:00',
          fim: '2026-10-20T21:00:00+00:00',
        }),
        item({
          ocorrencia_id: 12,
          titulo: 'Planejamento',
          inicio: '2026-10-22T12:00:00+00:00',
          fim: '2026-10-22T13:00:00+00:00',
          data_inicio_local: '2026-10-22',
          data_fim_local: '2026-10-22',
        }),
      ],
      proximo: null,
    });
    renderPage();

    expect(await screen.findByText('Próximos')).toBeInTheDocument();
    const dia20 = screen.getByRole('region', { name: 'terça-feira, 20 de outubro' });
    expect(within(dia20).getByText('Gravação de reels')).toBeInTheDocument();
    expect(within(dia20).getByText('Sessão de fotos')).toBeInTheDocument();
    expect(within(dia20).getByText('15:00 às 16:00')).toBeInTheDocument();
    const dia22 = screen.getByRole('region', { name: 'quinta-feira, 22 de outubro' });
    expect(within(dia22).getByText('Planejamento')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Anteriores \(1\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Reunião de setembro')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Reunião de setembro')).toBeInTheDocument();
    // Past events cannot be answered any more.
    expect(
      within(card('Reunião de setembro')).queryByRole('button', { name: /Confirmar/ }),
    ).not.toBeInTheDocument();
    expect(listar).toHaveBeenCalledWith('tk', undefined);
  });

  it('Confirmar sends the shown inicio and turns the badge into Confirmado', async () => {
    const it10 = item();
    listar.mockResolvedValue({ itens: [it10], proximo: null });
    responder.mockResolvedValue({ item: { ...it10, resposta: 'sim' } });
    renderPage();

    const c = await screen.findByRole('article', { name: 'Gravação de reels' });
    expect(within(c).getByText('Aguardando sua resposta')).toBeInTheDocument();
    fireEvent.click(within(c).getByRole('button', { name: /Confirmar/ }));

    await waitFor(() => expect(within(c).getByText('Confirmado')).toBeInTheDocument());
    expect(responder).toHaveBeenCalledWith('tk', 10, 'sim', '2026-10-20T18:00:00+00:00');
    expect(within(c).getByRole('button', { name: /Confirmar/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Não vou turns the badge into Você recusou', async () => {
    const it10 = item();
    listar.mockResolvedValue({ itens: [it10], proximo: null });
    responder.mockResolvedValue({ item: { ...it10, resposta: 'nao' } });
    renderPage();

    const c = await screen.findByRole('article', { name: 'Gravação de reels' });
    fireEvent.click(within(c).getByRole('button', { name: /Não vou/ }));
    await waitFor(() => expect(within(c).getByText('Você recusou')).toBeInTheDocument());
    expect(responder).toHaveBeenCalledWith('tk', 10, 'nao', '2026-10-20T18:00:00+00:00');
  });

  it('a 409 "mudou de horário" shows the message and reloads the agenda', async () => {
    listar.mockResolvedValue({ itens: [item()], proximo: null });
    responder.mockRejectedValue(new Error('Este evento mudou de horário. Atualize a página.'));
    renderPage();

    const c = await screen.findByRole('article', { name: 'Gravação de reels' });
    expect(listar).toHaveBeenCalledTimes(1);
    fireEvent.click(within(c).getByRole('button', { name: /Confirmar/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este evento mudou de horário. Atualize a página.',
    );
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it('reschedule of a timed event pre-fills and sends the wall time in the event tz', async () => {
    // 18:00 UTC is 14:00 in Manaus and 15:00 in the browser (São Paulo).
    const manaus = item({ tz: 'America/Manaus', titulo: 'Visita técnica' });
    listar.mockResolvedValue({ itens: [manaus], proximo: null });
    remarcar.mockResolvedValue({
      item: {
        ...manaus,
        remarcacao: {
          id: 7,
          inicio_sugerido: '2026-10-22T18:00:00+00:00',
          fim_sugerido: '2026-10-22T19:00:00+00:00',
          mensagem: 'Viagem',
          criado_em: '2026-10-07T15:00:00+00:00',
        },
      },
    });
    renderPage();

    const c = await screen.findByRole('article', { name: 'Visita técnica' });
    expect(within(c).getByText('14:00 às 15:00 (America/Manaus)')).toBeInTheDocument();
    fireEvent.click(within(c).getByRole('button', { name: 'Mais opções' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pedir para remarcar/ }));

    const data = await screen.findByLabelText('Nova data');
    const hora = screen.getByLabelText('Novo horário');
    expect(data).toHaveValue('2026-10-20');
    expect(hora).toHaveValue('14:00');
    expect(screen.getByText('Horário no fuso do evento (America/Manaus).')).toBeInTheDocument();

    fireEvent.change(data, { target: { value: '2026-10-22' } });
    fireEvent.change(screen.getByLabelText(/Mensagem para a equipe/), {
      target: { value: '  Viagem  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    await waitFor(() =>
      expect(remarcar).toHaveBeenCalledWith('tk', 10, '2026-10-22', '14:00', 'Viagem'),
    );
    expect(
      await within(c).findByText(
        'Você pediu para remarcar para qui., 22 de out., 14:00 (America/Manaus). Aguardando a equipe.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Nova data')).not.toBeInTheDocument();
  });

  it('an all-day event has no time field and sends hora null', async () => {
    const diaTodo = item({
      dia_inteiro: true,
      titulo: 'Feira',
      inicio: '2026-10-20T03:00:00+00:00',
      fim: '2026-10-21T03:00:00+00:00',
      data_inicio_local: '2026-10-20',
      data_fim_local: '2026-10-21',
    });
    listar.mockResolvedValue({ itens: [diaTodo], proximo: null });
    remarcar.mockResolvedValue({ item: diaTodo });
    renderPage();

    const c = await screen.findByRole('article', { name: 'Feira' });
    expect(within(c).getByText('Dia inteiro')).toBeInTheDocument();
    fireEvent.click(within(c).getByRole('button', { name: 'Mais opções' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pedir para remarcar/ }));

    const data = await screen.findByLabelText('Nova data');
    expect(screen.queryByLabelText('Novo horário')).not.toBeInTheDocument();
    fireEvent.change(data, { target: { value: '2026-10-23' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(remarcar).toHaveBeenCalledWith('tk', 10, '2026-10-23', null, ''));
  });

  it('refuses a suggestion in the past without calling the API', async () => {
    listar.mockResolvedValue({ itens: [item()], proximo: null });
    renderPage();

    const c = await screen.findByRole('article', { name: 'Gravação de reels' });
    fireEvent.click(within(c).getByRole('button', { name: 'Mais opções' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pedir para remarcar/ }));
    fireEvent.change(await screen.findByLabelText('Nova data'), {
      target: { value: '2026-10-06' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByText('Escolha um horário no futuro.')).toBeInTheDocument();
    expect(remarcar).not.toHaveBeenCalled();
  });

  it('a pending request shows its suggestion and Cancelar pedido withdraws it', async () => {
    const comPedido = item({
      remarcacao: {
        id: 7,
        inicio_sugerido: '2026-10-22T17:00:00+00:00',
        fim_sugerido: '2026-10-22T18:00:00+00:00',
        mensagem: null,
        criado_em: '2026-10-06T12:00:00+00:00',
      },
    });
    listar.mockResolvedValue({ itens: [comPedido], proximo: null });
    cancelar.mockResolvedValue({ ok: true });
    renderPage();

    const c = await screen.findByRole('article', { name: 'Gravação de reels' });
    expect(
      within(c).getByText(
        'Você pediu para remarcar para qui., 22 de out., 14:00. Aguardando a equipe.',
      ),
    ).toBeInTheDocument();
    // No second request while one is pending.
    fireEvent.click(within(c).getByRole('button', { name: 'Mais opções' }));
    expect(await screen.findByRole('menuitem', { name: /Baixar \.ics/ })).toHaveAttribute(
      'href',
      'https://x.supabase.co/functions/v1/hub-agenda/ocorrencia/10.ics?token=tk',
    );
    expect(screen.queryByRole('menuitem', { name: /Pedir para remarcar/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    fireEvent.click(within(c).getByRole('button', { name: 'Cancelar pedido' }));
    await waitFor(() => expect(cancelar).toHaveBeenCalledWith('tk', 7));
    await waitFor(() =>
      expect(within(c).queryByText(/Você pediu para remarcar/)).not.toBeInTheDocument(),
    );
  });

  it('the menu offers the Google Agenda template link', async () => {
    listar.mockResolvedValue({ itens: [item()], proximo: null });
    renderPage();
    const c = await screen.findByRole('article', { name: 'Gravação de reels' });
    fireEvent.click(within(c).getByRole('button', { name: 'Mais opções' }));
    const google = await screen.findByRole('menuitem', { name: /Adicionar ao Google Agenda/ });
    const href = new URL(google.getAttribute('href')!);
    expect(href.hostname).toBe('calendar.google.com');
    expect(href.searchParams.get('dates')).toBe('20261020T180000Z/20261020T190000Z');
  });

  it('?ocorrencia=<id> highlights and scrolls to a card already on the first page', async () => {
    listar.mockResolvedValue({
      itens: [item({ ocorrencia_id: 10 }), item({ ocorrencia_id: 11, titulo: 'Outro' })],
      proximo: null,
    });
    renderPage('/mesaas/hub/tk/agenda?ocorrencia=11');

    const alvo = await screen.findByRole('article', { name: 'Outro' });
    expect(alvo).toHaveAttribute('data-highlighted', 'true');
    expect(card('Gravação de reels')).not.toHaveAttribute('data-highlighted');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(buscarItem).not.toHaveBeenCalled();
  });

  it('?ocorrencia=<id> fetches the occurrence on its own when it is not on the first page', async () => {
    listar.mockResolvedValue({
      itens: [item({ ocorrencia_id: 10 })],
      proximo: { inicio: '2026-10-20T18:00:00+00:00', id: 10 },
    });
    buscarItem.mockResolvedValue({
      item: item({
        ocorrencia_id: 99,
        titulo: 'Evento distante',
        inicio: '2026-12-01T18:00:00+00:00',
        fim: '2026-12-01T19:00:00+00:00',
        data_inicio_local: '2026-12-01',
        data_fim_local: '2026-12-01',
      }),
    });
    renderPage('/mesaas/hub/tk/agenda?ocorrencia=99');

    const alvo = await screen.findByRole('article', { name: 'Evento distante' });
    expect(buscarItem).toHaveBeenCalledWith('tk', 99);
    expect(alvo).toHaveAttribute('data-highlighted', 'true');
  });

  it('?ocorrencia=<id> that no longer exists says so', async () => {
    listar.mockResolvedValue({ itens: [item()], proximo: null });
    buscarItem.mockRejectedValue(new Error('Evento não encontrado.'));
    renderPage('/mesaas/hub/tk/agenda?ocorrencia=55');
    expect(await screen.findByText('Este evento não está mais disponível.')).toBeInTheDocument();
  });

  it('Carregar mais fetches the next page with the cursor', async () => {
    listar
      .mockResolvedValueOnce({
        itens: [item({ ocorrencia_id: 10 })],
        proximo: { inicio: '2026-10-20T18:00:00+00:00', id: 10 },
      })
      .mockResolvedValueOnce({
        itens: [
          item({
            ocorrencia_id: 20,
            titulo: 'Segunda página',
            inicio: '2026-11-03T18:00:00+00:00',
            fim: '2026-11-03T19:00:00+00:00',
          }),
        ],
        proximo: null,
      });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Segunda página')).toBeInTheDocument();
    expect(listar).toHaveBeenLastCalledWith('tk', { inicio: '2026-10-20T18:00:00+00:00', id: 10 });
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    listar.mockResolvedValue({ itens: [], proximo: null });
    renderPage();
    expect(await screen.findByText('Nenhum evento por aqui ainda.')).toBeInTheDocument();
  });

  it('without feature_agenda it never calls the API', async () => {
    renderPage('/mesaas/hub/tk/agenda', false);
    expect(
      await screen.findByText('A agenda não está disponível neste portal.'),
    ).toBeInTheDocument();
    expect(listar).not.toHaveBeenCalled();
  });
});
