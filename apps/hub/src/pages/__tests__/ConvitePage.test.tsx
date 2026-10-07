import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ConviteItem, ConviteResponse } from '../../types';

// Real constants and conviteIcsUrl; only the two network calls are faked.
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  fetchConvite: vi.fn(),
  responderConvite: vi.fn(),
}));

import {
  CONVITE_HORARIO_MUDOU,
  CONVITE_INDISPONIVEL,
  CONVITE_JA_ACONTECEU,
  conviteIcsUrl,
  fetchConvite,
  responderConvite,
} from '../../api';
import { linkGoogleAgenda } from '../agenda/formatar';
import { ConvitePage } from '../ConvitePage';

const ler = vi.mocked(fetchConvite);
const responder = vi.mocked(responderConvite);

const TOKEN = 'a'.repeat(64);
// "Now" is 2026-10-07 12:00 in São Paulo. Only Date is faked so react-query keeps real timers.
const AGORA = new Date('2026-10-07T15:00:00Z');

function item(over: Partial<ConviteItem> = {}): ConviteItem {
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
    local: 'Estúdio Centro',
    link_reuniao: null,
    resposta: null,
    ...over,
  };
}

function convite(over: Partial<ConviteResponse> = {}): ConviteResponse {
  return {
    workspace: { nome: 'Estúdio Lumen', brand_color: '#0f766e', logo_url: null },
    organizador_nome: 'Ana Lima',
    titulo: 'Gravação de reels',
    itens: [
      item(),
      item({
        ocorrencia_id: 11,
        inicio: '2026-10-27T18:00:00+00:00',
        fim: '2026-10-27T19:00:00+00:00',
        data_inicio_local: '2026-10-27',
        data_fim_local: '2026-10-27',
      }),
    ],
    ...over,
  };
}

function renderPage(path = `/convite/${TOKEN}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/convite/:token" element={<ConvitePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tzOriginal = process.env.TZ;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  process.env.TZ = 'America/Sao_Paulo';
  ler.mockReset();
  responder.mockReset();
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = tzOriginal;
  document.head.querySelectorAll('style').forEach((s) => s.remove());
});

describe('ConvitePage', () => {
  it('shows the workspace, the organizer, the title, one card per date and the footer', async () => {
    ler.mockResolvedValue(convite());
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Gravação de reels' }),
    ).toBeInTheDocument();
    expect(ler).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText('Estúdio Lumen')).toBeInTheDocument();
    expect(screen.getByText('Convite de Ana Lima')).toBeInTheDocument();
    // No logo: the workspace initial.
    expect(screen.getByText('E')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('region', { name: /terça-feira, 20 de outubro/i })).toBeInTheDocument();
    expect(screen.getByText('Enviado pela Mesaas em nome de Estúdio Lumen.')).toBeInTheDocument();
    // The page applies the workspace accent itself (it lives outside HubShell).
    expect(document.body.innerHTML).toContain('--hub-acc: #0f766e');
  });

  it('falls back to the workspace name without an organizer and shows the logo when there is one', async () => {
    ler.mockResolvedValue(
      convite({
        organizador_nome: null,
        workspace: {
          nome: 'Estúdio Lumen',
          brand_color: null,
          logo_url: 'https://cdn.example.com/logo.png',
        },
      }),
    );
    renderPage();
    expect(await screen.findByText('Convite de Estúdio Lumen')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Estúdio Lumen' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/logo.png',
    );
  });

  it('confirms a date and shows "Você confirmou"', async () => {
    ler.mockResolvedValue(convite());
    responder.mockResolvedValue({ item: item({ resposta: 'sim' }) });
    renderPage();

    const card = await screen.findByTestId('agenda-card-10');
    expect(within(card).getByText('Aguardando sua resposta')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /Confirmar/ }));

    await waitFor(() => expect(within(card).getByText('Você confirmou')).toBeInTheDocument());
    expect(responder).toHaveBeenCalledWith(TOKEN, 10, 'sim', '2026-10-20T18:00:00+00:00');
  });

  it('declines a date and shows "Você recusou"', async () => {
    ler.mockResolvedValue(convite());
    responder.mockResolvedValue({ item: { ...convite().itens[1], resposta: 'nao' } });
    renderPage();

    const card = await screen.findByTestId('agenda-card-11');
    fireEvent.click(within(card).getByRole('button', { name: /Não vou/ }));

    await waitFor(() => expect(within(card).getByText('Você recusou')).toBeInTheDocument());
    expect(responder).toHaveBeenCalledWith(TOKEN, 11, 'nao', '2026-10-27T18:00:00+00:00');
    expect(within(screen.getByTestId('agenda-card-10')).getByText('Aguardando sua resposta'));
  });

  // request() throws Error(body.error) without the status: the page tells the 404 from the
  // two 409s by the exact contract messages.
  it('shows the unavailable state on the 404 message, without retrying', async () => {
    ler.mockRejectedValue(new Error(CONVITE_INDISPONIVEL));
    renderPage();
    expect(await screen.findByText('Este convite não está mais disponível.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
    expect(ler).toHaveBeenCalledTimes(1);
  });

  it('never calls the API for a malformed token', async () => {
    renderPage('/convite/nao-e-um-token');
    expect(await screen.findByText('Este convite não está mais disponível.')).toBeInTheDocument();
    expect(ler).not.toHaveBeenCalled();
  });

  it('offers a retry on any other load error', async () => {
    // A generic failure is retried once (300 ms) before the error shows.
    ler.mockRejectedValue(new Error('Erro interno'));
    renderPage();
    expect(
      await screen.findByText('Não foi possível carregar o convite.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(ler).toHaveBeenCalledTimes(2);
    ler.mockResolvedValue(convite());
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Gravação de reels' }),
    ).toBeInTheDocument();
  });

  it('shows the moved-time 409 on the card and reloads the invite', async () => {
    ler.mockResolvedValue(convite());
    responder.mockRejectedValue(new Error(CONVITE_HORARIO_MUDOU));
    renderPage();

    const card = await screen.findByTestId('agenda-card-10');
    fireEvent.click(within(card).getByRole('button', { name: /Confirmar/ }));

    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Este evento mudou de horário. Atualize a página.',
    );
    await waitFor(() => expect(ler).toHaveBeenCalledTimes(2));
  });

  it('shows the already-happened 409 on the card', async () => {
    ler.mockResolvedValue(convite());
    responder.mockRejectedValue(new Error(CONVITE_JA_ACONTECEU));
    renderPage();

    const card = await screen.findByTestId('agenda-card-11');
    fireEvent.click(within(card).getByRole('button', { name: /Não vou/ }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Este evento já aconteceu.');
  });

  it('switches to the unavailable state when an answer gets the 404', async () => {
    ler.mockResolvedValueOnce(convite());
    ler.mockRejectedValue(new Error(CONVITE_INDISPONIVEL));
    responder.mockRejectedValue(new Error(CONVITE_INDISPONIVEL));
    renderPage();

    const card = await screen.findByTestId('agenda-card-10');
    fireEvent.click(within(card).getByRole('button', { name: /Confirmar/ }));
    expect(
      await screen.findByRole('heading', { name: 'Este convite não está mais disponível.' }),
    ).toBeInTheDocument();
  });

  it('scrolls to and highlights ?ocorrencia=', async () => {
    ler.mockResolvedValue(convite());
    renderPage(`/convite/${TOKEN}?ocorrencia=11`);

    const card = await screen.findByTestId('agenda-card-11');
    expect(card).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('agenda-card-10')).not.toHaveAttribute('data-highlighted');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it('has no reschedule, and builds the Google link and the .ics link for the invite', async () => {
    ler.mockResolvedValue(convite());
    renderPage();

    const card = await screen.findByTestId('agenda-card-10');
    fireEvent.click(within(card).getByRole('button', { name: 'Mais opções' }));

    expect(await screen.findByRole('link', { name: /Google Agenda/ })).toHaveAttribute(
      'href',
      linkGoogleAgenda(item()),
    );
    expect(screen.getByRole('link', { name: /Baixar .ics/ })).toHaveAttribute(
      'href',
      conviteIcsUrl(TOKEN, 10),
    );
    expect(conviteIcsUrl(TOKEN, 10)).toContain(
      `/functions/v1/agenda-convite/ocorrencia/10.ics?token=${TOKEN}`,
    );
    expect(screen.queryByText('Pedir para remarcar')).not.toBeInTheDocument();
  });

  it('lists past dates under their own heading without answer buttons', async () => {
    ler.mockResolvedValue(
      convite({
        itens: [
          item({
            ocorrencia_id: 5,
            inicio: '2026-10-01T18:00:00+00:00',
            fim: '2026-10-01T19:00:00+00:00',
            data_inicio_local: '2026-10-01',
            data_fim_local: '2026-10-01',
            resposta: 'sim',
          }),
          item(),
        ],
      }),
    );
    renderPage();

    const passado = await screen.findByTestId('agenda-card-5');
    expect(screen.getByRole('heading', { name: 'Já aconteceram' })).toBeInTheDocument();
    expect(within(passado).queryByRole('button', { name: /Confirmar/ })).not.toBeInTheDocument();
    expect(within(passado).getByText('Você confirmou')).toBeInTheDocument();
  });
});
